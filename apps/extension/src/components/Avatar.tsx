import { initialsOf, tintOf } from '@/lib/identity';

/**
 * Initials on a tinted disc.
 *
 * This replaces the inherited bear faces for one reason: an avatar's whole job is
 * to tell you instantly who spoke, and four shades of brown bear could not.
 */
export function Avatar({
  name,
  tint,
  size = 22,
  ring,
}: {
  name: string;
  tint: number;
  size?: number;
  ring?: boolean;
}) {
  const color = tintOf(tint);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        // tinted glass rather than a solid block: readable on the dark panel
        // without shouting over the video beside it
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        color,
        fontSize: Math.round(size * 0.42),
        letterSpacing: '.01em',
        boxShadow: ring ? `0 0 0 1.5px ${color}` : `inset 0 0 0 1px color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
