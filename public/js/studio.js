import { icon, hydrateIcons, h, formatDuration, formatDate, plural, artFor, trackCard } from './ui.js';
import { editMap } from './edits.js';

const autoLyrics = () => import('./autolyrics.js'); // loaded only when used

const $ = (selector, root = document) => root.querySelector(selector);
const S = { email: null, tracks: [], albums: [], categories: [], profile: null, milestones: [], features: {}, tab: 'overview' };

// ================================================================ helpers
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    showLogin('Your session ended. Please sign in again.');
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function field(label, input, { optional = false, hint = null } = {}) {
  if (!input.id) input.id = `f-${Math.random().toString(36).slice(2, 9)}`;
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label, optional ? h('span', { class: 'opt' }, 'Optional') : null),
    input,
    hint ? h('p', { class: 'hint' }, hint) : null,
  );
}

const input = (attrs) => h('input', attrs);
const textarea = (attrs, value) => {
  const el = h('textarea', attrs);
  el.value = value || '';
  return el;
};
function select(options, value, attrs = {}) {
  const el = h('select', attrs, ...options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value ?? '';
  return el;
}

function setStatus(el, message, kind = '') {
  el.textContent = message;
  el.className = `status ${kind}`;
}

function thumb(item) {
  return h('div', { class: 'thumb' }, artFor(item, { alt: false, still: true }));
}

// Uploads a file straight to Supabase Storage using a one-time signed link.
async function upload(file, kind, onProgress) {
  const ticket = await api('/api/studio/uploads', { method: 'POST', body: { kind, contentType: file.type, size: file.size } });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    if (ticket.apiKey) xhr.setRequestHeader('apikey', ticket.apiKey);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). ${xhr.responseText.slice(0, 160)}`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
  return ticket;
}

function imagePicker({ label, currentUrl, round = false, hint }) {
  const file = input({ type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif' });
  const img = h('img', { alt: '', src: currentUrl || null, hidden: !currentUrl });
  const remove = input({ type: 'checkbox' });
  const removeLabel = h('label', { class: 'check', hidden: !currentUrl }, remove, 'Remove image');
  const autoNote = h('span', { class: 'hint', hidden: true }, 'Made from the video. Choose an image above to use your own.');
  let auto = null; // { blob, url } — a cover captured from the video
  const listeners = [];
  const changed = () => listeners.forEach((fn) => fn());

  file.addEventListener('change', () => {
    const chosen = file.files[0];
    if (chosen) {
      img.src = URL.createObjectURL(chosen);
      img.hidden = false;
      remove.checked = false;
      autoNote.hidden = true;
    }
    changed();
  });
  remove.addEventListener('change', () => {
    img.hidden = remove.checked || (!file.files[0] && !currentUrl && !auto);
    changed();
  });
  const wrap = field(label, file, { optional: true, hint });
  wrap.append(h('div', { class: `img-preview${round ? ' round' : ''}` }, img, h('div', {}, removeLabel, autoNote)));
  return {
    el: wrap,
    file: () => file.files[0] || (auto && !remove.checked ? auto.blob : null),
    removed: () => remove.checked,
    hasImage: () => Boolean(file.files[0] || currentUrl || auto),
    hasOwnImage: () => Boolean(file.files[0] || currentUrl),
    // Use a picture made from the video (only while no image was chosen).
    setAuto(blob) {
      if (!blob || file.files[0]) return;
      if (auto) URL.revokeObjectURL(auto.url);
      auto = { blob, url: URL.createObjectURL(blob) };
      img.src = auto.url;
      img.hidden = false;
      remove.checked = false;
      removeLabel.hidden = false;
      autoNote.hidden = false;
      changed();
    },
    onChange: (fn) => listeners.push(fn),
    previewUrl: () => (remove.checked ? null : file.files[0] ? img.src : auto ? auto.url : currentUrl || null),
  };
}

// Grabs one frame of a video as a JPEG (max 1280px wide).
function frameFromVideo(video) {
  try {
    if (!video.videoWidth) return Promise.resolve(null);
    const scale = Math.min(1, 1280 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  } catch {
    return Promise.resolve(null); // e.g. the browser can't read this video
  }
}

// Loads a video quietly and captures a frame about a quarter of the way in.
function autoCover(src) {
  return new Promise((resolve) => {
    const video = h('video', { muted: true, playsinline: true, preload: 'auto', crossorigin: 'anonymous' });
    video.muted = true;
    const finish = async () => {
      resolve(await frameFromVideo(video));
      video.removeAttribute('src');
      video.load();
    };
    const timer = setTimeout(() => resolve(null), 15000);
    video.addEventListener('loadedmetadata', () => {
      const at = Math.min(Math.max(video.duration * 0.25, 0.1), 3);
      video.addEventListener('seeked', () => { clearTimeout(timer); finish(); }, { once: true });
      video.currentTime = Number.isFinite(at) ? at : 0.1;
    }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timer); resolve(null); }, { once: true });
    video.src = src;
  });
}

// "Roblox 2026-11-09T09_50_29.940Z.mp4" -> "Roblox"
function cleanTitle(filename) {
  let name = filename.replace(/\.[^.]+$/, '');
  name = name
    .replace(/\d{4}[-_ .]?\d{2}[-_ .]?\d{2}[T _-]?\d{2}[-_ .:]?\d{2}[-_ .:]?\d{2}(\.\d+)?Z?/gi, ' ') // date + time stamps
    .replace(/_+/g, ' ')
    .replace(/\b\d{8}[ -]?\d{6}\b/g, ' ')
    .replace(/\b\d{4}[- ]\d{2}[- ]\d{2}\b/g, ' ')
    .replace(/\b(at\s+)?\d{1,2}[.:]\d{2}([.:]\d{2})?\s*(AM|PM)?\b/gi, ' ') // "at 9.50.29 PM"
    .replace(/\b(IMG|VID|MOV|PXL|DSC|REC|WA|AUD|VOICE)[ -]?\d*\b/gi, ' ')
    .replace(/\b(screen ?recording|recording|copy|final|edit|export(ed)?)\b/gi, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/\s-\s|-{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–.,\s]+|[-–.,\s]+$/g, '');
  return name.slice(0, 120);
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Returns the value to send for an image: a new path, null (removed), or undefined (unchanged).
async function imageValue(picker, kind, onProgress) {
  const chosen = picker.file();
  if (chosen) return (await upload(chosen, kind, onProgress)).path;
  if (picker.removed()) return null;
  return undefined;
}

// ============================================================== waveform
// Reads the audio (from a chosen file or an uploaded URL) and measures how
// loud each slice is, giving ~120 bar heights from 0 to 100.
async function computeWaveform(source, bars = 120) {
  const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioCtx) return null;
  try {
    const buffer = source instanceof Blob
      ? await source.arrayBuffer()
      : await fetch(source).then((r) => {
        if (!r.ok) throw new Error('download failed');
        return r.arrayBuffer();
      });
    const ctx = new AudioCtx(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buffer);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const block = Math.max(1, Math.floor(audio.length / bars));
    const stride = Math.max(1, Math.floor(block / 400)); // sample ~400 points per bar: fast and accurate enough
    const levels = [];
    for (let b = 0; b < bars; b += 1) {
      let sum = 0;
      let count = 0;
      for (let i = b * block; i < (b + 1) * block && i < audio.length; i += stride) {
        for (const data of channels) sum += data[i] * data[i];
        count += channels.length;
      }
      levels.push(count ? Math.sqrt(sum / count) : 0);
    }
    const peak = Math.max(...levels) || 1;
    return levels.map((v) => Math.round((v / peak) * 100));
  } catch (error) {
    console.warn('Waveform could not be created', error);
    return null;
  }
}

// Detailed loudness bars + length, for the trim & cut editor.
async function decodePeaks(source, bars = 900) {
  const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioCtx) return null;
  try {
    const buffer = source instanceof Blob ? await source.arrayBuffer() : await fetch(source).then((r) => r.arrayBuffer());
    const audio = await new AudioCtx(1, 1, 44100).decodeAudioData(buffer);
    const data = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bars));
    const stride = Math.max(1, Math.floor(block / 200));
    const peaks = [];
    for (let b = 0; b < bars; b += 1) {
      let max = 0;
      for (let i = b * block; i < (b + 1) * block && i < data.length; i += stride) max = Math.max(max, Math.abs(data[i]));
      peaks.push(max);
    }
    const top = Math.max(...peaks) || 1;
    return { peaks: peaks.map((p) => p / top), duration: audio.duration };
  } catch (error) {
    console.warn('Could not read audio for trimming', error);
    return null;
  }
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// ================================================================== data
async function loadAll() {
  const [tracks, albums, categories, profile, milestones, features] = await Promise.all([
    api('/api/studio/tracks'),
    api('/api/studio/albums'),
    api('/api/studio/categories'),
    api('/api/studio/profile'),
    api('/api/studio/milestones'),
    api('/api/studio/features'),
  ]);
  Object.assign(S, { tracks, albums, categories, profile, milestones, features });
}

const MIGRATION_HINT = 'Needs a one-time database update: run supabase/migrations/002_lyrics_waveform_stats.sql in the Supabase SQL Editor.';

const refreshTracks = async () => { S.tracks = await api('/api/studio/tracks'); };

// ================================================================= views
const views = {};

function openTab(tab, ...args) {
  S.tab = tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const panel = $('#panel');
  S.editorDirty = null;
  panel.replaceChildren(views[tab](...args));
  hydrateIcons(panel);
  const sub = typeof args[0] === 'string' && args[0] ? `/${args[0]}` : '';
  history.replaceState(null, '', `#${tab}${sub}`);
}

