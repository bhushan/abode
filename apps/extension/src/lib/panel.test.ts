import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPanel, PANEL_WINDOW } from './panel';

/**
 * The room's socket lives in the panel, so a browser that cannot open one cannot
 * sync at all. Chrome's side panel is the right home for it (the video keeps its
 * full width), but Arc ships without `chrome.sidePanel` and has said it will not
 * add it, so there the panel has to go into the page itself.
 *
 * Order matters and is the whole point of these: native panel, then in-page, and
 * a detached window only when the page cannot host one (no content script on a
 * store page, say). A detached window is last because it hides behind the video
 * and disappears in fullscreen.
 */

type OpenFn = (opts: { tabId: number }) => Promise<void>;

interface Stub {
  sidePanel?: { open: OpenFn };
  /** what the tab's content script answers when asked to host the panel */
  inPage?: boolean | 'unreachable';
  /**
   * How many SIDE_PANEL contexts the browser reports on each successive look.
   * `undefined` is a browser too old to be asked.
   */
  contexts?: number[];
}

/** never actually waits: the settle delay is the code's, not the test's */
const nowait = () => Promise.resolve();

function stubChrome({ sidePanel, inPage = false, contexts }: Stub) {
  const create = vi.fn(() => Promise.resolve({ id: 1 }));
  const sendMessage = vi.fn(() =>
    inPage === 'unreachable'
      ? Promise.reject(new Error('no receiving end'))
      : Promise.resolve(inPage),
  );
  const seen = [...(contexts ?? [])];
  const getContexts = vi.fn(() => {
    const n = seen.length > 1 ? (seen.shift() ?? 0) : (seen[0] ?? 0);
    return Promise.resolve(Array.from({ length: n }, () => ({ contextType: 'SIDE_PANEL' })));
  });
  vi.stubGlobal('chrome', {
    sidePanel,
    tabs: { sendMessage },
    windows: { create },
    runtime: {
      getURL: (p: string) => `chrome-extension://abode/${p}`,
      getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
      ...(contexts ? { getContexts } : {}),
    },
  });
  return { create, sendMessage, getContexts };
}

describe('openPanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('uses the side panel when the browser has one', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { create, sendMessage } = stubChrome({ sidePanel: { open }, inPage: true });

    await expect(openPanel(7, nowait)).resolves.toBe('sidepanel');

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    // the page is left alone when the browser has a real panel
    expect(sendMessage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('calls the side panel synchronously, while the click still counts as a gesture', () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    stubChrome({ sidePanel: { open } });

    void openPanel(7, nowait);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('puts the panel in the page when the browser has no side panel API', async () => {
    const { create, sendMessage } = stubChrome({ sidePanel: undefined, inPage: true });

    await expect(openPanel(7, nowait)).resolves.toBe('inpage');

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'OPEN_PANEL' });
    // no detached window: the in-page panel already worked
    expect(create).not.toHaveBeenCalled();
  });

  it('puts the panel in the page when the side panel exists but refuses to open', async () => {
    const open = vi.fn<OpenFn>(() => Promise.reject(new Error('not supported')));
    const { create } = stubChrome({ sidePanel: { open }, inPage: true });

    await expect(openPanel(7, nowait)).resolves.toBe('inpage');
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to a window when the page cannot host the panel', async () => {
    const { create } = stubChrome({ sidePanel: undefined, inPage: false });

    await expect(openPanel(7, nowait)).resolves.toBe('window');

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
    const { create } = stubChrome({ sidePanel: undefined, inPage: 'unreachable' });

    await expect(openPanel(7, nowait)).resolves.toBe('window');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('resolves rather than throwing when no surface can be opened at all', async () => {
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: vi.fn(() => Promise.reject(new Error('nope'))) },
      windows: { create: vi.fn(() => Promise.reject(new Error('nope'))) },
      runtime: {
        getURL: (p: string) => p,
        getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
      },
    });

    await expect(openPanel(7, nowait)).resolves.toBe('none');
  });

  /**
   * The one that matters on Arc. It ships `chrome.sidePanel`, resolves `open()`,
   * and paints nothing, so a browser that says yes has to be taken at its actions
   * rather than its word: no panel document, no panel.
   */
  it('falls back into the page when the browser opens nothing despite having the API', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { create, sendMessage } = stubChrome({ sidePanel: { open }, inPage: true, contexts: [0] });

    await expect(openPanel(7, nowait)).resolves.toBe('inpage');

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'OPEN_PANEL' });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the native panel when the browser really opened one', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { sendMessage, getContexts } = stubChrome({ sidePanel: { open }, inPage: true, contexts: [1] });

    await expect(openPanel(7, nowait)).resolves.toBe('sidepanel');

    expect(getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] });
    // no second panel in the page: that would be two sockets in one room
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('gives a slow panel a moment to register before giving up on it', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { sendMessage } = stubChrome({ sidePanel: { open }, inPage: true, contexts: [0, 1] });

    await expect(openPanel(7, nowait)).resolves.toBe('sidepanel');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('trusts the side panel when the browser is too old to be asked', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { sendMessage } = stubChrome({ sidePanel: { open }, inPage: true });

    await expect(openPanel(7, nowait)).resolves.toBe('sidepanel');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
