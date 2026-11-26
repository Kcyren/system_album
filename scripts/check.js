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
    fail('CREATOR_EMAIL is not set in .env');
  } else {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) fail(`Could not list users: ${error.message}`);
    for (const email of config.creatorEmails) {
      const user = data?.users.find((u) => u.email?.toLowerCase() === email);
      if (!user) fail(`No Supabase Auth user for ${email} — add one in Authentication → Users`);
      else if (!user.email_confirmed_at) fail(`${email} exists but is not confirmed — tick "Auto Confirm User" when creating it`);
      else ok(`Creator account ${email} is ready`);
    }
  }

  console.log(process.exitCode ? '\nSome checks failed — see README → Setup.\n' : '\nAll good! Run: npm run dev\n');
})().catch((error) => {
  fail(error.message);
});
