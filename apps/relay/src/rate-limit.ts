/**
 * Per-address connection limiting for the /ws upgrade.
 *
 * A room code is the only credential this product has, so the code space itself
 * has to be defended, not just a room someone has already joined. The Durable
 * Object's own 25-per-second limit protects a joined room; this protects the
 * space of codes nobody has joined yet, by making a scan cost real time.
 *
 * Deliberately isolate-local: no binding, no storage, no request of its own, so
 * it costs nothing on the free plan. The tradeoff is honest and worth stating.
 * Workers run many isolates per colo and many colos worldwide, so a determined
 * attacker spread across them gets more attempts than the number below suggests.
 * That is fine. This is not the thing making guessing hard, the fifty bits in
 * the code are; this only stops the cheap, single-host scan.
 */

/**
 * Connections one address may open in a window. Set well above anything a
 * person produces (opening a room, reloading the tab, a flaky network firing
 * reconnect backoff for a while), because a false refusal breaks someone's
 * evening while a scan needs orders of magnitude more than this anyway.
 */
export const CONNECT_LIMIT = 120;
export const CONNECT_WINDOW_MS = 60_000;

export interface IpLimiter {
  allow(ip: string): boolean;
  /** Live bucket count. Exists so the eviction path can be asserted. */
  size(): number;
}

interface Bucket {
  count: number;
  reset: number;
}

export function createIpLimiter(
  limit = CONNECT_LIMIT,
  windowMs = CONNECT_WINDOW_MS,
  now: () => number = Date.now,
): IpLimiter {
  const buckets = new Map<string, Bucket>();

  // Sweeping on write keeps this to one data structure with no timer, which a
  // Worker isolate could not rely on surviving anyway.
  const sweep = (t: number) => {
    for (const [key, b] of buckets) if (t > b.reset) buckets.delete(key);
  };

  return {
    allow(ip: string): boolean {
      const t = now();
      const bucket = buckets.get(ip);

      if (!bucket || t > bucket.reset) {
        sweep(t);
        buckets.set(ip, { count: 1, reset: t + windowMs });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
    size: () => buckets.size,
  };
}
