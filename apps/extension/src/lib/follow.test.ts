import { describe, expect, it } from 'vitest';
import { shouldOfferFollow } from './follow';

const room = { key: 'crunchyroll.com/watch/GRDQ2K3Z', url: 'https://www.crunchyroll.com/watch/GRDQ2K3Z/ep3', title: 'Episode 3' };

/**
 * When the room moves on to the next episode, everyone else is left behind on
 * the last one. The relay already says where the room went; nobody was doing
 * anything with it.
 *
 * The answer is an offer, not a navigation. Moving somebody's tab out from under
 * them loses their place, and two people are sometimes on different pages on
 * purpose.
 */
describe('shouldOfferFollow', () => {
  it('offers when the room is somewhere this tab is not', () => {
    expect(shouldOfferFollow(room, 'https://www.crunchyroll.com/watch/OLDER/ep2')).toBe(true);
  });

  it('stays quiet when this tab is already there', () => {
    expect(shouldOfferFollow(room, room.url)).toBe(false);
  });

  it('ignores the timestamp and tracking noise that makes two identical pages look different', () => {
    expect(shouldOfferFollow(room, `${room.url}?t=42&utm_source=x`)).toBe(false);
  });

  it('has nothing to offer before the room has said what it is watching', () => {
    expect(shouldOfferFollow(null, room.url)).toBe(false);
  });

  it('does not offer a destination it would refuse to open', () => {
    expect(shouldOfferFollow({ ...room, url: 'javascript:alert(1)' }, 'https://x.test/')).toBe(false);
    expect(shouldOfferFollow({ ...room, url: '' }, 'https://x.test/')).toBe(false);
  });

  it('waits until it knows where this tab is', () => {
    expect(shouldOfferFollow(room, null)).toBe(false);
  });
});
