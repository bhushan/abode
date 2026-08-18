export const PANEL_WINDOW = { width: 400, height: 760 } as const;

/** fallback only; the manifest is the source of truth */
const PANEL_PATH = 'src/sidepanel/index.html';

export type PanelSurface = 'sidepanel' | 'inpage' | 'window' | 'none';

/** how long to let a real side panel's document turn up before disbelieving it */
export const PANEL_SETTLE_MS = 300;

type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Did a panel document actually come up?
 *
 * `sidePanel.open()` resolving is a promise about the call, not about the window:
 * Arc ships the API, resolves, and paints nothing, which left the room with no
 * socket and the user with no chat. A SIDE_PANEL context is the browser admitting
 * a document exists, which is the thing we actually need.
 *
 * Answering yes when it is unknowable is deliberate. A false no puts a second
 * panel in the page, and two panels means two sockets in one room; a browser too
 * old for `getContexts` (pre-116) is one with a side panel that works.
 */
async function nativePanelUp(sleep: Sleep): Promise<boolean> {
  const contexts = () => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });

  if (typeof chrome.runtime.getContexts !== 'function') return true;
  try {
    if ((await contexts()).length > 0) return true;
    // the panel opens before its document registers, so look twice
    await sleep(PANEL_SETTLE_MS);
    return (await contexts()).length > 0;
  } catch {
    return true;
  }
}

/**
 * Opens the room panel, which is where the relay socket lives: no panel means no
 * sync, so this must never silently do nothing.
 *
 * Chrome's side panel is preferred because the video keeps its full width. Arc
 * either ships without `chrome.sidePanel` or ships one that opens nothing, so the
 * surface is chosen on what the browser did rather than what it claims: a panel
 * counts only once its document exists. Everything after the native attempt needs
 * no user gesture, which is why falling back late is still safe.
 */
export async function openPanel(tabId: number, sleep: Sleep = realSleep): Promise<PanelSurface> {
  const panel = chrome.sidePanel;
  if (panel?.open) {
    try {
      // synchronous on purpose: sidePanel.open() is only allowed while the
      // click's user activation is live, and awaiting anything first spends it
      await panel.open({ tabId });
      if (await nativePanelUp(sleep)) return 'sidepanel';
    } catch {
      // browser advertises the API but will not open one; fall through
    }
  }

  // Arc ships without chrome.sidePanel and has said it will not add it, so the
  // panel goes into the page itself: an extension iframe keeps full chrome.* access,
  // so the room's socket works exactly as it does in a real side panel.
  try {
    const hosted: unknown = await chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL' });
    if (hosted === true) return 'inpage';
  } catch {
    // no content script on this page (a store page, say); fall through to a window
  }

  try {
    const manifest = chrome.runtime.getManifest() as { side_panel?: { default_path?: string } };
    await chrome.windows.create({
      url: chrome.runtime.getURL(manifest.side_panel?.default_path ?? PANEL_PATH),
      type: 'popup',
      width: PANEL_WINDOW.width,
      height: PANEL_WINDOW.height,
    });
    return 'window';
  } catch {
    return 'none';
  }
}
