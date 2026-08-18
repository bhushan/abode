import { INVITE_BASE_URL, parseInviteCode, parseInviteUrl } from '@/lib/room';

/**
 * The invite landing page, seen from inside the browser.
 *
 * The page itself is served by the relay and knows nothing about the extension.
 * This is the half that runs in the page: it marks the document so the page can
 * offer "join" instead of "install", and it turns the click into a background
 * message.
 *
 * The click matters. `chrome.sidePanel.open()` only works inside a live user
 * gesture, so the gesture has to be handed straight to the service worker
 * rather than being spent on a navigation first.
 */
export const INVITE_HOST = new URL(INVITE_BASE_URL).hostname;

export const isInvitePage = (loc: { hostname: string } = location): boolean => loc.hostname === INVITE_HOST;

export function runInviteBridge(): void {
  // Read by the landing page to swap its copy. Both spellings are set: `wb` is
  // what the deployed page still looks for, and dropping it would break joining
  // for anyone whose extension and page are not updated in the same minute.
  document.documentElement.dataset.abInstalled = '1';
  document.documentElement.dataset.wbInstalled = '1';

  document.addEventListener('click', (e) => {
    const el = e.target as Element | null;
    if (!el?.closest('#join-link')) return;

    const code = parseInviteCode(location.hash);
    const url = parseInviteUrl(location.hash);
    if (!code || !url) return; // not a valid invite; let the link behave normally

    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'WB_JOIN_INVITE', code, url }).catch(() => {
      location.href = url; // extension unreachable: at least get them to the video
    });
  });
}
