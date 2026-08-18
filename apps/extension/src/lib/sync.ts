/**
 * Drift correction.
 *
 * The inherited rule was one line: more than half a second out, write
 * currentTime. That is a visible scrub every time a network hiccups, and over a
 * two-hour film it is the thing that keeps reminding you that you are not
 * actually in the same room.
 *
 * So there are three bands instead of two. Below the floor, nothing: a gap that
 * small is not perceptible and correcting it only makes noise. Above the
 * ceiling, jump: no realistic speed change closes that in reasonable time.
 * Between them, play a fraction faster or slower until the gap closes, which
 * nobody notices and which is how broadcast gear has always done it.
 *
 * Pure on purpose. Everything here is arithmetic on numbers the caller supplies,
 * so it can be reasoned about and tested without a video element, a socket or a
 * clock.
 */

/** Beyond this many seconds, only a seek will do. */
export const HARD_SEEK = 1.5;
/** Below this many seconds, leave it alone. */
export const NUDGE_FLOOR = 0.15;
/** How far the playback rate bends to close the gap. */
export const NUDGE_STEP = 0.05;

/** The narrowest and widest rate a player (and the relay's validator) will take. */
const RATE_MIN = 0.25;
const RATE_MAX = 4;

/** Where the room was, when the relay stamped it. */
export interface RoomTimeline {
  time: number;
  paused: boolean;
  rate: number;
  /** Relay clock, in milliseconds. */
  at: number;
}

export type Correction =
  | { kind: 'hold' }
  | { kind: 'nudge'; rate: number }
  | { kind: 'seek'; time: number };

/**
 * Where the room is at `serverNow`, both measured on the relay's clock.
 *
 * Never runs backwards: a clock estimate can arrive stale, and a room that
 * appears to have gone backwards would be "corrected" by dragging everyone with
 * it.
 */
export function projectRoom(t: RoomTimeline, serverNow: number): number {
  if (t.paused) return t.time;
  const elapsed = Math.max(0, serverNow - t.at) / 1000;
  return t.time + elapsed * t.rate;
}

/** Round to the hundredth, so floating-point crumbs never read as a speed change. */
const tidy = (n: number) => Math.round(n * 100) / 100;

const clamp = (n: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, n));

export function planCorrection(local: number, target: number, baseRate: number): Correction {
  if (!Number.isFinite(local) || !Number.isFinite(target) || !Number.isFinite(baseRate)) {
    return { kind: 'hold' };
  }

  const delta = target - local;
  const gap = Math.abs(delta);

  if (gap > HARD_SEEK) return { kind: 'seek', time: target };
  if (gap <= NUDGE_FLOOR) return { kind: 'hold' };

  // Behind the room means play faster to catch up; ahead means ease off.
  return { kind: 'nudge', rate: clamp(tidy(baseRate + (delta > 0 ? NUDGE_STEP : -NUDGE_STEP))) };
}
