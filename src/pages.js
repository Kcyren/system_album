'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { db, fileUrl, must } = require('./supabase');
const { escapeHtml } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VIEWS_DIR = path.join(__dirname, '..', 'views');
const view = (name) => path.join(VIEWS_DIR, name);
const router = express.Router();

let cachedShell = null;
function shell() {
  // Re-read during development so edits show up without restarting.
  if (!cachedShell || !config.production) cachedShell = fs.readFileSync(view('index.html'), 'utf8');
  return cachedShell;
}

function baseUrl(req) {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}

// Link previews for WhatsApp, Facebook, etc. (they don't run JavaScript).
function render(req, res, { title, description, image, type = 'website', status = 200 }) {
  const url = baseUrl(req) + req.originalUrl.split('?')[0];
  const img = image || `${baseUrl(req)}/icons/og-default.png`;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:site_name" content="System Album">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(img)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');
  res.status(status).type('html').set('Cache-Control', 'no-cache').send(shell().replace('<!--META-->', tags));
}

const DEFAULT_DESCRIPTION = 'Freestyles, mixes and short videos from Surgthflur — and the journey of getting better, one take at a time.';

router.get(['/', '/index.html'], (req, res) => {
  render(req, res, { title: 'Surgthflur | System Album', description: DEFAULT_DESCRIPTION });
});

router.get('/track/:id', async (req, res) => {
  let track = null;
  if (config.configured) {
    const id = /^[a-z0-9]{6,32}$/i.test(req.params.id) ? req.params.id : null;
    if (id) track = await db.from('tracks').select('title,description,cover_path,category:categories(name)').eq('id', id).eq('status', 'published').maybeSingle().then(must).catch(() => null);
  }
  if (!track) return render(req, res, { title: 'Surgthflur | System Album', description: DEFAULT_DESCRIPTION });
  render(req, res, {
    title: `${track.title} — Surgthflur`,
    description: track.description || `${track.category?.name || 'Music'} by Surgthflur on System Album.`,
    image: fileUrl(track.cover_path),
    type: 'music.song',
  });
});

router.get('/album/:id', async (req, res) => {
  let album = null;
  if (config.configured) {
    const id = /^[a-z0-9]{6,32}$/i.test(req.params.id) ? req.params.id : null;
    if (id) album = await db.from('albums').select('title,description,cover_path').eq('id', id).maybeSingle().then(must).catch(() => null);
  }
  if (!album) return render(req, res, { title: 'Surgthflur | System Album', description: DEFAULT_DESCRIPTION });
  render(req, res, {
    title: `${album.title} — Surgthflur`,
    description: album.description || `An album by Surgthflur on System Album.`,
    image: fileUrl(album.cover_path),
    type: 'music.album',
  });
});

router.get('/studio', (req, res) => {
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').sendFile(view('studio.html'));
});

router.get('/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' && /^[a-f0-9]{32}$/.test(req.query.token) ? req.query.token : null;
  let message = 'This unsubscribe link is not valid.';
  if (token && config.configured) {
    const { error } = await db.from('subscribers').delete().eq('unsubscribe_token', token);
    message = error ? 'Something went wrong. Please try again later.' : 'You have been unsubscribed. You will not get more emails from System Album.';
  }
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>System Album</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b14;color:#f7f9ff;font:16px system-ui,sans-serif;padding:16px}main{max-width:420px;text-align:center}a{color:#9db4ff}</style></head>
<body><main><h1>System Album</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to the music</a></p></main></body></html>`);
});

module.exports = { router, PUBLIC_DIR, view };
