import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { joinRoom, joinVideoChannel, pingServer, __setSocketFactory } from './socket';
import type { SocketLike } from './relay-socket';

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  deliver(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  get frames(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>); }
}

const latest = () => FakeSocket.instances.at(-1)!;
const identity = { name: 'Ada', tint: 2 };

const handlers = () => ({
  onMembers: vi.fn(),
  onChat: vi.fn(),
  onTyping: vi.fn(),
  onSystem: vi.fn(),
  onStatus: vi.fn(),
  onContent: vi.fn(),
  onLock: vi.fn(),
});

beforeEach(() => {
  FakeSocket.instances = [];
  __setSocketFactory((url) => new FakeSocket(url));
});

afterEach(() => {
  __setSocketFactory(null);
  vi.restoreAllMocks();
});

describe('joinRoom', () => {
  it('announces the member as soon as the socket opens', () => {
    joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers());
    latest().open();
    expect(latest().frames[0]).toEqual({ ev: 'room:join', member: identity });
  });

  it('re-announces after a reconnect, because the relay forgets a dropped socket', () => {
    vi.useFakeTimers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers());
    latest().open();
    latest().close();
    vi.advanceTimersByTime(30_000);
    latest().open();
    expect(latest().frames[0]).toEqual({ ev: 'room:join', member: identity });
    vi.useRealTimers();
  });

  it('reports status transitions to the caller', () => {
    const h = handlers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, h);
    expect(h.onStatus).toHaveBeenCalledWith('connecting');
    latest().open();
    expect(h.onStatus).toHaveBeenLastCalledWith('connected');
  });

  it('passes the caller its own id alongside the member list', () => {
    const h = handlers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, h);
    latest().open();
    latest().deliver({ ev: 'room:welcome', id: 'self-1' });
    latest().deliver({ ev: 'room:members', members: [{ id: 'self-1', name: 'Ada' }] });

    expect(h.onMembers).toHaveBeenCalledWith([{ id: 'self-1', name: 'Ada' }], 'self-1');
  });

  it('routes chat, typing, system and content frames to their handlers', () => {
    const h = handlers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, h);
    latest().open();

    latest().deliver({ ev: 'chat:message', fromId: 'x', from: 'Bo', text: 'hi' });
    latest().deliver({ ev: 'chat:typing', fromId: 'x', from: 'Bo', typing: true });
    latest().deliver({ ev: 'room:system', text: 'Bo joined' });
    latest().deliver({ ev: 'room:content', key: 'k', url: 'https://x/1', title: 'One' });

    expect(h.onChat).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi' }));
    expect(h.onTyping).toHaveBeenCalledWith(expect.objectContaining({ typing: true }));
    expect(h.onSystem).toHaveBeenCalledWith('Bo joined');
    expect(h.onContent).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }));
  });

  it('sends chat, typing, reactions and member updates', () => {
    const conn = joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers());
    latest().open();

    conn.sendChat('hello', { mid: 'm1' });
    conn.sendTyping(true);
    conn.sendReaction('🍿');
    conn.updateMember({ ...identity, name: 'Ada2' });

    const evs = latest().frames.map((f) => f.ev);
    expect(evs).toEqual(['room:join', 'chat:send', 'chat:typing', 'reaction:send', 'member:update']);
    expect(latest().frames[1]).toMatchObject({ text: 'hello', mid: 'm1' });
  });

  it('says goodbye before closing so others see the leave immediately', () => {
    const conn = joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers());
    latest().open();
    const sock = latest();

    conn.disconnect();
    expect(sock.frames.at(-1)).toEqual({ ev: 'room:leave' });
    expect(sock.readyState).toBe(3);
  });
});

describe('joinVideoChannel', () => {
  const content = { key: 'k', url: 'https://x/1', title: 'One' };

  const opts = (over: Partial<Parameters<typeof joinVideoChannel>[2]> = {}) => ({
    anchor: true,
    content,
    name: 'Ada',
    onControl: vi.fn(),
    onReaction: vi.fn(),
    ...over,
  });

  it('subscribes with its anchor flag, content and name on open', () => {
    joinVideoChannel('https://r.test', 'ABODE-TEST01', opts());
    latest().open();
    expect(latest().frames[0]).toEqual({
      ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada',
    });
  });

  it('re-subscribes after a reconnect with the content it has now, not the original', () => {
    vi.useFakeTimers();
    const ch = joinVideoChannel('https://r.test', 'ABODE-TEST01', opts({ anchor: false }));
    latest().open();
    ch.setContent({ key: 'k2', url: 'https://x/2', title: 'Two' });

    latest().close();
    vi.advanceTimersByTime(30_000);
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'video:subscribe', key: 'k2', title: 'Two' });
    vi.useRealTimers();
  });

  it('promotes itself to anchor and stays anchor across a reconnect', () => {
    vi.useFakeTimers();
    const ch = joinVideoChannel('https://r.test', 'ABODE-TEST01', opts({ anchor: false }));
    latest().open();

    ch.claimAnchor({ key: 'k3', url: 'https://x/3', title: 'Three' });
    expect(latest().frames.at(-1)).toMatchObject({ ev: 'video:subscribe', anchor: true, key: 'k3' });

    latest().close();
    vi.advanceTimersByTime(30_000);
    latest().open();
    expect(latest().frames[0]).toMatchObject({ anchor: true, key: 'k3' });
    vi.useRealTimers();
  });

  it('forwards control and reaction frames to the caller', () => {
    const o = opts();
    joinVideoChannel('https://r.test', 'ABODE-TEST01', o);
    latest().open();

    latest().deliver({ ev: 'video:control', time: 12, paused: false, rate: 1 });
    latest().deliver({ ev: 'reaction:show', emoji: '🔥' });

    expect(o.onControl).toHaveBeenCalledWith({ time: 12, paused: false, rate: 1 });
    expect(o.onReaction).toHaveBeenCalledWith({ emoji: '🔥' });
  });

  it('sends a control without a room code, since the relay derives the room', () => {
    const ch = joinVideoChannel('https://r.test', 'ABODE-TEST01', opts());
    latest().open();
    ch.send({ time: 5, paused: true, rate: 1 });

    const frame = latest().frames.at(-1)!;
    expect(frame).toEqual({ ev: 'video:control', time: 5, paused: true, rate: 1 });
    expect(frame).not.toHaveProperty('code');
  });
});

