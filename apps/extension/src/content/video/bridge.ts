/**
 * The messages a player frame and its top frame exchange.
 *
 * The real `<video>` is often on another origin (Crunchyroll's Vilos player, most
 * embedded players), so the top frame cannot touch it. Instead the child frame
 * announces itself, reports what its player is doing, and takes instructions.
 *
 * Both ends are our own content script in the same tab, and postMessage is the
 * only channel that crosses an origin boundary, so every message is tagged and
 * every message is checked against its expected source before it is believed.
 */
export const TAG = '__ab';

interface Tagged {
  __ab: 1;
}

export type BridgeMessage = Tagged &
  (
    | { kind: 'announce'; area: number }
    | { kind: 'state'; time: number; paused: boolean; rate: number }
    | { kind: 'gone' }
    /** A control the room issued: snap to it. */
    | { kind: 'apply'; time: number; paused: boolean; rate?: number }
    /** Where the room is now: close the gap however is least visible. */
    | { kind: 'drift'; target: number; baseRate: number }
  );

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return typeof data === 'object' && data !== null && (data as Tagged).__ab === 1;
}

export function post(win: Window | null | undefined, msg: BridgeMessage): void {
  try {
    win?.postMessage(msg, '*');
  } catch {
    // the frame may have unloaded between the check and the call
  }
}
