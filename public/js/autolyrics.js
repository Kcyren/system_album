// Free, private auto-lyrics: a Whisper speech model runs inside the browser
// (Transformers.js). Nothing is uploaded anywhere and there is no API key.
// The model (~80 MB) downloads the first time and is cached afterwards.

// The model runs in a background worker (asr-worker.js), so the page never freezes.

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker('/js/asr-worker.js', { type: 'module' });
  return worker;
}

// Whisper needs mono audio at 16 kHz.
// Also cuts the heavy bass and lifts the voice range, so the words stand out
// from the beat (this more than doubles what the listening tool can hear in rap).
const audioCache = new Map();
async function decode16k(source) {
  const key = source instanceof Blob ? source : String(source);
  if (audioCache.has(key)) return audioCache.get(key).slice();
  const buffer = source instanceof Blob ? await source.arrayBuffer() : await fetch(source).then((r) => r.arrayBuffer());
  const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(buffer);
  const ctx = new OfflineAudioContext(1, decoded.length, 16000);
  const node = ctx.createBufferSource();
  node.buffer = decoded;
  const filter = (type, frequency, { Q, gain } = {}) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    if (Q) f.Q.value = Q;
    if (gain) f.gain.value = gain;
    return f;
  };
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30;
  comp.ratio.value = 6;
  node.connect(filter('highpass', 250, { Q: 0.8 }))
    .connect(filter('highpass', 250, { Q: 0.8 }))
    .connect(filter('peaking', 2500, { Q: 0.9, gain: 6 }))
    .connect(filter('lowpass', 5000))
    .connect(comp)
    .connect(ctx.destination);
  node.start();
  const mono = (await ctx.startRendering()).getChannelData(0).slice();
  let peak = 0;
  for (let i = 0; i < mono.length; i += 1) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) for (let i = 0; i < mono.length; i += 1) mono[i] /= peak;
  audioCache.clear();
  audioCache.set(key, mono);
  return mono.slice();
}

// Listens to the recording. Returns { text, words: [{ text, start, end }], duration }.
export async function transcribe(source, onProgress, language = 'auto') {
  onProgress?.({ stage: 'decode' });
  const audio = await decode16k(source);
  const duration = audio.length / 16000;
  const out = await new Promise((resolve, reject) => {
    const w = getWorker();
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.({ ...data, seconds: duration });
      else if (data.type === 'result') resolve(data);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    w.onerror = (event) => reject(new Error(event.message || 'The listening tool could not start.'));
    let device;
    try { device = localStorage.getItem('sa_asr_device') || undefined; } catch { device = undefined; } // 'wasm' forces CPU mode
    w.postMessage({ audio, language, device }, [audio.buffer]);
  });
  const words = [];
  for (const chunk of out.chunks) {
    const [start, endRaw] = chunk.timestamp || [];
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(endRaw) ? endRaw : start + 0.4;
    const parts = chunk.text.trim().split(/\s+/).filter(Boolean);
    if (!out.segmentsOnly) {
      if (parts.length) words.push({ text: chunk.text.trim(), start, end });
    } else {
      parts.forEach((text, i) => words.push({ text, start: start + ((end - start) * i) / parts.length, end }));
    }
  }
  const clean = cleanWords(words);
  return { text: clean.map((w) => w.text).join(' '), words: clean, duration };
}

// The model sometimes "hears" things during beats with no voice: tags like
// [Music] / (upbeat music), or a lone "I" every ~20 s. Remove those.
function cleanWords(words) {
  const out = [];
  let depth = 0;
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const text = word.text.trim();
    const opens = (text.match(/[[(]/g) || []).length;
    const closes = (text.match(/[\])]/g) || []).length;
    const inTag = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    if (inTag || /^[♪♫*\-–—.…]+$/.test(text)) continue;
    out.push({ ...word, text });
  }
  // A short word all alone (6+ s of nothing before and after) is almost always invented.
  return out.filter((word, i) => {
    const before = i > 0 ? word.start - (out[i - 1].end ?? out[i - 1].start) : Infinity;
    const after = i < out.length - 1 ? out[i + 1].start - (word.end ?? word.start) : Infinity;
    return !(before > 6 && after > 6 && word.text.length <= 6);
  });
}

// ------------------------------------------------------------- alignment
const norm = (w) => String(w).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');

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
  // Whisper sometimes stretches a word back over the silence before it (e.g. a
  // first word "starting" at 0:00 in a song that's quiet until 0:06). A single
  // word never lasts that long, so trust its end instead.
  const heard = words.map((x) => {
    const end = Number.isFinite(x.end) ? x.end : x.start + 0.4;
    const start = end - x.start > 1.2 ? Math.max(x.start, end - 0.5) : x.start;
    return { w: norm(x.text), t: start, e: end };
  }).filter((x) => x.w);
  const n = lyricWords.length;
  const m = heard.length;
  const timing = lines.map(() => null);
  const ends = lines.map(() => null);
  if (!n || !m) return { timing, ends, matched: 0, total: lines.filter((l) => l.trim()).length };

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
    ends[line] = Math.max(ends[line] ?? 0, heard[hi].e); // last heard word of the line
  }
  const lineHasText = lines.map((l) => Boolean(l.trim()));
  const matched = timing.filter((t, i) => t !== null && lineHasText[i]).length;

  // Fill in lines that weren't heard clearly: share the time between the
  // matched lines around them, longer lines getting more time.
  const weight = lines.map((l) => (l.trim() ? l.trim().split(/\s+/).length : 0));
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
  for (let x = 0; x < lines.length; x += 1) {
    if (timing[x] === null) { ends[x] = null; continue; }
    let next = null;
    for (let y = x + 1; y < lines.length; y += 1) if (timing[y] !== null) { next = timing[y]; break; }
    const words = lines[x].trim().split(/[ \t]+/).filter(Boolean).length;
    let e = ends[x] ?? timing[x] + 1 + words * 0.4;
    e = Math.max(e + 0.25, timing[x] + 0.8); // a little breathing room after the last word
    if (next !== null) e = Math.min(e, next);
    ends[x] = Math.round(e * 100) / 100;
  }
  return { timing, ends, matched, total: lineHasText.filter(Boolean).length };
}

// Turns heard words into lyric lines (a new line at each sentence end, pause, or every ~10 words).
export function wordsToLines(words) {
  const lines = [];
  const timing = [];
  const lastEnds = [];
  let current = [];
  let start = null;
  words.forEach((word, i) => {
    const gap = i > 0 ? word.start - (words[i - 1].end ?? words[i - 1].start) : 0;
    const sentenceEnded = i > 0 && /[.!?]$/.test(words[i - 1].text.trim());
    if (current.length && (sentenceEnded || gap > 0.7 || current.length >= 10)) {
      lines.push(current.join(' '));
      timing.push(Math.round(start * 100) / 100);
      lastEnds.push(words[i - 1].end ?? words[i - 1].start + 0.4);
      current = [];
    }
    if (!current.length) start = word.start;
    current.push(word.text.trim());
  });
  if (current.length) {
    lines.push(current.join(' '));
    timing.push(Math.round(start * 100) / 100);
    lastEnds.push(words[words.length - 1].end ?? words[words.length - 1].start + 0.4);
  }
  // each line ends a moment after the next one's start or its own last word
  const ends = timing.map((t, i) => Math.round(Math.min(timing[i + 1] ?? Infinity, lastEnds[i] + 0.3) * 100) / 100);
  return { lines, timing, ends };
}
