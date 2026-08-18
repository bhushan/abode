import { contentKey } from '@/lib/content';
import { getIdentity } from '@/lib/identity';
import type { TabMessage } from '@/lib/messages';
import { STORAGE_KEYS } from '@/lib/room';
import { getSeat } from '@/lib/seat';
import { getServerUrl } from '@/lib/server';
import { joinVideoChannel, type VideoChannel, type VideoContentInfo, type VideoControl } from '@/lib/socket';
import { adapterFor } from '../adapters/registry';
import { createDriftEngine } from '../sync/engine';
import { hidePanel, reparentPanel, showPanel } from '../panel-frame';
import { moveOverlay, removeOverlay } from '../ui/overlay';
import { spawnReaction } from '../ui/reactions';
import { isBridgeMessage } from '../video/bridge';
import { areaOf, MIN_AREA, pickVideo } from '../video/election';
import { LocalVideoTarget, RemoteVideoTarget, type VideoTarget } from '../video/target';

/**
 * The room, as the top frame sees it.
 *
 * One job per collaborator: the adapter knows the platform, the target knows
 * where the video lives, the engine knows where the room is, and this wires them
 * to a socket and to the browser. It is the only place allowed to know about all
 * of them at once, which is what keeps the others small.
 */
const WATCH_MS = 1_000;

