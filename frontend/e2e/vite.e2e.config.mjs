/**
 * The app's own Vite config, for the Playwright dev servers only.
 *
 * - Its own cache dir: several dev servers (5173, the e2e ones) sharing node_modules/.vite
 *   re-optimise over each other ("The service was stopped") and lazy routes hang on
 *   "Laster …".
 * - lucide-react/dynamic is pre-bundled: first imported by a lazy route, it otherwise
 *   triggers a mid-test re-optimisation and full reload.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config.ts';

export default mergeConfig(base, defineConfig({
  cacheDir: 'node_modules/.vite-e2e',
  optimizeDeps: { include: ['lucide-react/dynamic'] },
  // Transform every source file at start-up, so the first visit to each lazy route in a
  // test is not also its compile (that alone blew 30 s test timeouts under parallel load).
  server: { warmup: { clientFiles: ['./src/**/*.tsx'] } },
}));
