'use strict';

const express = require('express');
const { db, fileUrl, must } = require('./supabase');
const { publishedTracks, publicAlbums, buildJourney } = require('./catalog');
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
  const albums = await publicAlbums(tracks);
  res.set('Cache-Control', 'no-store');
  res.json({
    profile: publicProfile(profile),
    categories: categories.map((c) => c.name),
    tracks,
    albums,
    journey: buildJourney(tracks, milestones, profile),
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

module.exports = { router, loadProfile, publicProfile };
