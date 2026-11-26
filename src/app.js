'use strict';

const express = require('express');
const config = require('./config');
const pages = require('./pages');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// ------------------------------------------------------------ security headers
// Always allow Supabase (files, uploads) even if SUPABASE_URL is missing or
// changes later — otherwise covers and recordings silently fail to load.
const supabase = [...new Set([config.supabaseUrl, 'https://*.supabase.co'].filter(Boolean))].join(' ');
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabase}`,
  `media-src 'self' blob: ${supabase}`,
  `connect-src 'self' ${supabase}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------------- api
// Setup diagnostics. Shows only WHICH settings exist (true/false), never their values.
const EXPECTED = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'CREATOR_EMAIL', 'PUBLIC_URL'];
app.get('/api/health', (req, res) => {
  const names = Object.keys(process.env);
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    configured: config.configured,
    creatorEmailSet: config.creatorEmails.length > 0,
    settings: Object.fromEntries(EXPECTED.map((name) => [name, Boolean((process.env[name] || '').trim())])),
    // Catches typos like "supabase_url" or "SUPABASE_URL " (extra space).
    lookalikes: names.filter((n) => /supa|creator|public_url/i.test(n) && !EXPECTED.includes(n) && !/^SUPABASE_(SERVICE_ROLE|ANON)_KEY$|^SUPABASE_BUCKET$/.test(n)),
    environment: process.env.VERCEL_ENV || (config.production ? 'production' : 'development'),
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  });
});

app.use('/api', (req, res, next) => {
  if (config.configured) return next();
  res.status(503).json({
    error: `System Album isn't connected to Supabase yet. Missing: ${config.missing.join(', ')}. See README → Setup.`,
    setup: true,
  });
});

if (config.configured) {
  app.use('/api/auth', require('./auth').router);
  app.use('/api/studio', require('./studio-api').router);
  app.use('/api', require('./public-api').router);
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ------------------------------------------------------------- pages & files
app.use(pages.router);

app.use(
  express.static(pages.PUBLIC_DIR, {
    index: false,
    maxAge: config.production ? '1h' : 0,
    setHeaders(res, file) {
      // The service worker and manifest must always be fresh so updates roll out.
      if (/sw\.js$|\.webmanifest$/.test(file)) res.set('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.type('application/manifest+json');
    },
  }),
);

app.use((req, res) => {
  res.status(404).sendFile(pages.view('404.html'));
});

// ------------------------------------------------------------------- errors
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  const message = status >= 500 ? 'Something went wrong on the server. Please try again.' : err.expose === false ? 'Request error.' : err.message;
  if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).type('text').send(message);
});

module.exports = app;
