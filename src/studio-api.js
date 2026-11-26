'use strict';

const express = require('express');
const config = require('./config');
const { db, storage, fileUrl, must, removeFiles } = require('./supabase');
const { requireCreator, sameOrigin } = require('./auth');
const { schemaFeatures, trackFields, mapTrack, reactionTotals } = require('./catalog');
const { loadProfile } = require('./public-api');
const { HttpError, bad, text, dateValue, timeValue, urlValue, idValue, randomId } = require('./util');

const router = express.Router();
router.use(sameOrigin, requireCreator);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ================================================================= uploads
// The browser uploads straight to Supabase Storage with a one-time signed
// link, so big videos never pass through this server.
const AUDIO = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
};
const VIDEO = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const IMAGE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const VIDEO_EXT = new Set(Object.values(VIDEO));

const KINDS = {
  media: { folder: 'tracks/media', types: { ...AUDIO, ...VIDEO } },
  cover: { folder: 'tracks/covers', types: IMAGE },
  album: { folder: 'albums', types: IMAGE },
  photo: { folder: 'profile', types: IMAGE },
};

router.post('/uploads', async (req, res) => {
  const { kind, contentType, size } = req.body || {};
  const spec = KINDS[kind];
  if (!spec) throw bad('Unknown upload type.');
  const ext = spec.types[String(contentType).toLowerCase()];
  if (!ext) {
    throw bad(kind === 'media'
      ? 'That file type is not supported. Use MP3, M4A, WAV, OGG, FLAC, MP4, WEBM or MOV.'
      : 'Please use a JPG, PNG, WEBP or GIF image.');
  }
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (!Number.isFinite(size) || size <= 0) throw bad('File size is missing.');
  if (size > maxBytes) throw new HttpError(413, `That file is too big. The limit is ${config.maxUploadMb} MB.`);

  const path = `${spec.folder}/${new Date().getUTCFullYear()}/${randomId(20)}.${ext}`;
  const { data, error } = await storage().createSignedUploadUrl(path);
  if (error) {
    console.error('[storage] signed upload failed', error);
    throw new HttpError(500, 'Could not prepare the upload. Is the "media" storage bucket created?');
  }
  res.json({
    path,
    uploadUrl: data.signedUrl,
    apiKey: config.supabasePublishableKey,
    publicUrl: fileUrl(path),
    mediaType: VIDEO_EXT.has(ext) ? 'video' : kind === 'media' ? 'audio' : 'image',
  });
});

// Makes sure a path came from /uploads above and the file really exists.
async function checkUpload(path, kind, name) {
  if (path === undefined || path === null || path === '') return null;
  const spec = KINDS[kind];
  const exts = [...new Set(Object.values(spec.types))].join('|');
  const pattern = new RegExp(`^${spec.folder}/\\d{4}/[a-z0-9]{20}\\.(${exts})$`);
  if (typeof path !== 'string' || !pattern.test(path)) throw bad(`${name} upload is not valid.`);
  const { data: exists } = await storage().exists(path);
  if (!exists) throw bad(`${name} upload was not found. Please upload it again.`);
  return path;
}

const mediaTypeFor = (path) => (VIDEO_EXT.has(path.split('.').pop()) ? 'video' : 'audio');

// ================================================================ overview
router.get('/overview', async (req, res) => {
  const count = async (table, filter = (q) => q) => {
    const { count: total, error } = await filter(db.from(table).select('*', { count: 'exact', head: true }));
    if (error) throw new HttpError(500, 'Database error.');
    return total || 0;
  };
  const [tracks, published, drafts, albums, subscribers, reactions] = await Promise.all([
    db.from('tracks').select('id,title,plays,status').then(must),
    count('tracks', (q) => q.eq('status', 'published')),
    count('tracks', (q) => q.eq('status', 'draft')),
    count('albums'),
    count('subscribers'),
    count('reactions'),
  ]);
  res.json({
    published,
    drafts,
    albums,
    subscribers,
    reactions,
    plays: tracks.reduce((sum, t) => sum + Number(t.plays || 0), 0),
    topTracks: tracks
      .filter((t) => t.status === 'published' && Number(t.plays) > 0)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, plays: Number(t.plays) })),
  });
});

