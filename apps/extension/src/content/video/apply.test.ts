import { describe, expect, it, vi } from 'vitest';
import type { VideoControl } from '@/lib/socket';
import type { AttachedPlayer } from '../adapters/contract';
import { createCorrector } from '../sync/corrector';
import { createEchoGuard } from '../sync/echo-guard';
import { applyGuarded, changesAnything, pendingWrites, SEEK_THRESHOLD } from './target';

function player(over: Partial<{ time: number; paused: boolean; rate: number }> = {}) {
  const state = { time: 100, paused: true, rate: 1, ...over };
  const calls: string[] = [];
  const api = {
    currentTime: () => state.time,
    paused: () => state.paused,
    rate: () => state.rate,
    seek: (t: number) => {
      calls.push(`seek:${t}`);
      state.time = t;
    },
    setRate: (r: number) => {
      calls.push(`rate:${r}`);
      state.rate = r;
    },
    play: () => {
      calls.push('play');
      state.paused = false;
    },
    pause: () => {
      calls.push('pause');
      state.paused = true;
    },
    contentId: () => 'x',
    onChange: () => undefined,
    detach: () => undefined,
  };
  return { api: api as unknown as AttachedPlayer, raw: api, state, calls };
}

const control = (over: Partial<VideoControl> = {}): VideoControl => ({ time: 100, paused: true, ...over });

describe('pendingWrites', () => {
  it('sees nothing to do when the player already matches', () => {
    const p = player();
    expect(changesAnything(pendingWrites(p.raw, control()))).toBe(false);
  });

  it('ignores a gap too small to be worth a scrub', () => {
    const p = player();
    expect(pendingWrites(p.raw, control({ time: 100 + SEEK_THRESHOLD / 2 })).seek).toBe(false);
  });

  it('notices each kind of difference on its own', () => {
    const p = player();
    expect(pendingWrites(p.raw, control({ time: 140 })).seek).toBe(true);
    expect(pendingWrites(p.raw, control({ rate: 1.5 })).rate).toBe(true);
    expect(pendingWrites(p.raw, control({ paused: false })).playback).toBe(true);
  });
});

/**
 * The bug this exists to prevent, found by driving two real browsers:
 *
 * a resync arrives that changes nothing, the echo guard is armed anyway, and
 * for the next fraction of a second the player is deaf to the person sitting in
 * front of it. Their click is swallowed, their player is left somewhere the
 * room is not, and nothing ever tells them.
 */
describe('applyGuarded', () => {
  const setup = (over = {}) => {
    const p = player(over);
    const guard = createEchoGuard();
    return { p, guard, corrector: createCorrector(p.raw, guard) };
  };

  it('does not arm the guard for a control that changes nothing', () => {
    const { p, guard, corrector } = setup();
    applyGuarded(p.api, control(), guard, corrector);
    expect(guard.active()).toBe(false);
    expect(p.calls).toEqual([]);
  });

  it('arms it around a change, so our own write is not read as a click', () => {
    const { p, guard, corrector } = setup();
    applyGuarded(p.api, control({ time: 140 }), guard, corrector);
    expect(guard.active()).toBe(true);
    expect(p.calls).toEqual(['seek:140']);
  });

  it('writes only what differs', () => {
    const { p, guard, corrector } = setup({ paused: false, rate: 1 });
    applyGuarded(p.api, control({ time: 100, paused: true, rate: 1 }), guard, corrector);
    expect(p.calls).toEqual(['pause']);
  });

  it('starts a paused player when the room is playing', () => {
    const { p, guard, corrector } = setup();
    applyGuarded(p.api, control({ paused: false }), guard, corrector);
    expect(p.calls).toEqual(['play']);
  });
});

/**
 * The other half of the same failure. Once an action has been swallowed, or
 * somebody scrubs a paused film, nothing was bringing them back: the drift loop
 * only ran while the room was playing.
 */
describe('correcting a paused player', () => {
  it('pulls a paused player back to where the paused room is', () => {
    const p = player({ paused: true, time: 3 });
    const corrector = createCorrector(p.raw, createEchoGuard());
    expect(corrector.correct(30, 1)).toBe('seek');
    expect(p.state.time).toBe(30);
  });

  it('does not fidget with a paused player that is already in the right place', () => {
    const p = player({ paused: true, time: 30 });
    const corrector = createCorrector(p.raw, createEchoGuard());
    expect(corrector.correct(30.05, 1)).toBe('hold');
    expect(p.calls).toEqual([]);
  });

  it('never bends the rate of a paused player, which would do nothing but confuse it', () => {
    const p = player({ paused: true, time: 30 });
    const corrector = createCorrector(p.raw, createEchoGuard());
    expect(corrector.correct(30.6, 1)).toBe('hold');
    expect(p.calls).toEqual([]);
  });

  it('moves it behind the guard, so the snap-back is not broadcast as a seek', () => {
    const p = player({ paused: true, time: 3 });
    const guard = createEchoGuard();
    const corrector = createCorrector(p.raw, guard);
    const seen: boolean[] = [];
    const original = p.raw.seek;
    p.raw.seek = (t: number) => {
      seen.push(guard.active());
      original(t);
    };
    corrector.correct(30, 1);
    expect(seen).toEqual([true]);
  });
});

describe('the drift loop while the room is paused', () => {
  it('still reports a position, because a paused room is somewhere', async () => {
    const { createDriftEngine } = await import('../sync/engine');
    const correct = vi.fn();
    const engine = createDriftEngine(
      () => ({ correct }),
      () => 999_000,
    );
    engine.observe({ time: 30, paused: true, rate: 1, at: 10_000 });
    engine.tick();
    expect(correct).toHaveBeenCalledWith(30, 1);
  });
});
