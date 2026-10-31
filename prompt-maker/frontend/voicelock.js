/*
 * Voice lock: when on, mic audio that does not sound like the enrolled owner is replaced by silence before it is sent,
 * so the agent only hears the owner. Everything runs in this browser (voice-worker.js + voiceprint.js); the profile
 * (256 numbers, no audio) is kept in localStorage. Demo-grade, not security: see voiceprint.js.
 *
 *   VoiceLock.pass(samples)  -> false when the chunk should be muted (called for every 32 ms mic chunk)
 *   VoiceLock.enroll(onProgress) -> records ~12 s of the owner's speech and stores the profile
 */
(function () {
  "use strict";
  const SR = VoicePrint.SR, SPEECH_RMS = 0.015, CHUNK_S = 2.5, NEED_S = 12;
  const KEY = "nw-voice-profile", ON_KEY = "nw-voice-lock";
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  let worker = null, ready = null, nextId = 1;
  const waiting = new Map();
  function call(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, ...msg }, transfer || []);
    });
  }
  function load() {
    if (!ready) {
      worker = new Worker("voice-worker.js");
      worker.onmessage = ({ data }) => {
        const w = waiting.get(data.id);
        waiting.delete(data.id);
        if (w) data.ok ? w.resolve(data.emb) : w.reject(new Error(data.error));
      };
      ready = call({ type: "init", modelUrl: "models/wespeaker_resnet34.onnx" }).catch((e) => { ready = null; throw e; });
    }
    return ready;
  }
  const embedOf = async (samples) => { await load(); return call({ type: "embed", samples }, [samples.buffer]); };

  const rms = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += s[i] * s[i]; return Math.sqrt(t / s.length); };
  const join = (parts) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  const VL = {
    get profile() { try { return JSON.parse(store.get(KEY)); } catch { return null; } },
    get enabled() { return !!this.profile && store.get(ON_KEY) !== "0"; },
    setEnabled(on) { store.set(ON_KEY, on ? "1" : "0"); this.reset(); },
    clear() { store.del(KEY); this.reset(); },
    onChange: () => {},

    // live gating state
    label: "owner", parts: [], speechLen: 0, judgedLen: 0, quietChunks: 0, busy: false,
    reset() { this.label = "owner"; this.parts = []; this.speechLen = 0; this.judgedLen = 0; this.quietChunks = 0; },

    pass(samples) {
      if (!this.enabled) return true;
      if (rms(samples) > SPEECH_RMS) {
        this.quietChunks = 0;
        this.parts.push(samples.slice());
        this.speechLen += samples.length;
        if (this.speechLen - this.judgedLen >= SR * 0.8) this.judge();
      } else if (++this.quietChunks > 16) { // about 500 ms of quiet ends the utterance
        if (this.speechLen > this.judgedLen) this.judge();
        this.parts = []; this.speechLen = this.judgedLen = 0;
      }
      return this.label !== "other";
    },

    async judge() {
      if (this.busy) return;
      this.busy = true;
      const seconds = this.speechLen / SR;
      this.judgedLen = this.speechLen;
      try {
        const emb = await embedOf(join(this.parts).slice(-SR * 4)); // the last 4 s of this utterance
        const r = VoicePrint.judge(this.profile, emb, seconds, this.label);
        if (r.label !== this.label) { this.label = r.label; this.onChange(r.label); }
      } catch (e) {
        console.warn("voice lock check failed, letting audio through:", e.message);
        this.label = "owner";
      } finally { this.busy = false; }
    },

    /** Records the owner's speech with its own mic stream; onProgress(0..1). Resolves when the profile is saved. */
    async enroll(onProgress = () => {}) {
      await load();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SR, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext({ sampleRate: SR });
      try {
        await ctx.audioWorklet.addModule("audio-processors/capture.worklet.js");
        const node = new AudioWorkletNode(ctx, "audio-capture-processor");
        ctx.createMediaStreamSource(stream).connect(node);
        const chunks = [];
        let cur = [], curLen = 0, total = 0;
        await new Promise((done) => {
          node.port.onmessage = ({ data }) => {
            if (data.type !== "audio" || rms(data.data) <= SPEECH_RMS) return;
            cur.push(data.data); curLen += data.data.length; total += data.data.length;
            if (curLen >= SR * CHUNK_S) { chunks.push(join(cur)); cur = []; curLen = 0; }
            onProgress(Math.min(1, total / (SR * NEED_S)));
            if (total >= SR * NEED_S) done();
          };
        });
        const embs = [];
        for (const c of chunks) embs.push(await embedOf(c));
        const profile = VoicePrint.buildProfile(embs.filter(Boolean));
        store.set(KEY, JSON.stringify(profile));
        store.set(ON_KEY, "1");
        this.reset();
        return profile;
      } finally {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      }
    },
  };
  window.VoiceLock = VL;
})();
