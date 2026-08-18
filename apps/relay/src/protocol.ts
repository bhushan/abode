// Wire protocol for the Telesync relay.
//
// Ported from the original NestJS gateway's class-validator DTOs
// (apps/server/src/room/room.dto.ts). Hand-rolled rather than schema-library
// based: these are eight flat shapes, and the Worker stays dependency-free.
//
// One deliberate change from the original: client messages carry no room code.
// The original read the room from a server-tracked socket binding and ignored
// any payload code. Here the room is the Durable Object itself, so the code has
// nowhere to be smuggled in. The security property is structural, not enforced.

// WORD-XXXXXX, matching generateCode() in the extension. The 4..12 suffix range
// covers both the legacy 6-char codes and the hardened 10-char ones.
export const ROOM_CODE_RE = /^[A-Z]{2,8}-[A-Z0-9]{4,12}$/;

// Members carry a palette index, not a colour. The relay validates a bounded
// integer, which leaves nothing to parse and nothing to inject.
const MAX_TINT = 32;

export const isValidCode = (code: string): boolean => ROOM_CODE_RE.test(code);

export const REACTIONS = new Set([
  '🐻', '😂', '❤️', '😱', '😢', '😍', '😡', '👍', '👎', '🔥',
  '🎉', '👏', '🙌', '🤯', '😴', '🥱', '🤔', '😮', '😅', '😭',
  '🥺', '😎', '🤩', '😇', '🙃', '😏', '😬', '🤣', '💀', '👀',
  '✨', '⭐', '💯', '🙏', '🤝', '💪', '🍿', '☕', '🎬', '📺',
  '🐾', '🍯', '🌙', '⚡', '💖', '💔', '🫶', '🤡', '🥳', '😤',
]);

export interface Member {
  name: string;
  tint: number;
}

/**
 * How long an opaque per-install seat id may be.
 *
 * A person occupies two sockets: a panel that joins the room and a content
 * script that subscribes to video. Neither knows about the other, so both
 * present the same seat and the room binds the crown to the seat. The relay
 * never interprets it, only compares it, so its only rule is a length.
 */
const MAX_SEAT = 64;

export interface ReplyRef {
  mid?: string;
  from: string;
  text: string;
}

export interface Content {
  key: string;
  url: string;
  title: string;
}

export type ClientMessage =
  | { ev: 'room:join'; member: Member; seat?: string }
  | { ev: 'room:leave' }
  | { ev: 'room:lock'; locked: boolean }
  | { ev: 'member:update'; member: Member }
  | { ev: 'chat:send'; text: string; mid?: string; replyTo?: ReplyRef }
  | { ev: 'chat:typing'; typing: boolean }
  | { ev: 'reaction:send'; emoji: string }
  | { ev: 'video:subscribe'; anchor?: boolean; key?: string; url?: string; title?: string; name?: string; seat?: string }
  | { ev: 'video:content'; key: string; url: string; title: string }
  | { ev: 'video:control'; time: number; paused: boolean; rate?: number };

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

// A finite number, so NaN and Infinity are rejected rather than propagated into
// playback positions where they would poison every client's drift maths.
const num = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

const optStr = (v: unknown, max: number): boolean => v === undefined || str(v, max);

function parseMember(v: unknown): Member | null {
  if (!isRec(v)) return null;
  if (!str(v.name, 24) || v.name.trim().length === 0) return null;
  if (typeof v.tint !== 'number' || !Number.isInteger(v.tint) || v.tint < 0 || v.tint >= MAX_TINT) return null;
  // Rebuilt field by field rather than spread, so an older or tampered client
  // cannot smuggle extra keys through to everyone else in the room.
  return { name: v.name, tint: v.tint };
}

function parseReplyTo(v: unknown): ReplyRef | null {
  if (!isRec(v)) return null;
  if (!str(v.from, 24) || !str(v.text, 200)) return null;
  if (!optStr(v.mid, 64)) return null;
  const ref: ReplyRef = { from: v.from, text: v.text };
  if (typeof v.mid === 'string') ref.mid = v.mid;
  return ref;
}

/**
 * Parse and validate one raw client frame.
 *
 * Returns null for anything malformed, unknown, or out of range. Callers drop
 * null silently: a client that sends garbage gets no oracle telling it which
 * field was wrong.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(data)) return null;

  switch (data.ev) {
    case 'room:join': {
      const member = parseMember(data.member);
      if (!member) return null;
      if (!optStr(data.seat, MAX_SEAT)) return null;
      const msg: ClientMessage = { ev: 'room:join', member };
      if (typeof data.seat === 'string') msg.seat = data.seat;
      return msg;
    }

    case 'room:leave':
      return { ev: 'room:leave' };

    case 'room:lock':
      return typeof data.locked === 'boolean' ? { ev: 'room:lock', locked: data.locked } : null;

    case 'member:update': {
      const member = parseMember(data.member);
      return member ? { ev: 'member:update', member } : null;
    }

    case 'chat:send': {
      if (!str(data.text, 500) || data.text.length === 0) return null;
      if (!optStr(data.mid, 64)) return null;
      const msg: ClientMessage = { ev: 'chat:send', text: data.text };
      if (typeof data.mid === 'string') msg.mid = data.mid;
      if (data.replyTo !== undefined) {
        const ref = parseReplyTo(data.replyTo);
        if (!ref) return null;
        msg.replyTo = ref;
      }
      return msg;
    }

    case 'chat:typing':
      return typeof data.typing === 'boolean' ? { ev: 'chat:typing', typing: data.typing } : null;

    case 'reaction:send':
      return str(data.emoji, 8) && REACTIONS.has(data.emoji) ? { ev: 'reaction:send', emoji: data.emoji } : null;

    case 'video:subscribe': {
      if (data.anchor !== undefined && typeof data.anchor !== 'boolean') return null;
      if (!optStr(data.key, 512) || !optStr(data.url, 2048)) return null;
      if (!optStr(data.title, 300) || !optStr(data.name, 24)) return null;
      if (!optStr(data.seat, MAX_SEAT)) return null;
      const msg: ClientMessage = { ev: 'video:subscribe' };
      if (typeof data.seat === 'string') msg.seat = data.seat;
      if (typeof data.anchor === 'boolean') msg.anchor = data.anchor;
      if (typeof data.key === 'string') msg.key = data.key;
      if (typeof data.url === 'string') msg.url = data.url;
      if (typeof data.title === 'string') msg.title = data.title;
      if (typeof data.name === 'string') msg.name = data.name;
      return msg;
    }

    case 'video:content':
      if (!str(data.key, 512) || !str(data.url, 2048) || !str(data.title, 300)) return null;
      return { ev: 'video:content', key: data.key, url: data.url, title: data.title };

    case 'video:control': {
      if (!num(data.time, 0, 86_400)) return null;
      if (typeof data.paused !== 'boolean') return null;
      if (data.rate !== undefined && !num(data.rate, 0.25, 4)) return null;
      const msg: ClientMessage = { ev: 'video:control', time: data.time, paused: data.paused };
      if (typeof data.rate === 'number') msg.rate = data.rate;
      return msg;
    }

    default:
      return null;
  }
}
