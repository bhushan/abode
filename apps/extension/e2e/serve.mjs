import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'static');
const cache = join(here, '.cache');
const clip = join(cache, 'clip.webm');
const PORT = 5190;
const TYPES = { '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm', '.js': 'text/javascript' };

const SOURCE = 'https://media.w3.org/2010/05/sintel/trailer.webm';

/**
 * Keep the clip on disk.
 *
 * It used to be loaded straight off the network by the page, and if it was not
 * playable within a few seconds the page swapped in a canvas stream so the
 * harness could still run offline. A canvas stream cannot seek: currentTime sits
 * at zero whatever you write to it. So on a slow fetch every seek test quietly
 * stopped measuring sync and started measuring buffering, and failed on timing
 * alone. Fetched once, served from here, that race is gone.
 */
async function ensureClip() {
  try {
    const s = await stat(clip);
    if (s.size > 0) return true;
  } catch {
    // not cached yet
  }
  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(String(res.status));
    await mkdir(cache, { recursive: true });
    await writeFile(clip, Buffer.from(await res.arrayBuffer()));
    console.log('cached test clip');
    return true;
  } catch (e) {
    console.warn('no test clip (offline?); seek tests will not be meaningful:', String(e));
    return false;
  }
}

const hasClip = await ensureClip();

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  // Range matters: it is how a player seeks, and a 200-only server makes the
  // whole file a prerequisite for jumping anywhere in it.
  if (path === '/clip.webm') {
    if (!hasClip) return void res.writeHead(404).end('no clip');
    const { size } = await stat(clip);
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, {
        'content-type': 'video/webm',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
      });
      return void createReadStream(clip, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': size });
    return void createReadStream(clip).pipe(res);
  }

  const file = path === '/' ? 'video.html' : path.replace(/^\//, '');
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`test video page: http://127.0.0.1:${PORT}/video.html`));
