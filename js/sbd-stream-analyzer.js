(function (window, document) {

    // init library once
    if (window.SBDSA)
        return;
    var wsConnectionStr = "ws://ws.sa.sbd.vn:8080";
    visitorFrame = "http://static.sa.sbd.vn/bridge/frame.html";

    ////////////////////////////////////////////
    var visitorId = null;
    window.addEventListener("message", function (event) {
        if (event && event.data) {
            try {
                let obj = JSON.parse(event.data);
                if (obj.from === "SBDSA" && obj.type === "VISITOR") {
                    visitorId = obj.visitorId;
                }
            } catch (e) {
                console.log("Error: Can not parse JSON from bridge " + event.data);
            }
        }

    });
    window.addEventListener("load", function () {
        let bridgeFrame = document.createElement("IFRAME");
        bridgeFrame.src = visitorFrame;
        bridgeFrame.style.display = "none";
        document.body.appendChild(bridgeFrame);
    });

    var session, createWS = function () {
        wsReady = false;
        ws = new WebSocket(wsConnectionStr);
        ws.onopen = function () {
            wsReady = true;
            console.log("[ WS ] Connected!");
            send({
                type: "initWS",
                session: session,
                data: {

                },
                callback: function (resp) {
                    if (resp.status === "OK")
                        session = resp.data[0];
                    sessionReady = true;
                }
            });
        };
        ws.onmessage = function (evt) {
            var receivedMsg = evt.data;
            console.log("[ WS ] Receive message " + receivedMsg);
            let i = receivedMsg.indexOf("::");
            if (i > 0) {
                let cbKey = receivedMsg.substr(0, i);
                let data = receivedMsg.substr(i + 2);
                if (callback[cbKey]) {
                    callback[cbKey](JSON.parse(data));
                    delete callback[cbKey];
                }
            }
        };
        ws.onclose = function () {
            wsReady = false;
            console.log("[ WS ] Closed!");
            setTimeout(createWS, 2000);
        };
        ws.onerror = function () {
            wsReady = false;
            console.log("[ WS ] Error!");
            setTimeout(createWS, 2000);
        };
    }, ws, wsReady = false, sessionReady = false, queue = [], callback = {};
    let send = function (input) {
        if (input.callback) {
            let key = Date.now() + "" + Math.floor(Math.random() * 999999);
            callback[key] = input.callback;
            input.callback = key;
        }
        if (input.data && !(typeof input.data === "string")) {
            input.data = JSON.stringify(input.data);
        }
        if (input.type === "initWS") {
            ws.send(JSON.stringify([input]));
        } else {
            queue.push(input);
        }
    }, sendWorker = function () {
        if (!sessionReady || !wsReady || !queue.length) {
            return;
        }
        ws.send(JSON.stringify(queue));
        queue = [];
    };
    createWS();
    setInterval(sendWorker, 500);
    let tracked = [];
    let mapping = {};
    let HTML5Adapter = {
        init: function (opts) {

            // validation
            if (!opts.player.target || opts.player.target.tagName.toLowerCase() !== "video") {
                console.log("Must init 'video' object.");
                return;
            }

            for (let v in tracked) {
                if (tracked[v].video === opts.player.target) {
                    console.log("This video is already tracked!");
                    return;
                }
            }

            // localize
            let video = opts.player.target;
            let obj = {
                localId: "HTML5-" + Date.now() + "-" + Math.floor(Math.random() * 999999),
                video: video,
                loadComplete: false,
                playing: false,
                buffering: false,
                lastBuffering: 0,
                viewId: "",
                wsSession: "",
                lastPlayPosition: 0,
                lastActive: 0,
                lastPauseTime: 0,
                endView: false,
                loaded: false,
                afterInit: [],
                lastEvent: null,
                hasStartup: false
            };
            mapping[obj.localId] = obj;
            let initView = function () {
                send({
                    type: "initView",
                    data: {
                        envKey: opts.envKey,
                        viewerId: opts.viewerId,
                        playUrl: video.currentSrc,
                        video: opts.video,
                        date: new Date(),
                        visitorId: visitorId
                    },
                    callback: function (resp) {
                        console.log(resp);
                        if (resp.status === "OK") {
                            obj.viewId = resp.data[0].id;
                            if (obj.afterInit.length) {
                                for (let i = 0, evMsg; evMsg = obj.afterInit[i]; i++) {
                                    evMsg.data.viewId = obj.viewId;
                                    send(evMsg);
                                }
                                obj.afterInit = [];
                            }
                        }
                    }
                });
            }, sendViewEvent = function (evMsgData) {
                let evMsg = {
                    type: "event",
                    data: evMsgData
                };
                evMsgData.date = evMsgData.date || new Date();
                evMsgData.playPosition = evMsgData.playPosition || video.currentTime;
                evMsgData.playUrl = video.currentSrc;
                evMsgData.visitorId = visitorId;
                console.log(evMsgData);
                if (obj.viewId) {
                    evMsg.data.viewId = obj.viewId
                    send(evMsg);
                } else {
                    obj.afterInit.push(evMsg);
                }
                obj.lastEvent = evMsgData.eventName;
            }, playerLoaded = function () {
                if (!obj.loaded) {
                    obj.loaded = true;
                    sendViewEvent({
                        eventName: "PLAYER_LOAD"
                    });


                }
                clearInterval(interval);
            };

            initView();
            tracked.push(obj);
            console.log("[SaoBacDau SA] Start to track video", video);

            // listen events

            // check PLAYER_LOAD
            if (video.readyState >= 2) {
                playerLoaded();
            } else {
                video.addEventListener("canplay", playerLoaded());
            }

            video.addEventListener("loadedmetadata", function () {
                // retrieve dimensions
                sendViewEvent({
                    eventName: "DIMENSION",
                    infos: {
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        playerWidth: video.width,
                        playerHeight: video.height,
                        duration: video.duration
                    }
                });
            }, false);

            // Loading
            let lastProgress = 0, lastLoaded = 0, bitrate = 0, bitrateLog = [];
            let bitrateInt = setInterval(() => {
                let current = Date.now(), change = false;
                let progress = video.webkitVideoDecodedByteCount || video.mozVideoDecodedByteCount || video.videoDecodedByteCount;
                if (progress) {
                    if (lastLoaded) {
                        if (progress > lastProgress) {
                            bitrate = (progress - lastProgress) * 1000 / (current - lastLoaded);
                            change = true;
                        }
                    } else {
                        bitrate = progress;
                        change = true;
                    }
                    lastProgress = progress;
                    lastLoaded = current;
                }

                if (change) {
                    bitrate *= 8;
                    console.log("bitrate", bitrate);
                    bitrateLog.push(bitrate);

                    if (bitrateLog.length >= 5) {
                        let sum = 0;
                        for (let i = 0; bitrateLog[i]; i++) {
                            sum += bitrateLog[i];
                        }
                        sendViewEvent({
                            eventName: "BITRATE",
                            data: parseInt(sum / bitrateLog.length)
                        });
                        bitrateLog = [];
                    }
                }
            }, 1000);

            // measure STARTUP_TIME & get UNPAUSE event
            video.addEventListener("play", function (event) {
                console.log(event);
                sendViewEvent({
                    eventName: "PLAY"
                });

                obj.lastActive = Date.now();
                obj.playing = true;
                obj.buffering = false;
            });

            // on playing => STARTUP_TIME, BUFFERING_TIME, SEEK_TIME
            video.addEventListener("playing", function (event) {
                console.log(event);
                let startupTime = (Date.now() - obj.lastActive) / 1000.0;
                obj.lastActive = 0;
                obj.hasStartup = true;
                sendViewEvent({
                    eventName: "PLAYING",
                    data: startupTime
                });
                obj.lastPauseTime = 0;
            });




            // BUFFERING
            video.addEventListener("waiting", function (event) {
                console.log(event);
                obj.buffering = true;
                obj.lastActive = Date.now();
                obj.lastPlayPosition = video.currentTime;
                sendViewEvent({
                    eventName: "BUFFERING"
                });
            });

            // PAUSE
            let pauseTimeout = 0;
            video.addEventListener("pause", function (event) {
                console.log(event);
                obj.playing = false;
                obj.lastPauseTime = video.currentTime;
                var evData = {
                    eventName: "PAUSE"
                };
                pauseTimeout = setTimeout(() => {
                    sendViewEvent(evData);
                }, 100);

            });

            // SEEK
            video.addEventListener("seeked", function (event) {
                console.log(event);
                clearTimeout(pauseTimeout);
                sendViewEvent({
                    eventName: "SEEKED"
                });
            });

            // END
            video.addEventListener("ended", function (event) {
                console.log(event);
                clearTimeout(pauseTimeout);
                sendViewEvent({
                    eventName: "END"
                });
                obj.lastPauseTime = 0;
                obj.lastPlayPosition = 0;
                obj.playing = false;
                obj.buffering = false;
                obj.endView = true;
            });

            video.addEventListener("error", function (e) {
                console.log(e);
                obj.lastPlayPosition = video.currentTime;
                obj.playing = false;
                obj.buffering = false;

                let sendEv = {
                    eventName: "ERROR",
                    infos: {
                        type: "SOURCE_ERROR"
                    }
                };
                switch (e.target.error.code) {
                    case e.target.error.MEDIA_ERR_ABORTED:
                        sendEv.infos.type = "ABORTED";
                        break;
                    case e.target.error.MEDIA_ERR_NETWORK:
                        sendEv.infos.type = "NETWORK_ERROR";
                        break;
                    case e.target.error.MEDIA_ERR_DECODE:
                        sendEv.infos.type = "SOURCE_MEDIA_ERROR";
                        break;
                    case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        sendEv.infos.type = "SOURCE_MEDIA_NOT_SUPPORTED";
                        break;
                    default:
                        sendEv.infos.type = "UNKNOWN";
                        break;
                }
                sendViewEvent(sendEv);
            });

            // wait for load
            var interval = setInterval(function () {
                if (video.networkState === 3) {
                    clearInterval(interval);
                    let sendEv = {
                        eventName: "ERROR",
                        infos: {
                            type: navigator.onLine ? "SOURCE_ERROR" : "NETWORK_ERROR"
                        }
                    };
                    sendViewEvent(sendEv);
                }
            }, 500);


            // exports
            return {
                trigger: function (eventName, data) {
                    let evMsg = {
                        eventName: eventName
                    };
                    for (let a in data) {
                        evMsg.data[a] = data[a];
                    }
                    sendViewEvent(evMsg);
                }
            };
        }
    };
    // global variable
    window.SBDSA = {

        init: function (opts) {
            if (!opts.player || !opts.player.type || !opts.player.target) {
                console.log("Must init 'player' object with 'type' & 'target'.");
                return;
            }
            switch (opts.player.type) {
                case "HTML5":
                    return HTML5Adapter.init(opts);
            }

        }
    };
})(window, document);

