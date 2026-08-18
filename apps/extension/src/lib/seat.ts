/**
 * This browser's seat in a room.
 *
 * A person occupies two sockets: the side panel joins the room as a member, and
 * the content script subscribes as a video channel. Neither knows about the
 * other, so when the host locks playback the relay has no way to tell which
 * player belongs to the host. Both sockets present this id, and the relay binds
 * the crown to it.
 *
 * It is not an account and not a login. It never leaves this machine except as
 * an opaque string inside a room, it says nothing about who you are, and losing
 * it costs nothing: the next room hands out a new one.
 */
export const SEAT_KEY = 'ab_seat';

const looksLikeSeat = (v: unknown): v is string => typeof v === 'string' && v.length >= 32;

export async function getSeat(): Promise<string> {
  const stored = (await chrome.storage.local.get(SEAT_KEY))[SEAT_KEY];
  if (looksLikeSeat(stored)) return stored;

  const seat = crypto.randomUUID();
  await chrome.storage.local.set({ [SEAT_KEY]: seat });
  return seat;
}
