import { contentKey } from '@/lib/content';
import { createPlayer, type PageContext, type PlayerAdapter } from './contract';

/**
 * Netflix.
 *
 * The one hard-won fact inherited from Watchbear: writing `video.currentTime`
 * crashes the Netflix player. Its seek has to go through the page's own player
 * API, which lives in the MAIN world, so the isolated content script asks
 * `netflix-main.ts` to do it over postMessage. Everything else is an ordinary
 * `<video>`.
 */
const SEEK_MESSAGE = '__abnf';

const seekViaPlayerApi = (_video: HTMLVideoElement, time: number): void => {
  window.postMessage({ [SEEK_MESSAGE]: 1, kind: 'seek', time }, '*');
};

/** `/watch/81234567` is the title; the query string is tracking and session noise. */
export function netflixContentId(page: PageContext): string {
  const id = /\/watch\/(\d+)/.exec(page.location.href)?.[1];
  return id ? `netflix:${id}` : contentKey(page.location.href);
}

export const netflix: PlayerAdapter = {
  id: 'netflix',
  capabilities: { seekVia: 'playerApi', rate: true, contentIdFrom: 'url' },
  matches: (loc) => loc.hostname.endsWith('netflix.com'),
  attach: (video, page) =>
    createPlayer(video, page, { seek: seekViaPlayerApi, rate: true, contentId: netflixContentId }),
};
