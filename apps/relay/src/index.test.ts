import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { CONNECT_LIMIT } from './rate-limit';

const CODE = 'ABODE-TEST01';

const upgrade = (code: string, ip: string) =>
  SELF.fetch(`https://relay.test/ws?code=${code}`, {
    headers: { Upgrade: 'websocket', 'CF-Connecting-IP': ip },
  });

describe('routes', () => {
  // pingServer() in the extension checks this exact string, so a user who points
  // at the wrong host is told rather than left staring at a dead room.
  it('answers the health probe with the name the extension looks for', async () => {
    const res = await SELF.fetch('https://relay.test/');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ name: 'abode-relay' });
  });

  it('serves the invite landing page', async () => {
    const res = await SELF.fetch('https://relay.test/j');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('turns away an unknown path', async () => {
    expect((await SELF.fetch('https://relay.test/nope')).status).toBe(404);
  });
});

describe('/ws guards', () => {
  it('refuses a malformed code without spending a Durable Object lookup', async () => {
    expect((await upgrade('nope', '9.9.9.1')).status).toBe(400);
  });

  it('refuses a plain GET that is not a websocket upgrade', async () => {
    const res = await SELF.fetch(`https://relay.test/ws?code=${CODE}`);
    expect(res.status).toBe(426);
  });

  /**
   * The link is the only credential here, so the code space itself has to cost
   * something to probe. Fifty bits makes guessing hopeless; this makes scanning
   * slow, which is the part an attacker actually performs.
   */
  it('cuts off an address that is scanning the code space', async () => {
    const ip = '9.9.9.2';
    for (let i = 0; i < CONNECT_LIMIT; i++) {
      const res = await upgrade(CODE, ip);
      expect(res.status).toBe(101);
      res.webSocket?.accept();
      res.webSocket?.close();
    }
    expect((await upgrade(CODE, ip)).status).toBe(429);
  });

  it('leaves everyone else alone while one address is cut off', async () => {
    const ip = '9.9.9.3';
    for (let i = 0; i <= CONNECT_LIMIT; i++) {
      const res = await upgrade(CODE, ip);
      res.webSocket?.accept();
      res.webSocket?.close();
    }
    expect((await upgrade(CODE, ip)).status).toBe(429);

    const other = await upgrade(CODE, '9.9.9.4');
    expect(other.status).toBe(101);
    other.webSocket?.accept();
    other.webSocket?.close();
  });
});
