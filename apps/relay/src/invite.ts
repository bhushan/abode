// The /j invite landing page.
//
// This is the only Abode surface a non-user ever sees. It is served by the same
// Worker as the websocket, so an invite needs no second host.
//
// Everything it needs rides in the URL fragment (#c=CODE&u=DEST), which the
// browser never transmits: the relay learns neither which room you are joining
// nor what you are about to watch. All parsing therefore happens client-side.
//
// Contract with the extension (apps/extension/src/content/main.ts):
//   - the content script sets data-wb-installed="1" on <html> at document_idle
//   - it intercepts clicks on #join-link and turns them into WB_JOIN_INVITE
// Renaming either of those silently breaks joining, so both are covered by tests.

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Abode · Join</title>
<meta name="robots" content="noindex,nofollow">
<style>
  :root{--ink:#17141B;--paper:#F5F1E9;--dim:#6C6675;--line:#E2DCD0}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);
       font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
  .card{width:100%;max-width:420px;text-align:center}
  svg.mk{width:64px;height:64px}
  h1{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:18px 0 6px}
  p{margin:0;color:var(--dim);font-size:14.5px}
  .dest{display:block;margin:22px 0;padding:13px 15px;border:1px solid var(--line);border-radius:12px;text-align:left;background:#fff}
  .lbl{display:block;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .host{display:block;font-weight:650;margin-top:3px}
  .url{display:block;font-size:12px;color:var(--dim);word-break:break-all;margin-top:2px}
  .btn{display:block;margin-top:18px;padding:13px 18px;border-radius:12px;background:var(--ink);color:var(--paper);
       text-decoration:none;font-weight:650;font-size:15px}
  .btn:focus-visible{outline:3px solid #8AA6C8;outline-offset:2px}
  .note{margin-top:12px;font-size:12.5px;color:var(--dim)}
  .hidden{display:none}
  @media (prefers-color-scheme:dark){
    :root{--ink:#F5F1E9;--paper:#17141B;--dim:#9A93A3;--line:#2C2733}
    .dest{background:#1F1B26}
    .btn{background:var(--ink);color:#17141B}
  }
</style>
</head>
<body>
<main class="card">
  <svg class="mk" viewBox="0 0 100 100" role="img" aria-label="Abode">
    <defs>
      <linearGradient id="abStem" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a73e8"/><stop offset="100%" stop-color="#d97706"/>
      </linearGradient>
    </defs>
    <g fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M52 14 L14 86" stroke="#1a73e8"/>
      <path d="M26 62 H52" stroke="#1a73e8"/>
      <path d="M52 14 C80 17 80 45 52 50 C86 53 86 83 52 86" stroke="#d97706"/>
      <path d="M52 14 V86" stroke="url(#abStem)"/>
    </g>
  </svg>

  <div id="bad" class="hidden">
    <h1>This invite is broken</h1>
    <p>Ask whoever sent it to share the link again.</p>
  </div>

  <div id="ok" class="hidden">
    <h1>You're invited to watch together</h1>
    <p>Abode keeps your playback in sync. You watch on your own account, in your own browser.</p>

    <span class="dest">
      <span class="lbl">Takes you to</span>
      <span id="dest-host" class="host"></span>
      <span id="dest-url" class="url"></span>
    </span>

    <div id="install-yes" class="hidden">
      <a id="join-link" class="btn" href="#">Join the room</a>
      <div class="note">Opens the video and puts you in the room. No account needed.</div>
    </div>

    <div id="install-no" class="hidden">
      <p class="note">You need the Abode extension to join. Install it, then reopen this link.</p>
      <a class="btn" id="retry" href="#">I've installed it</a>
    </div>
  </div>
</main>

<script>
(function () {
  var ROOM_CODE_RE = /^[A-Z]{2,8}-[A-Z0-9]{4,12}$/;

  // the fragment is never sent to the server, so this is the only place the
  // room code and destination exist
  function parseHash() {
    var h = location.hash.charAt(0) === '#' ? location.hash.slice(1) : location.hash;
    var out = { code: null, url: null };
    h.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i < 0) return;
      var k = part.slice(0, i);
      var v = decodeURIComponent(part.slice(i + 1));
      if (k === 'c') out.code = v.toUpperCase();
      else if (k === 'u') out.url = v;
    });
    return out;
  }

  // http(s) only: the extension navigates here, so a crafted u= must not be
  // able to smuggle in javascript: or data:
  function safeUrl(raw) {
    if (!raw) return null;
    try {
      var u = new URL(raw);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch (e) {
      return null;
    }
  }

  var show = function (id) { document.getElementById(id).classList.remove('hidden'); };

  var parsed = parseHash();
  var dest = safeUrl(parsed.url);
  if (!parsed.code || !ROOM_CODE_RE.test(parsed.code) || !dest) { show('bad'); return; }

  document.getElementById('dest-host').textContent = dest.host;
  document.getElementById('dest-url').textContent = dest.href;
  document.getElementById('join-link').setAttribute('href', dest.href);
  show('ok');

  // the content script stamps this at document_idle; poll briefly before
  // concluding the extension is missing
  var tries = 0;
  (function poll() {
    if (document.documentElement.dataset.wbInstalled === '1') { show('install-yes'); return; }
    if (++tries > 20) { show('install-no'); return; }
    setTimeout(poll, 100);
  })();

  document.getElementById('retry').addEventListener('click', function (e) {
    e.preventDefault();
    location.reload();
  });
})();
</script>
</body>
</html>`;

export function invitePage(): Response {
  return new Response(PAGE, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // every /j url is somebody's private invite
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
