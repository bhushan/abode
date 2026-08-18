import { describe, expect, it } from 'vitest';
import config from '../vite.config';

// Chrome refuses to reuse a <link rel="modulepreload" crossorigin> emitted into an
// extension page ("cross-world extension resource mismatch"), so every preloaded
// chunk is fetched twice and the extension's error page fills with warnings.
// Nothing is gained by preloading here anyway: the assets are already on disk.
describe('build config', () => {
  it('emits no module preloads', () => {
    const build = (config as { build?: { modulePreload?: unknown } }).build;
    expect(build?.modulePreload).toBe(false);
  });
});
