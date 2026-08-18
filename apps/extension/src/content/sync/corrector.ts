import { planCorrection, type Correction } from '@/lib/sync';
import type { EchoGuard } from './echo-guard';

/**
 * Applies a correction to one player.
 *
 * The same logic runs in the top frame for a same-page player and inside a child
 * frame for an embedded one, so it lives in neither.
 *
 * The one rule worth stating: a nudged rate is never the room's rate. A player
 * set to 1.05 to catch up reports 1.05, and if that number ever reached the
 * relay everyone would speed up, correct against each other, and the room would
 * run away from the film.
 */
export interface CorrectablePlayer {
  currentTime(): number;
  paused(): boolean;
  rate(): number;
  seek(time: number): void;
  setRate(rate: number): void;
}

export interface Corrector {
  /** Bring the player towards `target` seconds. Returns what it did. */
  correct(target: number, baseRate: number): Correction['kind'];
  /** Undo a correction in flight, leaving the player at the room's speed. */
  release(): void;
  /** The speed the room should hear about, ignoring any correction. */
  reportedRate(actual: number): number;
}

export function createCorrector(player: CorrectablePlayer, guard: EchoGuard): Corrector {
  let base: number | null = null;

  const setRate = (rate: number) => {
    if (player.rate() === rate) return;
    guard.suppress(() => player.setRate(rate));
  };

  const release = () => {
    if (base === null) return;
    const rate = base;
    base = null;
    setRate(rate);
  };

  return {
    correct(target, baseRate) {
      const plan = planCorrection(player.currentTime(), target, baseRate);

      // A paused player is not drifting, so there is nothing to bend the rate
      // towards. It can still be in the wrong place, though: somebody scrubs
      // while the room is paused, or their own action is swallowed by the echo
      // guard, and without this they sit there silently off the room forever.
      if (player.paused()) {
        release();
        if (plan.kind !== 'seek') return 'hold';
        guard.suppress(() => player.seek(plan.time));
        return 'seek';
      }

      switch (plan.kind) {
        case 'seek':
          base = null;
          guard.suppress(() => player.seek(plan.time));
          setRate(baseRate);
          return 'seek';
        case 'nudge':
          base = baseRate;
          setRate(plan.rate);
          return 'nudge';
        case 'hold':
          release();
          return 'hold';
      }
    },
    release,
    reportedRate: (actual) => base ?? actual,
  };
}
