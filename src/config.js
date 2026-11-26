'use strict';

// Load variables from a local .env file if one exists (built into Node 20.12+).
try {
  process.loadEnvFile();
} catch {
  // No .env file: that's fine in production, where the host sets variables.
}

const env = process.env;
const trimSlash = (value) => (value || '').trim().replace(/\/+$/, '');

const config = {
  port: Number(env.PORT) || 3000,
  // Vercel always serves over HTTPS, so treat it as production too.
  production: env.NODE_ENV === 'production' || Boolean(env.VERCEL),

  supabaseUrl: trimSlash(env.SUPABASE_URL),
  // Secret key (sb_secret_…) or the legacy service_role key. Server only!
  supabaseSecretKey: (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  // Publishable key (sb_publishable_…) or the legacy anon key. Safe to be public.
  supabasePublishableKey: (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim(),
  bucket: (env.SUPABASE_BUCKET || 'media').trim(),

  // Usernames (no "@") become <username>@<LOGIN_DOMAIN> behind the scenes,
  // because Supabase Auth needs an email-shaped login. The inbox doesn't
  // have to exist: nothing is ever emailed to it.
  loginDomain: (env.LOGIN_DOMAIN || 'systemalbum.app').trim().toLowerCase(),

  // Only these accounts may open the Creator Studio (usernames or emails).
  creatorEmails: [],

  // e.g. https://systemalbum.example.com — used for share links and previews.
  publicUrl: trimSlash(env.PUBLIC_URL),

  // Supabase's free plan caps each file at 50 MB. Raise this if you upgrade.
  maxUploadMb: Number(env.MAX_UPLOAD_MB) || 50,

  // Number of proxies in front of the app (Render, Railway, etc. use 1).
  trustProxy: env.TRUST_PROXY !== undefined ? Number(env.TRUST_PROXY) || false : env.NODE_ENV === 'production' || env.VERCEL ? 1 : false,
};

// "surgthflur" -> "surgthflur@systemalbum.app"; real emails stay as they are.
config.toLoginEmail = (value) => {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.includes('@') ? clean : `${clean}@${config.loginDomain}`;
};

// Shows "surgthflur" instead of the behind-the-scenes email.
config.displayName = (email) => {
  const clean = String(email || '').toLowerCase();
  return clean.endsWith(`@${config.loginDomain}`) ? clean.slice(0, -(config.loginDomain.length + 1)) : clean;
};

config.creatorEmails = (env.CREATOR_EMAILS || env.CREATOR_EMAIL || env.CREATOR_USERNAME || '')
  .split(',')
  .map(config.toLoginEmail)
  .filter(Boolean);

config.missing = [
  ['SUPABASE_URL', config.supabaseUrl],
  ['SUPABASE_SECRET_KEY', config.supabaseSecretKey],
  ['SUPABASE_PUBLISHABLE_KEY', config.supabasePublishableKey],
].filter(([, value]) => !value).map(([name]) => name);

config.configured = config.missing.length === 0;

module.exports = config;
