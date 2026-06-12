/**
 * Format a video position for display.
 *
 * Used for the lock strip and for chat stamps. Chat is stamped in *video* time
 * rather than wall-clock time: a watch party is organised by where you are in the
 * film, so "12:03 that shot" means something a clock time never could.
 */
export function formatTimecode(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';

  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
