import { DurableObject } from 'cloudflare:workers';
import { parseClientMessage, type Content, type Member } from './protocol';

// Drift past this (seconds) reads as a deliberate seek rather than normal
// playback advance, and is worth narrating in chat.
const SEEK_NOTICE = 1.5;

const MAX_MEMBERS = 50;
const RATE_LIMIT = 25;
const RATE_WINDOW_MS = 1_000;

interface VideoState {
  time: number;
  paused: boolean;
  rate?: number;
  updatedAt: number;
}

/** Room state that must outlive an evicted isolate. */
interface RoomState {
  video?: VideoState;
  content?: Content;
  anchorId?: string;
  /** Host-only control lock. Persisted, so a woken room does not quietly unlock. */
  locked?: boolean;
}

/**
 * Per-socket state, kept on the socket itself via serializeAttachment.
 *
 * Hibernation keeps sockets but discards every instance field, so anything
 * attached to a connection lives here rather than in a Map on the object.
 */
interface Att {
  id: string;
  member?: Member;
  host?: boolean;
  /**
   * Opaque per-install id shared by this person's two sockets.
   *
   * The crown is worn by a member socket, but playback arrives on a separate
   * video socket, and nothing else connects the two. The seat is what lets the
   * room recognise the host's player.
   */
  seat?: string;
  /** Display name for a video-only socket, used to attribute control events. */
  name?: string;
  content?: Content;
}

