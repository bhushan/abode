import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject } from 'cloudflare:test';

const CODE = 'BEAR-TEST01';
const member = (name: string, tint = 0) => ({ name, tint });

type Frame = Record<string, unknown> & { ev: string };

/** A connected test client that buffers every frame the relay sends it. */
class Client {
  readonly frames: Frame[] = [];
  private readonly waiters: { match: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const frame = JSON.parse(String(e.data)) as Frame;
      this.frames.push(frame);
      const i = this.waiters.findIndex((w) => w.match(frame));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(frame);
    });
  }

  static async connect(code = CODE): Promise<Client> {
    const res = await SELF.fetch(`https://relay.test/ws?code=${code}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    return new Client(ws);
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.close();
  }

  /** Resolve with the first frame matching `ev` (already-buffered frames count). */
  next(ev: string, timeoutMs = 2000): Promise<Frame> {
    const match = (f: Frame) => f.ev === ev;
    const seen = this.frames.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${ev}"; saw: ${this.frames.map((f) => f.ev).join(', ')}`)),
        timeoutMs,
      );
      this.waiters.push({ match, resolve: (f) => { clearTimeout(timer); resolve(f); } });
    });
  }

  /** Frames of a given type received so far. */
  all(ev: string): Frame[] {
    return this.frames.filter((f) => f.ev === ev);
  }
}

