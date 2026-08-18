import { describe, it, expect } from 'vitest';
import {
  ROOM_CODE_RE,
  isValidCode,
  parseClientMessage,
  REACTIONS,
} from './protocol';

const member = { name: 'Bhushan', tint: 3 };

// mirrors apps/server/src/room/room.dto.test.ts so the port is provably faithful
describe('room code', () => {
  it('accepts the codes the extension generates', () => {
    expect(isValidCode('BEAR-TEST01')).toBe(true);
    // 10-char suffix, the hardened length from Phase 2b
    expect(isValidCode('HONEY-ABCDEFGHJK')).toBe(true);
  });

  it('rejects lowercase and missing separator', () => {
    expect(isValidCode('bear-test01')).toBe(false);
    expect(isValidCode('BEARTEST01')).toBe(false);
  });

  it('rejects a suffix longer than the regex allows', () => {
    expect(isValidCode('BEAR-' + 'A'.repeat(13))).toBe(false);
  });

  it('is anchored so it cannot be smuggled inside a longer string', () => {
    expect(ROOM_CODE_RE.test('x BEAR-TEST01')).toBe(false);
    expect(ROOM_CODE_RE.test('BEAR-TEST01 x')).toBe(false);
  });
});

describe('parseClientMessage: room:join', () => {
  it('accepts a valid member', () => {
    const m = parseClientMessage(JSON.stringify({ ev: 'room:join', member }));
    expect(m).toEqual({ ev: 'room:join', member });
  });

  it('rejects a name over 24 chars', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'room:join', member: { ...member, name: 'x'.repeat(25) } }))).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'room:join', member: { ...member, name: '' } }))).toBeNull();
  });

  // The tint is an index into a client-side palette, so the relay validates a
  // small integer and never has to reason about colour.
  it('rejects a tint that is not a small non-negative integer', () => {
    for (const tint of [-1, 1.5, 64, '3', null, NaN]) {
      expect(parseClientMessage(JSON.stringify({ ev: 'room:join', member: { ...member, tint } }))).toBeNull();
    }
  });

  it('drops fields it does not know about, so a stale client cannot inject extras', () => {
    const m = parseClientMessage(
      JSON.stringify({ ev: 'room:join', member: { ...member, fur: '#aabbcc', avatar: 'https://a/b.png' } }),
    );
    expect(m).toEqual({ ev: 'room:join', member });
  });
});

describe('parseClientMessage: chat:send', () => {
  it('accepts text up to 500 chars and rejects beyond', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'chat:send', text: 'x'.repeat(500) }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'chat:send', text: 'x'.repeat(501) }))).toBeNull();
  });

  it('accepts an optional mid and reply snapshot', () => {
    const msg = { ev: 'chat:send', text: 'hi', mid: 'abc', replyTo: { from: 'Cub', text: 'yo' } };
    expect(parseClientMessage(JSON.stringify(msg))).toEqual(msg);
  });

  it('rejects a malformed reply snapshot', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'chat:send', text: 'hi', replyTo: { text: 'no from' } }))).toBeNull();
  });
});

describe('parseClientMessage: video:control', () => {
  it('accepts a control in range', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: 12.5, paused: false, rate: 1 }))).toEqual({
      ev: 'video:control', time: 12.5, paused: false, rate: 1,
    });
  });

  it('rejects out-of-range time and rate', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: -1, paused: false }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: 86_401, paused: false }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: 1, paused: false, rate: 5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: 1, paused: false, rate: 0.1 }))).toBeNull();
  });

  it('rejects NaN and Infinity, which JSON.parse can produce via strings', () => {
    expect(parseClientMessage('{"ev":"video:control","time":null,"paused":false}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'video:control', time: 1, paused: 'no' }))).toBeNull();
  });
});

describe('parseClientMessage: hardening', () => {
  it('returns null for malformed json rather than throwing', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('rejects unknown events', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'room:destroy' }))).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(parseClientMessage('"room:join"')).toBeNull();
  });

  it('ignores a client-supplied code, since the room comes from the socket binding', () => {
    const m = parseClientMessage(JSON.stringify({ ev: 'video:control', code: 'OTHER-ROOM01', time: 1, paused: true }));
    expect(m).not.toBeNull();
    expect(m).not.toHaveProperty('code');
  });
});

describe('reactions', () => {
  it('allows the known set and nothing else', () => {
    expect(REACTIONS.has('🍿')).toBe(true);
    expect(REACTIONS.has('<script>')).toBe(false);
  });
});

describe('room:lock', () => {
  it('accepts a boolean and nothing else', () => {
    expect(parseClientMessage(JSON.stringify({ ev: 'room:lock', locked: true }))).toEqual({
      ev: 'room:lock',
      locked: true,
    });
    expect(parseClientMessage(JSON.stringify({ ev: 'room:lock', locked: false }))).toEqual({
      ev: 'room:lock',
      locked: false,
    });
    expect(parseClientMessage(JSON.stringify({ ev: 'room:lock', locked: 'yes' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ev: 'room:lock' }))).toBeNull();
  });
});

describe('seat', () => {
  const seat = (extra: Record<string, unknown>) =>
    parseClientMessage(JSON.stringify({ ev: 'room:join', member: { name: 'Ada', tint: 0 }, ...extra }));

  it('rides along with a join and a subscribe', () => {
    expect(seat({ seat: 'abc' })).toMatchObject({ seat: 'abc' });
    expect(
      parseClientMessage(JSON.stringify({ ev: 'video:subscribe', seat: 'abc' })),
    ).toMatchObject({ seat: 'abc' });
  });

  it('stays optional, so a client that predates it still joins', () => {
    expect(seat({})).toEqual({ ev: 'room:join', member: { name: 'Ada', tint: 0 } });
  });

  it('refuses an oversized or non-string seat rather than truncating it', () => {
    expect(seat({ seat: 'x'.repeat(65) })).toBeNull();
    expect(seat({ seat: 12 })).toBeNull();
  });
});
