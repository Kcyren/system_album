'use strict';

// Rate limits shared by every copy of the server (Vercel runs several).
// Counts live in Supabase (migration 005). A quick in-memory check runs first,
// and if update 005 isn't installed yet it falls back to memory only.

const crypto = require('node:crypto');
const config = require('./config');
const { db } = require('./supabase');
const { rateLimiter } = require('./util');

let shared = true; // becomes false if the database function is missing

// Scramble the IP so the database never stores real addresses.
function visitorKey(ip) {
  return crypto.createHmac('sha256', config.supabaseSecretKey || 'local').update(String(ip)).digest('base64url').slice(0, 22);
}

// Returns true when allowed. `key` is extra detail, e.g. a track id.
async function allow(name, req, windowMs, max, key = '') {
  if (!shared || !db) return true;
  const { data, error } = await db.rpc('hit_rate_limit', {
    p_key: `${name}:${visitorKey(req.ip)}${key ? `:${key}` : ''}`,
    p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    p_max: max,
  });
  if (error) {
    if (error.code === 'PGRST202' || /hit_rate_limit/.test(error.message || '')) {
      shared = false;
      console.warn('[ratelimit] update 005 not installed; using in-memory limits only.');
    } else {
      console.warn('[ratelimit]', error.message);
    }
    return true; // never block real visitors because of a database hiccup
  }
  return data !== false;
}

// Express middleware: in-memory check, then the shared database check.
function guard(name, windowMs, max, message = 'Too many requests. Please wait a bit and try again.') {
  const local = rateLimiter(windowMs, max);
  return async (req, res, next) => {
    if (!local(req.ip) || !(await allow(name, req, windowMs, max))) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { guard, allow };
