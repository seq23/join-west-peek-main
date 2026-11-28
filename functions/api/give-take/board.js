/**
 * GET /api/give-take/board: the Give and Take board on joinwestpeek.com.
 * Approved asks only, newest first: { id, ask, approved }. Never a name, an email, a row id or an
 * avatar (Scooter, 27 Nov 2026: "Approved asks show on the board anonymously"). `id` is the ask's
 * random public id, which "I can help with this" sends back as ask_id.
 * Not stored on this deployment (no GIVE_TAKE_DB): 503 not_set_up, so a missing binding is loud.
 * Read fresh every time (no-store), so an approval shows on the next reload on any device.
 */
import { siteForHost } from '../lead.js';
import { boardAsks, giveTakeReady } from '../../_lib/give-take.mjs';

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  if (siteForHost(new URL(request.url).hostname) !== 'community') return json({ ok: false, error: 'not_found' }, 404);
  if (!giveTakeReady(env || {})) {
    console.error('give and take board NAMED_STOP=GIVE_TAKE_NOT_SET_UP: run npm run give-take:setup for this environment');
    return json({ ok: false, error: 'not_set_up', asks: [] }, 503);
  }
  try {
    return json({ ok: true, asks: await boardAsks(env) }, 200);
  } catch (err) {
    console.error('give and take board read failed', String(err).slice(0, 200));
    return json({ ok: false, error: 'unavailable', asks: [] }, 503);
  }
}
