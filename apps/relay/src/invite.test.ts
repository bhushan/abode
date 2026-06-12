import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /j — the invite landing page', () => {
  it('serves html', async () => {
    const res = await SELF.fetch('https://relay.test/j');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('carries the #join-link the content script hooks', async () => {
    const html = await (await SELF.fetch('https://relay.test/j')).text();
    // apps/extension/src/content/main.ts intercepts clicks on this id and turns
    // them into a WB_JOIN_INVITE message; renaming it silently breaks joining.
    expect(html).toContain('id="join-link"');
  });

  it('reads the room code from the fragment, never from the server', async () => {
    const html = await (await SELF.fetch('https://relay.test/j')).text();
    // the page must derive everything client-side from location.hash
    expect(html).toContain('location.hash');
    // and it must be the same bytes whatever the caller appends, since a
    // fragment is never transmitted
    const other = await (await SELF.fetch('https://relay.test/j?anything=1')).text();
    expect(other).toBe(html);
  });

  it('refuses a destination that is not http(s)', async () => {
    const html = await (await SELF.fetch('https://relay.test/j')).text();
    // guards a crafted u= pointing at javascript:/data:
    expect(html).toMatch(/protocol\s*===\s*["']http:["']/);
  });

  it('is not indexable, since every url is somebody private invite', async () => {
    const res = await SELF.fetch('https://relay.test/j');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
});
