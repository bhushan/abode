import { useId } from 'react';

/**
 * The Abode monogram: an A and a B sharing one stem.
 *
 * Brand rules baked in here so no caller has to remember them:
 *  - the gradient stem is the only place the two brand colours touch
 *  - the wordmark is never gradiented
 *  - below 20px the wordmark is dropped and the monogram stands alone
 */
const BLUE = '#1a73e8';
const AMBER = '#d97706';

export function Mark({ size = 24, className }: { size?: number; className?: string }) {
  // Unique per instance: two inline SVGs sharing a gradient id would make the
  // second one reference the first one's def, and one of them would go flat.
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Abode"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={AMBER} />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M52 14 L14 86" stroke={BLUE} />
        <path d="M26 62 H52" stroke={BLUE} />
        <path d="M52 14 C80 17 80 45 52 50 C86 53 86 83 52 86" stroke={AMBER} />
        <path d="M52 14 V86" stroke={`url(#${gid})`} />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark, side by side.
 *
 * `size` is the monogram size; under 20px the wordmark is dropped per the brand
 * rules, so callers can hand this any size and get something legal back.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  const withWord = size >= 20;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Mark size={size} />
      {withWord ? (
        <span
          className="font-brand font-extrabold lowercase text-ab-cream"
          style={{ fontSize: Math.round(size * 0.78), letterSpacing: '-.015em' }}
        >
          abode
        </span>
      ) : null}
    </span>
  );
}
