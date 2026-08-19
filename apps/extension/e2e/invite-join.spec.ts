import { test, expect } from '@playwright/test';
import { launchUser, VIDEO_URL, type User } from './fixtures';

/**
 * Following an invite link: the entire first experience of anyone who did not
 * start the room, and until now the one flow with no coverage at all.
 *
 * It is also where the panel is hardest to place. The landing page runs the
 * invite bridge rather than the room, so it can host nothing, and a moment later
 * it is replaced by the video anyway. Opening a panel against it produced a
 * detached window, which is the worst of the three surfaces and the wrong one.
 *
 * Worth knowing, and the reason there are two tests here: the native side panel
 * really does open on this path, even though the call is made by the service
 * worker. The click happens in the page and is forwarded straight through, so the
 * user activation is still live when the worker spends it. Chrome therefore takes
 * the native path here, and only a browser whose panel does nothing falls through
 * to the page.
 */

const CODE = 'ABODE-INVITE1';
const PANEL_HOST_ID = 'ab-panel-host';
// the host the build's invite base URL names, exactly: the bridge matches on
// hostname, and 127.0.0.1 is a different one
const RELAY = 'http://localhost:3100';

const inviteUrl = (dest: string) => `${RELAY}/j#c=${CODE}&u=${encodeURIComponent(dest)}`;

const inPagePanels = (u: User) =>
  u.video.evaluate((id) => document.querySelectorAll(`#${id}`).length, PANEL_HOST_ID);

const sidePanelContexts = (u: User) =>
  u.worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length);

/** Click through the invite and wait until the room is recorded and the tab moved. */
async function followInvite(u: User) {
  await u.video.goto(inviteUrl(VIDEO_URL));

  // the page only offers "join" once the content script has marked the document
  await expect
    .poll(() => u.video.evaluate(() => document.documentElement.dataset.abInstalled ?? null), { timeout: 20_000 })
    .toBe('1');

  await expect(u.video.locator('#join-link')).toBeVisible({ timeout: 20_000 });
  await u.video.locator('#join-link').click();

  await expect
    .poll(
      async () => {
        const d: { ab_inRoom?: boolean; ab_roomCode?: string } = await u.worker.evaluate(() =>
          chrome.storage.local.get(['ab_inRoom', 'ab_roomCode']),
        );
        return d.ab_inRoom === true ? (d.ab_roomCode ?? '') : '';
      },
      { timeout: 20_000 },
    )
    .toBe(CODE);

  await u.video.waitForURL(VIDEO_URL, { timeout: 25_000 });
  await u.video.waitForSelector('video');
}

test('chrome: an invite joins the room, lands on the video, and opens the browser panel', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    await followInvite(u);

    await expect.poll(() => sidePanelContexts(u!), { timeout: 20_000 }).toBe(1);
    // the browser has one, so the page must not also be given one
    await u.video.waitForTimeout(2_000);
    expect(await inPagePanels(u)).toBe(0);
  } finally {
    await u?.close();
  }
});

test('arc: an invite joins the room and the video page gets the panel instead', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    // Arc, in the one place this flow touches it: the worker is what calls
    // sidePanel.open here, so that is where the API has to answer and do nothing
    await u.worker.evaluate(() => {
      chrome.sidePanel.open = () => Promise.resolve();
    });

    await followInvite(u);

    // the panel was owed to a landing page that could not hold one; this only
    // passes if the video page claimed it after arriving
    await expect.poll(() => inPagePanels(u!), { timeout: 25_000 }).toBe(1);
    expect(await sidePanelContexts(u)).toBe(0);

    const panel = u.video.frameLocator(`#${PANEL_HOST_ID} iframe`);
    await expect(panel.getByLabel('Message the room')).toBeVisible({ timeout: 25_000 });
  } finally {
    await u?.close();
  }
});
