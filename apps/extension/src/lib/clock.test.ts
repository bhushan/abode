import { describe, expect, it, vi } from 'vitest';
import { createOffsetEstimator, createRoomClock, PING_BURST, PING_GAP_MS, PING_IDLE_MS } from './clock';

/**
 * A shared clock, estimated by round trip.
 *
 * Two people watching the same film on two machines have two different ideas of
 * "now", and every drift number in this product is a difference between them.
 * Cristian's algorithm is the whole idea: ask the relay what time it is, assume
 * the round trip was symmetric, and keep the sample that travelled fastest,
 * because that is the one whose assumption is least wrong.
 */
describe('offset estimator', () => {
  it('knows nothing until it has been told something', () => {
    const clock = createOffsetEstimator();
    expect(clock.offset()).toBe(0);
    expect(clock.rtt()).toBeNull();
  });

  it('reads a perfectly symmetric round trip as pure offset', () => {
    const clock = createOffsetEstimator();
    // sent at 1000, server said 6050, back at 1100: 100ms round trip, so the
    // server's answer was true at 1050 local, putting it 5000ms ahead.
    clock.sample(1_000, 6_050, 1_100);
    expect(clock.offset()).toBe(5_000);
    expect(clock.rtt()).toBe(100);
  });

  it('keeps the fastest sample, since a slow one hides the offset inside its own delay', () => {
    const clock = createOffsetEstimator();
    clock.sample(0, 5_000, 1_000); // 1000ms round trip, a bad estimate
    clock.sample(2_000, 7_010, 2_020); // 20ms, much better
    clock.sample(3_000, 8_400, 3_800); // 800ms, worse again

    expect(clock.rtt()).toBe(20);
    expect(clock.offset()).toBe(5_000);
  });

  it('forgets old samples, so a network that recovers is not judged by its worst hour', () => {
    const clock = createOffsetEstimator(3);
    clock.sample(0, 1_000, 10); // 10ms, the best sample there is
    for (let i = 1; i <= 3; i++) clock.sample(i * 100, i * 100 + 2_000, i * 100 + 200);

    // the 10ms sample has fallen out of the window; the estimate follows
    expect(clock.rtt()).toBe(200);
    expect(clock.offset()).toBe(2_000 - 100);
  });

  it('ignores a reply that claims to have arrived before it was sent', () => {
    const clock = createOffsetEstimator();
    clock.sample(1_000, 6_050, 1_100);
    clock.sample(2_000, 9_999, 1_900); // negative round trip: a lying or confused clock
    expect(clock.offset()).toBe(5_000);
  });
});

describe('room clock', () => {
  it('opens with a burst, because one sample is a guess', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const clock = createRoomClock(send);

    clock.start();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PING_GAP_MS * (PING_BURST - 1));
    expect(send).toHaveBeenCalledTimes(PING_BURST);

    clock.stop();
    vi.useRealTimers();
  });

  it('then settles into a slow heartbeat, because websocket frames are billed', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const clock = createRoomClock(send);

    clock.start();
    vi.advanceTimersByTime(PING_GAP_MS * PING_BURST);
    const afterBurst = send.mock.calls.length;

    vi.advanceTimersByTime(PING_IDLE_MS);
    expect(send.mock.calls.length).toBe(afterBurst + 1);
    vi.advanceTimersByTime(PING_IDLE_MS);
    expect(send.mock.calls.length).toBe(afterBurst + 2);

    clock.stop();
    vi.useRealTimers();
  });

  it('stops asking once the room is over', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const clock = createRoomClock(send);

    clock.start();
    clock.stop();
    const sent = send.mock.calls.length;
    vi.advanceTimersByTime(PING_IDLE_MS * 5);
    expect(send.mock.calls.length).toBe(sent);

    vi.useRealTimers();
  });

  it('turns a reply into a server-side now', () => {
    vi.useFakeTimers();
    const now = () => 1_000;
    const clock = createRoomClock(vi.fn(), now);
    clock.onPong(900, 5_950, 1_000); // 100ms trip, server 5000ms ahead
    expect(clock.serverNow()).toBe(6_000);
    vi.useRealTimers();
  });

  it("falls back to this machine's clock rather than pretending, when nothing has come back", () => {
    const clock = createRoomClock(vi.fn(), () => 4_242);
    expect(clock.serverNow()).toBe(4_242);
  });
});
