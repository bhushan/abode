import { STORAGE_KEYS, isValidCode } from '@/lib/room';
import { ensurePanel, expectPanelIn, panelDropEndsRoom, restorePanel, tryNativePanel } from '@/lib/panel';
import { PANEL_PORT_NAME } from '@/lib/panelPort';
import { createPanelRegistry } from './panel-registry';
import { chromeSiteAccess, syncSiteAccess } from './site-access';
import type { PopupMessage, ContentMessage } from '@/lib/messages';

function clearRoomState() {
  void chrome.storage.local.set({
    [STORAGE_KEYS.inRoom]: false,
    [STORAGE_KEYS.roomCode]: '',
    [STORAGE_KEYS.anchorTabId]: null,
    [STORAGE_KEYS.panelTabId]: null,
  });
}

// An invite link is the only credential there is, so following one joins straight
// away: no account, no gate, nothing between the link and the room.
function joinInvite(tabId: number, code: string, url: string | null): void {
  chrome.storage.local.set(
    { [STORAGE_KEYS.inRoom]: true, [STORAGE_KEYS.roomCode]: code, [STORAGE_KEYS.anchorTabId]: null },
    () => {
      if (url) chrome.tabs.update(tabId, { url }).catch(() => {});
    },
  );
}

chrome.runtime.onMessage.addListener((msg: PopupMessage | ContentMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'ROOM_STATE') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    if (msg.inRoom && msg.memberCount > 1) {
      void chrome.action.setBadgeText({ text: String(msg.memberCount), tabId });
      void chrome.action.setBadgeBackgroundColor({ color: '#d89a6a', tabId });
    } else {
      void chrome.action.setBadgeText({ text: '', tabId });
    }
    return;
  }

  // A page came back from a navigation and wants to know if it was hosting the
  // panel. Only the worker knows which tab that was, and only it knows the tab id
  // of whoever is asking.
  if (msg.type === 'WB_RESTORE_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId != null) void restorePanel(tabId);
    return;
  }

  // The popup asked for a panel and then closed itself, taking every unfinished
  // promise with it. Finishing the job here is the only place it can be finished.
  if (msg.type === 'WB_ENSURE_PANEL') {
    void ensurePanel(msg.tabId);
    return;
  }

  if (msg.type === 'WB_START_ROOM' || msg.type === 'WB_JOIN_ROOM') {
    const { code, tabId } = msg;
    // the anchor tab's video is what the room watches; anchorTabId keeps that mark across reloads
    const isAnchor = msg.type === 'WB_START_ROOM';
    const contentType = isAnchor ? 'START_ROOM' : 'JOIN_ROOM';
    // The panel is opened by whoever handled the click, not from here: by the time
    // a message reaches the worker the user activation sidePanel.open() needs is
    // already spent, so opening it here failed silently.
    void chrome.storage.local.set({
      [STORAGE_KEYS.inRoom]: true,
      [STORAGE_KEYS.roomCode]: code,
      [STORAGE_KEYS.anchorTabId]: isAnchor ? tabId : null,
    });
    chrome.tabs.sendMessage(tabId, { type: contentType, code, anchor: isAnchor }).catch(() => {});
    return;
  }

  // one-click join from the landing page: require login, then open the panel,
  // write room state, and navigate the tab
  if (msg.type === 'WB_JOIN_INVITE') {
    const tabId = sender.tab?.id;
    if (!tabId || !isValidCode(msg.code)) return;
    let url: string | null = null;
    try {
      const u = new URL(msg.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') url = u.href;
    } catch {
      url = null;
    }
    // Native attempt first, while the click's user gesture is still valid: the
    // click happened in the page and was forwarded straight here, so the
    // activation is still live, and any await in front of it would spend it.
    tryNativePanel(tabId);
    // The rest waits for the video. This tab is about to be navigated away from a
    // landing page that runs the invite bridge and can host nothing, so ensuring a
    // panel against it raced the navigation; the page that lands claims it.
    void expectPanelIn(tabId);
    joinInvite(tabId, msg.code, url);
    return;
  }

  if (msg.type === 'WB_LEAVE_ROOM') {
    clearRoomState();
    if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, { type: 'LEAVE_ROOM' }).catch(() => {});
    return;
  }
});

// closing the panel drops this port; treat it as leaving the room, but only once
// the panel is really gone rather than mid-reopen
const panels = createPanelRegistry(() => {
  void panelDropEndsRoom().then((ends) => {
    if (ends) clearRoomState();
  });
});

// The in-page panel has no browser chrome to close it, so the room ends by an
// explicit close or with the tab that was holding it.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(STORAGE_KEYS.panelTabId, (d) => {
    if (d[STORAGE_KEYS.panelTabId] === tabId) clearRoomState();
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;
  panels.connect();
  port.onDisconnect.addListener(() => panels.disconnect());
});

// re-arm the anchor after it navigates, so the fresh content script knows it's still the anchor
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  chrome.storage.local.get([STORAGE_KEYS.inRoom, STORAGE_KEYS.roomCode, STORAGE_KEYS.anchorTabId], (d) => {
    const code = d[STORAGE_KEYS.roomCode];
    if (!d[STORAGE_KEYS.inRoom] || typeof code !== 'string' || d[STORAGE_KEYS.anchorTabId] !== tabId) return;
    chrome.tabs.sendMessage(tabId, { type: 'START_ROOM', code, anchor: true }).catch(() => {});
  });
});

// No onboarding tab on install. An identity is assigned the first time it is
// read, and the popup lets you change it, so there is nothing to walk anyone
// through before they can join a room.

/**
 * Sites outside the declared platform list run through an optional grant, so the
 * registration has to be brought in line with the permission at every point the
 * two could have diverged: a fresh install, a browser restart, and the moment
 * somebody grants or revokes it in Chrome's own settings.
 *
 * The worker is evicted constantly and remembers nothing, which is why this is
 * idempotent rather than event-sourced.
 */
const reconcileSiteAccess = () => void syncSiteAccess(chromeSiteAccess()).catch(() => undefined);

chrome.runtime.onInstalled.addListener(reconcileSiteAccess);
chrome.runtime.onStartup.addListener(reconcileSiteAccess);
chrome.permissions.onAdded.addListener(reconcileSiteAccess);
chrome.permissions.onRemoved.addListener(reconcileSiteAccess);
reconcileSiteAccess();
