/**
 * Tells our own changes apart from the person watching.
 *
 * Every correction writes to the player, and the player answers with the same
 * `seeked` and `ratechange` events it fires when a human touches the controls.
 * Without this the room would hear its own correction as a new instruction and
 * everybody would chase everybody.
 *
 * This is the bug most implementations in this category ship.
 */

/** How long an event may take to arrive after the write that caused it. */
export const GUARD_MS = 400;

export interface EchoGuard {
  /** Run a change we are causing, and ignore what the player says about it. */
  suppress(fn: () => void): void;
  active(): boolean;
}

export function createEchoGuard(ms = GUARD_MS): EchoGuard {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let on = false;
  return {
    suppress(fn) {
      on = true;
      clearTimeout(timer);
      try {
        fn();
      } finally {
        // Extends rather than stacks: a burst of writes should be covered to the
        // end of the burst, not to the end of the first one. Cleared again here
        // because suppress nests, and a nested call leaves a timer behind that
        // would lift the guard early.
        clearTimeout(timer);
        timer = setTimeout(() => {
          on = false;
        }, ms);
      }
    },
    active: () => on,
  };
}
