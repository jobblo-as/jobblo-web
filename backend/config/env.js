/**
 * Loads the backend env file exactly once, whoever requires it first (server.js, app.js, scripts).
 *   development (default) and test: backend/.env.development
 *   production (pm2 sets NODE_ENV=production): backend/.env.production only
 * backend/.env.<NODE_ENV> is read first, so another mode can have its own file. dotenv never
 * overrides a set variable, so real environment variables win over the file.
 */
const path = require('path');

if (!global.__jobbloEnvLoaded) {
  const dotenv = require('dotenv');
  const mode = process.env.NODE_ENV || 'development';
  const files = [`.env.${mode}`, ...(mode === 'production' ? [] : ['.env.development'])];
  for (const file of new Set(files)) {
    dotenv.config({ path: path.join(__dirname, '..', file), quiet: true });
  }
  global.__jobbloEnvLoaded = true;
}

module.exports = process.env;
