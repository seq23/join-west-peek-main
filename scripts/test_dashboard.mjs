#!/usr/bin/env node
/**
 * The Productions dashboard gate (functions/_lib/productions-dashboard.mjs), executed.
 *
 * Scooter, 13 Nov 2026: "No dashboard page or data without the password ... finance view for
 * Scooter only ... Cold Email Log with sending off. Private figures never in the repo." And after
 * the second preview: "The Productions dashboard is for Scooter only. Remove the team sign-in
 * completely ... the owners list is Scooter alone."
 * Each case below states the behaviour it pins. The figures used are invented test markers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { handleDashboard, storeProblems, COLD_EMAIL_SENDING, hashSecret, OWNER_FAIL_LIMIT, OWNER_IDS, PROOF_OWNER_MAX_MS } from '../functions/_lib/productions-dashboard.mjs';

const failures = [];
let cases = 0;
function check(name, cond, detail = '') {
  cases += 1;
  if (!cond) failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
}

const TEAM_MARK = 'TEAMROW-7731';
const FIN_MARK = 'FINROW-4412';
const DATA_KEYS = ['team', 'finance', 'meta'];
const OWNER_A = 'owner-a@example.test'; // Scooter's record
const OWNER_B = 'owner-b@example.test'; // a record left in the store under an id NOT on the owners list
const A_PW = 'owner-a-own-password';
const A_PW_REC = await hashSecret(A_PW);
const B_PW = 'owner-b-own-password';
const B_PW_REC = await hashSecret(B_PW);
/** Scooter with no password yet, the state a one-time password starts from. */
const FRESH = { owners: JSON.stringify({ scooter: { name: 'Owner A', email: OWNER_A, pw: null, otp: null, gen: 0 } }) };
function kv(over = {}) {
  const m = new Map(Object.entries({
    meta: JSON.stringify({ updated_at: '2026-11-13T15:00:00Z' }),
    team: JSON.stringify({
      projects: [{ name: TEAM_MARK, client: 'Client A', status: 'In delivery', next_milestone: 'Sprint 2', due: '2026-12-01', lead: 'Lead A' }],
      waiting_on_client: [], proposals_out: [], agent_log: [],
      agent_drafts: [{ project: 'P', document: 'Draft A', agent: 'Notes agent', drafted: '2026-11-12T10:00:00Z', status: 'waiting' }],
      opportunities: [{ organization: 'Org A', stage: 'Discovery', next_action: 'Call', owner: 'Scooter', target_date: '2026-11-20' }],
      cold_email_log: []
    }),
    finance: JSON.stringify({
      tracker: { period: '2027', signed: 100, invoiced: 50, collected: 25 },
      targets: [{ label: 'Floor', amount: 1000 }], revenue_model: [], pipeline_values: [],
      invoices: [{ client: FIN_MARK, project: 'P', amount: 777, due: '2026-11-01', status: 'sent' }],
      expected_receipts: [], vendor_obligations: [], project_margin: [], cash_weeks: [], cash: {}
    }),
    owners: JSON.stringify({
      scooter: { name: 'Owner A', email: OWNER_A, pw: A_PW_REC, otp: null, gen: 0 },
      sequoia: { name: 'Owner B', email: OWNER_B, pw: B_PW_REC, otp: null, gen: 0 }
    }),
    ...over
  }));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, reads: [], map: m };
}
function trackedKv(over) {
  const store = kv(over);
  const get = store.get;
  store.get = async (k) => { store.reads.push(k); return get(k); };
  return store;
}
const dataReads = (env) => env.PRODUCTIONS_DASHBOARD.reads.filter((k) => DATA_KEYS.includes(k));
// The site's mail sender (channel 1, the forms-mailer Worker), stubbed: every email it is asked to send.
function ENV(over) {
  const sent = [];
  return {
    PRODUCTIONS_DASHBOARD: trackedKv(over),
    FORMS_MAILER: { fetch: async (u, init) => { sent.push({ path: new URL(u).pathname, ...JSON.parse(init.body) }); return new Response('{"ok":true}'); } },
    FORMS_MAILER_SECRET: 'mailer-secret',
    sent
  };
}
const HOST = 'https://westpeekproductions.com';
const NOW = Date.parse('2026-11-13T16:00:00Z');

