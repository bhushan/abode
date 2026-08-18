import type { Member, ReplyRef } from './types';
import type { Identity } from './identity';
import { RelaySocket, type ConnStatus, type SocketFactory } from './relay-socket';

export type { ConnStatus };

// Test seam: lets the suite drive a fake socket without a live relay.
let socketFactory: SocketFactory | null = null;
export function __setSocketFactory(factory: SocketFactory | null): void {
  socketFactory = factory;
}

export async function pingServer(serverUrl: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(serverUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;

    const data = (await res.json().catch(() => null)) as { name?: string } | null;
    return data?.name === 'abode-relay';
  } catch {
    return false;
  }
}

interface ChatPayload {
  fromId: string;
  from: string;
  text: string;
  mid?: string;
  replyTo?: ReplyRef;
}

export interface ChatOpts {
  mid?: string;
  replyTo?: ReplyRef;
}

interface TypingPayload {
  fromId: string;
  from: string;
  typing: boolean;
}

export interface RoomHandlers {
  onMembers: (members: Member[], selfId: string | undefined) => void;
  /** Whether the host is currently steering playback for everyone. */
  onLock: (locked: boolean) => void;
  onChat: (msg: ChatPayload) => void;
  onTyping: (msg: TypingPayload) => void;
  onSystem: (text: string) => void;
  onStatus: (status: ConnStatus) => void;
  onContent: (c: VideoContentInfo) => void;
}

export interface RoomConnection {
  sendChat: (text: string, opts?: ChatOpts) => void;
  /** Ask to lock or unlock playback. The relay ignores this unless you are host. */
  setLock: (locked: boolean) => void;
  sendTyping: (typing: boolean) => void;
  sendReaction: (emoji: string) => void;
  updateMember: (member: Identity) => void;
  disconnect: () => void;
}

export interface VideoControl {
  time: number;
  paused: boolean;
  // optional so older clients without a rate still validate
  rate?: number;
}

export interface VideoContentInfo {
  key: string;
  url: string;
  title: string;
}

export interface VideoChannelOpts {
  anchor: boolean;
  content: VideoContentInfo;
  name: string;
  /** This browser's seat, so the relay can recognise the host's own player. */
  seat?: string;
  onControl: (c: VideoControl) => void;
  onReaction: (p: { emoji: string }) => void;
}

export interface VideoChannel {
  send: (c: VideoControl) => void;
  // call after a same-tab (SPA) navigation so the relay knows our new content
  setContent: (c: VideoContentInfo) => void;
  // promote this socket to anchor; covers the storage-arm vs message race
  claimAnchor: (c: VideoContentInfo) => void;
  disconnect: () => void;
}

function open(url: string, code: string, onStatus?: (s: ConnStatus) => void): RelaySocket {
  return new RelaySocket({ url, code, onStatus, factory: socketFactory ?? undefined });
}

// video-only sync channel: joins the room for control events but isn't a member
export function joinVideoChannel(serverUrl: string, code: string, opts: VideoChannelOpts): VideoChannel {
  let anchor = opts.anchor;
  let content = opts.content;

  const socket = open(serverUrl, code);
  // Replayed on every reconnect using the *current* anchor and content, not the
  // values we started with: a dropped socket that comes back mid-episode should
  // resubscribe to what it is playing now.
  socket.setPrimer(() => ({ ev: 'video:subscribe', anchor, ...content, name: opts.name, seat: opts.seat }));

  socket.on('video:control', (f) =>
    opts.onControl({ time: f.time as number, paused: f.paused as boolean, rate: f.rate as number | undefined }),
  );
  socket.on('reaction:show', (f) => opts.onReaction({ emoji: f.emoji as string }));

  return {
    send: (c) => socket.send({ ev: 'video:control', time: c.time, paused: c.paused, rate: c.rate }),
    setContent: (c) => {
      content = c;
      socket.send({ ev: 'video:content', ...c });
    },
    claimAnchor: (c) => {
      anchor = true;
      content = c;
      socket.send({ ev: 'video:subscribe', anchor: true, ...c, name: opts.name, seat: opts.seat });
    },
    disconnect: () => socket.close(),
  };
}

export function joinRoom(
  serverUrl: string,
  code: string,
  member: Identity,
  handlers: RoomHandlers,
  seat?: string,
): RoomConnection {
  // The relay assigns this on connect. socket.io used to hand us socket.id for
  // free; the side panel needs it to tell "you" apart in the member list.
  let selfId: string | undefined;

  const socket = open(serverUrl, code, handlers.onStatus);
  socket.setPrimer(() => ({ ev: 'room:join', member, seat }));

  socket.on('room:welcome', (f) => {
    selfId = f.id as string;
  });
  socket.on('room:members', (f) => handlers.onMembers(f.members as Member[], selfId));
  socket.on('chat:message', (f) => handlers.onChat(f as unknown as ChatPayload));
  socket.on('chat:typing', (f) => handlers.onTyping(f as unknown as TypingPayload));
  socket.on('room:system', (f) => handlers.onSystem(f.text as string));
  socket.on('room:content', (f) => handlers.onContent(f as unknown as VideoContentInfo));
  socket.on('room:lock', (f) => handlers.onLock(f.locked === true));

  return {
    sendChat: (text, opts) => socket.send({ ev: 'chat:send', text, ...opts }),
    sendTyping: (typing) => socket.send({ ev: 'chat:typing', typing }),
    sendReaction: (emoji) => socket.send({ ev: 'reaction:send', emoji }),
    setLock: (locked) => socket.send({ ev: 'room:lock', locked }),
    updateMember: (m) => socket.send({ ev: 'member:update', member: m }),
    disconnect: () => {
      socket.send({ ev: 'room:leave' });
      socket.close();
    },
  };
}
