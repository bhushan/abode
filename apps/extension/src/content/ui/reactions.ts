import { createLoveCounter, showLoveNote } from '../love-note';
import { MIN_AREA, pickVideo } from '../video/election';
import { overlayStage } from './overlay';

/**
 * Reactions, floating up over the video.
 *
 * They are aimed at the player's box rather than the viewport, so an emoji rises
 * out of the picture rather than out of the page furniture. When there is no
 * player worth aiming at, the viewport is a reasonable second choice.
 */
const LAYER_ID = 'ab-reactions';

// The relay echoes a reaction back to whoever sent it as well as to everyone
// else, so every client counts the same hearts and crosses fifteen on the same
// one. Both screens light up together, which is the entire point of it.
const love = createLoveCounter(() => showLoveNote(overlayStage()));

export function spawnReaction(emoji: string): void {
  love.tally(emoji);

  const stage = overlayStage();
  let layer = stage.querySelector(`#${LAYER_ID}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'ab-reactions';
    stage.appendChild(layer);
  }

  const video = pickVideo();
  const rect = video && video.clientWidth * video.clientHeight >= MIN_AREA ? video.getBoundingClientRect() : null;
  const zone = rect ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

  const el = document.createElement('div');
  el.className = 'ab-reaction';
  el.textContent = emoji;
  el.style.left = `${zone.left + zone.width * (0.2 + Math.random() * 0.6)}px`;
  el.style.top = `${zone.top + zone.height * 0.88}px`;
  el.style.setProperty('--ab-drift', `${Math.round(Math.random() * 80 - 40)}px`);
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
}