function formatTime(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * One Durable Object per room code.
 *
 * The original NestJS gateway kept `Map<code, …>` for every kind of room state.
 * Here the object *is* the room, so those outer maps collapse away and a client
 * has no way to name a room it is not connected to.
 */
export class RoomDO extends DurableObject<Env> {
  /** In-memory mirror of persisted room state; rehydrated lazily after a wake. */
  private room: RoomState | undefined;
  /** Rate-limit counters. Losing these on hibernation is harmless. */
  private readonly hits = new Map<string, { count: number; reset: number }>();

  private async load(): Promise<RoomState> {
    this.room ??= (await this.ctx.storage.get<RoomState>('room')) ?? {};
    return this.room;
  }

  private async save(): Promise<void> {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_MEMBERS) {
      return new Response('room full', { status: 503 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket rather than server.accept(): this is what lets the object
    // hibernate while the connection stays open, so an idle room costs nothing.
    this.ctx.acceptWebSocket(server);
    const id = crypto.randomUUID();
    server.serializeAttachment({ id } satisfies Att);
    // socket.io handed the client its own id; a bare WebSocket does not, and the
    // side panel needs it to tell "you" apart from everyone else in the room.
    this.sendTo(server, { ev: 'room:welcome', id });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    const att = ws.deserializeAttachment() as Att | null;
    if (!att) return;
    if (!this.withinRate(att.id)) return;

    const msg = parseClientMessage(raw);
    if (!msg) return;

    switch (msg.ev) {
      case 'room:join':
        return this.onJoin(ws, att, msg.member, msg.seat);
      case 'room:leave':
        return this.onLeave(ws, att);
      case 'room:lock':
        return this.onLock(att, msg.locked);
      case 'member:update':
        return this.onMemberUpdate(ws, att, msg.member);
      case 'chat:send':
        return this.onChat(ws, att, msg.text, msg.mid, msg.replyTo);
      case 'chat:typing':
        return this.onTyping(ws, att, msg.typing);
      case 'reaction:send':
        return this.broadcast({ ev: 'reaction:show', emoji: msg.emoji });
      case 'video:subscribe':
        return this.onSubscribe(ws, att, msg);
      case 'video:content':
        return this.onContent(ws, att, { key: msg.key, url: msg.url, title: msg.title });
      case 'video:control':
        return this.onControl(ws, att, msg.time, msg.paused, msg.rate);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Att | null;
    if (att) await this.onLeave(ws, att, { closing: true });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Att | null;
    if (att) await this.onLeave(ws, att, { closing: true });
  }

  // ---- handlers -----------------------------------------------------------

  private async onJoin(ws: WebSocket, att: Att, member: Member, seat?: string): Promise<void> {
    // First member in the room wears the crown.
    const host = this.members(ws).length === 0;
    const next: Att = { ...att, member, host };
    if (seat !== undefined) next.seat = seat;
    this.attach(ws, next);
    this.broadcastMembers();
    this.broadcast({ ev: 'room:system', text: `${member.name} joined the room` }, ws);

    const room = await this.load();
    if (room.content) this.sendTo(ws, { ev: 'room:content', ...room.content });
    // Told unconditionally: a panel that assumed "unlocked" would show a control
    // that does nothing, which is worse than showing the lock.
    this.sendTo(ws, { ev: 'room:lock', locked: !!room.locked });
  }

  /**
   * Turn the lock on or off. Only the socket wearing the crown may.
   *
   * A refusal is silent. There is nothing useful to tell a client that asked for
   * something it cannot have, and an error frame would only teach a probe which
   * seat holds the crown.
   */
  private async onLock(att: Att, locked: boolean): Promise<void> {
    if (!att.host) return;
    const room = await this.load();
    if (room.locked === locked) return;
    room.locked = locked;
    await this.save();
    this.broadcast({ ev: 'room:lock', locked });
    const who = att.member?.name;
    this.broadcast({
      ev: 'room:system',
      text: locked
        ? `${who ?? 'The host'} is steering playback for everyone`
        : `${who ?? 'The host'} handed playback back to the room`,
    });
  }

  private async onLeave(ws: WebSocket, att: Att, opts?: { closing?: boolean }): Promise<void> {
    const wasMember = att.member;
    const wasHost = att.host;
    this.attach(ws, { id: att.id });
    if (!opts?.closing) ws.close(1000, 'left');

    if (wasHost) this.promoteHost(ws);
    if (att.content) await this.reseatAnchor(att.id, ws);

    if (wasMember) {
      // Clear any typing dots left behind by someone who bailed mid-message.
      this.broadcast({ ev: 'chat:typing', fromId: att.id, from: wasMember.name, typing: false }, ws);
      this.broadcast({ ev: 'room:system', text: `${wasMember.name} left the room` }, ws);
    }
    this.broadcastMembers(ws);
  }

  private onMemberUpdate(ws: WebSocket, att: Att, member: Member): void {
    if (!att.member) return;
    const prev = att.member.name;
    this.attach(ws, { ...att, member });
    this.broadcastMembers();
    const text = prev !== member.name ? `${prev} is now ${member.name}` : `${member.name} changed their look`;
    this.broadcast({ ev: 'room:system', text }, ws);
  }

  private onChat(ws: WebSocket, att: Att, text: string, mid?: string, replyTo?: unknown): void {
    if (!att.member) return; // a socket that never joined has no voice
    this.broadcast({ ev: 'chat:message', fromId: att.id, from: att.member.name, text, mid, replyTo }, ws);
  }

  private onTyping(ws: WebSocket, att: Att, typing: boolean): void {
    if (!att.member) return;
    this.broadcast({ ev: 'chat:typing', fromId: att.id, from: att.member.name, typing }, ws);
  }

  private async onSubscribe(
    ws: WebSocket,
    att: Att,
    msg: { anchor?: boolean; key?: string; url?: string; title?: string; name?: string; seat?: string },
  ): Promise<void> {
    const room = await this.load();
    const next: Att = { ...att };
    if (msg.name) next.name = msg.name;
    if (msg.seat !== undefined) next.seat = msg.seat;

    if (msg.key && msg.url) {
      const content: Content = { key: msg.key, url: msg.url, title: msg.title ?? '' };
      next.content = content;
      this.attach(ws, next);
      // The anchor defines what the room is watching; otherwise seed it only if
      // nobody has yet, so a newcomer on a different page cannot hijack it.
      if (msg.anchor || !room.content) {
        if (msg.anchor) room.anchorId = att.id;
        room.content = content;
        await this.save();
        this.broadcast({ ev: 'room:content', ...content });
      } else {
        this.sendTo(ws, { ev: 'room:content', ...room.content });
      }
    } else {
      this.attach(ws, next);
      if (room.content) this.sendTo(ws, { ev: 'room:content', ...room.content });
    }

    // Hand the newcomer the room's current playback position.
    if (room.video) {
      const elapsed = room.video.paused ? 0 : (Date.now() - room.video.updatedAt) / 1000;
      this.sendTo(ws, {
        ev: 'video:control',
        time: room.video.time + elapsed,
        paused: room.video.paused,
        rate: room.video.rate,
      });
    }
  }

  private async onContent(ws: WebSocket, att: Att, content: Content): Promise<void> {
    this.attach(ws, { ...att, content });
    const room = await this.load();
    if (room.anchorId !== att.id) return; // only the anchor moves the room's label
    room.content = content;
    await this.save();
    this.broadcast({ ev: 'room:content', ...content });
  }

  private async onControl(ws: WebSocket, att: Att, time: number, paused: boolean, rate?: number): Promise<void> {
    const room = await this.load();

    // Locked and not the host's player: refuse, then put this player back where
    // the room is. Refusing alone would leave them watching something nobody
    // else is, which is the failure the lock exists to prevent.
    if (room.locked && !this.isHostSeat(att)) return this.resync(ws, room);

    const prev = room.video;
    const text = this.describeControl(prev, { time, paused, rate }, att.name);
    if (text) this.broadcast({ ev: 'room:system', text });

    // Carry the last known rate when a control omits it, so play/pause does not
    // silently reset playback speed for everyone.
    const nextRate = rate ?? prev?.rate;
    room.video = { time, paused, rate: nextRate, updatedAt: Date.now() };
    await this.save();
    this.broadcast({ ev: 'video:control', time, paused, rate: nextRate }, ws);
  }

  // ---- helpers ------------------------------------------------------------

  private describeControl(
    prev: VideoState | undefined,
    next: { time: number; paused: boolean; rate?: number },
    name: string | undefined,
  ): string | undefined {
    if (!name) return undefined;
    if (!prev || prev.paused !== next.paused) {
      return next.paused ? `${name} paused the video` : `${name} resumed the video`;
    }
    if (typeof next.rate === 'number' && next.rate !== (prev.rate ?? 1)) {
      return `${name} set the speed to ${next.rate}x`;
    }
    const expected = prev.time + (prev.paused ? 0 : (Date.now() - prev.updatedAt) / 1000);
    const delta = next.time - expected;
    if (Math.abs(delta) <= SEEK_NOTICE) return undefined;
    return `${name} ${delta > 0 ? 'skipped ahead to' : 'skipped back to'} ${formatTime(next.time)}`;
  }

  /** Does this socket belong to the person wearing the crown? */
  private isHostSeat(att: Att): boolean {
    if (att.host) return true;
    if (att.seat === undefined) return false;
    return this.members().some((s) => {
      const a = s.deserializeAttachment() as Att | null;
      return !!a?.host && a.seat === att.seat;
    });
  }

  /** Send one socket the room's current position, without disturbing anyone else. */
  private resync(ws: WebSocket, room: RoomState): void {
    if (!room.video) return;
    const elapsed = room.video.paused ? 0 : (Date.now() - room.video.updatedAt) / 1000;
    this.sendTo(ws, {
      ev: 'video:control',
      time: room.video.time + elapsed,
      paused: room.video.paused,
      rate: room.video.rate,
    });
  }

  /** Give the crown to whoever is left, so a room is never hostless. */
  private promoteHost(leaving: WebSocket): void {
    const next = this.members(leaving)[0];
    if (!next) return;
    const att = next.deserializeAttachment() as Att;
    this.attach(next, { ...att, host: true });
  }

  /** Move the anchor to a remaining video socket so nobody is left diverged. */
  private async reseatAnchor(leavingId: string, leaving: WebSocket): Promise<void> {
    const room = await this.load();
    const remaining = this.ctx
      .getWebSockets()
      .filter((s) => s !== leaving)
      .map((s) => ({ s, att: s.deserializeAttachment() as Att | null }))
      .filter((e): e is { s: WebSocket; att: Att } => !!e.att?.content);

    if (remaining.length === 0) {
      // Nobody is watching anything: forget the room's playback entirely, so a
      // fresh party on the same code does not inherit a stale position.
      this.room = {};
      await this.save();
      return;
    }
    if (room.anchorId !== leavingId) return;

    const next = remaining[0];
    room.anchorId = next.att.id;
    room.content = next.att.content;
    await this.save();
    this.broadcast({ ev: 'room:content', ...next.att.content! });
  }

  private withinRate(id: string): boolean {
    const now = Date.now();
    const h = this.hits.get(id);
    if (!h || now > h.reset) {
      this.hits.set(id, { count: 1, reset: now + RATE_WINDOW_MS });
      return true;
    }
    if (h.count >= RATE_LIMIT) return false;
    h.count += 1;
    return true;
  }

  private attach(ws: WebSocket, att: Att): void {
    ws.serializeAttachment(att);
  }

  /** Sockets that have joined as members, excluding one that is on its way out. */
  private members(exclude?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => {
      if (s === exclude) return false;
      return !!(s.deserializeAttachment() as Att | null)?.member;
    });
  }

  private broadcastMembers(exclude?: WebSocket): void {
    const members = this.members(exclude).map((s) => {
      const att = s.deserializeAttachment() as Att;
      return { id: att.id, ...att.member!, host: !!att.host };
    });
    this.broadcast({ ev: 'room:members', members }, exclude);
  }

  private sendTo(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already gone; the close handler will clean up
    }
  }

  private broadcast(msg: unknown, except?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      if (s === except) continue;
      try {
        s.send(payload);
      } catch {
        // ignore a socket that died mid-broadcast
      }
    }
  }
}