async function call(path, { method = 'GET', env = ENV(), cookie, form, origin, host = HOST, now = NOW } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (origin) headers.set('origin', origin);
  let body;
  if (form) { body = new URLSearchParams(form); headers.set('content-type', 'application/x-www-form-urlencoded'); }
  const res = await handleDashboard({ request: new Request(`${host}${path}`, { method, headers, body }), env, now });
  return { res, text: await res.text(), env, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(password, env = ENV(), email = '', now = NOW) {
  const r = await call('/dashboard/login', { method: 'POST', form: { email, password }, env, origin: HOST, now });
  return { ...r, env };
}
const owners = (env) => JSON.parse(env.PRODUCTIONS_DASHBOARD.map.get('owners'));
const codeIn = (mail) => (mail?.text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/) || [])[0];

// 1. Signed out: no page and no data; the figures are never read.
{
  const { res, text, env } = await call('/dashboard');
  check('anonymous GET is refused', res.status === 401, `status ${res.status}`);
  check('anonymous GET shows no data', !text.includes(TEAM_MARK) && !text.includes(FIN_MARK));
  check('anonymous GET never reads the figures', dataReads(env).length === 0, dataReads(env).join(','));
  check('dashboard is never cached or indexed', res.headers.get('cache-control')?.includes('no-store') && res.headers.get('x-robots-tag')?.includes('noindex'));
  check('sign-in screen asks for email and password and offers Forgot it?', text.includes('name="email"') && text.includes('name="password"') && text.includes('href="/dashboard/forgot"'));
}
// 2. Wrong passwords refused, no cookie.
{
  const r = await login('guess', ENV(), OWNER_A);
  check('wrong owner password is refused', r.res.status === 401 && !r.cookie.includes('.'));
  const r2 = await login(A_PW, ENV(), 'stranger@example.test');
  check('an unknown email opens nothing, even with the owner\'s password', r2.res.status === 401 && !r2.cookie.includes('.'));
}
// 3. No sign-in without an email (Scooter, 13 Nov 2026: "no team password, no team view, no sign-in
//    without an email"): a password on its own opens nothing, whoever's it is, and reads no figures.
{
  for (const [name, pw] of [['the owner\'s own password', A_PW], ['any password', 'team-pass'], ['an empty password', '']]) {
    const r = await login(pw);
    check(`${name} typed without an email opens nothing`, r.res.status === 401 && !r.cookie.includes('.') && dataReads(r.env).length === 0, `${r.res.status} ${r.cookie}`);
  }
  // The dashboard reads no password setting at all: every env name it touches is recorded.
  const touched = new Set();
  const base = ENV();
  const watched = new Proxy(base, { get: (t, k) => { if (typeof k === 'string') touched.add(k); return t[k]; } });
  await login('team-pass', watched);
  await login(A_PW, watched, OWNER_A);
  const { cookie } = await login(A_PW, base, OWNER_A);
  await call('/dashboard', { cookie, env: watched });
  await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, env: watched, origin: HOST });
  const pwSettings = [...touched].filter((k) => /PASSWORD/i.test(k));
  check('the dashboard reads no password setting (no team or shared owner password exists)', touched.size > 0 && pwSettings.length === 0, pwSettings.join(','));
  const signIn = (await call('/dashboard')).text;
  check('the sign-in screen requires an email', /<input id="em" name="email"[^>]* required/.test(signIn));
}
// 4. An owner's own email and own password: everything, Money included, plus Change password.
{
  const { cookie, env, res } = await login(A_PW, ENV(), ' Owner-A@Example.test ');
  check('owner email (any case) and own password sign in', res.status === 303 && cookie.startsWith('wpp_dash=owner~scooter~0~full.'), cookie);
  const { text } = await call('/dashboard', { cookie, env });
  check('owner sees Money', text.includes('id="money"') && text.includes(FIN_MARK));
  check('owner line 1 counts the draft and the overdue invoice', text.includes('2 need you'), text.match(/<h1>[^<]*/)?.[0]);
  check('owner dashboard links to Change password', text.includes('href="/dashboard/password"') && text.includes('Change password'));
  check('the dashboard is labelled for Scooter alone', text.includes('West Peek Productions · Scooter<') && !/Sequoia|Team view/.test(text));
  for (const id of ['work', 'waiting', 'proposals', 'money', 'funnel', 'cold', 'drafts', 'activity']) check(`owner view has section ${id}`, text.includes(`id="${id}"`));
}
// 5. The owners list is Scooter alone: a record under any other id opens nothing, even with its own
//    email and its own password, and is never sent a one-time password.
{
  check('the owners list is Scooter alone', OWNER_IDS.length === 1 && OWNER_IDS[0] === 'scooter', OWNER_IDS.join(','));
  const b = await login(B_PW, ENV(), OWNER_B);
  check('a record not on the owners list does not sign in with its own password', b.res.status === 401 && !b.cookie.includes('.') && dataReads(b.env).length === 0);
  const env = ENV();
  await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_B }, env, origin: HOST });
  check('Forgot it? sends nothing to a record not on the owners list', env.sent.length === 0);
  const a = await login(A_PW, ENV(), OWNER_A);
  check('Scooter\'s own email and password still sign in', a.res.status === 303 && a.cookie.includes('wpp_dash=owner~scooter~'));
  // A session for that record, carrying a valid signature, still opens nothing.
  const { sessionCookie } = await import('../functions/_lib/productions-dashboard.mjs');
  const forged = (await sessionCookie(a.env, { id: 'sequoia', gen: 0, stage: 'full' }, NOW)).split(';')[0];
  check('a validly signed session for a record not on the owners list is refused', (await call('/dashboard', { cookie: forged, env: a.env })).res.status === 401);
  // dashboard:owners' throwaway proof owner opens only for its short window.
  const proof = (until) => ENV({ owners: JSON.stringify({ 'proof-x': { name: 'P', email: 'proof-x@example.invalid', pw: A_PW_REC, gen: 0, proof_until: until } }) });
  check('a proof owner opens inside its window', (await login(A_PW, proof(NOW + 60000), 'proof-x@example.invalid')).res.status === 303);
  check('a proof owner opens nothing after its window', (await login(A_PW, proof(NOW - 1), 'proof-x@example.invalid')).res.status === 401);
  check('a proof owner with a window longer than the limit opens nothing', (await login(A_PW, proof(NOW + PROOF_OWNER_MAX_MS + 60000), 'proof-x@example.invalid')).res.status === 401);
}
// 6. A forged or tampered cookie opens nothing.
{
  const env = ENV();
  const { cookie: c0 } = await login(A_PW, env, OWNER_A);
  const [, exp, sig] = c0.split('.');
  const { res, text } = await call('/dashboard', { cookie: `wpp_dash=team.${exp}.${sig}`, env });
  check('an old-style team cookie opens nothing', res.status === 401 && !text.includes(FIN_MARK));
  const longer = c0.replace(/\.(\d+)\./, (_, e) => `.${Number(e) + 99999}.`);
  check('a cookie with its expiry edited is refused', (await call('/dashboard', { cookie: longer, env })).res.status === 401);
  const fresh = trackedKv();
  const { cookie: oc } = await login(A_PW, env, OWNER_A);
  const { res: r3 } = await call('/dashboard', { cookie: oc, env: { ...env, PRODUCTIONS_DASHBOARD: fresh } });
  check('a session signed with another store\'s key is refused', r3.status === 401);
}
// 7. The one-time password: emailed to that owner's own address only, used once, forces a password.
{
  const env = ENV(FRESH);
  const logs = [];
  const orig = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  const f = await call('/dashboard/forgot', { method: 'POST', form: { email: ' OWNER-A@example.test' }, env, origin: HOST });
  const stranger = await call('/dashboard/forgot', { method: 'POST', form: { email: 'stranger@example.test' }, env, origin: HOST });
  [console.log, console.error] = orig;
  check('Forgot it? answers the same whoever asks', f.res.status === 200 && stranger.res.status === 200 && f.text === stranger.text);
  check('exactly one email, to the owner\'s own address only', env.sent.length === 1 && env.sent[0].to === OWNER_A, JSON.stringify(env.sent.map((m) => m.to)));
  const mail = env.sent[0];
  const code = codeIn(mail);
  check('the email carries a one-time password and the link', Boolean(code) && mail.text.includes(`${HOST}/dashboard`));
  check('the email says it works once, they choose their own on the first screen, nothing live without Scooter\'s yes',
    /works once/.test(mail.text) && /first screen you choose your own/.test(mail.text) && mail.text.includes("Nothing goes live without Scooter's yes"));
  check('the email has no apology and nothing about earlier', !/sorry|apolog|earlier|previous|before now/i.test(`${mail.subject} ${mail.text}`));
  check('no owner email address is logged', !logs.some((l) => l.includes('@')), logs.join(' | '));
  const stored = env.PRODUCTIONS_DASHBOARD.map.get('owners');
  check('the one-time password is stored only as a salted hash', !stored.includes(code) && !stored.includes(code.replace(/-/g, '')) && Boolean(owners(env).scooter.otp?.salt));
  check('it lasts 7 days', owners(env).scooter.otp?.expires_at - NOW === 7 * 86400000);

  const again = await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, env, origin: HOST, now: NOW + 60000 });
  check('a second Forgot it? within 5 minutes sends nothing more', again.res.status === 200 && env.sent.length === 1);

  // A send that did not deliver does not start the gap: once the sender exists, the next try goes out.
  {
    const bare = ENV(FRESH);
    delete bare.FORMS_MAILER; delete bare.FORMS_MAILER_SECRET;
    const logs0 = [console.log, console.error];
    console.log = () => {}; console.error = () => {};
    await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, env: bare, origin: HOST });
    const undelivered = owners(bare).scooter.last_issue?.by;
    const withSender = { ...ENV(FRESH), PRODUCTIONS_DASHBOARD: bare.PRODUCTIONS_DASHBOARD };
    await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, env: withSender, origin: HOST, now: NOW + 60000 });
    [console.log, console.error] = logs0;
    check('an undelivered one-time password is recorded as not_configured', undelivered === 'not_configured', String(undelivered));
    check('a Forgot it? right after an undelivered one sends at once', withSender.sent.length === 1 && withSender.sent[0].to === OWNER_A && owners(withSender).scooter.last_issue?.by === 'cloudflare');
  }

  const first = await login(code.toLowerCase(), env, OWNER_A);
  check('the one-time password signs in straight to choosing a password', first.res.status === 303 && first.res.headers.get('location') === '/dashboard/password' && first.cookie.includes('~choose.'), first.cookie);
  const before = dataReads(env).length;
  const peek = await call('/dashboard', { cookie: first.cookie, env });
  check('nothing is shown before a password is chosen', peek.res.status === 303 && peek.res.headers.get('location') === '/dashboard/password' && !peek.text.includes(TEAM_MARK) && dataReads(env).length === before);
  const choose = await call('/dashboard/password', { cookie: first.cookie, env });
  check('the first screen asks for a new password', choose.res.status === 200 && choose.text.includes('Choose your own password') && !choose.text.includes('name="current"'));
  const reuse = await login(code, env, OWNER_A);
  check('the one-time password stops working the moment it is used', reuse.res.status === 401 && !reuse.cookie.includes('.'));

  const short = await call('/dashboard/password', { method: 'POST', cookie: first.cookie, env, origin: HOST, form: { password: 'short', confirm: 'short' } });
  check('a password under 12 characters is refused', short.res.status === 400 && !owners(env).scooter.pw);
  const differ = await call('/dashboard/password', { method: 'POST', cookie: first.cookie, env, origin: HOST, form: { password: 'owner-a-x-new-password', confirm: 'owner-a-x-other-password' } });
  check('two different passwords are refused', differ.res.status === 400 && !owners(env).scooter.pw);
  const set = await call('/dashboard/password', { method: 'POST', cookie: first.cookie, env, origin: HOST, form: { password: 'owner-a-x-new-password', confirm: 'owner-a-x-new-password' } });
  check('choosing a password opens the dashboard', set.res.status === 303 && set.cookie.includes('~full.'));
  check('the password is stored only as a salted hash', !env.PRODUCTIONS_DASHBOARD.map.get('owners').includes('owner-a-x-new-password') && Boolean(owners(env).scooter.pw?.salt));
  const view = await call('/dashboard', { cookie: set.cookie, env });
  check('Scooter sees everything, Money included', view.res.status === 200 && view.text.includes('id="money"') && view.text.includes(FIN_MARK));
  const stale = await call('/dashboard', { cookie: first.cookie, env });
  check('the choose-password session ends once a password is chosen', stale.res.status === 401);
  const own = await login('owner-a-x-new-password', env, OWNER_A);
  check('the chosen password signs in afterwards', own.res.status === 303 && own.cookie.includes('~full.'));
}
// 8. A one-time password not used within 7 days stops working.
{
  const env = ENV(FRESH);
  await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, env, origin: HOST });
  const code = codeIn(env.sent[0]);
  const late = await login(code, env, OWNER_A, NOW + 7 * 86400000 + 1000);
  check('a one-time password older than 7 days is refused', late.res.status === 401 && !late.cookie.includes('.'));
  const intime = await login(code, env, OWNER_A, NOW + 6 * 86400000);
  check('the same one-time password works inside 7 days', intime.res.status === 303);
}
// 9. Change password: needs the current one, and signs the old session out.
{
  const env = ENV();
  const { cookie } = await login(A_PW, env, OWNER_A);
  const wrong = await call('/dashboard/password', { method: 'POST', cookie, env, origin: HOST, form: { current: 'nope', password: 'owner-a-second-password', confirm: 'owner-a-second-password' } });
  check('change password refuses a wrong current password', wrong.res.status === 401);
  const ok = await call('/dashboard/password', { method: 'POST', cookie, env, origin: HOST, form: { current: A_PW, password: 'owner-a-second-password', confirm: 'owner-a-second-password' } });
  check('change password saves and keeps the owner signed in', ok.res.status === 303 && ok.cookie.includes('~full.'));
  check('the old session is signed out by the change', (await call('/dashboard', { cookie, env })).res.status === 401);
  check('the old password stops working', (await login(A_PW, env, OWNER_A)).res.status === 401);
  check('the new password works', (await login('owner-a-second-password', env, OWNER_A)).res.status === 303);
  check('signed out, Change password is refused', (await call('/dashboard/password', { method: 'POST', env, origin: HOST, form: { password: 'x'.repeat(20), confirm: 'x'.repeat(20) } })).res.status === 401);
}
// 10. Wrong tries are rate-limited per owner.
{
  const env = ENV();
  for (let i = 0; i < OWNER_FAIL_LIMIT; i += 1) await login(`wrong-${i}`, env, OWNER_A);
  const locked = await login(A_PW, env, OWNER_A);
  check(`after ${OWNER_FAIL_LIMIT} wrong tries even the right password waits`, locked.res.status === 429 && !locked.cookie.includes('.'));
  const later = await login(A_PW, env, OWNER_A, NOW + 16 * 60000);
  check('the owner lock lifts after 15 minutes', later.res.status === 303);
}
// 11. Not switched on: no private store → shut, nothing read.
{
  const env = {};
  const { res, text } = await call('/dashboard', { env });
  check('unconfigured dashboard is shut', res.status === 503 && text.includes('not switched on'));
  const { res: r2 } = await call('/dashboard/login', { method: 'POST', form: { password: '' }, env });
  check('unconfigured login refuses', r2.status === 503 && !r2.headers.get('set-cookie'));
  const kvOnly = { PRODUCTIONS_DASHBOARD: trackedKv({ owners: JSON.stringify({}) }) };
  const r3 = await login('anything', kvOnly);
  const r4 = await login('anything', kvOnly, OWNER_A);
  check('a store with no owners opens nothing', r3.res.status === 401 && r4.res.status === 401 && dataReads(kvOnly).length === 0);
}
// 12. Only the Productions host serves it (Functions are shared with the other two sites).
for (const host of ['https://joinwestpeek.com', 'https://westpeek.ventures', 'https://x.west-peek-community.pages.dev']) {
  const { res } = await call('/dashboard', { host });
  check(`${host} has no dashboard`, res.status === 404, `status ${res.status}`);
  const { res: f } = await call('/dashboard/forgot', { host, method: 'POST', form: { email: OWNER_A } });
  check(`${host} issues no one-time password`, f.status === 404);
}
{
  const { res } = await call('/dashboard', { host: 'https://work-x.west-peek-productions.pages.dev' });
  check('a productions preview serves the gate', res.status === 401);
}
// 13. A sign-in, Forgot it? or password change posted from another site is refused.
{
  const { res } = await call('/dashboard/login', { method: 'POST', form: { email: OWNER_A, password: A_PW }, origin: 'https://evil.example' });
  check('cross-site sign-in is refused', res.status === 403 && !res.headers.get('set-cookie'));
  const env = ENV();
  const { res: f } = await call('/dashboard/forgot', { method: 'POST', form: { email: OWNER_A }, origin: 'https://evil.example', env });
  check('cross-site Forgot it? is refused and sends nothing', f.status === 403 && env.sent.length === 0);
}
// 14. A store that is not connected is said, never shown as all clear.
{
  const env = ENV();
  const { cookie } = await login(A_PW, env, OWNER_A);
  env.PRODUCTIONS_DASHBOARD.map.delete('team'); // the store holds the sign-in but no figures yet
  const { text } = await call('/dashboard', { cookie, env });
  check('a store with no figures is named, never shown as all clear', /no figures to show/.test(text) && !text.includes('Nothing needs you'), text.slice(0, 200));
  const gone = await call('/dashboard', { cookie, env: { ...env, PRODUCTIONS_DASHBOARD: undefined } });
  check('a disconnected store shuts the dashboard', gone.res.status === 503 && !gone.text.includes(FIN_MARK));
}
// 15. Sending is off; the Cold Email Log says so.
{
  check('cold email sending is off in code', COLD_EMAIL_SENDING === false);
  const { cookie, env } = await login(A_PW, ENV(), OWNER_A);
  const { text } = await call('/dashboard', { cookie, env });
  check('Cold Email Log shows sending off and the cap', text.includes('Sending off') && text.includes('of 25 this week'));
}
// 16. Store text is escaped.
{
  const env = ENV();
  env.PRODUCTIONS_DASHBOARD = trackedKv({ team: JSON.stringify({ projects: [{ name: '<script>x</script>' }], waiting_on_client: [], proposals_out: [], agent_drafts: [], agent_log: [], opportunities: [], cold_email_log: [] }) });
  const { cookie } = await login(A_PW, env, OWNER_A);
  const { text } = await call('/dashboard', { cookie, env });
  check('store text is escaped', !text.includes('<script>x') && text.includes('&lt;script&gt;'));
}
// 17. The owners' addresses are never in this public repo's dashboard code.
for (const f of ['functions/_lib/productions-dashboard.mjs', 'scripts/dashboard_owners.mjs']) {
  check(`${f} carries no firm email address`, !/[a-z0-9._-]+@westpeek\.ventures/i.test(readFileSync(f, 'utf8')));
}
// 12. The store validator refuses a broken document (used by dashboard:store before any write).
check('storeProblems refuses a document with no finance part', storeProblems({ team: {} }).length > 0);
check('storeProblems refuses an unknown funnel stage', storeProblems({ team: { opportunities: [{ organization: 'A', stage: 'Maybe' }] }, finance: {} }).some((p) => p.includes('unknown stage')));

