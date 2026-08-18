import { describe, expect, it } from 'vitest';
import { CONNECT_LIMIT, CONNECT_WINDOW_MS, createIpLimiter } from './rate-limit';

/**
 * There are no accounts in this product, so a room code is the only thing
 * standing between a stranger and someone's evening. Fifty bits makes guessing
 * hopeless in principle; this makes *probing* expensive in practice, which is
 * the part an attacker actually has to do.
 */
describe('ip connection limiter', () => {
  const at = (t: number) => () => t;

  it('lets an ordinary joiner through', () => {
    const limiter = createIpLimiter(CONNECT_LIMIT, CONNECT_WINDOW_MS, at(0));
    for (let i = 0; i < CONNECT_LIMIT; i++) expect(limiter.allow('1.1.1.1')).toBe(true);
  });

  it('refuses the one past the limit', () => {
    const limiter = createIpLimiter(3, 60_000, at(0));
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(false);
  });

  it('counts each address on its own, so one prober cannot lock everyone out', () => {
    const limiter = createIpLimiter(1, 60_000, at(0));
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(false);
    expect(limiter.allow('2.2.2.2')).toBe(true);
  });

  it('forgives once the window has passed', () => {
    let now = 0;
    const limiter = createIpLimiter(2, 1_000, () => now);
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(true);
    expect(limiter.allow('1.1.1.1')).toBe(false);
    now = 1_001;
    expect(limiter.allow('1.1.1.1')).toBe(true);
  });

  // A limiter that remembers every address it has ever seen is itself the
  // cheapest way to exhaust the isolate, so expired buckets have to go.
  it('does not grow without bound as addresses come and go', () => {
    let now = 0;
    const limiter = createIpLimiter(5, 1_000, () => now);
    for (let i = 0; i < 500; i++) {
      now = i * 10;
      limiter.allow(`10.0.0.${i}`);
    }
    now = 100_000;
    limiter.allow('10.1.1.1');
    expect(limiter.size()).toBeLessThan(10);
  });

  // A request with no CF-Connecting-IP is either a local dev run or something
  // pretending; either way it must not share one bucket with the whole world.
  it('treats a missing address as its own bucket rather than a shared one', () => {
    const limiter = createIpLimiter(1, 60_000, at(0));
    expect(limiter.allow('')).toBe(true);
    expect(limiter.allow('')).toBe(false);
    expect(limiter.allow('1.1.1.1')).toBe(true);
  });
});
