(function (window, document) {

    // init library once
    if (window.SBDSA)
        return;
    ////////////////////////////////////////////
    let os, browser, device;
    //////////////////////////////////////////
    var session, createWS = function () {
        wsReady = false;
        ws = new WebSocket("ws://ws.sa.sbd.vn:10080");
        ws.onopen = function () {
            wsReady = true;
            console.log("[ WS ] Connected!");
            send({
                type: "initWS",
                session: session,
                data: {
                    os: os,
                    browser: browser,
                    device: device
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
            if (!opts.player.target) {
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
                loadInfo: [],
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
                workerInterval: 0
            };
            mapping[obj.localId] = obj;
            let initView = function () {
                send({
                    type: "initView",
                    data: {
                        envKey: opts.envKey,
                        viewerId: opts.viewerId,
                        playUrl: video.currentSrc,
                        video: opts.video
                    },
                    callback: function (resp) {
                        console.log(resp);
                        if (resp.status === "OK") {
                            obj.viewId = resp.data[0].id;
                            if (!obj.loaded) {
                                obj.loaded = true;
                                send({
                                    type: "event",
                                    data: {
                                        viewId: obj.viewId,
                                        eventName: "PLAYER_LOAD",
                                    }
                                });
                            }
                        }
                    }
                });
            };

            initView();
            tracked.push(obj);
            console.log("[SaoBacDau SA] Start to track video", video);

            // listen events
            video.addEventListener("loadeddata", function (event) {
                obj.loadInfo.push({
                    loaded: 0,
                    time: Date.now()
                });
            });
            video.addEventListener("progress", function (event) {
                console.log(event);
                try {
                    video.buffered.end(0);
                } catch (e) {
                    // invalid
                    return;
                }

                let rate = video.buffered.end(0) / video.duration;
                if (obj.loadInfo.length > 0) {
                    rate -= obj.loadInfo[obj.loadInfo.length - 1].loaded;
                }
                obj.loadInfo.push({
                    loaded: video.buffered.end(0) / video.duration,
                    time: Date.now()
                });
//                sendEvent({
//                    viewId: obj.viewId,
//                    eventName: "LOAD_RATE",
//                    data: rate,
//                    playPosition: video.currentTime
//                });
                obj.loadComplete = (video.buffered.end(0) >= video.duration);
            });
            video.addEventListener("waiting", function (event) {
                console.log(event);
                obj.buffering = true;
                obj.lastBuffering = Date.now();
                obj.lastPlayPosition = video.currentTime;
                send({
                    type: "event",
                    data: {
                        viewId: obj.viewId,
                        eventName: "BUFFERING",
                        playPosition: video.currentTime
                    }
                });
                obj.workerInterval = setInterval(bufferWorker, 5);
            });
            video.addEventListener("play", function (event) {
                console.log(event);
                if (obj.lastPauseTime > 0 && video.currentTime > 0 && !obj.playing) {
                    send({
                        type: "event",
                        data: {
                            viewId: obj.viewId,
                            eventName: "UNPAUSE",
                            playPosition: obj.lastPauseTime
                        }
                    });
                }
                obj.playing = true;
                obj.buffering = false;
                obj.lastActive = Date.now();

                if (obj.lastPlayPosition === 0) {
                    obj.workerInterval = setInterval(startupWorker, 5);
                }
            });

            let pauseTimeout = 0;
            video.addEventListener("pause", function (event) {
                console.log(event);
                obj.playing = false;
                obj.lastPauseTime = video.currentTime;
                pauseTimeout = setTimeout(function () {
                    send({
                        type: "event",
                        data: {
                            viewId: obj.viewId,
                            eventName: "PAUSE",
                            playPosition: obj.lastPauseTime
                        }
                    });
                }, 50);

                clearInterval(obj.workerInterval);
            });
            video.addEventListener("ended", function (event) {
                console.log(event);
                clearTimeout(pauseTimeout);
                send({
                    type: "event",
                    data: {
                        viewId: obj.viewId,
                        eventName: "END"
                    }
                });

                obj.lastPlayPosition = 0;
                obj.playing = false;
                obj.buffering = false;
                obj.viewId = null;
                obj.endView = true;


            });
            video.addEventListener("error", function (event) {
                obj.lastPlayPosition = video.currentTime;
                obj.playing = false;
                obj.buffering = false;
                send({
                    type: "event",
                    data: {
                        viewId: obj.viewId,
                        eventName: "ERROR",
                        playPosition: video.currentTime
                    }
                });
            });

            let startupWorker = function () {
                if (video.currentTime > obj.lastPlayPosition) {
                    if (obj.lastPlayPosition == 0){
						if (obj.viewId){
							send({
								type: "event",
								data: {
									viewId: obj.viewId,
									eventName: "PLAY",
									data: (Date.now() - obj.lastActive) / 1000.0,
									playPosition: 0
								}
							});
						} else {
							send({
								type: "initView",
								data: {
									envKey: opts.envKey,
									viewerId: opts.viewerId,
									playUrl: video.currentSrc,
									video: opts.video
								},
								callback: function(resp){
									if (resp.status === "OK") {
										obj.viewId = resp.data[0].id;
										send({
											type: "event",
											data: {
												viewId: obj.viewId,
												eventName: "RESUME",
												data: (Date.now() - obj.lastBuffering) / 1000.0,
												playPosition: video.currentTime
											}
										});
									}
								}
							});
						}
					}
                    clearInterval(obj.workerInterval);
                    obj.lastPlayPosition = video.currentTime;
                }
            };

            let bufferWorker = function () {
				if (obj.endView)
					clearInterval(obj.workerInterval);
                if (video.currentTime > obj.lastPlayPosition) {
                    if (obj.playing && obj.lastBuffering && Date.now() - obj.lastBuffering > 100) {
						obj.lastBuffering = 0;
						if (!obj.viewId){
							return;
						}
                        send({
                            type: "event",
                            data: {
                                viewId: obj.viewId,
                                eventName: "RESUME",
                                data: (Date.now() - obj.lastBuffering) / 1000.0,
                                playPosition: video.currentTime
                            }
                        });
                        
                    }
                    
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
                    HTML5Adapter.init(opts);
                    break;
            }

        }
    };
})(window, document);

