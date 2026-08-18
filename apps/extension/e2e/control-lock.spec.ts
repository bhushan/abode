import { test, expect } from '@playwright/test';
import { launchUser, setVideo, videoTime, type User } from './fixtures';

const CODE = 'ABODE-LOCK99';

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
    await host.joinRoom(CODE);
    await expect(hostPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });

    const guestPanel = await guest.openSidePanel();
    await guest.joinRoom(CODE);
    await expect(guestPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });
    await host.video.waitForTimeout(2_000);

    // the room settles somewhere the guest is not
    await setVideo(host.video, 'pause', 30);
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
    await host.joinRoom(CODE);
    await expect(hostPanel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });

    await guest.openSidePanel();
    await guest.joinRoom(CODE);
    await host.video.waitForTimeout(2_000);

    const toggle = hostPanel.getByRole('button', { name: 'Only the host controls playback' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await host.video.waitForTimeout(1_000);

    await setVideo(guest.video, 'pause', 20);
    await expect.poll(() => videoTime(host!.video), { timeout: 10_000 }).toBeGreaterThan(15);
  } finally {
    await host?.close();
    await guest?.close();
  }
});
