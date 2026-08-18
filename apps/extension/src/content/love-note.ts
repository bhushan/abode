/**
 * Fifteen hearts in a row and the room says something back.
 *
 * The relay echoes a reaction to its sender as well as to everyone else, so every
 * client tallies the same stream of hearts and crosses fifteen on the same one.
 * Both screens celebrate together, which is the entire point of it.
 */

export const HEART = '❤️';
export const LOVE_THRESHOLD = 15;
export const LOVE_NOTE = 'I love you Sweetu ♥️';

const NOTE_ID = 'ab-love';
const CONFETTI = 70;
const CONFETTI_COLOURS = ['#e8a94f', '#d98fb0', '#86c79e', '#7fb2e5', '#c6a6ee', '#f5f1e9'];
const HOLD_MS = 4_200;

export interface LoveCounter {
  tally(emoji: string): void;
}

export function createLoveCounter(onLove: () => void, threshold = LOVE_THRESHOLD): LoveCounter {
  let hearts = 0;
  return {
    tally(emoji: string) {
      if (emoji !== HEART) return;
      hearts++;
      if (hearts < threshold) return;
      // reset rather than latch, so it can happen again later in the film
      hearts = 0;
      onLove();
    },
  };
}

/**
 * Paints the note over the video. Confetti is the one loud thing in this product,
 * and it is loud on purpose, but reduced-motion still gets the words without the
 * storm.
 */
export function showLoveNote(host: Element): void {
  // Scoped to the host rather than the document: the overlay lives in a shadow
  // root, where getElementById on the document finds nothing.
  host.querySelector(`#${NOTE_ID}`)?.remove();

  const doc = host.ownerDocument ?? document;
  const calm = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;

  const layer = doc.createElement('div');
  layer.id = NOTE_ID;
  layer.className = 'ab-love';

  const word = doc.createElement('div');
  word.className = 'ab-love-word';
  word.textContent = LOVE_NOTE;
  layer.appendChild(word);

  if (!calm) {
    for (let i = 0; i < CONFETTI; i++) {
      const bit = doc.createElement('i');
      bit.className = 'ab-confetto';
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
      bit.style.animationDelay = `${Math.random() * 0.9}s`;
      bit.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
      bit.style.setProperty('--ab-spin', `${Math.round(Math.random() * 720 - 360)}deg`);
      bit.style.setProperty('--ab-sway', `${Math.round(Math.random() * 120 - 60)}px`);
      layer.appendChild(bit);
    }
  }

  host.appendChild(layer);
  doc.defaultView?.setTimeout(() => layer.remove(), HOLD_MS);
}
