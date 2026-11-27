/**
 * /api/give-take/review?t=<signed token>: where the one-tap links in Scooter's Give and Take email
 * land. GET only SHOWS the ask and one button; nothing changes until the button is pressed (POST),
 * so a mail scanner or link preview that opens the link approves nothing. The token is an HMAC over
 * the ask's public id and the action with GIVE_TAKE_SIGNING_KEY; a forged or altered one is refused.
 */
import { siteForHost, sameOrigin } from '../lead.js';
import { verifyReview, applyReview, giveTakeReady, ACTIONS } from '../../_lib/give-take.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS_WORDS = { waiting: 'waiting for your review', approved: 'on the board', declined: 'declined', taken_down: 'taken down' };

function page(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | Give and Take</title><link rel="stylesheet" href="/assets/community.css"></head><body class="wpc-body"><main class="wpc-main wpc-review"><p class="wpc-section__tag" data-accent="give">Give and Take &middot; review</p><h1>${esc(title)}</h1>${body}<p class="wpc-review__foot"><a href="/give-and-take">See the board</a></p></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
}

async function gate(request, env, token) {
  if (siteForHost(new URL(request.url).hostname) !== 'community') return { res: page(404, 'Not found', '<p>This page is not here.</p>') };
  if (!giveTakeReady(env || {})) return { res: page(503, 'Not set up yet', '<p>Give and Take has no store on this site yet, so nothing can be reviewed. Run <code>npm run give-take:setup</code> for this environment.</p>') };
  const v = await verifyReview(env, token);
  if (!v) return { res: page(400, 'This link does not work', '<p>The link is not one we sent, or it was changed. Use the link in the email exactly as it came.</p>') };
  return { v };
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('t') || '';
  const { res, v } = await gate(request, env, token);
  if (res) return res;
  const ask = await env.GIVE_TAKE_DB.prepare('SELECT ask, status FROM gt_ask WHERE public_id = ?').bind(v.publicId).first().catch(() => null);
  if (!ask) return page(404, 'Ask not found', '<p>This ask is no longer stored.</p>');
  const label = ACTIONS[v.action];
  return page(200, label + '?', `<blockquote class="wpc-review__ask">${esc(ask.ask)}</blockquote><p>Right now this ask is <strong>${esc(STATUS_WORDS[ask.status] || ask.status)}</strong>.${v.action === 'approve' ? ' Approving puts these words on the board. The name and email are never shown.' : ''}</p><form method="POST" action="/api/give-take/review"><input type="hidden" name="t" value="${esc(token)}"><button type="submit" class="wpc-btn">${esc(label)}</button></form>`);
}

export async function onRequestPost({ request, env }) {
  const host = new URL(request.url).hostname;
  let token = '';
  try { token = String((await request.formData()).get('t') || ''); } catch { token = ''; }
  const { res, v } = await gate(request, env, token);
  if (res) return res;
  if (!sameOrigin(request, host)) return page(403, 'Press the button on the page', '<p>Open the link from the email and press the button there.</p>');
  let out;
  try { out = await applyReview(env, v.publicId, v.action); } catch (err) {
    console.error('give and take review failed', String(err).slice(0, 200));
    return page(503, 'Not saved', '<p>The store could not be reached, so nothing changed. Try the link again in a minute.</p>');
  }
  const quote = out.ask ? `<blockquote class="wpc-review__ask">${esc(out.ask.ask)}</blockquote>` : '';
  if (out.result === 'done') return page(200, { approve: 'On the board', decline: 'Declined', take_down: 'Taken down' }[v.action], `${quote}<p>${v.action === 'approve' ? 'The ask is on the board now, without a name or email.' : v.action === 'take_down' ? 'The ask is off the board.' : 'The ask will not go on the board.'}</p>`);
  if (out.result === 'already') return page(200, 'Already done', `${quote}<p>This ask is already ${esc(STATUS_WORDS[out.status] || out.status)}. Nothing changed.</p>`);
  if (out.result === 'not_allowed') return page(409, 'Not changed', `${quote}<p>This ask is ${esc(STATUS_WORDS[out.status] || out.status)}, so "${esc(ACTIONS[v.action])}" does not apply. Nothing changed.</p>`);
  if (out.result === 'not_found') return page(404, 'Ask not found', '<p>This ask is no longer stored.</p>');
  return page(503, 'Not saved', '<p>The change did not save. Try the link again in a minute.</p>');
}
