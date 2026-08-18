import { contentKey } from './content';
import type { VideoContentInfo } from './socket';

/**
 * Whether to offer to follow the room to what it is watching now.
 *
 * The relay already broadcasts where the room went when the anchor changes
 * episode; nothing was doing anything with it, so everyone else quietly stayed
 * on the last one.
 *
 * This is an offer rather than a navigation on purpose. Moving somebody's tab
 * out from under them loses their place, and two people are sometimes on
 * different pages deliberately.
 */
export function shouldOfferFollow(content: VideoContentInfo | null, currentUrl: string | null): boolean {
  if (!content || !currentUrl) return false;
  if (!isFollowable(content.url)) return false;
  // contentKey, not the raw url: a timestamp or a tracking parameter is not a
  // different episode, and prompting over one would be noise all evening.
  return contentKey(content.url) !== contentKey(currentUrl);
}

/** Only ever navigate somewhere a browser would go on its own. */
export function isFollowable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
