// Runs the free Whisper speech model in a background thread so the Studio
// never freezes while it listens. Everything (code, engine, model) is served
// from this site — no outside servers, so nothing can be blocked.
//   in:  { audio: Float32Array (16 kHz mono), language: 'english' | 'spanish' }
//   out: { type: 'progress', stage, pct, mb, device } | { type: 'result', text, chunks, segmentsOnly } | { type: 'error', message }

const VENDOR = '/vendor/transformers-3.0.2/';
const MODEL = 'whisper-base'; // multilingual: English, Spanish (incl. Latin American), Spanglish…

let asrPromise = null;
let lastReport = 0;

function loadModel() {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import(`${VENDOR}transformers.min.js`);
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = '/vendor/models/';
      env.backends.onnx.wasm.wasmPaths = VENDOR;
      return pipeline('automatic-speech-recognition', MODEL, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (p) => {
          // Report the big model files only, at most ~4 times a second.
          if (p.status !== 'progress' || !/\.onnx/.test(p.file || '')) return;
          const now = Date.now();
          if (now - lastReport < 250 && p.progress < 100) return;
          lastReport = now;
          self.postMessage({ type: 'progress', stage: 'download', pct: Number(p.total) ? Math.round(p.progress || 0) : null, mb: Math.round((Number(p.loaded) || 0) / 1048576) });
        },
      });
    })().catch((error) => {
      asrPromise = null;
      throw error;
    });
  }
  return asrPromise;
}

self.onmessage = async ({ data }) => {
  try {
    const asr = await loadModel();
    self.postMessage({ type: 'progress', stage: 'listen', device: 'wasm' });
    const options = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', language: data.language === 'spanish' ? 'spanish' : 'english' };
    let out;
    let segmentsOnly = false;
    try {
      out = await asr(data.audio, { ...options, return_timestamps: 'word' });
    } catch {
      out = await asr(data.audio, { ...options, return_timestamps: true }); // sentence-level timing
      segmentsOnly = true;
    }
    self.postMessage({ type: 'result', text: out.text || '', chunks: out.chunks || [], segmentsOnly });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