// Which optional features the database supports (see supabase/migrations).
router.get('/features', async (req, res) => {
  const { v2, stats } = await schemaFeatures();
  res.json({ lyrics: v2, waveform: v2, stats });
});

// ============================================================ weekly stats
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

router.get('/stats', async (req, res) => {
  if (!(await schemaFeatures()).stats) return res.json({ available: false });

  const WEEKS = 12;
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mondayMs = todayMs - ((now.getUTCDay() + 6) % 7) * DAY_MS; // weeks start on Monday (UTC)
  const firstMs = mondayMs - (WEEKS - 1) * 7 * DAY_MS;

  // Read in pages of 1000 rows (Supabase's default limit per request).
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db.from('play_daily').select('track_id,day,plays').gte('day', isoDay(firstMs)).order('day').range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const [firstRow] = must(await db.from('play_daily').select('day').order('day').limit(1));

  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: isoDay(firstMs + i * 7 * DAY_MS), plays: 0 }));
  const thisWeek = new Map();
  for (const row of rows) {
    const index = Math.floor((Date.parse(`${row.day}T00:00:00Z`) - firstMs) / (7 * DAY_MS));
    if (index >= 0 && index < WEEKS) weeks[index].plays += row.plays;
    if (index === WEEKS - 1) thisWeek.set(row.track_id, (thisWeek.get(row.track_id) || 0) + row.plays);
  }

  const topIds = [...thisWeek.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const titles = topIds.length ? must(await db.from('tracks').select('id,title').in('id', topIds.map(([id]) => id))) : [];
  res.json({
    available: true,
    trackingSince: firstRow?.day || null,
    weeks,
    thisWeekTop: topIds.map(([id, plays]) => ({ id, plays, title: titles.find((t) => t.id === id)?.title || 'Deleted track' })),
  });
});

// ================================================================== tracks
router.get('/tracks', async (req, res) => {
  const [rows, totals] = await Promise.all([
    db.from('tracks').select(await trackFields()).order('created_at', { ascending: false }).then(must),
    reactionTotals(),
  ]);
  res.json(rows.map((row) => mapTrack(row, totals)));
});

router.get('/tracks/:id', async (req, res) => {
  const row = must(await db.from('tracks').select(await trackFields()).eq('id', idValue(req.params.id, 'Track')).maybeSingle(), 'Track not found.');
  res.json(mapTrack(row, await reactionTotals()));
});

