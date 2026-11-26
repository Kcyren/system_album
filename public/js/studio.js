import { icon, hydrateIcons, h, formatDuration, formatDate, plural, artFor, trackCard } from './ui.js';

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
  return h('div', { class: 'thumb' }, artFor(item, { alt: false }));
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
  file.addEventListener('change', () => {
    const chosen = file.files[0];
    if (chosen) {
      img.src = URL.createObjectURL(chosen);
      img.hidden = false;
      remove.checked = false;
    }
  });
  remove.addEventListener('change', () => {
    img.hidden = remove.checked || (!file.files[0] && !currentUrl);
  });
  const wrap = field(label, file, { optional: true, hint });
  wrap.append(h('div', { class: `img-preview${round ? ' round' : ''}` }, img, removeLabel));
  return {
    el: wrap,
    file: () => file.files[0] || null,
    removed: () => remove.checked,
    onChange: (fn) => {
      file.addEventListener('change', fn);
      remove.addEventListener('change', fn);
    },
    previewUrl: () => (remove.checked ? null : file.files[0] ? img.src : currentUrl || null),
  };
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
  panel.replaceChildren(views[tab](...args));
  hydrateIcons(panel);
  history.replaceState(null, '', `#${tab}`);
}

function head(title, text, ...actions) {
  return h('div', { class: 'panel-head' },
    h('div', {}, h('h1', {}, title), text ? h('p', {}, text) : null),
    actions.length ? h('div', { class: 'row-actions' }, ...actions) : null,
  );
}

