/**
 * Give and Take (joinwestpeek.com), Scooter 27 Nov 2026:
 *   "an ask box with name and email and Submit. Submit sends the ask to us for review. It does not
 *    publish by itself. Approved asks show on the board anonymously, with no name, email or avatar.
 *    The board link reads 'See who you can help' and each ask has 'I can help with this.' An offer
 *    goes privately to the person who asked. Names and emails are shared only in an email
 *    introduction after both people say yes, and we review those by hand for now."
 *
 * How it is built:
 *   1. The ask posts through /api/lead (lead_type give_and_take_ask) with every gate the other forms
 *      have (bot check, daily caps, two email channels). It NEVER adds the person to the network list
 *      (Scooter, 27 Nov 2026, 22:38 UTC: "Submitting a Give and Take ask should not add anyone to the
 *      network list"); lead.js skips the sheet for both Give and Take forms. It is saved here as
 *      'waiting' and Scooter's email carries three signed one-tap links: Approve for the board,
 *      Decline, Take down. Each link opens a confirmation page with ONE button
 *      (functions/api/give-take/review.js), so a mail scanner opening a link changes nothing.
 *   2. The board (/api/give-take/board) returns only an approved ask's words and its approval day.
 *      Never a name, an email, a row id or an avatar.
 *   3. "I can help with this" posts through /api/lead (lead_type give_and_take_offer, ask_id = the
 *      ask's public id). Only an APPROVED ask takes an offer. The offer is saved here and never shown
 *      on the site; Scooter's email carries the ask, the offer and both people's details, and he makes
 *      the introduction by hand after both say yes. The site emails no member.
 *      His build spec (give-and-take-build-spec.pdf, DECIDED): the giver agrees, when offering, that
 *      their name and email can be shared if the offer is accepted (required box, time saved); the
 *      kind of help is optional (Introduction, Conversation, Feedback, Advice). SUGGESTED rules kept:
 *      no offer on your own ask, no second offer from one giver on one ask, the board shows asks with
 *      the fewest offers first, then newest. Every review action is logged (gt_review_log).
 *
 * Storage: D1 bound as GIVE_TAKE_DB, its own database per environment; the link-signing key is the
 * Pages secret GIVE_TAKE_SIGNING_KEY. Both are set by `npm run give-take:setup`. Without either the
 * ask and offer are REFUSED (503 give_take_unavailable): an ask that could never be approved is not
 * taken in. This file has no Cloudflare globals, so scripts/test_lead_delivery.mjs runs it under Node.
 */

export const ASK_TYPE = 'give_and_take_ask';
export const OFFER_TYPE = 'give_and_take_offer';
export const ACTIONS = { approve: 'Approve for the board', decline: 'Decline', take_down: 'Take down' };
export const HELP_KINDS = ['Introduction', 'Conversation', 'Feedback', 'Advice'];
const LIMITS = { name: 120, email: 200, ask: 1000, offer: 2000 };
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const BOARD_MAX = 100;

export const MIGRATIONS = [
  {
    version: 1,
    sql: [
      "CREATE TABLE IF NOT EXISTS gt_ask (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, ask TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at INTEGER NOT NULL, reviewed_at INTEGER, approved_at INTEGER)",
      'CREATE INDEX IF NOT EXISTS gt_ask_board ON gt_ask (status, approved_at)',
      'CREATE TABLE IF NOT EXISTS gt_offer (id INTEGER PRIMARY KEY AUTOINCREMENT, ask_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, offer TEXT NOT NULL, created_at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS gt_schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)'
    ]
  },
  {
    // His build spec, 27 Nov 2026: optional kind of help, the giver's consent time, a review log.
    version: 2,
    sql: [
      'ALTER TABLE gt_ask ADD COLUMN help_kind TEXT',
      'ALTER TABLE gt_offer ADD COLUMN help_kind TEXT',
      'ALTER TABLE gt_offer ADD COLUMN consent_at INTEGER',
      'CREATE INDEX IF NOT EXISTS gt_offer_ask ON gt_offer (ask_id, email)',
      'CREATE TABLE IF NOT EXISTS gt_review_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ask_public_id TEXT NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, result TEXT NOT NULL, at INTEGER NOT NULL)'
    ]
  }
];

