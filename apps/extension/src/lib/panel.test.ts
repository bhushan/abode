import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensurePanel, expectPanelIn, PANEL_WINDOW, panelDropEndsRoom, requestPanel, restorePanel } from './panel';

/**
 * The room's socket lives in the panel, so a browser that cannot open one cannot
 * sync at all. Chrome's side panel is the right home for it (the video keeps its
 * full width), but Arc's either does not exist or opens nothing, so there the
 * panel has to go into the page itself.
 *
 * The split these assert is the whole fix: the popup may only do what a dying
 * document can finish, which is the synchronous native attempt, and everything
 * that has to survive `window.close()` happens in the service worker.
 */

type OpenFn = (opts: { tabId: number }) => Promise<void>;

interface Stub {
  sidePanel?: { open: OpenFn };
  /** what the tab's content script answers when asked to host the panel */
  inPage?: boolean | 'unreachable';
  /** SIDE_PANEL contexts the browser reports on each successive look */
  contexts?: number[];
}

/** never actually waits: the settle delay is the code's, not the test's */
const nowait = () => Promise.resolve();

function stubChrome({ sidePanel, inPage = false, contexts = [0] }: Stub) {
  const create = vi.fn(() => Promise.resolve({ id: 1 }));
  const sendMessage = vi.fn(() =>
    inPage === 'unreachable' ? Promise.reject(new Error('no receiving end')) : Promise.resolve(inPage),
  );
  const toWorker = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => Promise.resolve());
  const seen = [...contexts];
  const getContexts = vi.fn(() => {
    const n = seen.length > 1 ? (seen.shift() ?? 0) : (seen[0] ?? 0);
    return Promise.resolve(Array.from({ length: n }, () => ({ contextType: 'SIDE_PANEL' })));
  });
  vi.stubGlobal('chrome', {
    sidePanel,
    tabs: { sendMessage },
    windows: { create },
    storage: { local: { get: () => Promise.resolve({}), set } },
    runtime: {
      sendMessage: toWorker,
      getContexts,
      getURL: (p: string) => `chrome-extension://abode/${p}`,
      getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
    },
  });
  return { create, sendMessage, toWorker, getContexts, set };
}

describe('requestPanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  /**
   * The bug this exists for: the popup calls this and closes itself immediately,
   * so anything awaited here dies unfinished. On Arc that was every path that
   * could have worked, and the room came up with no panel and no socket.
   */
  it('does its whole job before returning, because the popup is about to close', () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { toWorker } = stubChrome({ sidePanel: { open } });

    requestPanel(7);

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(toWorker).toHaveBeenCalledWith({ type: 'WB_ENSURE_PANEL', tabId: 7 });
  });

  it('still hands off when the browser has no side panel to try', () => {
    const { toWorker } = stubChrome({ sidePanel: undefined });

    requestPanel(7);

    expect(toWorker).toHaveBeenCalledWith({ type: 'WB_ENSURE_PANEL', tabId: 7 });
  });

  it('hands off even when the side panel call throws outright', () => {
    const open = vi.fn<OpenFn>(() => {
      throw new Error('no such API');
    });
    const { toWorker } = stubChrome({ sidePanel: { open } });

    expect(() => requestPanel(7)).not.toThrow();
    expect(toWorker).toHaveBeenCalledWith({ type: 'WB_ENSURE_PANEL', tabId: 7 });
  });
});

/**
 * Order is the point: a real panel is left alone, then the page, and a detached
 * window only when the page cannot host one (no content script on a store page,
 * say). A window is last because it hides behind the video and is gone in
 * fullscreen.
 */
describe('ensurePanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('leaves a real side panel alone', async () => {
    const { sendMessage, create, getContexts } = stubChrome({ contexts: [1], inPage: true });

    await expect(ensurePanel(7, nowait)).resolves.toBe('sidepanel');

    expect(getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] });
    // a second panel would be a second socket in the same room
    expect(sendMessage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('gives a slow panel a moment to register before giving up on it', async () => {
    const { sendMessage } = stubChrome({ contexts: [0, 1], inPage: true });

    await expect(ensurePanel(7, nowait)).resolves.toBe('sidepanel');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  /** Arc: the API answers, the window never arrives. */
  it('puts the panel in the page when no panel document ever turns up', async () => {
    const { sendMessage, create } = stubChrome({ contexts: [0], inPage: true });

    await expect(ensurePanel(7, nowait)).resolves.toBe('inpage');

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'OPEN_PANEL' });
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to a window when the page will not host the panel', async () => {
    const { create } = stubChrome({ contexts: [0], inPage: false });

    await expect(ensurePanel(7, nowait)).resolves.toBe('window');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'chrome-extension://abode/src/sidepanel/index.html',
        type: 'popup',
        width: PANEL_WINDOW.width,
        height: PANEL_WINDOW.height,
      }),
    );
  });

  it('falls back to a window when there is no content script to answer', async () => {
    const { create } = stubChrome({ contexts: [0], inPage: 'unreachable' });

    await expect(ensurePanel(7, nowait)).resolves.toBe('window');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('trusts the side panel when the browser is too old to be asked', async () => {
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: vi.fn() },
      windows: { create: vi.fn() },
      runtime: { getURL: (p: string) => p, getManifest: () => ({}) },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    });

    await expect(ensurePanel(7, nowait)).resolves.toBe('sidepanel');
  });

  it('resolves rather than throwing when no surface can be opened at all', async () => {
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: vi.fn(() => Promise.reject(new Error('nope'))) },
      windows: { create: vi.fn(() => Promise.reject(new Error('nope'))) },
      runtime: {
        getContexts: vi.fn(() => Promise.resolve([])),
        getURL: (p: string) => p,
        getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
      },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    });

    await expect(ensurePanel(7, nowait)).resolves.toBe('none');
  });
});

