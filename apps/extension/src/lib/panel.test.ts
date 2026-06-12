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
}

function stubChrome({ sidePanel, inPage = false }: Stub) {
  const create = vi.fn(() => Promise.resolve({ id: 1 }));
  const sendMessage = vi.fn(() =>
    inPage === 'unreachable'
      ? Promise.reject(new Error('no receiving end'))
      : Promise.resolve(inPage),
  );
  vi.stubGlobal('chrome', {
    sidePanel,
    tabs: { sendMessage },
    windows: { create },
    runtime: {
      getURL: (p: string) => `chrome-extension://abode/${p}`,
      getManifest: () => ({ side_panel: { default_path: 'src/sidepanel/index.html' } }),
    },
  });
  return { create, sendMessage };
}

describe('openPanel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('uses the side panel when the browser has one', async () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    const { create, sendMessage } = stubChrome({ sidePanel: { open }, inPage: true });

    await expect(openPanel(7)).resolves.toBe('sidepanel');

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    // the page is left alone when the browser has a real panel
    expect(sendMessage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('calls the side panel synchronously, while the click still counts as a gesture', () => {
    const open = vi.fn<OpenFn>(() => Promise.resolve());
    stubChrome({ sidePanel: { open } });

    void openPanel(7);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('puts the panel in the page when the browser has no side panel API', async () => {
    const { create, sendMessage } = stubChrome({ sidePanel: undefined, inPage: true });

    await expect(openPanel(7)).resolves.toBe('inpage');

    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'OPEN_PANEL' });
    // no detached window: the in-page panel already worked
    expect(create).not.toHaveBeenCalled();
  });

  it('puts the panel in the page when the side panel exists but refuses to open', async () => {
    const open = vi.fn<OpenFn>(() => Promise.reject(new Error('not supported')));
    const { create } = stubChrome({ sidePanel: { open }, inPage: true });

    await expect(openPanel(7)).resolves.toBe('inpage');
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to a window when the page cannot host the panel', async () => {
    const { create } = stubChrome({ sidePanel: undefined, inPage: false });

    await expect(openPanel(7)).resolves.toBe('window');

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

    await expect(openPanel(7)).resolves.toBe('window');
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

    await expect(openPanel(7)).resolves.toBe('none');
  });
});