async function trackInput(body, existing) {
  const has = (key) => !existing || Object.prototype.hasOwnProperty.call(body, key);
  const out = {};

  if (has('title')) out.title = text(body.title, { name: 'Title', max: 120, required: true });
  if (has('categoryId')) {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId)) throw bad('Please choose a category.');
    must(await db.from('categories').select('id').eq('id', categoryId).maybeSingle(), 'That category no longer exists.');
    out.category_id = categoryId;
  }
  if (has('mediaPath')) {
    if (!existing || body.mediaPath !== existing.media_path) {
      const path = await checkUpload(body.mediaPath, 'media', 'Audio or video');
      if (!path) throw bad('An audio or video file is required.');
      out.media_path = path;
      out.media_type = mediaTypeFor(path);
    }
  }
  if (has('coverPath')) {
    out.cover_path = existing && body.coverPath === existing.cover_path ? existing.cover_path : await checkUpload(body.coverPath, 'cover', 'Cover image');
  }
  if (has('description')) out.description = text(body.description, { name: 'About this track', max: 2000 });
  if (has('howMade')) out.how_made = text(body.howMade, { name: 'How it was made', max: 2000 });
  if (has('progressNote')) out.progress_note = text(body.progressNote, { name: 'Progress note', max: 1000 });
  if (has('recordedDate')) out.recorded_date = dateValue(body.recordedDate, 'Recording date');
  if (has('recordedTime')) out.recorded_time = timeValue(body.recordedTime, 'Recording time');
  if (has('duration')) {
    const duration = Number(body.duration);
    out.duration_seconds = Number.isFinite(duration) && duration > 0 && duration < 36000 ? Math.round(duration * 10) / 10 : null;
  }
  if (has('albumId')) {
    const albumId = idValue(body.albumId, 'Album');
    if (albumId) must(await db.from('albums').select('id').eq('id', albumId).maybeSingle(), 'That album no longer exists.');
    out.album_id = albumId;
    if (albumId && albumId !== existing?.album_id) {
      const last = must(await db.from('tracks').select('album_position').eq('album_id', albumId).order('album_position', { ascending: false, nullsFirst: false }).limit(1));
      out.album_position = (last[0]?.album_position ?? 0) + 1;
    }
    if (!albumId) out.album_position = null;
  }
  const { v2 } = await schemaFeatures();
  if (has('lyrics') && body.lyrics !== undefined) {
    const lyrics = text(body.lyrics, { name: 'Lyrics', max: 10000 });
    if (v2) out.lyrics = lyrics;
    else if (lyrics) throw bad('Lyrics need a one-time database update first: run supabase/migrations/002_lyrics_waveform_stats.sql in Supabase.');
  }
  if (has('waveform') && body.waveform !== undefined && v2) {
    const wave = body.waveform;
    if (wave === null) out.waveform = null;
    else if (Array.isArray(wave) && wave.length <= 400 && wave.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) out.waveform = wave;
    else throw bad('Waveform data is not valid.');
  }
  if (has('status')) {
    if (body.status !== 'draft' && body.status !== 'published') throw bad('Status must be draft or published.');
    out.status = body.status;
    // Keep the first publish date, so editing an old track doesn't make it "new".
    if (body.status === 'published' && !existing?.published_at) out.published_at = new Date().toISOString();
  }
  // A new recording makes the old waveform wrong.
  if (v2 && existing && out.media_path && !('waveform' in out)) out.waveform = null;
  return out;
}

router.post('/tracks', async (req, res) => {
  const body = { status: 'draft', ...req.body };
  const input = await trackInput(body, null);
  const row = must(await db.from('tracks').insert(input).select(await trackFields()).single());
  res.status(201).json(mapTrack(row));
});

router.patch('/tracks/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  const existing = must(await db.from('tracks').select('*').eq('id', id).maybeSingle(), 'Track not found.');
  const input = await trackInput(req.body || {}, existing);
  input.updated_at = new Date().toISOString();
  const row = must(await db.from('tracks').update(input).eq('id', id).select(await trackFields()).single());
  // Clean up files that were replaced or removed.
  await removeFiles([
    input.media_path && input.media_path !== existing.media_path ? existing.media_path : null,
    'cover_path' in input && input.cover_path !== existing.cover_path ? existing.cover_path : null,
  ]);
  res.json(mapTrack(row));
});

router.delete('/tracks/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  const existing = must(await db.from('tracks').select('media_path,cover_path').eq('id', id).maybeSingle(), 'Track not found.');
  must(await db.from('tracks').delete().eq('id', id));
  await removeFiles([existing.media_path, existing.cover_path]);
  res.json({ ok: true });
});

// ================================================================== albums
function mapStudioAlbum(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverPath: row.cover_path,
    coverUrl: fileUrl(row.cover_path),
    releaseDate: row.release_date,
    createdAt: row.created_at,
  };
}

async function albumInput(body, existing) {
  const has = (key) => !existing || Object.prototype.hasOwnProperty.call(body, key);
  const out = {};
  if (has('title')) out.title = text(body.title, { name: 'Album title', max: 120, required: true });
  if (has('description')) out.description = text(body.description, { name: 'Description', max: 2000 });
  if (has('releaseDate')) out.release_date = dateValue(body.releaseDate, 'Release date');
  if (has('coverPath')) {
    out.cover_path = existing && body.coverPath === existing.cover_path ? existing.cover_path : await checkUpload(body.coverPath, 'album', 'Album cover');
  }
  return out;
}