export function runRoom(): void {
  const adapter = adapterFor(location);

  let channel: VideoChannel | null = null;
  let target: VideoTarget | null = null;
  let pending: VideoControl | null = null;
  let watchTimer: number | undefined;
  let navTimer: number | undefined;

  let isAnchor = false;
  let lastHref = location.href;
  let currentCode: string | null = null;

  const engine = createDriftEngine(
    () => target,
    () => channel?.serverNow() ?? Date.now(),
  );

  /** Only the focused tab drives; a hidden one banks the latest and catches up. */
  let visible = document.visibilityState === 'visible';

  // Child frames that have announced a player, keyed by their window.
  const announced = new Map<Window, number>();

  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    if (visible) flushPending();
  });

  document.addEventListener('fullscreenchange', () => {
    reparentPanel();
    moveOverlay();
  });

  chrome.runtime.onMessage.addListener((msg: TabMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.type === 'OPEN_PANEL') {
      sendResponse(showPanel());
      return;
    }
    if (msg.type === 'START_ROOM' || msg.type === 'JOIN_ROOM') void start(msg.code, msg.anchor);
    if (msg.type === 'LEAVE_ROOM') stop();
    if (msg.type === 'SET_RATE') target?.setRate(msg.rate);
  });

  window.addEventListener('message', (e) => {
    const d: unknown = e.data;
    if (!isBridgeMessage(d)) return;
    const src = e.source as Window | null;
    if (!src) return;

    if (d.kind === 'announce') {
      announced.set(src, d.area);
      chooseTarget();
    } else if (d.kind === 'state') {
      if (target instanceof RemoteVideoTarget && target.win === src) {
        target.pushState({ time: d.time, paused: d.paused, rate: d.rate });
      }
    } else if (d.kind === 'gone') {
      announced.delete(src);
      if (target instanceof RemoteVideoTarget && target.win === src) {
        target.teardown();
        target = null;
      }
      chooseTarget();
    }
  });

  // A panel hosted in this page went with the last document, and the room's socket
  // lives in it, so ask now that there is a listener to answer with.
  void chrome.runtime.sendMessage({ type: 'WB_RESTORE_PANEL' }).catch(() => undefined);

  armFromStorage();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (STORAGE_KEYS.inRoom in changes || STORAGE_KEYS.roomCode in changes)) {
      armFromStorage();
    }
  });

  function armFromStorage(): void {
    chrome.storage.local.get([STORAGE_KEYS.inRoom, STORAGE_KEYS.roomCode], (d) => {
      const code = d[STORAGE_KEYS.roomCode];
      if (d[STORAGE_KEYS.inRoom] && typeof code === 'string') {
        // Switching rooms: tear the old socket down, since start() will not
        // reconnect over a live one.
        if (channel && currentCode && currentCode !== code) stop();
        void start(code, false);
      } else {
        stop();
      }
    });
  }

  const currentContent = (): VideoContentInfo => ({
    key: contentKey(location.href),
    url: location.href,
    title: document.title || location.hostname,
  });

  async function start(code: string, anchor: boolean): Promise<void> {
    currentCode = code;
    if (anchor) isAnchor = true; // an explicit message wins over the storage-arm path

    if (!channel) {
      const [url, { name }, seat] = await Promise.all([getServerUrl(), getIdentity(), getSeat()]);
      // Re-checked after the awaits: two arms can race through here.
      if (!channel) {
        channel = joinVideoChannel(url, code, {
          anchor: isAnchor,
          content: currentContent(),
          name,
          seat,
          onControl: applyControl,
          onReaction: (p) => spawnReaction(p.emoji),
        });
      }
    } else if (anchor) {
      channel.claimAnchor(currentContent());
    }

    chooseTarget();
    startWatching();
    engine.start();
  }

  function stop(): void {
    channel?.disconnect();
    channel = null;
    target?.teardown();
    target = null;
    pending = null;
    announced.clear();
    isAnchor = false;
    currentCode = null;

    engine.stop();
    engine.forget();
    stopWatching();
    removeOverlay();
    hidePanel();
  }

  /** Largest player above the floor wins, whichever frame it is in. */
  function chooseTarget(): void {
    const local = pickVideo();
    const localArea = local ? areaOf(local) : 0;

    let bestWin: Window | null = null;
    let bestArea = 0;
    for (const [win, area] of announced) {
      if (area >= MIN_AREA && area > bestArea) {
        bestWin = win;
        bestArea = area;
      }
    }

    const useLocal = local ? (localArea >= MIN_AREA && localArea >= bestArea) || !bestWin : false;

    if (useLocal && local) {
      if (target instanceof LocalVideoTarget && target.video === local) return;
      setTarget(new LocalVideoTarget(local, adapter.attach(local, { location })));
    } else if (bestWin) {
      if (target instanceof RemoteVideoTarget && target.win === bestWin) {
        target.setArea(bestArea);
        return;
      }
      setTarget(new RemoteVideoTarget(bestWin, bestArea));
    }
  }

  function setTarget(next: VideoTarget): void {
    target?.teardown();
    target = next;
    target.onLocalChange(onLocalChange);
    flushPending();
  }

  function startWatching(): void {
    // A top-frame player can load late; child players announce themselves.
    watchTimer ??= window.setInterval(chooseTarget, WATCH_MS);
    navTimer ??= window.setInterval(onUrlMaybeChanged, WATCH_MS);
    window.addEventListener('popstate', onUrlMaybeChanged);
    lastHref = location.href;
  }

  function stopWatching(): void {
    window.clearInterval(watchTimer);
    window.clearInterval(navTimer);
    watchTimer = undefined;
    navTimer = undefined;
    window.removeEventListener('popstate', onUrlMaybeChanged);
  }

  function onLocalChange(): void {
    if (!channel || !target || !visible) return; // only the focused tab broadcasts
    const state = target.getState();
    if (!state) return;
    channel.send(state);
    // The relay does not echo our own control back, so the room's timeline has
    // to be updated here or the next drift tick would correct us towards where
    // we were before we acted.
    engine.observe({ ...state, rate: state.rate ?? 1, at: channel.serverNow() });
  }

  function applyControl(c: VideoControl): void {
    engine.observe({
      time: c.time,
      paused: c.paused,
      rate: c.rate ?? 1,
      at: c.at ?? channel?.serverNow() ?? Date.now(),
    });

    if (!visible || !target) {
      pending = c; // hidden, or no player yet: bank the latest and do not touch it
      return;
    }
    target.apply(c);
  }

  function flushPending(): void {
    if (!visible || !target || !pending) return;
    const c = pending;
    pending = null;
    target.apply(c);
  }

  /** Catches SPA navigation, where the page swaps the video without a page load. */
  function onUrlMaybeChanged(): void {
    if (location.href === lastHref) return;
    lastHref = location.href;
    target?.teardown();
    target = null;
    announced.clear();
    chooseTarget();
    channel?.setContent(currentContent());
  }
}
