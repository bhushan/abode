export const PANEL_WINDOW = { width: 400, height: 760 } as const;

/** fallback only; the manifest is the source of truth */
const PANEL_PATH = 'src/sidepanel/index.html';

export type PanelSurface = 'sidepanel' | 'inpage' | 'window' | 'none';

/**
 * Opens the room panel, which is where the relay socket lives: no panel means no
 * sync, so this must never silently do nothing.
 *
 * Chrome's side panel is preferred because the video keeps its full width. Arc and
 * other Chromium browsers ship without `chrome.sidePanel`, so those fall back to a
 * small window. `windows.create` needs no user gesture, which is why falling back
 * after an awaited rejection is still safe.
 */
export async function openPanel(tabId: number): Promise<PanelSurface> {
  const panel = chrome.sidePanel;
  if (panel?.open) {
    try {
      // synchronous on purpose: sidePanel.open() is only allowed while the
      // click's user activation is live, and awaiting anything first spends it
      await panel.open({ tabId });
      return 'sidepanel';
    } catch {
      // browser advertises the API but will not open one; fall through to a window
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
