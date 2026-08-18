import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { relayUrl, RelaySocket, type SocketLike } from './relay-socket';

/** Minimal stand-in for a WebSocket, driven by the test. */
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed?: { code?: number };
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number) {
    this.closed = { code };
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // --- test drivers ---
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  get frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const factory = (url: string) => new FakeSocket(url);
const latest = () => FakeSocket.instances.at(-1)!;

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('relayUrl', () => {
  it('upgrades http to ws and https to wss', () => {
    expect(relayUrl('http://localhost:3100', 'ABODE-TEST01')).toBe('ws://localhost:3100/ws?code=ABODE-TEST01');
    expect(relayUrl('https://relay.example.com', 'ABODE-TEST01')).toBe('wss://relay.example.com/ws?code=ABODE-TEST01');
  });

  it('drops any path or trailing slash on the configured server', () => {
    expect(relayUrl('https://relay.example.com/', 'ABODE-TEST01')).toBe('wss://relay.example.com/ws?code=ABODE-TEST01');
    expect(relayUrl('https://relay.example.com/base/', 'ABODE-TEST01')).toBe('wss://relay.example.com/ws?code=ABODE-TEST01');
  });

  it('encodes the code so it cannot break out of the query string', () => {
    expect(relayUrl('https://r.test', 'A&b=c')).toBe('wss://r.test/ws?code=A%26b%3Dc');
  });
});

describe('RelaySocket connection', () => {
  it('reports connected once the socket opens', () => {
    const onStatus = vi.fn();
    new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory, onStatus });
    expect(onStatus).toHaveBeenCalledWith('connecting');

    latest().open();
    expect(onStatus).toHaveBeenLastCalledWith('connected');
  });

  it('queues sends made before the socket is open, then flushes in order', () => {
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    s.send({ ev: 'chat:send', text: 'one' });
    s.send({ ev: 'chat:send', text: 'two' });
    expect(latest().sent).toHaveLength(0);

    latest().open();
    expect(latest().frames.map((f) => f.text)).toEqual(['one', 'two']);
  });

  it('dispatches an incoming frame to the handler registered for its event', () => {
    const onChat = vi.fn();
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    s.on('chat:message', onChat);
    latest().open();

    latest().deliver({ ev: 'chat:message', from: 'Ada', text: 'hi' });
    expect(onChat).toHaveBeenCalledWith({ ev: 'chat:message', from: 'Ada', text: 'hi' });
  });

  it('survives a malformed frame without tearing the connection down', () => {
    const onChat = vi.fn();
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    s.on('chat:message', onChat);
    latest().open();

    expect(() => latest().onmessage?.({ data: 'not json' })).not.toThrow();
    latest().deliver({ ev: 'chat:message', text: 'still here' });
    expect(onChat).toHaveBeenCalledTimes(1);
  });
});

describe('RelaySocket reconnect', () => {
  it('reports connecting again and dials a new socket after a drop', () => {
    const onStatus = vi.fn();
    new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory, onStatus });
    latest().open();
    expect(FakeSocket.instances).toHaveLength(1);

    latest().drop();
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it('backs off between attempts instead of hammering the relay', () => {
    // The delay carries random jitter so a relay restart does not produce a
    // synchronised stampede. Pin the jitter here, or the assertions below are a
    // coin flip rather than a test.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    latest().open();

    // first retry lands inside 600ms (500ms base, 0.75x with pinned jitter)
    latest().drop();
    vi.advanceTimersByTime(600);
    expect(FakeSocket.instances).toHaveLength(2);

    // the second waits longer than the first, so 600ms is no longer enough
    latest().drop();
    vi.advanceTimersByTime(600);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('replays the priming frame on every reconnect, since the relay forgets a dropped socket', () => {
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    s.setPrimer(() => ({ ev: 'room:join', member: { name: 'Ada' } }));
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'room:join' });

    latest().drop();
    vi.advanceTimersByTime(10_000);
    latest().open();
    expect(latest().frames[0]).toMatchObject({ ev: 'room:join' });
  });

  it('stops reconnecting once closed by the caller', () => {
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory });
    latest().open();
    const count = FakeSocket.instances.length;

    s.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it('does not report connected again after the caller closed it', () => {
    const onStatus = vi.fn();
    const s = new RelaySocket({ url: 'https://r.test', code: 'ABODE-TEST01', factory, onStatus });
    latest().open();
    s.close();
    onStatus.mockClear();

    vi.advanceTimersByTime(60_000);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