/** Let queued microtasks and socket deliveries settle. */
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('connection', () => {
  it('upgrades on a valid code', async () => {
    const c = await Client.connect();
    c.close();
  });

  it('refuses an invalid room code instead of upgrading', async () => {
    const res = await SELF.fetch('https://relay.test/ws?code=not-a-code', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a non-websocket request to /ws', async () => {
    const res = await SELF.fetch(`https://relay.test/ws?code=${CODE}`);
    expect(res.status).toBe(426);
  });
});

describe('identity', () => {
  it('greets a new socket with its own id, which socket.io used to supply', async () => {
    const a = await Client.connect('BEAR-WELC01');
    const hello = await a.next('room:welcome');
    expect(typeof hello.id).toBe('string');
    expect(String(hello.id).length).toBeGreaterThan(8);
    a.close();
  });

  it('uses that id as the fromId on the sender own messages', async () => {
    const code = 'BEAR-WELC02';
    const a = await Client.connect(code);
    const hello = await a.next('room:welcome');
    a.send({ ev: 'room:join', member: member('Ada') });
    const b = await Client.connect(code);
    b.send({ ev: 'room:join', member: member('Bo') });
    await settle();

    a.send({ ev: 'chat:send', text: 'mine' });
    const got = await b.next('chat:message');
    expect(got.fromId).toBe(hello.id);
    a.close();
    b.close();
  });

  it('marks the caller in the member list via a matching id', async () => {
    const code = 'BEAR-WELC03';
    const a = await Client.connect(code);
    const hello = await a.next('room:welcome');
    a.send({ ev: 'room:join', member: member('Ada') });
    const frame = await a.next('room:members');
    const members = frame.members as { id: string }[];
    expect(members.some((m) => m.id === hello.id)).toBe(true);
    a.close();
  });
});

describe('membership', () => {
  it('broadcasts the member list when someone joins', async () => {
    const a = await Client.connect('BEAR-MEMB01');
    a.send({ ev: 'room:join', member: member('Ada') });
    const frame = await a.next('room:members');
    const members = frame.members as { name: string; host: boolean }[];
    expect(members.map((m) => m.name)).toEqual(['Ada']);
    expect(members[0].host).toBe(true);
    a.close();
  });

  it('makes the first joiner host and hands the crown over when they leave', async () => {
    const code = 'BEAR-HOST01';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await a.next('room:members');

    const b = await Client.connect(code);
    b.send({ ev: 'room:join', member: member('Bo') });
    await b.next('room:members');
    await settle();

    a.close();
    await settle();

    const last = b.all('room:members').at(-1)!;
    const members = last.members as { name: string; host: boolean }[];
    expect(members.map((m) => m.name)).toEqual(['Bo']);
    expect(members[0].host).toBe(true);
    b.close();
  });

  it('tells others someone joined without echoing the notice to the joiner', async () => {
    const code = 'BEAR-SYS001';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await a.next('room:members');
    await settle();
    const before = a.all('room:system').length;

    const b = await Client.connect(code);
    b.send({ ev: 'room:join', member: member('Bo') });
    await settle();

    expect(a.all('room:system').length).toBe(before + 1);
    expect(String(a.all('room:system').at(-1)!.text)).toContain('Bo');
    expect(b.all('room:system')).toHaveLength(0);
    a.close();
    b.close();
  });
});

describe('chat', () => {
  it('delivers a message to others but not back to the sender', async () => {
    const code = 'BEAR-CHAT01';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    const b = await Client.connect(code);
    b.send({ ev: 'room:join', member: member('Bo') });
    await settle();

    a.send({ ev: 'chat:send', text: 'hello' });
    const got = await b.next('chat:message');
    expect(got.text).toBe('hello');
    expect(got.from).toBe('Ada');
    await settle();
    expect(a.all('chat:message')).toHaveLength(0);
    a.close();
    b.close();
  });

  it('drops a chat message from a socket that never joined', async () => {
    const code = 'BEAR-CHAT02';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await settle();

    const lurker = await Client.connect(code);
    lurker.send({ ev: 'chat:send', text: 'i am not here' });
    await settle();

    expect(a.all('chat:message')).toHaveLength(0);
    a.close();
    lurker.close();
  });
});

describe('reactions', () => {
  it('fans a known emoji out to everyone including the sender', async () => {
    const code = 'BEAR-REAC01';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await settle();

    a.send({ ev: 'reaction:send', emoji: '🍿' });
    const got = await a.next('reaction:show');
    expect(got.emoji).toBe('🍿');
    a.close();
  });

  it('drops an emoji outside the known set', async () => {
    const code = 'BEAR-REAC02';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await settle();

    a.send({ ev: 'reaction:send', emoji: '💣' });
    await settle();
    expect(a.all('reaction:show')).toHaveLength(0);
    a.close();
  });
});

describe('video sync', () => {
  it('relays a control to the other clients but not the sender', async () => {
    const code = 'BEAR-VID001';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'k', url: 'https://x/1', title: 'One', name: 'Bo' });
    await settle();

    a.send({ ev: 'video:control', time: 42, paused: true, rate: 1 });
    const got = await b.next('video:control');
    expect(got.time).toBe(42);
    expect(got.paused).toBe(true);
    await settle(); // an echo back to the sender would have landed by now
    expect(a.all('video:control')).toHaveLength(0);
    a.close();
    b.close();
  });

  it('hands a late joiner the current position, advanced by elapsed time', async () => {
    const code = 'BEAR-LATE01';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    await settle();
    a.send({ ev: 'video:control', time: 100, paused: false, rate: 1 });
    await settle();

    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'k', url: 'https://x/1', title: 'One', name: 'Bo' });
    const got = await b.next('video:control');
    expect(got.paused).toBe(false);
    // advanced past the anchor's 100s, but not wildly
    expect(got.time as number).toBeGreaterThanOrEqual(100);
    expect(got.time as number).toBeLessThan(105);
    a.close();
    b.close();
  });

  it('does not advance a paused position for a late joiner', async () => {
    const code = 'BEAR-LATE02';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    await settle();
    a.send({ ev: 'video:control', time: 100, paused: true });
    await settle();

    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'k', url: 'https://x/1', title: 'One', name: 'Bo' });
    const got = await b.next('video:control');
    expect(got.time).toBe(100);
    expect(got.paused).toBe(true);
    a.close();
    b.close();
  });

  it('carries the last known rate forward when a control omits it', async () => {
    const code = 'BEAR-RATE01';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'k', url: 'https://x/1', title: 'One', name: 'Bo' });
    await settle();

    a.send({ ev: 'video:control', time: 10, paused: false, rate: 1.5 });
    await b.next('video:control');
    a.send({ ev: 'video:control', time: 12, paused: true });
    await settle();

    expect(b.all('video:control').at(-1)!.rate).toBe(1.5);
    a.close();
    b.close();
  });

  it('gives a newcomer the anchor content rather than their own', async () => {
    const code = 'BEAR-CONT01';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'anchor', url: 'https://x/anchor', title: 'Anchor', name: 'Ada' });
    await settle();

    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'other', url: 'https://x/other', title: 'Other', name: 'Bo' });
    const got = await b.next('room:content');
    expect(got.key).toBe('anchor');
    a.close();
    b.close();
  });

  it('reseats the anchor when the anchor disconnects', async () => {
    const code = 'BEAR-ANCH01';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'anchor', url: 'https://x/anchor', title: 'Anchor', name: 'Ada' });
    const b = await Client.connect(code);
    b.send({ ev: 'video:subscribe', key: 'other', url: 'https://x/other', title: 'Other', name: 'Bo' });
    await settle();

    a.close();
    await settle();

    const last = b.all('room:content').at(-1)!;
    expect(last.key).toBe('other');
    b.close();
  });

  it('narrates a deliberate seek but stays quiet about normal advance', async () => {
    const code = 'BEAR-NARR01';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    await settle();
    a.send({ ev: 'video:control', time: 10, paused: false, rate: 1 });
    await settle();
    const before = a.all('room:system').length;

    // a small advance consistent with playback: no narration
    a.send({ ev: 'video:control', time: 10.4, paused: false, rate: 1 });
    await settle();
    expect(a.all('room:system').length).toBe(before);

    // a jump well past the threshold: narrated
    a.send({ ev: 'video:control', time: 300, paused: false, rate: 1 });
    await settle();
    const text = String(a.all('room:system').at(-1)!.text);
    expect(text).toContain('Ada');
    expect(text).toContain('5:00');
    a.close();
  });
});

