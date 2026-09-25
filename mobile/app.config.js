// app.json, plus the app's Android push credential once it is dropped in beside it (README, "Phone notifications"):
// with no google-services.json the app still builds, and tells the computer notifications aren't switched on yet.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = ({ config }) => (existsSync(join(__dirname, 'google-services.json'))
  ? { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } }
  : config);
