import { icon, hydrateIcons, h, formatDuration, formatDate, formatTime, plural, artFor, trackCard, waveform } from './ui.js';
import { initFx, fxGesture, watchLeds } from './fx.js';
import { makeStoryCard } from './story.js';

const $ = (selector) => document.querySelector(selector);
const LATEST_COUNT = 4;
const DISCOVER_COUNT = 8;

const state = {
  profile: null,
  categories: [],
  tracks: [],
  albums: [],
  journey: null,
  filter: 'All',
  query: '',
  discoverIds: [],
  homeScroll: 0,
  features: {},
  trackPoll: 0,
  loaded: false,
};

// ------------------------------------------------------------- utilities
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.setup = data.setup;
    throw error;
  }
  return data;
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode or storage blocked — fine, this is only a convenience
    }
  },
};

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const trackById = (id) => state.tracks.find((t) => t.id === id);
const absoluteUrl = (path) => new URL(path, location.origin).href;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = () => Boolean(navigator.connection?.saveData);

// ================================================================ player
const media = $('#media');
const playerEl = $('#player');
const player = { queue: [], index: -1, track: null, listened: 0, lastTime: 0, counted: false, pendingSeek: null, lyricIndex: -2 };

function setPlayIcon(button, playing) {
  button.innerHTML = icon(playing ? 'pause' : 'play');
  button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

// at: optional start position (0–1), e.g. when a waveform is clicked.
function playTrack(track, queue, at = null) {
  fxGesture(); // start the LED/beat effects from this click
  if (player.track?.id === track.id) {
    if (at !== null) seekTo(at);
    else togglePlay();
    return;
  }
  player.pendingSeek = at;
  player.queue = queue?.length ? queue : [track];
  player.index = Math.max(0, player.queue.findIndex((t) => t.id === track.id));
  load(player.queue[player.index], true);
}

function seekTo(fraction) {
  if (media.duration) media.currentTime = fraction * media.duration;
  if (media.paused) media.play().catch(() => {});
}

function updateWaves() {
  if (!player.track || !media.duration) return;
  const fraction = media.currentTime / media.duration;
  document.querySelectorAll(`.wave[data-wave="${player.track.id}"]`).forEach((el) => el.setProgress(fraction));
}

// ---------------------------------------------------------- synced lyrics
// Lines light up karaoke-style when the track has timings (set in the Studio).
function lyricLines(track) {
  return track.lyrics.split(/\r?\n/).map((line, i) => h('span', {
    class: 'ly-line', 'data-i': String(i), 'data-t': track.lyricsTiming?.[i] ?? '',
  }, line || '\u00a0'));
}

function seekToLyric(track, seconds) {
  if (player.track?.id === track.id) {
    media.currentTime = seconds;
    if (media.paused) media.play().catch(() => {});
  } else {
    playTrack(track, [track], track.duration ? Math.min(0.999, seconds / track.duration) : null);
  }
}

function onLyricClick(track) {
  return (event) => {
    const line = event.target.closest('.ly-line');
    if (!line || line.dataset.t === '') return;
    seekToLyric(track, Number(line.dataset.t));
  };
}

function updateLyrics(force = false) {
  const track = player.track;
  if (!track?.lyricsTiming) return;
  const now = media.currentTime;
  let active = -1;
  track.lyricsTiming.forEach((start, i) => {
    if (start !== null && start <= now + 0.15) active = i;
  });
  if (active === player.lyricIndex && !force) return;
  player.lyricIndex = active;
  document.querySelectorAll(`[data-lyrics="${track.id}"]`).forEach((box) => {
    box.querySelectorAll('.ly-line').forEach((line) => {
      const i = Number(line.dataset.i);
      line.classList.toggle('active', i === active);
      line.classList.toggle('done', i < active);
    });
    const line = box.querySelector('.ly-line.active');
    const scroller = box.closest('.np-lyrics') || box;
    if (line && scroller.scrollHeight > scroller.clientHeight) {
      scroller.scrollTo({ top: line.offsetTop - scroller.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
    }
  });
}

// --------------------------------------------------------- live listeners
// While a track plays, the player checks in every 20 seconds.
const live = { timer: 0, trackId: null };

function showLive(trackId, count) {
  const text = count >= 2 ? `${count} listening now` : '';
  document.querySelectorAll(`[data-live="${trackId}"]`).forEach((el) => {
    el.hidden = !text;
    el.textContent = text;
  });
  if (player.track?.id === trackId) {
    const np = $('#np-live');
    np.hidden = !text;
    np.replaceChildren(text ? h('span', { class: 'live' }, text) : '');
  }
}

function checkIn(trackId, stop = false, keepalive = false) {
  if (!state.features.listeners || !trackId) return;
  fetch(`/api/listening/${trackId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor: visitorId(), stop }),
    keepalive,
  }).then((r) => r.json()).then((r) => typeof r.count === 'number' && showLive(trackId, r.count)).catch(() => {});
}

function startLive() {
  const track = player.track;
  if (!track || track.status === 'draft') return;
  if (live.trackId && live.trackId !== track.id) checkIn(live.trackId, true);
  live.trackId = track.id;
  clearInterval(live.timer);
  checkIn(track.id);
  live.timer = setInterval(() => checkIn(track.id), 20000);
}

function stopLive() {
  clearInterval(live.timer);
  if (live.trackId) checkIn(live.trackId, true);
  live.trackId = null;
}

addEventListener('pagehide', () => {
  if (live.trackId) checkIn(live.trackId, true, true);
});

function load(track, autoplay) {
  player.track = track;
  player.lyricIndex = -2;
  player.listened = 0;
  player.lastTime = 0;
  player.counted = false;

  const isVideo = track.mediaType === 'video';
  media.src = track.mediaUrl;
  media.poster = isVideo && track.coverUrl ? track.coverUrl : '';
  playerEl.classList.toggle('is-video', isVideo);
  $('#np-art').replaceChildren(artFor(track));
  const title = $('#np-title');
  title.textContent = track.title;
  title.href = track.status === 'draft' ? location.pathname : `/track/${track.id}`;
  $('#np-sub').textContent = [state.profile?.artistName || 'Surgthflur', track.album?.title || track.category].filter(Boolean).join(' · ');
  const wave = $('#np-wave');
  wave.hidden = !track.waveform;
  wave.replaceChildren();
  if (track.waveform) {
    const el = waveform(track.waveform, { onSeek: seekTo });
    el.dataset.wave = track.id;
    wave.append(el);
  }
  $('#np-lyrics').hidden = !track.lyrics;
  const npLyrics = $('#np-lyrics-text');
  npLyrics.className = track.lyricsTiming ? 'synced' : '';
  npLyrics.dataset.lyrics = track.lyricsTiming ? track.id : '';
  npLyrics.onclick = track.lyricsTiming ? onLyricClick(track) : null;
  if (track.lyricsTiming) npLyrics.replaceChildren(...lyricLines(track));
  else npLyrics.textContent = track.lyrics || '';
  $('#np-live').hidden = true;
  $('#btn-prev').disabled = player.index <= 0 && player.queue.length <= 1;
  $('#btn-next').disabled = player.index >= player.queue.length - 1;

  playerEl.hidden = false;
  document.body.classList.add('has-player');
  markCurrent();
  updateMediaSession(track);

  // A video plays best in the big view; audio stays in the mini player.
  if (isVideo) setExpanded(true);

  if (autoplay) {
    media.play().catch(() => toast('Press play to start listening'));
  }
}

function togglePlay() {
  if (!player.track) return;
  fxGesture();
  if (media.paused) media.play().catch(() => {});
  else media.pause();
}

function step(direction) {
  const next = player.index + direction;
  if (direction < 0 && media.currentTime > 3) {
    media.currentTime = 0;
    return;
  }
  if (next < 0 || next >= player.queue.length) return;
  player.pendingSeek = null;
  player.index = next;
  load(player.queue[next], true);
}

function closePlayer() {
  stopLive();
  media.pause();
  media.removeAttribute('src');
  media.load();
  player.track = null;
  setExpanded(false);
  playerEl.hidden = true;
  document.body.classList.remove('has-player', 'is-playing');
  markCurrent();
}

function setExpanded(open) {
  playerEl.classList.toggle('expanded', open);
  document.body.classList.toggle('player-open', open);
  if (open) $('#btn-collapse').focus({ preventScroll: true });
}

function markCurrent() {
  const id = player.track?.id;
  document.querySelectorAll('[data-track]').forEach((el) => el.classList.toggle('is-current', el.dataset.track === id));
  document.querySelectorAll('[data-play-for]').forEach((button) => {
    const playing = button.dataset.playFor === id && !media.paused;
    button.innerHTML = icon(playing ? 'pause' : 'play') + (button.dataset.label ? `<span>${playing ? 'Pause' : button.dataset.label}</span>` : '');
  });
  document.querySelectorAll('.card[data-track] .cover-btn').forEach((button) => {
    const playing = button.closest('[data-track]').dataset.track === id && !media.paused;
    button.innerHTML = icon(playing ? 'pause' : 'play');
  });
}

function setFill(range) {
  const pct = ((range.value - range.min) / (range.max - range.min)) * 100 || 0;
  range.style.setProperty('--fill', `${pct}%`);
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: state.profile?.artistName || 'Surgthflur',
    album: track.album?.title || 'Surgthflur - Music',
    artwork: [{ src: track.coverUrl || '/icons/icon-512.png', sizes: '512x512' }],
  });
  const handlers = {
    play: () => media.play(),
    pause: () => media.pause(),
    previoustrack: () => step(-1),
    nexttrack: () => step(1),
    seekto: (details) => { media.currentTime = details.seekTime; },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // action not supported in this browser
    }
  }
}

function countPlay(track) {
  if (track.status === 'draft') return;
  api(`/api/plays/${track.id}`, { method: 'POST' })
    .then((result) => {
      if (result.counted && typeof result.plays === 'number') {
        const local = trackById(track.id);
        if (local) local.plays = result.plays;
      }
    })
    .catch(() => {});
}

function setupPlayer() {
  // Needed so the LED effects can "hear" the music (Supabase allows this).
  media.crossOrigin = 'anonymous';
  initFx(media);
  const seek = $('#seek');
  const volume = $('#volume');
  let seeking = false;

  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  $('#btn-close').addEventListener('click', closePlayer);
  $('#btn-expand').addEventListener('click', () => setExpanded(true));
  $('#btn-collapse').addEventListener('click', () => setExpanded(false));
  $('#np-stage').addEventListener('click', () => {
    if (!playerEl.classList.contains('expanded')) setExpanded(true);
  });
  $('#np-title').addEventListener('click', () => setExpanded(false));

  $('#btn-mute').addEventListener('click', () => {
    media.muted = !media.muted;
  });
  volume.addEventListener('input', () => {
    media.volume = volume.value / 100;
    media.muted = media.volume === 0;
    setFill(volume);
  });
  setFill(volume);

  seek.addEventListener('input', () => {
    seeking = true;
    setFill(seek);
    if (media.duration) $('#t-cur').textContent = formatDuration((seek.value / 1000) * media.duration);
  });
  seek.addEventListener('change', () => {
    if (media.duration) media.currentTime = (seek.value / 1000) * media.duration;
    seeking = false;
  });

  media.addEventListener('play', () => {
    startLive();
    setPlayIcon($('#btn-play'), true);
    document.body.classList.add('is-playing');
    markCurrent();
  });
  media.addEventListener('pause', () => {
    stopLive();
    setPlayIcon($('#btn-play'), false);
    document.body.classList.remove('is-playing');
    markCurrent();
  });
  media.addEventListener('loadedmetadata', () => {
    $('#t-dur').textContent = formatDuration(media.duration);
    if (player.pendingSeek !== null) {
      media.currentTime = player.pendingSeek * media.duration;
      player.pendingSeek = null;
    }
  });
  media.addEventListener('timeupdate', () => {
    const delta = media.currentTime - player.lastTime;
    if (delta > 0 && delta < 1.5) player.listened += delta; // only real listening, not skipping
    player.lastTime = media.currentTime;
    if (!player.counted && player.track && player.listened >= Math.min(5, (media.duration || 10) * 0.5)) {
      player.counted = true;
      countPlay(player.track);
    }
    if (!seeking && media.duration) {
      seek.value = Math.round((media.currentTime / media.duration) * 1000);
      setFill(seek);
      $('#t-cur').textContent = formatDuration(media.currentTime);
    }
    updateWaves();
    updateLyrics();
  });
  media.addEventListener('volumechange', () => {
    $('#btn-mute').innerHTML = icon(media.muted || media.volume === 0 ? 'mute' : 'volume');
    $('#btn-mute').setAttribute('aria-label', media.muted ? 'Unmute' : 'Mute');
  });
  media.addEventListener('ended', () => {
    // Next track in the queue, otherwise stay put showing the end (press play to replay).
    if (player.index < player.queue.length - 1) step(1);
  });
  media.addEventListener('error', () => {
    if (!player.track) return;
    playerEl.classList.remove('is-video'); // show the artwork instead of a black box
    toast('This recording could not be loaded. Please try again in a moment.');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && playerEl.classList.contains('expanded')) setExpanded(false);
    const typing = /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (event.code === 'Space' && player.track && !typing) {
      event.preventDefault();
      togglePlay();
    }
  });
}

// ============================================ muted video previews on cards
// Short videos play silently while they're on screen and pause when they
// leave — browsers allow muted autoplay. Sound starts only when the visitor
// presses play.
const videoObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting && !document.hidden) {
        if (!video.src) {
          video.src = video.dataset.src;
          video.preload = 'metadata';
        }
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, { threshold: 0.35 })
  : null;

function watchVideos(root) {
  if (!videoObserver || reducedMotion.matches || saveData()) return;
  root.querySelectorAll('video.card-video').forEach((video) => videoObserver.observe(video));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('video.card-video').forEach((v) => v.pause());
});

// ================================================================= share
let shareTarget = null;
let shareStoryTrack = null;

// ------------------------------------------------------------- story card
async function openStory(track) {
  let dialog = $('#story-dialog');
  if (!dialog) {
    dialog = h('dialog', { class: 'story-dialog', id: 'story-dialog', 'aria-labelledby': 'story-title' },
      h('div', { class: 'share-head' },
        h('h3', { id: 'story-title' }, 'Story card'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dialog.close() })),
      h('p', { class: 'muted small', id: 'story-note' }, ''),
      h('img', { id: 'story-img', alt: 'Story card preview' }),
      h('div', { class: 'buttons' },
        h('a', { class: 'btn primary', id: 'story-download', html: icon('download') }, 'Download'),
        h('button', { class: 'btn', type: 'button', id: 'story-share', html: icon('share'), hidden: true }, 'Share')));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  const img = $('#story-img');
  const download = $('#story-download');
  const shareBtn = $('#story-share');
  $('#story-note').textContent = 'Making your story card…';
  img.removeAttribute('src');
  download.removeAttribute('href');
  shareBtn.hidden = true;
  dialog.showModal();

  const blob = await makeStoryCard(track, {
    artist: state.profile?.artistName || 'Surgthflur',
    url: absoluteUrl(`/track/${track.id}`),
    fire: document.documentElement.classList.contains('fire'),
  });
  if (!blob) {
    $('#story-note').textContent = 'Sorry, the story card could not be made in this browser.';
    return;
  }
  const url = URL.createObjectURL(blob);
  const name = `surgthflur-${track.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'track'}.png`;
  img.src = url;
  download.href = url;
  download.download = name;
  $('#story-note').textContent = 'Post it to your Instagram, TikTok or Facebook story. Add the link sticker with the track link!';
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    shareBtn.hidden = false;
    shareBtn.onclick = () => navigator.share({ files: [file], title: track.title, text: absoluteUrl(`/track/${track.id}`) }).catch(() => {});
  }
}

function openShare(item, kind = 'track') {
  $('#share-story').hidden = kind !== 'track';
  shareStoryTrack = kind === 'track' ? item : null;
  const url = absoluteUrl(`/${kind}/${item.id}`);
  const text = `${item.title} — ${state.profile?.artistName || 'Surgthflur'} on Surgthflur - Music`;
  shareTarget = { url, text, title: item.title };
  $('#share-track').textContent = item.title;
  $('#share-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  $('#share-facebook').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  $('#share-native').hidden = !navigator.share;
  const dialog = $('#share-dialog');
  if (dialog.showModal) dialog.showModal();
  else copyLink(url);
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

function setupShare() {
  const dialog = $('#share-dialog');
  $('#share-copy').addEventListener('click', () => {
    copyLink(shareTarget.url);
    dialog.close();
  });
  $('#share-story').addEventListener('click', () => {
    dialog.close();
    if (shareStoryTrack) openStory(shareStoryTrack);
  });
  $('#share-native').addEventListener('click', async () => {
    dialog.close();
    try {
      await navigator.share({ title: shareTarget.title, text: shareTarget.text, url: shareTarget.url });
    } catch {
      // cancelled
    }
  });
  for (const id of ['#share-whatsapp', '#share-facebook']) $(id).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ============================================================= reactions
function visitorId() {
  let id = store.get('sa_visitor', null);
  if (!id) {
    id = crypto.randomUUID();
    store.set('sa_visitor', id);
  }
  return id;
}

function reactionButton(track, kind) {
  const emoji = kind === 'fire' ? '🔥' : '❤️';
  const key = `${track.id}:${kind}`;
  const reacted = new Set(store.get('sa_reacted', []));
  const count = h('span', {}, String(track.reactions?.[kind] || 0));
  const button = h('button', {
    class: 'react', type: 'button', 'aria-pressed': String(reacted.has(key)),
    'aria-label': `${kind === 'fire' ? 'Fire' : 'Love'} reaction`,
  }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), count);

  button.addEventListener('click', async () => {
    const set = new Set(store.get('sa_reacted', []));
    const active = !set.has(key);
    button.setAttribute('aria-pressed', String(active));
    button.classList.remove('pop');
    if (active) requestAnimationFrame(() => button.classList.add('pop'));
    try {
      const result = await api(`/api/reactions/${track.id}`, {
        method: 'POST',
        body: JSON.stringify({ kind, visitor: visitorId(), active }),
      });
      count.textContent = String(result.count);
      track.reactions[kind] = result.count;
      if (active) set.add(key);
      else set.delete(key);
      store.set('sa_reacted', [...set]);
    } catch (error) {
      button.setAttribute('aria-pressed', String(!active));
      toast(error.message);
    }
  });
  return button;
}

// ================================================================== home
function cardFor(track, queue) {
  return trackCard(track, {
    onPlay: (t) => playTrack(t, queue),
    onShare: (t) => openShare(t),
  });
}

function fillGrid(grid, tracks, emptyMessage) {
  grid.replaceChildren(...(tracks.length ? tracks.map((t) => cardFor(t, tracks)) : [h('p', { class: 'empty' }, emptyMessage)]));
  watchVideos(grid);
  markCurrent();
}

function pickDiscover(pool) {
  if (pool.length <= DISCOVER_COUNT) return shuffle(pool).map((t) => t.id);
  // Prefer tracks that weren't shown last visit, so a refresh feels fresh.
  const last = new Set(store.get('sa_last_discover', []));
  const shuffled = shuffle(pool);
  const fresh = shuffled.filter((t) => !last.has(t.id));
  const seen = shuffled.filter((t) => last.has(t.id));
  const ids = [...fresh, ...seen].slice(0, DISCOVER_COUNT).map((t) => t.id);
  store.set('sa_last_discover', ids);
  return ids;
}

function renderHero() {
  const p = state.profile;
  if (p.tagline) $('#hero-text').textContent = p.tagline;
  $('#hero-overline').textContent = 'Independent sound';

  // The pinned "featured" track if there is one, otherwise the newest upload.
  const featured = trackById(p.featuredTrackId);
  const hero = featured || state.tracks[0];
  if (!hero) return;
  const kind = featured ? 'Featured' : 'Latest drop';
  $('#hero-kind').textContent = kind;
  $('#latest-label').textContent = kind;
  const label = $('#hero-label');
  if (hero.coverUrl) label.replaceChildren(h('img', { src: hero.coverUrl, alt: '' }));
  const button = $('#latest-play');
  button.replaceChildren(h('span', { class: 'dot', html: icon('play') }), h('span', { class: 'txt' }, hero.title));
  button.setAttribute('aria-label', `Play ${kind.toLowerCase()}: ${hero.title}`);
  button.onclick = () => playTrack(hero, featured ? [hero, ...state.tracks.filter((t) => t.id !== hero.id).slice(0, LATEST_COUNT)] : state.tracks.slice(0, LATEST_COUNT));
  $('#latest-drop').hidden = false;
}

function renderChips() {
  const chips = $('#chips');
  chips.replaceChildren(
    ...['All', ...state.categories].map((name) => h('button', {
      class: `chip${state.filter === name ? ' active' : ''}`,
      type: 'button',
      'aria-pressed': String(state.filter === name),
      onclick: () => {
        state.filter = name;
        renderChips();
        renderBrowse();
      },
    }, name)),
  );
}

function matches(track) {
  if (state.filter !== 'All' && track.category !== state.filter) return false;
  if (!state.query) return true;
  const haystack = [track.title, track.category, track.description, track.howMade, track.progressNote, track.lyrics, track.album?.title]
    .filter(Boolean).join(' ').toLowerCase();
  return state.query.split(/\s+/).every((word) => haystack.includes(word));
}

function renderBrowse() {
  const filtering = state.filter !== 'All' || state.query;
  $('#results-block').hidden = !filtering;
  $('#browse-block').hidden = Boolean(filtering);

  if (filtering) {
    const found = state.tracks.filter(matches);
    $('#results-label').textContent = found.length
      ? `${plural(found.length, 'result')}${state.filter !== 'All' ? ` in ${state.filter}` : ''}`
      : 'No results';
    fillGrid($('#results'), found, 'Nothing matches that yet. Try another word or category.');
    return;
  }

  if (!state.tracks.length) {
    $('#latest').replaceChildren(h('p', { class: 'empty' }, h('strong', {}, 'The first drop is on its way. '), 'New music will appear here as soon as it is published.'));
    $('#discover-block').hidden = true;
    return;
  }

  const hot = state.tracks.filter((t) => t.hot).sort((a, b) => a.hot - b.hot);
  $('#hot-block').hidden = hot.length === 0;
  if (hot.length) fillGrid($('#hot'), hot, '');

  const latest = state.tracks.slice(0, LATEST_COUNT);
  fillGrid($('#latest'), latest, '');
  const discover = state.discoverIds.map(trackById).filter(Boolean);
  $('#discover-block').hidden = discover.length === 0;
  if (discover.length) fillGrid($('#discover'), discover, '');
}

function albumCard(album) {
  const count = album.trackIds.length;
  const cover = h('div', { class: 'cover' }, artFor(album, { alt: false }));
  return h('article', { class: 'card album-card' },
    cover,
    h('div', { class: 'card-body' },
      h('div', { class: 'tag' }, h('span', {}, 'Album'), h('span', {}, '·'), h('span', {}, plural(count, 'track'))),
      h('h3', { class: 'card-title' }, h('a', { href: `/album/${album.id}`, 'data-link': true }, album.title)),
      album.description ? h('p', { class: 'card-desc' }, album.description) : null,
      album.releaseDate ? h('div', { class: 'card-foot' }, h('span', {}, formatDate(album.releaseDate))) : null,
    ),
  );
}

function renderAlbums() {
  $('#albums').hidden = state.albums.length === 0;
  $('#album-grid').replaceChildren(...shuffle(state.albums).map(albumCard));
}

function miniPlay(track) {
  const full = trackById(track.id);
  if (!full) return null;
  return h('button', {
    class: 'mini-play', type: 'button', 'data-play-for': full.id, 'data-label': 'Play',
    onclick: () => playTrack(full, [full]),
  });
}

function renderJourney() {
  const { milestones, compare, timeline, undatedCount } = state.journey;
  const list = $('#milestones');
  if (!milestones.length) {
    list.replaceChildren(h('li', { class: 'mile-empty' }, 'Milestones will appear here as the music grows.'));
  } else {
    list.replaceChildren(...milestones.map((m) => h('li', { class: 'mile' },
      h('div', { class: 'mile-top' }, h('b', {}, m.title), m.date ? h('time', { datetime: m.date }, formatDate(m.date)) : null),
      m.note ? h('p', {}, m.note) : null,
      m.track ? h('a', { href: `/track/${m.track.id}`, 'data-link': true }, `Listen: ${m.track.title}`) : null,
    )));
  }

  $('#compare').hidden = !compare;
  if (compare) {
    $('#compare-basis').textContent = `Comparing the earliest and most recent takes by ${compare.basis}.`;
    const item = (track, label) => {
      const thumb = h('div', { class: 'thumb' }, artFor(track, { alt: false }));
      const date = track.recordedDate || track.publishedAt;
      return h('div', { class: 'compare-item', 'data-track': track.id },
        thumb,
        h('div', {},
          h('div', { class: 'label' }, label),
          h('h4', {}, h('a', { href: `/track/${track.id}`, 'data-link': true }, track.title)),
          h('div', { class: 'muted small' }, [track.category, formatDate(date)].filter(Boolean).join(' · ')),
          track.progressNote ? h('p', {}, track.progressNote) : null,
          miniPlay(track),
        ),
      );
    };
    $('#compare-grid').replaceChildren(
      item(compare.early, 'Then'),
      h('div', { class: 'compare-arrow', html: icon('arrow') }),
      item(compare.recent, 'Now'),
    );
  }

  $('#timeline-wrap').hidden = timeline.length === 0;
  if (timeline.length) {
    const items = [];
    let year = null;
    for (const entry of timeline) {
      const entryYear = entry.date.slice(0, 4);
      if (entryYear !== year) {
        year = entryYear;
        items.push(h('li', { class: 'tl-year' }, year));
      }
      items.push(h('li', { class: 'tl-item' },
        h('time', { datetime: entry.date }, [formatDate(entry.date, { month: 'long', day: 'numeric' }), entry.time ? formatTime(entry.time) : null, entry.category].filter(Boolean).join(' · ')),
        h('a', { href: `/track/${entry.id}`, 'data-link': true }, entry.title),
        entry.progressNote ? h('p', {}, entry.progressNote) : null,
      ));
    }
    $('#timeline').replaceChildren(...items);
    $('#undated-note').textContent = undatedCount
      ? `+ ${plural(undatedCount, 'recording')} without a date — you'll find them all in the music section.`
      : '';
  }
}

function renderAbout() {
  const p = state.profile;
  $('#artist-name').textContent = p.artistName;
  const avatar = $('#avatar');
  if (p.photoUrl) avatar.replaceChildren(h('img', { src: p.photoUrl, alt: `${p.artistName}'s profile photo` }));
  else avatar.textContent = p.artistName.slice(0, 1).toUpperCase();
  const bio = $('#artist-bio');
  bio.hidden = !p.bio;
  bio.textContent = p.bio || '';
  if (p.siteIntro) $('#site-bio').textContent = p.siteIntro;
  $('#socials').replaceChildren(...p.socials.map((s) => h('a', {
    href: s.url, target: '_blank', rel: 'noopener noreferrer', html: icon(s.name.toLowerCase()),
  }, s.name)));
}

function renderHome() {
  renderHero();
  renderChips();
  renderBrowse();
  renderAlbums();
  renderJourney();
  renderAbout();
  markCurrent();
}

function setupHome() {
  let timer;
  $('#search').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = event.target.value.toLowerCase().trim();
      renderBrowse();
    }, 120);
  });

  $('#follow-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const message = $('#follow-message');
    const email = form.email.value.trim();
    if (!form.email.checkValidity() || !email) {
      message.textContent = 'Please enter a valid email address.';
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ email, website: form.website.value }) });
      form.reset();
      message.textContent = "You're on the list! You'll hear about new music first.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

