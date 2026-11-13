/**
 * The West Peek Productions dashboard (westpeekproductions.com/dashboard), behind a password.
 *
 * Scooter, 13 Nov 2026: "The dashboard is at /dashboard on this site, behind a password ...
 * No dashboard page or data without the password. Private figures never in the repo or any
 * public file: read server-side from a private store."
 *
 * So this file holds SHAPES and WORDS only. Every name, date and figure the dashboard shows is
 * read at request time from the Workers KV namespace bound as PRODUCTIONS_DASHBOARD on the
 * west-peek-productions Pages project (loaded by `npm run dashboard:store`, which reads a file that
 * lives outside this public repo). The figures are kept under two keys, `team` (projects, waiting
 * on the client, proposals out, agent drafts, the Agent Log, the sales funnel, the Cold Email Log)
 * and `finance` (the tracker against the Blueprint's targets, pipeline values, invoices, aged
 * receivables, expected receipts, vendor obligations, project margin, rolling cash). The key names
 * are storage only: nobody signs in as a team any more.
 *
 * Who signs in (Scooter, 13 Nov 2026, after the second preview): "The Productions dashboard is for
 * Scooter only. Remove the team sign-in completely: no team password, no team view, no sign-in
 * without an email. The only way in is Scooter's own email and his own password ... Sequoia is
 * not an owner; the owners list is Scooter alone, and nobody else can be added except by Scooter
 * asking."
 *   So the only way in is an owner's own email and own password, and OWNER_IDS below is the whole
 *   list of owners: ['scooter']. A record in the private store under any other id opens nothing,
 *   so adding someone is a code change here, made only when Scooter asks. Scooter sees everything,
 *   Money included. His record lives ONLY in the private store under the key `owners`
 *   ({ scooter: { name, email, pw, otp, gen, fails, last_issue } }); his address is never in this
 *   repo, a log or a public file. Passwords and one-time passwords are kept only as salted
 *   PBKDF2-SHA256 hashes. A one-time password is emailed to his own address by the site's existing
 *   mail sender (Cloudflare email, then Resend, both to that address only), stops working the
 *   moment it is used to sign in (the next screen makes him choose a password before anything is
 *   shown), and stops working after 7 days unused.
 *   There is no team password and no shared owner password: no setting is read for either.
 * Sessions are an HMAC-signed cookie keyed from a random key kept in the private store
 * (`session_key`). The key string keeps the empty field the retired team password used to fill, so
 * a session signed before this change still checks out (nobody is signed out by it). An owner
 * cookie carries the owner's `gen`; choosing a password or using a one-time password bumps it,
 * which signs that owner's other sessions out. Wrong tries are rate-limited per connection and per
 * owner (5 wrong in 15 minutes locks that owner's sign-in for 15 minutes).
 *
 * Cold email sending is OFF in code (COLD_EMAIL_SENDING below): there is no sender anywhere in this
 * repo. The Cold Email Log shows what the store records; turning sending on is Scooter's go, after
 * he gives the inbox, the targets and the offer (dashboard brief, 13 Nov 2026).
 */
import { siteForHost, sendViaCloudflare, sendViaResend } from '../api/lead.js';

export const COLD_EMAIL_SENDING = false;
export const COLD_EMAIL_WEEKLY_CAP = 25;
export const COOKIE = 'wpp_dash';
const SESSION_SECONDS = 12 * 3600;
const CHOOSE_SECONDS = 30 * 60;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 900;
export const OTP_DAYS = 7;
export const OWNER_FAIL_LIMIT = 5;
const OWNER_FAIL_WINDOW_SECONDS = 900;
/** One fresh one-time password per owner per 5 minutes at most, however often "Forgot it?" is pressed. */
export const FORGOT_GAP_SECONDS = 300;
export const MIN_PASSWORD = 12;
const PBKDF2_ITERATIONS = 100000;
export const OWNERS_KEY = 'owners';
/** The whole list of people who can open the dashboard (Scooter, 13 Nov 2026: "the owners list is
 *  Scooter alone, and nobody else can be added except by Scooter asking"). */
export const OWNER_IDS = Object.freeze(['scooter']);
/** dashboard:owners proves the sign-in with a throwaway `proof-` owner; it opens only until this long after it was written. */
export const PROOF_OWNER_MAX_MS = 30 * 60 * 1000;
const SESSION_KEY_KEY = 'session_key';
const TZ = 'America/Chicago';

export const FUNNEL_STAGES = [
  'Relationship identified', 'Introductory conversation', 'Qualified opportunity', 'Discovery',
  'Solution and budget', 'Proposal', 'Negotiation', 'Signed agreement', 'Deposit received',
  'Delivery handoff'
];

/* ------------------------------------------------------------------ store shape */

export const TEAM_LISTS = ['projects', 'waiting_on_client', 'proposals_out', 'agent_drafts', 'agent_log', 'opportunities', 'cold_email_log'];
export const FINANCE_LISTS = ['targets', 'revenue_model', 'pipeline_values', 'invoices', 'expected_receipts', 'vendor_obligations', 'project_margin', 'cash_weeks'];

/** Returns a list of problems; [] means the document can be stored. Shared with dashboard:store. */
export function storeProblems(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['the file is not a JSON object'];
  for (const part of ['team', 'finance']) {
    if (!doc[part] || typeof doc[part] !== 'object') problems.push(`"${part}" is missing`);
  }
  for (const k of TEAM_LISTS) if (doc.team && !Array.isArray(doc.team[k])) problems.push(`team.${k} must be a list`);
  for (const k of FINANCE_LISTS) if (doc.finance && !Array.isArray(doc.finance[k])) problems.push(`finance.${k} must be a list`);
  for (const o of doc.team?.opportunities || []) {
    if (!FUNNEL_STAGES.includes(o.stage)) problems.push(`opportunity "${o.organization}" has unknown stage "${o.stage}"`);
  }
  return problems;
}

