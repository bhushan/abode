/** how long a dropped panel port is given to come back before it counts as closed */
export const PANEL_HANDOVER_MS = 1_000;

export interface PanelRegistry {
  connect(): void;
  disconnect(): void;
}

/**
 * Tracks how many room panels are open, so closing the panel can mean leaving the
 * room without a reopen being mistaken for a close.
 *
 * The panel document reloads whenever it is opened against a different tab: the
 * old port drops and a new one connects a moment later. Treating that handover as
 * a close wiped the room the user had just started.
 */
export function createPanelRegistry(onEmpty: () => void, graceMs = PANEL_HANDOVER_MS): PanelRegistry {
  let open = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    connect() {
      open++;
      cancel();
    },
    disconnect() {
      if (open === 0) return;
      open--;
      if (open > 0) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (open === 0) onEmpty();
      }, graceMs);
    },
  };
}
