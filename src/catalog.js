'use strict';

const { db, fileUrl, must } = require('./supabase');

const TRACK_FIELDS =
  'id,title,media_path,media_type,cover_path,description,how_made,progress_note,recorded_date,recorded_time,' +
  'album_id,album_position,duration_seconds,status,plays,created_at,updated_at,published_at,' +
  'category:categories(id,name),album:albums(id,title)';

// Lyrics, waveforms and daily play stats need supabase/migrations/002.
// Until it's run, the site keeps working without those features.
let featureCache = null;
async function schemaFeatures() {
  const cached = featureCache;
  if (cached && ((cached.value.v2 && cached.value.stats && cached.value.v3 && cached.value.v4 && cached.value.v6) || Date.now() - cached.at < 60 * 1000)) return cached.value;
  const [tracksCheck, statsCheck, v3Check, v4Check, v6Check] = await Promise.all([
    db.from('tracks').select('lyrics,waveform').limit(1),
    db.from('play_daily').select('day').limit(1),
    db.from('profile').select('featured_track_id').limit(1).then(async (r) => (r.error ? r : db.from('tracks').select('announced_at').limit(1))),
    db.from('shoutouts').select('id').limit(1).then(async (r) => (r.error ? r : db.from('tracks').select('lyrics_timing').limit(1)))
      .then(async (r) => (r.error ? r : db.from('listeners').select('visitor').limit(1))),
    db.from('tracks').select('edit').limit(1),
  ]);
  const value = { v2: !tracksCheck.error, stats: !statsCheck.error, v3: !v3Check.error, v4: !v4Check.error, v6: !v6Check.error };
  featureCache = { value, at: Date.now() };
  return value;
}

async function trackFields() {
  const { v2, v3, v4, v6 } = await schemaFeatures();
  return TRACK_FIELDS + (v2 ? ',lyrics,waveform' : '') + (v3 ? ',announced_at' : '') + (v4 ? ',lyrics_timing' : '') + (v6 ? ',edit' : '');
}

// Length of a track after trimming/cutting (see public/js/edits.js).
function editedLength(edit, raw) {
  if (!edit || !Number.isFinite(raw)) return raw;
  const start = Math.max(0, Number(edit.start) || 0);
  const end = Math.min(edit.end == null ? raw : Number(edit.end), raw);
  if (!(end > start)) return raw;
  let removed = 0;
  let t = start;
  const cuts = (edit.cuts || []).map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  for (const [a, b] of cuts) {
    if (b > t) removed += b - Math.max(a, t);
    t = Math.max(t, b);
  }
  return Math.max(0, end - start - removed);
}

function mapTrack(row, reactionTotals = {}) {
  return {
    id: row.id,
    title: row.title,
    category: row.category?.name || 'Uncategorized',
    categoryId: row.category?.id ?? null,
    mediaType: row.media_type,
    mediaUrl: fileUrl(row.media_path),
    coverUrl: fileUrl(row.cover_path),
    description: row.description,
    howMade: row.how_made,
    progressNote: row.progress_note,
    lyrics: row.lyrics ?? null,
    lyricsTiming: Array.isArray(row.lyrics_timing) && row.lyrics_timing.some((t) => t !== null) ? row.lyrics_timing : null,
    waveform: Array.isArray(row.waveform) && row.waveform.length ? row.waveform : null,
    recordedDate: row.recorded_date,
    recordedTime: row.recorded_time ? row.recorded_time.slice(0, 5) : null,
    album: row.album ? { id: row.album.id, title: row.album.title } : null,
    albumPosition: row.album_position,
    duration: row.edit ? editedLength(row.edit, row.duration_seconds) : row.duration_seconds,
    rawDuration: row.duration_seconds,
    edit: row.edit ?? null,
    status: row.status,
    plays: Number(row.plays) || 0,
    reactions: { fire: reactionTotals[row.id]?.fire || 0, heart: reactionTotals[row.id]?.heart || 0 },
    publishedAt: row.published_at,
    announcedAt: row.announced_at ?? null,
    createdAt: row.created_at,
  };
}

async function reactionTotals() {
  const rows = must(await db.rpc('reaction_counts')) || [];
  const totals = {};
  for (const row of rows) {
    totals[row.track_id] ??= {};
    totals[row.track_id][row.kind] = Number(row.total);
  }
  return totals;
}

async function publishedTracks() {
  const fields = await trackFields();
  const [rows, totals] = await Promise.all([
    db.from('tracks').select(fields).eq('status', 'published').order('published_at', { ascending: false }).then(must),
    reactionTotals(),
  ]);
  return rows.map((row) => mapTrack(row, totals));
}

