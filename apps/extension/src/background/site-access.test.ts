import { describe, expect, it, vi } from 'vitest';
import { EXTRA_SCRIPT_ID, extraOrigins, syncSiteAccess, type ScriptSpec, type SiteAccessApi } from './site-access';

const SHIPPED = ['*://*.netflix.com/*', '*://*.crunchyroll.com/*'];

function fake(over: Partial<{ granted: string[]; registered: { id: string; matches: string[] }[]; declared: boolean }> = {}) {
  const state = {
    granted: [...SHIPPED],
    registered: [] as { id: string; matches: string[] }[],
    declared: true,
    ...over,
  };
  const register = vi.fn((s: ScriptSpec) => {
    state.registered.push({ id: s.id, matches: s.matches });
    return Promise.resolve();
  });
  const unregister = vi.fn((id: string) => {
    state.registered = state.registered.filter((r) => r.id !== id);
    return Promise.resolve();
  });

  const api: SiteAccessApi = {
    grantedOrigins: () => Promise.resolve([...state.granted]),
    declaredOrigins: () => SHIPPED,
    registered: () => Promise.resolve(state.registered.map((r) => ({ ...r }))),
    register,
    unregister,
    declaredScript: () =>
      state.declared ? { js: ['assets/content-abc123.js'], allFrames: true, matchOriginAsFallback: true } : null,
  };
  return { api, state, register, unregister };
}

describe('extraOrigins', () => {
  it('is empty when nothing beyond the shipped platforms was granted', () => {
    expect(extraOrigins(SHIPPED, SHIPPED)).toEqual([]);
  });

  it('picks out what somebody added', () => {
    expect(extraOrigins([...SHIPPED, 'https://hotstar.com/*'], SHIPPED)).toEqual(['https://hotstar.com/*']);
  });

  it('is stable and deduped, so "did this change" is a string comparison', () => {
    const a = extraOrigins(['https://b.test/*', 'https://a.test/*', 'https://a.test/*'], []);
    const b = extraOrigins(['https://a.test/*', 'https://b.test/*'], []);
    expect(a).toEqual(b);
  });
});

/**
 * The manifest names the platforms this build supports, so anything else needs
 * a grant given at the moment it is needed. This is the plumbing on both sides
 * of that grant, and it has to survive a worker that remembers nothing.
 */
describe('site access', () => {
  it('registers nothing while only the shipped platforms are permitted', async () => {
    const { api, register } = fake();
    await expect(syncSiteAccess(api)).resolves.toEqual([]);
    expect(register).not.toHaveBeenCalled();
  });

  it('puts the content script on a site somebody just allowed', async () => {
    const { api, register } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'] });
    await expect(syncSiteAccess(api)).resolves.toEqual(['https://hotstar.com/*']);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: EXTRA_SCRIPT_ID, matches: ['https://hotstar.com/*'] }),
    );
  });

  it('registers the file the build actually emitted, not a guess at its name', async () => {
    const { api, register } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'] });
    await syncSiteAccess(api);
    expect(register.mock.calls[0][0]).toMatchObject({ js: ['assets/content-abc123.js'] });
  });

  it('carries the frame settings across, or embedded players would stop syncing', async () => {
    const { api, register } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'] });
    await syncSiteAccess(api);
    expect(register.mock.calls[0][0]).toMatchObject({ allFrames: true, matchOriginAsFallback: true });
  });

  it('is safe to run again, since the worker wakes and re-runs it constantly', async () => {
    const { api, register } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'] });
    await syncSiteAccess(api);
    await syncSiteAccess(api);
    await syncSiteAccess(api);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('widens the registration when a second site is allowed', async () => {
    const { api, state, register } = fake({ granted: [...SHIPPED, 'https://a.test/*'] });
    await syncSiteAccess(api);
    state.granted.push('https://b.test/*');

    await expect(syncSiteAccess(api)).resolves.toEqual(['https://a.test/*', 'https://b.test/*']);
    expect(register).toHaveBeenCalledTimes(2);
    expect(state.registered).toHaveLength(1);
  });

  it('takes the script back off when the grant is revoked', async () => {
    const { api, state, unregister } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'] });
    await syncSiteAccess(api);
    state.granted = [...SHIPPED];

    await expect(syncSiteAccess(api)).resolves.toEqual([]);
    expect(unregister).toHaveBeenCalledWith(EXTRA_SCRIPT_ID);
    expect(state.registered).toEqual([]);
  });

  it('does not unregister something it never registered', async () => {
    const { api, unregister } = fake();
    await syncSiteAccess(api);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('gives up quietly when the build declared no content script to widen', async () => {
    const { api, register } = fake({ granted: [...SHIPPED, 'https://hotstar.com/*'], declared: false });
    await expect(syncSiteAccess(api)).resolves.toEqual([]);
    expect(register).not.toHaveBeenCalled();
  });

  it('leaves registrations it does not own alone', async () => {
    const { api, state } = fake({ registered: [{ id: 'something-else', matches: ['https://x.test/*'] }] });
    await syncSiteAccess(api);
    expect(state.registered).toEqual([{ id: 'something-else', matches: ['https://x.test/*'] }]);
  });
});
