'use strict';

const express = require('express');
const { db, fileUrl, must } = require('./supabase');
const { publishedTracks, publicAlbums, buildJourney, hotRanks, schemaFeatures } = require('./catalog');
const { HttpError, rateLimiter, limit, text, idValue } = require('./util');

const router = express.Router();

async function loadProfile() {
  return must(await db.from('profile').select('*').eq('id', 1).maybeSingle()) || {};
}

function publicProfile(p) {
  const socials = [
    ['TikTok', p.tiktok_url],
    ['YouTube', p.youtube_url],
    ['Facebook', p.facebook_url],
  ]
    .filter(([, url]) => url)
    .map(([name, url]) => ({ name, url }));
  return {
    artistName: p.artist_name || 'Surgthflur',
    tagline: p.tagline || null,
    bio: p.bio || null,
    siteIntro: p.site_intro || null,
    photoUrl: fileUrl(p.photo_path),
    featuredTrackId: p.featured_track_id ?? null,
    socials,
  };
}

// Everything the public site needs in one request.
router.get('/catalog', async (req, res) => {
  const [tracks, profile, categories, milestones] = await Promise.all([
    publishedTracks(),
    loadProfile(),
    db.from('categories').select('id,name').order('position').order('id').then(must),
    db.from('milestones').select('*').then(must),
  ]);
  const [albums, hot, features] = await Promise.all([publicAlbums(tracks), hotRanks(tracks).catch(() => ({})), schemaFeatures()]);
  for (const track of tracks) track.hot = hot[track.id] || 0;
  res.set('Cache-Control', 'no-store');
  res.json({
    profile: publicProfile(profile),
    categories: categories.map((c) => c.name),
    tracks,
    albums,
    journey: buildJourney(tracks, milestones, profile),
    features: { shoutouts: features.v4, listeners: features.v4 },
  });
});

// ------------------------------------------------------------------- plays
// A play is counted after ~5 seconds of real listening (the browser decides),
// at most once per listener per track every 30 minutes.
const recentPlays = new Map();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, at] of recentPlays) if (at < cutoff) recentPlays.delete(key);
}, 5 * 60 * 1000).unref();

router.post('/plays/:id', limit(rateLimiter(60 * 60 * 1000, 200)), async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  const key = `${req.ip}|${id}`;
  if (recentPlays.has(key)) return res.json({ counted: false });
  recentPlays.set(key, Date.now());
  const plays = must(await db.rpc('increment_plays', { p_track_id: id }));
  res.json({ counted: plays !== null, plays });
});

// --------------------------------------------------------------- reactions
router.post('/reactions/:id', limit(rateLimiter(10 * 60 * 1000, 60)), async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  const { kind, visitor, active } = req.body || {};
  if (kind !== 'fire' && kind !== 'heart') throw new HttpError(400, 'Unknown reaction.');
  if (typeof visitor !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(visitor)) throw new HttpError(400, 'Invalid visitor.');

  const track = must(await db.from('tracks').select('id').eq('id', id).eq('status', 'published').maybeSingle());
  if (!track) throw new HttpError(404, 'Track not found.');

  if (active) {
    must(await db.from('reactions').upsert({ track_id: id, kind, visitor }, { onConflict: 'track_id,kind,visitor', ignoreDuplicates: true }));
  } else {
    must(await db.from('reactions').delete().match({ track_id: id, kind, visitor }));
  }
  const { count, error } = await db.from('reactions').select('*', { count: 'exact', head: true }).match({ track_id: id, kind });
  if (error) throw new HttpError(500, 'Database error.');
  res.json({ kind, count: count || 0 });
});

// -------------------------------------------------------------- subscribe
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post('/subscribe', limit(rateLimiter(60 * 60 * 1000, 5)), async (req, res) => {
  // "website" is a hidden honeypot field: real people leave it empty.
  if (req.body?.website) return res.json({ ok: true });
  const email = text(req.body?.email, { name: 'Email', max: 254, required: true }).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  must(await db.from('subscribers').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }));
  // Same answer whether or not they were already subscribed (keeps the list private).
  res.json({ ok: true });
});

// ------------------------------------------------------------ shout-outs
// Visitors can leave a short message; it only appears after approval.
const VISITOR = /^[a-zA-Z0-9-]{16,64}$/;

async function publishedTrack(id) {
  return must(await db.from('tracks').select('id').eq('id', id).eq('status', 'published').maybeSingle());
}

router.get('/shoutouts/:id', async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  if (!(await schemaFeatures()).v4) return res.json([]);
  const rows = must(await db.from('shoutouts').select('id,name,message,created_at').eq('track_id', id).eq('status', 'approved').order('created_at', { ascending: false }).limit(50));
  res.set('Cache-Control', 'no-store').json(rows.map((r) => ({ id: r.id, name: r.name, message: r.message, createdAt: r.created_at })));
});

router.post('/shoutouts/:id', limit(rateLimiter(60 * 60 * 1000, 5), 'You have sent a few shout-outs already. Try again later.'), async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  if (req.body?.website) return res.json({ ok: true }); // honeypot
  if (!(await schemaFeatures()).v4) throw new HttpError(503, 'Shout-outs are not switched on yet.');
  const name = text(req.body?.name, { name: 'Name', max: 40, required: true });
  const message = text(req.body?.message, { name: 'Message', max: 280, required: true });
  const visitor = typeof req.body?.visitor === 'string' && VISITOR.test(req.body.visitor) ? req.body.visitor : null;
  if (/https?:\/\/|www\./i.test(message)) throw new HttpError(400, 'Links are not allowed in shout-outs.');
  if (!(await publishedTrack(id))) throw new HttpError(404, 'Track not found.');
  must(await db.from('shoutouts').insert({ track_id: id, name, message, visitor }));
  res.status(201).json({ ok: true });
});

// -------------------------------------------------------- live listeners
// While someone listens, their player checks in every ~20 seconds.
// "Listening now" = checked in during the last 45 seconds.
const LIVE_WINDOW_MS = 45 * 1000;

async function liveCount(id) {
  const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
  const { count, error } = await db.from('listeners').select('*', { count: 'exact', head: true }).eq('track_id', id).gte('seen_at', since);
  if (error) throw new HttpError(500, 'Database error.');
  return count || 0;
}

router.get('/listening/:id', limit(rateLimiter(60 * 1000, 30)), async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  if (!(await schemaFeatures()).v4) return res.json({ count: 0 });
  res.set('Cache-Control', 'no-store').json({ count: await liveCount(id) });
});

router.post('/listening/:id', limit(rateLimiter(60 * 1000, 20)), async (req, res) => {
  const id = idValue(req.params.id, 'Track');
  const visitor = req.body?.visitor;
  if (typeof visitor !== 'string' || !VISITOR.test(visitor)) throw new HttpError(400, 'Invalid visitor.');
  if (!(await schemaFeatures()).v4) return res.json({ count: 0 });
  if (req.body?.stop) {
    must(await db.from('listeners').delete().match({ visitor, track_id: id }));
    return res.json({ count: await liveCount(id) });
  }
  if (!(await publishedTrack(id))) return res.json({ count: 0 });
  must(await db.from('listeners').upsert({ visitor, track_id: id, seen_at: new Date().toISOString() }, { onConflict: 'visitor,track_id' }));
  // Now and then, tidy up old check-ins.
  if (Math.random() < 0.05) await db.from('listeners').delete().lt('seen_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  res.json({ count: await liveCount(id) });
});

module.exports = { router, loadProfile, publicProfile };
