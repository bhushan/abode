import { contentKey } from '@/lib/content';
import { createPlayer, type PageContext, type PlayerAdapter } from './contract';

/**
 * Crunchyroll.
 *
 * The interesting one, and the reason it ships in v1 alongside Netflix: its
 * player (Vilos) lives in a cross-origin iframe on `static.crunchyroll.com`, so
 * it exercises the frame bridge and the video election that Netflix's
 * same-frame player never touches. If the contract holds for both of these, it
 * is likely to hold for the rest.
 *
 * The player itself is an ordinary `<video>`: `currentTime` and `playbackRate`
 * both work. That was established by probing a real session, not assumed, which
 * is the first task for every adapter added after this one.
 */
export function crunchyrollContentId(page: PageContext): string {
  // `/watch/GRDQ2K3Z/episode-title` - the id is stable, the slug is not
  const id = /\/watch\/([A-Za-z0-9]+)/.exec(page.location.href)?.[1];
  return id ? `crunchyroll:${id}` : contentKey(page.location.href);
}

export const crunchyroll: PlayerAdapter = {
  id: 'crunchyroll',
  capabilities: { seekVia: 'currentTime', rate: true, contentIdFrom: 'url' },
  // static.crunchyroll.com is where Vilos is served from, and the player frame
  // has to resolve to this adapter too or the iframe would fall back to html5.
  matches: (loc) => loc.hostname.endsWith('crunchyroll.com'),
  attach: (video, page) =>
    createPlayer(video, page, {
      seek: (v, time) => {
        v.currentTime = time;
      },
      rate: true,
      contentId: crunchyrollContentId,
    }),
};
