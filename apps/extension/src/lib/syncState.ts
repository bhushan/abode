import type { ConnStatus } from '@/lib/socket';

export type SyncState = 'synced' | 'connecting' | 'lost';

/** Map transport status onto what the room is told about itself. */
export function syncStateOf(status: ConnStatus): SyncState {
  if (status === 'connected') return 'synced';
  return status === 'error' ? 'lost' : 'connecting';
}
