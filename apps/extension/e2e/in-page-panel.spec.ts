import { test, expect } from '@playwright/test';
import { launchUser, VIDEO_URL, type User } from './fixtures';

/**
 * Arc ships without `chrome.sidePanel` and has said it will not add it, so on those
 * browsers the panel is hosted inside the page instead. This is the half that only
 * a real browser can prove: that the page is allowed to frame an extension page at
 * all (web_accessible_resources), and that the panel app actually boots in there.
 * A fake DOM would happily "pass" with the manifest entry missing.
 */

const PANEL_HOST_ID = 'ab-panel-host';

async function videoTabId(u: User): Promise<number> {
  const id = await u.worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url)?.id ?? null;
  }, VIDEO_URL);
  if (id == null) throw new Error('video tab not found');
  return id;
}

// exactly what openPanel() sends when there is no side panel to open
const askPageToHost = (u: User, tabId: number) =>
  u.worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'OPEN_PANEL' }), tabId);

const panelCount = (u: User) =>
  u.video.evaluate((id) => document.querySelectorAll(`#${id}`).length, PANEL_HOST_ID);

test('a browser with no side panel gets the room panel inside the page', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const tabId = await videoTabId(u);

    await expect(askPageToHost(u, tabId)).resolves.toBe(true);

    // shadow root, so the host site's stylesheet cannot reach in and ours cannot leak out
    const framed = await u.video.evaluate((id) => {
      const host = document.getElementById(id);
      const frame = host?.shadowRoot?.querySelector('iframe');
      return { hasShadow: !!host?.shadowRoot, src: frame?.getAttribute('src') ?? null };
    }, PANEL_HOST_ID);

    expect(framed.hasShadow).toBe(true);
    expect(framed.src).toContain('/src/sidepanel/index.html');

    // the load itself is the assertion: without web_accessible_resources the page
    // is refused permission to frame this and no such frame ever appears
    // css pierces the open shadow root, so the iframe is reachable from the page
    const panel = u.video.frameLocator(`#${PANEL_HOST_ID} iframe`);
    await expect(panel.getByText('No room yet')).toBeVisible({ timeout: 15_000 });
  } finally {
    await u?.close();
  }
});

test('asking twice keeps one panel rather than stacking them', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const tabId = await videoTabId(u);

    await askPageToHost(u, tabId);
    await askPageToHost(u, tabId);

    await expect(panelCount(u)).resolves.toBe(1);
  } finally {
    await u?.close();
  }
});

test('the panel can be closed from inside the page', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const tabId = await videoTabId(u);
    await askPageToHost(u, tabId);
    await expect(panelCount(u)).resolves.toBe(1);

    // the native panel gets a close control from the browser; in the page we ship one
    await u.video.evaluate((id) => {
      const btn = document.getElementById(id)?.shadowRoot?.querySelector('button');
      (btn as HTMLButtonElement | null)?.click();
    }, PANEL_HOST_ID);

    await expect(panelCount(u)).resolves.toBe(0);
  } finally {
    await u?.close();
  }
});

test('leaving the room takes the in-page panel with it', async () => {
  let u: User | undefined;
  try {
    u = await launchUser();
    const tabId = await videoTabId(u);
    await u.joinRoom('ABODE-PANEL01');
    await askPageToHost(u, tabId);
    await expect(panelCount(u)).resolves.toBe(1);

    await u.worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'LEAVE_ROOM' }), tabId);

    await expect.poll(() => panelCount(u!), { timeout: 10_000 }).toBe(0);
  } finally {
    await u?.close();
  }
});
