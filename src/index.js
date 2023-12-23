class Quantizer {

    constructor(width, height, fps, plotArea, userOptions) {
        this.bitrate = 1000000;
        this.qp = 30;
        this.encoderConfig = {
            codec: userOptions.codec,
            width: width,
            height: height,
            bitrateMode: userOptions.mode,
            framerate: fps,
            bitrate: this.bitrate,
        };

        // Bitrate select mode
        if (userOptions.bitrateFromSlider) {
            this.bitrate = userOptions.bitrateFromSlider * 1000;
        }
        // QP select mode
        if (userOptions.qpFromSlider) {
            // HACK: depend on plotly.js
            this.bitrate = null;
            this.qp = userOptions.qpFromSlider;
        }

        this.scenario = userOptions.scenario;
        this.chunks = [];
        this.controller = null;
        this.plotArea = plotArea;
        this.counter = 0;
        this.fps = fps;
        this.plotInterval = 0.5;
        this.plotRate = this.plotInterval * this.fps;
        this.bitrateSwitch = 0;

        // Image from encorder
        this.handleChunk = (chunk, config) => {
            if (config.decoderConfig && this.decoder.state === "unconfigured") {
                config.decoderConfig.optimizeForLatency = true;
                this.decoder.configure(config.decoderConfig);
            }
            this.decoder.decode(chunk); // path to decoder

            if (chunk.type == 'key') {
                this.chunks = [];
            } else {
                this.chunks.push(chunk);
                if (this.chunks.length > this.fps) {
                    this.chunks.shift();
                }
            }
        };

        // Image from decoder
        this.processVideo = (frame) => {
            const outputFrame = new VideoFrame(frame, {
                timestamp: frame.timestamp,
            });
            // pass outputFrame to the next pipe
            this.controller.enqueue(outputFrame);
            frame.close();
        }

        this.encoder = new VideoEncoder({
            output: this.handleChunk,
            error: (e) => { console.error(e.message); }
        });
        
        this.encoder.configure(this.encoderConfig);
        this.encodeOptions = { keyFrame: false };

        this.decoder = new VideoDecoder({
            output: this.processVideo,
            error: (e) => { console.error(e.message); }
        });

        this.time = new Date();

        this.initPlot();
    }

    // From https://docs.google.com/presentation/d/1FpCAlxvRuC0e52JrthMkx-ILklB5eHszbk8D3FIuSZ0/edit?usp=sharing
    calculateQP(qp) {
        const frames_to_consider = 4;
        const frame_budget_bytes = (this.bitrate / this.fps) / 8;
        const impact_ratio = [1.0 / 8, 1.0 / 8, 1.0 / 4, 1.0 / 2];

        if (this.chunks.length < frames_to_consider) return;

        let chunks = this.chunks.slice(-frames_to_consider);
        let normalized_chunks_size = 0;
        for (let i = 0; i < frames_to_consider; ++i) 
            normalized_chunks_size += chunks[i].byteLength * impact_ratio[i];
        
        const diff_bytes = normalized_chunks_size - frame_budget_bytes;
        const diff_ratio = diff_bytes / frame_budget_bytes;

        let qp_change = 0;
        // Addressing overshoot more aggressively that undershoot
        // Don't change QP too much when it's already low, because ti
        // changes chunk size to drastically.
        if (diff_ratio > 0.6 && qp > 15) {
            qp_change = 3;
        } else if (diff_ratio > 0.25 && qp > 5) {
            qp_change = 2;
        } else if (diff_ratio > 0.04) {
            //Overshoot by more than 4%
            qp_change = 1;
        } else if (diff_ratio < (qp < 10 ? -0.10 : -0.04)) {
            // Undershoot by more than 4% (or 10% if QP is already low)
            qp_change = -1;
        }

       console.log("qp: " + qp + " qp_change: " + qp_change + " diff_ratio: " + diff_ratio);

       if (this.encoderConfig.codec.includes("vp09")) {
            this.qp = Math.min(Math.max(qp + qp_change, 0), 63);
        } else if (this.encoderConfig.codec.includes("av01")) {
            this.qp = Math.min(Math.max(qp + qp_change, 0), 63);
        } else if (this.encoderConfig.codec.includes("avc")) {
            this.qp = Math.min(Math.max(qp + qp_change, 0), 51);
        }
    }

    setQp() {
        if (this.encoderConfig.codec.includes("vp09")) {
            this.encodeOptions.vp9 = { quantizer: this.qp };
        } else if (this.encoderConfig.codec.includes("av01")) {
            this.encodeOptions.av1 = { quantizer: this.qp };
        } else if (this.encoderConfig.codec.includes("avc")) {
            this.encodeOptions.avc = { quantizer: this.qp };
        }
    }

    processing(videoFrame, controller, currentBitrate, currentQp) {
        if (!this.controller) this.controller = controller;

        // Bitrate control
        //   Scenario 1
        if (this.scenario == "scenario1") {
            if (this.counter % 2000 == 500 && this.counter) this.bitrateSwitch = this.bitrateSwitch ? 0 : 800000;
            this.bitrate = 1000000 - this.bitrateSwitch;
        //   Scenario 2
        } else if (this.scenario == "scenario2") { 
            this.bitrate = this.bitrate + 10000;
            if (this.bitrate > 20000000) this.bitrate = 200000;
        //   User control scenario
        } else if (this.scenario == "userControl") {
            this.bitrate = currentBitrate * 1000;
        }

        // Mode
        //  Constant mode
        if (this.encoderConfig.bitrateMode == "constant") {
            this.encoderConfig.bitrate = this.bitrate;
            this.encoder.configure(this.encoderConfig);
        //  Quantizer mode (Auto QP)
        } else if (!currentQp) {
            this.calculateQP(this.qp);
            this.setQp();
        //  User control mode
        } else {
            this.qp = currentQp;
            this.setQp();
        }
        
        this.encoder.encode(videoFrame, this.encodeOptions);

        this.ploting();
    }

    initPlot() {
        const layout = {
            autosize: true,
        }

        const duration = 0;
        const bitrateAimed = {
            name: '目標のビットレート',
            x: [duration],
            y: [this.bitrate],            
        };

        const bitrateActual = {
            name: '実際のビットレート',
            x: [duration],
            y: [0],
        };

        const data = [bitrateAimed, bitrateActual];

        Plotly.newPlot(this.plotArea, data, layout);
    }

    ploting() {
        if (++this.counter % this.plotRate != 0) return;

        let duration = (new Date() - this.time) / 1000;
        
        let totalBps = 0;
        for (let chunk of this.chunks.slice(-this.plotRate)) {
            totalBps += chunk.byteLength;
        }

        const bps = totalBps / this.plotRate * this.fps * 8;

        const data = {
            x: [[duration], [duration]],
            y: [[this.bitrate], [bps]],
        };
        
        Plotly.extendTraces(this.plotArea, data, [0, 1]);
    }
}

