// Vercel Function: every /api/* request. The app itself is compiled by
// `npm run build:vercel` (nest build) into dist/ — this file only hands over.
module.exports = require('../dist/serverless').default;
