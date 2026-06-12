import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelRegistry, PANEL_HANDOVER_MS } from './panel-registry';

/**
 * Closing the side panel means leaving the room, and the dropped panel port is
 * how the worker learns about it. The trouble is that the panel document also
 * reloads whenever it is opened against a different tab: the old port drops and a
 * new one connects a moment later. Treating that handover as a close wipes the
 * room the user just started, which is what put "No room yet" in a panel that had
 * only just been opened.
 */
describe('panel registry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports empty once the only panel closes for good', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS);

    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('does not report empty until the handover window has passed', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS - 1);

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it('survives the panel reconnecting during a handover', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS / 2);
    r.connect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS * 4);

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it('keeps the room while another panel is still connected', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS * 4);

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it('reports empty once, not once per panel that was open', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.connect();
    r.disconnect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS * 4);

    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('reports empty again after the panel is reopened and closed', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS);
    r.connect();
    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS);

    expect(onEmpty).toHaveBeenCalledTimes(2);
  });

  it('ignores a stray disconnect with nothing open', () => {
    const onEmpty = vi.fn();
    const r = createPanelRegistry(onEmpty);

    r.disconnect();
    vi.advanceTimersByTime(PANEL_HANDOVER_MS * 4);

    expect(onEmpty).not.toHaveBeenCalled();
  });
});