(async function () {
    const inputVideo = document.getElementById('input-video');
    const videoControlled = document.getElementById('output-video');
    const startButton = document.getElementById('start-button');
    const fileButton = document.getElementById('file-button');
    const cameraButton = document.getElementById('camera-button');
    const quantizerButton = document.getElementById('quantizer-button');
    const constantButton = document.getElementById('constant-button');
    const qpButton = document.getElementById('qp-button');
    const av1Button = document.getElementById('av1-button');
    const vp9Button = document.getElementById('vp9-button');
    const avcButton = document.getElementById('avc-button');
    const scenario1Button = document.getElementById('scenario1-button');
    const scenario2Button = document.getElementById('scenario2-button');
    const userControlButton = document.getElementById('user-control-button');
    const brSliderValue = document.getElementById('br-slider-value');
    const brSlider = document.getElementById('br-slider');
    const qpSliderValue = document.getElementById('qp-slider-value');
    const qpSlider = document.getElementById('qp-slider');
    const modeSelectArea = document.getElementById('mode-select-area');
    const codecSelectArea = document.getElementById('codec-select-area');
    const scenarioSelectArea = document.getElementById('scenario-select-area');
    const brAdjastArea = document.getElementById('br-adjast-area');
    const qpAdjastArea = document.getElementById('qp-adjast-area');
    const startButtonArea = document.getElementById('start-button-area');
    const inputVideoArea = document.getElementById('input-video-area');
    const outputVideoArea = document.getElementById('output-video-area');

    let stream;
    let userOptions = {
        mode: null,
        codec: null,
        scenario: null,
        bitrateFromSlider: null,
        qpFromSlider: null,
    };

    const selectButton = (selectedButton, next, otherButton1=null, otherButton2=null) => {
        selectedButton.className = "selected";
        selectedButton.disabled = true;
        next.style.display = "block";
        if (otherButton1) otherButton1.disabled = true;
        if (otherButton2) otherButton2.disabled = true;
    };

    // video source select
    fileButton.addEventListener("click", async function () {
        selectButton(this, codecSelectArea, cameraButton);
        inputVideoArea.style.display = "block";
        outputVideoArea.style.display = "block";

        stream = await inputVideo.captureStream();
    });

    cameraButton.addEventListener("click", async function () {
        selectButton(this, codecSelectArea, fileButton);        
        
        stream = await navigator.mediaDevices.getUserMedia({video: true});
        inputVideo.srcObject = stream;
        inputVideo.play();

        inputVideoArea.style.display = "block";
        outputVideoArea.style.display = "block";
    });

    // codec select
    av1Button.addEventListener("click", function () {
        selectButton(this, modeSelectArea, vp9Button, avcButton);
        userOptions.codec = "av01.0.08M.08";
    });

    vp9Button.addEventListener("click", function () {
        selectButton(this, modeSelectArea, av1Button, avcButton);
        userOptions.codec = "vp09.00.20.08";
    });

    avcButton.addEventListener("click", function () {
        selectButton(this, modeSelectArea, vp9Button, av1Button);
        userOptions.codec = "avc1.64001F";
    });

    // mode select
    quantizerButton.addEventListener("click", function () {
        selectButton(this, scenarioSelectArea, constantButton, qpButton);
        userOptions.mode = "quantizer";
    });

    constantButton.addEventListener("click", function () {
        selectButton(this, scenarioSelectArea, quantizerButton, qpButton);
        userOptions.mode = "constant";
    });

    qpButton.addEventListener("click", function () {
        selectButton(this, startButtonArea, quantizerButton, constantButton);
        userOptions.mode = "quantizer";

        userOptions.qpFromSlider = 30;
        qpAdjastArea.style.display = "block";

        if (userOptions.codec.includes("avc")) qpSlider.max = "51";
        qpSlider.addEventListener("input", function () {
            qpSliderValue.innerHTML = this.value;
            userOptions.qpFromSlider = this.value;
        })
    });

    // scenario select
    scenario1Button.addEventListener("click", function () {
        selectButton(this, startButtonArea, scenario2Button, userControlButton);
        userOptions.scenario = "scenario1";
    });

    scenario2Button.addEventListener("click", function () {
        selectButton(this, startButtonArea, scenario1Button, userControlButton);
        userOptions.scenario = "scenario2";
    });

    userControlButton.addEventListener("click", function () {
        selectButton(this, startButtonArea, scenario1Button, scenario2Button);
        userOptions.scenario = "userControl";

        userOptions.bitrateFromSlider = 1000;
        brAdjastArea.style.display = "block";
        brSlider.addEventListener("input", function () {
            if (this.value < 1000) brSliderValue.innerHTML = this.value + "kbps";
            else brSliderValue.innerHTML = this.value / 1000 + "Mbps";
            
            userOptions.bitrateFromSlider = this.value;
        })
    });

    // start
    startButton.onclick = () => {
        startButton.disabled = true;
        inputVideo.play();

        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.contentHint = "detail";
        const processor = new MediaStreamTrackProcessor({track: videoTrack});
        const generator = new MediaStreamTrackGenerator({kind: "video"});
        const outputStream = new MediaStream();
        outputStream.addTrack(generator);
        videoControlled.srcObject = outputStream;

        console.log("width: " + inputVideo.videoWidth);
        console.log("height: " + inputVideo.videoHeight);
        console.log("fps: " + videoTrack.getSettings().frameRate);
        
        const quantizer = new Quantizer(
            inputVideo.videoWidth, 
            inputVideo.videoHeight, 
            videoTrack.getSettings().frameRate, 
            "plot-area",
            userOptions
            );

        // Main loop
        const transformer = new TransformStream({
            async transform(videoFrame, controller) {
                quantizer.processing(videoFrame, controller, userOptions.bitrateFromSlider, userOptions.qpFromSlider);
                videoFrame.close();
            }
        });

        // Connect the pipeline
        processor.readable.pipeThrough(transformer).pipeTo(generator.writable);
        videoControlled.play();
    };
})();