import { projectRoom, type RoomTimeline } from '@/lib/sync';

/**
 * Keeps a player with the room between control events.
 *
 * A control frame only says where the room was when somebody last acted.
 * Left alone after that, two players separate: different buffering, different
 * hardware, different idea of how long a second is. Watchbear corrected only on
 * a control, and only by scrubbing, so a drifting room stayed drifted until
 * somebody touched the remote.
 *
 * This owns the room's timeline and the tick. It deliberately does not own the
 * decision or the write: the decision is arithmetic in lib/sync.ts, and the
 * write happens wherever the video actually lives, which may be a child frame
 * on another origin.
 */
export const DRIFT_EVERY_MS = 1_000;

export interface DriftSink {
  correct(target: number, baseRate: number): void;
}

export interface DriftEngine {
  /** Record where the room is, from a control frame or from our own action. */
  observe(t: RoomTimeline): void;
  forget(): void;
  tick(): void;
  start(): void;
  stop(): void;
}

export function createDriftEngine(
  sink: () => DriftSink | null,
  serverNow: () => number,
  everyMs = DRIFT_EVERY_MS,
): DriftEngine {
  let room: RoomTimeline | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    // A paused room is not advancing, but it still has a position, and somebody
    // can be in the wrong place in it. projectRoom returns the frozen time.
    if (!room) return;
    sink()?.correct(projectRoom(room, serverNow()), room.rate);
  };

  return {
    observe(t) {
      room = t;
    },
    forget() {
      room = null;
    },
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(tick, everyMs);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
