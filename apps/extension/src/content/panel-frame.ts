/**
 * The room panel, hosted inside the page.
 *
 * Arc ships without `chrome.sidePanel` and has said it will not add it, so on those
 * browsers there is no native surface to put chat in. An extension iframe is the
 * cheapest honest answer: it is an extension document, so it keeps full `chrome.*`
 * access and the relay socket behaves exactly as it does in a real side panel.
 * `SidePanel.tsx` does not know the difference.
 *
 * It lives in a shadow root so the host site's stylesheet cannot reach it, and so
 * ours cannot leak the other way.
 */

export const PANEL_HOST_ID = 'ab-panel-host';
const PANEL_PATH = 'src/sidepanel/index.html';
const WIDTH = 380;

const supportsPopover = (el: HTMLElement): boolean => typeof el.showPopover === 'function';

function build(): HTMLElement {
  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;

  // The top layer is the only way to paint over a fullscreen video without moving
  // in the DOM, and moving is not an option: re-appending an iframe reloads it,
  // which would drop the room's socket and wipe the chat on every fullscreen
  // toggle. `manual` so nothing but us closes it.
  if (supportsPopover(host)) host.popover = 'manual';

  host.style.cssText = [
    'position:fixed',
    'top:0',
    'right:0',
    'left:auto',
    'bottom:auto',
    'width:' + WIDTH + 'px',
    'height:100%',
    'max-width:100vw',
    'z-index:2147483647',
    // popover UA styles add a border, padding and an opaque background
    'margin:0',
    'border:0',
    'padding:0',
    'background:transparent',
    'overflow:visible',
    'color-scheme:dark',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'open' });

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL(PANEL_PATH);
  frame.title = 'Abode';
  frame.style.cssText = [
    'width:100%',
    'height:100%',
    'border:0',
    'display:block',
    'box-shadow:-1px 0 0 rgba(245,241,233,.12), -18px 0 44px rgba(0,0,0,.4)',
  ].join(';');

  // The native side panel gets a close control from the browser; in the page we
  // have to supply one or there is no way out.
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close Abode');
  close.style.cssText = [
    'position:absolute',
    'top:9px',
    'left:-13px',
    'width:26px',
    'height:26px',
    'border-radius:999px',
    'border:1px solid rgba(245,241,233,.16)',
    'background:#221d29',
    'color:#a29aac',
    'font:600 15px/1 system-ui,sans-serif',
    'cursor:pointer',
    'padding:0',
  ].join(';');
  // The browser closes a native panel and the dropped port says so. Nothing
  // watches this one, and its port drops on every navigation too, so a close has
  // to be stated rather than inferred.
  close.addEventListener('click', () => {
    hidePanel();
    void chrome.runtime.sendMessage({ type: 'WB_LEAVE_ROOM' }).catch(() => undefined);
  });

  shadow.append(frame, close);
  return host;
}

/**
 * Where a panel has to live when the top layer is unavailable: in fullscreen only
 * that subtree paints. Mirrors what the reaction layer already does.
 */
export function panelHost(): Element {
  const fs = document.fullscreenElement;
  if (!fs) return document.documentElement;
  return fs.tagName === 'VIDEO' ? (fs.parentElement ?? document.documentElement) : fs;
}

/** Mounts the panel if it is not already up. Returns true once it is showing. */
export function showPanel(): boolean {
  const existing = document.getElementById(PANEL_HOST_ID);
  const host = existing ?? build();

  if (supportsPopover(host)) {
    if (!host.isConnected) document.documentElement.appendChild(host);
    try {
      host.showPopover();
      return true;
    } catch {
      // already showing, or the element was rejected; fall through to plain DOM
    }
    if (host.isConnected) return true;
  }

  const parent = panelHost();
  if (host.parentElement !== parent) parent.appendChild(host);
  return true;
}

export function hidePanel(): void {
  document.getElementById(PANEL_HOST_ID)?.remove();
}

export function panelShowing(): boolean {
  return document.getElementById(PANEL_HOST_ID) !== null;
}

/**
 * Keeps the panel painted when fullscreen changes.
 *
 * The fullscreen element joins the top layer too, and the top layer stacks in the
 * order things entered it, so a panel shown earlier would end up underneath.
 * Re-showing lifts it back to the front without touching the DOM, which is what
 * keeps the iframe (and the socket inside it) alive.
 */
export function reparentPanel(): void {
  const host = document.getElementById(PANEL_HOST_ID);
  if (!host) return;

  if (supportsPopover(host)) {
    try {
      host.hidePopover();
      host.showPopover();
      return;
    } catch {
      // fall through to moving it, reload and all: being visible beats being correct
    }
  }

  const parent = panelHost();
  if (host.parentElement !== parent) parent.appendChild(host);
}
