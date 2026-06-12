import { isValidCode } from './protocol';
import { invitePage } from './invite';
import { createIpLimiter } from './rate-limit';

export { RoomDO } from './room';

// The extension probes a host by fetching its root and checking this name, so a
// user who points at the wrong server is told rather than silently failing.
const HEALTH = { name: 'abode-relay' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// One limiter per isolate. Module scope is deliberate: it is what lets the
// counters survive between requests without any storage behind them.
const connects = createIpLimiter();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/') return json(HEALTH);

    // the invite landing page, served from the same Worker as the socket so an
    // invite link needs no second host
    if (url.pathname === '/j') return invitePage();

    if (url.pathname === '/ws') {
      const code = url.searchParams.get('code') ?? '';
      // Reject a bad code before spending a Durable Object lookup on it.
      if (!isValidCode(code)) return json({ error: 'invalid room code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected a websocket upgrade' }, 426);
      }
      // Checked after the code shape, before the Durable Object: a scan of the
      // code space is exactly the traffic this is here to make expensive, and
      // it must not get to spend a DO lookup per guess.
      if (!connects.allow(request.headers.get('CF-Connecting-IP') ?? '')) {
        return json({ error: 'too many connections, try again in a minute' }, 429);
      }
      // idFromName is deterministic, which is what makes an invite link durable:
      // the same code always resolves to the same room, this weekend or next.
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(request);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