function mapAlbum(row, tracks) {
  const inAlbum = tracks
    .filter((t) => t.album?.id === row.id)
    .sort((a, b) => (a.albumPosition ?? 1e9) - (b.albumPosition ?? 1e9) || a.publishedAt.localeCompare(b.publishedAt));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: fileUrl(row.cover_path) || inAlbum.find((t) => t.coverUrl)?.coverUrl || null,
    releaseDate: row.release_date,
    trackIds: inAlbum.map((t) => t.id),
  };
}

// Albums that have at least one published track.
async function publicAlbums(tracks) {
  const rows = must(await db.from('albums').select('*').order('created_at', { ascending: false }));
  return rows.map((row) => mapAlbum(row, tracks)).filter((album) => album.trackIds.length > 0);
}

const day = (iso) => (iso ? iso.slice(0, 10) : null);
const recordedKey = (t) => `${t.recordedDate}T${t.recordedTime || '00:00'}`;

// Builds the "journey" from real data only. Nothing here is invented:
// automatic milestones are facts calculated from what has been published.
function buildJourney(tracks, customMilestones, profile) {
  const byPublished = [...tracks].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const dated = tracks.filter((t) => t.recordedDate).sort((a, b) => recordedKey(a).localeCompare(recordedKey(b)));
  const brief = (t) => (t ? { id: t.id, title: t.title, category: t.category, coverUrl: t.coverUrl, mediaType: t.mediaType } : null);

  const auto = [];
  if (byPublished.length) {
    auto.push({ title: 'First track shared', date: day(byPublished[0].publishedAt), track: brief(byPublished[0]) });
  }
  if (dated.length && dated[0].id !== byPublished[0]?.id) {
    auto.push({ title: 'Earliest dated recording', date: dated[0].recordedDate, track: brief(dated[0]) });
  }
  for (const [label, test] of [
    ['First mix shared', (t) => t.category.toLowerCase() === 'mix'],
    ['First freestyle shared', (t) => t.category.toLowerCase() === 'freestyle'],
    ['First video shared', (t) => t.mediaType === 'video'],
  ]) {
    const first = byPublished.find(test);
    if (first && first.id !== byPublished[0].id) auto.push({ title: label, date: day(first.publishedAt), track: brief(first) });
  }
  for (const n of [10, 25, 50, 100, 250]) {
    if (byPublished.length >= n) {
      auto.push({ title: `${n}th track shared`, date: day(byPublished[n - 1].publishedAt), track: brief(byPublished[n - 1]) });
    }
  }

  const publishedIds = new Set(tracks.map((t) => t.id));
  const custom = customMilestones.map((m) => ({
    title: m.title,
    note: m.note,
    date: m.happened_on,
    track: m.track_id && publishedIds.has(m.track_id) ? brief(tracks.find((t) => t.id === m.track_id)) : null,
    custom: true,
  }));

  const milestones = [...custom, ...auto.map((m) => ({ ...m, auto: true }))].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // "Then and now": the creator can pick the pair, otherwise earliest vs latest.
  let compare = null;
  if (tracks.length >= 2) {
    const pool = dated.length >= 2 ? dated : byPublished;
    const find = (id) => tracks.find((t) => t.id === id);
    const early = find(profile?.compare_early_id) || pool[0];
    const recent = find(profile?.compare_recent_id) || pool[pool.length - 1];
    if (early && recent && early.id !== recent.id) {
      compare = { early, recent, basis: dated.length >= 2 ? 'recording date' : 'upload date' };
    }
  }

  return {
    milestones,
    compare,
    timeline: dated.map((t) => ({ ...brief(t), date: t.recordedDate, time: t.recordedTime, progressNote: t.progressNote })),
    undatedCount: tracks.length - dated.length,
  };
}

// "Hot right now": the top tracks of the last 7 days by plays + reactions.
// Only real activity counts, and a track needs a minimum score to qualify.
async function hotRanks(tracks) {
  const { stats } = await schemaFeatures();
  if (!tracks.length) return {};
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [plays, reactions] = await Promise.all([
    stats ? db.from('play_daily').select('track_id,plays').gte('day', since.toISOString().slice(0, 10)).limit(5000).then(must) : [],
    db.from('reactions').select('track_id').gte('created_at', since.toISOString()).limit(5000).then(must),
  ]);
  const score = {};
  for (const row of plays) score[row.track_id] = (score[row.track_id] || 0) + row.plays;
  for (const row of reactions) score[row.track_id] = (score[row.track_id] || 0) + 3;
  const live = new Set(tracks.map((t) => t.id));
  const ranked = Object.entries(score).filter(([id, s]) => live.has(id) && s >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return Object.fromEntries(ranked.map(([id], i) => [id, i + 1]));
}

module.exports = { hotRanks, schemaFeatures, trackFields, mapTrack, reactionTotals, publishedTracks, publicAlbums, mapAlbum, buildJourney };
