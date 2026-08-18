import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_EVENTS, type PageContext, type PlayerAdapter } from './contract';
import { ALL_ADAPTERS, adapterFor, FALLBACK } from './registry';
import { crunchyroll } from './crunchyroll';
import { html5 } from './html5';
import { netflix } from './netflix';
import { youtube } from './youtube';

/**
 * One suite, every adapter.
 *
 * This is the thing that makes platform number seven cheap. Adding a service is
 * a fixture below plus whatever it takes to go green, and nothing merges with a
 * red or skipped case here. Fakes prove the contract; only the real site proves
 * the platform, which is what the live smoke checklist in e2e/Readme.md is for.
 */

interface Fixture {
  adapter: PlayerAdapter;
  hostname: string;
  href: string;
  contentId: string;
  /** A host this adapter must NOT claim, so nobody widens a match by accident. */
  foreign: string;
}

const FIXTURES: Fixture[] = [
  {
    adapter: netflix,
    hostname: 'www.netflix.com',
    href: 'https://www.netflix.com/watch/81234567?trackId=999&tctx=x',
    contentId: 'netflix:81234567',
    foreign: 'www.crunchyroll.com',
  },
  {
    adapter: crunchyroll,
    hostname: 'www.crunchyroll.com',
    href: 'https://www.crunchyroll.com/watch/GRDQ2K3Z/the-first-episode',
    contentId: 'crunchyroll:GRDQ2K3Z',
    foreign: 'www.netflix.com',
  },
  {
    adapter: youtube,
    hostname: 'www.youtube.com',
    // t= is where this viewer happens to be, not what everyone is watching
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123',
    contentId: 'youtube:dQw4w9WgXcQ',
    foreign: 'www.netflix.com',
  },
  {
    adapter: html5,
    hostname: 'example.test',
    href: 'https://example.test/clip.html?t=42',
    // t= is a timestamp, and two people at different points in the same clip are
    // still watching the same thing
    contentId: 'example.test/clip.html',
    foreign: 'anything.test',
  },
];

// every adapter in the registry needs a fixture, or the suite silently shrinks
it('covers every adapter the registry ships', () => {
  expect(FIXTURES.map((f) => f.adapter.id).sort()).toEqual(ALL_ADAPTERS.map((a) => a.id).sort());
});

/** Enough of an HTMLVideoElement to drive a player, and a ledger of its listeners. */
class FakeVideo {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  readonly listeners = new Map<string, Set<() => void>>();
  playCalls = 0;
  pauseCalls = 0;

  addEventListener(ev: string, fn: () => void) {
    (this.listeners.get(ev) ?? this.listeners.set(ev, new Set()).get(ev)!).add(fn);
  }
  removeEventListener(ev: string, fn: () => void) {
    this.listeners.get(ev)?.delete(fn);
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
  /** Fire an event the way a player does when the person watching acts. */
  emit(ev: string) {
    for (const fn of this.listeners.get(ev) ?? []) fn();
  }
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
  get el(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

let posted: unknown[] = [];

beforeEach(() => {
  posted = [];
  // Netflix's seek leaves the isolated world by postMessage; nothing else may.
  vi.stubGlobal('window', { postMessage: (m: unknown) => posted.push(m) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(FIXTURES)('$adapter.id conformance', (fx) => {
  const page = (href = fx.href): PageContext => ({
    location: { href, hostname: new URL(href).hostname },
  });

  it('claims its own hosts', () => {
    expect(fx.adapter.matches({ hostname: fx.hostname })).toBe(true);
  });

  it('reports position in seconds, whatever the platform counts in', () => {
    const v = new FakeVideo();
    v.currentTime = 61.5;
    const player = fx.adapter.attach(v.el, page());
    expect(player.currentTime()).toBe(61.5);
    player.detach();
  });

  it('reports paused and rate faithfully', () => {
    const v = new FakeVideo();
    v.paused = false;
    v.playbackRate = 1.25;
    const player = fx.adapter.attach(v.el, page());
    expect(player.paused()).toBe(false);
    expect(player.rate()).toBe(1.25);
    player.detach();
  });

  /**
   * The load-bearing case. Netflix crashes when currentTime is written, so an
   * adapter routing a seek the wrong way is not a style problem, it is a broken
   * player. Each adapter is checked against its declared mechanism and against
   * the one it did not declare.
   */
  it('routes a seek through its declared mechanism and no other', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page());
    player.seek(90);

    if (fx.adapter.capabilities.seekVia === 'currentTime') {
      expect(v.currentTime).toBe(90);
      expect(posted).toHaveLength(0);
    } else {
      expect(v.currentTime).toBe(0);
      expect(posted).toEqual([expect.objectContaining({ kind: 'seek', time: 90 })]);
    }
    player.detach();
  });

  it('honours its own rate capability', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page());
    player.setRate(1.5);
    expect(v.playbackRate).toBe(fx.adapter.capabilities.rate ? 1.5 : 1);
    player.detach();
  });

  it('plays and pauses', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page());
    player.play();
    expect(v.paused).toBe(false);
    player.pause();
    expect(v.paused).toBe(true);
    player.detach();
  });

  it('tells the caller when the person watching does something', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page());
    const heard = vi.fn();
    player.onChange(heard);

    for (const ev of CHANGE_EVENTS) v.emit(ev);
    expect(heard).toHaveBeenCalledTimes(CHANGE_EVENTS.length);
    player.detach();
  });

