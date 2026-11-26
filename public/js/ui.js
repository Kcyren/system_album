// Shared UI helpers for the public site and the Creator Studio.

const PATHS = {
  play: '<path class="f" d="M7 4.5v15l13-7.5z"/>',
  pause: '<path class="f" d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  prev: '<path class="f" d="M18 5v14l-10-7zM6 5h2v14H6z"/>',
  next: '<path class="f" d="M6 5v14l10-7zM16 5h2v14h-2z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  videoOff: '<path d="M10.7 6H14a2 2 0 0 1 2 2v3.3l1 1 5-2.3v10l-3.3-1.6M16 16v.2A2 2 0 0 1 14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1"/><path d="m2 2 20 20"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  whatsapp: '<path class="f" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/>',
  facebook: '<path class="f" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/>',
  tiktok: '<path class="f" d="M16.6 2h-3.3v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .8.1V9.2a6.2 6.2 0 1 0 5.4 6.2V8.6a7.8 7.8 0 0 0 4.4 1.4V6.7A4.6 4.6 0 0 1 16.6 2z"/>',
  youtube: '<path class="f" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15V9l5.8 3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M4 6h12M4 12h12M4 18h8"/><path class="f" d="M17 14v7l5-3.5z"/>',
  maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  minimize: '<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
};

export function icon(name) {
  const body = (PATHS[name] || '').replace(/class="f"/g, 'fill="currentColor" stroke="none"');
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

// Tiny element builder: h('div', { class: 'x', onclick }, child, 'text')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value; // only ever used with our own icon SVGs
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// ------------------------------------------------------------- formatting
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.floor(seconds);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = String(s % 60).padStart(2, '0');
  return hours ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
}

