import { contentKey } from '@/lib/content';
import { createPlayer, type PageContext, type PlayerAdapter } from './contract';

/**
 * YouTube.
 *
 * The easy platform, and the one most people will actually try first: the player
 * is an ordinary `<video>`, so `currentTime` and `playbackRate` both work and
 * there is no page API to go through. It was probed on a real session before
 * these capabilities were written down, which is the rule for every adapter.
 *
 * What is not easy is identity. The same video is reachable as a watch page, a
 * share link, an embed, a short and a livestream replay, and a room where two
 * people hold different ids for one video never syncs. So the id is the video
 * id and nothing else: no `t=` (that is where one viewer happens to be), no
 * `list=` (that is which queue they came in through).
 *
 * Ads are the honest caveat. An ad is a different `<video>` on one person's
 * screen and not on another's, so a room can drift by the length of the ad
 * break and settle again once it ends. Nothing an extension can do about that
 * from outside the player.
 */

/** `/embed/ID`, `/shorts/ID`, `/live/ID`, `/v/ID`: everything but the watch page. */
const PLAYER_PATHS = new Set(['embed', 'shorts', 'live', 'v']);

const HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

function videoId(href: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return undefined;
  }

  const v = u.searchParams.get('v');
  if (v) return v;

  const [first, second] = u.pathname.split('/').filter(Boolean);
  // youtu.be puts the id straight in the path, with nothing to name it
  if (u.hostname.endsWith('youtu.be')) return first;
  return second && PLAYER_PATHS.has(first) ? second : undefined;
}

export function youtubeContentId(page: PageContext): string {
  const id = videoId(page.location.href);
  return id ? `youtube:${id}` : contentKey(page.location.href);
}

export const youtube: PlayerAdapter = {
  id: 'youtube',
  capabilities: { seekVia: 'currentTime', rate: true, contentIdFrom: 'url' },
  // youtube-nocookie.com serves the privacy-preserving embed, and an embed frame
  // has to resolve here too or it would fall back to html5 and lose the id
  matches: (loc) => HOSTS.some((h) => loc.hostname.endsWith(h)),
  attach: (video, page) =>
    createPlayer(video, page, {
      seek: (v, time) => {
        v.currentTime = time;
      },
      rate: true,
      contentId: youtubeContentId,
    }),
};