/* ------------------------------------------------------------------ crypto */

const enc = new TextEncoder();
export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a[i] ^ b[i];
  return d === 0;
}
const sameText = (a, b) => sameBytes(enc.encode(String(a)), enc.encode(String(b)));
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations }, key, 256));
}
/** A salted hash of a password or one-time password: the only form either is ever stored in. */
export async function hashSecret(secret) {
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: b64url(await pbkdf2(secret, salt, PBKDF2_ITERATIONS)), iterations: PBKDF2_ITERATIONS };
}
export async function secretMatches(secret, rec) {
  if (!rec || !rec.salt || !rec.hash || !secret) return false;
  return sameText(b64url(await pbkdf2(secret, rec.salt, rec.iterations || PBKDF2_ITERATIONS)), rec.hash);
}

/** One-time passwords: 16 characters from an alphabet with no look-alikes, shown in groups of 4. */
const OTP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newOneTimePassword() {
  const out = [];
  while (out.length < 16) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < 16) out.push(OTP_ALPHABET[b % 31]); // 248 = 8 x 31: no bias
    }
  }
  return out.join('').match(/.{4}/g).join('-');
}
/** What a typed one-time password is compared as: case, spaces and dashes do not matter. */
export function normalOtp(typed) { return String(typed || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const normalEmail = (e) => String(e || '').trim().toLowerCase();

/* ------------------------------------------------------------------ owners (private store) */

function kvOf(env) {
  const kv = env?.PRODUCTIONS_DASHBOARD;
  return kv && typeof kv.get === 'function' ? kv : null;
}
/** The owners map, {} when none are entered, null when the store cannot be read. */
export async function readOwners(env) {
  const kv = kvOf(env);
  if (!kv) return null;
  try {
    const raw = await kv.get(OWNERS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('dashboard owners unreadable', err?.message || err);
    return null;
  }
}
async function writeOwners(env, owners) { await kvOf(env).put(OWNERS_KEY, JSON.stringify(owners)); }
/** Only an id on OWNER_IDS, or a live dashboard:owners proof record, is an owner; any other record opens nothing. */
export function admitted(id, owner, now = Date.now()) {
  if (!owner) return false;
  if (OWNER_IDS.includes(id)) return true;
  const until = Number(owner.proof_until);
  return id.startsWith('proof-') && until > now && until - now <= PROOF_OWNER_MAX_MS;
}
function findOwner(owners, email, now = Date.now()) {
  const want = normalEmail(email);
  if (!want) return [null, null];
  for (const [id, o] of Object.entries(owners || {})) if (admitted(id, o, now) && normalEmail(o.email) === want) return [id, o];
  return [null, null];
}

/** The random half of the session signing key, kept in the private store; made on first use. */
async function sessionSecret(env) {
  const kv = kvOf(env);
  if (!kv) return '';
  try {
    let s = await kv.get(SESSION_KEY_KEY);
    if (!s) { s = b64url(crypto.getRandomValues(new Uint8Array(32))); await kv.put(SESSION_KEY_KEY, s); }
    return s;
  } catch {
    return '';
  }
}
async function sign(env, payload) {
  // The empty field between the bars is where the retired team password used to go: kept, so a
  // session signed before it was retired still checks out.
  const raw = await sha256(`wpp-dashboard-v2||${await sessionSecret(env)}`);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

/** The dashboard can open only with a private store that holds the owner. */
export function dashboardConfigured(env) {
  return Boolean(kvOf(env));
}

const cookieAttrs = (age) => `Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
/** who: { id, gen, stage } for an owner ('choose' = must pick a password first). */
export async function sessionCookie(env, who, now = Date.now()) {
  const age = who.stage === 'full' ? SESSION_SECONDS : CHOOSE_SECONDS;
  const exp = Math.floor(now / 1000) + age;
  const head = `owner~${who.id}~${who.gen}~${who.stage}`;
  const payload = `${head}.${exp}`;
  return `${COOKIE}=${payload}.${await sign(env, payload)}; ${cookieAttrs(age)}`;
}

/** { role: 'owner', id, owner, owners, stage } | null */
export async function sessionFromRequest(env, request, now = Date.now()) {
  if (!dashboardConfigured(env)) return null;
  const header = request.headers.get('cookie') || '';
  const m = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!m) return null;
  const [head, exp, sig] = m.slice(COOKIE.length + 1).split('.');
  if (!head || !/^\d+$/.test(exp || '') || !sig) return null;
  if (Number(exp) < Math.floor(now / 1000)) return null;
  if (!sameText(await sign(env, `${head}.${exp}`), sig)) return null;
  const [kind, id, gen, stage] = head.split('~');
  if (kind !== 'owner' || !['full', 'choose'].includes(stage)) return null;
  const owners = await readOwners(env);
  const owner = owners?.[id];
  if (!admitted(id, owner, now) || String(owner.gen || 0) !== gen) return null;
  if (stage === 'full' && !owner.pw) return null;
  return { role: 'owner', id, owner, owners, stage };
}

async function overLimit(request, bucket) {
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
function ownerLocked(owner, now) {
  const f = owner.fails;
  return Boolean(f && f.count >= OWNER_FAIL_LIMIT && now - f.since < OWNER_FAIL_WINDOW_SECONDS * 1000);
}
function countFail(owner, now) {
  const f = owner.fails && now - owner.fails.since < OWNER_FAIL_WINDOW_SECONDS * 1000 ? owner.fails : { count: 0, since: now };
  owner.fails = { count: f.count + 1, since: f.since };
}

/* ------------------------------------------------------------------ the one-time password email */

/**
 * Scooter, 13 Nov 2026: the email "says only: the dashboard is ready to open, the link, that this
 * password works once and they will choose their own on the first screen, and that nothing goes
 * live without Scooter's yes. No apology and nothing about earlier."
 */
export function oneTimePasswordEmail({ link, code }) {
  return {
    subject: 'Your West Peek Productions dashboard is ready to open',
    text: [
      'The West Peek Productions dashboard is ready to open.',
      '',
      `Open it: ${link}`,
      '',
      'Sign in with this email address and this password:',
      code,
      '',
      'This password works once. On the first screen you choose your own.',
      '',
      "Nothing goes live without Scooter's yes."
    ].join('\n')
  };
}

/** Send to the owner's own address only: Cloudflare email first, Resend if that did not deliver. */
async function sendToOwner(env, to, mail) {
  const cf = await sendViaCloudflare(env, { to, subject: mail.subject, text: mail.text });
  if (cf.status === 'ok') return 'cloudflare';
  const rs = await sendViaResend(env, { to, subject: mail.subject, text: mail.text });
  if (rs.status === 'ok') return 'resend';
  return cf.status === 'not_configured' && rs.status === 'not_configured' ? 'not_configured' : 'failed';
}

/**
 * Issue a fresh one-time password to one owner and email it to their own address. Records the
 * hash, the 7-day expiry and which channel carried it (`last_issue.by`); never the code itself.
 * Returns 'cloudflare' | 'resend' | 'failed' | 'not_configured' | 'too_soon'.
 */
export async function issueOneTimePassword(env, owners, id, origin, now = Date.now()) {
  const owner = owners[id];
  // The gap guards the owner's inbox, so only an email that went out starts it. A send that did
  // not deliver (no mail sender yet, a failed channel) leaves nothing to space out: the next
  // Forgot it? tries again at once (13 Nov 2026: the preview had no sender, and a resend minutes
  // after it was set would otherwise have been held as 'too_soon' and read as still undelivered).
  const delivered = ['cloudflare', 'resend', 'sending'].includes(owner.last_issue?.by);
  if (delivered && owner.last_issue?.at && now - owner.last_issue.at < FORGOT_GAP_SECONDS * 1000) return 'too_soon';
  const code = newOneTimePassword();
  owner.otp = { ...(await hashSecret(normalOtp(code))), issued_at: now, expires_at: now + OTP_DAYS * 86400000 };
  owner.last_issue = { at: now, by: 'sending' };
  await writeOwners(env, owners);
  const by = await sendToOwner(env, owner.email, oneTimePasswordEmail({ link: `${origin}/dashboard`, code }));
  owner.last_issue = { at: now, by };
  await writeOwners(env, owners);
  console.log(`OUTPUT dashboard one-time password owner=${id} by=${by}`);
  return by;
}

/* ------------------------------------------------------------------ store */

/** { state: 'ok' | 'not_connected' | 'empty' | 'unreadable', team?, finance?, updated_at? } (read only for a signed-in owner) */
export async function readStore(env) {
  const kv = env.PRODUCTIONS_DASHBOARD;
  if (!kv || typeof kv.get !== 'function') return { state: 'not_connected' };
  try {
    const [teamRaw, metaRaw, financeRaw] = await Promise.all([
      kv.get('team'), kv.get('meta'), kv.get('finance')
    ]);
    if (!teamRaw) return { state: 'empty' };
    const meta = metaRaw ? JSON.parse(metaRaw) : {};
    return {
      state: 'ok',
      updated_at: meta.updated_at || null,
      team: JSON.parse(teamRaw),
      finance: financeRaw ? JSON.parse(financeRaw) : null
    };
  } catch (err) {
    console.error('dashboard store unreadable', err?.message || err);
    return { state: 'unreadable' };
  }
}

/* ------------------------------------------------------------------ words */

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const NOT_ENTERED = '<span class="d-gap">not entered yet</span>';
function txt(v) { return v === null || v === undefined || v === '' ? NOT_ENTERED : esc(v); }
function day(iso) {
  if (!iso) return '<span class="d-gap">date not set</span>';
  const d = new Date(`${String(iso).length === 10 ? `${iso}T12:00:00Z` : iso}`);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return esc(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d));
}
function when(iso) {
  if (!iso) return '<span class="d-gap">time not set</span>';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return esc(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d));
}
function money(n, { atLeast = false } = {}) {
  if (n === null || n === undefined || n === '') return NOT_ENTERED;
  const s = `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return atLeast ? `at least ${s}` : s;
}
function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(`${String(iso).length === 10 ? `${iso}T12:00:00Z` : iso}`).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86400000);
}
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

/** A table on a laptop, one labelled card per row on a phone. */
function table(cols, rows, emptyLine) {
  if (!rows.length) return `<p class="d-empty">${esc(emptyLine)}</p>`;
  const head = cols.map((c) => `<th scope="col">${esc(c[0])}</th>`).join('');
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td data-label="${esc(c[0])}">${c[1](r)}</td>`).join('')}</tr>`).join('');
  return `<table class="phone-cards"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function section(id, label, title, why, inner) {
  return `<section class="d-sec" id="${id}" aria-labelledby="${id}-h"><p class="d-label">${esc(label)}</p><h2 id="${id}-h">${esc(title)}</h2>${why ? `<p class="d-sub">${esc(why)}</p>` : ''}${inner}</section>`;
}

/* ------------------------------------------------------------------ views */

function overdueInvoices(fin, now) {
  return (fin?.invoices || []).filter((i) => i.status !== 'paid' && i.due && daysSince(i.due, now) > 0);
}

export function renderDashboard({ store, now = Date.now() }) {
  const t = store.team || {};
  const f = store.finance;
  const drafts = (t.agent_drafts || []).filter((d) => d.status !== 'approved');
  const overdue = overdueInvoices(f, now);
  const needs = drafts.length + overdue.length;
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(now));
  const parts = [];
  if (drafts.length) parts.push(`${drafts.length} agent draft${drafts.length === 1 ? '' : 's'} to approve`);
  if (overdue.length) parts.push(`${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`);
  const line1 = needs ? `${esc(today)} · ${needs} need${needs === 1 ? 's' : ''} you: ${esc(parts.join(', '))}` : `${esc(today)} · Nothing needs you right now`;

  const banner = overdue.length
    ? `<a class="d-alarm" href="#money">⚠ ${overdue.length} overdue: ${overdue.map((i) => `${esc(i.client)} ${money(i.amount)}, due ${day(i.due)}`).join('; ')} · Open ›</a>`
    : '';

  const projects = section('work', 'Active work', 'Projects and next milestones', 'What each project does next, and when.', table([
    ['Project', (r) => `${txt(r.name)}<span class="d-subcell">${txt(r.client)}</span>`],
    ['Where it is', (r) => txt(r.status)],
    ['Next milestone', (r) => txt(r.next_milestone)],
    ['When', (r) => day(r.due)],
    ['Lead', (r) => txt(r.lead)]
  ], t.projects || [], 'No active projects are entered yet.'));

  const waiting = section('waiting', 'Active work', 'Waiting on the client', 'What a client owes us before the work can move.', table([
    ['Project', (r) => txt(r.project)],
    ['Waiting for', (r) => txt(r.item)],
    ['Since', (r) => { const d = daysSince(r.since, now); return `${day(r.since)}${d !== null && d >= 0 ? `<span class="d-subcell">waiting ${d} day${d === 1 ? '' : 's'}</span>` : ''}`; }],
    ['Who chases', (r) => txt(r.owner)]
  ], t.waiting_on_client || [], 'Nothing is waiting on a client.'));

  const proposals = section('proposals', 'Sales', 'Proposals out', 'Sent and not yet signed.', table([
    ['Organization', (r) => txt(r.organization)],
    ['Scope', (r) => txt(r.scope)],
    ['Sent', (r) => day(r.sent)],
    ['Next step', (r) => `${txt(r.next_step)}<span class="d-subcell">${day(r.follow_up)}</span>`]
  ], t.proposals_out || [], 'No proposals out are entered yet.'));

  const draftsSec = section('drafts', 'Agents', 'Agent drafts waiting for approval', 'Agents draft; nothing goes to a client until it is approved.', table([
    ['Draft', (r) => (r.link && /^https:\/\//.test(r.link) ? `<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${txt(r.document)} ›</a>` : txt(r.document))],
    ['Project', (r) => txt(r.project)],
    ['Agent', (r) => txt(r.agent)],
    ['Drafted', (r) => when(r.drafted)]
  ], drafts, 'No agent drafts are waiting. Agents start drafting in Phase 2 of the build order.'));

  const log = [...(t.agent_log || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
  const activity = section('activity', 'Agents', 'Activity feed', 'Every agent read or write, from the Agent Log. Newest first.', table([
    ['When', (r) => when(r.at)],
    ['Agent', (r) => txt(r.agent)],
    ['Did', (r) => `${txt(r.action)} ${txt(r.document)}`],
    ['Project', (r) => txt(r.project)],
    ['Approved by', (r) => txt(r.approver)]
  ], log, 'No agent has read or written anything yet.'));

  const opps = t.opportunities || [];
  const values = new Map((f?.pipeline_values || []).map((p) => [p.organization, p]));
  const funnelRows = FUNNEL_STAGES.map((stage) => {
    const here = opps.filter((o) => o.stage === stage);
    const v = sum(here.map((o) => values.get(o.organization) || {}), 'value');
    return `<li class="d-stage"><span class="d-stage__n">${here.length}</span><span class="d-stage__name">${esc(stage)}${v ? ` · ${money(v)}` : ''}</span>${here.length ? `<span class="d-subcell">${here.map((o) => esc(o.organization)).join(', ')}</span>` : ''}</li>`;
  }).join('');
  const funnel = section('funnel', 'Sales', 'Sales funnel', 'The ten stages from the Blueprint. Each opportunity has an owner, a next action and a date.',
    `<ol class="d-funnel">${funnelRows}</ol>${table([
      ['Organization', (r) => txt(r.organization)],
      ['Stage', (r) => txt(r.stage)],
      ['Next action', (r) => `${txt(r.next_action)}<span class="d-subcell">${day(r.target_date)}</span>`],
      ['Owner', (r) => txt(r.owner)],
      ['Value', (r) => money(values.get(r.organization)?.value)]
    ], opps, 'No opportunities are entered yet.')}`);

  const cold = t.cold_email_log || [];
  const weekAgo = now - 7 * 86400000;
  const thisWeek = cold.filter((c) => new Date(c.date).getTime() >= weekAgo).length;
  const coldSec = section('cold', 'Sales', 'Cold Email Log',
    `Sending is ${COLD_EMAIL_SENDING ? 'on' : 'off'}. It turns on only with Scooter's go, after he gives the sending inbox, the target clients and the offer. Cap: ${COLD_EMAIL_WEEKLY_CAP} a week.`,
    `<p class="d-state ${COLD_EMAIL_SENDING ? '' : 'd-state--off'}">${COLD_EMAIL_SENDING ? 'Sending on' : 'Sending off'} · ${thisWeek} of ${COLD_EMAIL_WEEKLY_CAP} this week</p>${table([
      ['Date', (r) => day(r.date)],
      ['Organization', (r) => txt(r.organization)],
      ['To', (r) => txt(r.recipient)],
      ['Subject', (r) => txt(r.subject)],
      ['Status', (r) => txt(r.status)],
      ['Replies', (r) => txt(r.replies ?? 0)]
    ], cold, 'No cold emails have been sent. Sending is off.')}`);

  const sections = [projects, waiting, proposals, funnel, coldSec, draftsSec, activity];
  sections.splice(3, 0, f ? renderFinance(f, now) : section('money', 'Scooter only', 'Money', '', '<p class="d-warn">The finance part of the private store did not load, so nothing is shown here. This is not the same as zero.</p>'));

  const tabs = [['#work', 'Work'], ['#funnel', 'Sales'], ['#money', 'Money'], ['#drafts', 'Agents']]
    .map(([h, l]) => `<a href="${h}">${l}</a>`).join('');

  return page('Dashboard', `
    <header class="d-top">
      <p class="d-label">West Peek Productions · Scooter</p>
      <h1>${line1}</h1>
      <p class="d-sub">${store.updated_at ? `Figures as of ${when(store.updated_at)} (Central).` : 'The store does not say when it was last updated.'}</p>
      ${banner}
    </header>
    ${sections.join('\n')}
    ${accountActions()}
    <nav class="d-tabs" aria-label="Dashboard sections">${tabs}</nav>`);
}

