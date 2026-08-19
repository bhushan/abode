import { test, expect } from '@playwright/test';
import { launchUser, setVideo, videoTime, type User } from './fixtures';

/**
 * A fresh room per test, and per run.
 *
 * A room lives in a Durable Object keyed by its code, and the lock it was left in
 * outlives both the test that set it and the run it happened in. A fixed code
 * meant the second test inherited the first's lock, and the first inherited the
 * last run's, so these passed or failed on ordering rather than on behaviour.
 */
const room = () => 'ABODE-LOCK' + Math.random().toString(36).slice(2, 6).toUpperCase();

/** A seek only counts once the player kept it; an unbuffered clip clamps it away. */
const seeked = (u: User, to: number) =>
  u.video.waitForFunction((t) => document.querySelector('video')!.currentTime > t - 2, to, { timeout: 15_000 });
const LOCKED_CODE = room();
const UNLOCK_CODE = room();

/**
 * The host lock, driven the whole way round.
 *
 * The unit tests prove the Durable Object refuses a guest's control. This is the
 * half only a real browser can prove: that the two sockets a person occupies (a
 * panel that joins the room and a content script that drives the player) are
 * recognised as the same person, and that a refused seek actually puts the
 * guest's player back where the room is rather than leaving them adrift.
 */
test('the host lock keeps a guest from steering, and puts them back', async () => {
  let host: User | undefined;
  let guest: User | undefined;
  try {
    host = await launchUser();
    guest = await launchUser();

    await host.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);
    await guest.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);

    // whoever's panel joins first wears the crown, so the host's goes up alone
    const hostPanel = await host.openSidePanel();
    await host.joinRoom(LOCKED_CODE);
    await expect(hostPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });

    const guestPanel = await guest.openSidePanel();
    await guest.joinRoom(LOCKED_CODE);
    await expect(guestPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });
    await host.video.waitForTimeout(2_000);

    // the room settles somewhere the guest is not. Confirm the seek actually took
    // before asserting it propagated: an unbuffered clip clamps the write back to
    // zero, and then this measures buffering rather than syncing.
    await setVideo(host.video, 'pause', 30);
    await seeked(host, 30);
    await expect.poll(() => videoTime(guest!.video), { timeout: 10_000 }).toBeGreaterThan(25);

    const toggle = hostPanel.getByRole('button', { name: 'Only the host controls playback' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // the guest is told, rather than left to wonder why their player fights them
    await expect(guestPanel.getByText('Host only')).toBeVisible({ timeout: 10_000 });

    // and now the guest cannot steer: the seek is refused and undone
    await setVideo(guest.video, 'pause', 3);
    await expect.poll(() => videoTime(guest!.video), { timeout: 10_000 }).toBeGreaterThan(25);
    // nobody else was dragged along
    expect(await videoTime(host.video)).toBeGreaterThan(25);
  } finally {
    await host?.close();
    await guest?.close();
  }
});

test('unlocking hands playback back to the room', async () => {
  let host: User | undefined;
  let guest: User | undefined;
  try {
    host = await launchUser();
    guest = await launchUser();

    await host.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);
    await guest.video.waitForFunction(() => (window as { __wbVideoReady?: boolean }).__wbVideoReady === true);

    const hostPanel = await host.openSidePanel();
    await host.joinRoom(UNLOCK_CODE);
    await expect(hostPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });

    await guest.openSidePanel();
    await guest.joinRoom(UNLOCK_CODE);
    await host.video.waitForTimeout(2_000);

    const toggle = hostPanel.getByRole('button', { name: 'Only the host controls playback' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await host.video.waitForTimeout(1_000);

    await setVideo(guest.video, 'pause', 20);
    await seeked(guest, 20);
    await expect.poll(() => videoTime(host!.video), { timeout: 10_000 }).toBeGreaterThan(15);
  } finally {
    await host?.close();
    await guest?.close();
  }
});
