class Quantizer {

    constructor(width, height, fps){

        this.encoderConfig = {
            codec: "vp09.00.10.08",
            width: width,
            height: height,
            bitrateMode: "quantizer",
            framerate: fps,
            latencyMode: "realtime",
        };
        this.chunks = [];
        this.qp = 50;
        this.controller = null;

        this.handleChunk = (chunk, config) => {
            if (this.decoder && config.decoderConfig) {
                this.decoder.configure(config.decoderConfig);
            }
            this.decoder.decode(chunk); // path to decoder

            if (chunk.type == 'key') {
                this.chunks = [];
              } else {
                this.chunks.push(chunk);
                if (this.chunks.length > fps) {
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

        this.setQP(this.qp);

        this.decoder = new VideoDecoder({
            output: this.processVideo,
            error: (e) => { console.error(e.message); }
        });

    }

    // from https://docs.google.com/presentation/d/1FpCAlxvRuC0e52JrthMkx-ILklB5eHszbk8D3FIuSZ0/edit?usp=sharing
    calculateQP(qp) {
        const frames_to_consider = 4;
        const frame_budget_bytes = (this.bitrate / this.framerate) / 8;
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

        if (this.encoderConfig.codec.includes("vp09")) 
            return Math.min(Math.max(qp + qp_change, 0), 63);
        else if (this.encoderConfig.codec.includes("av01")) 
            return Math.min(Math.max(qp + qp_change, 0), 63);
        else if (this.encoderConfig.codec.includes("avc")) 
            return Math.min(Math.max(qp + qp_change, 0), 51);
    }

    setQP(qp) {
        if (this.encoderConfig.codec.includes("vp09")) {
            this.encodeOptions.vp9 = { quantizer: qp };
        } else if (this.encoderConfig.codec.includes("av01")) {
            this.encodeOptions.av1 = { quantizer: qp };
        } else if (this.encoderConfig.codec.includes("avc")) {
            this.encoderConfig.encodeOptions.avc = { quantizer: qp };
        }
    }

    processing(videoFrame, controller) {

        this.controller = controller;
        const qp = this.calculateQP(this.qp);
        this.setQP(qp);

        this.encoder.encode(videoFrame, this.encodeOptions);

        this.ploting();
    }

    ploting() {

    }


}

window.onload = async () => {

    const videoFromFile = document.getElementById('input-video');
    const videoControlled = document.getElementById('output-video');
    const startButton = document.getElementById('start-button');

    const stream = await videoFromFile.captureStream();

    const videoTrack = stream.getVideoTracks()[0];
    const processor = new MediaStreamTrackProcessor({track: videoTrack});
    const generator = new MediaStreamTrackGenerator({kind: "video"});
    const outputStream = new MediaStream();
    outputStream.addTrack(generator);
    videoControlled.srcObject = outputStream;

    startButton.onclick = () => {

        videoFromFile.play();

        console.log(videoFromFile.videoWidth);
        

        let quantizer = new Quantizer(videoFromFile.videoWidth, videoFromFile.videoHeight, videoFromFile.fps);
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