function head(title, text, ...actions) {
  return h('div', { class: 'panel-head' },
    h('div', {}, h('h1', {}, title), text ? h('p', {}, text) : null),
    actions.length ? h('div', { class: 'row-actions' }, ...actions) : null,
  );
}

// ------------------------------------------------------------- overview
views.overview = () => {
  const root = h('div', {}, head('Hey, welcome back.', 'Here is how your music is doing.',
    h('button', { class: 'btn primary', type: 'button', html: icon('plus'), onclick: () => openTab('tracks', 'new') }, 'New recording')));
  const stats = h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', {}, '…'), h('span', {}, 'Loading')));
  root.append(stats);
  const chartPanel = h('div', { class: 'panel', style: 'margin-top:16px' }, h('h3', {}, 'Plays per week'), h('p', { class: 'muted small' }, 'Loading…'));
  root.append(chartPanel);
  api('/api/studio/stats').then((data) => renderWeekly(chartPanel, data)).catch((e) => chartPanel.append(h('p', { class: 'status error' }, e.message)));
  api('/api/studio/overview').then((o) => {
    const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n.toLocaleString()), h('span', {}, label));
    stats.replaceChildren(
      stat(o.published, 'Published tracks'), stat(o.drafts, 'Drafts'), stat(o.plays, 'Total plays'),
      stat(o.reactions, 'Reactions'), stat(o.subscribers, 'Followers'), stat(o.albums, 'Albums'),
    );
    if (o.topTracks.length) {
      root.append(h('div', { class: 'panel', style: 'margin-top:16px' },
        h('h3', {}, 'Most played'),
        h('ul', { class: 'list' }, ...o.topTracks.map((t) => h('li', { class: 'row no-thumb' },
          h('a', { class: 'row-title', href: `/track/${t.id}`, target: '_blank' }, t.title),
          h('span', { class: 'muted small' }, plural(t.plays, 'play')))))));
    }
  }).catch((e) => stats.replaceChildren(h('p', { class: 'status error' }, e.message)));

  const drafts = S.tracks.filter((t) => t.status === 'draft');
  if (drafts.length) {
    root.append(h('div', { class: 'panel', style: 'margin-top:16px' },
      h('h3', {}, 'Drafts waiting'),
      h('ul', { class: 'list' }, ...drafts.map((t) => h('li', { class: 'row' }, thumb(t),
        h('div', {}, h('div', { class: 'row-title' }, t.title), h('div', { class: 'row-sub' }, t.category)),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => openTab('tracks', t.id) }, 'Finish'))))),
    ));
  }
  if (!S.tracks.length) {
    root.append(h('div', { class: 'panel', style: 'margin-top:16px' },
      h('h3', {}, 'Start with your first upload'),
      h('p', { class: 'muted' }, 'Add a freestyle, mix or short video. You can save it as a draft, preview it, and publish when it feels right. It does not need to be perfect — the journey is the point.')));
  }
  return root;
};

// ----------------------------------------------------- weekly plays chart
function niceCeil(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * power) return step * power;
  return 10 * power;
}

const weekLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function renderWeekly(panel, data) {
  const title = h('h3', {}, 'Plays per week');
  if (!data.available) {
    panel.replaceChildren(title, h('p', { class: 'muted small' }, MIGRATION_HINT));
    return;
  }
  const { weeks } = data;
  const total = weeks.reduce((sum, w) => sum + w.plays, 0);
  const since = data.trackingSince ? `Tracking since ${formatDate(data.trackingSince)}.` : 'Weekly tracking starts with the next play.';
  const intro = h('p', { class: 'muted small' }, `Last 12 weeks (weeks start Monday). ${since}`);
  if (!total) {
    panel.replaceChildren(title, intro, h('p', { class: 'empty' }, 'No plays recorded in the last 12 weeks yet. Share a track to get the first listeners!'));
    return;
  }

  // Geometry (SVG units; the chart scales to the panel width).
  const W = 640;
  const H = 230;
  const pad = { l: 34, r: 6, t: 18, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceCeil(Math.max(...weeks.map((w) => w.plays)));
  const slot = plotW / weeks.length;
  const barW = Math.min(28, slot * 0.6);
  const base = pad.t + plotH;
  const y = (v) => base - (v / max) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Bar chart of plays per week. Table view below.">`;
  for (const tick of [0, max / 2, max]) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(tick)}" y2="${y(tick)}" class="${tick === 0 ? 'axis' : 'grid'}"/>`;
    svg += `<text x="${pad.l - 6}" y="${y(tick) + 4}" class="tick" text-anchor="end">${Math.round(tick * 10) / 10}</text>`;
  }
  weeks.forEach((w, i) => {
    const x = pad.l + i * slot + (slot - barW) / 2;
    if (w.plays > 0) {
      const top = y(w.plays);
      const r = Math.min(4, base - top, barW / 2); // rounded data-end, square at the baseline
      svg += `<path class="bar" data-i="${i}" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z"/>`;
    }
    if (i % 2 === weeks.length % 2 || i === weeks.length - 1) {
      svg += `<text x="${x + barW / 2}" y="${H - 8}" class="tick" text-anchor="middle">${i === weeks.length - 1 ? 'This week' : weekLabel(w.start)}</text>`;
    }
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${plotH}"/>`;
  });
  // Direct label on the latest week only (selective labelling).
  const last = weeks[weeks.length - 1];
  const lastX = pad.l + (weeks.length - 1) * slot + slot / 2;
  svg += `<text x="${lastX}" y="${y(last.plays) - 6}" class="value" text-anchor="middle">${last.plays}</text>`;
  svg += '</svg>';

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const chart = h('div', { class: 'chart', html: svg }, tip);
  chart.addEventListener('pointermove', (event) => {
    const hit = event.target.closest('.hit');
    chart.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
    if (!hit) {
      tip.hidden = true;
      return;
    }
    const w = weeks[Number(hit.dataset.i)];
    chart.querySelector(`.bar[data-i="${hit.dataset.i}"]`)?.classList.add('active');
    tip.replaceChildren(h('b', {}, plural(w.plays, 'play')), h('span', {}, `Week of ${weekLabel(w.start)}`));
    const box = chart.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - 130, Math.max(0, event.clientX - box.left + 12))}px`;
    tip.style.top = `${event.clientY - box.top - 50}px`;
  });
  chart.addEventListener('pointerleave', () => {
    tip.hidden = true;
    chart.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
  });

  const table = h('details', { class: 'chart-table' },
    h('summary', {}, 'Show as table'),
    h('table', { class: 'simple' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Week starting'), h('th', {}, 'Plays'))),
      h('tbody', {}, ...weeks.map((w) => h('tr', {}, h('td', {}, formatDate(w.start)), h('td', {}, w.plays.toLocaleString())))),
    ));

  const top = data.thisWeekTop.length
    ? h('div', { style: 'margin-top:14px' },
      h('div', { class: 'label' }, 'Top this week'),
      h('ul', { class: 'list' }, ...data.thisWeekTop.map((t) => h('li', { class: 'row no-thumb' },
        h('span', { class: 'row-title' }, t.title), h('span', { class: 'muted small' }, plural(t.plays, 'play'))))))
    : null;

  panel.replaceChildren(title, intro, chart, table, top);
}

// --------------------------------------------------------------- tracks
views.tracks = (editId) => {
  if (editId === 'new') return trackEditor(null);
  if (editId && S.tracks.some((t) => t.id === editId)) return trackEditor(S.tracks.find((t) => t.id === editId));
  const missing = S.features.waveform ? S.tracks.filter((t) => !t.waveform) : [];
  const bulk = missing.length ? h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      bulk.disabled = true;
      let done = 0;
      for (const t of missing) {
        bulk.textContent = `Creating waveforms… ${done + 1}/${missing.length}`;
        if (await makeWaveform(t)) done += 1;
      }
      toast(`Added ${plural(done, 'waveform')}`);
      openTab('tracks');
    },
  }, `Create ${plural(missing.length, 'missing waveform')}`) : null;
  const root = h('div', {}, head('Tracks', `${plural(S.tracks.length, 'recording')} · drafts are only visible to you.`,
    bulk,
    h('button', { class: 'btn primary', type: 'button', html: icon('plus'), onclick: () => openTab('tracks', 'new') }, 'New recording')));

  if (!S.tracks.length) {
    root.append(h('p', { class: 'empty' }, 'No recordings yet. Press “New recording” to upload your first one.'));
    return root;
  }
  const list = h('ul', { class: 'list' }, ...S.tracks.map((t) => h('li', { class: 'row' },
    thumb(t),
    h('div', {},
      h('div', { class: 'row-title' }, t.title),
      h('div', { class: 'row-sub' },
        h('span', { class: `pill ${t.status}` }, t.status),
        S.profile.featuredTrackId === t.id ? h('span', { class: 'pill featured' }, '★ Featured') : null,
        h('span', {}, t.category),
        t.album ? h('span', {}, t.album.title) : null,
        t.recordedDate ? h('span', {}, formatDate(t.recordedDate)) : null,
        t.status === 'published' ? h('span', {}, plural(t.plays, 'play')) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      S.features.featured && t.status === 'published' ? h('button', {
        class: 'btn small', type: 'button',
        onclick: () => setFeatured(S.profile.featuredTrackId === t.id ? '' : t.id),
      }, S.profile.featuredTrackId === t.id ? 'Unfeature' : '★ Feature') : null,
      h('a', { class: 'btn small', href: `/track/${t.id}`, target: '_blank', html: icon('eye') }, t.status === 'draft' ? 'Preview' : 'View'),
      h('button', { class: 'btn small', type: 'button', html: icon('edit'), onclick: () => openTab('tracks', t.id) }, 'Edit'),
      h('button', { class: 'btn small danger', type: 'button', html: icon('trash'), onclick: () => deleteTrack(t) }, 'Delete'),
    ),
  )));
  root.append(h('div', { class: 'panel' }, list));
  return root;
};

async function setFeatured(trackId) {
  try {
    S.profile = await api('/api/studio/profile', { method: 'PATCH', body: { featuredTrackId: trackId } });
    toast(trackId ? 'Featured on the homepage' : 'Homepage shows the newest upload again');
    openTab(S.tab);
  } catch (e) {
    toast(e.message);
  }
}

async function deleteTrack(track) {
  if (!confirm(`Delete “${track.title}”? The audio/video and cover will be removed permanently.`)) return;
  try {
    await api(`/api/studio/tracks/${track.id}`, { method: 'DELETE' });
    await refreshTracks();
    toast('Track deleted');
    openTab('tracks');
  } catch (e) {
    toast(e.message);
  }
}

async function makeWaveform(track) {
  const peaks = await computeWaveform(track.mediaUrl);
  if (!peaks) return false;
  try {
    await api(`/api/studio/tracks/${track.id}`, { method: 'PATCH', body: { waveform: peaks } });
    track.waveform = peaks;
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

function trackEditor(track) {
  const isNew = !track;
  let duration = null;
  let localMediaUrl = null;
  let wavePromise = null;

  const title = input({ maxlength: 120, required: true, value: track?.title || '', placeholder: 'Name your recording' });
  const category = select(S.categories.map((c) => [String(c.id), c.name]), track ? String(track.categoryId) : String(S.categories[0]?.id || ''));
  const mediaFile = input({ type: 'file', accept: 'audio/*,video/mp4,video/webm,video/quicktime' });
  const cover = imagePicker({ label: 'Cover image', currentUrl: track?.coverUrl, hint: 'Square images look best. If you skip this, a cover is generated.' });
  const description = textarea({ maxlength: 2000, placeholder: 'What is this track about?' }, track?.description);
  const howMade = textarea({ maxlength: 2000, placeholder: 'The beat, your mood, what you tried…' }, track?.howMade);
  const progressNote = textarea({ maxlength: 1000, placeholder: 'What changed compared to before? What did you learn?' }, track?.progressNote);
  const lyrics = textarea({ maxlength: 10000, rows: 8, placeholder: 'Your bars, line by line', disabled: !S.features.lyrics }, track?.lyrics);
  let timing = Array.isArray(track?.lyricsTiming) ? [...track.lyricsTiming] : null;
  let edit = track?.edit ? JSON.parse(JSON.stringify(track.edit)) : null;
  let editTouched = false;
  let trimReset = null; // set by the trim tool; resets it when a new file is chosen
  let timingTouched = false;
  const date = input({ type: 'date', value: track?.recordedDate || '' });
  const time = input({ type: 'time', value: track?.recordedTime || '' });
  const album = select([['', 'No album'], ...S.albums.map((a) => [a.id, a.title])], track?.album?.id || '');

  // ---- unsaved changes survive a refresh or closed tab (kept in this browser only)
  const draftKey = `sa_draft_${track?.id || 'new'}`;
  const fields = { title, category, description, howMade, progressNote, lyrics, date, time, album };
  const snapshot = () => JSON.stringify({
    values: Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])),
    timing: timingTouched ? timing : undefined,
    edit: editTouched ? edit : undefined,
  });
  const original = snapshot();
  let restoredDraft = null;
  try { restoredDraft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { restoredDraft = null; }
  if (restoredDraft?.values) {
    for (const [k, el] of Object.entries(fields)) if (typeof restoredDraft.values[k] === 'string') el.value = restoredDraft.values[k];
    if (restoredDraft.timingTouched) { timing = restoredDraft.timing ?? null; timingTouched = true; }
    if (restoredDraft.editTouched) { edit = restoredDraft.edit ?? null; editTouched = true; }
  }
  const pickedFile = () => Boolean(mediaFile.files[0] || cover.file());
  let draftTimer = 0;
  function saveDraftNow() {
    const now = snapshot();
    try {
      if (now === original && !pickedFile()) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), values: JSON.parse(now).values, timing, timingTouched, edit, editTouched, hadFile: pickedFile() }));
    } catch { /* storage full or blocked: nothing to do */ }
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 250);
  }
  function clearDraft() {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }
  // Only a newly chosen file can't be brought back after a refresh, so only then ask before leaving.
  S.editorDirty = () => pickedFile();

  const mediaPreview = h('div', { class: 'preview-media' });
  const cardPreview = h('div', { class: 'preview-card' });
  const progress = h('div', { class: 'progress', hidden: true }, h('i'));
  const status = h('p', { class: 'status', role: 'status' });
  const fileInfo = h('div', { class: 'file-info', role: 'status' });
  const maxMb = S.features.maxUploadMb || 50;
  const announce = input({ type: 'checkbox', checked: track?.status !== 'published' });
  let autoTitle = '';

  // Length / size / resolution, plus friendly warnings about the chosen file.
  function describeFile(el, chosen) {
    const parts = [];
    if (Number.isFinite(el.duration)) parts.push(`Length ${formatDuration(el.duration)}`);
    if (chosen) parts.push(formatBytes(chosen.size));
    if (el.videoWidth) parts.push(`${el.videoWidth}×${el.videoHeight}`);
    const notes = [h('span', {}, parts.join(' · '))];
    if (chosen && Number.isFinite(el.duration) && el.duration < 10) {
      const secs = Math.max(1, Math.round(el.duration));
      notes.push(h('span', { class: 'warn' }, `Heads up: this file is only ${secs} second${secs === 1 ? '' : 's'} long. Is it the full recording?`));
    }
    fileInfo.replaceChildren(...notes);
  }

  function showMedia(url, type) {
    if (!url) {
      mediaPreview.replaceChildren();
      return;
    }
    const chosen = mediaFile.files[0];
    const el = type === 'video'
      ? h('video', { controls: true, playsinline: true, preload: 'metadata', poster: cover.previewUrl(), crossorigin: 'anonymous' })
      : h('audio', { controls: true, preload: 'metadata' });
    el.addEventListener('loadedmetadata', () => {
      if (chosen) duration = el.duration;
      describeFile(el, chosen);
      updateCard();
    });
    el.addEventListener('error', () => {
      if (!chosen) return;
      fileInfo.replaceChildren(h('span', { class: 'warn' }, `Your browser can't play this file, so visitors probably can't either. Export it as MP4 (H.264) or MP3 and try again. (${formatBytes(chosen.size)})`));
    });
    el.src = url;
    const tools = [];
    if (type === 'video') {
      tools.push(h('button', {
        class: 'btn small', type: 'button', style: 'margin-top:10px',
        onclick: async () => {
          const blob = await frameFromVideo(el);
          if (blob) {
            cover.setAuto(blob);
            toast('Cover set from this moment of the video');
          } else toast('Could not grab a picture from this video.');
        },
      }, 'Use this moment as the cover'));
    }
    mediaPreview.replaceChildren(el, ...tools);
  }

  function currentType() {
    const chosen = mediaFile.files[0];
    if (chosen) return chosen.type.startsWith('video/') ? 'video' : 'audio';
    return track?.mediaType || 'audio';
  }

  function updateCard() {
    const preview = {
      id: track?.id || 'preview',
      title: title.value.trim() || 'Untitled',
      category: S.categories.find((c) => String(c.id) === category.value)?.name || '',
      mediaType: currentType(),
      mediaUrl: null,
      coverUrl: cover.previewUrl(),
      description: description.value.trim(),
      recordedDate: date.value || null,
      duration: (() => {
        const raw = duration || track?.rawDuration || track?.duration || null;
        const map = edit && raw ? editMap(edit, raw) : null;
        return map ? map.length : raw;
      })(),
      plays: track?.plays || 0,
      publishedAt: track?.publishedAt || new Date().toISOString(),
    };
    cardPreview.replaceChildren(trackCard(preview, { href: null, preview: false }));
  }

  mediaFile.addEventListener('change', () => {
    const chosen = mediaFile.files[0];
    fileInfo.replaceChildren();
    if (chosen && chosen.size > maxMb * 1024 * 1024) {
      fileInfo.replaceChildren(h('span', { class: 'warn' }, `This file is ${formatBytes(chosen.size)}, over the ${maxMb} MB limit. Export a shorter clip or a smaller size (720p works well) and choose it again.`));
      mediaFile.value = '';
      return;
    }
    if (localMediaUrl) URL.revokeObjectURL(localMediaUrl);
    if (edit) {
      edit = null;
      editTouched = true;
    }
    trimReset?.();
    localMediaUrl = chosen ? URL.createObjectURL(chosen) : null;
    duration = null;
    wavePromise = chosen && S.features.waveform ? computeWaveform(chosen) : null;
    showMedia(localMediaUrl || track?.mediaUrl, currentType());
    if (chosen && (!title.value.trim() || title.value === autoTitle)) {
      autoTitle = cleanTitle(chosen.name);
      title.value = autoTitle;
    }
    // No cover yet? Make one from the video automatically.
    if (chosen && chosen.type.startsWith('video/') && !cover.hasOwnImage()) {
      autoCover(localMediaUrl).then((blob) => blob && mediaFile.files[0] === chosen && cover.setAuto(blob));
    }
    updateCard();
  });
  for (const el of [title, category, description, date]) el.addEventListener('input', updateCard);
  cover.onChange(updateCard);

  async function save(nextStatus) {
    setStatus(status, '');
    if (!title.value.trim()) return setStatus(status, 'Please add a title.', 'error');
    if (!category.value) return setStatus(status, 'Please choose a category.', 'error');
    if (isNew && !mediaFile.files[0]) return setStatus(status, 'Please choose an audio or video file.', 'error');
    if (mediaFile.files[0] && duration && duration < 5
      && !confirm(`This recording is only ${Math.max(1, Math.round(duration))} second(s) long. Save it anyway?`)) return;

    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    const bar = progress.firstChild;
    const showProgress = (fraction) => {
      progress.hidden = false;
      bar.style.width = `${Math.round(fraction * 100)}%`;
    };

    try {
      const body = {
        title: title.value,
        categoryId: Number(category.value),
        description: description.value,
        howMade: howMade.value,
        progressNote: progressNote.value,
        recordedDate: date.value,
        recordedTime: time.value,
        albumId: album.value,
        status: nextStatus,
      };
      if (S.features.lyrics) body.lyrics = lyrics.value;
      if (S.features.edits && editTouched) body.edit = edit;
      if (S.features.syncedLyrics) {
        const lineCount = lyrics.value.split(/\r?\n/).length;
        if (timingTouched) body.lyricsTiming = timing && timing.length === lineCount && timing.some((t) => t !== null) ? timing : null;
        else if (timing && timing.length !== lineCount) body.lyricsTiming = null; // lyrics changed: old timing no longer fits
      }
      if (canAnnounce && nextStatus === 'published' && announce.checked) body.announce = true;
      if (mediaFile.files[0] && wavePromise) {
        setStatus(status, 'Reading the waveform…');
        const peaks = await withTimeout(wavePromise, 20000);
        if (peaks) body.waveform = peaks;
      }
      if (mediaFile.files[0]) {
        setStatus(status, 'Uploading your recording…');
        body.mediaPath = (await upload(mediaFile.files[0], 'media', (f) => showProgress(f * 0.9))).path;
        body.duration = duration;
      }
      const coverPath = await imageValue(cover, 'cover', (f) => showProgress(0.9 + f * 0.1));
      if (coverPath !== undefined) body.coverPath = coverPath;

      setStatus(status, 'Saving…');
      const saved = isNew
        ? await api('/api/studio/tracks', { method: 'POST', body })
        : await api(`/api/studio/tracks/${track.id}`, { method: 'PATCH', body });
      showProgress(1);
      clearDraft();
      await refreshTracks();
      let message = nextStatus === 'published' ? 'Published! It is live on the site.' : 'Saved as a draft';
      if (saved.announcement?.sent) message += ` Emailed ${plural(saved.announcement.sent, 'follower')}.`;
      if (saved.announcement?.error) message += ` Email not sent: ${saved.announcement.error}`;
      toast(message);
      openTab('tracks', saved.id);
    } catch (e) {
      setStatus(status, e.message, 'error');
      progress.hidden = true;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  const published = track?.status === 'published';
  // Offer the release email the first time a track goes live.
  const canAnnounce = Boolean(S.features.emails) && !track?.announcedAt;
  const actions = h('div', { class: 'form-actions' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => save('published') }, published ? 'Save changes' : 'Publish'),
    h('button', { class: 'btn', type: 'button', onclick: () => save('draft') }, published ? 'Unpublish (make draft)' : 'Save draft'),
    track ? h('a', { class: 'btn', href: `/track/${track.id}`, target: '_blank', html: icon('eye') }, published ? 'View on site' : 'Preview on site') : null,
    h('button', { class: 'btn', type: 'button', onclick: () => openTab('tracks') }, 'Back'),
  );

  const form = h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); save(published ? 'published' : 'draft'); } },
    h('h2', {}, isNew ? 'New recording' : 'Edit recording'),
    restoredDraft?.values ? h('div', { class: 'draft-note' },
      h('span', {}, `↺ Restored your unsaved changes from ${new Date(restoredDraft.savedAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}.`,
        restoredDraft.hadFile ? ' Please choose your new audio/photo file again — browsers can’t keep files after a refresh.' : ''),
      h('button', { class: 'btn small', type: 'button', onclick: () => { clearDraft(); openTab('tracks', track?.id || 'new'); } }, 'Discard')) : null,
    h('p', { class: 'muted' }, 'Only title, category and the file are required. Everything else is up to you.'),
    field('Title *', title),
    field('Category *', category),
    field(isNew ? 'Audio or video file *' : 'Replace audio or video', mediaFile, {
      optional: !isNew,
      hint: 'MP3, M4A, WAV, OGG, FLAC, MP4, WEBM or MOV. Keep files under your storage plan limit (50 MB on Supabase Free).',
    }),
    fileInfo,
    trimTool(),
    cover.el,
    field('About this track', description, { optional: true }),
    field('How it was made', howMade, { optional: true }),
    field('Progress note', progressNote, { optional: true, hint: 'Shown on the Journey section and the track page.' }),
    field('Lyrics / bars', lyrics, { optional: true, hint: S.features.lyrics ? 'Shown on the track page and in the full-screen player. Searchable.' : MIGRATION_HINT }),
    syncTool(),
    h('div', { class: 'field-grid' }, field('Recording date', date, { optional: true }), field('Recording time', time, { optional: true })),
    field('Album', album, { optional: true }),
    progress,
    canAnnounce ? h('label', { class: 'check', style: 'margin-top:18px' }, announce, 'Email followers when this is published') : null,
    actions,
    status,
  );

  const previewCol = h('div', { class: 'preview-col' },
    h('div', { class: 'panel' }, h('h3', {}, 'Listen back'), h('p', { class: 'muted small' }, 'Check your recording before you publish.'), mediaPreview, waveTools()),
    h('div', { class: 'panel' }, h('h3', {}, 'Card preview'), h('p', { class: 'muted small' }, 'How it will look on the site.'), cardPreview),
  );

  // ---------------------------------------------------------- trim & cut
  // Non-destructive: saves start/end/cuts/fades; the original file stays as it is.
  function trimTool() {
    if (!S.features.edits) return null;
    const wrap = h('div', { class: 'trim-tool' });
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

    function intro() {
      const map = edit && (track?.rawDuration || duration) ? editMap(edit, track?.rawDuration || duration) : null;
      wrap.replaceChildren(
        h('button', { class: 'btn small', type: 'button', onclick: open }, edit ? '✂️ Edited — change trim & cuts' : '✂️ Trim & cut'),
        h('p', { class: 'hint' }, map
          ? `Plays ${formatDuration(map.length)} of ${formatDuration(track?.rawDuration || duration)}. The original recording is kept, so you can undo any time.`
          : 'Cut silence at the start or end, or remove a part in the middle. Nothing is deleted — you can undo any time.'),
      );
    }
    trimReset = intro;

    async function open() {
      const src = localMediaUrl || track?.mediaUrl;
      if (!src) return toast('Choose the audio or video file first.');
      wrap.replaceChildren(h('p', { class: 'hint' }, 'Reading the recording…'));
      const decoded = await decodePeaks(mediaFile.files[0] || src);
      if (!decoded) {
        wrap.replaceChildren(h('p', { class: 'hint' }, "Your browser couldn't read this file for editing. Try Chrome or Edge."));
        return;
      }
      build(decoded, src);
    }

    function build({ peaks, duration: total }, src) {
      const state = {
        start: edit?.start ?? 0,
        end: edit?.end ?? total,
        cuts: (edit?.cuts || []).map((c) => [...c]),
        fadeIn: edit?.fadeIn || 0,
        fadeOut: edit?.fadeOut || 0,
        sel: null, // [a, b] selection for cutting
        drag: null,
      };
      const audio = h('audio', { src, preload: 'auto' });
      const canvas = h('canvas', { class: 'trim-canvas', 'aria-label': 'Waveform. Drag the handles to trim, drag across to select a part to cut.' });
      const startIn = input({ type: 'number', min: '0', step: '0.1', 'aria-label': 'Start (seconds)' });
      const endIn = input({ type: 'number', min: '0', step: '0.1', 'aria-label': 'End (seconds)' });
      const fadeSel = (value) => select([['0', 'None'], ['1', '1 s'], ['2', '2 s'], ['3', '3 s'], ['5', '5 s']], String(value));
      const fadeInSel = fadeSel(state.fadeIn);
      const fadeOutSel = fadeSel(state.fadeOut);
      const info = h('p', { class: 'trim-info', role: 'status' });
      const cutList = h('ul', { class: 'trim-cuts' });
      const playBtn = h('button', { class: 'btn small primary', type: 'button' }, '▶ Preview');
      const cutBtn = h('button', { class: 'btn small', type: 'button', disabled: true }, '✂️ Cut selection');

      const r2 = (n) => Math.round(n * 100) / 100;
      const currentEdit = () => ({ start: r2(state.start), end: state.end >= total - 0.05 ? null : r2(state.end), cuts: state.cuts.map(([a, b]) => [r2(a), r2(b)]), fadeIn: state.fadeIn, fadeOut: state.fadeOut });
      const isUnchanged = () => state.start < 0.05 && state.end >= total - 0.05 && !state.cuts.length && !state.fadeIn && !state.fadeOut;
      const commit = () => {
        edit = isUnchanged() ? null : currentEdit();
        editTouched = true;
        updateCard();
      };

      // ---- drawing
      function draw() {
        const dpr = Math.min(2, devicePixelRatio || 1);
        const w = canvas.clientWidth || 600;
        const hgt = canvas.clientHeight || 110;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hgt * dpr);
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, hgt);
        const x = (t) => (t / total) * w;
        const barW = w / peaks.length;
        const mid = hgt / 2;
        peaks.forEach((p, i) => {
          const t = ((i + 0.5) / peaks.length) * total;
          const kept = t >= state.start && t <= state.end && !state.cuts.some(([a, b]) => t >= a && t <= b);
          g.fillStyle = kept ? '#5b86ff' : '#3a4767';
          const bh = Math.max(1.5, p * (hgt - 16));
          g.fillRect(i * barW, mid - bh / 2, Math.max(1, barW - 0.6), bh);
        });
        // trimmed-off ends
        g.fillStyle = 'rgba(5,5,16,.62)';
        g.fillRect(0, 0, x(state.start), hgt);
        g.fillRect(x(state.end), 0, w - x(state.end), hgt);
        // cuts
        for (const [a, b] of state.cuts) {
          g.fillStyle = 'rgba(255,80,80,.22)';
          g.fillRect(x(a), 0, x(b) - x(a), hgt);
          g.strokeStyle = 'rgba(255,120,120,.8)';
          g.strokeRect(x(a) + 0.5, 0.5, x(b) - x(a) - 1, hgt - 1);
        }
        // selection
        if (state.sel) {
          const [a, b] = [Math.min(...state.sel), Math.max(...state.sel)];
          g.fillStyle = 'rgba(160,190,255,.25)';
          g.fillRect(x(a), 0, x(b) - x(a), hgt);
        }
        // handles
        for (const t of [state.start, state.end]) {
          g.fillStyle = '#ffffff';
          g.fillRect(x(t) - 1.5, 0, 3, hgt);
          g.beginPath();
          g.roundRect ? g.roundRect(x(t) - 6, mid - 14, 12, 28, 4) : g.rect(x(t) - 6, mid - 14, 12, 28);
          g.fill();
        }
        // playhead
        g.fillStyle = '#ffd36b';
        g.fillRect(x(audio.currentTime) - 1, 0, 2, hgt);
      }

      function refresh() {
        startIn.value = state.start.toFixed(1);
        endIn.value = state.end.toFixed(1);
        const map = editMap(currentEdit(), total);
        info.textContent = `Original ${formatDuration(total)} → final ${formatDuration(map ? map.length : total)}${map && total - map.length >= 0.1 ? ` (${(total - map.length).toFixed(1)} s removed)` : ''}`;
        cutList.replaceChildren(...state.cuts.map((c, i) => h('li', {},
          `Cut ${fmt(c[0])} – ${fmt(c[1])}`,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Undo this cut', html: icon('close'), onclick: () => { state.cuts.splice(i, 1); commit(); refresh(); } }))));
        cutBtn.disabled = !state.sel || Math.abs(state.sel[1] - state.sel[0]) < 0.2;
        draw();
      }

      // ---- mouse / touch on the waveform
      const timeAt = (event) => {
        const r = canvas.getBoundingClientRect();
        return Math.min(total, Math.max(0, ((event.clientX - r.left) / r.width) * total));
      };
      canvas.addEventListener('pointerdown', (event) => {
        const t = timeAt(event);
        const px = (sec) => (sec / total) * canvas.getBoundingClientRect().width;
        const near = (sec) => Math.abs(px(sec) - px(t)) < 12;
        state.drag = near(state.start) ? 'start' : near(state.end) ? 'end' : 'select';
        if (state.drag === 'select') state.sel = [t, t];
        canvas.setPointerCapture(event.pointerId);
        refresh();
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!state.drag) return;
        const t = timeAt(event);
        if (state.drag === 'start') state.start = Math.min(t, state.end - 0.5);
        else if (state.drag === 'end') state.end = Math.max(t, state.start + 0.5);
        else state.sel[1] = t;
        refresh();
      });
      canvas.addEventListener('pointerup', (event) => {
        const kind = state.drag;
        state.drag = null;
        if (kind === 'select' && Math.abs(state.sel[1] - state.sel[0]) < 0.2) {
          audio.currentTime = timeAt(event); // a simple click moves the playhead
          state.sel = null;
        }
        if (kind === 'start' || kind === 'end') commit();
        refresh();
      });

      // ---- buttons and inputs
      cutBtn.addEventListener('click', () => {
        const [a, b] = [Math.min(...state.sel), Math.max(...state.sel)];
        state.cuts.push([Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
        state.sel = null;
        commit();
        refresh();
        toast('Part cut out. Press Preview to hear it.');
      });
      const setFromInput = (which, el) => el.addEventListener('change', () => {
        const v = Math.min(total, Math.max(0, Number(el.value) || 0));
        if (which === 'start') state.start = Math.min(v, state.end - 0.5);
        else state.end = Math.max(v, state.start + 0.5);
        commit();
        refresh();
      });
      setFromInput('start', startIn);
      setFromInput('end', endIn);
      fadeInSel.addEventListener('change', () => { state.fadeIn = Number(fadeInSel.value); commit(); refresh(); });
      fadeOutSel.addEventListener('change', () => { state.fadeOut = Number(fadeOutSel.value); commit(); refresh(); });

      // Preview plays the edited version (skips cuts, applies fades)
      let raf = 0;
      const loop = () => {
        const map = editMap(currentEdit(), total);
        if (map && !audio.paused) {
          const jump = map.jump(audio.currentTime);
          if (jump === 'end') { audio.pause(); audio.currentTime = map.start; }
          else if (jump !== null) audio.currentTime = jump;
          audio.volume = map.gain(audio.currentTime);
        }
        draw();
        if (!audio.paused) raf = requestAnimationFrame(loop);
      };
      playBtn.addEventListener('click', () => {
        if (audio.paused) {
          const map = editMap(currentEdit(), total);
          if (map && (audio.currentTime < map.start || audio.currentTime >= map.end - 0.05)) audio.currentTime = map.start;
          audio.play().catch(() => {});
        } else audio.pause();
      });
      audio.addEventListener('play', () => { playBtn.textContent = '⏸ Pause'; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
      audio.addEventListener('pause', () => { playBtn.textContent = '▶ Preview'; audio.volume = 1; draw(); });

      wrap.replaceChildren(h('div', { class: 'trim-panel' },
        h('div', { class: 'trim-head' }, h('b', {}, '✂️ Trim & cut'), info),
        canvas,
        h('p', { class: 'hint' }, 'Drag the white handles to trim the start and end. Drag across the waveform to select a part, then press “Cut selection”. Click to move the yellow playhead.'),
        h('div', { class: 'form-actions' },
          playBtn,
          h('button', { class: 'btn small', type: 'button', onclick: () => { state.start = audio.currentTime < state.end - 0.5 ? audio.currentTime : state.start; commit(); refresh(); } }, 'Start here'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { state.end = audio.currentTime > state.start + 0.5 ? audio.currentTime : state.end; commit(); refresh(); } }, 'End here'),
          cutBtn),
        h('div', { class: 'trim-grid' },
          h('label', {}, 'Start (s)', startIn),
          h('label', {}, 'End (s)', endIn),
          h('label', {}, 'Fade in', fadeInSel),
          h('label', {}, 'Fade out', fadeOutSel)),
        cutList,
        h('div', { class: 'form-actions' },
          h('button', {
            class: 'btn small danger', type: 'button',
            onclick: () => {
              Object.assign(state, { start: 0, end: total, cuts: [], fadeIn: 0, fadeOut: 0, sel: null });
              fadeInSel.value = '0';
              fadeOutSel.value = '0';
              commit();
              refresh();
              toast('Back to the original recording');
            },
          }, 'Undo all edits'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { audio.pause(); intro(); } }, 'Done')),
        h('p', { class: 'hint' }, 'Edits are saved when you press Publish / Save changes.'),
        audio));
      new ResizeObserver(draw).observe(canvas);
      refresh();
    }

    intro();
    return wrap;
  }

  // Karaoke timing: play the track and tap as each line starts.
  function syncTool() {
    if (!S.features.syncedLyrics) return null;
    const wrap = h('div', { class: 'sync-tool' });
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

    const autoStatus = h('p', { class: 'hint', role: 'status' });

    // ✨ Listen to the recording (free, in this browser) and line the lyrics up automatically.
    async function autoRun(mode) {
      const src = mediaFile.files[0] || localMediaUrl || track?.mediaUrl;
      if (!src) return toast('Choose the audio or video file first.');
      const buttons = wrap.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      const say = (text) => { autoStatus.textContent = text; };
      say('Getting ready…');
      try {
        const { transcribe, alignLines, wordsToLines } = await autoLyrics();
        const heard = await transcribe(src, (p) => {
          if (p.stage === 'download') say(`Downloading the listening tool… ${p.pct}% (only the first time, ~80 MB)`);
          if (p.stage === 'decode') say('Reading the recording…');
          if (p.stage === 'listen') say(`Listening to ${formatDuration(p.seconds)} of music… this can take a minute or two. Keep this tab open.`);
        });
        if (!heard.words.length) throw new Error("Couldn't hear any words. Is the voice loud enough over the beat?");
        if (mode === 'write') {
          const result = wordsToLines(heard.words);
          lyrics.value = result.lines.join(String.fromCharCode(10));
          timing = result.timing;
          timingTouched = true;
          intro();
          say(`✨ Wrote ${result.lines.length} lines and synced them. Read them through and fix any wrong words — the timing stays.`);
        } else {
          const lines = lyrics.value.split(/\r?\n/);
          const result = alignLines(lines, heard.words, heard.duration);
          timing = result.timing;
          timingTouched = true;
          intro();
          say(result.matched === result.total
            ? `✨ Synced all ${result.total} lines! Press “Synced — edit timing” to play it back and fix any line if needed.`
            : `✨ Synced! ${result.matched} of ${result.total} lines were heard clearly; the others were placed in between. Press “Synced — edit timing” to check and fix them.`);
        }
        scheduleDraft();
        toast('Lyrics synced — press Save to keep them');
      } catch (error) {
        console.warn(error);
        intro();
        say(`Auto-sync didn't work: ${error.message || error}. You can still tap along with “Sync lyrics to the music”.`);
      } finally {
        wrap.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }

    function intro() {
      const hasLyrics = lyrics.value.trim().length > 0;
      wrap.replaceChildren(
        h('div', { class: 'form-actions', style: 'margin-top:0' },
          hasLyrics
            ? h('button', { class: 'btn small primary', type: 'button', onclick: () => autoRun('align') }, '✨ Auto-sync to the music')
            : h('button', { class: 'btn small primary', type: 'button', onclick: () => autoRun('write') }, '✨ Write lyrics from the recording'),
          hasLyrics ? h('button', { class: 'btn small', type: 'button', onclick: build }, timing ? '✓ Synced — edit timing' : '🎤 Sync by tapping') : null),
        h('p', { class: 'hint' }, hasLyrics
          ? 'Auto-sync listens to the track (free, right here in your browser) and lines your lyrics up with your voice. Or tap along yourself.'
          : 'No lyrics yet? Let it listen and write them for you, already synced. Then fix any wrong words.'),
        autoStatus,
      );
    }
    lyrics.addEventListener('input', () => { if (!wrap.querySelector('.sync-panel')) intro(); });

    function build() {
      const src = localMediaUrl || track?.mediaUrl;
      if (!src) return toast('Choose the audio or video file first.');
      const lines = lyrics.value.split(/\r?\n/);
      if (!lines.some((l) => l.trim())) return toast('Write the lyrics first.');
      if (!timing || timing.length !== lines.length) timing = lines.map(() => null);
      const nextIndex = (from) => {
        for (let i = from; i < lines.length; i += 1) if (lines[i].trim()) return i;
        return -1;
      };
      let next = nextIndex(0);
      while (next >= 0 && timing[next] !== null) next = nextIndex(next + 1);

      const audio = h('audio', { src, controls: true, preload: 'auto' });
      const list = h('ol', { class: 'sync-lines' });
      const status = h('p', { class: 'hint', role: 'status' });

      function draw() {
        list.replaceChildren(...lines.map((line, i) => h('li', {
          class: [i === next ? 'next' : '', line.trim() ? '' : 'blank'].join(' ').trim(),
          'data-i': String(i),
          title: line.trim() ? 'Click to set this line to the current time' : null,
          onclick: () => {
            if (!line.trim()) return;
            timing[i] = Math.round(audio.currentTime * 100) / 100;
            timingTouched = true;
            draw();
          },
        }, h('span', { class: 't' }, timing[i] === null ? '–:––' : fmt(timing[i])), h('span', {}, line || ' '))));
        const total = lines.filter((l) => l.trim()).length;
        const done = timing.filter((t) => t !== null).length;
        status.textContent = next < 0 ? `All ${total} lines timed. Press Publish / Save to keep it.` : `${done} of ${total} lines timed. Next: “${lines[next].trim()}”`;
        list.querySelector('.next')?.scrollIntoView({ block: 'nearest' });
      }

      function tap() {
        if (next < 0) return;
        if (audio.paused) audio.play().catch(() => {});
        timing[next] = Math.round(audio.currentTime * 100) / 100;
        timingTouched = true;
        next = nextIndex(next + 1);
        draw();
      }

      function undo() {
        let last = -1;
        timing.forEach((t, i) => { if (t !== null && (next < 0 || i < next)) last = i; });
        if (last < 0) return;
        audio.currentTime = Math.max(0, timing[last] - 2);
        timing[last] = null;
        timingTouched = true;
        next = last;
        draw();
      }

      // Highlight the line that is playing, to check the timing.
      audio.addEventListener('timeupdate', () => {
        let playing = -1;
        timing.forEach((t, i) => { if (t !== null && t <= audio.currentTime + 0.1) playing = i; });
        list.querySelectorAll('li').forEach((li) => li.classList.toggle('playing', Number(li.dataset.i) === playing));
      });

      const panel = h('div', {
        class: 'sync-panel', tabindex: '0',
        onkeydown: (event) => {
          if (event.target.tagName === 'AUDIO') return;
          if (event.code === 'Space' || event.key === 'Enter') {
            event.preventDefault();
            tap();
          }
        },
      },
      h('p', { class: 'hint' }, 'Press ▶ then hit TAP (or the Space bar) the moment each line starts. Click any line later to fix its time.'),
      audio,
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: tap }, 'TAP — next line'),
        h('button', { class: 'btn small', type: 'button', onclick: undo }, 'Undo'),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => {
            timing = lines.map(() => null);
            timingTouched = true;
            next = nextIndex(0);
            audio.currentTime = 0;
            draw();
          },
        }, 'Start over'),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: () => {
            timing = null;
            timingTouched = true;
            intro();
            toast('Sync removed (saved when you press Save)');
          },
        }, 'Remove sync'),
        h('button', { class: 'btn small', type: 'button', onclick: intro }, 'Close')),
      status, list);
      wrap.replaceChildren(panel);
      draw();
      panel.focus();
    }

    intro();
    return wrap;
  }

  function waveTools() {
    if (!track || track.waveform) return null;
    if (!S.features.waveform) return h('p', { class: 'hint' }, `Waveform: ${MIGRATION_HINT}`);
    const note = h('p', { class: 'hint', role: 'status' });
    const button = h('button', {
      class: 'btn small', type: 'button', style: 'margin-top:12px',
      onclick: async () => {
        button.disabled = true;
        note.textContent = 'Reading the audio…';
        const ok = await makeWaveform(track);
        note.textContent = ok ? 'Waveform added.' : 'Could not read this file in your browser. Try Chrome or Edge.';
        button.hidden = ok;
        button.disabled = false;
      },
    }, 'Create waveform');
    return h('div', {}, button, note);
  }

  showMedia(track?.mediaUrl, track?.mediaType);
  updateCard();
  // Older video without a cover: offer one made from the video (saved with the next save).
  if (track?.mediaType === 'video' && !track.coverUrl) {
    autoCover(track.mediaUrl).then((blob) => blob && !cover.hasOwnImage() && cover.setAuto(blob));
  }
  for (const type of ['input', 'change', 'click', 'pointerup']) form.addEventListener(type, scheduleDraft);
  return h('div', { class: 'editor' }, form, previewCol);
}

