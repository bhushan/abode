import { describe, expect, it, vi } from 'vitest';
import { startRoom, type StartRoomDeps } from './startRoom';
import { ROOM_CODE_RE } from './room';

/**
 * These cover the two ways the popup's primary action was silently failing in a
 * real browser while every existing test stayed green:
 *
 *  1. `chrome.sidePanel.open()` only works while the click's user activation is
 *     still live. Awaiting anything first spends it, the call rejects, and the
 *     panel never appears.
 *  2. Closing the popup tears down its message port. Fire the room message and
 *     close in the same tick and the message can die in flight, so the room is
 *     never written and the panel opens on an empty state.
 *
 * Neither reproduces in Playwright: a popup opened as a tab ignores
 * `window.close()` and has no user activation to spend, so the ordering that
 * breaks in production is exactly the ordering the harness cannot see. That is
 * why these assert the sequence directly.
 */

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeDeps(overrides: Partial<StartRoomDeps> = {}): StartRoomDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openPanel: vi.fn(() => {
      calls.push('openPanel');
    }),
    send: vi.fn(() => {
      calls.push('send');
      return Promise.resolve();
    }),
    close: vi.fn(() => {
      calls.push('close');
    }),
    ...overrides,
  };
}

describe('startRoom', () => {
  it('opens the side panel before awaiting anything, while the gesture is still live', async () => {
    const d = makeDeps();

    // deliberately not awaited: the panel must already be open by the time this
    // call first yields, which is the only window where the gesture still counts
    const done = startRoom(7, d);
    expect(d.openPanel).toHaveBeenCalledWith(7);

    await done;
    expect(d.calls[0]).toBe('openPanel');
  });

  it('waits for the room message to be delivered before closing the popup', async () => {
    const gate = deferred();
    const d = makeDeps({ send: vi.fn(() => gate.promise) });

    const done = startRoom(7, d);
    await Promise.resolve();

    // the popup document is the message's own sender; closing it now can drop the
    // message and leave the user in no room at all
    expect(d.close).not.toHaveBeenCalled();

    gate.resolve();
    await done;
    expect(d.close).toHaveBeenCalledTimes(1);
  });

  it('sends WB_START_ROOM for the given tab with a shareable room code', async () => {
    const d = makeDeps();
    await startRoom(42, d);

    expect(d.send).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(d.send).mock.calls[0][0];
    expect(msg).toMatchObject({ type: 'WB_START_ROOM', tabId: 42 });
    expect((msg as { code: string }).code).toMatch(ROOM_CODE_RE);
  });

  it('generates a fresh code per room rather than reusing one', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const d = makeDeps();
      await startRoom(1, d);
      seen.add((vi.mocked(d.send).mock.calls[0][0] as { code: string }).code);
    }
    expect(seen.size).toBe(20);
  });

  it('does nothing at all without a tab to anchor the room to', async () => {
    const d = makeDeps();
    await startRoom(null, d);

    expect(d.openPanel).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    // leaving the popup open is the honest outcome: nothing was started
    expect(d.close).not.toHaveBeenCalled();
  });

  it('leaves the popup open when the room message fails, rather than closing on a lie', async () => {
    const d = makeDeps({ send: vi.fn(() => Promise.reject(new Error('port closed'))) });

    await expect(startRoom(7, d)).resolves.toBeUndefined();
    expect(d.close).not.toHaveBeenCalled();
  });
});
