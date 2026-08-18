import { defineManifest } from '@crxjs/vite-plugin';
import { loadEnv } from 'vite';

const icons = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

/**
 * The services Abode ships support for.
 *
 * Naming them is the point. `<all_urls>` is the single biggest flag in a store
 * review, and it reads to a person installing this as "every page you visit".
 * A named list reads as what it is, and each new platform adds one line.
 */
const PLATFORMS = [
  '*://*.netflix.com/*',
  '*://*.crunchyroll.com/*',
  '*://*.youtube.com/*',
  // the privacy-preserving embed host, so a player framed from it is still ours
  '*://*.youtube-nocookie.com/*',
];

/** Loopback, for the e2e suite and for anyone running their own relay. */
const LOCAL = ['http://localhost/*', 'http://127.0.0.1/*'];

/**
 * A match pattern for the host serving a URL.
 *
 * Deliberately not `url.origin`: a match pattern's host may not carry a port,
 * and Chrome refuses the whole manifest over one malformed pattern rather than
 * skipping it. The local relay runs on :3100, so this is load-bearing.
 */
const hostPattern = (url: string, fallback: string): string => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return fallback;
  }
};

export default defineManifest(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // The invite landing page needs the content script on it to turn a click into
  // a join, and it is served by whichever relay this build points at.
  const invite = hostPattern(env.VITE_INVITE_BASE_URL ?? '', 'http://localhost/*');
  const sites = [...new Set([...PLATFORMS, invite, ...(mode === 'production' ? [] : LOCAL)])];

  return {
    manifest_version: 3,
    name: 'Abode: Watch Together in Sync',
    short_name: 'Abode',
    description: 'One room for two places. Watch anything together, perfectly in sync, with chat and reactions.',
    version: '0.6.0',
    icons,
    action: {
      default_popup: 'src/popup/index.html',
      default_title: 'Abode',
      default_icon: icons,
    },
    side_panel: {
      default_path: 'src/sidepanel/index.html',
    },
    background: {
      service_worker: 'src/background/service-worker.ts',
      type: 'module',
    },
    content_scripts: [
      {
        matches: sites,
        js: ['src/content/index.ts'],
        run_at: 'document_idle',
        // The real <video> often lives in a cross-origin iframe (Crunchyroll's
        // Vilos player, most embedded players), so this runs in every frame;
        // about:blank covers players that mount into a srcdoc or blank frame.
        all_frames: true,
        match_about_blank: true,
      },
      {
        // Netflix crashes when we write video.currentTime, so on Netflix the
        // seek goes through its own player API, which lives on the page window.
        // This entry runs in the MAIN world; the isolated content script bridges
        // the seek over postMessage.
        matches: ['*://*.netflix.com/*'],
        js: ['src/content/netflix-main.ts'],
        run_at: 'document_idle',
        world: 'MAIN',
      },
    ],
    // The in-page panel frames this on browsers without a side panel API, and a
    // web page may only frame a resource that is declared web-accessible.
    web_accessible_resources: [
      {
        resources: ['src/sidepanel/index.html', 'assets/*'],
        matches: ['<all_urls>'],
      },
    ],
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: sites,
    // Asked for at the moment somebody tries to sync a site that is not on the
    // list, and never before. The html5 fallback adapter is what makes that
    // work; this is the permission it needs.
    optional_host_permissions: ['<all_urls>'],
  };
});
