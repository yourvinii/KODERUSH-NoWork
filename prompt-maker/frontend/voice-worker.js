/*
 * Runs the speaker model off the main thread, so a voice check never freezes the page or delays the microphone.
 * Messages in:  { id, type: "init", modelUrl }  |  { id, type: "embed", samples: Float32Array (16 kHz) }
 * Messages out: { id, ok: true, emb? }  |  { id, ok: false, error }
 */
const ORT_VERSION = "1.27.0"; // pinned; onnxruntime-web is loaded from a CDN, the model itself is served by this app
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

importScripts("voiceprint.js", `${ORT_BASE}ort.min.js`);

let runner = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1; // multi-threading needs cross-origin isolation, which this app does not use
      const session = await ort.InferenceSession.create(data.modelUrl, { executionProviders: ["wasm"] });
      runner = VoicePrint.makeRunner(ort, session);
      self.postMessage({ id: data.id, ok: true });
    } else if (data.type === "embed") {
      if (!runner) throw new Error("model not loaded");
      const emb = await VoicePrint.embed(runner, data.samples);
      self.postMessage({ id: data.id, ok: true, emb }, emb ? [emb.buffer] : []);
    }
  } catch (e) {
    self.postMessage({ id: data.id, ok: false, error: String((e && e.message) || e) });
  }
};
