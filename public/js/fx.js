// LED light effects that move with the music.
// - Reads the playing audio (Web Audio analyser) to get the beat.
// - Draws LED-style equalizers on every <canvas class="led-canvas">.
// - Sets the CSS variable --beat (0–1) on <html> so glows pulse with the music.
// Turns itself off for visitors who prefer reduced motion. On iPhone/iPad the
// audio isn't routed through Web Audio (it can stop background playback), so
// the lights just "breathe" instead of following the beat.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ROWS = 8;
const COLORS = ['#1d3fd6', '#2449e6', '#2f5bff', '#3f6cff', '#5b86ff', '#7aa4ff', '#9fd0ff', '#dff4ff']; // bottom → top
const OFF = 'rgba(90, 120, 220, 0.10)';

let media = null;
let audio = null; // { ctx, analyser, data }
let playing = false;
let raf = 0;
let beat = 0;
let lastFrame = 0;
const canvases = new Map(); // canvas -> { visible, peaks: [] }

function setupAudio() {
  if (audio || isIOS) return audio;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(media);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512; // ~94 Hz per bin at 48 kHz, so kick drums get their own bins
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audio = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
  } catch {
    audio = null;
  }
  return audio;
}

// Map n columns onto frequency bins (log scale), mirrored so the middle is the bass.
function levels(n, time) {
  const out = new Array(n);
  if (playing && audio) {
    const bins = audio.data.length * 0.55; // skip the near-silent top end
    const half = Math.ceil(n / 2);
    for (let i = 0; i < half; i += 1) {
      const from = Math.floor(Math.pow(i / half, 1.7) * bins);
      const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / half, 1.7) * bins));
      let sum = 0;
      for (let b = from; b < to; b += 1) sum += audio.data[b];
      const v = Math.min(1, (sum / (to - from) / 255) * 1.15);
      out[half - 1 - i] = v;
      out[n - half + i] = v;
    }
    return out;
  }
  // No beat available: a slow breathing wave (stronger while playing on iOS).
  const amp = playing ? 0.55 : 0.38;
  for (let i = 0; i < n; i += 1) {
    const wave = Math.sin(time * 0.0016 + i * 0.32) * 0.5 + 0.5;
    const wave2 = Math.sin(time * 0.0009 - i * 0.17) * 0.5 + 0.5;
    out[i] = (wave * 0.65 + wave2 * 0.35) * amp + (playing ? Math.random() * 0.12 : 0.04);
  }
  return out;
}

// Adaptive range: learns each track's quiet/loud bass so every song pumps fully.
let bassLow = 1;
let bassHigh = 0;

function bassLevel() {
  if (!(playing && audio)) return playing ? 0.25 + Math.sin(performance.now() / 260) * 0.15 : 0;
  // Bass energy (~0–280 Hz): kick drums and 808s drive the glow.
  let sum = 0;
  for (let b = 0; b < 3; b += 1) sum += audio.data[b];
  const raw = sum / 3 / 255;
  bassLow = Math.min(raw, bassLow + 0.0025);
  bassHigh = Math.max(raw, bassHigh - 0.0025);
  if (bassHigh - bassLow < 0.06) return raw * 0.3; // steady sound: gentle glow
  return Math.min(1, Math.max(0, (raw - bassLow) / (bassHigh - bassLow)));
}

function draw(canvas, state, time) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const cell = Number(canvas.dataset.cell) || 12;
  const gap = Math.max(2, Math.round(cell / 4));
  const cols = Math.max(8, Math.floor((w + gap) / (cell + gap)));
  const rowH = (h - gap * (ROWS - 1)) / ROWS;
  const offsetX = (w - (cols * cell + (cols - 1) * gap)) / 2;
  const values = levels(cols, time);
  if (state.peaks.length !== cols) state.peaks = new Array(cols).fill(0);

  for (let c = 0; c < cols; c += 1) {
    const lit = Math.round(values[c] * ROWS);
    // Peak-hold LED that falls slowly, like a real meter.
    state.peaks[c] = Math.max(lit, state.peaks[c] - 0.12);
    const peak = Math.round(state.peaks[c]);
    const x = offsetX + c * (cell + gap);
    for (let r = 0; r < ROWS; r += 1) {
      const y = h - (r + 1) * rowH - r * gap;
      g.fillStyle = r < lit ? COLORS[r] : r === peak - 1 && peak > lit ? '#e8f7ff' : OFF;
      g.beginPath();
      g.roundRect ? g.roundRect(x, y, cell, rowH, 2) : g.rect(x, y, cell, rowH);
      g.fill();
    }
  }
}

function frame(time) {
  raf = 0;
  // Idle: ~24 fps is plenty. Playing: full frame rate.
  if (!playing && time - lastFrame < 40) {
    schedule();
    return;
  }
  lastFrame = time;
  if (playing && audio) audio.analyser.getByteFrequencyData(audio.data);
  for (const [canvas, state] of canvases) {
    if (!canvas.isConnected) canvases.delete(canvas);
    else if (state.visible) draw(canvas, state, time);
  }
  const target = bassLevel();
  beat += (target - beat) * (target > beat ? 0.6 : 0.2); // fast attack, quick release
  document.documentElement.style.setProperty('--beat', beat.toFixed(3));
  schedule();
}

function schedule() {
  if (raf || document.hidden || reduced.matches) return;
  const anyVisible = [...canvases.values()].some((s) => s.visible);
  if (!anyVisible && !playing && beat < 0.01) return; // nothing to animate
  raf = requestAnimationFrame(frame);
}

const visibility = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = canvases.get(entry.target);
      if (state) state.visible = entry.isIntersecting;
    }
    schedule();
  })
  : null;

export function watchLeds(root = document) {
  root.querySelectorAll('canvas.led-canvas').forEach((canvas) => {
    if (canvases.has(canvas)) return;
    canvases.set(canvas, { visible: !visibility, peaks: [] });
    visibility?.observe(canvas);
  });
  schedule();
}

// Call from a click/tap handler (e.g. the play button). Browsers only let
// sound flow through Web Audio when it starts from the visitor's own gesture.
export function fxGesture() {
  if (reduced.matches || !media) return;
  if (setupAudio()) audio.ctx.resume().catch(() => {});
}

export function initFx(mediaElement) {
  media = mediaElement;
  document.documentElement.classList.toggle('fx', !reduced.matches);
  media.addEventListener('play', () => {
    playing = true;
    audio?.ctx.resume().catch(() => {});
    schedule();
  });
  for (const event of ['pause', 'ended', 'emptied']) {
    media.addEventListener(event, () => {
      playing = false;
      schedule();
    });
  }
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener?.('change', () => {
    document.documentElement.classList.toggle('fx', !reduced.matches);
    schedule();
  });
  watchLeds();
}
