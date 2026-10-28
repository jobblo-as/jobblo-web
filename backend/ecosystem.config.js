// pm2 process file for the production API (deploy.sh: pm2 startOrReload ecosystem.config.js).
// These env values beat backend/.env.production (dotenv never overrides an
// already-set variable), so an env file with NODE_ENV=development cannot switch production safety off.
const { execSync } = require('child_process');

/** `git <args>` in this checkout, '' when git is unavailable. */
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

module.exports = {
  apps: [
    {
      name: 'jobblo-api',
      script: 'server.js',
      cwd: __dirname,
      // bootstrap/shutdown.js drains for up to 10 s and cluster.js waits that + 5 s before killing
      // workers; pm2's default 1.6 s would SIGKILL mid-drain. Keep above SHUTDOWN_TIMEOUT_MS + 5 s.
      kill_timeout: 16000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1', // only the local nginx reaches the API
        // One worker per CPU via cluster.js (needs REDIS_URL). Keep pm2 in fork mode: with
        // `pm2 -i` every process is a worker without a slot and the scheduler never runs.
        WEB_CONCURRENCY: 'auto',
        // Release identity for the developer console (Deployments). deploy.sh exports these;
        // pm2 reads this file in that shell, so they land here. A manual `pm2 startOrReload`
        // falls back to the checkout's commit and branch.
        GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA || git('rev-parse HEAD'),
        GIT_BRANCH: process.env.GIT_BRANCH || git('branch --show-current'),
        ...(process.env.APP_VERSION ? { APP_VERSION: process.env.APP_VERSION } : {}),
        ...(process.env.DEPLOYED_AT ? { DEPLOYED_AT: process.env.DEPLOYED_AT } : {}),
      },
    },
  ],
};
