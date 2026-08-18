import { generateCode } from './room';
import type { PopupMessage } from './messages';

export interface StartRoomDeps {
  /**
   * Called before anything is awaited. `chrome.sidePanel.open()` is only allowed
   * while the click's user activation is still live, and a single `await` spends
   * it, so the order here is the contract rather than a preference.
   */
  openPanel: (tabId: number) => void;
  send: (msg: PopupMessage) => Promise<void>;
  close: () => void;
  /** overridable so tests can pin the code; production always generates one */
  newCode?: () => string;
}

/**
 * The popup's primary action, kept out of the component so the ordering it
 * depends on can be asserted directly.
 *
 * Two things have to happen in this exact sequence: open the panel while the
 * gesture is still valid, then wait for the room message to actually land before
 * tearing down the document that sent it.
 */
export async function startRoom(tabId: number | null, d: StartRoomDeps): Promise<void> {
  if (tabId == null) return;
  const code = (d.newCode ?? generateCode)();

  d.openPanel(tabId);

  try {
    await d.send({ type: 'WB_START_ROOM', code, tabId });
  } catch {
    // the room was never recorded, so leave the popup open rather than closing
    // it as though something had started
    return;
  }

  d.close();
}