// =========================================================== track page
function pageShell(...children) {
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '/#music', 'data-link': true, html: icon('back') }, 'Back to the music'),
    ...children,
  );
}

function notFound(what) {
  return pageShell(h('p', { class: 'empty' }, `This ${what} couldn't be found. It may have been removed or not published yet.`));
}

async function showTrack(id) {
  let track = trackById(id);
  let draft = false;
  if (!track) {
    try {
      track = await api(`/api/studio/tracks/${id}`); // only works for the signed-in creator
      draft = track.status === 'draft';
    } catch {
      track = null;
    }
  }
  if (!track) {
    showPage(notFound('track'), 'Not found | Surgthflur - Music');
    return;
  }

  const queue = track.album
    ? state.tracks.filter((t) => t.album?.id === track.album.id).sort((a, b) => (a.albumPosition ?? 1e9) - (b.albumPosition ?? 1e9))
    : [track];
  const play = () => playTrack(track, queue.some((t) => t.id === track.id) ? queue : [track]);

  const art = h('div', { class: 'detail-art', 'data-track': track.id }, artFor(track));
  art.append(h('button', { class: 'cover-btn', type: 'button', 'aria-label': `Play ${track.title}`, html: icon('play'), onclick: play }));

  const meta = h('div', { class: 'detail-meta' });
  if (track.album) meta.append(h('span', {}, 'From ', h('a', { href: `/album/${track.album.id}`, 'data-link': true }, track.album.title)));
  if (track.recordedDate) meta.append(h('span', {}, `Recorded ${formatDate(track.recordedDate)}${track.recordedTime ? `, ${formatTime(track.recordedTime)}` : ''}`));
  if (track.duration) meta.append(h('span', {}, formatDuration(track.duration)));
  if (track.plays > 0) meta.append(h('span', {}, plural(track.plays, 'play')));
  if (track.hot) meta.append(h('span', { class: 'hot-title' }, '🔥 Hot this week'));
  meta.append(h('span', { class: 'live', 'data-live': track.id, hidden: true }));

  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn primary', type: 'button', 'data-play-for': track.id, 'data-label': 'Play', onclick: play }),
  );
  if (!draft) actions.append(reactionButton(track, 'fire'), reactionButton(track, 'heart'));

  let wave = null;
  if (track.waveform) {
    wave = waveform(track.waveform, {
      label: `Seek in ${track.title}`,
      onSeek: (fraction) => playTrack(track, queue.some((t) => t.id === track.id) ? queue : [track], fraction),
    });
    wave.dataset.wave = track.id;
  }

  const prose = h('div', { class: 'prose' });
  if (track.description) prose.append(h('h3', {}, 'About this track'), h('p', {}, track.description));
  if (track.howMade) prose.append(h('h3', {}, 'How it was made'), h('p', {}, track.howMade));
  if (track.progressNote) prose.append(h('h3', {}, 'What changed / what I learned'), h('p', { class: 'note' }, track.progressNote));
  if (track.lyrics && track.lyricsTiming) {
    const box = h('div', { class: 'lyrics synced', 'data-lyrics': track.id, onclick: onLyricClick(track) }, ...lyricLines(track));
    prose.append(h('h3', {}, 'Lyrics', h('span', { class: 'synced-tag' }, 'SYNCED')), box);
  } else if (track.lyrics) {
    const lyrics = h('p', { class: 'lyrics' }, track.lyrics);
    prose.append(h('h3', {}, 'Lyrics'), lyrics);
    if (track.lyrics.split(/\r?\n/).length > 14 || track.lyrics.length > 700) {
      lyrics.classList.add('clamped');
      const toggle = h('button', { class: 'lyrics-toggle', type: 'button', 'aria-expanded': 'false' }, 'Show all lyrics');
      toggle.addEventListener('click', () => {
        const open = lyrics.classList.toggle('open');
        lyrics.classList.toggle('clamped', !open);
        toggle.textContent = open ? 'Show less' : 'Show all lyrics';
        toggle.setAttribute('aria-expanded', String(open));
      });
      prose.append(toggle);
    }
  }

  const shareRow = draft ? null : h('div', { class: 'share-row' },
    h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(`${track.title} — ${absoluteUrl(`/track/${track.id}`)}`)}`, target: '_blank', rel: 'noopener noreferrer', html: icon('whatsapp') }, 'WhatsApp'),
    h('a', { class: 'btn', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absoluteUrl(`/track/${track.id}`))}`, target: '_blank', rel: 'noopener noreferrer', html: icon('facebook') }, 'Facebook'),
    h('button', { class: 'btn', type: 'button', html: icon('link'), onclick: () => copyLink(absoluteUrl(`/track/${track.id}`)) }, 'Copy link'),
    h('button', { class: 'btn', type: 'button', html: icon('download'), onclick: () => openStory(track) }, 'Story card'),
  );

  const related = state.tracks
    .filter((t) => t.id !== track.id && (track.album ? t.album?.id === track.album.id : t.category === track.category))
    .slice(0, 4);
  const more = related.length
    ? h('section', { class: 'more' },
      h('div', { class: 'row-label' }, h('span', { class: 'label' }, track.album ? `More from ${track.album.title}` : `More ${track.category}`)),
      h('div', { class: 'grid' }, ...related.map((t) => cardFor(t, related))))
    : null;

  const page = pageShell(
    draft ? h('div', { class: 'draft-banner' }, 'Draft preview — only you can see this. Publish it from the Creator Studio when you are ready.') : null,
    h('div', { class: 'detail' },
      art,
      h('div', {},
        h('div', { class: 'tag' }, h('span', {}, track.category), h('span', {}, '·'), h('span', {}, track.mediaType === 'video' ? 'Video' : 'Audio')),
        h('h1', {}, track.title),
        meta,
        wave,
        actions,
        prose,
        shareRow,
      ),
    ),
    !draft && state.features.shoutouts ? shoutoutsSection(track) : null,
    more,
  );
  // Show "N listening now" while this page is open.
  if (!draft && state.features.listeners) {
    const poll = () => api(`/api/listening/${track.id}`).then((r) => showLive(track.id, r.count)).catch(() => {});
    setTimeout(poll, 300);
    state.trackPoll = setInterval(poll, 30000);
  }
  showPage(page, `${track.title} — ${state.profile?.artistName || 'Surgthflur'} - Music`);
}

