import { defineConfig } from '@playwright/test';

// The content-script sync socket leaves with the page's origin, so the relay
// gets its own port (no clash with a dev server on 3000) and serves plain http,
// which keeps the test run free of certificate setup.
export default defineConfig({
  testDir: './e2e',
  // live.spec.ts talks to the deployed relay; run it with `pnpm test:live`
  testIgnore: 'live.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  webServer: [
    {
      command: 'node e2e/serve.mjs',
      url: 'http://127.0.0.1:5190/video.html',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Real workerd via wrangler, not a stub: the e2e suite is the only place
      // the extension and the Durable Object are exercised against each other.
      command: 'pnpm --filter @abode/relay exec wrangler dev --port 3100 --local',
      url: 'http://127.0.0.1:3100/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
