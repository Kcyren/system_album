'use strict';

// Vercel serverless entry point. vercel.json sends every page and /api
// request here; files in public/ are served directly by Vercel's CDN.
module.exports = require('../src/app');