// ============================================================ shout-outs
function shoutoutsSection(track) {
  const list = h('ul', { class: 'shout-list' }, h('li', { class: 'muted small' }, 'Loading shout-outs…'));
  const name = h('input', { maxlength: '40', placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'nickname', required: true });
  name.value = store.get('sa_name', '');
  const message = h('textarea', { maxlength: '280', placeholder: `Leave a shout-out for ${state.profile?.artistName || 'Surgthflur'}…`, 'aria-label': 'Your shout-out', required: true });
  const count = h('span', { class: 'count' }, '0/280');
  message.addEventListener('input', () => { count.textContent = `${message.value.length}/280`; });
  const honeypot = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off' });
  const status = h('p', { class: 'status', role: 'status' });
  const button = h('button', { class: 'btn primary', type: 'submit' }, 'Send shout-out');

  const form = h('form', {
    class: 'shout-form',
    onsubmit: async (event) => {
      event.preventDefault();
      if (!name.value.trim() || !message.value.trim()) {
        status.textContent = 'Please add your name and a message.';
        return;
      }
      button.disabled = true;
      try {
        await api(`/api/shoutouts/${track.id}`, {
          method: 'POST',
          body: JSON.stringify({ name: name.value, message: message.value, visitor: visitorId(), website: honeypot.value }),
        });
        store.set('sa_name', name.value.trim());
        message.value = '';
        count.textContent = '0/280';
        status.textContent = `Thanks! Your shout-out will appear once ${state.profile?.artistName || 'Surgthflur'} approves it.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    },
  }, name, message, h('div', { class: 'hp', 'aria-hidden': 'true' }, honeypot), h('div', { class: 'row' }, count, button));

  api(`/api/shoutouts/${track.id}`).then((rows) => {
    list.replaceChildren(...(rows.length
      ? rows.map((r) => h('li', { class: 'shout' }, h('b', {}, r.name), h('time', { datetime: r.createdAt }, formatDate(r.createdAt)), h('p', {}, r.message)))
      : [h('li', { class: 'muted small' }, 'No shout-outs yet. Be the first!')]));
  }).catch(() => list.replaceChildren());

  return h('section', { class: 'shoutouts' },
    h('div', { class: 'row-label' }, h('span', { class: 'label' }, 'Shout-outs')),
    list, form, status);
}

// =========================================================== album page
function showAlbum(id) {
  const album = state.albums.find((a) => a.id === id);
  if (!album) {
    showPage(notFound('album'), 'Not found | Surgthflur - Music');
    return;
  }
  const tracks = album.trackIds.map(trackById).filter(Boolean);
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

  const rows = tracks.map((t, i) => h('li', { class: 'tl-row', 'data-track': t.id },
    h('span', { class: 'tl-num' }, String(i + 1).padStart(2, '0')),
    h('button', { class: 'tl-play', type: 'button', 'aria-label': `Play ${t.title}`, 'data-play-for': t.id, onclick: () => playTrack(t, tracks) }),
    h('a', { class: 'tl-title', href: `/track/${t.id}`, 'data-link': true }, t.title, h('small', {}, t.category)),
    h('span', { class: 'tl-dur' }, t.duration ? formatDuration(t.duration) : ''),
    h('button', { class: 'card-share', type: 'button', 'aria-label': `Share ${t.title}`, html: icon('share'), onclick: () => openShare(t) }),
  ));

  const page = pageShell(
    h('div', { class: 'album-head' },
      h('div', { class: 'detail-art' }, artFor(album)),
      h('div', {},
        h('div', { class: 'label' }, 'Album'),
        h('h1', {}, album.title),
        h('div', { class: 'detail-meta' },
          h('span', {}, plural(tracks.length, 'track')),
          total ? h('span', {}, formatDuration(total)) : null,
          album.releaseDate ? h('span', {}, formatDate(album.releaseDate)) : null,
        ),
        album.description ? h('p', { style: 'margin-top:14px' }, album.description) : null,
        h('div', { class: 'detail-actions' },
          h('button', { class: 'btn primary', type: 'button', html: icon('play'), onclick: () => tracks.length && playTrack(tracks[0], tracks) }, 'Play album'),
          h('button', { class: 'btn', type: 'button', html: icon('share'), onclick: () => openShare(album, 'album') }, 'Share'),
        ),
      ),
    ),
    h('ol', { class: 'tracklist' }, ...rows),
  );
  showPage(page, `${album.title} — ${state.profile?.artistName || 'Surgthflur'} - Music`);
}

// ================================================================ router
function showPage(content, title) {
  clearInterval(state.trackPoll);
  if (!$('#home').hidden) state.homeScroll = scrollY;
  $('#home').hidden = true;
  const page = $('#page');
  page.hidden = false;
  page.replaceChildren(content);
  hydrateIcons(page);
  watchVideos(page);
  watchLeds(page);
  markCurrent();
  updateWaves();
  updateLyrics(true);
  document.title = title;
  scrollTo({ top: 0, behavior: 'instant' });
  $('#main').focus({ preventScroll: true });
}

function showHome(hash) {
  clearInterval(state.trackPoll);
  const wasHidden = $('#home').hidden;
  $('#page').hidden = true;
  $('#page').replaceChildren();
  $('#home').hidden = false;
  document.title = `${state.profile?.artistName || 'Surgthflur'} - Music`;
  markCurrent();
  const target = hash && document.getElementById(hash.slice(1));
  if (target) target.scrollIntoView({ behavior: wasHidden ? 'instant' : 'smooth' });
  else if (wasHidden) scrollTo({ top: state.homeScroll, behavior: 'instant' });
}

function route() {
  if (!state.loaded) return;
  const path = location.pathname;
  let match;
  if ((match = path.match(/^\/track\/([a-z0-9]+)\/?$/i))) showTrack(match[1]);
  else if ((match = path.match(/^\/album\/([a-z0-9]+)\/?$/i))) showAlbum(match[1]);
  else showHome(location.hash);
}

function setupRouter() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    if (playerEl.classList.contains('expanded')) setExpanded(false);
    if (url.pathname === location.pathname && url.hash && url.pathname === '/') {
      history.replaceState(null, '', url.pathname + url.hash);
      showHome(url.hash);
      return;
    }
    history.pushState(null, '', url.pathname + url.search + url.hash);
    route();
  });
  addEventListener('popstate', route);
}

// ================================================================== PWA
// Fire mode: switches the lights and accents from blue to flames.
function setupFire() {
  const button = $('#fire-toggle');
  const apply = (on) => {
    document.documentElement.classList.toggle('fire', on);
    button.setAttribute('aria-pressed', String(on));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#140603' : '#080b14');
  };
  apply(Boolean(store.get('sa_fire', false)));
  button.addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('fire');
    apply(on);
    store.set('sa_fire', on);
    toast(on ? '🔥 Fire mode on' : 'Back to blue');
  });
}

function setupInstall() {
  let deferred = null;
  const button = $('#install-btn');
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    button.hidden = true;
  });
  addEventListener('appinstalled', () => {
    button.hidden = true;
    toast('Surgthflur - Music installed');
  });
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

// ================================================================= boot
function showSkeletons() {
  for (const id of ['#latest', '#discover']) {
    $(id).replaceChildren(...Array.from({ length: 4 }, () => h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
  }
}

// ------------------------------------------------- opening / refresh screen
// Shows the animated logo with real loading steps, then fades out.
const splash = {
  el: document.getElementById('splash'),
  step(text, percent) {
    if (!this.el) return;
    $('#splash-line').textContent = text;
    $('#splash-fill').style.width = `${percent}%`;
    $('#splash-pct').textContent = `${percent}%`;
  },
  async finish() {
    if (!this.el) return;
    // Give the logo animation time to play (about 2 s after the page opened).
    const wait = reducedMotion.matches ? 0 : Math.max(0, 2100 - performance.now());
    await new Promise((resolve) => setTimeout(resolve, wait));
    this.step('READY', 100);
    await new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : 280));
    this.el.classList.add('done');
    setTimeout(() => this.el?.remove(), 900);
  },
};

async function boot() {
  const reloading = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  splash.step(reloading ? 'REFRESHING' : 'CONNECTING', 15);
  hydrateIcons();
  setupPlayer();
  setupShare();
  setupHome();
  setupRouter();
  setupInstall();
  setupFire();
  showSkeletons();

  try {
    splash.step('LOADING VOLUME WAVES', 45);
    const data = await api('/api/catalog');
    splash.step('TUNING THE LEDS', 80);
    Object.assign(state, {
      profile: data.profile,
      categories: data.categories,
      tracks: data.tracks,
      albums: data.albums,
      journey: data.journey,
      features: data.features || {},
    });
  } catch (error) {
    state.profile = { artistName: 'Surgthflur', socials: [] };
    state.journey = { milestones: [], compare: null, timeline: [], undatedCount: 0 };
    const notice = $('#notice');
    notice.hidden = false;
    notice.textContent = error.setup
      ? `Setup needed: ${error.message}`
      : navigator.onLine
        ? "The music couldn't be loaded right now. Please refresh in a moment."
        : "You're offline. Connect to the internet to listen.";
  }

  const latestIds = new Set(state.tracks.slice(0, LATEST_COUNT).map((t) => t.id));
  state.discoverIds = pickDiscover(state.tracks.filter((t) => !latestIds.has(t.id)));
  state.loaded = true;
  renderHome();
  route();
  splash.finish();
}

boot();
