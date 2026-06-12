import { test, expect } from '@playwright/test';
import { launchUser, type User } from './fixtures';
import { LOVE_NOTE, LOVE_THRESHOLD } from '../src/content/love-note';

const CODE = 'ABODE-LOVE01';

/**
 * Fifteen hearts, driven the whole way round: panel tray -> relay -> content
 * script -> the page. The relay echoes a reaction to its sender too, which is why
 * one person pressing fifteen times is enough to light up both rooms, and this
 * asserts that on the sender's own page.
 */
test('fifteen hearts put the note over the video', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    await u.joinRoom(CODE);

    const panel = await u.openSidePanel();
    await expect(panel.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12_000 });
    await panel.waitForTimeout(1_000);

    const heart = panel.getByRole('button', { name: 'React ❤️' });

    // one short of it: nothing should be on the page yet
    for (let i = 0; i < LOVE_THRESHOLD - 1; i++) await heart.click();
    await u.video.waitForTimeout(1_200);
    await expect(u.video.locator('#ab-love')).toHaveCount(0);

    await heart.click();

    const note = u.video.locator('#ab-love');
    await expect(note).toHaveCount(1, { timeout: 8_000 });
    await expect(note.locator('.ab-love-word')).toHaveText(LOVE_NOTE);
    // confetti is the loud part, and it is meant to be there
    await expect(note.locator('.ab-confetto').first()).toBeVisible();

    // it says its piece and gets out of the way
    await expect(note).toHaveCount(0, { timeout: 12_000 });
  } finally {
    await u?.close();
  }
});
