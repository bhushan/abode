import { describe, expect, it, vi } from 'vitest';
import { NUDGE_STEP } from '@/lib/sync';
import { createEchoGuard } from './echo-guard';
import { createCorrector, type CorrectablePlayer } from './corrector';

function player(over: Partial<{ time: number; paused: boolean; rate: number }> = {}) {
  const state = { time: 100, paused: false, rate: 1, ...over };
  const seeks: number[] = [];
  const rates: number[] = [];
  const api: CorrectablePlayer = {
    currentTime: () => state.time,
    paused: () => state.paused,
    rate: () => state.rate,
    seek: (t) => {
      seeks.push(t);
      state.time = t;
    },
    setRate: (r) => {
      rates.push(r);
      state.rate = r;
    },
  };
  return { api, state, seeks, rates };
}

/**
 * Applying the correction, wherever the video happens to live.
 *
 * The same logic runs in the top frame for a same-page player and inside a
 * child frame for an embedded one, so it lives here rather than in either.
 */
describe('corrector', () => {
  it('leaves an aligned player alone', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.correct(100.05, 1)).toBe('hold');
    expect(p.seeks).toEqual([]);
    expect(p.rates).toEqual([]);
  });

  it('closes a small gap by bending the rate, not by scrubbing', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.correct(100.6, 1)).toBe('nudge');
    expect(p.seeks).toEqual([]);
    expect(p.rates).toEqual([1 + NUDGE_STEP]);
  });

  it('does not keep re-setting a rate it already set', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1);
    c.correct(100.6, 1);
    c.correct(100.6, 1);
    expect(p.rates).toEqual([1 + NUDGE_STEP]);
  });

  it('puts the rate back once the gap has closed', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1);
    p.state.time = 100.6;
    expect(c.correct(100.62, 1)).toBe('hold');
    expect(p.state.rate).toBe(1);
  });

  it('jumps when the gap is past what a rate change can close', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.correct(140, 1)).toBe('seek');
    expect(p.seeks).toEqual([140]);
  });

  it('returns to the room speed when it jumps, not to whatever it was nudged to', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1); // nudged to 1.05
    p.state.time = 20; // somebody skipped back
    c.correct(140, 1);
    expect(p.state.rate).toBe(1);
  });

  /**
   * The nudge must never become the room's speed. A player set to 1.05 reports
   * 1.05, and if that number reached the relay everybody would speed up, then
   * correct against each other, and the room would run away from the film.
   */
  it('never lets a correction be mistaken for the room speed', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1);
    expect(p.state.rate).toBe(1.05);
    expect(c.reportedRate(p.state.rate)).toBe(1);
  });

  it('reports the real speed once no correction is running', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.reportedRate(1.5)).toBe(1.5);
  });

  it('nudges around a room that chose a different speed', () => {
    const p = player({ rate: 1.5 });
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1.5);
    expect(p.state.rate).toBe(1.5 + NUDGE_STEP);
    expect(c.reportedRate(p.state.rate)).toBe(1.5);
  });

  it('never bends the rate of a paused player, which would do nothing', () => {
    const p = player({ paused: true });
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.correct(100.6, 1)).toBe('hold');
    expect(p.rates).toEqual([]);
    expect(p.seeks).toEqual([]);
  });

  // A paused player is not drifting, but it can still be in the wrong place:
  // somebody scrubs a paused film, or their own action is swallowed by the echo
  // guard. Without this they sit there off the room with nothing to fix it.
  it('still moves a paused player that is in the wrong place', () => {
    const p = player({ paused: true });
    const c = createCorrector(p.api, createEchoGuard());
    expect(c.correct(140, 1)).toBe('seek');
    expect(p.seeks).toEqual([140]);
  });

  it('lets go of a nudge when the player is paused mid-correction', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    c.correct(100.6, 1);
    p.state.paused = true;
    c.correct(100.6, 1);
    expect(p.state.rate).toBe(1);
  });

  /** Every write here is ours, so none of it may look like the person watching acting. */
  it('makes its changes behind the echo guard', () => {
    const p = player();
    const guard = createEchoGuard();
    const c = createCorrector(p.api, guard);

    const seen: boolean[] = [];
    const original = p.api.seek;
    p.api.seek = (t) => {
      seen.push(guard.active());
      original(t);
    };

    c.correct(140, 1);
    expect(seen).toEqual([true]);
  });

  it('release is safe to call when nothing is running', () => {
    const p = player();
    const c = createCorrector(p.api, createEchoGuard());
    expect(() => c.release()).not.toThrow();
    expect(p.rates).toEqual([]);
  });
});

describe('echo guard', () => {
  it('is quiet until something is suppressed', () => {
    expect(createEchoGuard().active()).toBe(false);
  });

  it('covers the change and a moment after it, since events land late', () => {
    vi.useFakeTimers();
    const guard = createEchoGuard(400);
    guard.suppress(() => undefined);
    expect(guard.active()).toBe(true);
    vi.advanceTimersByTime(399);
    expect(guard.active()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(guard.active()).toBe(false);
    vi.useRealTimers();
  });

  it('extends rather than stacking, so a burst of changes is covered to the end', () => {
    vi.useFakeTimers();
    const guard = createEchoGuard(400);
    guard.suppress(() => undefined);
    vi.advanceTimersByTime(300);
    guard.suppress(() => undefined);
    vi.advanceTimersByTime(300);
    expect(guard.active()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(guard.active()).toBe(false);
    vi.useRealTimers();
  });

  it('lifts even when the change it wrapped threw', () => {
    vi.useFakeTimers();
    const guard = createEchoGuard(400);
    expect(() =>
      guard.suppress(() => {
        throw new Error('player said no');
      }),
    ).toThrow();
    vi.advanceTimersByTime(500);
    expect(guard.active()).toBe(false);
    vi.useRealTimers();
  });
});