describe('pingServer', () => {
  it('accepts a relay that identifies itself', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'abode-relay' }), { status: 200 }),
    ));
    await expect(pingServer('https://r.test')).resolves.toBe(true);
  });

  it('rejects a host that is something else entirely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'some-other-app' }), { status: 200 }),
    ));
    await expect(pingServer('https://r.test')).resolves.toBe(false);
  });

  it('rejects an unreachable host rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('nope')));
    await expect(pingServer('https://r.test')).resolves.toBe(false);
  });
});

/**
 * The host lock is enforced by the relay, never by hiding the button. These
 * cover the two halves the client is responsible for: presenting the seat that
 * lets the relay recognise this browser, and reporting the state it is told.
 */
describe('control lock', () => {
  it('presents the same seat on both of a person\'s sockets', () => {
    joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers(), 'seat-1');
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'room:join', seat: 'seat-1' });

    joinVideoChannel('https://r.test', 'ABODE-TEST01', {
      anchor: true,
      content: { key: 'k', url: 'https://x/1', title: 'One' },
      name: 'Ada',
      seat: 'seat-1',
      onControl: vi.fn(),
      onReaction: vi.fn(),
    });
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'video:subscribe', seat: 'seat-1' });
  });

  it('re-presents the seat after a reconnect, along with the rest of the primer', () => {
    vi.useFakeTimers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers(), 'seat-1');
    latest().open();
    latest().close();
    vi.advanceTimersByTime(30_000);
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'room:join', seat: 'seat-1' });
    vi.useRealTimers();
  });

  it('omits the seat entirely rather than sending null when there is none', () => {
    joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers());
    latest().open();
    expect(latest().frames[0]).toEqual({ ev: 'room:join', member: identity });
  });

  it('reports the lock state the relay announces', () => {
    const h = handlers();
    joinRoom('https://r.test', 'ABODE-TEST01', identity, h, 'seat-1');
    latest().open();

    latest().deliver({ ev: 'room:lock', locked: true });
    expect(h.onLock).toHaveBeenCalledWith(true);

    latest().deliver({ ev: 'room:lock', locked: false });
    expect(h.onLock).toHaveBeenLastCalledWith(false);
  });

  it('asks for the lock without deciding whether it is allowed', () => {
    const conn = joinRoom('https://r.test', 'ABODE-TEST01', identity, handlers(), 'seat-1');
    latest().open();
    conn.setLock(true);
    expect(latest().frames.at(-1)).toEqual({ ev: 'room:lock', locked: true });
  });
});

/**
 * The video channel owns the room's clock, because it is the socket that
 * carries playback and the only one that needs to know how far this machine is
 * from the relay.
 */
describe('room clock over the video channel', () => {
  const channel = (onControl = vi.fn()) =>
    joinVideoChannel('https://r.test', 'ABODE-TEST01', {
      anchor: true,
      content: { key: 'k', url: 'https://x/1', title: 'One' },
      name: 'Ada',
      onControl,
      onReaction: vi.fn(),
    });

  it('starts asking the relay for the time as soon as it connects', () => {
    channel();
    latest().open();
    expect(latest().frames.some((f) => f.ev === 'time:ping')).toBe(true);
  });

  it('carries the relay stamp through to the caller, since a bare time is unusable', () => {
    const onControl = vi.fn();
    channel(onControl);
    latest().open();

    latest().deliver({ ev: 'video:control', time: 30, paused: false, rate: 1, at: 1_700_000_000_000 });
    expect(onControl).toHaveBeenCalledWith({ time: 30, paused: false, rate: 1, at: 1_700_000_000_000 });
  });

  it('shifts its idea of now once the relay has answered', () => {
    const ch = channel();
    latest().open();
    const ping = latest().frames.find((f) => f.ev === 'time:ping')!;

    const before = ch.serverNow();
    // reply as if the relay were an hour ahead of this machine
    latest().deliver({ ev: 'time:pong', t: ping.t, s: (ping.t as number) + 3_600_000 });

    expect(ch.serverNow() - before).toBeGreaterThan(3_500_000);
  });

  it('stops pinging a room it has left', () => {
    vi.useFakeTimers();
    const ch = channel();
    latest().open();
    ch.disconnect();
    const sent = latest().frames.length;
    vi.advanceTimersByTime(10 * 60_000);
    expect(latest().frames.length).toBe(sent);
    vi.useRealTimers();
  });
});
