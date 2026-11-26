'use strict';

// Local / traditional hosting entry point: `npm start` or `npm run dev`.
// On Vercel, api/index.js serves the same app as a serverless function.
const app = require('./src/app');
const config = require('./src/config');

app.listen(config.port, () => {
  console.log(`Surgthflur - Music is running at http://localhost:${config.port}`);
  console.log(`Creator Studio: http://localhost:${config.port}/studio`);
  if (!config.configured) {
    console.log(`⚠  Supabase is not connected yet (missing ${config.missing.join(', ')}). Copy .env.example to .env and fill it in.`);
  } else if (!config.creatorEmails.length) {
    console.log('⚠  CREATOR_EMAIL is not set, so nobody can sign in to the Creator Studio.');
  }
});