// --------------------------------------------------------------- albums
views.albums = (editId) => {
  if (editId === 'new') return albumEditor(null);
  if (editId && S.albums.some((a) => a.id === editId)) return albumEditor(S.albums.find((a) => a.id === editId));
  const root = h('div', {}, head('Albums', 'Group tracks into collections. Albums appear on the site once they have a published track.',
    h('button', { class: 'btn primary', type: 'button', html: icon('plus'), onclick: () => openTab('albums', 'new') }, 'New album')));
  if (!S.albums.length) {
    root.append(h('p', { class: 'empty' }, 'No albums yet.'));
    return root;
  }
  root.append(h('div', { class: 'panel' }, h('ul', { class: 'list' }, ...S.albums.map((a) => {
    const count = S.tracks.filter((t) => t.album?.id === a.id).length;
    return h('li', { class: 'row' }, thumb(a),
      h('div', {}, h('div', { class: 'row-title' }, a.title), h('div', { class: 'row-sub' }, plural(count, 'track'), a.releaseDate ? ` · ${formatDate(a.releaseDate)}` : '')),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', html: icon('edit'), onclick: () => openTab('albums', a.id) }, 'Edit'),
        h('button', { class: 'btn small danger', type: 'button', html: icon('trash'), onclick: () => deleteAlbum(a) }, 'Delete')));
  }))));
  return root;
};

