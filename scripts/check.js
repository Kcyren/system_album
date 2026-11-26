'use strict';
// Checks that Supabase is set up correctly. Run with: npm run check

const config = require('../src/config');

const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg) => {
  console.log(`  ✘ ${msg}`);
  process.exitCode = 1;
};

(async () => {
  console.log('\nSystem Album setup check\n');

  if (!config.configured) {
    fail(`Missing in .env: ${config.missing.join(', ')}`);
    return;
  }
  ok('Supabase keys found in .env');

  const { db, authClient } = require('../src/supabase');

  for (const table of ['categories', 'albums', 'tracks', 'milestones', 'profile', 'subscribers', 'reactions']) {
    const { error } = await db.from(table).select('*', { head: true, count: 'exact' });
    if (error) fail(`Table "${table}": ${error.message} — did you run supabase/schema.sql?`);
    else ok(`Table "${table}" exists`);
  }

  const { error: v2Error } = await db.from('tracks').select('lyrics,waveform').limit(1);
  const { error: dailyError } = await db.from('play_daily').select('day').limit(1);
  if (v2Error || dailyError) fail('Update 002 not installed (lyrics, waveforms, weekly stats) — run supabase/migrations/002_lyrics_waveform_stats.sql');
  else ok('Update 002 installed (lyrics, waveforms, weekly stats)');

  const { error: v3a } = await db.from('profile').select('featured_track_id').limit(1);
  const { error: v3b } = await db.from('tracks').select('announced_at').limit(1);
  if (v3a || v3b) fail('Update 003 not installed (featured track, release emails) — run supabase/migrations/003_featured_and_announcements.sql');
  else ok('Update 003 installed (featured track, release emails)');

  const { error: v4a } = await db.from('shoutouts').select('id').limit(1);
  const { error: v4b } = await db.from('listeners').select('visitor').limit(1);
  const { error: v4c } = await db.from('tracks').select('lyrics_timing').limit(1);
  if (v4a || v4b || v4c) fail('Update 004 not installed (shout-outs, live listeners, synced lyrics) — run supabase/migrations/004_shoutouts_listeners_synced_lyrics.sql');
  else ok('Update 004 installed (shout-outs, live listeners, synced lyrics)');

  const { error: v5 } = await db.rpc('hit_rate_limit', { p_key: 'setup-check', p_window_seconds: 1, p_max: 1000 });
  if (v5) fail('Update 005 not installed (shared spam protection) — run supabase/migrations/005_shared_rate_limits.sql');
  else ok('Update 005 installed (shared spam protection)');

  const { error: v6 } = await db.from('tracks').select('edit').limit(1);
  if (v6) fail('Update 006 not installed (trim & cut) — run supabase/migrations/006_track_edits.sql');
  else ok('Update 006 installed (trim & cut)');

  if (config.resendApiKey && config.emailFrom) ok(`New-release emails: on (from ${config.emailFrom})`);
  else console.log('  · New-release emails: off (optional — add RESEND_API_KEY and EMAIL_FROM)');

  const { error: rpcError } = await db.rpc('reaction_counts');
  if (rpcError) fail(`Function reaction_counts: ${rpcError.message}`);
  else ok('Database functions installed');

  const { data: bucket, error: bucketError } = await db.storage.getBucket(config.bucket);
  if (bucketError) fail(`Storage bucket "${config.bucket}": ${bucketError.message}`);
  else if (!bucket.public) fail(`Storage bucket "${config.bucket}" must be public so visitors can play files`);
  else ok(`Storage bucket "${config.bucket}" is ready (public)`);

  // The public key must NOT be able to read private tables.
  const { data: leaked } = await authClient().from('subscribers').select('email').limit(1);
  if (leaked && leaked.length) fail('The publishable key can read subscribers! Re-run schema.sql to enable Row Level Security.');
  else ok('Row Level Security protects private data');

  if (!config.creatorEmails.length) {
    fail('CREATOR_EMAIL is not set in .env — put his username there, e.g. CREATOR_EMAIL=surgthflur');
  } else {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) fail(`Could not list users: ${error.message}`);
    for (const email of config.creatorEmails) {
      const user = data?.users.find((u) => u.email?.toLowerCase() === email);
      if (!user) fail(`No account for "${config.displayName(email)}" yet — run: npm run creator`);
      else if (!user.email_confirmed_at) fail(`"${config.displayName(email)}" is not confirmed — run: npm run creator`);
      else ok(`Creator account "${config.displayName(email)}" is ready`);
    }
  }

  console.log(process.exitCode ? '\nSome checks failed — see README → Setup.\n' : '\nAll good! Run: npm run dev\n');
})().catch((error) => {
  fail(error.message);
});
