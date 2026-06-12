import { test, expect } from '@playwright/test';
import { launchUser, type User } from './fixtures';

// Inlined rather than imported from src/lib/room: that module reads
// import.meta.env, which Playwright's node runner does not provide.
const ROOM_CODE_RE = /^[A-Z]{2,8}-[A-Z0-9]{4,12}$/;

// These target the rewritten popup: one primary action when idle, and the invite
// link front and centre once a room exists.

test('starting a party puts a valid room code into storage', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const popup = await u.openPopup();
    // A real toolbar popup is an overlay, so the video page stays Chrome's active
    // tab. Opened as a tab here it would steal that, and the popup reads the
    // active tab to decide whether there is anything to watch.
    await u.video.bringToFront();

    // the button stays disabled until the active-tab video probe and the server
    // ping both resolve, and clicking it closes the popup, so don't wait after
    const start = popup.getByRole('button', { name: 'Start watching together' });
    await expect(start).toBeEnabled({ timeout: 15_000 });
    await start.dispatchEvent('click');

    // the popup closes itself on start, so read through the service worker and
    // only report a code once the room flag is actually set
    await expect
      .poll(
        async () => {
          const d: { ab_inRoom?: boolean; ab_roomCode?: string } = await u!.worker.evaluate(() =>
            chrome.storage.local.get(['ab_inRoom', 'ab_roomCode']),
          );
          return d.ab_inRoom === true ? (d.ab_roomCode ?? '') : '';
        },
        { timeout: 15_000 },
      )
      .toMatch(ROOM_CODE_RE);
  } finally {
    await u?.close();
  }
});

test('editing your name and colour persists the identity', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const popup = await u.openPopup();

    // name and colour live behind Edit, so the resting popup stays a single action
    await popup.getByRole('button', { name: 'Edit' }).click();
    await popup.getByLabel('Your name').fill('Bhushan');
    await popup.getByRole('radio', { name: 'Colour 4' }).click();

    await expect
      .poll(async () => {
        const d: { ab_identity?: { name?: string; tint?: number } } = await u!.worker.evaluate(() =>
          chrome.storage.local.get('ab_identity'),
        );
        return d.ab_identity ?? {};
      })
      .toMatchObject({ name: 'Bhushan', tint: 3 });
  } finally {
    await u?.close();
  }
});
