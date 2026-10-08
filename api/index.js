// Vercel Function: every /api/* request. The app itself is compiled by
// `npm run vercel-build` (nest build) into dist/ — this file only hands over.
module.exports = require('../dist/serverless').default;
