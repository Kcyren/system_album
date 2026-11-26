// Free, private auto-lyrics: a Whisper speech model runs inside the browser
// (Transformers.js). Nothing is uploaded anywhere and there is no API key.
// The model (~80 MB) downloads the first time and is cached afterwards.

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const MODEL = 'Xenova/whisper-base.en';

let asrPromise = null;

function loadModel(onProgress) {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import(LIB);
      env.allowLocalModels = false;
      return pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total > 2e6) onProgress?.({ stage: 'download', pct: Math.round(p.progress || 0) });
        },
      });
    })().catch((error) => {
      asrPromise = null;
      throw error;
    });
  }
  return asrPromise;
}

// Whisper needs mono audio at 16 kHz.
async function decode16k(source) {
  const buffer = source instanceof Blob ? await source.arrayBuffer() : await fetch(source).then((r) => r.arrayBuffer());
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(buffer);
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c += 1) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / audio.numberOfChannels;
  }
  return mono;
}

// Listens to the recording. Returns { text, words: [{ text, start, end }], duration }.
export async function transcribe(source, onProgress) {
  const asr = await loadModel(onProgress);
  onProgress?.({ stage: 'decode' });
  const audio = await decode16k(source);
  const duration = audio.length / 16000;
  onProgress?.({ stage: 'listen', seconds: duration });
  const options = { chunk_length_s: 30, stride_length_s: 5 };
  let out;
  let segmentsOnly = false;
  try {
    out = await asr(audio, { ...options, return_timestamps: 'word' });
  } catch {
    out = await asr(audio, { ...options, return_timestamps: true }); // sentence-level fallback
    segmentsOnly = true;
  }
  const words = [];
  for (const chunk of out.chunks || []) {
    const [start, endRaw] = chunk.timestamp || [];
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(endRaw) ? endRaw : start + 0.4;
    const parts = chunk.text.trim().split(/\s+/).filter(Boolean);
    if (!segmentsOnly) {
      if (parts.length) words.push({ text: chunk.text.trim(), start, end });
    } else {
      parts.forEach((text, i) => words.push({ text, start: start + ((end - start) * i) / parts.length, end }));
    }
  }
  return { text: (out.text || '').trim(), words, duration };
}

// ------------------------------------------------------------- alignment
const norm = (w) => String(w).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

// Rap is fast and slangy, so words count as "the same" when they're close.
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const long = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (long < 4) return false;
  return editDistance(a, b) <= (long >= 7 ? 2 : 1);
}

// Lines up the written lyrics with the heard words.
// Returns { timing: [seconds|null per line], matched, total }.
export function alignLines(lines, words, duration) {
  const lyricWords = [];
  lines.forEach((line, i) => line.split(/\s+/).map(norm).filter(Boolean).forEach((w, k) => lyricWords.push({ w, line: i, k })));
  const heard = words.map((x) => ({ w: norm(x.text), t: x.start })).filter((x) => x.w);
  const n = lyricWords.length;
  const m = heard.length;
  const timing = lines.map(() => null);
  if (!n || !m) return { timing, matched: 0, total: lines.filter((l) => l.trim()).length };

  // Longest common subsequence with fuzzy word matching (keeps everything in order).
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i * W + j] = similar(lyricWords[i - 1].w, heard[j - 1].w)
        ? dp[(i - 1) * W + j - 1] + 1
        : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
    }
  }
  const pairs = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (similar(lyricWords[i - 1].w, heard[j - 1].w) && dp[i * W + j] === dp[(i - 1) * W + j - 1] + 1) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) i -= 1;
    else j -= 1;
  }
  pairs.reverse();

  // Each line starts at its first matched word (nudged back if that wasn't the first word).
  for (const [li, hi] of pairs) {
    const { line, k } = lyricWords[li];
    if (timing[line] === null) timing[line] = Math.max(0, heard[hi].t - k * 0.25);
  }
  const lineHasText = lines.map((l) => Boolean(l.trim()));
  const matched = timing.filter((t, i) => t !== null && lineHasText[i]).length;

  // Fill in lines that weren't heard clearly: share the time between the
  // matched lines around them, longer lines getting more time.
  const weight = lines.map((l) => (l.trim() ? l.trim().split(/s+/).length : 0));
  const end = Number.isFinite(duration) ? duration : (words[words.length - 1]?.end || 0) + 2;
  let i = 0;
  while (i < lines.length) {
    if (!lineHasText[i] || timing[i] !== null) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && (timing[j] === null || !lineHasText[j])) j += 1;
    let p = i - 1;
    while (p >= 0 && timing[p] === null) p -= 1;
    const to = j < lines.length ? timing[j] : end;
    const prevWeight = p >= 0 ? weight[p] : 0;
    const from = p >= 0 ? timing[p] : Math.max(0, to - 2.5 * weight.slice(i, j).filter(Boolean).length);
    const total = prevWeight + weight.slice(i, j).reduce((x, y) => x + y, 0);
    let t = from + ((to - from) * prevWeight) / Math.max(1, total);
    for (let x = i; x < j; x += 1) {
      if (!weight[x]) continue;
      timing[x] = t;
      t += ((to - from) * weight[x]) / Math.max(1, total);
    }
    i = j;
  }

  // Keep times in order and round them.
  let last = -1;
  for (let x = 0; x < timing.length; x += 1) {
    if (!lineHasText[x]) timing[x] = null;
    else {
      timing[x] = Math.round(Math.max(timing[x], last + 0.3) * 100) / 100;
      last = timing[x];
    }
  }
  return { timing, matched, total: lineHasText.filter(Boolean).length };
}

// Turns heard words into lyric lines (a new line at each sentence end, pause, or every ~10 words).
export function wordsToLines(words) {
  const lines = [];
  const timing = [];
  let current = [];
  let start = null;
  words.forEach((word, i) => {
    const gap = i > 0 ? word.start - (words[i - 1].end ?? words[i - 1].start) : 0;
    const sentenceEnded = i > 0 && /[.!?]$/.test(words[i - 1].text.trim());
    if (current.length && (sentenceEnded || gap > 0.7 || current.length >= 10)) {
      lines.push(current.join(' '));
      timing.push(Math.round(start * 100) / 100);
      current = [];
    }
    if (!current.length) start = word.start;
    current.push(word.text.trim());
  });
  if (current.length) {
    lines.push(current.join(' '));
    timing.push(Math.round(start * 100) / 100);
  }
  return { lines, timing };
}
