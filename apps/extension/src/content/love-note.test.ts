import { describe, expect, it, vi } from 'vitest';
import { createLoveCounter, HEART, LOVE_THRESHOLD } from './love-note';

/**
 * The relay broadcasts a reaction back to whoever sent it as well as to everyone
 * else, so both people's clients tally the same hearts and reach fifteen on the
 * same one. That is what makes this land on both screens at once instead of only
 * the presser's.
 */
describe('love counter', () => {
  const beat = (tally: (e: string) => void, n: number, emoji = HEART) => {
    for (let i = 0; i < n; i++) tally(emoji);
  };

  it('says nothing until the fifteenth heart', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    beat(tally, LOVE_THRESHOLD - 1);
    expect(onLove).not.toHaveBeenCalled();

    tally(HEART);
    expect(onLove).toHaveBeenCalledTimes(1);
  });

  it('fires once, not on every heart after the fifteenth', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    beat(tally, LOVE_THRESHOLD + 5);

    expect(onLove).toHaveBeenCalledTimes(1);
  });

  it('can happen again after another fifteen', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    beat(tally, LOVE_THRESHOLD * 2);

    expect(onLove).toHaveBeenCalledTimes(2);
  });

  it('only hearts count', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    beat(tally, 40, '🍿');
    beat(tally, 40, '🔥');

    expect(onLove).not.toHaveBeenCalled();
  });

  it('other reactions in between do not reset the tally', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    // a real room is a mix; hearts should still add up across the noise
    for (let i = 0; i < LOVE_THRESHOLD; i++) {
      tally(HEART);
      tally('😂');
    }

    expect(onLove).toHaveBeenCalledTimes(1);
  });

  it('counts hearts from anyone, since every client tallies the same broadcast', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove);

    // whoever pressed them, they arrive here the same way
    beat(tally, 7);
    beat(tally, 8);

    expect(onLove).toHaveBeenCalledTimes(1);
  });

  it('honours a custom threshold', () => {
    const onLove = vi.fn();
    const { tally } = createLoveCounter(onLove, 3);

    beat(tally, 3);

    expect(onLove).toHaveBeenCalledTimes(1);
  });
});
