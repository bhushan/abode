import { describe, expect, it, vi } from 'vitest';
import type { RoomTimeline } from '@/lib/sync';
import { createDriftEngine, DRIFT_EVERY_MS } from './engine';

const timeline = (over: Partial<RoomTimeline> = {}): RoomTimeline => ({
  time: 100,
  paused: false,
  rate: 1,
  at: 10_000,
  ...over,
});

function harness(serverNow = () => 10_000) {
  const correct = vi.fn();
  let sink: { correct: typeof correct } | null = { correct };
  const engine = createDriftEngine(() => sink, serverNow);
  return { engine, correct, detach: () => (sink = null) };
}

/**
 * The loop that keeps two players together between control events.
 *
 * A control frame only says where the room was when somebody last acted. Left
 * alone after that, two players separate: different buffering, different
 * hardware, different idea of a second. This is the part that closes the gap
 * without anybody seeing it happen.
 */
describe('drift engine', () => {
  it('says nothing until it has been told where the room is', () => {
    const { engine, correct } = harness();
    engine.tick();
    expect(correct).not.toHaveBeenCalled();
  });

  it('hands over the room position, projected to now', () => {
    const { engine, correct } = harness(() => 13_000);
    engine.observe(timeline());
    engine.tick();
    expect(correct).toHaveBeenCalledWith(103, 1);
  });

  it('passes the room speed through, so a correction bends around it', () => {
    const { engine, correct } = harness(() => 12_000);
    engine.observe(timeline({ rate: 1.5 }));
    engine.tick();
    expect(correct).toHaveBeenCalledWith(103, 1.5);
  });

  // A paused room is not advancing, but it is still somewhere, and somebody can
  // be in the wrong place in it.
  it('reports the frozen position of a paused room rather than skipping it', () => {
    const { engine, correct } = harness(() => 999_000);
    engine.observe(timeline({ paused: true }));
    engine.tick();
    expect(correct).toHaveBeenCalledWith(100, 1);
  });

  it('does nothing when there is no player to correct', () => {
    const { engine, correct, detach } = harness();
    engine.observe(timeline());
    detach();
    expect(() => engine.tick()).not.toThrow();
    expect(correct).not.toHaveBeenCalled();
  });

  it('forgets the room when the room is over', () => {
    const { engine, correct } = harness(() => 13_000);
    engine.observe(timeline());
    engine.forget();
    engine.tick();
    expect(correct).not.toHaveBeenCalled();
  });

  it('runs on its own once started, and stops when told', () => {
    vi.useFakeTimers();
    const { engine, correct } = harness(() => 13_000);
    engine.observe(timeline());

    engine.start();
    vi.advanceTimersByTime(DRIFT_EVERY_MS * 3);
    expect(correct).toHaveBeenCalledTimes(3);

    engine.stop();
    vi.advanceTimersByTime(DRIFT_EVERY_MS * 5);
    expect(correct).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('starting twice does not run it twice as often', () => {
    vi.useFakeTimers();
    const { engine, correct } = harness(() => 13_000);
    engine.observe(timeline());
    engine.start();
    engine.start();
    vi.advanceTimersByTime(DRIFT_EVERY_MS * 2);
    expect(correct).toHaveBeenCalledTimes(2);
    engine.stop();
    vi.useRealTimers();
  });
});