async function deleteAlbum(album) {
  if (!confirm(`Delete the album “${album.title}”? Its tracks stay on the site — they just won't be in an album.`)) return;
  try {
    await api(`/api/studio/albums/${album.id}`, { method: 'DELETE' });
    S.albums = S.albums.filter((a) => a.id !== album.id);
    await refreshTracks();
    toast('Album deleted');
    openTab('albums');
  } catch (e) {
    toast(e.message);
  }
}

function albumEditor(album) {
  const title = input({ maxlength: 120, value: album?.title || '', required: true });
  const description = textarea({ maxlength: 2000 }, album?.description);
  const releaseDate = input({ type: 'date', value: album?.releaseDate || '' });
  const cover = imagePicker({ label: 'Album cover', currentUrl: album?.coverUrl, hint: 'If empty, the first track cover is used.' });
  const status = h('p', { class: 'status', role: 'status' });

  async function save() {
    if (!title.value.trim()) return setStatus(status, 'Please add an album title.', 'error');
    setStatus(status, 'Saving…');
    try {
      const body = { title: title.value, description: description.value, releaseDate: releaseDate.value };
      const coverPath = await imageValue(cover, 'album');
      if (coverPath !== undefined) body.coverPath = coverPath;
      const saved = album
        ? await api(`/api/studio/albums/${album.id}`, { method: 'PATCH', body })
        : await api('/api/studio/albums', { method: 'POST', body });
      S.albums = await api('/api/studio/albums');
      await refreshTracks();
      toast('Album saved');
      openTab('albums', saved.id);
    } catch (e) {
      setStatus(status, e.message, 'error');
    }
  }

  const root = h('div', {},
    h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('h2', {}, album ? 'Edit album' : 'New album'),
      field('Album title *', title),
      field('Description', description, { optional: true }),
      field('Release date', releaseDate, { optional: true }),
      cover.el,
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save album'),
        album ? h('a', { class: 'btn', href: `/album/${album.id}`, target: '_blank', html: icon('eye') }, 'View') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => openTab('albums') }, 'Back')),
      status,
    ),
  );
  if (album) root.append(albumTracks(album));
  return root;
}

