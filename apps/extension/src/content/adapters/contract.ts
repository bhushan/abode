/**
 * What a platform has to provide before Abode can sync it.
 *
 * The inherited code kept platform behaviour in a boolean:
 *
 *     const IS_NETFLIX = location.hostname.endsWith('netflix.com');
 *     if (IS_NETFLIX) postNetflixSeek(c.time); else v.currentTime = c.time;
 *
 * That line is fine for two platforms and miserable for seven, because every
 * new service adds a branch to code that has nothing to do with any service.
 * Here a platform declares what it can do, and the sync engine never learns a
 * brand name.
 */

/** The bits of `location` an adapter is allowed to see. */
export interface PageContext {
  location: { href: string; hostname: string };
}

/**
 * How a seek reaches the player.
 *
 * `currentTime` is the ordinary HTML5 way. `playerApi` exists because Netflix
 * crashes when `video.currentTime` is written, so its seek has to go through the
 * page's own player. That is a fact about Netflix, not about seeking, which is
 * exactly why it lives in a capability rather than in an `if`.
 */
export type SeekVia = 'currentTime' | 'playerApi';

export type ContentIdFrom = 'url' | 'dom' | 'playerApi';

export interface AdapterCapabilities {
  readonly seekVia: SeekVia;
  /** Some players reject playbackRate outright, and asking anyway breaks them. */
  readonly rate: boolean;
  readonly contentIdFrom: ContentIdFrom;
}

/** A player this client is currently driving. */
export interface AttachedPlayer {
  /** Position in seconds, whatever units the platform uses natively. */
  currentTime(): number;
  paused(): boolean;
  rate(): number;
  seek(time: number): void;
  setRate(rate: number): void;
  play(): void;
  pause(): void;
  /** Stable across pause and play; changes when the title does. */
  contentId(): string;
  /** Called on any change the person watching made. */
  onChange(listener: () => void): void;
  /** Must leave the page exactly as it was found. */
  detach(): void;
}

export interface PlayerAdapter {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  matches(loc: { hostname: string }): boolean;
  attach(video: HTMLVideoElement, page: PageContext): AttachedPlayer;
}

/** Events that mean the person watching did something. */
export const CHANGE_EVENTS = ['play', 'pause', 'seeked', 'ratechange'] as const;

/**
 * The ordinary HTML5 player, which is every adapter's starting point.
 *
 * Netflix and Crunchyroll differ from it in three data points, not in three
 * implementations, so they configure this rather than reimplementing it. A new
 * platform that needs a fourth kind of difference should widen the options here
 * before it forks.
 */
export function createPlayer(
  video: HTMLVideoElement,
  page: PageContext,
  opts: {
    seek: (video: HTMLVideoElement, time: number) => void;
    rate: boolean;
    contentId: (page: PageContext) => string;
  },
): AttachedPlayer {
  let listener: (() => void) | null = null;
  const onEvent = () => listener?.();

  for (const ev of CHANGE_EVENTS) video.addEventListener(ev, onEvent);

  return {
    currentTime: () => video.currentTime,
    paused: () => video.paused,
    rate: () => video.playbackRate,
    seek: (time) => opts.seek(video, time),
    setRate: (rate) => {
      if (!opts.rate) return;
      video.playbackRate = rate;
    },
    play: () => void video.play()?.catch?.(() => undefined),
    pause: () => video.pause(),
    contentId: () => opts.contentId(page),
    onChange: (next) => {
      listener = next;
    },
    detach: () => {
      listener = null;
      for (const ev of CHANGE_EVENTS) video.removeEventListener(ev, onEvent);
    },
  };
}
