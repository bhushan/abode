/**
 * Access to sites Abode does not ship support for.
 *
 * The manifest names the services this build supports, because `<all_urls>` is
 * the biggest flag in a store review and, more to the point, it reads to the
 * person installing this as "every page you visit". So anything else is an
 * optional grant, asked for at the moment somebody tries to sync a site off the
 * list, revocable in Chrome's own settings without reinstalling.
 *
 * The html5 fallback adapter is what makes an unlisted site work once it is
 * granted; this is the plumbing that gets the content script onto the page.
 */
export const EXTRA_SCRIPT_ID = 'abode-extra-sites';

export interface RegisteredScript {
  id: string;
  matches: string[];
}

/** Everything chrome.scripting needs to put our content script on a page. */
export interface ScriptSpec extends RegisteredScript {
  js: string[];
  allFrames: boolean;
  /**
   * Covers about:blank and srcdoc frames, which is where several embedded
   * players mount. The static manifest spells this `match_about_blank`; the
   * runtime API only has this.
   */
  matchOriginAsFallback: boolean;
  runAt: 'document_idle';
}

/** The slice of `chrome` this needs, so it can be driven by a fake in tests. */
export interface SiteAccessApi {
  /** Every origin pattern currently permitted, declared and granted alike. */
  grantedOrigins(): Promise<string[]>;
  /** Origin patterns the manifest already covers with a static content script. */
  declaredOrigins(): string[];
  registered(): Promise<RegisteredScript[]>;
  register(script: ScriptSpec): Promise<void>;
  unregister(id: string): Promise<void>;
  /** The content script as the build actually emitted it. */
  declaredScript(): { js: string[]; allFrames: boolean; matchOriginAsFallback: boolean } | null;
}

/**
 * The origins somebody granted on top of what shipped.
 *
 * Sorted, so "did this change" is a string comparison rather than set algebra
 * every time the worker wakes.
 */
export function extraOrigins(granted: readonly string[], declared: readonly string[]): string[] {
  const shipped = new Set(declared);
  return [...new Set(granted)].filter((o) => !shipped.has(o)).sort();
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Bring the registration in line with the permissions, in either direction.
 *
 * Idempotent on purpose: it runs on install, on startup, on grant and on
 * revoke, and none of those can assume what the last one left behind. A service
 * worker is evicted constantly and remembers nothing between wakes.
 */
export async function syncSiteAccess(api: SiteAccessApi): Promise<string[]> {
  const wanted = extraOrigins(await api.grantedOrigins(), api.declaredOrigins());
  const current = (await api.registered()).find((s) => s.id === EXTRA_SCRIPT_ID);

  if (wanted.length === 0) {
    if (current) await api.unregister(EXTRA_SCRIPT_ID);
    return [];
  }

  if (current && same(current.matches, wanted)) return wanted;

  const declared = api.declaredScript();
  // Nothing to widen if the build declared no content script; a guess at the
  // emitted filename would only fail on the next build.
  if (!declared || declared.js.length === 0) return [];

  if (current) await api.unregister(EXTRA_SCRIPT_ID);
  await api.register({ id: EXTRA_SCRIPT_ID, matches: wanted, runAt: 'document_idle', ...declared });
  return wanted;
}

/** The real thing, reading the emitted script path out of the built manifest. */
export function chromeSiteAccess(): SiteAccessApi {
  // The build rewrites content_scripts to the files it actually emitted, so the
  // manifest is the only honest source for the path. The MAIN-world entry is the
  // Netflix player bridge, which is not the script being widened.
  const declared = () => {
    const scripts = chrome.runtime.getManifest().content_scripts ?? [];
    return (scripts as { js?: string[]; all_frames?: boolean; match_about_blank?: boolean; world?: string }[]).find(
      (c) => c.world !== 'MAIN',
    );
  };

  return {
    grantedOrigins: async () => (await chrome.permissions.getAll()).origins ?? [],
    declaredOrigins: () => (chrome.runtime.getManifest().host_permissions as string[] | undefined) ?? [],
    registered: async () =>
      (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({ id: s.id, matches: s.matches ?? [] })),
    register: (spec) =>
      chrome.scripting.registerContentScripts([
        {
          id: spec.id,
          matches: spec.matches,
          js: spec.js,
          allFrames: spec.allFrames,
          matchOriginAsFallback: spec.matchOriginAsFallback,
          runAt: spec.runAt,
        },
      ]),
    unregister: (id) => chrome.scripting.unregisterContentScripts({ ids: [id] }),
    declaredScript: () => {
      const entry = declared();
      if (!entry?.js) return null;
      return {
        js: entry.js,
        allFrames: entry.all_frames ?? false,
        matchOriginAsFallback: entry.match_about_blank ?? false,
      };
    },
  };
}
