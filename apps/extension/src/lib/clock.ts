/**
 * The room's shared clock.
 *
 * Two people watching the same film on two machines disagree about what time it
 * is, and every drift number in this product is a difference between their
 * clocks. So the relay's clock is the room's clock, and each client estimates
 * its distance from it.
 *
 * Cristian's algorithm: send a ping stamped with local time, the relay echoes it
 * back alongside its own, and the reply is assumed to have been true at the
 * midpoint of the round trip. That assumption is wrong by however asymmetric the
 * trip was, which is exactly why the *fastest* sample is the one kept: the less
 * time it spent in flight, the less room the asymmetry had to hide in.
 */

/** Openers, close together, because a single sample is a guess. */
export const PING_BURST = 4;
export const PING_GAP_MS = 2_000;
/** Then rarely: inbound websocket frames are the billed direction, and two NTP-fed machines do not drift fast. */
export const PING_IDLE_MS = 60_000;

const WINDOW = 8;

interface Sample {
  rtt: number;
  offset: number;
}

export interface OffsetEstimator {
  sample(sentAt: number, serverAt: number, receivedAt: number): void;
  /** Milliseconds to add to local time to get the relay's. Zero until we know better. */
  offset(): number;
  /** Round trip of the sample currently being trusted, or null before any. */
  rtt(): number | null;
}

export function createOffsetEstimator(windowSize = WINDOW): OffsetEstimator {
  const samples: Sample[] = [];

  const best = (): Sample | null =>
    samples.reduce<Sample | null>((a, b) => (a === null || b.rtt < a.rtt ? b : a), null);

  return {
    sample(sentAt, serverAt, receivedAt) {
      const rtt = receivedAt - sentAt;
      // A reply cannot arrive before it left. A clock that says otherwise has
      // been stepped mid-flight, and its sample would poison the estimate.
      if (!Number.isFinite(rtt) || rtt < 0) return;
      samples.push({ rtt, offset: serverAt + rtt / 2 - receivedAt });
      if (samples.length > windowSize) samples.shift();
    },
    offset: () => best()?.offset ?? 0,
    rtt: () => best()?.rtt ?? null,
  };
}

export interface RoomClock {
  start(): void;
  stop(): void;
  onPong(sentAt: number, serverAt: number, receivedAt?: number): void;
  /** The relay's idea of now, as best this client can tell. */
  serverNow(): number;
  offset(): number;
  rtt(): number | null;
}

export function createRoomClock(
  send: (sentAt: number) => void,
  now: () => number = Date.now,
): RoomClock {
  const estimator = createOffsetEstimator();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let sent = 0;

  const tick = () => {
    send(now());
    sent += 1;
    timer = setTimeout(tick, sent < PING_BURST ? PING_GAP_MS : PING_IDLE_MS);
  };

  return {
    start() {
      if (running) return;
      running = true;
      sent = 0;
      tick();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      timer = undefined;
    },
    onPong(sentAt, serverAt, receivedAt = now()) {
      estimator.sample(sentAt, serverAt, receivedAt);
    },
    // Falls back to the local clock rather than refusing to answer: an offset of
    // zero is the honest starting assumption, and it is what every client used
    // before this existed.
    serverNow: () => now() + estimator.offset(),
    offset: () => estimator.offset(),
    rtt: () => estimator.rtt(),
  };
}