describe('rate limiting', () => {
  it('drops messages past the per-socket window', async () => {
    const code = 'BEAR-RATE99';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    const b = await Client.connect(code);
    b.send({ ev: 'room:join', member: member('Bo') });
    await settle();

    for (let i = 0; i < 40; i++) a.send({ ev: 'chat:send', text: `m${i}` });
    await settle();

    const got = b.all('chat:message').length;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThan(40);
    a.close();
    b.close();
  });
});

describe('isolation', () => {
  it('keeps two rooms from hearing each other', async () => {
    const a = await Client.connect('BEAR-ISO001');
    a.send({ ev: 'room:join', member: member('Ada') });
    const b = await Client.connect('BEAR-ISO002');
    b.send({ ev: 'room:join', member: member('Bo') });
    await settle();

    a.send({ ev: 'chat:send', text: 'private' });
    await settle();

    expect(b.all('chat:message')).toHaveLength(0);
    a.close();
    b.close();
  });
});

describe('hibernation durability', () => {
  it('persists room state to storage, so an evicted isolate does not forget the film', async () => {
    const code = 'BEAR-HIB001';
    const a = await Client.connect(code);
    a.send({ ev: 'video:subscribe', anchor: true, key: 'k', url: 'https://x/1', title: 'One', name: 'Ada' });
    await settle();
    a.send({ ev: 'video:control', time: 77, paused: true, rate: 1.25 });
    await settle();

    // A hibernating Durable Object keeps its sockets but loses every instance
    // field. Anything the room needs after waking has to be in storage.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const stored = await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) =>
      state.storage.get<Record<string, unknown>>('room'),
    );

    expect(stored).toBeDefined();
    expect(stored!.content).toMatchObject({ key: 'k', title: 'One' });
    expect(stored!.video).toMatchObject({ time: 77, paused: true, rate: 1.25 });
    a.close();
  });

  it('keeps per-socket identity on the socket attachment, which survives hibernation', async () => {
    const code = 'BEAR-HIB002';
    const a = await Client.connect(code);
    a.send({ ev: 'room:join', member: member('Ada') });
    await settle();

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const attachments = await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as { member?: { name: string } } | null),
    );

    expect(attachments.some((att) => att?.member?.name === 'Ada')).toBe(true);
    a.close();
  });
});

/**
 * The host-only control lock.
 *
 * A member carries a `host` flag that, until now, nothing enforced. The wrinkle
 * is that a person occupies two sockets: the panel joins the room as a member,
 * the content script subscribes as a video channel, and neither knows about the
 * other. So both present a `seat`, an opaque per-install id, and the room binds
 * the crown to the seat rather than to a socket.
 *
 * Enforcement is here and only here. Hiding the control in the panel would stop
 * an honest client and nobody else, and the person being stopped is the one
 * whose player is about to fight the room.
 */