  it('leaves the page exactly as it found it', () => {
    const v = new FakeVideo();
    expect(v.listenerCount).toBe(0);

    const player = fx.adapter.attach(v.el, page());
    expect(v.listenerCount).toBeGreaterThan(0);

    const heard = vi.fn();
    player.onChange(heard);
    player.detach();

    expect(v.listenerCount).toBe(0);
    for (const ev of CHANGE_EVENTS) v.emit(ev);
    expect(heard).not.toHaveBeenCalled();
  });

  it('reads a content id that survives pausing and playing', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page());

    expect(player.contentId()).toBe(fx.contentId);
    player.play();
    player.pause();
    player.seek(400);
    expect(player.contentId()).toBe(fx.contentId);
    player.detach();
  });

  it('falls back to a usable id rather than throwing on a page it did not expect', () => {
    const v = new FakeVideo();
    const player = fx.adapter.attach(v.el, page(`https://${fx.hostname}/browse`));
    expect(typeof player.contentId()).toBe('string');
    expect(player.contentId().length).toBeGreaterThan(0);
    player.detach();
  });
});

describe('registry', () => {
  it('hands each platform its own adapter', () => {
    expect(adapterFor({ hostname: 'www.netflix.com' }).id).toBe('netflix');
    expect(adapterFor({ hostname: 'static.crunchyroll.com' }).id).toBe('crunchyroll');
  });

  it('degrades an unknown site to plain html5 rather than failing it', () => {
    expect(adapterFor({ hostname: 'some.video.site' }).id).toBe(FALLBACK.id);
    expect(adapterFor({ hostname: '' }).id).toBe(FALLBACK.id);
  });

  it('does not let a specific adapter swallow another platform', () => {
    for (const fx of FIXTURES) {
      if (fx.adapter === FALLBACK) continue;
      expect(fx.adapter.matches({ hostname: fx.foreign })).toBe(false);
    }
  });

  it('never claims a lookalike host', () => {
    // endsWith on a bare domain would match "notnetflix.com"; it must not
    expect(adapterFor({ hostname: 'evil-netflix.com.attacker.test' }).id).toBe(FALLBACK.id);
  });
});

/**
 * YouTube arrives at the same video down four different URLs, and a room where
 * two people hold different ids for one video is a room that never syncs.
 */
describe('youtube content ids', () => {
  const id = (href: string) => youtube.attach(new FakeVideo() as unknown as HTMLVideoElement, { location: { href, hostname: new URL(href).hostname } }).contentId();

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watch page'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s', 'someone else deep in it'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'mobile'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'share link'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'embedded elsewhere'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'the no-cookie embed host'],
  ])('reads one id out of %s (%s)', (href) => {
    expect(id(href)).toBe('youtube:dQw4w9WgXcQ');
  });

  it('keeps shorts and live apart from each other', () => {
    expect(id('https://www.youtube.com/shorts/abcdefghijk')).toBe('youtube:abcdefghijk');
    expect(id('https://www.youtube.com/live/zyxwvutsrqp')).toBe('youtube:zyxwvutsrqp');
  });

  it('falls back to the url when there is no video id to find', () => {
    // contentKey's own normalising, www and all: a page with no video is still
    // the same page for everyone looking at it
    expect(id('https://www.youtube.com/feed/subscriptions')).toBe('youtube.com/feed/subscriptions');
  });

  it('claims the hosts youtube actually serves players from', () => {
    for (const hostname of ['www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']) {
      expect(adapterFor({ hostname }).id).toBe('youtube');
    }
  });
});
