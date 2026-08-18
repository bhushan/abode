import { test, expect } from '@playwright/test';
import { launchUser, videoPaused, setVideo, type User } from './fixtures';

// Same sync assertions as video-sync.spec, but the production build talking to
// the DEPLOYED relay over wss. Proves the live path, so the only untested thing
// left is the per-site player adapters.
test('play/pause syncs through the deployed relay', async () => {
  let a: User | undefined, b: User | undefined;
  try {
    a = await launchUser();
    b = await launchUser();
    const code = 'ABODE-LIVE' + Math.floor(Math.random() * 90 + 10);
    await a.joinRoom(code);
    await b.joinRoom(code);

    await setVideo(a.video, 'pause');
    await a.video.waitForTimeout(2500); // live round trip, not localhost

    await setVideo(a.video, 'play');
    await expect.poll(() => videoPaused(b.video), { timeout: 20_000 }).toBe(false);

    await setVideo(a.video, 'pause');
    await expect.poll(() => videoPaused(b.video), { timeout: 20_000 }).toBe(true);
  } finally {
    await a?.close();
    await b?.close();
  }
});
