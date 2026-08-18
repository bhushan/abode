import { isInvitePage, runInviteBridge } from './room/invite';
import { runRoom } from './room/session';
import { runFrameRole } from './video/frame-role';

/**
 * The content script's composition root: which role this document plays.
 *
 * The script runs in every frame of every page. The top frame owns the socket,
 * the room and the overlay. A child frame owns nothing but its own `<video>`.
 * The invite landing page is neither, and syncing there would be nonsense.
 */
declare global {
  interface Window {
    __abLoaded?: boolean;
  }
}

if (!window.__abLoaded) {
  window.__abLoaded = true;

  if (window.top !== window) runFrameRole();
  else if (isInvitePage()) runInviteBridge();
  else runRoom();
}

export {};