const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export function kindOf(fields) {
  const t = String(fields?.lead_type ?? '').trim();
  return t === ASK_TYPE ? 'ask' : t === OFFER_TYPE ? 'offer' : null;
}

/** Both halves of the store are present on this deployment. */
export function giveTakeReady(env) {
  return Boolean(env && env.GIVE_TAKE_DB && typeof env.GIVE_TAKE_DB.prepare === 'function' && String(env.GIVE_TAKE_SIGNING_KEY || '').length >= 32);
}

/** The optional kind of help: one of HELP_KINDS, or null. Anything else is refused, not guessed. */
export function helpKind(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  return HELP_KINDS.find((k) => k.toLowerCase() === t.toLowerCase()) || undefined;
}

/** null when the fields are a complete ask/offer; otherwise the error code the visitor gets (400). */
export function giveTakeProblem(kind, fields) {
  if (!text(fields.name, LIMITS.name)) return 'missing_name';
  if (helpKind(fields.help_kind) === undefined) return 'invalid_help_kind';
  if (kind === 'ask' && !text(fields.ask, LIMITS.ask)) return 'missing_ask';
  if (kind === 'offer') {
    if (!text(fields.offer, LIMITS.offer)) return 'missing_offer';
    if (!PUBLIC_ID_RE.test(String(fields.ask_id || ''))) return 'ask_not_found';
    // DECIDED in his spec: the giver agrees, when offering, that their name and email can be shared
    // if the offer is accepted. Without that yes there is nothing an introduction could rest on.
    if (String(fields.share_consent || '').trim().toLowerCase() !== 'yes') return 'missing_consent';
  }
  return null;
}

let schemaReady = new WeakSet();
export function resetGiveTakeSchemaMemo() { schemaReady = new WeakSet(); }
/** Applies every migration not yet recorded, in order, once per database. Additive only. */
export async function ensureSchema(db) {
  if (schemaReady.has(db)) return;
  for (const s of MIGRATIONS[0].sql) await db.prepare(s).run();
  const done = new Set(((await db.prepare('SELECT version FROM gt_schema_version').all()).results || []).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    if (m.version > 1) {
      for (const s of m.sql) {
        // A column an earlier half-run already added is not an error worth stopping for.
        try { await db.prepare(s).run(); } catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
      }
    }
    await db.prepare('INSERT OR IGNORE INTO gt_schema_version (version, applied_at) VALUES (?, ?)').bind(m.version, Date.now()).run();
  }
  schemaReady.add(db);
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.GIVE_TAKE_SIGNING_KEY)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
/** A review token: <public id>.<action>.<HMAC-SHA256 over "gt-review:<id>:<action>">. */
export async function signReview(env, publicId, action) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(`gt-review:${publicId}:${action}`));
  return `${publicId}.${action}.${b64url(sig)}`;
}
/** { publicId, action } for a genuine token; null for anything forged, altered or malformed. */
export async function verifyReview(env, token) {
  const m = /^([A-Za-z0-9_-]{16})\.(approve|decline|take_down)\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m || !giveTakeReady(env)) return null;
  let sig;
  try { sig = fromB64url(m[3]); } catch { return null; }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sig, new TextEncoder().encode(`gt-review:${m[1]}:${m[2]}`));
  return ok ? { publicId: m[1], action: m[2] } : null;
}
export async function reviewLinks(env, origin, publicId) {
  const out = {};
  for (const action of Object.keys(ACTIONS)) out[action] = `${origin}/api/give-take/review?t=${await signReview(env, publicId, action)}`;
  return out;
}

