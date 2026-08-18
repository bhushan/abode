import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// vitest-pool-workers 0.22 dropped defineWorkersConfig/poolOptions in favour of
// this plugin. Tests run inside workerd, so the Durable Object under test is the
// real thing rather than a mock.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
});
