'use strict';

const express = require('express');
const config = require('./config');
const { db, authClient } = require('./supabase');
const { HttpError, parseCookies, rateLimiter, limit, text } = require('./util');

const ACCESS_COOKIE = 'sa_access';
const REFRESH_COOKIE = 'sa_refresh';
const REFRESH_DAYS = 30;

// Short cache so we don't ask Supabase "who is this?" on every single click.
const verified = new Map(); // token -> { user, until }
const VERIFY_CACHE_MS = 60 * 1000;

function isCreator(user) {
  return Boolean(user?.email) && config.creatorEmails.includes(user.email.toLowerCase());
}

function cookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.production || req.secure,
    path: '/api',
    maxAge: maxAgeMs,
  };
}

function setSession(req, res, session) {
  res.cookie(ACCESS_COOKIE, session.access_token, cookieOptions(req, (session.expires_in || 3600) * 1000));
  res.cookie(REFRESH_COOKIE, session.refresh_token, cookieOptions(req, REFRESH_DAYS * 24 * 3600 * 1000));
}

function clearSession(req, res) {
  const options = cookieOptions(req, 0);
  delete options.maxAge;
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

async function userFromToken(token) {
  if (!token) return null;
  const cached = verified.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  verified.set(token, { user: data.user, until: Date.now() + VERIFY_CACHE_MS });
  if (verified.size > 500) verified.delete(verified.keys().next().value);
  return data.user;
}

// Blocks cross-site form posts (CSRF). Cookies are also SameSite=Strict.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site request blocked.' });
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
}

// Middleware: only lets the signed-in creator through.
async function requireCreator(req, res, next) {
  const cookies = parseCookies(req);
  let user = await userFromToken(cookies[ACCESS_COOKIE]);

  // Access tokens last ~1 hour; quietly renew with the refresh token.
  if (!user && cookies[REFRESH_COOKIE]) {
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: cookies[REFRESH_COOKIE] });
    if (!error && data?.session) {
      setSession(req, res, data.session);
      user = data.user;
    }
  }

  if (!user || !isCreator(user)) {
    clearSession(req, res);
    return res.status(401).json({ error: 'Please sign in to the Creator Studio.' });
  }

  req.user = user;
  next();
}

const router = express.Router();
const loginLimiter = rateLimiter(15 * 60 * 1000, 8);

router.use(sameOrigin);

router.post('/login', limit(loginLimiter, 'Too many sign-in attempts. Please wait 15 minutes.'), async (req, res) => {
  if (!config.creatorEmails.length) {
    throw new HttpError(503, 'No creator account is set up yet. Add CREATOR_EMAIL (a username or email) to the server settings.');
  }
  const email = config.toLoginEmail(text(req.body?.email, { name: 'Username', max: 254, required: true }));
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) throw new HttpError(400, 'Password is required.');

  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw new HttpError(401, 'Username or password is incorrect.');
  if (!isCreator(data.user)) throw new HttpError(403, 'This account is not allowed to manage System Album.');

  setSession(req, res, data.session);
  res.json({ email: config.displayName(data.user.email) });
});

router.post('/logout', async (req, res) => {
  const token = parseCookies(req)[ACCESS_COOKIE];
  if (token) {
    verified.delete(token);
    await db.auth.admin.signOut(token).catch(() => {});
  }
  clearSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireCreator, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ email: config.displayName(req.user.email) });
});

router.post('/password', requireCreator, async (req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';
  if (next.length < 10) throw new HttpError(400, 'Use at least 10 characters for the new password.');
  if (next.length > 72) throw new HttpError(400, 'Password is too long (max 72 characters).');

  const check = await authClient().auth.signInWithPassword({ email: req.user.email, password: current });
  if (check.error) throw new HttpError(400, 'Your current password is incorrect.');

  const { error } = await db.auth.admin.updateUserById(req.user.id, { password: next });
  if (error) throw new HttpError(400, error.message || 'Could not change the password.');
  res.json({ ok: true });
});

module.exports = { router, requireCreator, sameOrigin };
