import { defineConfig } from '@playwright/test';
process.env.ABODE_EXT_DIR = 'dist-live';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'live.spec.ts',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  webServer: [{
    command: 'node e2e/serve.mjs',
    url: 'http://127.0.0.1:5190/video.html',
    reuseExistingServer: true,
    timeout: 30_000,
  }],
});
