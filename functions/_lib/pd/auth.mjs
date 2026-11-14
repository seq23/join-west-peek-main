/**
 * Who may open the dashboard, and how.
 *
 * Scooter, 13 Nov 2026: "The Productions dashboard is for Scooter only ... the owners list is
 * Scooter alone, and nobody else can be added except by Scooter asking." OWNER_IDS is that list.
 * v1.0 (Sequoia's go, 13 Nov 2026): Sign in with Google is the default; the emailed one-time code
 * (then his own password) is the working fallback; sessions are server-side rows in D1, revoked on
 * sign-out; "remember this phone" keeps one for 30 days.
 *
 * Owner record: D1 table `owner` (address, salted PBKDF2 hashes, `gen`). Before v1.0 it lived in
 * the KV store under `owners`; the first request that finds no D1 row copies Scooter's KV record
 * across once, so his password still works, and a still-valid pre-v1.0 cookie is swapped for a D1
 * session (nobody is signed out by the move).
 *
 * Preview only: a test identity (SAMPLE_EMAIL / SAMPLE_PASSWORD, below) signs in to a SAMPLE
 * session that reads synthetic rows only — never a connection, never his sheets. It is refused on
 * every production host, so it is not a secret: it opens nothing real anywhere.
 */
import { sendViaCloudflare, sendViaResend } from '../../api/lead.js';
import { dbOf, ensureSchema } from './schema.mjs';
import { b64url, enc, hashSecret, isPreviewHost, normalEmail, randomToken, sameText, secretMatches, sha256b64 } from './core.mjs';

export const OWNER_IDS = Object.freeze(['scooter']);
export const COOKIE = 'wpp_s';
export const LEGACY_COOKIE = 'wpp_dash';
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;
const CHOOSE_MINUTES = 30;
export const OTP_DAYS = 7;
export const OWNER_FAIL_LIMIT = 5;
const OWNER_FAIL_WINDOW_MS = 15 * 60000;
export const FORGOT_GAP_SECONDS = 300;
export const MIN_PASSWORD = 12;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 900;
export const SAMPLE_ID = 'sample';
export const SAMPLE_EMAIL = 'sample@preview.invalid';
export const SAMPLE_PASSWORD = 'preview-sample-only';

/* ------------------------------------------------------------------ one-time passwords */

