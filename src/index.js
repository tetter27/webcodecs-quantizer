class Quantizer {

    constructor(width, height, fps, plotArea){

        this.bitrate = 1000000;
        this.encoderConfig = {
            // codec: "av01.0.04M.08",
            codec: "vp09.00.10.08",
            // codec: "avc1.64001E",
            width: width,
            height: height,
            // bitrateMode: "quantizer",
            // bitrateMode: "constant",
            framerate: fps,
            //latencyMode: "realtime",
            // bitrate: this.bitrate,
        };
        this.chunks = [];
        this.qp = 30;
        this.controller = null;
        this.plotArea = plotArea;
        this.counter = 0;
        this.fps = fps;
        console.log(fps);
        this.plotSec = 0.5;
        this.bitrateSwitch = 0;

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
                if (this.chunks.length > this.ps) {
                  let _ = this.chunks.shift();
                }
              }
        };
        this.processVideo = (frame) => {
            // pass outputFrame to the next pipe
            const outputFrame = new VideoFrame(frame, {
                timestamp: frame.timestamp,
            });
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

    // from https://docs.google.com/presentation/d/1FpCAlxvRuC0e52JrthMkx-ILklB5eHszbk8D3FIuSZ0/edit?usp=sharing
    calculateQP(qp) {
        const frames_to_consider = 4;
        const frame_budget_bytes = (this.bitrate / this.fps) / 8;
        const impact_ratio = [1.0 / 8, 1.0 / 8, 1.0 / 4, 1.0 / 2];

        if (this.chunks.length < frames_to_consider) return;

        let chunks = this.chunks.slice(-frames_to_consider);
        let normalized_chunks_size = 0;
        for (let i = 0; i < frames_to_consider; i++) 
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
            this.encodeOptions.vp9 = { quantizer: this.qp };
        } else if (this.encoderConfig.codec.includes("av01")) {
            this.qp = Math.min(Math.max(qp + qp_change, 0), 63);
            this.encodeOptions.av1 = { quantizer: this.qp };
        } else if (this.encoderConfig.codec.includes("avc")) {
            this.qp = Math.min(Math.max(qp + qp_change, 0), 51);
            this.encodeOptions.avc = { quantizer: this.qp };
        }
    }

    processing(videoFrame, controller) {

        this.encodeOptions.vp9 = { quantizer: this.qp };

        this.controller = controller;
        // this.calculateQP(this.qp);

        // シナリオ1
        // if (this.counter % 2000 == 500 && this.counter) {
        //     this.bitrateSwitch = this.bitrateSwitch ? 0 : 800000;
        // }
        // this.bitrate = 1000000 - this.bitrateSwitch;

        // シナリオ2
        this.bitrate = this.bitrate + 10000;
        if (this.bitrate > 20000000) this.bitrate = 200000;

        // this.encoderConfig.bitrate = this.bitrate;
        // this.encoder.configure(this.encoderConfig);

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
        let plotRate = this.plotSec * this.fps;
        if (this.counter++ % plotRate != 0) return;

        let duration = (new Date() - this.time) / 1000;
        
        let totalBps = 0;
        for (let chunk of this.chunks.slice(-plotRate)) {
            totalBps += chunk.byteLength;
        }

        const bps = totalBps / plotRate * this.fps * 8;

        const data = {
            x: [[duration], [duration]],
            y: [[this.bitrate], [bps]],
        };
        
        Plotly.extendTraces(this.plotArea, data, [0, 1]);
    }



}

window.onload = async () => {

    const videoFromFile = document.getElementById('input-video');
    const videoControlled = document.getElementById('output-video');
    const startButton = document.getElementById('start-button');

    const stream = await videoFromFile.captureStream();

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.contentHint = "detail";
    const processor = new MediaStreamTrackProcessor({track: videoTrack});
    const generator = new MediaStreamTrackGenerator({kind: "video"});
    const outputStream = new MediaStream();
    outputStream.addTrack(generator);
    videoControlled.srcObject = outputStream;

    startButton.onclick = () => {

        videoFromFile.play();

        console.log(videoFromFile.videoWidth);
        
        const quantizer = new Quantizer(
            videoFromFile.videoWidth, 
            videoFromFile.videoHeight, 
            videoTrack.getSettings().frameRate, 
            "plot-area",
            );

        const transformer = new TransformStream({
            async transform(videoFrame, controller) {
                quantizer.processing(videoFrame, controller);
                videoFrame.close();
            }
        });

        // Connect the pipeline
        processor.readable.pipeThrough(transformer).pipeTo(generator.writable);
        videoControlled.play();

    }

};