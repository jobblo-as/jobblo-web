// pm2 process file for the production API (deploy.sh: pm2 startOrReload ecosystem.config.js).
// These env values beat backend/.env (dotenv never overrides an already-set variable), so a
// .env copied from .env.example (NODE_ENV=development) cannot switch production safety off.
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
      },
    },
  ],
};
