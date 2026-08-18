import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensurePanel, PANEL_WINDOW, requestPanel } from './panel';

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
  const seen = [...contexts];
  const getContexts = vi.fn(() => {
    const n = seen.length > 1 ? (seen.shift() ?? 0) : (seen[0] ?? 0);
    return Promise.resolve(Array.from({ length: n }, () => ({ contextType: 'SIDE_PANEL' })));
  });
  vi.stubGlobal('chrome', {
    sidePanel,
    tabs: { sendMessage },
    windows: { create },
    runtime: {
      sendMessage: toWorker,
      getContexts,
      getURL: (p: string) => `chrome-extension://abode/${p}`,
      getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
    },
  });
  return { create, sendMessage, toWorker, getContexts };
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
    });

    await expect(ensurePanel(7, nowait)).resolves.toBe('none');
  });
});
