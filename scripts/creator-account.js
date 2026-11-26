'use strict';
// Creates the Creator Studio account, or sets a new password for it.
// Run on your computer with:  npm run creator
// (Uses the secret key from .env, so it never needs an email inbox.)

const readline = require('node:readline');
const config = require('../src/config');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the question once, then hide what is typed.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(question);
        else if (text === '\r\n' || text === '\n') rl.output.write(text);
        else rl.output.write('*'.repeat(text.length ? 1 : 0));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  if (!config.configured) {
    console.log(`\n✘ Fill in .env first (missing: ${config.missing.join(', ')}).\n`);
    process.exit(1);
  }
  const { db } = require('../src/supabase');

  const suggested = config.creatorEmails[0] ? config.displayName(config.creatorEmails[0]) : '';
  const typed = (await ask(`Username${suggested ? ` [${suggested}]` : ''}: `)).trim() || suggested;
  if (!typed) {
    console.log('✘ A username is required.');
    process.exit(1);
  }
  const email = config.toLoginEmail(typed);

  const password = await ask('New password (at least 10 characters): ', { hidden: true });
  if (password.length < 10) {
    console.log('✘ Too short. Use at least 10 characters — a short sentence works well.');
    process.exit(1);
  }
  if (password.length > 72) {
    console.log('✘ Too long (max 72 characters).');
    process.exit(1);
  }
  const again = await ask('Type it again: ', { hidden: true });
  if (again !== password) {
    console.log('✘ The passwords did not match. Nothing was changed.');
    process.exit(1);
  }

  // Look for an existing account with this login.
  let existing = null;
  for (let page = 1; !existing; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    existing = data.users.find((u) => u.email?.toLowerCase() === email) || null;
    if (data.users.length < 200) break;
  }

  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) throw error;
    console.log(`\n✔ Password updated for "${config.displayName(email)}".`);
  } else {
    const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    console.log(`\n✔ Creator account "${config.displayName(email)}" created.`);
  }

  if (!config.creatorEmails.includes(email)) {
    console.log(`\n⚠ Add this to .env AND to Vercel → Settings → Environment Variables, then redeploy:\n   CREATOR_EMAIL=${config.displayName(email)}`);
  }
  console.log('\nSign in at /studio with the username and password.\n');
})().catch((error) => {
  console.log(`\n✘ ${error.message}\n`);
  process.exit(1);
});
