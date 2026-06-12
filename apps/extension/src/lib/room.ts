export const STORAGE_KEYS = {
  inRoom: 'ab_inRoom',
  roomCode: 'ab_roomCode',
  anchorTabId: 'ab_anchorTabId',
} as const;

export interface RoomState {
  inRoom: boolean;
  roomCode: string;
}

// must mirror the server's CODE regex in apps/server/src/room/room.dto.ts
export const ROOM_CODE_RE = /^[A-Z]{2,8}-[A-Z0-9]{4,12}$/;
export const isValidCode = (code: string): boolean => ROOM_CODE_RE.test(code.trim());

const CODE_WORDS = ['ABODE', 'ROOM', 'LAMP', 'SOFA', 'ATTIC', 'PORCH', 'HEARTH', 'LOFT'];
// no 0/O/1/I for read-aloud clarity; 32 chars divides 256 evenly so byte % 32 is unbiased
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// There is no account behind this link, so the code is the credential and the
// suffix carries all of the entropy: ten symbols from a 32-character alphabet
// is 50 bits. The word prefix is guessable 1-in-8 and is there for the ear, not
// for security, so it is not counted.
export const CODE_SUFFIX_LEN = 10;

export function generateCode(): string {
  const word = CODE_WORDS[crypto.getRandomValues(new Uint32Array(1))[0] % CODE_WORDS.length];
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_SUFFIX_LEN));
  let suffix = '';
  for (const b of bytes) suffix += ALPHABET[b % ALPHABET.length];
  return `${word}-${suffix}`;
}

// code and destination ride in the link's hash fragment, never sent to the server
const HASH_KEY = 'c';
export const INVITE_BASE_URL = import.meta.env.VITE_INVITE_BASE_URL || 'http://localhost:8787/j';

// landing consent link with #wb=CODE appended for the content script to pick up
export function buildInviteLink(videoUrl: string, code: string): string {
  return `${INVITE_BASE_URL}#${HASH_KEY}=${code}&u=${encodeURIComponent(videoUrl)}`;
}

// reads a valid uppercase room code out of a url hash
export function parseInviteCode(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (k === HASH_KEY && v) {
      const code = decodeURIComponent(v).toUpperCase();
      if (isValidCode(code)) return code;
    }
  }
  return null;
}

// reads the u= destination from a landing-link hash; only http(s) to block javascript:/data: urls
export function parseInviteUrl(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i) !== 'u') continue;
    try {
      const url = new URL(decodeURIComponent(part.slice(i + 1)));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }
  return null;
}


export async function readRoomState(): Promise<RoomState> {
  const data = await chrome.storage.local.get([STORAGE_KEYS.inRoom, STORAGE_KEYS.roomCode]);
  const code = data[STORAGE_KEYS.roomCode];
  return {
    inRoom: Boolean(data[STORAGE_KEYS.inRoom]),
    roomCode: typeof code === 'string' ? code : '',
  };
}
