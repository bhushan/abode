import type { VideoControl } from '@/lib/socket';
import type { AttachedPlayer } from '../adapters/contract';
import { createCorrector, type CorrectablePlayer, type Corrector } from '../sync/corrector';
import { createEchoGuard, type EchoGuard } from '../sync/echo-guard';
import type { DriftSink } from '../sync/engine';
import { areaOf } from './election';
import { post, type BridgeMessage } from './bridge';

/** A control means somebody acted, so anything past this is worth snapping to. */
export const SEEK_THRESHOLD = 0.5;

/**
 * The player this tab is driving, wherever it happens to live.
 *
 * Two implementations: one for a player in this frame, one for a player in a
 * child frame on another origin. The room logic never learns which it has.
 */
export interface VideoTarget extends DriftSink {
  getState(): VideoControl | null;
  /** Snap to a control the room issued. */
  apply(c: VideoControl): void;
  /** A deliberate speed change by the person watching, which the room should hear. */
  setRate(rate: number): void;
  onLocalChange(cb: () => void): void;
  area(): number;
  teardown(): void;
}

/** What a control would actually change about a player. Empty means leave it alone. */
export function pendingWrites(player: CorrectablePlayer & { paused(): boolean }, c: VideoControl) {
  return {
    seek: Math.abs(player.currentTime() - c.time) > SEEK_THRESHOLD,
    rate: typeof c.rate === 'number' && player.rate() !== c.rate,
    playback: c.paused !== player.paused(),
  };
}

export const changesAnything = (w: { seek: boolean; rate: boolean; playback: boolean }): boolean =>
  w.seek || w.rate || w.playback;

/**
 * Snap a player onto a control, and only touch what actually differs.
 *
 * The caller must skip this entirely when nothing differs. Arming the echo
 * guard around a no-op is what swallows somebody's next real click: a resync
 * arrives, changes nothing, and for the next fraction of a second the player is
 * deaf to the person sitting in front of it.
 */
export function applyControl(player: AttachedPlayer, c: VideoControl): void {
  const writes = pendingWrites(player, c);
  if (writes.seek) player.seek(c.time);
  if (writes.rate && typeof c.rate === 'number') player.setRate(c.rate);
  if (writes.playback) {
    if (c.paused) player.pause();
    else player.play();
  }
}

/**
 * Apply a control, arming the echo guard only if there is something to arm it
 * around.
 */
export function applyGuarded(
  player: AttachedPlayer,
  c: VideoControl,
  guard: EchoGuard,
  corrector: Corrector,
): void {
  if (!changesAnything(pendingWrites(player, c))) return;
  guard.suppress(() => {
    corrector.release();
    applyControl(player, c);
  });
}

export class LocalVideoTarget implements VideoTarget {
  private readonly guard = createEchoGuard();
  private readonly corrector: Corrector;
  private cb: (() => void) | null = null;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly player: AttachedPlayer,
  ) {
    this.corrector = createCorrector(player, this.guard);
    player.onChange(() => {
      if (!this.guard.active()) this.cb?.();
    });
  }

  getState(): VideoControl {
    return {
      time: this.player.currentTime(),
      paused: this.player.paused(),
      // Never the nudged rate: a correction must not become the room's speed.
      rate: this.corrector.reportedRate(this.player.rate()),
    };
  }

  apply(c: VideoControl): void {
    applyGuarded(this.player, c, this.guard, this.corrector);
  }

  correct(target: number, baseRate: number): void {
    this.corrector.correct(target, baseRate);
  }

  // Not guarded: this one *is* the person watching, and the room should hear it.
  setRate(rate: number): void {
    this.player.setRate(rate);
  }

  onLocalChange(cb: () => void): void {
    this.cb = cb;
  }

  area(): number {
    return areaOf(this.video);
  }

  teardown(): void {
    this.cb = null;
    this.corrector.release();
    this.player.detach();
  }
}

/**
 * A player in a child frame.
 *
 * Everything crosses by postMessage, including the drift correction: the top
 * frame knows where the room is, the child frame knows what its own player is
 * doing to the millisecond, and only the child can act on it. Sending the whole
 * state up and the whole decision down would be a round trip per second through
 * a channel that is already the slowest part of this path.
 */
export class RemoteVideoTarget implements VideoTarget {
  private last: VideoControl | null = null;
  private cb: (() => void) | null = null;

  constructor(
    readonly win: Window,
    private frameArea: number,
  ) {}

  pushState(c: VideoControl): void {
    this.last = c;
    this.cb?.();
  }

  setArea(a: number): void {
    this.frameArea = a;
  }

  getState(): VideoControl | null {
    return this.last;
  }

  apply(c: VideoControl): void {
    this.send({ __ab: 1, kind: 'apply', time: c.time, paused: c.paused, rate: c.rate });
  }

  correct(target: number, baseRate: number): void {
    this.send({ __ab: 1, kind: 'drift', target, baseRate });
  }

  setRate(rate: number): void {
    if (!this.last) return;
    // Broadcast from here, then push it down, so the room hears the change even
    // though the player that will make it is a frame away.
    this.last = { ...this.last, rate };
    this.cb?.();
    this.apply(this.last);
  }

  onLocalChange(cb: () => void): void {
    this.cb = cb;
  }

  area(): number {
    return this.frameArea;
  }

  teardown(): void {
    this.cb = null;
  }

  private send(m: BridgeMessage): void {
    post(this.win, m);
  }
}
