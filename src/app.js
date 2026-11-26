'use strict';

const express = require('express');
const config = require('./config');
const pages = require('./pages');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// ------------------------------------------------------------ security headers
const supabase = config.supabaseUrl || '';
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
app.get('/api/health', (req, res) => res.json({ ok: true, configured: config.configured }));

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
