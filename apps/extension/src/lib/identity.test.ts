import { describe, it, expect } from 'vitest';
import {
  TINTS,
  IDENTITY_KEY,
  initialsOf,
  tintOf,
  getIdentity,
  setIdentityName,
  setIdentityTint,
} from './identity';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Bhushan Gaykawad')).toBe('BG');
    expect(initialsOf('ada lovelace king')).toBe('AL');
  });

  it('falls back to the first two letters of a single word', () => {
    expect(initialsOf('Bhushan')).toBe('BH');
    expect(initialsOf('Jo')).toBe('JO');
  });

  it('handles a one-character name', () => {
    expect(initialsOf('A')).toBe('A');
  });

  it('survives punctuation, emoji and stray whitespace', () => {
    expect(initialsOf('  ada   lovelace  ')).toBe('AL');
    expect(initialsOf('🎬 movie night')).toBe('MN');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('🎬')).toBe('?');
  });
});

describe('tintOf', () => {
  it('resolves an index to a palette entry', () => {
    expect(tintOf(0)).toBe(TINTS[0]);
    expect(tintOf(TINTS.length - 1)).toBe(TINTS[TINTS.length - 1]);
  });

  it('never returns undefined for an out-of-range or junk index', () => {
    expect(tintOf(999)).toBeDefined();
    expect(tintOf(-1)).toBeDefined();
    expect(tintOf(1.5)).toBeDefined();
    expect(tintOf(NaN)).toBeDefined();
  });
});

describe('the tint palette', () => {
  it('offers enough distinct colours for a room', () => {
    expect(TINTS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TINTS).size).toBe(TINTS.length);
  });

  it('is all valid hex, since the relay validates the index not the colour', () => {
    for (const t of TINTS) expect(t).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('getIdentity', () => {
  it('assigns a name and a tint on first read, and persists them', async () => {
    const id = await getIdentity();
    expect(id.name).toBeTruthy();
    expect(id.tint).toBeGreaterThanOrEqual(0);
    expect(id.tint).toBeLessThan(TINTS.length);

    const stored = await chrome.storage.local.get(IDENTITY_KEY);
    expect(stored[IDENTITY_KEY]).toEqual(id);
  });

  it('returns a stored identity unchanged', async () => {
    const mine = { name: 'Bhushan', tint: 3 };
    await chrome.storage.local.set({ [IDENTITY_KEY]: mine });
    expect(await getIdentity()).toEqual(mine);
  });

  it('repairs a record with a blank name or an out-of-range tint', async () => {
    await chrome.storage.local.set({ [IDENTITY_KEY]: { name: '   ', tint: 99 } });
    const id = await getIdentity();
    expect(id.name.trim()).toBeTruthy();
    expect(id.tint).toBeLessThan(TINTS.length);
  });

  it('migrates a legacy bear record, keeping a name the user chose', async () => {
    // v0.4 stored { name, fur, furDark }; a fur colour has no meaning now
    await chrome.storage.local.set({ [IDENTITY_KEY]: { name: 'Halit', fur: '#C06B3A', furDark: '#9E5328' } });
    const id = await getIdentity();
    expect(id.name).toBe('Halit');
    expect(id.tint).toBeGreaterThanOrEqual(0);
    expect(id).not.toHaveProperty('fur');
  });
});

describe('setIdentityName', () => {
  it('trims before storing', async () => {
    await setIdentityName('  Bhushan  ');
    expect((await getIdentity()).name).toBe('Bhushan');
  });

  it('ignores a blank name rather than wiping the old one', async () => {
    await setIdentityName('Bhushan');
    await setIdentityName('   ');
    expect((await getIdentity()).name).toBe('Bhushan');
  });

  it('caps a very long name so it cannot break the member rail or the relay', async () => {
    await setIdentityName('x'.repeat(80));
    expect((await getIdentity()).name.length).toBeLessThanOrEqual(24);
  });
});

describe('setIdentityTint', () => {
  it('swaps the tint and keeps the name', async () => {
    await setIdentityName('Bhushan');
    await setIdentityTint(5);
    expect(await getIdentity()).toMatchObject({ name: 'Bhushan', tint: 5 });
  });

  it('refuses an index outside the palette', async () => {
    await setIdentityTint(2);
    await setIdentityTint(999);
    expect((await getIdentity()).tint).toBe(2);
  });
});