// 13. No private store document is committed: nothing in the repo carries the store's shape with data.
{
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.json$/i.test(name)) {
        const s = readFileSync(p, 'utf8');
        if (s.includes('"cold_email_log"') || s.includes('"vendor_obligations"')) hits.push(p);
      }
    }
  };
  walk('.');
  check('no dashboard store file is committed to this public repo', hits.length === 0, hits.join(', '));
}

// 14. dashboard:store survives a passing Cloudflare 503 (13 Nov 2026: one 503 on GET
//     pages/projects failed the first preview load) and still stops on a real refusal.
{
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { TEAM_LISTS, FINANCE_LISTS } = await import('../functions/_lib/productions-dashboard.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wpp-store-'));
  const file = join(dir, 'store.json');
  writeFileSync(file, JSON.stringify({
    team: Object.fromEntries(TEAM_LISTS.map((k) => [k, []])),
    finance: Object.fromEntries(FINANCE_LISTS.map((k) => [k, []]))
  }));
  const run = async (failures, opts = {}) => {
    const left = { ...failures };
    const writes = [];
    const server = createServer((req, res) => {
      const key = `${req.method} ${req.url.split('?')[0].replace(/^\/accounts\/acct/, '')}`;
      const send = (status, result) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, result, errors: status < 400 ? [] : [{ code: status }] })); };
      if (left[key]?.length) return send(left[key].shift(), null);
      if (key === 'GET /storage/kv/namespaces') return send(200, [{ id: 'ns1', title: 'west-peek-productions-dashboard-preview' }]);
      if (key === 'GET /pages/projects/west-peek-productions' && opts.unbound) return send(200, { deployment_configs: { preview: {} } });
      if (key === 'PATCH /pages/projects/west-peek-productions') { writes.push(key); return send(200, {}); }
      if (key === 'GET /pages/projects/west-peek-productions') return send(200, { deployment_configs: { preview: { kv_namespaces: { PRODUCTIONS_DASHBOARD: { namespace_id: 'ns1' } } } } });
      if (key === 'PUT /storage/kv/namespaces/ns1/bulk') { writes.push(key); return send(200, null); }
      return send(404, null);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const out = await new Promise((r) => {
      const p = spawn(process.execPath, ['scripts/dashboard_store.mjs', '--env', 'preview', '--file', file], {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_BASE: `http://127.0.0.1:${server.address().port}`, DASHBOARD_STORE_RETRY_MS: '1,1,1,1' }
      });
      let text = '';
      let err = '';
      p.stdout.on('data', (d) => { text += d; });
      p.stderr.on('data', (d) => { text += d; err += d; });
      p.on('close', (status) => r({ status, text, err }));
    });
    server.close();
    return { ...out, writes };
  };
  const passing = await run({ 'GET /pages/projects/west-peek-productions': [503] });
  check('dashboard:store retries a passing Cloudflare 503 and writes the store', passing.status === 0 && passing.writes.length === 1 && passing.text.includes('OUTPUT dashboard:store'), passing.text.trim());
  const lastErr = passing.err.trim().split('\n').pop();
  check('dashboard:store ends stderr with the OUTPUT line after retries, so a one-line record reads as success', lastErr.startsWith('OUTPUT dashboard:store') && passing.err.includes('retry 1/'), lastErr);
  const refused = await run({ 'GET /storage/kv/namespaces': [403] });
  check('dashboard:store stops on a refusal without writing', refused.status === 1 && refused.writes.length === 0 && !refused.text.includes('OUTPUT'), refused.text.trim());
  const outage = await run({ 'GET /pages/projects/west-peek-productions': [503, 503, 503, 503, 503] });
  check('dashboard:store loads the figures before a lasting Pages outage and says only the binding is left', outage.status === 1 && outage.writes.length === 1 && outage.text.includes('figures ARE loaded') && !outage.text.includes('OUTPUT'), outage.text.trim());
  const unbound = await run({}, { unbound: true });
  check('dashboard:store writes the figures and then adds a missing binding', unbound.status === 0 && unbound.writes.join() === 'PUT /storage/kv/namespaces/ns1/bulk,PATCH /pages/projects/west-peek-productions' && unbound.text.includes('binding=added'), unbound.text.trim());
}

if (cases === 0) { console.error('test_dashboard: NAMED STOP - zero cases ran'); process.exit(2); }
if (failures.length) {
  console.error(`test_dashboard: ${failures.length} of ${cases} failed\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`OUTPUT test_dashboard: ${cases} cases passed`);
