import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  globalSetup: './e2e/helpers/warmup.js',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../backend/scripts/start-isolated-test.js',
      url: 'http://127.0.0.1:5017/api/docs/',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // e2e/vite.e2e.config.mjs = the app's vite.config.ts with its own dep cache, so this
      // server does not re-optimise over the 5173 dev server and hang lazy routes.
      command: 'npx vite --config e2e/vite.e2e.config.mjs --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176',
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VITE_MAIN_URL: 'http://127.0.0.1:5017',
        // The default (hidden), whatever a local frontend/.env says; 5177 below turns it on.
        VITE_APPLE_SIGNIN_ENABLED: 'false',
      },
    },
    {
      // Same app with a build-time flag on (e2e/apple-signin.spec.js): VITE_* is baked in at
      // startup, so "enabled" needs its own server. It shares 5176's dep cache: VITE_* values
      // are not part of the optimiser hash, so neither server re-optimises over the other.
      command: 'npx vite --config e2e/vite.e2e.config.mjs --host 127.0.0.1 --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VITE_MAIN_URL: 'http://127.0.0.1:5017',
        VITE_APPLE_SIGNIN_ENABLED: 'true',
      },
    },
  ],
});