/**
 * A native side panel belongs to the browser window and outlives whatever the
 * page does. One hosted inside the page dies with the document, so a reload or a
 * click through to the next episode would leave someone in a room with no panel,
 * and the panel is where the room's own socket lives: they would vanish from the
 * member list and stop receiving chat while still, confusingly, staying in sync.
 */
describe('restorePanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  /** stubChrome, plus a storage that answers rather than shrugging */
  function withRoom(over: Parameters<typeof stubChrome>[0] & { room?: Record<string, unknown> }) {
    const stub = stubChrome(over);
    const room = over.room ?? {};
    const c = globalThis.chrome as unknown as { storage: { local: { get: unknown } } };
    c.storage.local.get = (keys: string[]) =>
      Promise.resolve(Object.fromEntries(keys.map((k) => [k, room[k]])));
    return stub;
  }

  it('opens a panel in the tab that is owed one', async () => {
    const { sendMessage } = withRoom({ contexts: [0], inPage: true, room: { ab_inRoom: true, ab_panelTabId: 7 } });

    await expect(restorePanel(7, nowait)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'OPEN_PANEL' });
  });

  it('leaves other tabs alone, or every tab would open its own panel and its own socket', async () => {
    const { sendMessage } = withRoom({ contexts: [0], inPage: true, room: { ab_inRoom: true, ab_panelTabId: 7 } });

    await expect(restorePanel(9, nowait)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing once the room is over', async () => {
    const { sendMessage } = withRoom({ contexts: [0], inPage: true, room: { ab_inRoom: false, ab_panelTabId: 7 } });

    await expect(restorePanel(7, nowait)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing on a browser whose panel was never in the page', async () => {
    const { sendMessage } = withRoom({ contexts: [0], inPage: true, room: { ab_inRoom: true } });

    await expect(restorePanel(7, nowait)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('defers to a native panel rather than adding a second one', async () => {
    const { sendMessage } = withRoom({ contexts: [1], inPage: true, room: { ab_inRoom: true, ab_panelTabId: 7 } });

    await expect(restorePanel(7, nowait)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to a window when the page it landed on cannot host one', async () => {
    const { create } = withRoom({ contexts: [0], inPage: false, room: { ab_inRoom: true, ab_panelTabId: 7 } });

    await expect(restorePanel(7, nowait)).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Following an invite is the one flow where the tab that asks for a panel is not
 * the tab that can hold one: the landing page runs the invite bridge, not the
 * room, so it has no way to host anything, and a moment later it is replaced by
 * the video anyway. The tab is marked as owed a panel, and the page that lands
 * there collects it.
 */
describe('expectPanelIn', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('marks the tab so the page that lands there can claim it', async () => {
    const { set } = stubChrome({ contexts: [0] });

    await expectPanelIn(7);
    expect(set).toHaveBeenCalledWith({ ab_panelTabId: 7 });
  });
});

describe('ensurePanel remembers where the panel went', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('records the tab when the panel had to go into the page', async () => {
    const { set } = stubChrome({ contexts: [0], inPage: true });

    await expect(ensurePanel(7, nowait)).resolves.toBe('inpage');
    expect(set).toHaveBeenCalledWith({ ab_panelTabId: 7 });
  });

  it('records nothing when the browser opened a real one', async () => {
    const { set } = stubChrome({ contexts: [1] });

    await expect(ensurePanel(7, nowait)).resolves.toBe('sidepanel');
    expect(set).toHaveBeenCalledWith({ ab_panelTabId: null });
  });

  it('records nothing when it ended up in a window of its own', async () => {
    const { set } = stubChrome({ contexts: [0], inPage: false });

    await expect(ensurePanel(7, nowait)).resolves.toBe('window');
    expect(set).toHaveBeenCalledWith({ ab_panelTabId: null });
  });
});

/**
 * A dropped panel port is how a closed panel announces itself, and closing the
 * panel means leaving the room. That inference only holds for a panel the browser
 * owns. One hosted in the page drops its port every time the page navigates, so
 * reading that as "closed" ended the room under anyone who clicked through to the
 * next episode.
 */
describe('panelDropEndsRoom', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const store = (s: Record<string, unknown>) =>
    vi.stubGlobal('chrome', {
      storage: { local: { get: (keys: string[]) => Promise.resolve(Object.fromEntries(keys.map((k) => [k, s[k]]))) } },
    });

  it('ends the room when the browser owned the panel', async () => {
    store({ ab_inRoom: true, ab_panelTabId: null });
    await expect(panelDropEndsRoom()).resolves.toBe(true);
  });

  it('does not end the room when the panel lives in a page that just navigated', async () => {
    store({ ab_inRoom: true, ab_panelTabId: 7 });
    await expect(panelDropEndsRoom()).resolves.toBe(false);
  });

  it('has nothing to end when there is no room', async () => {
    store({ ab_inRoom: false, ab_panelTabId: null });
    await expect(panelDropEndsRoom()).resolves.toBe(false);
  });
});
