import type { PlayerAdapter } from './contract';
import { crunchyroll } from './crunchyroll';
import { html5 } from './html5';
import { netflix } from './netflix';

/**
 * Which adapter drives this page.
 *
 * Ordered most-specific first, and `html5` is terminal, so an unknown site
 * degrades to plain HTML5 playback rather than failing. Adding a platform is
 * one import, one line here, and one fixture in the conformance suite.
 */
export const ADAPTERS: readonly PlayerAdapter[] = [netflix, crunchyroll];

export const FALLBACK: PlayerAdapter = html5;

/** Every adapter, fallback last. The conformance suite runs against this. */
export const ALL_ADAPTERS: readonly PlayerAdapter[] = [...ADAPTERS, FALLBACK];

export function adapterFor(loc: { hostname: string }): PlayerAdapter {
  return ADAPTERS.find((a) => a.matches(loc)) ?? FALLBACK;
}
