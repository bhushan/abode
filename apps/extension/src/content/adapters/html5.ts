import { contentKey } from '@/lib/content';
import { createPlayer, type PlayerAdapter } from './contract';

/**
 * The terminal fallback: any page with a `<video>` in it.
 *
 * This is what makes "and lots of other sites" partly true for free, and it is
 * also the e2e target, so it is the adapter that gets exercised hardest.
 */
export const html5: PlayerAdapter = {
  id: 'html5',
  capabilities: { seekVia: 'currentTime', rate: true, contentIdFrom: 'url' },
  // Terminal: the registry only reaches this once nothing more specific claimed
  // the page, so it says yes to everything.
  matches: () => true,
  attach: (video, page) =>
    createPlayer(video, page, {
      seek: (v, time) => {
        v.currentTime = time;
      },
      rate: true,
      contentId: (p) => contentKey(p.location.href),
    }),
};
