import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import { launchUser, setVideo, videoPaused, type User } from './fixtures';

/**
 * One room, two browsers that put the panel in different places.
 *
 * Arc has no working side panel, so its user's panel is an iframe inside the page
 * while Chrome's is a browser surface. Everything downstream of that (the socket,
 * chat, the sync engine) is meant not to care, and this is the test that says so
 * rather than assuming it. Nothing else exercises both surfaces in one room.
 *
 * The Arc half is the real in-page panel, mounted the way the product mounts it.
 * The Chrome half opens the panel document directly, which is what a native side
 * panel amounts to from the extension's side and the only thing automation can
 * do with it.
 */

const CODE = 'ABODE-XBROW01';
const PANEL_HOST_ID = 'ab-panel-host';

/** The Arc surface: the panel hosted inside the page, in a shadow root. */
async function inPagePanel(u: User): Promise<FrameLocator> {
  const tabId = await u.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
  if (tabId == null) throw new Error('no active tab');

  const hosted = await u.worker.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: 'OPEN_PANEL' }),
    tabId,
  );
  expect(hosted).toBe(true);
  return u.video.frameLocator(`#${PANEL_HOST_ID} iframe`);
}

const say = async (panel: Page | FrameLocator, text: string) => {
  const input = panel.getByPlaceholder('Message the room');
  await input.fill(text);
  await input.press('Enter');
};

test('a room works across both panel surfaces at once', async () => {
  let arc: User | undefined;
  let chrome_: User | undefined;
  try {
    arc = await launchUser();
    chrome_ = await launchUser();

    // a real source or the synthetic fallback: pausing a video that never started
    // emits nothing to propagate
    await arc.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);
    await chrome_.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);

    await arc.joinRoom(CODE);
    await chrome_.joinRoom(CODE);

    const arcPanel = await inPagePanel(arc);
    const chromePanel = await chrome_.openSidePanel();

    // connected, not merely rendered: the lock strip is the only honest signal
    await expect(arcPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(chromePanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 20_000 });
    await chrome_.video.waitForTimeout(1500);

    // chat, both directions, across the two surfaces
    await say(arcPanel, 'the panel is in my page');
    await expect(chromePanel.getByText('the panel is in my page')).toBeVisible({ timeout: 12_000 });

    await say(chromePanel, 'mine is in the browser');
    await expect(arcPanel.getByText('mine is in the browser')).toBeVisible({ timeout: 12_000 });

    // and playback, which is the part people would actually notice breaking
    await setVideo(chrome_.video, 'play');
    await expect.poll(() => videoPaused(arc!.video), { timeout: 15_000 }).toBe(false);

    // past the echo guard: applying a remote control makes the player fire the
    // same events a person does, so for a moment after one lands its own page is
    // deliberately deaf to itself
    await arc.video.waitForTimeout(1000);
    await setVideo(arc.video, 'pause');
    await expect.poll(() => videoPaused(chrome_!.video), { timeout: 15_000 }).toBe(true);
  } finally {
    await arc?.close();
    await chrome_?.close();
  }
});
