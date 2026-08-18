/**
 * Who is allowed to drive playback.
 *
 * The relay is what enforces this; the button only asks. That split matters:
 * hiding the control from a guest would stop an honest client and nobody else,
 * and the guest whose player is about to fight the room is exactly the person
 * who needs to see why it keeps snapping back.
 *
 * So a guest is shown the lock too, plainly, and told who holds it.
 */
export function ControlLock({
  locked,
  canToggle,
  hostName,
  onToggle,
}: {
  locked: boolean;
  canToggle: boolean;
  hostName?: string;
  onToggle: (next: boolean) => void;
}) {
  const base =
    'flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[10.5px] font-semibold tracking-[.01em]';

  if (!canToggle) {
    if (!locked) return null;
    return (
      <span
        className={`${base} border-ab-edge bg-ab-sunk text-ab-dim`}
        title={hostName ? `${hostName} controls playback for the room` : 'The host controls playback for the room'}
      >
        <Glyph locked />
        Host only
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={locked}
      aria-label="Only the host controls playback"
      title={
        locked
          ? 'Only you can play, pause and seek. Click to hand playback back to the room.'
          : 'Anyone can play, pause and seek. Click to keep it to yourself.'
      }
      onClick={() => onToggle(!locked)}
      className={`${base} transition-colors ${
        locked
          ? 'border-ab-lamp/45 bg-ab-lamp/15 text-ab-lamp'
          : 'border-ab-edge bg-ab-sunk text-ab-faint hover:text-ab-dim'
      }`}
    >
      <Glyph locked={locked} />
      Host only
    </button>
  );
}

/** A padlock that is genuinely open when unlocked, so the state survives a glance. */
function Glyph({ locked }: { locked: boolean }) {
  return (
    <svg aria-hidden="true" width="9" height="11" viewBox="0 0 9 11" fill="none">
      <rect x=".6" y="4.4" width="7.8" height="6" rx="1.6" fill="currentColor" />
      <path
        d={locked ? 'M2.4 4.4V3a2.1 2.1 0 0 1 4.2 0v1.4' : 'M2.4 4.4V3a2.1 2.1 0 0 1 4.2 0'}
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
