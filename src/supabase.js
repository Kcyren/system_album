'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { HttpError } = require('./util');

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

// Full-access client. Only ever used on the server — never sent to browsers.
const db = config.configured
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, clientOptions)
  : null;

// A fresh, unprivileged client for signing in (one per request, no shared state).
function authClient() {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, clientOptions);
}

function storage() {
  return db.storage.from(config.bucket);
}

// Public URL for a file in the media bucket.
function fileUrl(path) {
  if (!path) return null;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${encoded}`;
}

// Unwraps a Supabase response, turning database errors into friendly HTTP errors.
function must({ data, error }, notFoundMessage) {
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'That already exists.');
    if (error.code === '23503') throw new HttpError(409, 'That item is still being used somewhere else.');
    if (error.code === 'PGRST116' && notFoundMessage) throw new HttpError(404, notFoundMessage);
    console.error('[supabase]', error);
    throw new HttpError(500, 'Database error.');
  }
  if (data === null && notFoundMessage) throw new HttpError(404, notFoundMessage);
  return data;
}

async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await storage().remove(list);
  if (error) console.warn('[storage] could not remove files', list, error.message);
}

module.exports = { db, authClient, storage, fileUrl, must, removeFiles };