/** Saves a new ask as 'waiting'. Returns the saved row, or null when the store failed. */
export async function saveAsk(env, fields, now = Date.now()) {
  try {
    const db = env.GIVE_TAKE_DB;
    await ensureSchema(db);
    const publicId = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const row = { public_id: publicId, name: text(fields.name, LIMITS.name), email: text(fields.email, LIMITS.email).toLowerCase(), ask: text(fields.ask, LIMITS.ask), help_kind: helpKind(fields.help_kind) || null };
    await db.prepare("INSERT INTO gt_ask (public_id, name, email, ask, help_kind, status, created_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?)").bind(row.public_id, row.name, row.email, row.ask, row.help_kind, now).run();
    const back = await db.prepare('SELECT id, public_id, name, email, ask, help_kind, status FROM gt_ask WHERE public_id = ?').bind(publicId).first();
    return back && back.ask === row.ask ? back : null;
  } catch (err) {
    console.error('give and take: ask not saved', String(err).slice(0, 200));
    return null;
  }
}

/** The approved ask an offer names, or null (unknown, waiting, declined or taken down). */
export async function approvedAsk(env, publicId) {
  if (!PUBLIC_ID_RE.test(String(publicId || ''))) return null;
  const db = env.GIVE_TAKE_DB;
  await ensureSchema(db);
  return db.prepare("SELECT id, public_id, name, email, ask, help_kind, approved_at FROM gt_ask WHERE public_id = ? AND status = 'approved'").bind(publicId).first();
}

/**
 * Why this giver may not offer on this ask, or null. His spec's rules: no offering on your own ask,
 * no second offer from one giver on one ask.
 */
export async function offerRefusal(env, ask, fields) {
  const email = text(fields.email, LIMITS.email).toLowerCase();
  if (email && email === String(ask.email || '').toLowerCase()) return 'own_ask';
  const prior = await env.GIVE_TAKE_DB.prepare('SELECT id FROM gt_offer WHERE ask_id = ? AND email = ?').bind(ask.id, email).first();
  return prior ? 'already_offered' : null;
}