export function formatDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, opts);
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [hh, mm] = hhmm.split(':').map(Number);
  const date = new Date();
  date.setHours(hh, mm, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// -------------------------------------------------------------- artwork
function hueFor(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return 215 + (Math.abs(hash) % 30); // stays in the royal-blue family
}

// Default artwork when no image was uploaded: a generated "record" cover.
// Default cover when no image was uploaded: a looping flame (blue normally,
// red in fire mode — the colour is set in CSS). Plays only while on screen.
export const FLAME_VIDEO = '/media/flame-cover.mp4';
export const FLAME_POSTER = '/media/flame-cover.jpg';
const stillFlames = matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(navigator.connection?.saveData);

export function generatedArt(seed, label, { still = false } = {}) {
  const art = h('div', { class: 'art flame-art', 'aria-hidden': 'true' });
  if (still || stillFlames) {
    art.append(h('img', { src: FLAME_POSTER, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    const video = h('video', {
      class: 'flame-video', muted: true, loop: true, playsinline: true, preload: 'none',
      poster: FLAME_POSTER, 'data-src': FLAME_VIDEO, tabindex: '-1', 'aria-hidden': 'true',
    });
    video.muted = true;
    art.append(video);
  }
  return art;
}

// Starts flame videos inside root right away (used for the player, which is always visible).
export function startFlames(root) {
  root.querySelectorAll('video.flame-video').forEach((video) => {
    if (!video.src) video.src = video.dataset.src;
    video.play().catch(() => {});
  });
}

export function artFor(item, { alt = true, still = false } = {}) {
  if (item.coverUrl) {
    const img = h('img', { src: item.coverUrl, alt: alt ? `Artwork for ${item.title}` : '', loading: 'lazy', decoding: 'async' });
    // If the image can't load, show the generated cover instead of a broken icon.
    img.addEventListener('error', () => img.replaceWith(generatedArt(item.id, item.title, { still })), { once: true });
    return img;
  }
  return generatedArt(item.id, item.title, { still });
}

// ------------------------------------------------------------ waveform
// peaks: numbers 0–100. onSeek(fraction) is called when clicked or arrowed.
export function waveform(peaks, { label = 'Seek in this track', onSeek } = {}) {
  const layer = (cls) => h('div', { class: cls, 'aria-hidden': 'true' }, ...peaks.map((peak) => {
    const bar = h('i');
    bar.style.height = `${Math.max(8, peak)}%`;
    return bar;
  }));
  const el = h('div', {
    class: 'wave', role: 'slider', tabindex: '0', 'aria-label': label,
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, layer('wave-base'), layer('wave-fill'));

  const seek = (fraction) => onSeek?.(Math.min(1, Math.max(0, fraction)));
  el.addEventListener('click', (event) => {
    const rect = el.getBoundingClientRect();
    seek((event.clientX - rect.left) / rect.width);
  });
  el.addEventListener('keydown', (event) => {
    const now = Number(el.dataset.p || 0);
    if (event.key === 'ArrowRight') seek(now + 0.05);
    else if (event.key === 'ArrowLeft') seek(now - 0.05);
    else return;
    event.preventDefault();
  });
  el.setProgress = (fraction) => {
    el.style.setProperty('--p', `${(fraction * 100).toFixed(2)}%`);
    el.dataset.p = String(fraction);
    el.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  };
  return el;
}

// --------------------------------------------------------------- cards
// opts: { onPlay(track), onShare(track), href, preview (bool: autoplaying muted video) }
export function trackCard(track, opts = {}) {
  const href = 'href' in opts ? opts.href : `/track/${track.id}`;
  const cover = h('div', { class: 'cover' });

  if (track.mediaType === 'video' && opts.preview !== false && track.mediaUrl) {
    const video = h('video', {
      muted: true, loop: true, playsinline: true, preload: 'none',
      poster: track.coverUrl || null, 'aria-hidden': 'true', tabindex: '-1',
      'data-src': track.mediaUrl, class: 'card-video',
    });
    video.muted = true;
    if (!track.coverUrl) cover.append(generatedArt(track.id, track.title));
    cover.append(video);
  } else {
    cover.append(artFor(track, { alt: false }));
  }

  cover.append(
    h('span', { class: 'cover-badge', html: icon(track.mediaType === 'video' ? 'video' : 'audio') }, track.mediaType === 'video' ? 'Video' : 'Audio'),
    h('div', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
    track.hot ? h('span', { class: 'hot-badge', title: 'One of the most played & loved tracks this week' }, '🔥 Hot') : null,
  );
  if (opts.onPlay) {
    cover.append(h('button', {
      class: 'cover-btn', type: 'button', 'aria-label': `Play ${track.title}`, html: icon('play'),
      onclick: (event) => { event.preventDefault(); opts.onPlay(track); },
    }));
  }

  const meta = h('span', { class: 'meta' });
  if (track.recordedDate) meta.append(h('span', {}, formatDate(track.recordedDate)));
  if (track.plays > 0) meta.append(h('span', {}, plural(track.plays, 'play')));
  if (!meta.childNodes.length && track.publishedAt) meta.append(h('span', {}, `Added ${formatDate(track.publishedAt)}`));

  const foot = h('div', { class: 'card-foot' }, meta);
  if (opts.onShare) {
    foot.append(h('button', {
      class: 'card-share', type: 'button', 'aria-label': `Share ${track.title}`, html: icon('share'),
      onclick: (event) => { event.preventDefault(); opts.onShare(track); },
    }));
  }

  const tag = h('div', { class: 'tag' }, h('span', {}, track.category));
  if (track.duration) tag.append(h('span', {}, '·'), h('span', {}, formatDuration(track.duration)));

  const body = h('div', { class: 'card-body' },
    tag,
    h('h3', { class: 'card-title' }, href ? h('a', { href, 'data-link': true }, track.title) : track.title),
    track.description ? h('p', { class: 'card-desc' }, track.description) : null,
    foot,
  );

  return h('article', { class: 'card', 'data-track': track.id }, cover, body);
}
