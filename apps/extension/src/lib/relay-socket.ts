// WebSocket transport for the Telesync relay.
//
// Replaces socket.io-client. Socket.IO was giving us reconnect, heartbeats and
// framing for free; a plain WebSocket gives none of that, so those concerns live
// here rather than being scattered through the room/video APIs in socket.ts.

export type ConnStatus = 'connecting' | 'connected' | 'error';

/** The slice of WebSocket this module uses, so tests can supply a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15_000;

/**
 * Build the relay websocket url for a room.
 *
 * Only the origin of the configured server is used: a user who pastes a url
 * with a path should still land on /ws rather than /their/path/ws.
 */
export function relayUrl(serverUrl: string, code: string): string {
  const origin = new URL(serverUrl).origin;
  const scheme = origin.startsWith('https:') ? 'wss:' : 'ws:';
  return `${scheme}${origin.slice(origin.indexOf(':') + 1)}/ws?code=${encodeURIComponent(code)}`;
}

interface Options {
  url: string;
  code: string;
  factory?: SocketFactory;
  onStatus?: (status: ConnStatus) => void;
}

type Frame = Record<string, unknown> & { ev?: unknown };

export class RelaySocket {
  private ws: SocketLike | null = null;
  private readonly handlers = new Map<string, (frame: Frame) => void>();
  private readonly queue: string[] = [];
  private primer: (() => unknown) | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  private readonly factory: SocketFactory;

  constructor(private readonly opts: Options) {
    this.factory = opts.factory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.connect();
  }

  /**
   * A frame sent first on every connection, including reconnects.
   *
   * The relay keys membership to the socket itself, so a dropped connection
   * leaves the room. Without replaying this the client would silently come back
   * as a lurker: still receiving, no longer a member.
   */
  setPrimer(primer: () => unknown): void {
    this.primer = primer;
  }

  on(ev: string, handler: (frame: Frame) => void): void {
    this.handlers.set(ev, handler);
  }

  send(msg: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(payload);
    else this.queue.push(payload);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.queue.length = 0;
    try {
      this.ws?.close(1000, 'client closed');
    } catch {
      // already gone
    }
    this.ws = null;
  }

  private connect(): void {
    if (this.closed) return;
    this.opts.onStatus?.('connecting');

    let ws: SocketLike;
    try {
      ws = this.factory(relayUrl(this.opts.url, this.opts.code));
    } catch {
      this.opts.onStatus?.('error');
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.closed) return;
      this.attempts = 0;
      this.opts.onStatus?.('connected');
      if (this.primer) ws.send(JSON.stringify(this.primer()));
      // Flush anything the caller sent while we were still dialling.
      for (const payload of this.queue.splice(0)) ws.send(payload);
    };

    ws.onmessage = (e) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(e.data)) as Frame;
      } catch {
        return; // a malformed frame is not worth dropping the connection over
      }
      if (typeof frame?.ev !== 'string') return;
      this.handlers.get(frame.ev)?.(frame);
    };

    ws.onerror = () => {
      if (!this.closed) this.opts.onStatus?.('error');
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.ws = null;
      this.opts.onStatus?.('connecting');
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    // Exponential backoff with jitter, so a relay restart does not get a
    // synchronised stampede from every client in the room at once.
    const base = Math.min(RETRY_BASE_MS * 2 ** this.attempts, RETRY_MAX_MS);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempts += 1;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), delay);
  }
}