describe('control lock', () => {
  /** A person: a panel socket that joins, and a video socket that subscribes. */
  async function person(code: string, name: string, seat: string, anchor = false) {
    const panel = await Client.connect(code);
    panel.send({ ev: 'room:join', member: member(name), seat });
    const video = await Client.connect(code);
    video.send({ ev: 'video:subscribe', anchor, key: 'k', url: 'https://x/1', title: 'One', name, seat });
    await settle();
    return { panel, video, close: () => { panel.close(); video.close(); } };
  }

  it('tells the room when the host locks the controls', async () => {
    const code = 'ABODE-LOCK01';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    // Everyone is told the lock state the moment they join, so the interesting
    // frame is the newest one rather than the first.
    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();
    const heard = guest.panel.all('room:lock');

    expect(heard[heard.length - 1].locked).toBe(true);
    host.close();
    guest.close();
  });

  it('drops a guest control and snaps that guest back to where the room is', async () => {
    const code = 'ABODE-LOCK02';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    host.video.send({ ev: 'video:control', time: 100, paused: true });
    await settle();
    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();

    const before = guest.video.all('video:control').length;
    guest.video.send({ ev: 'video:control', time: 5, paused: false });
    await settle();

    // the guest is corrected rather than obeyed
    const after = guest.video.all('video:control');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ time: 100, paused: true });
    // and nobody else was moved
    expect(host.video.all('video:control')).toHaveLength(0);

    host.close();
    guest.close();
  });

  it('still lets the host drive while the lock is on', async () => {
    const code = 'ABODE-LOCK03';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();
    host.video.send({ ev: 'video:control', time: 42, paused: false });

    const got = await guest.video.next('video:control');
    expect(got).toMatchObject({ time: 42, paused: false });

    host.close();
    guest.close();
  });

  it('ignores a guest who asks for the lock, and says nothing back', async () => {
    const code = 'ABODE-LOCK04';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    const before = host.panel.all('room:lock').length;
    guest.panel.send({ ev: 'room:lock', locked: true });
    await settle();

    expect(host.panel.all('room:lock')).toHaveLength(before);
    // the guest can still drive, which is the property that actually matters
    guest.video.send({ ev: 'video:control', time: 9, paused: false });
    const got = await host.video.next('video:control');
    expect(got).toMatchObject({ time: 9 });

    host.close();
    guest.close();
  });

  it('hands a newcomer the lock state, so their panel does not lie about it', async () => {
    const code = 'ABODE-LOCK05';
    const host = await person(code, 'Ada', 's-ada', true);
    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();

    const late = await Client.connect(code);
    late.send({ ev: 'room:join', member: member('Cy'), seat: 's-cy' });

    const state = await late.next('room:lock');
    expect(state.locked).toBe(true);

    late.close();
    host.close();
  });

  it('lets go again when the host unlocks', async () => {
    const code = 'ABODE-LOCK06';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();
    host.panel.send({ ev: 'room:lock', locked: false });
    await settle();

    guest.video.send({ ev: 'video:control', time: 12, paused: false });
    const got = await host.video.next('video:control');
    expect(got).toMatchObject({ time: 12 });

    host.close();
    guest.close();
  });

  it('moves the lock with the crown when the host leaves', async () => {
    const code = 'ABODE-LOCK07';
    const host = await person(code, 'Ada', 's-ada', true);
    const guest = await person(code, 'Bo', 's-bo');

    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();
    host.close();
    await settle();

    // Bo now wears the crown, so Bo drives. A room whose only host has gone must
    // not be a room nobody can touch.
    guest.video.send({ ev: 'video:control', time: 31, paused: false });
    await settle();
    const late = await Client.connect(code);
    late.send({ ev: 'video:subscribe', name: 'Cy', seat: 's-cy' });
    const caught = await late.next('video:control');
    expect(caught.time).toBeCloseTo(31, 0);

    late.close();
    guest.close();
  });

  it('remembers the lock in storage, since an evicted isolate forgets everything else', async () => {
    const code = 'ABODE-LOCK08';
    const host = await person(code, 'Ada', 's-ada', true);
    host.panel.send({ ev: 'room:lock', locked: true });
    await settle();

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const stored = await runInDurableObject(stub, (_instance: unknown, state: DurableObjectState) =>
      state.storage.get<Record<string, unknown>>('room'),
    );
    expect(stored!.locked).toBe(true);

    host.close();
  });
});
