import { describe, it, expect } from 'vitest';
import {
  CODE_SUFFIX_LEN,
  generateCode,
  isValidCode,
  ROOM_CODE_RE,
  buildInviteLink,
  parseInviteCode,
  parseInviteUrl,
  INVITE_BASE_URL,
} from './room';

describe('isValidCode', () => {
  it('accepts well-formed codes', () => {
    expect(isValidCode('ABODE-TEST01')).toBe(true);
    expect(isValidCode('LOFT-AB3K')).toBe(true);
  });

  it('trims surrounding whitespace before testing', () => {
    expect(isValidCode('  ABODE-TEST01  ')).toBe(true);
  });

  it('rejects lowercase, missing dash, and bad lengths', () => {
    expect(isValidCode('abode-test01')).toBe(false);
    expect(isValidCode('ABODETEST01')).toBe(false);
    expect(isValidCode('A-BCDE')).toBe(false);
    expect(isValidCode('ABODE-AB')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });
});

describe('generateCode', () => {
  it('produces a code that passes its own validator', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(ROOM_CODE_RE.test(code)).toBe(true);
    }
  });

  it('never uses the ambiguous 0/O/1/I in the suffix', () => {
    for (let i = 0; i < 200; i++) {
      const suffix = generateCode().split('-')[1];
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });

  // The link is the only credential in this product, so the suffix is carrying
  // the weight an account password would carry elsewhere. Ten characters of a
  // 32-symbol alphabet is 50 bits, and the word prefix is guessable 1-in-8, so
  // the suffix has to stand on its own.
  it('draws a 50-bit suffix, since the link is the only credential', () => {
    expect(CODE_SUFFIX_LEN).toBe(10);
    for (let i = 0; i < 200; i++) {
      expect(generateCode().split('-')[1]).toHaveLength(CODE_SUFFIX_LEN);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateCode());
    expect(seen.size).toBe(500);
  });
});

describe('buildInviteLink', () => {
  it('points at the landing page with the code and encoded video url in the hash', () => {
    const link = buildInviteLink('https://www.netflix.com/watch/123?x=1', 'ABODE-AB12CD');
    expect(link.startsWith(`${INVITE_BASE_URL}#`)).toBe(true);
    expect(link).toContain('c=ABODE-AB12CD');
    expect(link).toContain(`u=${encodeURIComponent('https://www.netflix.com/watch/123?x=1')}`);
    // the inner url's own query must not break the outer hash parsing
    expect(link.split('#')[1].split('&').length).toBe(2);
  });

  it('round-trips the code through parseInviteCode', () => {
    const link = buildInviteLink('https://youtu.be/abc', 'LOFT-XY9Z');
    expect(parseInviteCode(new URL(link).hash)).toBe('LOFT-XY9Z');
  });
});

describe('parseInviteCode', () => {
  it('reads the code from a landing hash and a bare video hash', () => {
    expect(parseInviteCode('#c=ABODE-AB12CD&u=https%3A%2F%2Fx.com')).toBe('ABODE-AB12CD');
    expect(parseInviteCode('#c=ABODE-AB12CD')).toBe('ABODE-AB12CD');
    expect(parseInviteCode('#t=30&c=LOFT-XY9Z')).toBe('LOFT-XY9Z'); // not first
  });

  it('uppercases and validates', () => {
    expect(parseInviteCode('#c=abode-ab12cd')).toBe('ABODE-AB12CD');
    expect(parseInviteCode('#c=not-a-code!')).toBeNull();
    expect(parseInviteCode('#c=')).toBeNull();
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('#t=30')).toBeNull();
  });
});

describe('parseInviteUrl', () => {
  it('decodes the u= http(s) destination from a landing hash', () => {
    const link = buildInviteLink('https://www.netflix.com/watch/123?x=1', 'ABODE-AB12CD');
    expect(parseInviteUrl(new URL(link).hash)).toBe('https://www.netflix.com/watch/123?x=1');
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=https%3A%2F%2Fyoutu.be%2Fabc')).toBe('https://youtu.be/abc');
  });

  it('rejects non-http(s) and missing/invalid urls (no javascript:/data: smuggling)', () => {
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=javascript%3Aalert(1)')).toBeNull();
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=data%3Atext%2Fhtml%2Cx')).toBeNull();
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=not%20a%20url')).toBeNull();
    // protocol-relative: no scheme of its own, so it inherits the page's and
    // would navigate off to somebody else's host
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=%2F%2Fevil.example')).toBeNull();
    expect(parseInviteUrl('#c=ABODE-AB12CD&u=file%3A%2F%2F%2Fetc%2Fpasswd')).toBeNull();
    expect(parseInviteUrl('#c=ABODE-AB12CD')).toBeNull();
    expect(parseInviteUrl('')).toBeNull();
  });
});