function renderFinance(f, now) {
  const tr = f.tracker || {};
  const targets = f.targets || [];
  const bar = (n, d) => (d ? Math.max(0, Math.min(100, Math.round((n / d) * 100))) : 0);
  const stretch = Math.max(0, ...targets.map((x) => Number(x.amount) || 0));
  const meters = [['Signed', tr.signed], ['Invoiced', tr.invoiced], ['Collected', tr.collected]].map(([label, n]) => `
    <div class="d-meter"><div class="d-meter__row"><span>${label}</span><span class="d-num">${money(n, { atLeast: tr.partial })}</span></div>
    <div class="d-meter__track"><span style="width:${bar(Number(n) || 0, stretch)}%"></span>${targets.map((x) => `<i style="left:${bar(Number(x.amount), stretch)}%" title="${esc(x.label)}"></i>`).join('')}</div></div>`).join('');
  const tracker = `<h3>Tracker: ${txt(tr.period)}</h3><p class="d-sub">${targets.map((x) => `${esc(x.label)} ${money(x.amount)}`).join(' · ')}</p>${meters}
    ${tr.note ? `<p class="d-sub">${esc(tr.note)}</p>` : ''}
    <h3>How the year could add up</h3>${table([
      ['Stream', (r) => txt(r.stream)], ['Assumption', (r) => txt(r.assumption)], ['A year', (r) => money(r.amount)]
    ], f.revenue_model || [], 'No revenue model is entered.')}`;

  const open = (f.invoices || []).filter((i) => i.status !== 'paid');
  const invoices = `<h3>Invoices due</h3>${table([
    ['Client', (r) => `${txt(r.client)}<span class="d-subcell">${txt(r.project)}</span>`],
    ['Amount', (r) => money(r.amount)],
    ['Due', (r) => { const d = daysSince(r.due, now); return `${day(r.due)}${d > 0 ? `<span class="d-subcell d-late">${d} day${d === 1 ? '' : 's'} late</span>` : ''}`; }],
    ['Status', (r) => txt(r.status)]
  ], open, 'No invoices are open.')}`;

  const aged = [['Not yet due', (d) => d === null || d <= 0], ['1–30 days', (d) => d > 0 && d <= 30], ['31–60 days', (d) => d > 30 && d <= 60], ['Over 60 days', (d) => d > 60]]
    .map(([label, test]) => { const rows = open.filter((i) => test(daysSince(i.due, now))); return `<li><span>${label}</span><span class="d-num">${money(sum(rows, 'amount'))}</span></li>`; }).join('');
  const agedSec = `<h3>Aged receivables</h3><ul class="d-kv">${aged}</ul>`;

  const receipts = `<h3>Expected receipts</h3>${table([
    ['Date', (r) => day(r.date)], ['From', (r) => txt(r.client)], ['Amount', (r) => money(r.amount)], ['How sure', (r) => txt(r.confidence)]
  ], [...(f.expected_receipts || [])].sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9'))), 'No receipts are expected.')}<p class="d-sub">A promised payment is not collected cash.</p>`;

  const fourWeeks = now + 28 * 86400000;
  const obligations = (f.vendor_obligations || []).filter((v) => !v.date || new Date(v.date).getTime() <= fourWeeks);
  const vendors = `<h3>Vendor obligations, next four weeks</h3>${table([
    ['Date', (r) => day(r.date)], ['Vendor', (r) => txt(r.vendor)], ['Project', (r) => txt(r.project)], ['Amount', (r) => money(r.amount)], ['Note', (r) => txt(r.note)]
  ], obligations, 'No vendor payments are due in the next four weeks.')}`;

  const margin = `<h3>Project margin</h3>${table([
    ['Project', (r) => txt(r.project)], ['Contract', (r) => money(r.contract)],
    ['Direct costs', (r) => money(r.direct_costs, { atLeast: r.costs_partial })],
    ['Margin', (r) => (r.costs_partial || r.direct_costs == null || !r.contract ? '<span class="d-gap">incomplete: costs not all entered</span>' : `${Math.round(((r.contract - r.direct_costs) / r.contract) * 100)}%`)],
    ['Note', (r) => txt(r.note)]
  ], f.project_margin || [], 'No projects are entered.')}${f.margin_target ? `<p class="d-sub">Target: ${esc(f.margin_target)}</p>` : ''}`;

  const cash = f.cash || {};
  const cashSec = `<h3>Rolling cash</h3><ul class="d-kv"><li><span>Bank cash</span><span class="d-num">${money(cash.bank_cash)}</span></li></ul>${table([
    ['Week of', (r) => day(r.week_of)], ['In', (r) => money(r.receipts)], ['Out', (r) => money(r.payments)],
    ['Closing', (r) => (Number(r.closing) < 0 ? `<span class="d-late">${money(r.closing)}</span>` : money(r.closing))]
  ], f.cash_weeks || [], 'The weekly cash view needs bank cash and payables; neither is entered yet.')}`;

  return section('money', 'Scooter only', 'Money', 'From each project binder’s Finance tabs. Never shown to clients or agents.',
    tracker + invoices + agedSec + receipts + vendors + margin + cashSec);
}

