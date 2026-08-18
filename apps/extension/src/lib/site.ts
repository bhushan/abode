/**
 * Whether Abode is allowed to run on the page in front of you.
 *
 * The manifest names the platforms this build ships support for, so everything
 * else needs a grant. Asking for the one site somebody is looking at is a very
 * different question from asking for every site they will ever visit, and it is
 * the only one worth putting in front of them.
 */

/** The narrowest match pattern covering this page. Null for anything unaskable. */
export function originPatternOf(url: string): string | null {
  try {
    const u = new URL(url);
    // chrome:// and extension pages cannot be granted, and asking would only
    // produce a dialog that fails.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** The bit of a URL worth showing a person, without the scheme noise. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function canRunOn(url: string): Promise<boolean> {
  const origins = originPatternOf(url);
  if (!origins) return false;
  return chrome.permissions.contains({ origins: [origins] }).catch(() => false);
}

/** Must be called straight from a click: Chrome refuses this outside a gesture. */
export async function requestAccessTo(url: string): Promise<boolean> {
  const origins = originPatternOf(url);
  if (!origins) return false;
  return chrome.permissions.request({ origins: [origins] }).catch(() => false);
}
