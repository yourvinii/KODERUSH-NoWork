/*
 * Voice lock, the maths. Plain JavaScript; the heavy part is a small speaker-embedding model that runs in this browser,
 * so no audio and no voice data ever leaves the page.
 *
 *   speech (16 kHz mono)  ->  80-band filterbank features  ->  WeSpeaker ResNet34 (ONNX)  ->  256 numbers
 *
 * The 256 numbers describe who is speaking, not what is said. Two utterances by the same person land close together
 * (cosine similarity near 1), different people land far apart. A profile is the average embedding of the owner's
 * enrolment speech plus an accept threshold.
 *
 * What this is NOT: biometric security. Similar voices, impressionists, recordings and a very different microphone can
 * fool it. Use it for a demo-grade "this is probably the owner", never to protect anything that matters.
 */
(function (root) {
  "use strict";

  const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 80, LOW = 20, HIGH = 8000;
  const EMB = 256;
  const MIN_SECONDS = 1.0; // below this much speech nothing is judged
  const FULL_SECONDS = 1.8; // from here a score is trusted; between MIN and FULL only a clear result counts
  const HI_FLOOR = 0.45, HI_CEIL = 0.58; // the owner threshold always lands inside this range
  const GAP = 0.08; // below (threshold - GAP) is a clear "someone else"; in between is "not sure"
  const STRICTNESS = { relaxed: -0.06, normal: 0, strict: 0.06 };

  /* ---------- Kaldi-compatible log-mel filterbank (the features the model was trained on) ---------- */
  const hamming = Float32Array.from({ length: WIN }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const cosT = Float32Array.from({ length: NFFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / NFFT));
  const sinT = Float32Array.from({ length: NFFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / NFFT));
  const rev = Uint16Array.from({ length: NFFT }, (_, i) => {
    let r = 0;
    for (let b = 0, v = i; b < Math.log2(NFFT); b++, v >>= 1) r = (r << 1) | (v & 1);
    return r;
  });
  const kmel = (f) => 1127 * Math.log(1 + f / 700);
  const bank = (() => {
    const lo = kmel(LOW), hi = kmel(HIGH), step = (hi - lo) / (NMEL + 1);
    return Array.from({ length: NMEL }, (_, b) => {
      const left = lo + b * step, center = left + step, right = center + step;
      const w = new Float32Array(NFFT / 2); // bins 0..255; Kaldi leaves the Nyquist bin out
      for (let i = 0; i < NFFT / 2; i++) {
        const m = kmel((SR / NFFT) * i);
        if (m > left && m < right) w[i] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
      }
      return w;
    });
  })();

  function fft(re, im) {
    for (let i = 0; i < NFFT; i++) {
      const j = rev[i];
      if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let size = 2; size <= NFFT; size <<= 1) {
      const half = size >> 1, step = NFFT / size;
      for (let start = 0; start < NFFT; start += size) {
        for (let k = 0; k < half; k++) {
          const c = cosT[k * step], s = sinT[k * step], a = start + k, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  /** x: Float32 samples in [-1, 1] at 16 kHz. Returns { data: Float32Array(frames * 80), frames }. */
  function fbank(x) {
    const frames = Math.floor((x.length - WIN) / HOP) + 1;
    if (frames < 1) return { data: new Float32Array(0), frames: 0 };
    const data = new Float32Array(frames * NMEL), re = new Float32Array(NFFT), im = new Float32Array(NFFT), frame = new Float32Array(WIN);
    for (let f = 0; f < frames; f++) {
      let mean = 0;
      for (let i = 0; i < WIN; i++) { frame[i] = x[f * HOP + i] * 32768; mean += frame[i]; }
      mean /= WIN;
      for (let i = 0; i < WIN; i++) frame[i] -= mean; // remove DC offset
      for (let i = WIN - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1]; // pre-emphasis
      frame[0] -= 0.97 * frame[0];
      for (let i = 0; i < WIN; i++) re[i] = frame[i] * hamming[i];
      re.fill(0, WIN); im.fill(0);
      fft(re, im);
      const power = new Float32Array(NFFT / 2);
      for (let k = 0; k < NFFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
      for (let m = 0; m < NMEL; m++) {
        let s = 0;
        const w = bank[m];
        for (let k = 0; k < NFFT / 2; k++) s += w[k] * power[k];
        data[f * NMEL + m] = Math.log(Math.max(s, 1.1920929e-7));
      }
    }
    for (let m = 0; m < NMEL; m++) { // subtract each band's mean over the utterance, as the model expects
      let s = 0;
      for (let f = 0; f < frames; f++) s += data[f * NMEL + m];
      s /= frames;
      for (let f = 0; f < frames; f++) data[f * NMEL + m] -= s;
    }
    return { data, frames };
  }

  /* ---------- embeddings ---------- */
  const normalise = (v) => {
    let n = 0;
    for (const a of v) n += a * a;
    n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (a) => a / n);
  };
  const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }; // both unit length

  /**
   * runner(data, frames) -> Promise<ArrayLike> runs the ONNX model (see makeRunner). Returns a unit-length embedding,
   * or null if there is not enough audio.
   */
  async function embed(runner, samples) {
    if (samples.length < SR * MIN_SECONDS) return null;
    const { data, frames } = fbank(samples);
    return normalise(await runner(data, frames));
  }

  /** Wraps an onnxruntime session (node or web) as a runner. */
  const makeRunner = (ort, session) => async (data, frames) => (await session.run({ feats: new ort.Tensor("float32", data, [1, frames, NMEL]) })).embs.data;

  /* ---------- profile ---------- */
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const centroidOf = (embs) => normalise(embs[0].map((_, i) => mean(embs.map((e) => e[i]))));

  /**
   * embs: unit embeddings of the owner's enrolment chunks (at least 3). The threshold comes from the owner's own
   * variation: each chunk is scored against the centroid of the others, and the base threshold sits 0.15 below the
   * lowest of those scores, kept inside [HI_FLOOR, HI_CEIL].
   */
  function buildProfile(embs, strictness = "normal") {
    if (embs.length < 3) throw new Error("Need at least 3 voice samples to build a profile");
    const own = embs.map((e, i) => cosine(e, centroidOf(embs.filter((_, j) => j !== i))));
    const lowest = Math.min(...own);
    return { v: 3, centroid: Array.from(centroidOf(embs)), base: Math.min(HI_CEIL, Math.max(HI_FLOOR, lowest - 0.15)), strictness, own: { mean: mean(own), min: lowest }, samples: embs.length };
  }

  /** The owner threshold after applying the strictness setting. */
  const thresholdOf = (profile) => profile.base + (STRICTNESS[profile.strictness] ?? 0);

  /** Raw similarity of an utterance embedding to the owner (about 0.7+ same person, under 0.4 someone else). */
  function score(profile, emb) {
    return cosine(emb, Float32Array.from(profile.centroid));
  }

  /**
   * Decide who is speaking: "owner", "other", or the previous label when it is not clear.
   * seconds = how much speech the utterance had. Short speech is only trusted when the result is clear-cut.
   */
  function judge(profile, emb, seconds, previous) {
    if (!emb || seconds < MIN_SECONDS) return { label: previous, score: null, decisive: false };
    const s = score(profile, emb), hi = thresholdOf(profile), lo = hi - GAP;
    const short = seconds < FULL_SECONDS;
    const ownerAt = short ? hi + 0.05 : hi, otherAt = short ? lo - 0.07 : lo;
    const label = s >= ownerAt ? "owner" : s <= otherAt ? "other" : previous;
    return { label, score: s, decisive: label !== previous || s >= ownerAt || s <= otherAt };
  }

  const api = { fbank, embed, makeRunner, cosine, buildProfile, thresholdOf, score, judge, normalise, centroidOf, SR, MIN_SECONDS, FULL_SECONDS, EMB, NMEL, STRICTNESS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VoicePrint = api;
})(typeof window !== "undefined" ? window : globalThis);
