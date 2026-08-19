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

/**
 * The in-page panel, in the production build, against the deployed relay.
 *
 * The panel is where the room's socket lives, and on a browser without a side
 * panel that panel is an iframe inside somebody's page. Everything about that is
 * more fragile than a browser surface: it has to be declared web-accessible, it
 * has to boot inside a shadow root on a page it does not control, and it has to
 * open a wss connection from there. Local tests prove the wiring; only this
 * proves it against the relay people actually connect to.
 */
test('the in-page panel reaches the deployed relay', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const code = 'ABODE-LIVEP' + Math.floor(Math.random() * 9 + 1);
    await u.joinRoom(code);

    const tabId = await u.worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url?.includes('video.html'))?.id ?? null;
    });
    expect(tabId).not.toBeNull();

    await expect(
      u.worker.evaluate((id) => chrome.tabs.sendMessage(id as number, { type: 'OPEN_PANEL' }), tabId),
    ).resolves.toBe(true);

    // connected, not merely rendered: this only turns green once the socket is up
    const panel = u.video.frameLocator('#ab-panel-host iframe');
    await expect(panel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 40_000 });
  } finally {
    await u?.close();
  }
});
