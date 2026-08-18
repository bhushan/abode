/**
 * Two real browsers, side by side, for the checks a fake cannot make.
 *
 * The Playwright suite proves the wiring. This is for looking at the thing:
 * whether a correction is visible, whether the panel reads well in a dark room,
 * whether fullscreen behaves. It expects the local relay (`pnpm dev:relay`).
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(dir, '../dist');
const VIDEO_URL = 'http://127.0.0.1:5190/video.html';
const RELAY_URL = 'http://localhost:8787';

const children = [];
function run(cmd, args) {
  const proc = spawn(cmd, args, { stdio: 'inherit' });
  children.push(proc);
  return proc;
}

async function relayUp() {
  try {
    const res = await fetch(RELAY_URL);
    return res.ok && (await res.json()).name === 'abode-relay';
  } catch {
    return false;
  }
}

async function launch(x) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      `--window-position=${x},0`,
      '--window-size=760,820',
    ],
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto(VIDEO_URL);
  return ctx;
}

run('node', [path.join(dir, 'serve.mjs')]);

if (!(await relayUp())) {
  console.log(`\n  ⚠  no relay on ${RELAY_URL}. Run "pnpm dev:relay" in another terminal.\n`);
}

console.log('launching two browsers...');
const contexts = [await launch(0), await launch(780)];

console.log(`
  Ready. Two browsers on the test video, talking to ${RELAY_URL}.
    1. Browser A: click the Abode icon, then "Start watching together". Copy the link.
    2. Browser B: open that link in the address bar and follow it.
    3. Play, pause and seek in either window; the other should follow.
    4. Throttle B's network in DevTools and watch it close the gap without scrubbing.
  Ctrl+C here closes everything.
`);

const keepAlive = setInterval(() => {}, 1 << 30);

function cleanup() {
  clearInterval(keepAlive);
  for (const c of contexts) c.close().catch(() => {});
  for (const proc of children) proc.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
