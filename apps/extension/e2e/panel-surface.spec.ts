import { test, expect, type Page } from '@playwright/test';
import { launchUser, type User } from './fixtures';

/**
 * Where the room panel ends up, driven through the real popup rather than around
 * it.
 *
 * The bug these exist for was invisible to every other spec, because every other
 * spec asks the content script to host the panel directly. Nothing went through
 * the popup, and the popup was the problem: it called for a panel and then closed
 * itself, so every fallback ran inside a document being torn down. Chrome never
 * noticed, because its own panel is opened by the browser process and finishes
 * regardless. Arc, which has no working side panel, was left with no panel and
 * therefore no socket at all.
 *
 * One thing is simulated in each, and only one: whether the browser has a side
 * panel that works. Automation cannot open Chrome's real one (it needs user
 * activation, and a synthetic click carries none) and Arc cannot be automated at
 * all: it permits a single instance, ignores --remote-debugging-port, and quits
 * when handed an automation profile. Everything else here is the real popup, the
 * real service worker, and the real content script.
 */

const PANEL_HOST_ID = 'ab-panel-host';

async function openPopup(u: User, opts: { deadSidePanel?: boolean } = {}): Promise<Page> {
  const url = await u.worker.evaluate(() =>
    chrome.runtime.getURL(chrome.runtime.getManifest().action!.default_popup),
  );
  const page = await u.context.newPage();
  if (opts.deadSidePanel) {
    // Arc, exactly: the namespace is present, the call resolves, no window appears
    await page.addInitScript(() => {
      const panel = (globalThis as { chrome?: { sidePanel?: { open?: unknown } } }).chrome?.sidePanel;
      if (panel) panel.open = () => Promise.resolve();
    });
  }
  await page.goto(url);
  return page;
}

/**
 * A real toolbar popup is an overlay, so the video page stays the active tab.
 * Opened as a tab it would steal that, and the popup reads the active tab to
 * decide whether there is anything to watch, so the click is dispatched rather
 * than performed.
 */
async function startRoom(u: User, popup: Page) {
  await u.video.bringToFront();
  const start = popup.getByRole('button', { name: 'Start watching together' });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.dispatchEvent('click');
}

const inRoom = (u: User) =>
  u.worker.evaluate(async () => (await chrome.storage.local.get('ab_inRoom')).ab_inRoom === true);

const inPagePanels = (u: User) =>
  u.video.evaluate((id) => document.querySelectorAll(`#${id}`).length, PANEL_HOST_ID);

test('arc: the panel arrives even though the browser opened nothing and the popup died', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const popup = await openPopup(u, { deadSidePanel: true });
    await startRoom(u, popup);

    // the real popup closes itself here; destroying the page is the harsher
    // version of the same thing, and everything the fix needs must survive it
    await expect.poll(() => inRoom(u!), { timeout: 20_000 }).toBe(true);
    await popup.close().catch(() => undefined);

    await expect.poll(() => inPagePanels(u!), { timeout: 20_000 }).toBe(1);

    // a working panel, not just an element: this text only appears once the panel
    // app has booted inside the frame and knows it is in a room
    const panel = u.video.frameLocator(`#${PANEL_HOST_ID} iframe`);
    await expect(panel.getByLabel('Message the room')).toBeVisible({ timeout: 25_000 });
  } finally {
    await u?.close();
  }
});

test('chrome: a working side panel is left alone, with no second panel in the page', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    // what a browser with a real side panel reports, which is the one thing
    // automation cannot make Chrome actually do
    await u.worker.evaluate(() => {
      chrome.runtime.getContexts = () => Promise.resolve([{ contextType: 'SIDE_PANEL' }] as never);
    });

    const popup = await openPopup(u);
    await startRoom(u, popup);
    await expect.poll(() => inRoom(u!), { timeout: 20_000 }).toBe(true);
    await popup.close().catch(() => undefined);

    // long enough for the fallback to have run if it were going to: two panels
    // would mean two sockets in one room
    await u.video.waitForTimeout(3_000);
    expect(await inPagePanels(u)).toBe(0);
  } finally {
    await u?.close();
  }
});

test('arc: the panel comes back after the page navigates out from under it', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const popup = await openPopup(u, { deadSidePanel: true });
    await startRoom(u, popup);
    await expect.poll(() => inRoom(u!), { timeout: 20_000 }).toBe(true);
    await popup.close().catch(() => undefined);
    await expect.poll(() => inPagePanels(u!), { timeout: 20_000 }).toBe(1);

    // the next episode, a reload, anything that replaces the document: a native
    // side panel belongs to the window and would not notice, and this one has to
    // be put back or the person is in a room with no socket
    await u.video.reload();
    await u.video.waitForSelector('video');

    await expect.poll(() => inPagePanels(u!), { timeout: 20_000 }).toBe(1);
    const panel = u.video.frameLocator(`#${PANEL_HOST_ID} iframe`);
    await expect(panel.getByLabel('Message the room')).toBeVisible({ timeout: 25_000 });
  } finally {
    await u?.close();
  }
});
