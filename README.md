<p align="center">
  <img src="apps/landing/abode.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Abode</h1>

<p align="center">One room for two places.</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-e8a94f"></a>
  <img alt="Chrome MV3" src="https://img.shields.io/badge/chrome-MV3-6ea8f0">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/relay-Workers%20free%20tier-86c79e">
</p>

---

A browser extension that keeps two people on the same frame of the same film.
Play, pause and seek with the site's own player; everybody follows. Chat and
reactions sit beside the video, stamped with where you are in it rather than
what time it is where you are.

No accounts. No database. Runs entirely inside Cloudflare's free tier, and the
whole thing is one Worker.

**Netflix and Crunchyroll ship supported; anything else with an ordinary video
player works once you allow it.**

## Why this exists

Watch-party extensions are a graveyard. The popular open-source projects in the
category are not extensions and do not solve this; the ones that are extensions
are weekend projects. The best of them, [Watchbear][wb], had already solved the
expensive parts, and this is a fork of it. What it also had was a Google sign-in
gate on every surface and a NestJS + Postgres server that needed a paid box.

Postgres turned out to be used only by the auth module. Deleting auth deleted the
database, and what was left was a room gateway that ported almost directly onto a
Durable Object. See [NOTICE](NOTICE) for the full list of changes.

## What is actually hard here

Every product in this category shows you a chat window. The part that is hard is
staying locked to one frame, and almost none of them show you whether it is
working.

- **Drift correction, not scrubbing.** A gap under 0.15s is left alone. A gap over
  1.5s gets a seek. In between, playback rate bends by 0.05 until the gap closes,
  which nobody notices. The inherited code scrubbed at half a second, every time.
- **A shared clock.** Two machines disagree about what time it is, and every drift
  number is a difference between them. Clients estimate their distance from the
  relay's clock by round trip, keeping the fastest sample, because it is the one
  whose symmetry assumption is least wrong.
- **An echo guard.** Correcting a player makes it fire the same events a human
  does. Without suppressing that, every client chases every other client. This is
  the bug most implementations in this category ship.
- **The link is the credential.** With no accounts, the invite link is not a
  convenience on top of an auth system, it *is* the auth system, and it is built
  like one: 50 bits of entropy, and per-address connection limiting so the code
  space costs something to probe.

## The link

Starting a room produces one link:

```
https://<relay>/j#c=ABODE-K4M2XPQ7RN&u=<video url>
```

Both the room code and the destination live in the **fragment**, which browsers
never send to a server. The relay learns neither which room you are joining nor
what you are watching. That is a property of where the bytes go, not a promise in
a policy.

The same link resolves to the same room forever, because `idFromName(code)` maps a
code deterministically onto one Durable Object. Share it once; it works again next
weekend.

## Everyone brings their own account

Netflix and Crunchyroll are Widevine-protected, so no extension can read or relay
the video itself, and any that claims to is lying. Each person plays the film on
their own subscription and only control state crosses the wire. That is how
Teleparty works too, and it is also why this costs nothing to run.

## Architecture

```
apps/extension/          Chrome MV3, CRXJS + React
  src/content/           the content script, one module per reason to change
    adapters/            per-platform behaviour, declared as capabilities
    video/               which <video>, and the bridge to cross-origin frames
    sync/                drift engine, corrector, echo guard
    room/                the session, and the invite landing bridge
    ui/                  the in-page overlay, in a shadow root
  src/lib/               pure logic, unit tested under node
apps/relay/              Cloudflare Worker + Durable Object
  src/room.ts            RoomDO, websocket hibernation
  src/index.ts           /  health, /j invite page, /ws
apps/landing/            the public site
```

### Adding a platform

Platform behaviour is data, not a branch. An adapter says how it seeks, whether
it accepts a playback rate, and where its content id comes from; the sync engine
never learns a brand name.

```ts
export const netflix: PlayerAdapter = {
  id: 'netflix',
  // writing video.currentTime crashes the Netflix player, so its seek goes
  // through the page's own player API
  capabilities: { seekVia: 'playerApi', rate: true, contentIdFrom: 'url' },
  matches: (loc) => loc.hostname.endsWith('netflix.com'),
  attach: (video, page) => createPlayer(video, page, { seek: seekViaPlayerApi, ... }),
};
```

One conformance suite runs against every adapter, including that each routes a
seek through its declared mechanism **and no other**. Adding a platform is a
fixture in that suite plus whatever it takes to go green. Nothing merges with a
red or skipped case, and every adapter also gets run through the
[live smoke checklist](apps/extension/e2e/Readme.md) against the real site, because
fakes prove the contract and only the site proves the platform.

## Running it

Node 20+, pnpm 10+.

```bash
pnpm install

pnpm dev:relay          # wrangler dev on :8787
pnpm dev:ext            # CRXJS dev build
pnpm build:ext          # production build into apps/extension/dist
```

Then `chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension/dist`.

### Deploying your own relay

```bash
pnpm --filter @abode/relay exec wrangler deploy
```

Point the extension at it in the popup's server setting. There is no database to
provision, because there is nothing to store. Workers Free covers it: outgoing
websocket messages are free, incoming are billed 20:1, and a five-person two-hour
party is roughly 360 billed requests.

## Tests

```bash
pnpm test               # unit: extension under node, relay in real workerd
pnpm test:e2e           # two Chrome profiles, real extension, real Durable Object
pnpm lint && pnpm typecheck
```

The e2e suite is **headed only**. Extensions do not load correctly under
`headless: true` in this setup, and a headless run reports failures that are not
real.

Every workflow in `.github/workflows` is `workflow_dispatch` only. Nothing here
runs itself.

## Licence

Apache-2.0. A derivative work of [Watchbear][wb] by Halit Sever; see
[NOTICE](NOTICE) for what changed.

[wb]: https://github.com/halitsever/watchbear
