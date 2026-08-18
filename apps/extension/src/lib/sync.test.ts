import { describe, expect, it } from 'vitest';
import { HARD_SEEK, NUDGE_FLOOR, NUDGE_STEP, planCorrection, projectRoom, type RoomTimeline } from './sync';

const room = (over: Partial<RoomTimeline> = {}): RoomTimeline => ({
  time: 100,
  paused: false,
  rate: 1,
  at: 10_000,
  ...over,
});

/**
 * Where the room is, right now.
 *
 * A control frame says where the room was when the relay stamped it. Everything
 * after that is arithmetic, and it has to be done against the relay's clock,
 * not this machine's, or the answer is wrong by however far the two disagree.
 */
describe('projectRoom', () => {
  it('advances a playing room by the time since the relay stamped it', () => {
    expect(projectRoom(room(), 13_000)).toBe(103);
  });

  it('advances by wall time times rate, so half speed covers half the ground', () => {
    expect(projectRoom(room({ rate: 0.5 }), 14_000)).toBe(102);
    expect(projectRoom(room({ rate: 2 }), 14_000)).toBe(108);
  });

  it('leaves a paused room exactly where it was left', () => {
    expect(projectRoom(room({ paused: true }), 999_000)).toBe(100);
  });

  it('does not run backwards when a clock estimate arrives stale', () => {
    expect(projectRoom(room(), 9_000)).toBe(100);
  });
});

/**
 * What to do about the gap.
 *
 * The inherited behaviour was one blunt rule: more than half a second out, jump.
 * That is a visible scrub every time a network hiccups, which in a two-hour film
 * is the difference between watching together and being reminded all evening
 * that you are not in the same room.
 */
describe('planCorrection', () => {
  it('does nothing about a gap nobody can perceive', () => {
    expect(planCorrection(100, 100.1, 1)).toEqual({ kind: 'hold' });
    expect(planCorrection(100, 99.9, 1)).toEqual({ kind: 'hold' });
  });

  it('jumps only when the gap is too big to close by playing faster', () => {
    expect(planCorrection(100, 104, 1)).toEqual({ kind: 'seek', time: 104 });
    expect(planCorrection(100, 96, 1)).toEqual({ kind: 'seek', time: 96 });
  });

  it('closes a small gap by playing a touch faster, which nobody sees', () => {
    const behind = planCorrection(100, 100.6, 1);
    expect(behind).toEqual({ kind: 'nudge', rate: 1 + NUDGE_STEP });
  });

  it('and a touch slower when it is ahead', () => {
    expect(planCorrection(100, 99.4, 1)).toEqual({ kind: 'nudge', rate: 1 - NUDGE_STEP });
  });

  it('nudges around whatever speed the room chose, not around 1', () => {
    expect(planCorrection(100, 100.6, 1.5)).toEqual({ kind: 'nudge', rate: 1.5 + NUDGE_STEP });
    expect(planCorrection(100, 99.4, 0.75)).toEqual({ kind: 'nudge', rate: 0.75 - NUDGE_STEP });
  });

  it('puts each band on the right side of its boundary', () => {
    // exact float equality at a boundary is not a property worth asserting, so
    // these sit a hair either side of it
    expect(planCorrection(100, 100 + NUDGE_FLOOR - 0.01, 1).kind).toBe('hold');
    expect(planCorrection(100, 100 + NUDGE_FLOOR + 0.01, 1).kind).toBe('nudge');
    expect(planCorrection(100, 100 + HARD_SEEK - 0.01, 1).kind).toBe('nudge');
    expect(planCorrection(100, 100 + HARD_SEEK + 0.01, 1).kind).toBe('seek');
  });

  it('keeps the nudged rate inside what a player will accept', () => {
    // the relay validates 0.25..4, and a player asked for less simply refuses
    expect(planCorrection(100, 99, 0.25)).toEqual({ kind: 'nudge', rate: 0.25 });
    expect(planCorrection(100, 101, 4)).toEqual({ kind: 'nudge', rate: 4 });
  });

  it('refuses to act on a number that is not one', () => {
    expect(planCorrection(NaN, 100, 1)).toEqual({ kind: 'hold' });
    expect(planCorrection(100, Infinity, 1)).toEqual({ kind: 'hold' });
  });

  it('does not accumulate rounding noise into the rate', () => {
    // 1.1 + 0.05 in floating point is 1.1500000000000001, and a player that is
    // handed that reports it back, which reads as a speed change to the room
    expect(planCorrection(100, 100.6, 1.1)).toEqual({ kind: 'nudge', rate: 1.15 });
  });
});
