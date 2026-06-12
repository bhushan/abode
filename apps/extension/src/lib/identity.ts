/**
 * Who you are in a room.
 *
 * There are no accounts, so an identity is just a name you chose and a colour,
 * held in this browser's storage. It never leaves the machine except as the two
 * fields the relay needs to show you to the others.
 *
 * The colour is stored as an index into TINTS rather than a hex value: the relay
 * validates a small integer instead of parsing colour, the palette can change
 * without a relay deploy, and there is no string for anyone to smuggle anything
 * through.
 */
export interface Identity {
  name: string;
  tint: number;
}

export const IDENTITY_KEY = 'ab_identity';
export const MAX_NAME = 24;

/**
 * Member tints, picked to stay distinguishable from each other and to hold
 * ~4.5:1 against the dark panel. This is the whole reason the bears went: four
 * shades of brown told you nothing about who just spoke.
 */
export const TINTS = [
  '#E8A94F', // lamp
  '#86C79E', // sage
  '#7FB2E5', // sky
  '#D98FB0', // rose
  '#C6A6EE', // lilac
  '#E9D07A', // straw
  '#7FD3D0', // teal
  '#EF9A76', // clay
] as const;

/** Up to two letters to stand in for a face. */
export function initialsOf(name: string): string {
  // Letters and digits only: emoji and punctuation make useless initials.
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

const validTint = (t: unknown): t is number =>
  typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < TINTS.length;

/** Always returns a colour, whatever junk it is handed. */
export function tintOf(index: number): string {
  return validTint(index) ? TINTS[index] : TINTS[0];
}

const randomTint = () => crypto.getRandomValues(new Uint8Array(1))[0] % TINTS.length;

// Nothing thematic: a name you can change, not a character you are assigned.
const FALLBACK_NAMES = ['Guest', 'Friend', 'Viewer'];

const clampName = (name: string) => name.trim().slice(0, MAX_NAME);

/**
 * Read this browser's identity, creating or repairing it as needed.
 *
 * A guest is never asked to fill anything in before joining, so this always
 * yields something usable on the first call.
 */
export async function getIdentity(): Promise<Identity> {
  const data = await chrome.storage.local.get(IDENTITY_KEY);
  const stored = data[IDENTITY_KEY] as Partial<Identity> | undefined;

  const name = clampName(typeof stored?.name === 'string' ? stored.name : '');
  // A v0.4 record carried { name, fur, furDark }; keep the name, drop the fur.
  const next: Identity = {
    name: name || FALLBACK_NAMES[randomTint() % FALLBACK_NAMES.length],
    tint: validTint(stored?.tint) ? stored.tint : randomTint(),
  };

  if (stored && stored.name === next.name && stored.tint === next.tint && !('fur' in stored)) {
    return next;
  }
  await chrome.storage.local.set({ [IDENTITY_KEY]: next });
  return next;
}

export async function setIdentityName(name: string): Promise<void> {
  const trimmed = clampName(name);
  if (!trimmed) return; // a blank field should not wipe the name you had
  const current = await getIdentity();
  await chrome.storage.local.set({ [IDENTITY_KEY]: { ...current, name: trimmed } });
}

export async function setIdentityTint(tint: number): Promise<void> {
  if (!validTint(tint)) return;
  const current = await getIdentity();
  await chrome.storage.local.set({ [IDENTITY_KEY]: { ...current, tint } });
}
