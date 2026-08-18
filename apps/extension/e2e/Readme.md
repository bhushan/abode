# End-to-end and live checks

Three layers, in order of how much they prove.

## Playwright (`pnpm test:e2e`)

Two isolated Chrome profiles load the built extension, join the same room, and
drive a real video against a real Durable Object in workerd. This is where the
things a fake cannot reach are proved: that a page is allowed to frame the
panel, that a cross-origin player is reachable, that the host lock actually
stops a guest's seek and puts them back.

It builds `dist-test` first, then starts a static video server on :5190 and
`wrangler dev` on :3100.

**Headed only.** Extensions do not load correctly under `headless: true` in this
setup; a headless run reports failures that are not real.

## Two browsers by hand (`pnpm e2e:manual`)

Opens two windows side by side against the local relay, for the checks that are
about how something looks rather than whether it happened: whether a correction
is visible, whether the panel is comfortable in a dark room, whether fullscreen
behaves. Needs `pnpm dev:relay` running.

## Live smoke checklist (per platform, by hand)

Fakes prove the contract. Only the real site proves the platform, so every
adapter gets run through this once against a live session, and again whenever
that platform starts misbehaving. Two accounts, two machines or two profiles.

| | Netflix | Crunchyroll | plain HTML5 |
| --- | --- | --- | --- |
| Room starts from the popup, invite link opens on the other side | | | |
| Play propagates | | | |
| Pause propagates | | | |
| Seek forward propagates | | | |
| Seek back propagates | | | |
| A throttled client closes the gap without a visible scrub | | | |
| Episode change offers "Catch up" on the other side | | n/a | n/a |
| Fullscreen: reactions and the panel still paint | | | |
| Host lock stops a guest and snaps them back | | | |
| Chat and reactions both ways | | | |

Notes worth keeping when something fails:

- **Netflix** proves the player-API seek path. Writing `video.currentTime`
  crashes its player, so a regression there looks like the tab dying, not like a
  sync bug.
- **Crunchyroll** proves the cross-frame path: its Vilos player is served from
  `static.crunchyroll.com` inside an iframe, and it can change independently of
  the main site. Re-probe its capabilities before assuming a break is ours.
- **Plain HTML5** is the fallback adapter, and the only one that needs the
  optional site permission granted first.

## Link checks (before the link travels)

The invite link is the only credential in this product, and its entire design
depends on the fragment surviving a paste. Some messengers rewrite links.

- [ ] Paste a link through WhatsApp, Telegram, iMessage and Slack, and confirm
      the `#c=...&u=...` part arrives intact on the other side.
- [ ] Reopen a link from a previous session and confirm it resolves to the same
      room.
- [ ] Confirm a link with `u=javascript:...` is refused rather than followed.
- [ ] Confirm the relay's logs contain neither a room code nor a watched URL.

If a messenger does strip fragments, the fix is **not** to move the code into a
query parameter: that hands the relay the room code and the watched URL, which
is exactly the property the current design exists to keep. The fallback is a
short server-side redirect token carrying no meaning, and only if a real
messenger forces it.
