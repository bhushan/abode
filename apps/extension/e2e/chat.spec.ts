import { test, expect } from '@playwright/test';
import { launchUser, type User } from './fixtures';

const CODE = 'ABODE-CHAT01';

// send a message through the side panel composer
async function say(panel: User['video'], text: string) {
  const input = panel.getByPlaceholder('Message the room');
  await input.fill(text);
  await input.press('Enter');
}

test('chat messages travel between two users in the same room', async () => {
  let a: User | undefined;
  let b: User | undefined;
  try {
    a = await launchUser();
    b = await launchUser();

    await a.joinRoom(CODE);
    await b.joinRoom(CODE);

    const ap = await a.openSidePanel();
    const bp = await b.openSidePanel();

    // both panels must be connected before chat can flow; the lock strip is the
    // only honest signal for that
    await expect(ap.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(bp.getByText('In sync', { exact: true })).toBeVisible({ timeout: 12000 });
    await ap.waitForTimeout(1500);

    // A to B
    await say(ap, 'this shot is unreal');
    await expect(bp.getByText('this shot is unreal')).toBeVisible({ timeout: 8000 });

    // B to A
    await say(bp, 'told you');
    await expect(ap.getByText('told you')).toBeVisible({ timeout: 8000 });
  } finally {
    await a?.close();
    await b?.close();
  }
});