/** Saves an offer against an approved ask. Returns the saved row, or null when the store failed. */
export async function saveOffer(env, ask, fields, now = Date.now()) {
  try {
    const db = env.GIVE_TAKE_DB;
    const row = { name: text(fields.name, LIMITS.name), email: text(fields.email, LIMITS.email).toLowerCase(), offer: text(fields.offer, LIMITS.offer), help_kind: helpKind(fields.help_kind) || null, consent_at: now };
    const res = await db.prepare('INSERT INTO gt_offer (ask_id, name, email, offer, help_kind, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(ask.id, row.name, row.email, row.offer, row.help_kind, row.consent_at, now).run();
    const id = res?.meta?.last_row_id;
    const back = id
      ? await db.prepare('SELECT id, offer FROM gt_offer WHERE id = ?').bind(id).first()
      : await db.prepare('SELECT id, offer FROM gt_offer WHERE ask_id = ? AND email = ? AND created_at = ? ORDER BY id DESC').bind(ask.id, row.email, now).first();
    return back && back.offer === row.offer ? { ...row, id: back.id } : null;
  } catch (err) {
    console.error('give and take: offer not saved', String(err).slice(0, 200));
    return null;
  }
}

/** Undo a save whose notification never left (both mail channels failed), so nothing sits unseen. */
export async function forget(env, kind, row) {
  try {
    if (kind === 'ask') await env.GIVE_TAKE_DB.prepare("DELETE FROM gt_ask WHERE public_id = ? AND status = 'waiting'").bind(row.public_id).run();
    else await env.GIVE_TAKE_DB.prepare('DELETE FROM gt_offer WHERE id = ?').bind(row.id).run();
  } catch (err) {
    console.error('give and take: could not undo an unsent save', String(err).slice(0, 200));
  }
}

/** The lines Scooter's email carries, in place of the raw field list. */
export function giveTakeMail(kind, { ask, offer, links, submittedAt }) {
  if (kind === 'ask') {
    return {
      subject: 'Give and Take: a new ask to review',
      text: [
        'A new Give and Take ask is waiting for your review. Nothing is on the board until you approve it.',
        '',
        `Ask: ${ask.ask}`,
        `Kind of help: ${ask.help_kind || 'not given'}`,
        `From: ${ask.name} <${ask.email}>`,
        'This person was NOT added to the network list.',
        `Submitted: ${submittedAt}`,
        '',
        'Before approving, check the words carry no name, contact or identifying detail (the board shows them exactly).',
        'Each link opens a page with one button to confirm:',
        `Approve for the board (shows the ask only, never the name or email): ${links.approve}`,
        `Decline: ${links.decline}`,
        `Take down later, once it is on the board: ${links.take_down}`
      ].join('\n')
    };
  }
  return {
    subject: 'Give and Take: someone can help',
    text: [
      'Someone offered to help with an ask on the Give and Take board. Neither person has been told anything.',
      'Intros are by hand: ask each person for a yes, then send the email introduction yourself.',
      '',
      `The ask: ${ask.ask}`,
      `Asked by: ${ask.name} <${ask.email}>`,
      '',
      `The offer: ${offer.offer}`,
      `Kind of help: ${offer.help_kind || 'not given'}`,
      `Offered by: ${offer.name} <${offer.email}>`,
      `The giver agreed their name and email can be shared if the offer is accepted (${new Date(offer.consent_at).toISOString()}).`,
      'Before passing the offer on, remove any contact or identifying detail from its words.',
      `Submitted: ${submittedAt}`
    ].join('\n')
  };
}

/** Applies one review action. Returns { result, status, ask } for the confirmation page. */
export async function applyReview(env, publicId, action, now = Date.now()) {
  const db = env.GIVE_TAKE_DB;
  await ensureSchema(db);
  const ask = await db.prepare('SELECT public_id, ask, status FROM gt_ask WHERE public_id = ?').bind(publicId).first();
  const log = (result, from, toStatus) => db.prepare('INSERT INTO gt_review_log (ask_public_id, action, from_status, to_status, result, at) VALUES (?, ?, ?, ?, ?, ?)').bind(publicId, action, from ?? null, toStatus ?? null, result, now).run();
  if (!ask) return { result: 'not_found' };
  const from = { approve: ['waiting', 'declined', 'taken_down'], decline: ['waiting'], take_down: ['approved'] }[action];
  const to = { approve: 'approved', decline: 'declined', take_down: 'taken_down' }[action];
  if (ask.status === to) return { result: 'already', status: ask.status, ask };
  if (!from.includes(ask.status)) { await log('not_allowed', ask.status, ask.status); return { result: 'not_allowed', status: ask.status, ask }; }
  const sql = action === 'approve'
    ? "UPDATE gt_ask SET status = 'approved', reviewed_at = ?, approved_at = ? WHERE public_id = ? AND status = ?"
    : `UPDATE gt_ask SET status = '${to}', reviewed_at = ? WHERE public_id = ? AND status = ?`;
  if (action === 'approve') await db.prepare(sql).bind(now, now, publicId, ask.status).run();
  else await db.prepare(sql).bind(now, publicId, ask.status).run();
  const back = await db.prepare('SELECT status FROM gt_ask WHERE public_id = ?').bind(publicId).first();
  const ok = back?.status === to;
  await log(ok ? 'done' : 'failed', ask.status, back?.status);
  return ok ? { result: 'done', status: to, ask } : { result: 'failed', status: back?.status, ask };
}

/**
 * The board: approved asks, those with the fewest offers first, then the newest approval (his spec;
 * no popularity ranking). Words, the optional kind of help, a public id and a day. Nothing else: the
 * offer count orders the list but is never sent.
 */
export async function boardAsks(env) {
  const db = env.GIVE_TAKE_DB;
  await ensureSchema(db);
  const rows = (await db.prepare("SELECT a.public_id, a.ask, a.help_kind, a.approved_at, (SELECT COUNT(*) FROM gt_offer o WHERE o.ask_id = a.id) AS offers FROM gt_ask a WHERE a.status = 'approved' ORDER BY offers ASC, a.approved_at DESC, a.id DESC LIMIT ?").bind(BOARD_MAX).all()).results || [];
  return rows.map((r) => ({ id: r.public_id, ask: r.ask, help: r.help_kind || null, approved: new Date(Number(r.approved_at)).toISOString().slice(0, 10) }));
}
