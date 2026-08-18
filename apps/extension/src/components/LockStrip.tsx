import type { ReactNode } from 'react';
import { formatTimecode } from '@/lib/timecode';
import type { SyncState } from '@/lib/syncState';

const LOOK: Record<SyncState, { label: string; color: string }> = {
  // Label and colour both change, never colour alone: the state has to survive
  // colour blindness and a sideways glance from across the sofa.
  synced: { label: 'In sync', color: 'var(--color-ab-sync)' },
  connecting: { label: 'Catching up', color: 'var(--color-ab-lamp)' },
  lost: { label: 'Offline', color: 'var(--color-ab-lost)' },
};

/**
 * The one line that reports whether the thing this product exists to do is
 * working, with the room's position as its anchor.
 *
 * The inherited panel spent four stacked rows on a title, a code, a clock and a
 * now-playing label, and never once said whether you were actually in sync.
 */
export function LockStrip({
  state,
  at,
  title,
  children,
}: {
  state: SyncState;
  at?: number | null;
  title?: string;
  /** Room controls that belong on the instrument line, composed in by the panel. */
  children?: ReactNode;
}) {
  const look = LOOK[state];
  return (
    <div className="relative border-b border-ab-edge px-3.5 pb-2.5 pt-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${state === 'connecting' ? 'animate-ab-pulse' : ''}`}
          style={{
            background: look.color,
            boxShadow: `0 0 0 4px color-mix(in srgb, ${look.color} 16%, transparent)`,
          }}
        />
        <span className="text-[12px] font-semibold" style={{ color: look.color }}>
          {look.label}
        </span>
        <span className="ml-auto font-mono text-[16px] font-medium tabular-nums tracking-[-.01em] text-ab-cream">
          {formatTimecode(at)}
        </span>
        {children}
      </div>
      {title ? (
        <div className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ab-faint" title={title}>
          {title}
        </div>
      ) : null}
    </div>
  );
}
