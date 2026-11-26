'use strict';

const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => new HttpError(400, message);

// ------------------------------------------------------------------ cookies
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

// ------------------------------------------------------------ rate limiting
// Small in-memory limiter: allow `max` hits per `windowMs` for each key.
function rateLimiter(windowMs, max) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset < now) hits.delete(key);
  }, Math.min(windowMs, 10 * 60 * 1000)).unref();

  return function allow(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

function limit(limiter, message = 'Too many requests. Please wait a bit and try again.') {
  return (req, res, next) => {
    if (limiter(req.ip)) return next();
    res.status(429).json({ error: message });
  };
}

// --------------------------------------------------------------- validation
function text(value, { name, max, required = false }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${name} must be text.`);
  value = value.trim();
  if (required && !value) throw bad(`${name} is required.`);
  if (value.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return value || null;
}

function dateValue(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${name} must be a date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw bad(`${name} is not a real date.`);
  return value;
}

function timeValue(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) throw bad(`${name} must be a time.`);
  return value.slice(0, 5);
}

function urlValue(value, name) {
  const raw = text(value, { name, max: 300 });
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw bad(`${name} must be a full link starting with https://`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw bad(`${name} must start with https://`);
  return parsed.href;
}

function idValue(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-z0-9]{6,32}$/i.test(value)) throw bad(`${name} is not valid.`);
  return value;
}

function randomId(length = 20) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

module.exports = {
  HttpError,
  bad,
  parseCookies,
  rateLimiter,
  limit,
  text,
  dateValue,
  timeValue,
  urlValue,
  idValue,
  randomId,
  escapeHtml,
};
