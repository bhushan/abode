import { sendToBackground } from './messages';

export const PANEL_WINDOW = { width: 400, height: 760 } as const;

/** fallback only; the manifest is the source of truth */
const PANEL_PATH = 'src/sidepanel/index.html';

/** how long to let a real side panel's document turn up before disbelieving it */
export const PANEL_SETTLE_MS = 300;

export type PanelSurface = 'sidepanel' | 'inpage' | 'window' | 'none';

type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask for the room panel, from a document that is about to stop existing.
 *
 * The popup calls this and closes itself a moment later, so nothing awaited here
 * would ever finish. That is the whole reason this is split in two: the only work
 * a dying document can be trusted with is the synchronous native attempt, which
 * has to happen here anyway because `sidePanel.open()` is only allowed while the
 * click's user activation is live and a single `await` spends it.
 *
 * Everything that has to outlive the popup is the service worker's job.
 */
export function tryNativePanel(tabId: number): void {
  try {
    void chrome.sidePanel?.open?.({ tabId })?.catch?.(() => undefined);
  } catch {
    // a browser that ships the namespace but not the method
  }
}

/** As above, and then hands the rest to the worker. The popup's entry point. */
export function requestPanel(tabId: number): Promise<void> {
  tryNativePanel(tabId);
  // returned, not awaited here: a caller that is about to close its own document
  // can wait for delivery, and one that cannot has already spent what it had
  return sendToBackground({ type: 'WB_ENSURE_PANEL', tabId }).catch(() => undefined);
}

/**
 * Did a panel document actually come up?
 *
 * `sidePanel.open()` resolving is a promise about the call, not about the window:
 * Arc ships the API, resolves, and paints nothing. A SIDE_PANEL context is the
 * browser admitting a document exists, which is the thing we actually need.
 *
 * Answering yes when it is unknowable is deliberate. A false no puts a second
 * panel in the page, and two panels means two sockets in one room; a browser too
 * old for `getContexts` (pre-116) is one with a side panel that works.
 */
async function nativePanelUp(sleep: Sleep): Promise<boolean> {
  if (typeof chrome.runtime.getContexts !== 'function') return true;
  const contexts = () => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
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
 * Make sure the room has a panel somewhere, and say where it ended up.
 *
 * Runs in the service worker, which is the point: it outlives the popup that
 * asked. No panel means no socket means no sync, so this must never quietly do
 * nothing. Chrome's side panel is preferred (the video keeps its full width),
 * then the page itself, and a detached window last because it hides behind the
 * video and is gone in fullscreen.
 *
 * Nothing here needs a user gesture, which is why running it late is safe.
 */
export async function ensurePanel(tabId: number, sleep: Sleep = realSleep): Promise<PanelSurface> {
  if (await nativePanelUp(sleep)) return 'sidepanel';

  // Arc either ships no side panel or ships one that opens nothing, and has said
  // it will not add the API. An extension iframe is the honest answer: it is an
  // extension document, so the relay socket behaves as it does in a real panel.
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
