import { TINTS } from '@/lib/identity';

export function TintPicker({ value, onPick }: { value: number; onPick: (tint: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Your colour">
      {TINTS.map((color, i) => {
        const selected = i === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Colour ${i + 1}`}
            onClick={() => onPick(i)}
            className="h-5 w-5 rounded-full transition-transform hover:scale-110 active:scale-95"
            style={{
              background: color,
              boxShadow: selected ? `0 0 0 2px var(--color-ab-ink), 0 0 0 3.5px ${color}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