router.get('/albums', async (req, res) => {
  const rows = must(await db.from('albums').select('*').order('created_at', { ascending: false }));
  res.json(rows.map(mapStudioAlbum));
});

router.post('/albums', async (req, res) => {
  const row = must(await db.from('albums').insert(await albumInput(req.body || {}, null)).select('*').single());
  res.status(201).json(mapStudioAlbum(row));
});

router.patch('/albums/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Album');
  const existing = must(await db.from('albums').select('*').eq('id', id).maybeSingle(), 'Album not found.');
  const input = await albumInput(req.body || {}, existing);
  input.updated_at = new Date().toISOString();
  const row = must(await db.from('albums').update(input).eq('id', id).select('*').single());
  if ('cover_path' in input && input.cover_path !== existing.cover_path) await removeFiles([existing.cover_path]);
  res.json(mapStudioAlbum(row));
});

router.delete('/albums/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Album');
  const existing = must(await db.from('albums').select('cover_path').eq('id', id).maybeSingle(), 'Album not found.');
  must(await db.from('albums').delete().eq('id', id)); // tracks stay, they just leave the album
  await removeFiles([existing.cover_path]);
  res.json({ ok: true });
});

router.put('/albums/:id/order', async (req, res) => {
  const id = idValue(req.params.id, 'Album');
  const ids = req.body?.trackIds;
  if (!Array.isArray(ids) || ids.length > 500) throw bad('Track order is not valid.');
  await Promise.all(
    ids.map((trackId, index) =>
      db.from('tracks').update({ album_position: index + 1 }).eq('id', idValue(trackId, 'Track')).eq('album_id', id).then(must),
    ),
  );
  res.json({ ok: true });
});

// ============================================================== categories
router.get('/categories', async (req, res) => {
  res.json(must(await db.from('categories').select('id,name,position').order('position').order('id')));
});

router.post('/categories', async (req, res) => {
  const name = text(req.body?.name, { name: 'Category name', max: 40, required: true });
  const last = must(await db.from('categories').select('position').order('position', { ascending: false }).limit(1));
  const row = must(await db.from('categories').insert({ name, position: (last[0]?.position ?? 0) + 1 }).select('id,name,position').single());
  res.status(201).json(row);
});

router.patch('/categories/:id', async (req, res) => {
  const name = text(req.body?.name, { name: 'Category name', max: 40, required: true });
  const row = must(await db.from('categories').update({ name }).eq('id', Number(req.params.id)).select('id,name,position').maybeSingle(), 'Category not found.');
  res.json(row);
});

router.delete('/categories/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { count } = await db.from('tracks').select('*', { count: 'exact', head: true }).eq('category_id', id);
  if (count) throw new HttpError(409, `This category is used by ${count} track${count === 1 ? '' : 's'}. Move them to another category first.`);
  must(await db.from('categories').delete().eq('id', id));
  res.json({ ok: true });
});

// ================================================================= profile
function mapStudioProfile(p) {
  return {
    artistName: p.artist_name,
    tagline: p.tagline,
    bio: p.bio,
    siteIntro: p.site_intro,
    photoPath: p.photo_path,
    photoUrl: fileUrl(p.photo_path),
    tiktokUrl: p.tiktok_url,
    youtubeUrl: p.youtube_url,
    facebookUrl: p.facebook_url,
    compareEarlyId: p.compare_early_id,
    compareRecentId: p.compare_recent_id,
  };
}

router.get('/profile', async (req, res) => {
  res.json(mapStudioProfile(await loadProfile()));
});