// ------------------------------------------------------------- overview
views.overview = () => {
  const root = h('div', {}, head('Hey, welcome back.', 'Here is how System Album is doing.',
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
  if (editId) return trackEditor(editId === 'new' ? null : S.tracks.find((t) => t.id === editId));
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
        h('span', {}, t.category),
        t.album ? h('span', {}, t.album.title) : null,
        t.recordedDate ? h('span', {}, formatDate(t.recordedDate)) : null,
        t.status === 'published' ? h('span', {}, plural(t.plays, 'play')) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('a', { class: 'btn small', href: `/track/${t.id}`, target: '_blank', html: icon('eye') }, t.status === 'draft' ? 'Preview' : 'View'),
      h('button', { class: 'btn small', type: 'button', html: icon('edit'), onclick: () => openTab('tracks', t.id) }, 'Edit'),
      h('button', { class: 'btn small danger', type: 'button', html: icon('trash'), onclick: () => deleteTrack(t) }, 'Delete'),
    ),
  )));
  root.append(h('div', { class: 'panel' }, list));
  return root;
};

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
  const cover = imagePicker({ label: 'Cover image', currentUrl: track?.coverUrl, hint: 'Square images look best. If you skip this, a System Album cover is generated.' });
  const description = textarea({ maxlength: 2000, placeholder: 'What is this track about?' }, track?.description);
  const howMade = textarea({ maxlength: 2000, placeholder: 'The beat, your mood, what you tried…' }, track?.howMade);
  const progressNote = textarea({ maxlength: 1000, placeholder: 'What changed compared to before? What did you learn?' }, track?.progressNote);
  const lyrics = textarea({ maxlength: 10000, rows: 8, placeholder: 'Your bars, line by line', disabled: !S.features.lyrics }, track?.lyrics);
  const date = input({ type: 'date', value: track?.recordedDate || '' });
  const time = input({ type: 'time', value: track?.recordedTime || '' });
  const album = select([['', 'No album'], ...S.albums.map((a) => [a.id, a.title])], track?.album?.id || '');

  const mediaPreview = h('div', { class: 'preview-media' });
  const cardPreview = h('div', { class: 'preview-card' });
  const progress = h('div', { class: 'progress', hidden: true }, h('i'));
  const status = h('p', { class: 'status', role: 'status' });

  function showMedia(url, type) {
    if (!url) {
      mediaPreview.replaceChildren();
      return;
    }
    const el = type === 'video'
      ? h('video', { src: url, controls: true, playsinline: true, preload: 'metadata', poster: cover.previewUrl() })
      : h('audio', { src: url, controls: true, preload: 'metadata' });
    el.addEventListener('loadedmetadata', () => {
      if (mediaFile.files[0]) duration = el.duration;
      updateCard();
    });
    mediaPreview.replaceChildren(el);
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
      duration: duration || track?.duration || null,
      plays: track?.plays || 0,
      publishedAt: track?.publishedAt || new Date().toISOString(),
    };
    cardPreview.replaceChildren(trackCard(preview, { href: null, preview: false }));
  }

  mediaFile.addEventListener('change', () => {
    const chosen = mediaFile.files[0];
    if (localMediaUrl) URL.revokeObjectURL(localMediaUrl);
    localMediaUrl = chosen ? URL.createObjectURL(chosen) : null;
    duration = null;
    wavePromise = chosen && S.features.waveform ? computeWaveform(chosen) : null;
    showMedia(localMediaUrl || track?.mediaUrl, currentType());
    if (chosen && !title.value.trim()) title.value = chosen.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120);
    updateCard();
  });
  for (const el of [title, category, description, date]) el.addEventListener('input', updateCard);
  cover.onChange(updateCard);

  async function save(nextStatus) {
    setStatus(status, '');
    if (!title.value.trim()) return setStatus(status, 'Please add a title.', 'error');
    if (!category.value) return setStatus(status, 'Please choose a category.', 'error');
    if (isNew && !mediaFile.files[0]) return setStatus(status, 'Please choose an audio or video file.', 'error');

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
      await refreshTracks();
      toast(nextStatus === 'published' ? 'Published! It is live on System Album.' : 'Saved as a draft');
      openTab('tracks', saved.id);
    } catch (e) {
      setStatus(status, e.message, 'error');
      progress.hidden = true;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  const published = track?.status === 'published';
  const actions = h('div', { class: 'form-actions' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => save('published') }, published ? 'Save changes' : 'Publish'),
    h('button', { class: 'btn', type: 'button', onclick: () => save('draft') }, published ? 'Unpublish (make draft)' : 'Save draft'),
    track ? h('a', { class: 'btn', href: `/track/${track.id}`, target: '_blank', html: icon('eye') }, published ? 'View on site' : 'Preview on site') : null,
    h('button', { class: 'btn', type: 'button', onclick: () => openTab('tracks') }, 'Back'),
  );

  const form = h('form', { class: 'panel', onsubmit: (e) => { e.preventDefault(); save(published ? 'published' : 'draft'); } },
    h('h2', {}, isNew ? 'New recording' : 'Edit recording'),
    h('p', { class: 'muted' }, 'Only title, category and the file are required. Everything else is up to you.'),
    field('Title *', title),
    field('Category *', category),
    field(isNew ? 'Audio or video file *' : 'Replace audio or video', mediaFile, {
      optional: !isNew,
      hint: 'MP3, M4A, WAV, OGG, FLAC, MP4, WEBM or MOV. Keep files under your storage plan limit (50 MB on Supabase Free).',
    }),
    cover.el,
    field('About this track', description, { optional: true }),
    field('How it was made', howMade, { optional: true }),
    field('Progress note', progressNote, { optional: true, hint: 'Shown on the Journey section and the track page.' }),
    field('Lyrics / bars', lyrics, { optional: true, hint: S.features.lyrics ? 'Shown on the track page and in the full-screen player. Searchable.' : MIGRATION_HINT }),
    h('div', { class: 'field-grid' }, field('Recording date', date, { optional: true }), field('Recording time', time, { optional: true })),
    field('Album', album, { optional: true }),
    progress,
    actions,
    status,
  );

  const previewCol = h('div', { class: 'preview-col' },
    h('div', { class: 'panel' }, h('h3', {}, 'Listen back'), h('p', { class: 'muted small' }, 'Check your recording before you publish.'), mediaPreview, waveTools()),
    h('div', { class: 'panel' }, h('h3', {}, 'Card preview'), h('p', { class: 'muted small' }, 'How it will look on the site.'), cardPreview),
  );

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
  return h('div', { class: 'editor' }, form, previewCol);
}

// --------------------------------------------------------------- albums
views.albums = (editId) => {
  if (editId) return albumEditor(editId === 'new' ? null : S.albums.find((a) => a.id === editId));
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
  const siteIntro = textarea({ maxlength: 2000, placeholder: 'Why did you make System Album?' }, p.siteIntro);
  const tiktok = input({ type: 'url', value: p.tiktokUrl || '', placeholder: 'https://www.tiktok.com/@…' });
  const youtube = input({ type: 'url', value: p.youtubeUrl || '', placeholder: 'https://www.youtube.com/@…' });
  const facebook = input({ type: 'url', value: p.facebookUrl || '', placeholder: 'https://www.facebook.com/…' });
  const photo = imagePicker({ label: 'Profile photo', currentUrl: p.photoUrl, round: true });
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
    field('About Surgthflur', bio, { optional: true }),
    field('About System Album', siteIntro, { optional: true }),
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
    h('h3', {}, 'Sending updates'),
    h('p', { class: 'muted small' }, 'Emails are not sent automatically yet. Download the CSV (it includes a personal unsubscribe link for each person) and import it into a mailing tool such as Brevo, MailerLite or Buttondown — or ask to connect one so new releases email followers automatically.')));
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
  const tab = location.hash.slice(1);
  openTab(views[tab] ? tab : 'overview');
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