function albumTracks(album) {
  let order = S.tracks
    .filter((t) => t.album?.id === album.id)
    .sort((a, b) => (a.albumPosition ?? 1e9) - (b.albumPosition ?? 1e9));
  const list = h('ul', { class: 'list order-list' });
  const status = h('p', { class: 'status', role: 'status' });
  const others = S.tracks.filter((t) => t.album?.id !== album.id);
  const addSelect = select([['', 'Choose a track…'], ...others.map((t) => [t.id, `${t.title}${t.album ? ` (in ${t.album.title})` : ''}`])], '');

  function draw() {
    list.replaceChildren(...order.map((t, i) => h('li', { class: 'row' },
      h('span', { class: 'order-num' }, String(i + 1).padStart(2, '0')),
      h('div', {}, h('div', { class: 'row-title' }, t.title), h('div', { class: 'row-sub' }, h('span', { class: `pill ${t.status}` }, t.status), t.category)),
      h('div', { class: 'row-actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', html: icon('up'), disabled: i === 0, onclick: () => move(i, -1) }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move down', html: icon('down'), disabled: i === order.length - 1, onclick: () => move(i, 1) }),
        h('button', { class: 'btn small', type: 'button', onclick: () => setAlbum(t, '') }, 'Remove')),
    )));
    if (!order.length) list.append(h('li', { class: 'muted small' }, 'No tracks in this album yet.'));
  }
  function move(i, dir) {
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    draw();
  }
  async function saveOrder() {
    try {
      await api(`/api/studio/albums/${album.id}/order`, { method: 'PUT', body: { trackIds: order.map((t) => t.id) } });
      await refreshTracks();
      setStatus(status, 'Order saved.', 'ok');
    } catch (e) {
      setStatus(status, e.message, 'error');
    }
  }
  async function setAlbum(track, albumId) {
    try {
      await api(`/api/studio/tracks/${track.id}`, { method: 'PATCH', body: { albumId } });
      await refreshTracks();
      openTab('albums', album.id);
    } catch (e) {
      setStatus(status, e.message, 'error');
    }
  }
  draw();
  return h('div', { class: 'panel' },
    h('h3', {}, 'Tracks in this album'),
    h('p', { class: 'muted small' }, 'Use the arrows to set the running order, then save.'),
    list,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: saveOrder }, 'Save order'),
      addSelect,
      h('button', { class: 'btn', type: 'button', onclick: () => addSelect.value && setAlbum(S.tracks.find((t) => t.id === addSelect.value), album.id) }, 'Add to album')),
    status,
  );
}