const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newOneTimePassword() {
  const out = [];
  while (out.length < 16) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < 16) out.push(OTP_ALPHABET[b % 31]);
    }
  }
  return out.join('').match(/.{4}/g).join('-');
}
export function normalOtp(typed) { return String(typed || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/* ------------------------------------------------------------------ owner rows */

const J = (v) => (v ? JSON.parse(v) : null);
function rowToOwner(r) {
  return r && { id: r.id, name: r.name, email: r.email, pw: J(r.pw), otp: J(r.otp), gen: Number(r.gen) || 0, fails: J(r.fails), last_issue: J(r.last_issue) };
}
export async function saveOwner(db, o) {
  await db.prepare('INSERT INTO owner (id, name, email, pw, otp, gen, fails, last_issue, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, pw=excluded.pw, otp=excluded.otp, gen=excluded.gen, fails=excluded.fails, last_issue=excluded.last_issue, updated_at=excluded.updated_at')
    .bind(o.id, o.name || null, o.email, o.pw ? JSON.stringify(o.pw) : null, o.otp ? JSON.stringify(o.otp) : null, o.gen || 0, o.fails ? JSON.stringify(o.fails) : null, o.last_issue ? JSON.stringify(o.last_issue) : null, Date.now()).run();
}

/** Copies Scooter's pre-v1.0 KV record into D1 once, so the move costs him nothing. */
async function importLegacyOwner(env, db) {
  const kv = env?.PRODUCTIONS_DASHBOARD;
  if (!kv || typeof kv.get !== 'function') return;
  try {
    const raw = await kv.get('owners');
    const owners = raw ? JSON.parse(raw) : {};
    for (const id of OWNER_IDS) {
      const o = owners[id];
      if (o && o.email) await db.prepare('INSERT OR IGNORE INTO owner (id, name, email, pw, otp, gen, last_issue, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, o.name || null, o.email, o.pw ? JSON.stringify(o.pw) : null, o.otp ? JSON.stringify(o.otp) : null, Number(o.gen) || 0, o.last_issue ? JSON.stringify(o.last_issue) : null, Date.now()).run();
    }
  } catch (err) {
    console.error('dashboard legacy owner import failed', err?.message || err);
  }
}

/** The owner whose address matches (only ids on OWNER_IDS), or null. */
export async function findOwnerByEmail(env, email) {
  const db = dbOf(env);
  const want = normalEmail(email);
  if (!db || !want) return null;
  await ensureSchema(db);
  let rows = (await db.prepare('SELECT * FROM owner').all()).results || [];
  if (!rows.some((r) => OWNER_IDS.includes(r.id))) {
    await importLegacyOwner(env, db);
    rows = (await db.prepare('SELECT * FROM owner').all()).results || [];
  }
  const r = rows.find((x) => OWNER_IDS.includes(x.id) && normalEmail(x.email) === want);
  return rowToOwner(r);
}
export async function ownerById(env, id) {
  const db = dbOf(env);
  if (!db || !OWNER_IDS.includes(id)) return null;
  await ensureSchema(db);
  let r = await db.prepare('SELECT * FROM owner WHERE id = ?').bind(id).first();
  if (!r) { await importLegacyOwner(env, db); r = await db.prepare('SELECT * FROM owner WHERE id = ?').bind(id).first(); }
  return rowToOwner(r);
}

export function ownerLocked(owner, now) {
  const f = owner.fails;
  return Boolean(f && f.count >= OWNER_FAIL_LIMIT && now - f.since < OWNER_FAIL_WINDOW_MS);
}
export function countFail(owner, now) {
  const f = owner.fails && now - owner.fails.since < OWNER_FAIL_WINDOW_MS ? owner.fails : { count: 0, since: now };
  owner.fails = { count: f.count + 1, since: f.since };
}

/* ------------------------------------------------------------------ sessions (D1 rows) */

const cookieAttrs = (maxAge) => `Path=/dashboard; HttpOnly; Secure; SameSite=Lax${maxAge === null ? '' : `; Max-Age=${maxAge}`}`;
export const clearCookies = () => [`${COOKIE}=; ${cookieAttrs(0)}`, `${LEGACY_COOKIE}=; ${cookieAttrs(0)}`];

/**
 * Creates a server-side session and returns its Set-Cookie value.
 * stage 'full' | 'choose' (must pick a password first). remember → 30 days on this phone.
 */
export async function createSession(env, { ownerId, gen = 0, stage = 'full', remember = false, sample = false, how = 'password' }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const token = randomToken(32);
  const life = stage === 'choose' ? CHOOSE_MINUTES * 60000 : remember ? REMEMBER_DAYS * 86400000 : SESSION_HOURS * 3600000;
  await db.prepare('INSERT INTO session (id_hash, owner_id, stage, sample, remember, created_at, expires_at, last_seen, gen, how) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(await sha256b64(token), ownerId, stage, sample ? 1 : 0, remember ? 1 : 0, now, now + life, now, gen, how).run();
  return `${COOKIE}=${token}; ${cookieAttrs(remember && stage === 'full' ? REMEMBER_DAYS * 86400 : null)}`;
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') || '';
  const m = header.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : '';
}

/** { ownerId, owner, stage, sample, remember, idHash } | null. A revoked, expired or stale-gen row opens nothing. */
export async function sessionFromRequest(env, request, now = Date.now()) {
  const db = dbOf(env);
  if (!db) return null;
  const token = cookieValue(request, COOKIE);
  if (!token) return null;
  await ensureSchema(db);
  const idHash = await sha256b64(token);
  const s = await db.prepare('SELECT * FROM session WHERE id_hash = ?').bind(idHash).first();
  if (!s || s.revoked_at || Number(s.expires_at) < now) return null;
  const url = new URL(request.url);
  if (s.sample) {
    if (!isPreviewHost(url.hostname) || s.owner_id !== SAMPLE_ID) return null;
    return { ownerId: SAMPLE_ID, owner: { id: SAMPLE_ID, name: 'Sample', email: SAMPLE_EMAIL }, stage: 'full', sample: true, remember: Boolean(s.remember), idHash };
  }
  const owner = await ownerById(env, s.owner_id);
  if (!owner || owner.gen !== Number(s.gen)) return null;
  if (s.stage === 'full' && !owner.pw && s.how !== 'google') return null;
  if (!s.last_seen || now - Number(s.last_seen) > 3600000) await db.prepare('UPDATE session SET last_seen = ? WHERE id_hash = ?').bind(now, idHash).run();
  return { ownerId: owner.id, owner, stage: s.stage, sample: false, remember: Boolean(s.remember), idHash };
}

export async function revokeSession(env, request, now = Date.now()) {
  const db = dbOf(env);
  const token = cookieValue(request, COOKIE);
  if (!db || !token) return;
  await ensureSchema(db);
  await db.prepare('UPDATE session SET revoked_at = ? WHERE id_hash = ?').bind(now, await sha256b64(token)).run();
}
export async function revokeOtherSessions(env, ownerId, keepHash, now = Date.now()) {
  await dbOf(env).prepare('UPDATE session SET revoked_at = ? WHERE owner_id = ? AND id_hash != ? AND revoked_at IS NULL').bind(now, ownerId, keepHash || '').run();
}

/**
 * A pre-v1.0 HMAC cookie (signed with the KV `session_key`) that is still valid is swapped for a
 * D1 session, so Scooter stays signed in across the move. Returns a Set-Cookie list or null.
 */
export async function upgradeLegacyCookie(env, request, now = Date.now()) {
  const kv = env?.PRODUCTIONS_DASHBOARD;
  const raw = cookieValue(request, LEGACY_COOKIE);
  if (!raw || !kv || typeof kv.get !== 'function' || !dbOf(env)) return null;
  const [head, exp, sig] = raw.split('.');
  if (!head || !/^\d+$/.test(exp || '') || !sig || Number(exp) < Math.floor(now / 1000)) return null;
  let secret;
  try { secret = await kv.get('session_key'); } catch { return null; }
  if (!secret) return null;
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`wpp-dashboard-v2||${secret}`)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${exp}`)));
  if (!sameText(want, sig)) return null;
  const [kind, id, gen, stage] = head.split('~');
  if (kind !== 'owner' || stage !== 'full' || !OWNER_IDS.includes(id)) return null;
  const owner = await ownerById(env, id);
  if (!owner || String(owner.gen) !== gen || !owner.pw) return null;
  return [await createSession(env, { ownerId: id, gen: owner.gen, stage: 'full', how: 'legacy' }, now), `${LEGACY_COOKIE}=; ${cookieAttrs(0)}`];
}

/* ------------------------------------------------------------------ rate limit (per connection) */

export async function overLimit(request, bucket) {
  const ip = request.headers.get('cf-connecting-ip');
  const cache = globalThis.caches?.default;
  if (!ip || !cache) return false;
  const win = Math.floor(Date.now() / 1000 / LOGIN_WINDOW_SECONDS);
  const key = new Request(`https://dashboard-login-limit.invalid/${bucket}/${encodeURIComponent(ip)}/${win}`);
  try {
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= LOGIN_LIMIT) return true;
    await cache.put(key, new Response(String(count + 1), { headers: { 'cache-control': `max-age=${LOGIN_WINDOW_SECONDS}` } }));
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ the one-time password email */

/** Scooter, 13 Nov 2026: the email "says only: the dashboard is ready to open, the link, that this
 *  password works once and they will choose their own on the first screen, and that nothing goes
 *  live without Scooter's yes." */
export function oneTimePasswordEmail({ link, code }) {
  return {
    subject: 'Your West Peek Productions dashboard is ready to open',
    text: [
      'The West Peek Productions dashboard is ready to open.', '', `Open it: ${link}`, '',
      'Sign in with this email address and this password:', code, '',
      'This password works once. On the first screen you choose your own.', '',
      "Nothing goes live without Scooter's yes."
    ].join('\n')
  };
}

async function sendToOwner(env, to, mail) {
  const cf = await sendViaCloudflare(env, { to, subject: mail.subject, text: mail.text });
  if (cf.status === 'ok') return 'cloudflare';
  const rs = await sendViaResend(env, { to, subject: mail.subject, text: mail.text });
  if (rs.status === 'ok') return 'resend';
  return cf.status === 'not_configured' && rs.status === 'not_configured' ? 'not_configured' : 'failed';
}

/** 'cloudflare' | 'resend' | 'failed' | 'not_configured' | 'too_soon'. Sent to the address on record only. */
export async function issueOneTimePassword(env, owner, origin, now = Date.now()) {
  const db = dbOf(env);
  const delivered = ['cloudflare', 'resend', 'sending'].includes(owner.last_issue?.by);
  if (delivered && owner.last_issue?.at && now - owner.last_issue.at < FORGOT_GAP_SECONDS * 1000) return 'too_soon';
  const code = newOneTimePassword();
  owner.otp = { ...(await hashSecret(normalOtp(code))), issued_at: now, expires_at: now + OTP_DAYS * 86400000 };
  owner.last_issue = { at: now, by: 'sending' };
  await saveOwner(db, owner);
  const by = await sendToOwner(env, owner.email, oneTimePasswordEmail({ link: `${origin}/dashboard`, code }));
  owner.last_issue = { at: now, by };
  await saveOwner(db, owner);
  console.log(`OUTPUT dashboard one-time password owner=${owner.id} by=${by}`);
  return by;
}

/* ------------------------------------------------------------------ password / sample sign-in */

/**
 * Returns { kind: 'full'|'choose'|'sample'|'wrong'|'locked'|'unavailable', owner? }.
 * A password typed without an email opens nothing.
 */
export async function checkPasswordSignIn(env, { email, typed, hostname }, now = Date.now()) {
  if (!email) { await hashSecret(typed || 'x'); return { kind: 'wrong' }; }
  if (normalEmail(email) === SAMPLE_EMAIL) {
    if (isPreviewHost(hostname) && sameText(typed, SAMPLE_PASSWORD)) return { kind: 'sample' };
    await hashSecret(typed || 'x');
    return { kind: 'wrong' };
  }
  if (!dbOf(env)) return { kind: 'unavailable' };
  const owner = await findOwnerByEmail(env, email);
  if (!owner) { await hashSecret(typed || 'x'); return { kind: 'wrong' }; }
  // A fresh one-time password (16 random letters, sent only to his own inbox) still opens the
  // dashboard while the password is locked, so somebody typing wrong passwords at his address can
  // never lock him out of "Forgot it?". The per-connection limit still holds every try.
  if (owner.otp && now < owner.otp.expires_at && await secretMatches(normalOtp(typed), owner.otp)) {
    owner.otp = null;
    owner.gen += 1;
    owner.fails = null;
    await saveOwner(dbOf(env), owner);
    return { kind: 'choose', owner };
  }
  if (ownerLocked(owner, now)) return { kind: 'locked', owner };
  if (await secretMatches(typed, owner.pw)) {
    if (owner.fails) { owner.fails = null; await saveOwner(dbOf(env), owner); }
    return { kind: 'full', owner };
  }
  countFail(owner, now);
  await saveOwner(dbOf(env), owner);
  return { kind: 'wrong' };
}