/* ------------------------------------------------------------------ pages */

const CSS = `
@font-face{font-family:'Maax';src:url('/assets/fonts/Maax-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Maax';src:url('/assets/fonts/Maax-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
:root{--ink:#0b0b0c;--ink-2:#131416;--ink-3:#1b1d20;--line:#2a2c30;--copy:#c9cacd;--muted:#9a9ca1;--white:#fff;--orange:#ff8500;--orange-ink:#1a0d00;--green:#5fd18b;--yellow:#f3c94b;--red:#ff6b6b;--red-wash:#3a1414;--font:'Maax','Helvetica Neue',Arial,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--white);font-family:var(--font);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;padding-bottom:84px}
main{max-width:760px;margin:0 auto;padding:24px 20px}
h1{font-size:21px;font-weight:700;margin:0 0 6px;line-height:1.3}
h2{font-size:18px;font-weight:700;margin:0 0 4px}
h3{font-size:16px;font-weight:700;margin:22px 0 6px}
a{color:var(--orange)}
:focus-visible{outline:3px solid var(--orange);outline-offset:3px;border-radius:4px}
.d-label{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.d-sub,.d-subcell{color:var(--muted);font-size:13px;margin:0 0 10px}
.d-subcell{display:block;margin:2px 0 0}
.d-gap{color:var(--yellow);font-size:13px}
.d-late{color:var(--red)}
.d-empty{color:var(--copy);margin:6px 0 0}
.d-warn{color:var(--yellow)}
.d-num{font-family:var(--mono)}
.d-top{padding:8px 0 18px;border-bottom:1px solid var(--line)}
.d-alarm{display:block;margin-top:12px;padding:10px 14px;border-radius:10px;background:var(--red-wash);color:var(--red);text-decoration:none;min-height:44px}
.d-sec{padding:26px 0;border-bottom:1px solid var(--line);scroll-margin-top:12px}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;font-weight:400;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:10px 8px;border-bottom:1px solid var(--ink-3);vertical-align:top;overflow-wrap:anywhere}
.d-funnel{list-style:none;margin:8px 0 14px;padding:0;display:grid;gap:4px}
.d-stage{display:grid;grid-template-columns:2.6rem 1fr;align-items:baseline;padding:6px 10px;background:var(--ink-2);border-radius:8px}
.d-stage .d-subcell{grid-column:2}
.d-stage__n{font-family:var(--mono);font-size:16px}
.d-state{display:inline-block;margin:4px 0 8px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);font-family:var(--mono);font-size:13px}
.d-state--off{color:var(--muted)}
.d-kv{list-style:none;margin:0;padding:0}
.d-kv li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--ink-3)}
.d-meter{margin:10px 0}
.d-meter__row{display:flex;justify-content:space-between}
.d-meter__track{position:relative;height:10px;background:var(--ink-3);border-radius:999px;margin-top:4px}
.d-meter__track span{position:absolute;inset:0 auto 0 0;background:var(--orange);border-radius:999px}
.d-meter__track i{position:absolute;top:-3px;width:2px;height:16px;background:var(--copy)}
.d-out{margin:28px 0;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.d-btn{display:inline-flex;align-items:center;text-decoration:none}
.d-hint{margin:6px 0 0}
.d-alt{margin-top:18px}
.d-alt a{display:inline-block;padding:10px 0;min-height:44px}
button,.d-btn{font:inherit;min-height:44px;padding:10px 18px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--white);cursor:pointer}
.d-primary{background:var(--orange);border-color:var(--orange);color:var(--orange-ink);font-weight:700}
.d-tabs{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:4px;background:rgba(11,11,12,.95);border-top:1px solid var(--line);padding:8px 8px calc(8px + env(safe-area-inset-bottom))}
.d-tabs a{flex:1;max-width:160px;text-align:center;color:var(--copy);text-decoration:none;padding:12px 6px;border-radius:10px;min-height:44px}
.d-tabs a:hover{background:var(--ink-3);color:var(--white)}
.d-login{max-width:420px;margin:12vh auto 0}
.d-login label{display:block;margin:18px 0 6px}
.d-login input{width:100%;font:inherit;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--ink-2);color:var(--white);min-height:44px}
.d-login .d-primary{margin-top:14px;width:100%}
@media (max-width:640px){
 table.phone-cards thead{display:none}
 table.phone-cards,table.phone-cards tbody,table.phone-cards tr,table.phone-cards td{display:block;width:100%}
 table.phone-cards tr{background:var(--ink-2);border-radius:12px;padding:6px 12px;margin:0 0 10px}
 table.phone-cards td{display:grid;grid-template-columns:8rem 1fr;gap:8px;border-bottom:1px solid var(--ink-3);padding:8px 0}
 table.phone-cards td:last-child{border-bottom:0}
 table.phone-cards td::before{content:attr(data-label);font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

/** Change password and Sign out (Scooter, 13 Nov 2026). */
function accountActions() {
  return `<div class="d-out"><a class="d-btn" href="/dashboard/password">Change password ›</a><form method="post" action="/dashboard/logout"><button type="submit">Sign out ›</button></form></div>`;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} · West Peek Productions</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

export function renderLogin({ message = '', configured = true, email = '' } = {}) {
  if (!configured) {
    return page('Dashboard', `<div class="d-login"><p class="d-label">West Peek Productions</p><h1>The dashboard is not switched on yet</h1><p class="d-sub">It opens once its private store is connected. Nothing is shown until then.</p></div>`);
  }
  return page('Sign in', `<form class="d-login" method="post" action="/dashboard/login">
    <p class="d-label">West Peek Productions</p><h1>Dashboard</h1>
    ${message ? `<p class="d-warn" role="alert">${esc(message)}</p>` : ''}
    <label for="em">Your email</label>
    <input id="em" name="email" type="email" autocomplete="username" value="${esc(email)}" required autofocus>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required>
    <button type="submit" class="d-primary">Open the dashboard ›</button>
    <p class="d-sub d-alt"><a href="/dashboard/forgot">Forgot it? ›</a></p></form>`);
}

export function renderChoose({ stage, message = '' }) {
  const first = stage === 'choose';
  return page('Choose your password', `<form class="d-login" method="post" action="/dashboard/password">
    <p class="d-label">West Peek Productions</p><h1>${first ? 'Choose your own password' : 'Change your password'}</h1>
    <p class="d-sub">${first ? 'The one-time password has now been used and will not work again. Choose the password you will sign in with from now on.' : 'Signs you out everywhere else.'}</p>
    ${message ? `<p class="d-warn" role="alert">${esc(message)}</p>` : ''}
    ${first ? '' : '<label for="cur">Your current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>'}
    <label for="np">New password</label>
    <input id="np" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required ${first ? 'autofocus' : ''}>
    <p class="d-sub d-hint">At least ${MIN_PASSWORD} characters.</p>
    <label for="np2">The same password again</label>
    <input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
    <button type="submit" class="d-primary">${first ? 'Save it and open the dashboard ›' : 'Save the new password ›'}</button>
    ${first ? '' : '<p class="d-sub d-alt"><a href="/dashboard">← Back to the dashboard</a></p>'}</form>`);
}

export function renderForgot({ sent = false, message = '' } = {}) {
  if (sent) {
    return page('Forgot it?', `<div class="d-login"><p class="d-label">West Peek Productions</p><h1>Check your firm email</h1>
      <p class="d-sub">If that is Scooter's firm email, a one-time password is on its way to it. It works once; then you choose your own.</p>
      <p class="d-sub d-alt"><a href="/dashboard">← Back to sign in</a></p></div>`);
  }
  return page('Forgot it?', `<form class="d-login" method="post" action="/dashboard/forgot">
    <p class="d-label">West Peek Productions</p><h1>Get a one-time password</h1>
    <p class="d-sub">It goes to your own firm email only.</p>
    ${message ? `<p class="d-warn" role="alert">${esc(message)}</p>` : ''}
    <label for="em">Your firm email</label>
    <input id="em" name="email" type="email" autocomplete="username" required autofocus>
    <button type="submit" class="d-primary">Email me a one-time password ›</button>
    <p class="d-sub d-alt"><a href="/dashboard">← Back to sign in</a></p></form>`);
}

export function renderStoreState(state) {
  const words = {
    not_connected: 'The private store is not connected to this site yet, so there is nothing to show. Nothing here is a guess.',
    empty: 'The private store is connected but nothing has been loaded into it yet.',
    unreadable: 'The private store did not load just now. This is not the same as nothing to show: try again in a minute.'
  }[state];
  return page('Dashboard', `<header class="d-top"><p class="d-label">West Peek Productions · Scooter</p><h1>The dashboard has no figures to show yet</h1><p class="d-warn">${esc(words)}</p></header>
    ${accountActions()}`);
}

/* ------------------------------------------------------------------ handler */

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  // same-origin, never no-referrer: under no-referrer a browser posts the sign-in form with
  // "Origin: null", and the foreign-origin check below refused every real sign-in (13 Nov 2026,
  // Scooter on his iPhone: "That sign-in came from another site and was refused."). same-origin
  // still sends nothing to any other site.
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function html(body, status = 200, extra = {}) { return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...extra } }); }
function redirect(location, extra = {}) { return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, location, ...extra } }); }

function foreignOrigin(request, url) {
  // The browser's own word that the form came from this site wins (a page served before the
  // referrer-policy fix still posts "Origin: null").
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return false;
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host !== url.host; } catch { return true; }
}

async function formOf(request) {
  try { return await request.formData(); } catch { return new FormData(); }
}
const field = (form, name) => String(form.get(name) || '');

export async function handleDashboard({ request, env = {}, now = Date.now() }) {
  const url = new URL(request.url);
  // The three Pages projects share functions/: the dashboard exists on the Productions host only.
  if (siteForHost(url.hostname) !== 'productions') return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const path = url.pathname.replace(/\/+$/, '') || '/dashboard';
  const configured = dashboardConfigured(env);
  const post = request.method === 'POST';

  if (post && path === '/dashboard/logout') {
    return redirect('/dashboard', { 'set-cookie': `${COOKIE}=; ${cookieAttrs(0)}` });
  }

  if (post && path === '/dashboard/login') {
    if (!configured) return html(renderLogin({ configured: false }), 503);
    if (foreignOrigin(request, url)) return html(renderLogin({ message: 'That sign-in came from another site and was refused.' }), 403);
    if (await overLimit(request, 'login')) return html(renderLogin({ message: 'Too many tries from this connection. Wait 15 minutes and try again.' }), 429);
    const form = await formOf(request);
    const email = field(form, 'email').trim();
    const typed = field(form, 'password');
    const wrong = (status = 401) => html(renderLogin({ email, message: 'That email and password did not open the dashboard. Try again, or use Forgot it?' }), status);

    // No sign-in without an email: a password on its own opens nothing (Scooter, 13 Nov 2026).
    if (!email) { await hashSecret(typed); return wrong(); }
    const owners = await readOwners(env);
    if (!owners) return html(renderLogin({ email, message: 'Sign-in is not available right now. Try again in a minute.' }), 503);
    const [id, owner] = findOwner(owners, email, now);
    if (!owner) { await hashSecret(typed); return wrong(); } // same work as a real check
    if (ownerLocked(owner, now)) return html(renderLogin({ email, message: 'Too many wrong tries for this email. Wait 15 minutes, or use Forgot it?' }), 429);

    if (await secretMatches(typed, owner.pw)) {
      if (owner.fails) { delete owner.fails; await writeOwners(env, owners); }
      return redirect('/dashboard', { 'set-cookie': await sessionCookie(env, { id, gen: owner.gen || 0, stage: 'full' }, now) });
    }
    if (owner.otp && now < owner.otp.expires_at && await secretMatches(normalOtp(typed), owner.otp)) {
      // Used: it stops working at this moment, and the next screen is choosing a password.
      owner.otp = null;
      owner.gen = (owner.gen || 0) + 1;
      delete owner.fails;
      await writeOwners(env, owners);
      return redirect('/dashboard/password', { 'set-cookie': await sessionCookie(env, { id, gen: owner.gen, stage: 'choose' }, now) });
    }
    countFail(owner, now);
    await writeOwners(env, owners);
    return wrong();
  }

  if (path === '/dashboard/forgot') {
    if (!post) return html(renderForgot({}));
    if (!configured || !kvOf(env)) return html(renderForgot({ message: 'One-time passwords are not available right now. Try again later.' }), 503);
    if (foreignOrigin(request, url)) return html(renderForgot({ message: 'That request came from another site and was refused.' }), 403);
    if (await overLimit(request, 'forgot')) return html(renderForgot({ message: 'Too many tries from this connection. Wait 15 minutes and try again.' }), 429);
    const form = await formOf(request);
    const owners = await readOwners(env);
    const [id] = findOwner(owners, field(form, 'email'), now);
    // Sent only to the address on record for that owner, never to the address typed or any other.
    if (id) await issueOneTimePassword(env, owners, id, url.origin, now);
    return html(renderForgot({ sent: true }));
  }

  if (post && path === '/dashboard/password') {
    if (foreignOrigin(request, url)) return html(renderLogin({ message: 'That came from another site and was refused.' }), 403);
    const s = await sessionFromRequest(env, request, now);
    if (!s) return html(renderLogin({ configured }), configured ? 401 : 503);
    const form = await formOf(request);
    const next = field(form, 'password');
    const again = (message, status = 400) => html(renderChoose({ stage: s.stage, message }), status);
    if (s.stage === 'full' && !(await secretMatches(field(form, 'current'), s.owner.pw))) {
      countFail(s.owner, now);
      await writeOwners(env, s.owners);
      return again('Your current password was not right.', 401);
    }
    if (next.length < MIN_PASSWORD) return again(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next !== field(form, 'confirm')) return again('The two passwords were not the same. Type them again.');
    s.owner.pw = await hashSecret(next);
    s.owner.otp = null;
    s.owner.gen = (s.owner.gen || 0) + 1;
    delete s.owner.fails;
    await writeOwners(env, s.owners);
    return redirect('/dashboard', { 'set-cookie': await sessionCookie(env, { id: s.id, gen: s.owner.gen, stage: 'full' }, now) });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return html(renderLogin({ configured }), 405, { allow: 'GET, POST' });

  const session = await sessionFromRequest(env, request, now);
  if (!session) return html(renderLogin({ configured }), configured ? 401 : 503);
  // An owner who signed in with a one-time password sees nothing until a password is chosen.
  if (session.stage === 'choose' && path !== '/dashboard/password') return redirect('/dashboard/password');
  if (path === '/dashboard/password') {
    return html(renderChoose({ stage: session.stage }));
  }
  if (path !== '/dashboard') return redirect('/dashboard');
  const store = await readStore(env);
  if (store.state !== 'ok') return html(renderStoreState(store.state), store.state === 'unreadable' ? 503 : 200);
  return html(renderDashboard({ store, now }));
}