router.patch('/profile', async (req, res) => {
  const body = req.body || {};
  const existing = await loadProfile();
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = { updated_at: new Date().toISOString() };
  if (has('artistName')) out.artist_name = text(body.artistName, { name: 'Artist name', max: 60, required: true });
  if (has('tagline')) out.tagline = text(body.tagline, { name: 'Tagline', max: 140 });
  if (has('bio')) out.bio = text(body.bio, { name: 'Biography', max: 2000 });
  if (has('siteIntro')) out.site_intro = text(body.siteIntro, { name: 'About System Album', max: 2000 });
  if (has('tiktokUrl')) out.tiktok_url = urlValue(body.tiktokUrl, 'TikTok link');
  if (has('youtubeUrl')) out.youtube_url = urlValue(body.youtubeUrl, 'YouTube link');
  if (has('facebookUrl')) out.facebook_url = urlValue(body.facebookUrl, 'Facebook link');
  if (has('photoPath')) {
    out.photo_path = body.photoPath === existing.photo_path ? existing.photo_path : await checkUpload(body.photoPath, 'photo', 'Profile photo');
  }
  for (const [key, column] of [['compareEarlyId', 'compare_early_id'], ['compareRecentId', 'compare_recent_id']]) {
    if (!has(key)) continue;
    const trackId = idValue(body[key], 'Comparison track');
    if (trackId) must(await db.from('tracks').select('id').eq('id', trackId).maybeSingle(), 'Comparison track not found.');
    out[column] = trackId;
  }
  const row = must(await db.from('profile').upsert({ id: 1, ...out }).select('*').single());
  if ('photo_path' in out && out.photo_path !== existing.photo_path) await removeFiles([existing.photo_path]);
  res.json(mapStudioProfile(row));
});

// ============================================================== milestones
const mapMilestone = (m) => ({ id: m.id, title: m.title, note: m.note, date: m.happened_on, trackId: m.track_id });

async function milestoneInput(body) {
  const trackId = idValue(body.trackId, 'Linked track');
  if (trackId) must(await db.from('tracks').select('id').eq('id', trackId).maybeSingle(), 'Linked track not found.');
  return {
    title: text(body.title, { name: 'Milestone title', max: 120, required: true }),
    note: text(body.note, { name: 'Note', max: 1000 }),
    happened_on: dateValue(body.date, 'Date'),
    track_id: trackId,
  };
}

router.get('/milestones', async (req, res) => {
  const rows = must(await db.from('milestones').select('*').order('happened_on', { ascending: true, nullsFirst: false }));
  res.json(rows.map(mapMilestone));
});

router.post('/milestones', async (req, res) => {
  const row = must(await db.from('milestones').insert(await milestoneInput(req.body || {})).select('*').single());
  res.status(201).json(mapMilestone(row));
});

router.patch('/milestones/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Milestone');
  const row = must(await db.from('milestones').update(await milestoneInput(req.body || {})).eq('id', id).select('*').maybeSingle(), 'Milestone not found.');
  res.json(mapMilestone(row));
});

router.delete('/milestones/:id', async (req, res) => {
  must(await db.from('milestones').delete().eq('id', idValue(req.params.id, 'Milestone')));
  res.json({ ok: true });
});

// ============================================================= subscribers
router.get('/subscribers', async (req, res) => {
  const rows = must(await db.from('subscribers').select('id,email,created_at').order('created_at', { ascending: false }));
  res.json(rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at })));
});

router.get('/subscribers.csv', async (req, res) => {
  const rows = must(await db.from('subscribers').select('email,created_at,unsubscribe_token').order('created_at'));
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  // Prefix cells that start with = + - @ so spreadsheets don't run them as formulas.
  const cell = (value) => `"${String(value).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const lines = [['email', 'subscribed_at', 'unsubscribe_link'].join(',')];
  for (const r of rows) lines.push([r.email, r.created_at, `${base}/unsubscribe?token=${r.unsubscribe_token}`].map(cell).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="system-album-followers.csv"');
  res.send(lines.join('\n'));
});

router.delete('/subscribers/:id', async (req, res) => {
  must(await db.from('subscribers').delete().eq('id', Number(req.params.id)));
  res.json({ ok: true });
});

module.exports = { router };
