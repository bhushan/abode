import { adapterFor } from '../adapters/registry';
import { createCorrector } from '../sync/corrector';
import { createEchoGuard } from '../sync/echo-guard';
import { isBridgeMessage, post, type BridgeMessage } from './bridge';
import { areaOf, MIN_AREA, pickVideo } from './election';
import { applyGuarded } from './target';
import { STORAGE_KEYS } from '@/lib/room';
import type { TabMessage } from '@/lib/messages';

/**
 * What this content script does when it is not the top frame.
 *
 * It owns one thing: the `<video>` in its own document. It announces it, reports
 * what it is doing, and applies what the top frame asks for. It has no socket,
 * no room, and no idea what is being watched.
 *
 * It resolves its own adapter from its own location, which is what makes an
 * embedded player on a platform origin (Crunchyroll's Vilos frame lives on
 * static.crunchyroll.com) get that platform's seek behaviour rather than the
 * generic one.
 */
const TICK_MS = 1_000;
/** Only re-announce when the player's size really moved, not on a scrollbar. */
const AREA_NOISE = 1_000;

export function runFrameRole(): void {
  const adapter = adapterFor(location);
  const guard = createEchoGuard();

  let video: HTMLVideoElement | null = null;
  let player: ReturnType<typeof adapter.attach> | null = null;
  let corrector: ReturnType<typeof createCorrector> | null = null;
  let armed = false;
  let announcedArea = 0;
  let timer: number | undefined;

  const up = (m: BridgeMessage) => post(window.top, m);

  const report = () => {
    if (!player || !corrector) return;
    up({
      __ab: 1,
      kind: 'state',
      time: player.currentTime(),
      paused: player.paused(),
      rate: corrector.reportedRate(player.rate()),
    });
  };

  function announce(): void {
    if (!video) return;
    announcedArea = areaOf(video);
    up({ __ab: 1, kind: 'announce', area: announcedArea });
  }

  function attach(): void {
    const found = pickVideo();
    if (!found || areaOf(found) < MIN_AREA) return;
    video = found;
    player = adapter.attach(found, { location });
    corrector = createCorrector(player, guard);
    player.onChange(() => {
      if (!guard.active()) report();
    });
    announce();
  }

  function detach(notify: boolean): void {
    corrector?.release();
    player?.detach();
    if (video && notify) up({ __ab: 1, kind: 'gone' });
    video = null;
    player = null;
    corrector = null;
    announcedArea = 0;
  }

  function tick(): void {
    if (!armed) return;
    if (!video) return attach();
    if (!document.contains(video)) return detach(true);
    if (Math.abs(areaOf(video) - announcedArea) > AREA_NOISE) announce();
  }

  window.addEventListener('message', (e) => {
    const d: unknown = e.data;
    if (!isBridgeMessage(d)) return;
    // Only the top frame gets to drive this player. Any other window saying the
    // same words is a page trying to steer somebody else's film.
    if (e.source !== window.top) return;
    if (!player || !corrector) return;

    if (d.kind === 'apply') {
      applyGuarded(player, { time: d.time, paused: d.paused, rate: d.rate }, guard, corrector);
    } else if (d.kind === 'drift') {
      corrector.correct(d.target, d.baseRate);
    }
  });

  function arm(): void {
    if (armed) return;
    armed = true;
    attach();
    timer ??= window.setInterval(tick, TICK_MS);
  }

  function disarm(): void {
    armed = false;
    detach(true);
    window.clearInterval(timer);
    timer = undefined;
  }

  function armFromStorage(): void {
    chrome.storage.local.get([STORAGE_KEYS.inRoom, STORAGE_KEYS.roomCode], (d) => {
      if (d[STORAGE_KEYS.inRoom] && typeof d[STORAGE_KEYS.roomCode] === 'string') arm();
      else disarm();
    });
  }

  chrome.runtime.onMessage.addListener((msg: TabMessage, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg.type === 'START_ROOM' || msg.type === 'JOIN_ROOM') arm();
    if (msg.type === 'LEAVE_ROOM') disarm();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (STORAGE_KEYS.inRoom in changes || STORAGE_KEYS.roomCode in changes)) {
      armFromStorage();
    }
  });

  armFromStorage();
}