// -------------------------------------------------------------- journey
views.journey = () => {
  const root = h('div', {}, head('Journey', 'Your progress, in your own words. Automatic milestones (first upload, 10th track, first mix…) are calculated from real uploads — nothing is made up.'));
  const published = S.tracks.filter((t) => t.status === 'published');
  const trackOptions = [['', 'Automatic (earliest vs latest)'], ...published.map((t) => [t.id, `${t.title}${t.recordedDate ? ` · ${t.recordedDate}` : ''}`])];

  // Then & now
  const early = select(trackOptions, S.profile.compareEarlyId || '');
  const recent = select(trackOptions, S.profile.compareRecentId || '');
  const compareStatus = h('p', { class: 'status', role: 'status' });
  root.append(h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        S.profile = await api('/api/studio/profile', { method: 'PATCH', body: { compareEarlyId: early.value, compareRecentId: recent.value } });
        setStatus(compareStatus, 'Saved.', 'ok');
      } catch (err) {
        setStatus(compareStatus, err.message, 'error');
      }
    },
  },
  h('h3', {}, 'Then & now'),
  h('p', { class: 'muted small' }, 'Pick an early take and a recent one for visitors to compare. Leave on automatic to use the earliest and latest dated recordings.'),
  h('div', { class: 'field-grid' }, field('Early take', early), field('Recent take', recent)),
  h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save comparison')),
  compareStatus));

  // Milestones
  const list = h('ul', { class: 'list' });
  const draw = () => {
    list.replaceChildren(...S.milestones.map((m) => h('li', { class: 'row no-thumb' },
      h('div', {}, h('div', { class: 'row-title' }, m.title), h('div', { class: 'row-sub' }, m.date ? formatDate(m.date) : 'No date', m.note ? ` · ${m.note.slice(0, 80)}` : '')),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => fill(m) }, 'Edit'),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            if (!confirm(`Delete milestone “${m.title}”?`)) return;
            await api(`/api/studio/milestones/${m.id}`, { method: 'DELETE' }).catch((e) => toast(e.message));
            S.milestones = S.milestones.filter((x) => x.id !== m.id);
            draw();
          },
        }, 'Delete')),
    )));
    if (!S.milestones.length) list.append(h('li', { class: 'muted small' }, 'No personal milestones yet.'));
  };

  let editing = null;
  const mTitle = input({ maxlength: 120, placeholder: 'e.g. First time recording with a live beat' });
  const mDate = input({ type: 'date' });
  const mNote = textarea({ maxlength: 1000, placeholder: 'What happened? Why does it matter to you?' });
  const mTrack = select([['', 'No linked track'], ...S.tracks.map((t) => [t.id, t.title])], '');
  const mStatus = h('p', { class: 'status', role: 'status' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Add milestone');
  function fill(m) {
    editing = m;
    mTitle.value = m?.title || '';
    mDate.value = m?.date || '';
    mNote.value = m?.note || '';
    mTrack.value = m?.trackId || '';
    submit.textContent = m ? 'Save milestone' : 'Add milestone';
    if (m) mTitle.focus();
  }

  draw();
  root.append(h('div', { class: 'panel' }, h('h3', {}, 'Your milestones'), list));
  root.append(h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = { title: mTitle.value, date: mDate.value, note: mNote.value, trackId: mTrack.value };
      try {
        const saved = editing
          ? await api(`/api/studio/milestones/${editing.id}`, { method: 'PATCH', body })
          : await api('/api/studio/milestones', { method: 'POST', body });
        S.milestones = editing ? S.milestones.map((m) => (m.id === saved.id ? saved : m)) : [...S.milestones, saved];
        fill(null);
        draw();
        setStatus(mStatus, 'Saved.', 'ok');
      } catch (err) {
        setStatus(mStatus, err.message, 'error');
      }
    },
  },
  h('h3', {}, 'Add a milestone'),
  field('Title *', mTitle),
  h('div', { class: 'field-grid' }, field('Date', mDate, { optional: true }), field('Linked track', mTrack, { optional: true })),
  field('Note', mNote, { optional: true }),
  h('div', { class: 'form-actions' }, submit, h('button', { class: 'btn', type: 'button', onclick: () => fill(null) }, 'Clear')),
  mStatus));
  return root;
};

