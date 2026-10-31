/*
 * Measures how loud the agent's voice is right now, from the real playback audio. The page uses it to know when the
 * agent has actually stopped talking: audio chunks arrive faster than they play, so "no chunk lately" is not enough.
 * Polled with setInterval, not requestAnimationFrame, because animation frames stop in background tabs.
 */
(function () {
  window.VoiceLevel = class VoiceLevel {
    constructor() {
      this.analyser = null;
      this.data = null;
      this.timer = 0;
      this.onLevel = null; // (level 0..1) => void, called about 16 times a second while running
    }

    attach(audioContext, source) {
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.data = new Uint8Array(this.analyser.fftSize);
      source.connect(this.analyser); // extra tap only; playback still goes straight to the speakers
    }

    start() {
      if (!this.timer) this.timer = setInterval(() => this.onLevel?.(this.read()), 60);
    }

    stop() {
      clearInterval(this.timer);
      this.timer = 0;
      this.analyser = null;
    }

    /** RMS of the current waveform: 0 for silence, roughly 0.05 to 0.3 for speech. */
    read() {
      if (!this.analyser) return 0;
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (const v of this.data) sum += ((v - 128) / 128) ** 2;
      return Math.sqrt(sum / this.data.length);
    }
  };
})();
