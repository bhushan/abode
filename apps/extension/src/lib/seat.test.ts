import { describe, expect, it } from 'vitest';
import { getSeat, SEAT_KEY } from './seat';

/**
 * One person, two sockets: the panel joins the room, the content script
 * subscribes to video, and until now nothing connected them. The relay binds
 * the host crown to a seat, so this is the id that makes "the host's player"
 * a thing the room can recognise.
 */
describe('seat', () => {
  it('is the same on every call, or the room would see two strangers', async () => {
    const first = await getSeat();
    expect(await getSeat()).toBe(first);
    expect(await getSeat()).toBe(first);
  });

  it('is stored, so it survives the panel closing and reopening', async () => {
    const seat = await getSeat();
    const stored = await chrome.storage.local.get(SEAT_KEY);
    expect(stored[SEAT_KEY]).toBe(seat);
  });

  it('is opaque and long enough not to collide', async () => {
    const seat = await getSeat();
    expect(seat.length).toBeGreaterThanOrEqual(32);
    // it identifies a browser, not a person: nothing readable should be in it
    expect(seat).toMatch(/^[0-9a-f-]+$/);
  });

  it('replaces junk left in storage rather than passing it on', async () => {
    await chrome.storage.local.set({ [SEAT_KEY]: 42 });
    const seat = await getSeat();
    expect(typeof seat).toBe('string');
    expect(seat.length).toBeGreaterThanOrEqual(32);
  });
});