// -------------------------------------------------------------- profile
views.profile = () => {
  const p = S.profile;
  const artistName = input({ maxlength: 60, value: p.artistName || 'Surgthflur', required: true });
  const tagline = input({ maxlength: 140, value: p.tagline || '', placeholder: 'Shown under the big headline on the homepage' });
  const bio = textarea({ maxlength: 2000, placeholder: 'Introduce yourself in your own words' }, p.bio);
  const siteIntro = textarea({ maxlength: 2000, placeholder: 'Why did you make this site?' }, p.siteIntro);
  const tiktok = input({ type: 'url', value: p.tiktokUrl || '', placeholder: 'https://www.tiktok.com/@…' });
  const youtube = input({ type: 'url', value: p.youtubeUrl || '', placeholder: 'https://www.youtube.com/@…' });
  const facebook = input({ type: 'url', value: p.facebookUrl || '', placeholder: 'https://www.facebook.com/…' });
  const photo = imagePicker({ label: 'Profile photo', currentUrl: p.photoUrl, round: true });
  const featured = select([['', 'Newest upload (automatic)'], ...S.tracks.filter((t) => t.status === 'published').map((t) => [t.id, t.title])], p.featuredTrackId || '', { disabled: !S.features.featured });
  const status = h('p', { class: 'status', role: 'status' });

  return h('div', {}, head('Profile', 'Everything here is optional. Social links only show on the site if you add them.'),
    h('form', {
      class: 'panel',
      onsubmit: async (e) => {
        e.preventDefault();
        setStatus(status, 'Saving…');
        try {
          const body = {
            artistName: artistName.value, tagline: tagline.value, bio: bio.value, siteIntro: siteIntro.value,
            tiktokUrl: tiktok.value, youtubeUrl: youtube.value, facebookUrl: facebook.value,
          };
          if (S.features.featured) body.featuredTrackId = featured.value;
          const photoPath = await imageValue(photo, 'photo');
          if (photoPath !== undefined) body.photoPath = photoPath;
          S.profile = await api('/api/studio/profile', { method: 'PATCH', body });
          toast('Profile saved');
          openTab('profile');
        } catch (err) {
          setStatus(status, err.message, 'error');
        }
      },
    },
    photo.el,
    h('div', { class: 'field-grid' }, field('Artist name *', artistName), field('Homepage tagline', tagline, { optional: true })),
    field('Featured on the homepage', featured, { optional: true, hint: S.features.featured ? 'The track in the big spinning record. Automatic = always the newest upload.' : 'Needs database update 003: run supabase/migrations/003_featured_and_announcements.sql in Supabase.' }),
    field('About Surgthflur', bio, { optional: true }),
    field('About this site', siteIntro, { optional: true }),
    field('TikTok link', tiktok, { optional: true }),
    field('YouTube link', youtube, { optional: true }),
    field('Facebook link', facebook, { optional: true }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save profile')),
    status));
};

// ----------------------------------------------------------- categories
views.categories = () => {
  const root = h('div', {}, head('Categories', 'The filter buttons visitors see. Add new ones any time.'));
  const list = h('ul', { class: 'list' }, ...S.categories.map((c) => {
    const name = input({ value: c.name, maxlength: 40, 'aria-label': 'Category name' });
    const used = S.tracks.filter((t) => t.categoryId === c.id).length;
    return h('li', { class: 'row no-thumb' },
      h('div', { class: 'field', style: 'margin:0' }, name, h('p', { class: 'hint' }, plural(used, 'track'))),
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn small', type: 'button',
          onclick: async () => {
            try {
              await api(`/api/studio/categories/${c.id}`, { method: 'PATCH', body: { name: name.value } });
              S.categories = await api('/api/studio/categories');
              await refreshTracks();
              toast('Category renamed');
            } catch (e) {
              toast(e.message);
            }
          },
        }, 'Rename'),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            if (!confirm(`Delete the category “${c.name}”?`)) return;
            try {
              await api(`/api/studio/categories/${c.id}`, { method: 'DELETE' });
              S.categories = S.categories.filter((x) => x.id !== c.id);
              openTab('categories');
            } catch (e) {
              toast(e.message);
            }
          },
        }, 'Delete')));
  }));
  const newName = input({ maxlength: 40, placeholder: 'e.g. Live session' });
  root.append(h('div', { class: 'panel' }, list), h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/api/studio/categories', { method: 'POST', body: { name: newName.value } });
        S.categories = await api('/api/studio/categories');
        openTab('categories');
      } catch (err) {
        toast(err.message);
      }
    },
  }, field('New category', newName), h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add category'))));
  return root;
};

// ------------------------------------------------------------ followers
views.followers = () => {
  const root = h('div', {}, head('Followers', 'People who asked for email updates about new music.',
    h('a', { class: 'btn', href: '/api/studio/subscribers.csv', html: icon('download') }, 'Download CSV')));
  const body = h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Loading…'));
  root.append(body, h('div', { class: 'panel' },
    h('h3', {}, 'New-release emails'),
    h('p', { class: 'muted small' }, {
      ready: '✔ Ready. When you publish a track, tick “Email followers when this is published” and everyone here gets a message with a Listen button and an unsubscribe link.',
      'needs-migration': 'Almost ready: run supabase/migrations/003_featured_and_announcements.sql in the Supabase SQL Editor.',
      'not-configured': 'Not set up yet. Add RESEND_API_KEY and EMAIL_FROM to the server settings (see README → New-release emails). Until then you can download the CSV above and use any mailing tool.',
    }[S.features.emailSetup] || '')));
  api('/api/studio/subscribers').then((rows) => {
    if (!rows.length) {
      body.replaceChildren(h('p', { class: 'muted' }, 'No followers yet. The follow form is at the bottom of the homepage.'));
      return;
    }
    body.replaceChildren(h('p', { class: 'muted small' }, plural(rows.length, 'follower')), h('div', { class: 'table-wrap' }, h('table', { class: 'simple' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Joined'), h('th', {}, ''))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', {}, r.email), h('td', {}, formatDate(r.createdAt)),
        h('td', {}, h('button', {
          class: 'btn small danger', type: 'button',
          onclick: async () => {
            if (!confirm(`Remove ${r.email}?`)) return;
            await api(`/api/studio/subscribers/${r.id}`, { method: 'DELETE' }).catch((e) => toast(e.message));
            openTab('followers');
          },
        }, 'Remove'))))))));
  }).catch((e) => body.replaceChildren(h('p', { class: 'status error' }, e.message)));
  return root;
};

// -------------------------------------------------------------- account
views.account = () => {
  const current = input({ type: 'password', autocomplete: 'current-password', required: true });
  const next = input({ type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const status = h('p', { class: 'status', role: 'status' });
  return h('div', {}, head('Account', `Signed in as ${S.email}`),
    h('form', {
      class: 'panel',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('/api/auth/password', { method: 'POST', body: { current: current.value, next: next.value } });
          current.value = '';
          next.value = '';
          setStatus(status, 'Password changed.', 'ok');
        } catch (err) {
          setStatus(status, err.message, 'error');
        }
      },
    },
    h('h3', {}, 'Change password'),
    field('Current password', current),
    field('New password', next, { hint: 'At least 10 characters. A short sentence is easy to remember and hard to guess.' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Change password')),
    status),
    h('div', { class: 'panel' }, h('h3', {}, 'Sign out'), h('p', { class: 'muted small' }, 'Sign out on shared computers.'),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', onclick: logout }, 'Sign out'))));
};

// ================================================================= auth
function showLogin(message = '') {
  $('#loading').hidden = true;
  $('#app').hidden = true;
  $('#logout').hidden = true;
  $('#login').hidden = false;
  setStatus($('#login-message'), message, 'error');
  $('#login-email').focus();
}

async function showApp() {
  $('#login').hidden = true;
  $('#loading').hidden = false;
  try {
    await loadAll();
  } catch (e) {
    $('#loading').textContent = e.message;
    return;
  }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  $('#logout').hidden = false;
  const [tab, sub] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (views[tab]) openTab(tab, ...(sub ? [sub] : []));
  else openTab('overview');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  S.email = null;
  showLogin();
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  button.disabled = true;
  setStatus($('#login-message'), '');
  try {
    const me = await api('/api/auth/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
    S.email = me.email;
    form.password.value = '';
    showApp();
  } catch (e) {
    setStatus($('#login-message'), e.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', logout);
addEventListener('beforeunload', (event) => {
  if (S.editorDirty?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
$('#tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (button) openTab(button.dataset.tab);
});

(async function boot() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      S.email = data.email;
      showApp();
    } else {
      showLogin(response.status === 503 ? data.error : '');
    }
  } catch {
    showLogin('Could not reach the server.');
  }
}());
