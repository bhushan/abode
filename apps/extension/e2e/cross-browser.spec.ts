import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import { launchUser, setVideo, videoPaused, type User } from './fixtures';

/**
 * One room, two browsers that put the panel in different places.
 *
 * A browser with no working side panel gets its panel as an iframe inside the
 * page; Chrome's is a browser surface. Everything downstream of that (the socket,
 * chat, the sync engine) is meant not to care, and this is the test that says so
 * rather than assuming it. Nothing else exercises both surfaces in one room.
 *
 * The in-page half is mounted the way the product mounts it. The Chrome half
 * opens the panel document directly, which is what a native side panel amounts to
 * from the extension's side and the only thing automation can do with it.
 */

const CODE = 'ABODE-XBROW01';
const PANEL_HOST_ID = 'ab-panel-host';

/** The fallback surface: the panel hosted inside the page, in a shadow root. */
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
  let inPage: User | undefined;
  let native: User | undefined;
  try {
    inPage = await launchUser();
    native = await launchUser();

    // a real source or the synthetic fallback: pausing a video that never started
    // emits nothing to propagate
    await inPage.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);
    await native.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);

    await inPage.joinRoom(CODE);
    await native.joinRoom(CODE);

    const pagePanel = await inPagePanel(inPage);
    const chromePanel = await native.openSidePanel();

    // connected, not merely rendered: the lock strip is the only honest signal
    await expect(pagePanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(chromePanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 20_000 });
    await native.video.waitForTimeout(1500);

    // chat, both directions, across the two surfaces
    await say(pagePanel, 'the panel is in my page');
    await expect(chromePanel.getByText('the panel is in my page')).toBeVisible({ timeout: 12_000 });

    await say(chromePanel, 'mine is in the browser');
    await expect(pagePanel.getByText('mine is in the browser')).toBeVisible({ timeout: 12_000 });

    // and playback, which is the part people would actually notice breaking
    await setVideo(native.video, 'play');
    await expect.poll(() => videoPaused(inPage!.video), { timeout: 15_000 }).toBe(false);

    // past the echo guard: applying a remote control makes the player fire the
    // same events a person does, so for a moment after one lands its own page is
    // deliberately deaf to itself
    await inPage.video.waitForTimeout(1000);
    await setVideo(inPage.video, 'pause');
    await expect.poll(() => videoPaused(native!.video), { timeout: 15_000 }).toBe(true);
  } finally {
    await inPage?.close();
    await native?.close();
  }
});
