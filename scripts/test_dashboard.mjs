#!/usr/bin/env node
/**
 * The Productions dashboard v1.0 (functions/_lib/productions-dashboard.mjs + functions/_lib/pd/),
 * executed against a real SQLite standing in for D1 and stubbed Google, Gmail and R2.
 *
 * Pins (Scooter, 13 Nov 2026, and the v1.0 rulings the same day): Scooter alone; no team sign-in;
 * a password without an email opens nothing; sessions are server rows, remembered 30 days, revoked
 * on sign-out; his pre-v1.0 password and cookie still work; quick actions write to the source row by
 * ID, re-read, and a write the sheet does not show is reported failed; preview sample mode and its
 * test identity never exist on production and never see real rows; refresh tokens are encrypted;
 * Disconnect revokes and deletes; a failed sync and a broken connection show on Today; the cron door
 * needs its secret; sending is off; a backup restores. Names and figures here are invented markers.
 */
import { fakeD1 } from './lib/fake_d1.mjs';
import { handleDashboard, hashSecret, COLD_EMAIL_SENDING, MIGRATIONS } from '../functions/_lib/productions-dashboard.mjs';
import { OWNER_IDS, SAMPLE_EMAIL, SAMPLE_PASSWORD, OWNER_FAIL_LIMIT } from '../functions/_lib/pd/auth.mjs';
import { ensureSchema, resetSchemaMemo, BACKUP_TABLES, TABLE_WORDS } from '../functions/_lib/pd/schema.mjs';
import { encryptJson } from '../functions/_lib/pd/core.mjs';
import { backup, restore } from '../workers/productions-dashboard/src/index.js';

const failures = [];
let cases = 0;
function check(name, cond, detail = '') { cases += 1; if (!cond) failures.push(`${name}${detail ? ` - ${detail}` : ''}`); }

const PROD = 'https://westpeekproductions.com';
const PREV = 'https://abc123.west-peek-productions.pages.dev';
const NOW = Date.parse('2026-11-14T16:00:00Z');
const OWNER = 'owner-a@example.test';
const OTHER = 'owner-b@example.test';
const PW = 'owner-a-own-password';
const MARK = 'REALROW-5521';
const TOKEN_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');

/* ------------------------------------------------------------------ stubs */

/** A Google stand-in: one Work spreadsheet held in memory, plus revoke and Gmail drafts. */
function fakeGoogle() {
  const g = {
    calls: [], revoked: [], drafts: [], dropWrites: false,
    sheets: {
      WORKSHEETID00000000000000001: {
        title: 'Work test sheet',
        tabs: {
          Projects: [['ID', 'Project', 'Client', 'Status', 'Next milestone', 'Milestone date'], ['P1', MARK, 'Client A', 'In delivery', 'Cut', '2026-11-16']],
          'Waiting on client': [['ID', 'Project ID', 'Waiting for', 'Since', 'Status', 'Contact email'], ['W1', 'P1', 'Logo files', '2026-10-28', 'Waiting', 'client-a@example.test'], ['W2', 'P1', 'Speaker list', '2026-11-10', 'Waiting', 'client-a@example.test']],
          Deals: [['ID', 'Organization', 'Stage', 'Owner'], ['D1', 'Org A', 'Discovery', 'Lead']],
          'Agent drafts': [['ID', 'Project', 'Document', 'Status'], ['A1', 'P1', 'Update draft', 'Waiting']]
        }
      }
    }
  };
  g.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    g.calls.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') { g.revoked.push(u.searchParams.get('token')); return json({}); }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('code') === 'bad') return json({ error: 'invalid_grant' }, 400);
      const claims = { iss: 'https://accounts.google.com', aud: 'gid', exp: Math.floor(NOW / 1000) + 3600, email_verified: true, email: p.get('code') === 'other' ? OTHER : OWNER };
      return json({ access_token: 'ACCESS-TOKEN-PLAIN', refresh_token: 'REFRESH-TOKEN-PLAIN', expires_in: 3600, id_token: `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`, scope: 'openid email' });
    }
    if (u.host === 'gmail.googleapis.com') { g.drafts.push(JSON.parse(init.body)); return json({ id: 'd1', message: { id: 'm1' } }); }
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop());
      const sheet = g.sheets[id];
      if (!sheet) return json({ error: { status: 'NOT_FOUND' } }, 404);
      return json({ name: sheet.title, webViewLink: `https://docs.google.com/spreadsheets/d/${id}/edit`, owners: [{ displayName: 'Owner A' }], permissions: sheet.perms || [{ type: 'user', role: 'owner', emailAddress: OWNER }] });
    }
    if (u.host === 'sheets.googleapis.com') {
      const [, , , id, rest] = u.pathname.split('/');
      const sheet = g.sheets[id];
      if (!sheet) return json({ error: { status: 'NOT_FOUND' } }, 404);
      if (!rest) return json({ properties: { title: sheet.title }, sheets: Object.keys(sheet.tabs).map((t) => ({ properties: { title: t } })) });
      if (rest === 'values:batchUpdate') {
        if (!g.dropWrites) {
          for (const d of JSON.parse(init.body).data) {
            const m = d.range.match(/^'(.+)'!([A-Z]+)(\d+)$/);
            const tab = sheet.tabs[m[1].replace(/''/g, "'")];
            const col = m[2].charCodeAt(0) - 65;
            g.cellsWritten = (g.cellsWritten || 0) + 1;
            tab[Number(m[3]) - 1][col] = d.values[0][0];
          }
        }
        return json({});
      }
      if (rest === 'values' && u.pathname.endsWith(':append')) {
        const range = decodeURIComponent(u.pathname.split('/values/')[1]);
        const tab = sheet.tabs[range.match(/^'(.+)'!/)[1].replace(/''/g, "'")];
        g.appended = (g.appended || 0) + 1;
        for (const line of JSON.parse(init.body).values) tab.push(line);
        return json({});
      }
      if (rest === 'values') {
        const range = decodeURIComponent(u.pathname.split('/values/')[1]);
        const tab = range.match(/^'(.+)'!/)[1].replace(/''/g, "'");
        return json({ values: sheet.tabs[tab] || [] });
      }
    }
    return json({ error: 'unexpected' }, 500);
  };
  return g;
}

function ENV({ google = false, kvOwners = null, kvSession = null } = {}) {
  const sent = [];
  const kv = new Map();
  if (kvOwners) kv.set('owners', JSON.stringify(kvOwners));
  if (kvSession) kv.set('session_key', kvSession);
  return {
    PRODUCTIONS_DB: fakeD1(),
    PRODUCTIONS_DASHBOARD: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) },
    FORMS_MAILER: { fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}'); } },
    FORMS_MAILER_SECRET: 'mailer-secret',
    PRODUCTIONS_TOKEN_KEY: TOKEN_KEY,
    ...(google ? { GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret' } : {}),
    sent
  };
}
// A refused sign-in is a 303 back to /dashboard with its message code and no cookie, so a reload never resubmits.
function refused(r, code) { const loc = r.location ?? r.headers?.get('location'); return r.status === 303 && loc === `/dashboard?signin=${code}` && !r.cookie; }
async function call(env, path, { method = 'GET', cookie = '', form, host = PROD, now = NOW, origin = true } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (origin && method === 'POST') headers.set('origin', host);
  let body;
  if (form) { body = new URLSearchParams(form); headers.set('content-type', 'application/x-www-form-urlencoded'); }
  const res = await handleDashboard({ request: new Request(`${host}${path}`, { method, headers, body }), env, now });
  const raw = res.headers.getSetCookie();
  const sc = raw.find((c) => /^wpp_s=[^;]+/.test(c) && !c.startsWith('wpp_s=;'));
  return { status: res.status, text: await res.text(), location: res.headers.get('location'), cookie: sc ? sc.split(';')[0] : '', rawCookie: sc || '' };
}
async function seedOwner(env, { pw = PW, otp = null } = {}) {
  const db = env.PRODUCTIONS_DB;
  await ensureSchema(db);
  await db.prepare('INSERT INTO owner (id, name, email, pw, otp, gen) VALUES (?,?,?,?,?,0)').bind('scooter', 'Owner A', OWNER, pw ? JSON.stringify(await hashSecret(pw)) : null, otp).run();
  await db.prepare('INSERT INTO owner (id, name, email, pw, gen) VALUES (?,?,?,?,0)').bind('sequoia', 'Owner B', OTHER, JSON.stringify(await hashSecret('owner-b-own-password'))).run();
}
const signIn = (env, email, password, { form = {}, ...extra } = {}) => call(env, '/dashboard/login', { ...extra, method: 'POST', form: { email, password, ...form } });

const realFetch = globalThis.fetch;

/* ------------------------------------------------------------------ cases */

// Hosts and the database.
{
  const env = ENV();
  check('other hosts 404', (await call(env, '/dashboard', { host: 'https://joinwestpeek.com' })).status === 404);
  check('no database: shut, 503, nothing shown', (await call({}, '/dashboard')).status === 503);
  check('the owners list is Scooter alone', OWNER_IDS.length === 1 && OWNER_IDS[0] === 'scooter');
  check('cold email sending is off', COLD_EMAIL_SENDING === false);
  const db = fakeD1();
  await ensureSchema(db); resetSchemaMemo(); await ensureSchema(db);
  check('migrations apply twice without harm', Number((await db.prepare('SELECT MAX(version) AS v FROM schema_version').first()).v) === MIGRATIONS.at(-1).version);
}

// Signed out, Google sign-in state.
{
  const env = ENV();
  await seedOwner(env);
  const r = await call(env, '/dashboard');
  check('signed out is 401 with the sign-in screen', r.status === 401 && /name="email"/.test(r.text));
  check('without Google app secrets, the not-set-up state links to the Help steps', /href="\/dashboard\/help#google-app"/.test(r.text) && !/action="\/dashboard\/google"/.test(r.text));
  const g = await call(ENV({ google: true }), '/dashboard');
  check('with them, Sign in with Google is offered', /action="\/dashboard\/google"/.test(g.text));
  const h = await call(env, '/dashboard/help');
  const hp = await call(env, '/dashboard/help', { host: PREV });
  for (const id of ['dropbox', 'docusign', 'quickbooks', 'xero']) {
    const part = hp.text.split(`id="app-${id}"`)[1]?.split('</ol>')[0] || '';
    check(`Help (${id}) names the production and the preview redirect URI`, part.includes('https://westpeekproductions.com/dashboard/oauth/callback') && part.includes(`${PREV}/dashboard/oauth/callback`));
  }
  check('Help opens signed out and holds no rows', h.status === 200 && /id="google-app"/.test(h.text) && !h.text.includes(MARK));
  check('the test identity is not offered on production', !r.text.includes(SAMPLE_PASSWORD));
}

// Password sign-in, sessions, sign-out.
{
  const env = ENV();
  await seedOwner(env);
  check('a password without an email opens nothing', refused(await signIn(env, '', PW), 'wrong'));
  check('a record off the owners list opens nothing', refused(await signIn(env, OTHER, 'owner-b-own-password'), 'wrong'));
  const plain = await signIn(env, OWNER, PW);
  check('Scooter signs in', plain.status === 303 && plain.cookie);
  check('without "remember", the cookie ends with the browser', !/Max-Age/.test(plain.rawCookie));
  const phone = await signIn(env, OWNER, PW, { form: { remember: '1' } });
  check('"remember this phone" keeps it 30 days', /Max-Age=2592000/.test(phone.rawCookie));
  const row = await env.PRODUCTIONS_DB.prepare('SELECT expires_at - created_at AS life FROM session WHERE remember = 1').first();
  check('the remembered session row lives 30 days on the server', Number(row.life) === 30 * 86400000);
  check('the cookie value is not stored, only its hash', !(await env.PRODUCTIONS_DB.prepare('SELECT id_hash FROM session').all()).results.some((s) => phone.cookie.endsWith(s.id_hash)));
  check('the session opens Today', (await call(env, '/dashboard', { cookie: phone.cookie })).status === 200);
  check('still open on day 29', (await call(env, '/dashboard', { cookie: phone.cookie, now: NOW + 29 * 86400000 })).status === 200);
  check('closed on day 31', (await call(env, '/dashboard', { cookie: phone.cookie, now: NOW + 31 * 86400000 })).status === 401);
  await call(env, '/dashboard/logout', { method: 'POST', cookie: phone.cookie });
  check('sign-out revokes that session on the server', (await call(env, '/dashboard', { cookie: phone.cookie })).status === 401);
  check('sign-out leaves the other device signed in', (await call(env, '/dashboard', { cookie: plain.cookie })).status === 200);
  const forged = await call(env, '/dashboard', { cookie: 'wpp_s=madeup' });
  check('a made-up session opens nothing', forged.status === 401);
  check('a cross-site sign-in is refused', refused(await call(env, '/dashboard/login', { method: 'POST', form: { email: OWNER, password: PW }, origin: false, cookie: '' }).then(() => handleDashboard({ request: new Request(`${PROD}/dashboard/login`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${OWNER}&password=${PW}` }), env, now: NOW })), 'foreign'));
  for (let i = 0; i < OWNER_FAIL_LIMIT; i++) await signIn(env, OWNER, 'wrong-password-here');
  const back = await call(env, '/dashboard?signin=wrong');
  check('the redirected sign-in screen shows the refusal and no data', back.status === 401 && /did not open the dashboard/.test(back.text) && !back.text.includes(MARK));
  check('an unknown message code shows the plain sign-in screen', !/undefined/.test((await call(env, '/dashboard?signin=nope')).text));
  check('5 wrong tries lock the owner for 15 minutes', refused(await signIn(env, OWNER, PW), 'locked'));
  check('…and the lock lifts after', (await signIn(env, OWNER, PW, { now: NOW + 16 * 60000 })).status === 303);
}

// The pre-v1.0 record and cookie carry across.
{
  const pwRec = await hashSecret(PW);
  const env = ENV({ kvOwners: { scooter: { name: 'Owner A', email: OWNER, pw: pwRec, gen: 3 }, sequoia: { name: 'Owner B', email: OTHER, pw: pwRec, gen: 0 } }, kvSession: 'legacy-key' });
  check('his pre-v1.0 password still opens it', (await signIn(env, OWNER, PW)).status === 303);
  check('a pre-v1.0 record off the owners list is not copied', !(await env.PRODUCTIONS_DB.prepare("SELECT id FROM owner WHERE id = 'sequoia'").first()));
  const enc = new TextEncoder();
  const head = 'owner~scooter~3~full';
  const exp = Math.floor(NOW / 1000) + 3600;
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('wpp-dashboard-v2||legacy-key')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${exp}`))).toString('base64url');
  const up = await call(env, '/dashboard', { cookie: `wpp_dash=${head}.${exp}.${sig}` });
  check('a still-valid pre-v1.0 cookie becomes a v1.0 session (nobody signed out)', up.status === 303 && up.cookie);
  check('…which opens Today', (await call(env, '/dashboard', { cookie: up.cookie })).status === 200);
  const bad = await call(env, '/dashboard', { cookie: `wpp_dash=${head}.${exp}.AAAA` });
  check('a forged pre-v1.0 cookie opens nothing', bad.status === 401);
}

// One-time code, choose a password, change password.
{
  const env = ENV();
  await seedOwner(env, { pw: null });
  const f = await call(env, '/dashboard/forgot', { method: 'POST', form: { email: OWNER } });
  check('Forgot it? answers the same either way', f.status === 200);
  check('the code goes to the owner address on record only', env.sent.length === 1 && env.sent[0].to === OWNER);
  await call(env, '/dashboard/forgot', { method: 'POST', form: { email: OTHER } });
  check('nothing is sent for a record off the owners list', env.sent.length === 1);
  const code = env.sent[0].text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/)[0];
  const stored = (await env.PRODUCTIONS_DB.prepare("SELECT otp FROM owner WHERE id = 'scooter'").first()).otp;
  check('the code is stored only as a hash', !stored.includes(code.replace(/-/g, '')) && !stored.includes(code));
  const used = await signIn(env, OWNER, code);
  check('the code opens only the choose-a-password screen', used.status === 303 && used.location === '/dashboard/password');
  check('nothing shows before a password is chosen', (await call(env, '/dashboard', { cookie: used.cookie })).location === '/dashboard/password');
  check('the code works once', refused(await signIn(env, OWNER, code), 'wrong'));
  const chosen = await call(env, '/dashboard/password', { method: 'POST', cookie: used.cookie, form: { password: 'a-brand-new-pass', confirm: 'a-brand-new-pass' } });
  check('choosing a password opens the dashboard', chosen.status === 303 && (await call(env, '/dashboard', { cookie: chosen.cookie })).status === 200);
  const other = await signIn(env, OWNER, 'a-brand-new-pass');
  await call(env, '/dashboard/password', { method: 'POST', cookie: chosen.cookie, form: { current: 'a-brand-new-pass', password: 'another-new-pass', confirm: 'another-new-pass' } });
  check('changing the password signs other devices out', (await call(env, '/dashboard', { cookie: other.cookie })).status === 401);
  const env2 = ENV();
  await seedOwner(env2, { pw: null });
  await call(env2, '/dashboard/forgot', { method: 'POST', form: { email: OWNER } });
  const c2 = env2.sent[0].text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/)[0];
  check('an unused code stops working after 7 days', refused(await signIn(env2, OWNER, c2, { now: NOW + 8 * 86400000 }), 'wrong'));
  // Wrong passwords typed at his address lock the password, never his emailed code.
  const env3 = ENV();
  await seedOwner(env3);
  for (let i = 0; i < OWNER_FAIL_LIMIT; i++) await signIn(env3, OWNER, 'wrong-password-here');
  check('a locked owner: his password waits out the lock', refused(await signIn(env3, OWNER, PW), 'locked'));
  await call(env3, '/dashboard/forgot', { method: 'POST', form: { email: OWNER } });
  const c3 = env3.sent[0].text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/)[0];
  const in3 = await signIn(env3, OWNER, c3);
  check('…but a fresh Forgot it? code still opens choose-a-password', in3.status === 303 && in3.location === '/dashboard/password');
}

// Sample mode: preview only, synthetic rows only.
{
  const env = ENV();
  await seedOwner(env);
  check('the test identity is refused on production', refused(await signIn(env, SAMPLE_EMAIL, SAMPLE_PASSWORD), 'wrong'));
  check('…and on the production pages.dev host', refused(await signIn(env, SAMPLE_EMAIL, SAMPLE_PASSWORD, { host: 'https://west-peek-productions.pages.dev' }), 'wrong'));
  const s = await signIn(env, SAMPLE_EMAIL, SAMPLE_PASSWORD, { host: PREV });
  check('the test identity signs in on a preview', s.status === 303 && s.cookie);
  check('a sample session does not open on production', (await call(env, '/dashboard', { cookie: s.cookie })).status === 401);
  await env.PRODUCTIONS_DB.prepare("INSERT INTO row_cache (kind, row_id, origin, data, synced_at) VALUES ('projects','X1','{}',?,?)").bind(JSON.stringify({ id: 'X1', name: MARK, client: MARK }), NOW).run();
  const work = await call(env, '/dashboard/work', { cookie: s.cookie, host: PREV });
  check('a sample session sees synthetic rows only, never real ones', work.status === 200 && /Sample Org/.test(work.text) && !work.text.includes(MARK));
  const owner = await signIn(env, OWNER, PW, { host: PREV });
  check('the owner never sees sample rows', !(await call(env, '/dashboard/work', { cookie: owner.cookie, host: PREV })).text.includes('Sample Org'));
  const a = await call(env, '/dashboard/act', { method: 'POST', host: PREV, cookie: s.cookie, form: { action: 'stage', row: 'SD1', back: '/dashboard/deals' } });
  const after = await call(env, a.location, { cookie: s.cookie, host: PREV });
  check('a sample quick action is written and read back', /Saved and checked/.test(after.text) && /Solution and budget/.test(after.text));
  // Productions only (Scooter, 15 Nov 2026): Top Barz rows are left out at read time, never changed.
  const { isTopBarz } = await import('../functions/_lib/pd/data.mjs');
  check('productions only: SoundCloud, Overtime Elite, Sagaboy, Wendy\'s and Top Barz are recognised; Productions work is not', ['SoundCloud', 'Overtime Elite x Top Barz', 'Sagaboy', "Wendy's", 'TopBarz finals', 'Top Barz'].every((org) => isTopBarz({ org })) && isTopBarz({ org: 'Org Q', opportunity: 'Wendys sponsor night' }) && !['Org K', 'Duke University', 'Mercury', 'Wendell Foundation'].some((org) => isTopBarz({ org })));
  const tbBefore = (await env.PRODUCTIONS_DB.prepare("SELECT data FROM sample_sheet WHERE kind = 'deals' AND row_id = 'SD5'").first()).data;
  const pipe = await call(env, '/dashboard', { cookie: s.cookie, host: PREV });
  check('productions only: the Pipeline leaves the Top Barz deal out and says so in one line', pipe.status === 200 && !/Sample Top Barz show/.test(pipe.text) && /Sample Org D/.test(pipe.text) && /1 Top Barz row is not shown here\. It stays in your tracker, unchanged\./.test(pipe.text));
  const tbAct = await call(env, '/dashboard/act', { method: 'POST', host: PREV, cookie: s.cookie, form: { action: 'stage', row: 'SD5', back: '/dashboard' } });
  await call(env, tbAct.location || '/dashboard', { cookie: s.cookie, host: PREV });
  check('productions only: the Top Barz row is never changed or deleted', (await env.PRODUCTIONS_DB.prepare("SELECT data FROM sample_sheet WHERE kind = 'deals' AND row_id = 'SD5'").first())?.data === tbBefore && !/Sample Top Barz show/.test((await call(env, '/dashboard/inquiries', { cookie: s.cookie, host: PREV })).text));
  const choice = await call(env, '/dashboard/choice', { method: 'POST', host: PREV, cookie: s.cookie, form: { key: 'agent_seat', value: 'yes' } });
  check('a sample session cannot make his choices', choice.status === 303 && !(await env.PRODUCTIONS_DB.prepare('SELECT * FROM choice').first()));
}

// Not connected: every screen is a calm empty state that leads to Connections and Help.
{
  const env = ENV();
  await seedOwner(env);
  const s = await signIn(env, OWNER, PW);
  for (const p of ['/dashboard', '/dashboard/work', '/dashboard/deals', '/dashboard/money', '/dashboard/agents', '/dashboard/inquiries']) {
    const r = await call(env, p, { cookie: s.cookie });
    check(`${p} unconnected: an empty state with Connections and Help`, r.status === 200 && /href="\/dashboard\/connections/.test(r.text) && /href="\/dashboard\/help/.test(r.text));
  }
}

// Connect Google, sync, quick actions, reminders, disconnect.
{
  const g = fakeGoogle();
  globalThis.fetch = g.fetch;
  const env = ENV({ google: true });
  await seedOwner(env);
  const s = await signIn(env, OWNER, PW);
  const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
  check('Connect goes to Google\'s own screen', /^https:\/\/accounts\.google\.com\//.test(start.location || ''));
  const state = new URL(start.location).searchParams.get('state');
  const back = await call(env, `/dashboard/oauth/callback?state=${state}&code=good`, { cookie: s.cookie });
  check('the callback stores the connection', back.location === '/dashboard/connections?m=connected');
  const conn = await env.PRODUCTIONS_DB.prepare("SELECT * FROM connection WHERE provider = 'google'").first();
  check('refresh tokens are stored encrypted, never in plain', conn && !conn.token_enc.includes('REFRESH-TOKEN-PLAIN') && !conn.token_enc.includes('ACCESS-TOKEN-PLAIN'));
  check('a reused state is refused', (await call(env, `/dashboard/oauth/callback?state=${state}&code=good`, { cookie: s.cookie })).location === '/dashboard/connections?m=expired');

  await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'work', link: 'https://docs.google.com/spreadsheets/d/WORKSHEETID00000000000000001/edit' } });
  const work = await call(env, '/dashboard/work', { cookie: s.cookie });
  check('naming the sheet syncs its rows onto Work', work.text.includes(MARK));
  check('every block names its source and sync time', /From: Work test sheet · Projects, synced/.test(work.text));
  const today = await call(env, '/dashboard', { cookie: s.cookie });
  // The first screen is the pipeline, never a triage list (Scooter, 15 Nov 2026); a client item lives on its client page.
  const p1 = await call(env, '/dashboard/work/P1', { cookie: s.cookie });
  check('a client item 17 days old is red on its client page, with Mark received, and never on the first screen', /d-dot red/.test(p1.text) && /Logo files/.test(p1.text) && /value="received"/.test(p1.text) && today.status === 200 && !/Logo files/.test(today.text));
  const stale = await call(env, '/dashboard/work', { cookie: s.cookie, now: NOW + 3 * 3600000 });
  check('older than 2 hours: "may be out of date"', /may be out of date/.test(stale.text));

  // move a row: the action must still find W1 by ID
  const tab = g.sheets.WORKSHEETID00000000000000001.tabs['Waiting on client'];
  tab.splice(1, 0, ['W0', 'P1', 'Inserted row', '2026-11-12', 'Waiting', '']);
  const r1 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'received', row: 'W1', back: '/dashboard/work/P1' } });
  const shown = await call(env, r1.location, { cookie: s.cookie });
  check('Mark received writes the source row found by ID and is confirmed', tab[2][4] === 'Received' && /Saved and checked/.test(shown.text));
  check('…the row above it is untouched', tab[1][4] === 'Waiting');
  check('…and it survives a reload', !(await call(env, '/dashboard/work/P1', { cookie: s.cookie })).text.includes('Logo files'));

  g.dropWrites = true;
  const r2 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'stage', row: 'D1', back: '/dashboard/deals' } });
  const failed = await call(env, r2.location, { cookie: s.cookie });
  check('a write the sheet does not show is reported failed, never assumed', /d-flash--bad/.test(failed.text) && /Discovery/.test(failed.text) && !/Saved and checked/.test(failed.text));
  g.dropWrites = false;
  const r3 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'stage', row: 'D1', back: '/dashboard/deals' } });
  check('Move to next stage writes the CRM row', g.sheets.WORKSHEETID00000000000000001.tabs.Deals[1][2] === 'Solution and budget' && /Saved and checked/.test((await call(env, r3.location, { cookie: s.cookie })).text));
  const second = await signIn(env, OWNER, PW);
  check('…and shows on a second device', /Solution and budget/.test((await call(env, '/dashboard/deals', { cookie: second.cookie })).text));

  // Reminders open, written, in his own Gmail; the dashboard holds no Gmail access (14 Nov 2026).
  const before = g.calls.length;
  await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'remind', kind: 'waiting', row: 'W2', back: '/dashboard' } });
  const conn0 = await call(env, '/dashboard/connections', { cookie: s.cookie });
  const scope = new URL(start.location).searchParams.get('scope').split(' ');
  check('Google is asked for no Gmail, no Drive file contents and no calendar settings', !scope.some((x) => /gmail|auth\/drive\.readonly|auth\/calendar\.readonly/.test(x)) && scope.includes('https://www.googleapis.com/auth/spreadsheets') && scope.includes('https://www.googleapis.com/auth/drive.metadata.readonly') && scope.includes('https://www.googleapis.com/auth/calendar.events.readonly'), scope.join(' '));
  check('a reminder never reaches Gmail from the server', g.drafts.length === 0 && g.calls.slice(before).every((c) => !/gmail/.test(c)) && conn0.status === 200);
  const clientPage = await call(env, '/dashboard/work/P1', { cookie: s.cookie });
  check('a reminder is a link that opens his own Gmail, written', /href="https:\/\/mail\.google\.com\/mail\/\?view=cm&amp;fs=1&amp;to=client-a%40example\.test/.test(clientPage.text) && !/value="remind"/.test(clientPage.text));

  check('a draft to approve is on Agents, never on the first screen', /Update draft/.test((await call(env, '/dashboard/agents', { cookie: s.cookie })).text) && !(await call(env, '/dashboard', { cookie: s.cookie })).text.includes('Update draft'));

  // a failed sync and a broken connection show on Today
  delete g.sheets.WORKSHEETID00000000000000001;
  await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
  const red = await call(env, '/dashboard', { cookie: s.cookie });
  check('a failed sync is a red row above the pipeline with Reconnect', /Could not read your work sheet/.test(red.text) && /href="\/dashboard\/connections">Reconnect/.test(red.text));
  const faultKeys = [...red.text.matchAll(/name="item" value="(sync:[^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, '&'));
  for (const item of faultKeys) await call(env, '/dashboard/tick', { method: 'POST', cookie: s.cookie, form: { item } });
  check('hidden fault rows stay hidden after a reload', faultKeys.length > 0 && !/Could not read your work sheet/.test((await call(env, '/dashboard', { cookie: s.cookie })).text));
  await env.PRODUCTIONS_DB.prepare("UPDATE connection SET status = 'broken' WHERE provider = 'google'").run();
  check('a broken connection shows on Today', /Google stopped syncing/.test((await call(env, '/dashboard', { cookie: s.cookie })).text));

  const dis = await call(env, '/dashboard/disconnect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
  check('Disconnect revokes at Google and deletes the token', g.revoked.includes('REFRESH-TOKEN-PLAIN') && dis.location === '/dashboard/connections?m=disconnected' && !(await env.PRODUCTIONS_DB.prepare("SELECT * FROM connection WHERE provider = 'google'").first()));
  const off = (await call(env, '/dashboard', { cookie: s.cookie })).text;
  check('a disconnected account shows on Today with Connect', /Google is disconnected/.test(off) && /href="\/dashboard\/connections">Connect</.test(off));
  check('…and the pipeline says it is not connected, never a zero count', /appear here once Google is connected/.test(off) && !/· 0\b/.test(off));

  // Google sign-in: only the owner's account opens it
  const gs = await call(env, '/dashboard/google', { method: 'POST', form: { remember: '1' } });
  const st = new URL(gs.location).searchParams.get('state');
  const okIn = await call(env, `/dashboard/oauth/callback?state=${st}&code=good`);
  check('Sign in with Google opens it for the owner, remembered', okIn.status === 303 && /Max-Age=2592000/.test(okIn.rawCookie));
  const gs2 = await call(env, '/dashboard/google', { method: 'POST', form: {} });
  const st2 = new URL(gs2.location).searchParams.get('state');
  check('Sign in with Google refuses any other account', refused(await call(env, `/dashboard/oauth/callback?state=${st2}&code=other`), 'google_other'));

  const noKey = ENV({ google: true });
  delete noKey.PRODUCTIONS_TOKEN_KEY;
  await seedOwner(noKey);
  const nk = await signIn(noKey, OWNER, PW);
  check('without the token key nothing can be connected', (await call(noKey, '/dashboard/connect', { method: 'POST', cookie: nk.cookie, form: { provider: 'google' } })).location === '/dashboard/connections?m=no_token_key');
  globalThis.fetch = realFetch;
}

// His existing tracker, read as it is laid out, one view from lead to cash, notes, and the narrower
// Google access (Scooter, 14 Nov 2026). The tracker has a title line, no ID column and its own column
// names; reading it adds nothing to it, a change writes only the cells changed, an inquiry joins it
// as one appended row, and notes never touch it.
{
  const g = fakeGoogle();
  const TRACKER = 'TRACKERSHEETID000000000000001';
  const pipeline = [['Productions pipeline 2026'], [], ['Company', 'Pipeline Stage', 'Next Step', 'Next Step Date', 'Notes', 'Contact email'], ['Org B', 'Proposal', 'Send deck', '11/20/2026', 'Original note', 'org-b@example.test'], ['Org C', 'Discovery', '', '', '', '']];
  g.sheets[TRACKER] = { title: 'Tracker test', tabs: { 'Read me': [['How to use this sheet']], '2026 Pipeline': pipeline }, perms: [{ type: 'user', role: 'owner', emailAddress: OWNER }, { type: 'anyone', role: 'reader' }, { type: 'user', role: 'writer', emailAddress: 'helper-a@example.test', displayName: 'Helper A' }] };
  g.sheets.FORMSHEETID0000000000000000001 = { title: 'Form test', tabs: { 'Form responses 1': [['Timestamp', 'Name', 'Organization', 'Email'], ['11/10/2026', 'Person B', 'Org B, Inc.', 'org-b@example.test'], ['11/12/2026', 'Person Z', 'Org Z', 'org-z@example.test']] } };
  globalThis.fetch = g.fetch;
  try {
    const env = ENV({ google: true });
    await seedOwner(env);
    const s = await signIn(env, OWNER, PW);
    const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
    await call(env, `/dashboard/oauth/callback?state=${new URL(start.location).searchParams.get('state')}&code=good`, { cookie: s.cookie });
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'work', link: 'https://docs.google.com/spreadsheets/d/WORKSHEETID00000000000000001/edit' } });
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'tracker', link: `https://docs.google.com/spreadsheets/d/${TRACKER}/edit` } });
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'inquiries', link: 'https://docs.google.com/spreadsheets/d/FORMSHEETID0000000000000000001/edit' } });
    const snapshot = JSON.stringify(pipeline);
    const deals = await call(env, '/dashboard/deals', { cookie: s.cookie });
    check('tracker: a tab found by its columns, under a title line, with no ID column, is read', /Deals · 2/.test(deals.text) && /Org B/.test(deals.text) && /Org C/.test(deals.text) && !/Org A/.test(deals.text), (deals.text.match(/Deals · \d+/) || [''])[0]);
    const connT = (await call(env, '/dashboard/connections', { cookie: s.cookie })).text;
    check('tracker: Connections says how it is read, column by column; the pipeline carries no explanation', /How your tracker is read/.test(connT) && /2026 Pipeline, column names on row 3/.test(connT) && /<span>Company<\/span><span>organization<\/span>/.test(connT) && !/How your tracker is read/.test(deals.text));
    check('tracker: reading it changes nothing in it', JSON.stringify(pipeline) === snapshot && !g.appended);

    const before = g.cellsWritten || 0;
    const up = await call(env, '/dashboard/deal', { method: 'POST', cookie: s.cookie, form: { row: 'k:org-b', stage: 'Negotiation', next_action: 'Call about the deck', next_date: '2026-11-21', back: '/dashboard/flow/org-b' } });
    const upShown = await call(env, up.location, { cookie: s.cookie });
    const rowB = pipeline.find((r) => r[0] === 'Org B');
    check('tracker: Save to my tracker writes stage, next step and date on his row, confirmed', rowB[1] === 'Negotiation' && rowB[2] === 'Call about the deck' && rowB[3] === '2026-11-21' && /Saved and checked/.test(upShown.text), JSON.stringify(rowB));
    check('tracker: only the three changed cells are written; no row or column added', (g.cellsWritten - before) === 3 && pipeline.length === 5 && pipeline.every((r, i) => i < 2 || r.length === 6) && rowB[0] === 'Org B' && rowB[4] === 'Original note');
    pipeline.splice(3, 0, ['Org D', 'Discovery', '', '', '', '']);
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
    pipeline.splice(3, 0, ['Org E', 'Discovery', '', '', '', '']);
    await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'stage', row: 'k:org-b', back: '/dashboard/deals' } });
    check('tracker: a row moved by a new row above it is still found by its organization', pipeline.find((r) => r[0] === 'Org B')[1] === 'Signed agreement' && pipeline.find((r) => r[0] === 'Org E')[1] === 'Discovery');
    const second = await signIn(env, OWNER, PW);
    check('tracker: the change shows on a second device', /Signed agreement/.test((await call(env, '/dashboard/deals', { cookie: second.cookie })).text));

    const flow = await call(env, '/dashboard/flow', { cookie: s.cookie });
    check('pipeline: one line per organization, each deal listed under the stage it sits in, form requests first', /<h2 id="stage-\d+-h">Signed agreement · 1<\/h2><ul class="d-list"><li class="d-row" data-stage="Signed agreement"><div class="d-row__main"><a class="d-row__title" href="\/dashboard\/flow\/org-b">Org B ›/.test(flow.text) && /Form requests · 1<\/h2><ul class="d-list"><li class="d-row"><div class="d-row__main"><a class="d-row__title" href="\/dashboard\/flow\/org-z">Org Z ›/.test(flow.text) && (flow.text.match(/Org B ›/g) || []).length === 1 && flow.text.indexOf('Form requests ·') < flow.text.indexOf('Signed agreement ·') && !/New inquiries/.test(flow.text));
    const recB = await call(env, '/dashboard/flow/org-b', { cookie: s.cookie });
    check('lead to cash: the record carries the inquiry, the deal form and the notes', /Person B/.test(recB.text) && /action="\/dashboard\/deal"/.test(recB.text) && /action="\/dashboard\/note"/.test(recB.text) && /Signed/.test(recB.text));

    // A Top Barz row in his real tracker: synced and kept as it is, never shown, never written.
    pipeline.push(['SoundCloud', 'Proposal', 'Sponsor deck', '11/30/2026', 'Top Barz night', '']);
    const tbRow = JSON.stringify(pipeline.at(-1));
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
    const tbFlow = await call(env, '/dashboard', { cookie: s.cookie });
    await call(env, '/dashboard/deal', { method: 'POST', cookie: s.cookie, form: { row: 'k:soundcloud', stage: 'Signed agreement', back: '/dashboard' } });
    check('productions only: a SoundCloud row in his tracker is synced but not listed, and never written', !/SoundCloud/.test(tbFlow.text) && /1 Top Barz row is not shown here/.test(tbFlow.text) && Boolean(await env.PRODUCTIONS_DB.prepare("SELECT row_id FROM row_cache WHERE kind = 'deals' AND data LIKE '%SoundCloud%'").first()) && JSON.stringify(pipeline.find((r) => r[0] === 'SoundCloud')) === tbRow);
    pipeline.splice(pipeline.findIndex((r) => r[0] === 'SoundCloud'), 1);
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });

    const rows0 = pipeline.length;
    const add = await call(env, '/dashboard/deal/add', { method: 'POST', cookie: s.cookie, form: { key: 'org-z', back: '/dashboard/flow/org-z' } });
    const added = pipeline.at(-1);
    check('lead to cash: an inquiry joins his tracker as ONE appended row, nothing else changed', pipeline.length === rows0 + 1 && g.appended === 1 && added[0] === 'Org Z' && added[5] === 'org-z@example.test' && /Saved and checked/.test((await call(env, add.location, { cookie: s.cookie })).text), JSON.stringify(added));
    const again = await call(env, '/dashboard/deal/add', { method: 'POST', cookie: s.cookie, form: { key: 'org-z', back: '/dashboard/flow/org-z' } });
    check('lead to cash: it is never added twice', pipeline.length === rows0 + 1 && again.status === 303);

    // Notes live in his tracker's Notes cell (Scooter, 14 Nov 2026: "they need to live where I can see and edit them").
    const cellsBeforeNote = g.cellsWritten;
    const rowsBeforeNote = pipeline.length;
    const n1 = await call(env, '/dashboard/note', { method: 'POST', cookie: s.cookie, form: { key: 'org-b', text: 'Board meets in March', back: '/dashboard/flow/org-b' } });
    check('notes: saving a note writes his tracker\'s Notes cell on that row, confirmed', pipeline.find((r) => r[0] === 'Org B')[4] === 'Board meets in March' && /Saved and checked: Org B: notes/.test((await call(env, n1.location, { cookie: s.cookie })).text));
    check('notes: only the Notes cell is written; no row or column added, other cells unchanged', g.cellsWritten - cellsBeforeNote === 1 && pipeline.length === rowsBeforeNote && pipeline.find((r) => r[0] === 'Org B')[1] === 'Signed agreement' && pipeline.every((r, i) => i < 2 || r.length === 6));
    await call(env, '/dashboard/note', { method: 'POST', cookie: s.cookie, form: { key: 'org-b', text: 'Board moved to April', back: '/dashboard/flow/org-b' } });
    const onPhone = await call(env, '/dashboard/flow/org-b', { cookie: second.cookie });
    check('notes: the newest note is in his tracker and shows after a reload and on a second device, every version kept', pipeline.find((r) => r[0] === 'Org B')[4] === 'Board moved to April' && /<textarea id="nt"[^>]*>Board moved to April</.test(onPhone.text) && /Earlier versions · 2/.test(onPhone.text) && /Board meets in March/.test(onPhone.text));
    pipeline.find((r) => r[0] === 'Org B')[4] = 'Edited in the sheet';
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
    check('notes: a note he edits in his tracker is what the record shows', /<textarea id="nt"[^>]*>Edited in the sheet</.test((await call(env, '/dashboard/flow/org-b', { cookie: s.cookie })).text));
    check('notes: the pipeline lists stay short (no note text on a row)', !/Edited in the sheet/.test((await call(env, '/dashboard', { cookie: s.cookie })).text));

    // Access: what Google allows, who can open each sheet, what is kept.
    await env.PRODUCTIONS_DB.prepare("UPDATE connection SET scopes = ? WHERE provider = 'google'").bind('openid https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.readonly').run();
    check('access: a wider earlier grant is a gold item on Today', /Google still allows more than the dashboard needs/.test((await call(env, '/dashboard', { cookie: s.cookie })).text));
    const acc = await call(env, '/dashboard/access', { cookie: s.cookie });
    check('access: the wider grant is named in plain words with Narrow', /Write and send email as you/.test(acc.text) && /action="\/dashboard\/google\/narrow"/.test(acc.text));
    check('access: who can open each connected sheet, live from Google', /Tracker test/.test(acc.text) && /Anyone with the link can open it/.test(acc.text) && /Helper A \(helper-a@example\.test\) can edit/.test(acc.text));
    check('access: every kept table is described, with counts', BACKUP_TABLES.every((t) => TABLE_WORDS[t]) && /Every saved version of your notes[^<]*<\/span><span>2 rows/.test(acc.text));
    check('access: before the cash rules are walked, Money reads held (never "shown") and links to the walk', /Money in the dashboard · held until you walk the cash rules/.test(acc.text) && !/Money in the dashboard · shown/.test(acc.text) && /href="\/dashboard\/money">Walk the cash rules/.test(acc.text));
    const revokedBefore = g.revoked.length;
    const nar = await call(env, '/dashboard/google/narrow', { method: 'POST', cookie: s.cookie });
    const nScope = nar.location ? new URL(nar.location).searchParams.get('scope') : '';
    check('access: Narrow withdraws the old grant at Google, then asks only for the narrow set', g.revoked.length === revokedBefore + 1 && /^https:\/\/accounts\.google\.com\//.test(nar.location || '') && !/gmail|drive\.readonly/.test(nScope), nScope);
    await call(env, `/dashboard/oauth/callback?state=${new URL(nar.location).searchParams.get('state')}&code=good`, { cookie: s.cookie });
    check('access: after narrowing, the named sheets are kept and the gold item is gone', !/still allows more/.test((await call(env, '/dashboard', { cookie: s.cookie })).text) && /Deals · 5/.test((await call(env, '/dashboard/deals', { cookie: s.cookie })).text));

    // Keep money out: the copy is deleted at once and a sync does not bring it back.
    await env.PRODUCTIONS_DB.prepare("INSERT INTO row_cache (kind,row_id,origin,data,synced_at) VALUES ('invoices','I1','{}',?,?)").bind(JSON.stringify({ id: 'I1', client: 'Org B', amount: '100', due: '2026-11-01', status: 'Sent' }), NOW).run();
    await call(env, '/dashboard/choice', { method: 'POST', cookie: s.cookie, form: { key: 'money', value: 'off', back: '/dashboard/access#limit' } });
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
    const moneyLeft = Number((await env.PRODUCTIONS_DB.prepare("SELECT COUNT(*) AS n FROM row_cache WHERE kind IN ('invoices','receipts','vendors','margin','cash','tracker')").first()).n);
    check('access: Keep money out deletes the money copy and keeps it out', moneyLeft === 0 && /Money is kept out of the dashboard/.test((await call(env, '/dashboard/money', { cookie: s.cookie })).text));

    // Stop using the tracker: deals fall back to the Work sheet's Deals tab; nothing of the tracker is kept.
    await call(env, '/dashboard/source/remove', { method: 'POST', cookie: s.cookie, form: { group: 'tracker' } });
    const fb = await call(env, '/dashboard/deals', { cookie: s.cookie });
    check('sources: Stop using a sheet forgets its rows; deals come from the Work sheet again', /Org A/.test(fb.text) && !/data-stage="[^"]*"><div class="d-row__main"><a class="d-row__title" href="\/dashboard\/flow\/org-z"/.test(fb.text));

    // A tracker whose columns cannot be read says so, naming the columns it saw.
    g.sheets[TRACKER].tabs = { Sheet1: [['Foo', 'Bar'], ['x', 'y']] };
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'tracker', link: `https://docs.google.com/spreadsheets/d/${TRACKER}/edit` } });
    const bad = await call(env, '/dashboard/deals', { cookie: s.cookie });
    check('tracker: unrecognised columns are said, with the columns seen, never a silent zero', /columns were not recognised/.test(bad.text) && /Columns seen: Foo, Bar/.test(bad.text));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Money: incomplete costs show no margin.
{
  const env = ENV();
  await seedOwner(env);
  const s = await signIn(env, OWNER, PW);
  const db = env.PRODUCTIONS_DB;
  await db.prepare("INSERT INTO connection (provider, status, token_enc) VALUES ('google','ok', ?)").bind(await encryptJson(env, { access_token: 'x', expires_at: NOW + 3600000 })).run();
  await db.prepare("INSERT INTO source (kind, spreadsheet_id, title) VALUES ('money','MONEYSHEETID00000000000000001','Money test')").run();
  await db.prepare("INSERT INTO row_cache (kind,row_id,origin,data,synced_at) VALUES ('margin','M1','{}',?,?)").bind(JSON.stringify({ id: 'M1', project: 'P9', contract: '1000', costs: '400', complete: 'No' }), NOW).run();
  await db.prepare("INSERT INTO row_cache (kind,row_id,origin,data,synced_at) VALUES ('margin','M2','{}',?,?)").bind(JSON.stringify({ id: 'M2', project: 'P8', contract: '1000', costs: '250', complete: 'Yes' }), NOW).run();
  await db.prepare("INSERT INTO row_cache (kind,row_id,origin,data,synced_at) VALUES ('invoices','IV1','{}',?,?)").bind(JSON.stringify({ id: 'IV1', client: 'Org Z', amount: '4321', status: 'Sent', due: new Date(NOW - 3 * 86400000).toISOString().slice(0, 10), _id: 'IV1' }), NOW).run();
  const { CASH_RULES } = await import('../functions/_lib/pd/deal.mjs');
  const money = () => call(env, '/dashboard/money', { cookie: s.cookie });
  const today = () => call(env, '/dashboard', { cookie: s.cookie });
  // The rules are walked before any money figure shows (Scooter, 14 Nov 2026).
  const before = await money();
  const beforeToday = await today();
  check('rules walk: before it, Money shows every rule and no figure', before.status === 200 && CASH_RULES.every((r) => before.text.includes(`id="rule-${r.id}"`)) && !/75%|4,321|Friday review/.test(before.text) && /0 of 5 marked right/.test(before.text));
  check('rules walk: before it, the first screen shows no money figure', beforeToday.status === 200 && !/4,321|\$\d/.test(beforeToday.text));
  // "Not right" needs words; with words it is kept, persists, and the figures stay held.
  const noWords = await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: 'settled', answer: 'change', note: '' } });
  check('rules walk: a change with no words saves nothing', /m=rule_no_words/.test(noWords.location || '') && !(await db.prepare("SELECT key FROM setting WHERE key = 'cash_rule:settled'").first()));
  // A change reaches the OS inbox on its own, once, with the rule id, version and his words: he never says it twice.
  const sentBefore = env.sent.length;
  const changed = await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: 'settled', answer: 'change', note: 'Count it once the bank feed shows it.' } });
  const ruleMail = env.sent.slice(sentBefore);
  check('rules walk: a change is sent to the OS inbox on its own, once, with the rule, its version and his words',
    ruleMail.length === 1 && ruleMail[0].to === 'os@joinwestpeek.com' && /cash rule 1 \(settled, v1\)/.test(ruleMail[0].subject) && /Count it once the bank feed shows it\./.test(ruleMail[0].text) && /m=rule_change(#|$)/.test(changed.location || ''), JSON.stringify(ruleMail));
  check('rules walk: the rule shows the change was sent to Porter, and the flash never asks him to send it again',
    ((t) => />sent to Porter</.test(t) && /Sent to Porter on [^<]*, waiting on the new wording/.test(t) && !/Send the same words/.test(t))((await call(env, '/dashboard/money?m=rule_change', { cookie: s.cookie })).text));
  // A send that fails is kept, said honestly, and retried by the cron without him doing anything.
  {
    const mailer = env.FORMS_MAILER;
    env.FORMS_MAILER = { fetch: async () => new Response('down', { status: 500 }) };
    const failed = await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: 'apart', answer: 'change', note: 'Show them together as well.' } });
    const kept = await money();
    check('rules walk: a change that could not be sent is kept and says it is still being sent', /m=rule_change_unsent/.test(failed.location || '') && /still being sent to Porter/.test(kept.text) && /You said: Show them together as well\./.test(kept.text));
    env.FORMS_MAILER = mailer;
    const { resendRuleChanges } = await import('../functions/_lib/pd/data.mjs');
    const n0 = env.sent.length;
    const resent = await resendRuleChanges(env, NOW);
    const again2 = await resendRuleChanges(env, NOW);
    check('rules walk: the cron sends an unsent change once, and never resends one that arrived', resent === 1 && again2 === 0 && env.sent.length === n0 + 1 && /apart, v1/.test(env.sent[n0].subject) && /Show them together as well\./.test(env.sent[n0].text));
  }
  check('until the walk is done, Money opens on it and the first screen carries no instructions', !/Start here/.test((await today()).text) && /The cash rules, walked first/.test((await money()).text));
  for (const r of CASH_RULES.slice(1)) await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: r.id, answer: 'right' } });
  const partway = await money();
  check('rules walk: a rule he asked to change keeps his words and holds every figure, after a reload', /You said: Count it once the bank feed shows it\./.test(partway.text) && /4 of 5 marked right/.test(partway.text) && !/75%|4,321/.test(partway.text));
  const bogus = await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: 'nope', answer: 'right' } });
  check('rules walk: an unknown rule is refused', /m=rule_refused/.test(bogus.location || ''));
  await call(env, '/dashboard/cash-rule', { method: 'POST', cookie: s.cookie, form: { id: 'settled', answer: 'right' } });
  const second = await signIn(env, OWNER, PW);
  const m = await call(env, '/dashboard/money', { cookie: second.cookie });
  check('rules walk: once every rule is marked right the figures show, on a second device too', m.status === 200 && /You walked every rule/.test(m.text) && /75%/.test(m.text) && /4,321/.test(m.text));
  check('a margin with costs not all entered shows no percentage', m.status === 200 && !/60%/.test(m.text));
  check('rules walk: once all are right the walk folds shut, and Today drops Start here', /<summary><span>Cash rules · all 5 marked right/.test(m.text) && !/Start here/.test((await today()).text));
  // A rule whose words change asks him again.
  CASH_RULES[0].v += 1;
  const again = await money();
  CASH_RULES[0].v -= 1;
  check('rules walk: a reworded rule asks again and holds the figures', /4 of 5 marked right/.test(again.text) && !/4,321/.test(again.text));
  // The wider Google grant holds every money figure, walked or not.
  await db.prepare("UPDATE connection SET scopes = ? WHERE provider = 'google'").bind('openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.send').run();
  const wide = await money();
  check('money: while Google holds the wider grant, no money figure shows', /Google still holds the wider access/.test(wide.text) && !/4,321|75%/.test(wide.text));
  const wideToday = await today();
  check('money: while Google holds the wider grant, the first screen shows no money figure either, even with the walk done', wideToday.status === 200 && !/4,321|\$\d/.test(wideToday.text));
}

// The cron door.
{
  const env = ENV();
  await ensureSchema(env.PRODUCTIONS_DB);
  check('the cron sync is refused without the secret', (await call(env, '/dashboard/cron/sync', { method: 'POST' })).status === 401);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cron-secret'))).toString('base64url');
  await env.PRODUCTIONS_DB.prepare("INSERT INTO setting (key, value) VALUES ('cron_secret_hash', ?)").bind(JSON.stringify(hash)).run();
  const ok = await handleDashboard({ request: new Request(`${PROD}/dashboard/cron/sync`, { method: 'POST', headers: { 'x-dashboard-cron': 'cron-secret' } }), env, now: NOW });
  check('…and runs with it', ok.status === 200);
}

// Nightly backup and one restore.
{
  const db = fakeD1();
  await ensureSchema(db);
  await db.prepare("INSERT INTO setting (key, value) VALUES ('marker', '\"one\"')").run();
  await db.prepare("INSERT INTO action_log (at, action, outcome) VALUES (1, 'stage', 'saved')").run();
  const objects = new Map([['backups/2026-09-01.json', '{}']]);
  const R2 = { put: async (k, v) => objects.set(k, v), get: async (k) => (objects.has(k) ? { text: async () => objects.get(k) } : null), delete: async (k) => objects.delete(k), list: async () => ({ objects: [...objects.keys()].map((key) => ({ key })) }) };
  const b = await backup({ DB: db, BACKUPS: R2 }, NOW);
  check('a backup carries every table', JSON.parse(objects.get(b.key)).tables && BACKUP_TABLES.every((t) => t in JSON.parse(objects.get(b.key)).tables));
  check('backups older than 30 days are deleted', !objects.has('backups/2026-09-01.json'));
  await db.prepare("DELETE FROM setting WHERE key = 'marker'").run();
  await db.prepare('DELETE FROM action_log').run();
  const r = await restore({ DB: db, BACKUPS: R2 }, b.key);
  check('a restore brings the rows back', r.ok && (await db.prepare("SELECT value FROM setting WHERE key = 'marker'").first())?.value === '"one"' && Number((await db.prepare('SELECT COUNT(*) AS n FROM action_log').first()).n) === 1);
}

// dashboard:setup on a brand-new database (13 Nov 2026: the preview run stopped at the first
// schema_version probe with 400 7500). A fake Cloudflare API answers D1 queries from real SQLite
// with D1's own error shape, then refuses the Pages project so the run stops right after migrations.
{
  const { createServer } = await import('node:http');
  const sqlite = fakeD1();
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname.endsWith('/d1/database') && req.method === 'GET') return send(200, { success: true, result: [] });
    if (u.pathname.endsWith('/d1/database') && req.method === 'POST') return send(200, { success: true, result: { uuid: 'db-test', name: JSON.parse(raw).name } });
    if (u.pathname.endsWith('/query')) {
      const { sql, params } = JSON.parse(raw);
      try { const out = sqlite.prepare(sql).bind(...(params || []))._exec(); return send(200, { success: true, result: [{ results: Array.isArray(out) ? out.map((r) => ({ ...r })) : [] }] }); }
      catch { return send(400, { success: false, errors: [{ code: 7500 }] }); }
    }
    return send(403, { success: false, errors: [{ code: 10000 }] });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { spawn } = await import('node:child_process');
  const run = () => new Promise((resolveRun) => {
    {
      const p = spawn(process.execPath, ['scripts/dashboard_setup.mjs', '--env', 'preview'], { env: { ...process.env, CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_BASE: base } });
      let out = ''; p.stdout.on('data', (d) => { out += d; }); p.on('close', (code) => resolveRun({ code, out }));
    }
  });
  const first = await run();
  check('dashboard:setup applies migrations on a brand-new database', new RegExp(`migrations applied=${MIGRATIONS.length}\\b`).test(first.out) && !/\/query/.test(first.out), first.out.trim());
  check('…and the tables exist after it', Number((await sqlite.prepare('SELECT MAX(version) AS v FROM schema_version').first().catch(() => null))?.v) === MIGRATIONS.at(-1).version && Boolean(await sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_key'").first().catch(() => null)));
  const again = await run();
  check('…and a second run applies nothing', /migrations applied=0/.test(again.out), again.out.trim());
  server.close();
}

// dashboard:setup on production (review, 14 Nov 2026): the binding reaches a fresh deployment of the
// SAME commit before setup ends, and the owner row is copied from preview, so the live page opens.
{
  const { createServer } = await import('node:http');
  const prod = fakeD1();
  const pv = fakeD1();
  resetSchemaMemo(); await ensureSchema(pv);
  await pv.prepare("INSERT INTO owner (id, name, email, pw, gen, updated_at) VALUES ('scooter', 'Owner', 'owner@example.test', '{\"h\":\"x\"}', 3, 1)").run();
  await pv.prepare("INSERT INTO owner (id, name, email, gen, updated_at) VALUES ('intruder', 'X', 'x@example.test', 0, 1)").run();
  const calls = { patch: 0, retried: [], polls: 0 };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, 'http://x');
    const q = (db) => { const { sql, params } = JSON.parse(raw); try { const out = db.prepare(sql).bind(...(params || []))._exec(); return send(200, { success: true, result: [{ results: Array.isArray(out) ? out.map((r) => ({ ...r })) : [] }] }); } catch { return send(400, { success: false, errors: [{ code: 7500 }] }); } };
    if (u.pathname.endsWith('/d1/database') && req.method === 'GET') {
      const name = u.searchParams.get('name');
      return send(200, { success: true, result: name.endsWith('-production') ? [{ uuid: 'db-prod', name }] : [{ uuid: 'db-pv', name }] });
    }
    if (u.pathname.endsWith('/db-prod/query')) return q(prod);
    if (u.pathname.endsWith('/db-pv/query')) return q(pv);
    if (u.pathname.endsWith('/pages/projects/west-peek-productions') && req.method === 'GET') return send(200, { success: true, result: { deployment_configs: { production: {}, preview: { kv_namespaces: { PRODUCTIONS_DASHBOARD: { namespace_id: 'ns-pv' } } } } } });
    if (u.pathname.endsWith('/storage/kv/namespaces/ns-pv/values/owners')) { res.writeHead(200); return res.end(JSON.stringify({ scooter: { name: 'Owner', email: 'kv-owner@example.test', pw: { h: 'kv' }, otp: { code: 'never-copied' } }, intruder: { email: 'x@example.test' } })); }
    if (u.pathname.endsWith('/pages/projects/west-peek-productions') && req.method === 'PATCH') { calls.patch += 1; return send(200, { success: true, result: {} }); }
    if (u.pathname.endsWith('/deployments') && u.searchParams.get('env') === 'production') {
      calls.polls += 1; // the merge's own deployment is still building on the first look
      return send(200, { success: true, result: [{ id: 'merge-commit-deploy', latest_stage: calls.polls < 2 ? { name: 'build', status: 'active' } : { name: 'deploy', status: 'success' } }] });
    }
    if (/\/deployments\/[^/]+\/retry$/.test(u.pathname)) { calls.retried.push(u.pathname.split('/').at(-2)); return send(200, { success: true, result: { id: 'fresh-deploy' } }); }
    if (u.pathname.endsWith('/deployments/fresh-deploy')) return send(200, { success: true, result: { id: 'fresh-deploy', latest_stage: { name: 'deploy', status: 'success' } } });
    return send(403, { success: false, errors: [{ code: 10000 }] });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { spawn } = await import('node:child_process');
  const runProd = () => new Promise((resolveRun) => {
    const p = spawn(process.execPath, ['scripts/dashboard_setup.mjs', '--env', 'production'], { env: { ...process.env, CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_BASE: base, DASHBOARD_SETUP_FAST: '1' } });
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => resolveRun(o));
  });
  const out = await runProd();
  const rows = (await prod.prepare('SELECT id, email, pw FROM owner').all()).results || [];
  check('dashboard:setup production binds the database and the key', calls.patch === 1, out.trim());
  check('…waits for the building deployment, then redeploys that same commit', calls.retried.join(',') === 'merge-commit-deploy' && calls.polls >= 2 && /redeploy done\(fresh-de\)/.test(out), out.trim());
  check('…copies only the owner on the owners list from preview, with his password', rows.length === 1 && rows[0].id === 'scooter' && rows[0].email === 'owner@example.test' && rows[0].pw === '{"h":"x"}' && /owner copied_from_preview\(1\)/.test(out), JSON.stringify(rows.map((r) => r.id)));
  check('…and never prints the owner address', !/owner@example\.test/.test(out));
  // Before his first preview sign-in the preview database is empty: the KV record bound to preview is read.
  await prod.prepare('DELETE FROM owner').run();
  await pv.prepare('DELETE FROM owner').run();
  const kvOut = await runProd();
  server.close();
  const kvRows = (await prod.prepare('SELECT id, email, pw, otp FROM owner').all()).results || [];
  check('…falls back to the preview KV owner record, owners list only, never its one-time code', kvRows.length === 1 && kvRows[0].email === 'kv-owner@example.test' && kvRows[0].pw === '{"h":"kv"}' && !kvRows[0].otp && /owner copied_from_preview_kv\(1\)/.test(kvOut), kvOut.trim());
}

// The sign-in limit counts refused sign-ins only: many good sign-ins from one connection never lock
// it, and ten refused ones do.
{
  const store = new Map();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    match: async (req) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
    put: async (req, res) => { store.set(req.url, await res.text()); }
  } } });
  try {
    const env = ENV();
    await seedOwner(env);
    const tryOnce = async (password) => {
      const res = await handleDashboard({ request: new Request(`${PROD}/dashboard/login`, { method: 'POST', headers: { origin: PROD, 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: OWNER, password }) }), env, now: NOW });
      return { status: res.status, location: res.headers.get('location') };
    };
    let good = 0;
    for (let i = 0; i < 15; i++) if ((await tryOnce(PW)).location === '/dashboard') good++;
    check('15 good sign-ins from one connection all open (good ones never count)', good === 15, String(good));
    for (let i = 0; i < 10; i++) await tryOnce(`wrong-${i}`);
    const after = await tryOnce(PW);
    check('…10 refused ones in the window and the next try is told to wait', after.location === '/dashboard?signin=busy', String(after.location));
  } finally {
    if (had) Object.defineProperty(globalThis, 'caches', had); else delete globalThis.caches;
  }
}

// Dropbox, DocuSign, QuickBooks and Xero: each connects through its own OAuth screen, its token is
// stored encrypted, the connection shows a real synced time the moment it is back, and Disconnect
// revokes and deletes. Stand-in provider servers; ids and secrets are invented markers.
{
  const AUTH_HOST = { dropbox: 'www.dropbox.com', docusign: 'account.docusign.com', quickbooks: 'appcenter.intuit.com', xero: 'login.xero.com' };
  const KEYS = { DROPBOX_APP_KEY: 'dbk', DROPBOX_APP_SECRET: 'dbs', DOCUSIGN_INTEGRATION_KEY: 'dsk', DOCUSIGN_SECRET_KEY: 'dss', QUICKBOOKS_CLIENT_ID: 'qbk', QUICKBOOKS_CLIENT_SECRET: 'qbs', XERO_CLIENT_ID: 'xk', XERO_CLIENT_SECRET: 'xs' };
  const seen = { revoked: [], userinfoFails: false };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    const tok = { access_token: `ACCESS-${u.host}`, refresh_token: `REFRESH-${u.host}`, expires_in: 3600 };
    if (/token\/revoke|tokens\/revoke|connect\/revocation/.test(u.pathname)) { seen.revoked.push(u.host); return json({}); }
    if (u.pathname === '/oauth2/token' || u.pathname === '/oauth/token' || u.pathname === '/oauth2/v1/tokens/bearer' || u.pathname === '/connect/token') return json(tok);
    if (u.pathname === '/2/users/get_current_account') return json({ email: 'owner-a@example.test' });
    if (u.pathname === '/oauth/userinfo') return seen.userinfoFails ? json({}, 500) : json({ email: OWNER, accounts: [{ is_default: true, account_id: 'acc1', base_uri: 'https://demo.docusign.test' }] });
    if (u.host === 'api.xero.com' && u.pathname === '/connections') return json([{ tenantId: 't1', tenantName: 'Test org' }]);
    if (u.host === 'api.xero.com') return json({ Reports: [{ Rows: [{ Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'x' }, { Value: '10' }] }] }] }] });
    if (u.host === 'quickbooks.api.intuit.com') return json({ QueryResponse: { Account: [{ CurrentBalance: 10 }] } });
    return json({ error: 'unexpected' }, 500);
  };
  try {
    const env = { ...ENV(), ...KEYS };
    await seedOwner(env);
    const s = await signIn(env, OWNER, PW);
    for (const provider of ['dropbox', 'docusign', 'quickbooks', 'xero']) {
      const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider } });
      const to = start.location ? new URL(start.location) : null;
      check(`${provider}: Connect goes to its own OAuth screen`, to?.host === AUTH_HOST[provider] && to.searchParams.get('redirect_uri') === `${PROD}/dashboard/oauth/callback`, String(start.location));
      const back = await call(env, `/dashboard/oauth/callback?state=${to?.searchParams.get('state')}&code=good${provider === 'quickbooks' ? '&realmId=r1' : ''}`, { cookie: s.cookie });
      const row = await env.PRODUCTIONS_DB.prepare('SELECT * FROM connection WHERE provider = ?').bind(provider).first();
      check(`${provider}: the callback stores the connection, token encrypted`, back.location === '/dashboard/connections?m=connected' && row && !row.token_enc.includes('REFRESH-') && !row.token_enc.includes('ACCESS-'));
      check(`${provider}: synced the moment it connected`, row?.status === 'ok' && Number(row?.last_sync) === NOW, `${row?.status} ${row?.last_sync}`);
    }
    const page = await call(env, '/dashboard/connections', { cookie: s.cookie });
    const synced = (page.text.match(/synced \d{1,2}:\d{2}/g) || []).length;
    check('Connections shows a synced time on each of the four rows', synced >= 4 && !/not synced yet/.test(page.text.split('id="choices"')[0] || ''), String(synced));
    const cash = await env.PRODUCTIONS_DB.prepare("SELECT value FROM setting WHERE key = 'acct_cash'").first();
    check('the accounting tool fills cash now', cash && JSON.parse(cash.value).amount === 10);

    // DocuSign whose account details never arrive: a red Reconnect row, never a silent "connected".
    await env.PRODUCTIONS_DB.prepare("UPDATE connection SET meta = '{}', last_sync = NULL WHERE provider = 'docusign'").run();
    seen.userinfoFails = true;
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie });
    check('DocuSign without its account details turns red with Reconnect', (await env.PRODUCTIONS_DB.prepare("SELECT status FROM connection WHERE provider = 'docusign'").first())?.status === 'broken');
    seen.userinfoFails = false;
    await env.PRODUCTIONS_DB.prepare("UPDATE connection SET status = 'ok', meta = '{}' WHERE provider = 'docusign'").run();
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie });
    const ds = await env.PRODUCTIONS_DB.prepare("SELECT status, meta, last_sync FROM connection WHERE provider = 'docusign'").first();
    check('…and looks them up again on the next sync', ds?.status === 'ok' && JSON.parse(ds.meta).account_id === 'acc1' && Number(ds.last_sync) === NOW);
    const run = JSON.parse((await env.PRODUCTIONS_DB.prepare("SELECT value FROM setting WHERE key = 'last_sync_run'").first())?.value || '{}');
    check('the sync record counts each of the four accounts that synced', run.ok === 4 && run.failed === 0, JSON.stringify(run));

    // DocuSign's testing stage: a new app works only on account-d until DocuSign moves it live.
    // Connect, the token exchange, a refresh and the sync all stay on the test server.
    seen.hosts = [];
    const wrapped = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen.hosts.push(new URL(String(url)).host); return wrapped(url, init); };
    await env.PRODUCTIONS_DB.prepare("DELETE FROM connection WHERE provider = 'docusign'").run();
    const conn = await call(env, '/dashboard/connections', { cookie: s.cookie });
    check('DocuSign offers a testing-stage Connect when not connected', /name="server" value="test"/.test(conn.text));
    const tStart = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'docusign', server: 'test' } });
    const tTo = tStart.location ? new URL(tStart.location) : null;
    check('DocuSign testing stage: Connect goes to DocuSign\'s test sign-in', tTo?.host === 'account-d.docusign.com', String(tStart.location));
    await call(env, `/dashboard/oauth/callback?state=${tTo?.searchParams.get('state')}&code=good`, { cookie: s.cookie });
    const tRow = await env.PRODUCTIONS_DB.prepare("SELECT status, meta, last_sync FROM connection WHERE provider = 'docusign'").first();
    check('…the token exchange and account lookup use the test server', seen.hosts.filter((h) => h.endsWith('docusign.com')).every((h) => h === 'account-d.docusign.com') && JSON.parse(tRow?.meta || '{}').server === 'test' && tRow?.status === 'ok' && Number(tRow?.last_sync) === NOW, seen.hosts.join(','));
    check('…and leaves no stage note behind', !(await env.PRODUCTIONS_DB.prepare("SELECT key FROM setting WHERE key LIKE 'oauth_server:%'").first()));
    const { accessToken: at } = await import('../functions/_lib/pd/providers.mjs');
    seen.hosts = [];
    await at(env, 'docusign', NOW + 2 * 3600 * 1000);
    check('…a token refresh stays on the test server', seen.hosts.includes('account-d.docusign.com') && !seen.hosts.includes('account.docusign.com'), seen.hosts.join(','));
    const tPage = await call(env, '/dashboard/connections', { cookie: s.cookie });
    check('…Connections says it is the testing stage, and Reconnect keeps it', /Testing stage/.test(tPage.text) && /value="docusign"><input type="hidden" name="server" value="test"><button type="submit" class="">Reconnect/.test(tPage.text));
    const lStart = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'docusign' } });
    check('…while the plain Connect goes to the live server', new URL(lStart.location).host === 'account.docusign.com');
    globalThis.fetch = wrapped;

    for (const provider of ['dropbox', 'quickbooks', 'xero']) await call(env, '/dashboard/disconnect', { method: 'POST', cookie: s.cookie, form: { provider } });
    check('Disconnect revokes at Dropbox, QuickBooks and Xero', ['api.dropboxapi.com', 'developer.api.intuit.com', 'identity.xero.com'].every((h) => seen.revoked.includes(h)), seen.revoked.join(','));
    check('…and deletes each token', !(await env.PRODUCTIONS_DB.prepare("SELECT provider FROM connection WHERE provider IN ('dropbox','quickbooks','xero')").first()));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// App keys are pasted on Connections, never emailed (Scooter, 14 Nov 2026): saved encrypted on this
// host's own database, never shown again in the page or any answer, owner session and same-origin
// only, refused in sample mode; Connect and the callback use them when the Worker secret is missing,
// and the Worker secret wins when both exist. Help asks for no key by email. Values are invented markers.
{
  const env = ENV();
  await seedOwner(env);
  const s = await signIn(env, OWNER, PW);
  const ID = 'PASTED-APP-KEY-7731';
  const SECRET = 'PASTED-APP-SECRET-9914';
  const leaks = (t) => [ID, SECRET, ID.slice(-6), SECRET.slice(-6), SECRET.slice(0, 10)].some((v) => String(t).includes(v));
  const before = await call(env, '/dashboard/connections', { cookie: s.cookie });
  check('keys: each of the five services has a Paste your app keys box', /Paste your app keys/.test(before.text) && ['google', 'dropbox', 'docusign', 'quickbooks', 'xero'].every((p) => new RegExp(`id="keys-${p}"[\\s\\S]*?name="provider" value="${p}"[\\s\\S]*?type="password"`).test(before.text)));
  check('keys: no plain-text field for a key', !/<input[^>]*name="(id|secret)"[^>]*type="(text|email|url)"/.test(before.text));

  const noOrigin = await call(env, '/dashboard/keys', { method: 'POST', cookie: s.cookie, origin: false, form: { provider: 'dropbox', id: ID, secret: SECRET } });
  check('keys: a POST that does not say where it came from is refused', /m=keys_foreign/.test(noOrigin.location || '') && !(await env.PRODUCTIONS_DB.prepare('SELECT provider FROM app_key').first()));
  const signedOut = await call(env, '/dashboard/keys', { method: 'POST', form: { provider: 'dropbox', id: ID, secret: SECRET } });
  check('keys: signed out cannot save', signedOut.status === 401 && !(await env.PRODUCTIONS_DB.prepare('SELECT provider FROM app_key').first()));
  const half = await call(env, '/dashboard/keys', { method: 'POST', cookie: s.cookie, form: { provider: 'dropbox', id: ID, secret: '' } });
  check('keys: one key alone is not saved', /m=keys_incomplete/.test(half.location || '') && !(await env.PRODUCTIONS_DB.prepare('SELECT provider FROM app_key').first()));

  const save = await call(env, '/dashboard/keys', { method: 'POST', cookie: s.cookie, form: { provider: 'dropbox', id: ID, secret: SECRET } });
  check('keys: saving answers 303 back to Connections', save.status === 303 && save.location === '/dashboard/connections?m=keys_saved&p=dropbox', `${save.status} ${save.location}`);
  const row = await env.PRODUCTIONS_DB.prepare("SELECT value_enc, saved_at FROM app_key WHERE provider = 'dropbox'").first();
  check('keys: stored encrypted, never in the clear', row && /^v1\./.test(row.value_enc) && !leaks(row.value_enc) && Number(row.saved_at) === NOW);
  const after = await call(env, save.location, { cookie: s.cookie });
  check('keys: the page says Saved and you can connect now', /Saved\. You can connect Dropbox now\./.test(after.text) && /id="keys-dropbox"[\s\S]*?Saved Sat, Nov 14[\s\S]*?<summary><span>Replace<\/span>/.test(after.text));
  check('keys: no part of either value is in the page', !leaks(after.text));
  check('keys: Dropbox now offers Connect', /name="provider" value="dropbox"><button type="submit" class="d-primary">Connect Dropbox/.test(after.text));
  const answers = await Promise.all(['/dashboard', '/dashboard/help', '/dashboard/check', '/dashboard/work', '/dashboard/money'].map((p) => call(env, p, { cookie: s.cookie })));
  const cron = await call(env, '/dashboard/cron/sync', { method: 'POST' });
  check('keys: no screen or answer returns them', [...answers, cron].every((r) => !leaks(r.text) && !leaks(r.location || '')));

  const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'dropbox' } });
  const to = start.location ? new URL(start.location) : null;
  check('keys: Connect uses the pasted app key when the site has none', to?.host === 'www.dropbox.com' && to.searchParams.get('client_id') === ID, String(start.location));
  const seenToken = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const json = (b) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/oauth2/token') { const p = new URLSearchParams(init.body); seenToken.push(`${p.get('client_id')}:${p.get('client_secret')}`); return json({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }); }
    if (u.pathname === '/2/users/get_current_account') return json({ email: OWNER });
    return json({});
  };
  try {
    const back = await call(env, `/dashboard/oauth/callback?state=${to?.searchParams.get('state')}&code=good`, { cookie: s.cookie });
    check('keys: the callback exchanges with the pasted pair', back.location === '/dashboard/connections?m=connected' && seenToken[0] === `${ID}:${SECRET}`, seenToken.join(','));
  } finally { globalThis.fetch = realFetch; }

  const both = { ...env, DROPBOX_APP_KEY: 'site-key', DROPBOX_APP_SECRET: 'site-secret' };
  const siteStart = await call(both, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'dropbox' } });
  check('keys: the site secret wins over a pasted pair', new URL(siteStart.location).searchParams.get('client_id') === 'site-key');
  check('keys: a service whose keys are on the site says so, with no box', /id="keys-dropbox"[\s\S]*?already set on the site/.test((await call(both, '/dashboard/connections', { cookie: s.cookie })).text));

  const replace = await call(env, '/dashboard/keys', { method: 'POST', cookie: s.cookie, form: { provider: 'dropbox', id: 'NEW-KEY-1', secret: 'NEW-SECRET-1' } });
  const replaced = await env.PRODUCTIONS_DB.prepare("SELECT COUNT(*) AS n FROM app_key WHERE provider = 'dropbox'").first();
  check('keys: Replace overwrites the pair', /keys_saved/.test(replace.location || '') && Number(replaced.n) === 1);

  const noKey = { ...env }; delete noKey.PRODUCTIONS_TOKEN_KEY;
  const refusedNoKey = await call(noKey, '/dashboard/keys', { method: 'POST', cookie: s.cookie, form: { provider: 'xero', id: ID, secret: SECRET } });
  check('keys: without the encryption key nothing is stored', /m=no_token_key/.test(refusedNoKey.location || '') && !(await env.PRODUCTIONS_DB.prepare("SELECT provider FROM app_key WHERE provider = 'xero'").first()));

  const sEnv = ENV();
  const sample = await signIn(sEnv, SAMPLE_EMAIL, SAMPLE_PASSWORD, { host: PREV });
  const sSave = await call(sEnv, '/dashboard/keys', { method: 'POST', cookie: sample.cookie, host: PREV, form: { provider: 'dropbox', id: ID, secret: SECRET } });
  check('keys: sample mode refuses the save', /m=keys_sample/.test(sSave.location || '') && !(await sEnv.PRODUCTIONS_DB.prepare('SELECT provider FROM app_key').first()), String(sSave.location));
  check('keys: sample mode shows no form', !/action="\/dashboard\/keys"/.test((await call(sEnv, '/dashboard/connections', { cookie: sample.cookie, host: PREV })).text));

  const help = await call(env, '/dashboard/help');
  const helpIn = await call(env, '/dashboard/help', { cookie: s.cookie });
  const asksByEmail = (t) => /SECRET [A-Z_]+=|Email <a href="mailto:[^"]+">[^<]+<\/a> two lines/.test(t) || /email[^.<]{0,80}\b(key|secret)\b/i.test(t.replace(/Never include a password or an app key[^.]*\./g, '').replace(/Never email a key\./g, ''));
  check('keys: Help asks for no key by email, signed in or out', !asksByEmail(help.text) && !asksByEmail(helpIn.text) && /Paste each key into its box on the Connections page/.test(help.text));
}

// Lead to delivery (Scooter, 14 Nov 2026, the whole vision). His Pipeline tab: a summary block on rows
// 1-10, column names on row 11 (Opportunity through Flag, A to N), data from row 12. Then intake from
// his own site's form, a researched lead he picks, discovery shaped per deal, the pricing builder
// (floor, his price, rationale apart), quote to proposal, acceptance to delivery, a client portal that
// shows one client only and no money, the money hold, the Google grant withdrawn, and the cash rules.
{
  const { onRequestPost } = await import('../functions/api/lead.js');
  const { discoveryQuestions, quoteMath, cashPicture, proposalDraft } = await import('../functions/_lib/pd/deal.mjs');
  const g = fakeGoogle();
  const PIPE = 'PIPELINESHEETID00000000000001';
  const head = ['Opportunity', 'Organization', 'Contact', 'Service', 'Buyer type', 'Stage', 'Owner', 'Value', 'Probability', 'Expected close', 'Next step', 'Next step date', 'Notes', 'Flag'];
  const summary = [['Pipeline summary'], ['Stage', 'Count', 'Value'], ['Discovery', '1', '9'], ['Proposal', '1', '9'], [], ['Owner', 'Open'], ['Lead', '2'], [], ['Updated', '11/14/2026'], []];
  const pipeline = [...summary, head, ['Org K film', 'Org K', 'Contact K', 'Brand', 'Foundation', 'Discovery', 'Lead', '9', '50%', '12/15/2026', 'Scope call', '11/20/2026', 'First note', ''], ['Org L summit', 'Org L', 'Contact L', 'Events', 'Brand', 'Proposal', 'Lead', '9', '30%', '1/10/2027', '', '', '', 'Hot']];
  g.sheets[PIPE] = { title: 'Pipeline test', tabs: { Pipeline: pipeline } };
  globalThis.fetch = g.fetch;
  try {
    const env = ENV({ google: true });
    await seedOwner(env);
    const s = await signIn(env, OWNER, PW);
    const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
    await call(env, `/dashboard/oauth/callback?state=${new URL(start.location).searchParams.get('state')}&code=good`, { cookie: s.cookie });
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'tracker', link: `https://docs.google.com/spreadsheets/d/${PIPE}/edit` } });
    const deals = await call(env, '/dashboard/deals', { cookie: s.cookie });
    const conn11 = (await call(env, '/dashboard/connections', { cookie: s.cookie })).text;
    check('row 11: the table under his summary block is read, not the summary', /Deals · 2/.test(deals.text) && /Org K/.test(deals.text) && /Org L/.test(deals.text) && /Pipeline, column names on row 11/.test(conn11), (deals.text.match(/Deals · \d+/g) || []).concat(conn11.match(/column names on row \d+/g) || []).join(' '));
    check('row 11: Opportunity through Flag are each understood', ['Opportunity', 'Organization', 'Service', 'Buyer type', 'Probability', 'Expected close', 'Notes', 'Flag'].every((h) => new RegExp(`<span>${h}</span><span>`).test(conn11)));
    const snap = JSON.stringify(pipeline);
    await call(env, '/dashboard/deal', { method: 'POST', cookie: s.cookie, form: { row: 'k:org-k', stage: 'Solution and budget', back: '/dashboard/flow/org-k' } });
    check('row 11: a stage change writes row 12 only, in the Stage column', pipeline[11][5] === 'Solution and budget' && JSON.stringify(pipeline.slice(0, 11)) === JSON.stringify(JSON.parse(snap).slice(0, 11)) && pipeline[12][5] === 'Proposal' && pipeline.length === 13);

    // His own site's Start a project form lands in Inquiries (productions host; email to Scooter, never the network sheet).
    const leadEnv = { ...env, LEAD_TO: 'owner-a@example.test' };
    const body = new URLSearchParams({ lead_type: 'productions_start_a_project', name: 'Person M', email: 'org-m@example.test', organization: 'Org M', initiative: 'A member summit in spring', timing: 'Next quarter', heard_about: 'Referral', source_page: '/start' });
    const lead = await onRequestPost({ request: new Request('https://westpeekproductions.com/api/lead', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }), env: leadEnv });
    const leadBody = await lead.json();
    check('intake: a Start a project submission is delivered by email and never written to the network sheet', lead.status === 200 && leadBody.ok === true && leadBody.sheet === 'not_applicable');
    const inq = await call(env, '/dashboard/inquiries', { cookie: s.cookie });
    check('intake: it shows on Inquiries with person, organization, need and owner', /Org M ›/.test(inq.text) && /Person M · org-m@example\.test/.test(inq.text) && /Needs: A member summit in spring/.test(inq.text) && /Owner: <span class="d-gap">nobody yet/.test(inq.text) && /your site/.test(inq.text));
    await call(env, '/dashboard/intake', { method: 'POST', cookie: s.cookie, form: { key: 'org-m', owner: 'Owner A', need: 'Spring member summit, hybrid', back: '/dashboard/flow/org-m' } });
    await call(env, '/dashboard/note', { method: 'POST', cookie: s.cookie, form: { key: 'org-m', text: 'Met at the conference', back: '/dashboard/flow/org-m' } });
    const second = await signIn(env, OWNER, PW);
    const recM = await call(env, '/dashboard/flow/org-m', { cookie: second.cookie });
    check('intake: the owner and need persist on a second device', /value="Owner A"/.test(recM.text) && /Spring member summit, hybrid/.test(recM.text));
    const rowsBefore = pipeline.length;
    await call(env, '/dashboard/deal/add', { method: 'POST', cookie: s.cookie, form: { key: 'org-m', back: '/dashboard/flow/org-m' } });
    const mRow = pipeline.at(-1);
    check('intake: added to his tracker as ONE row carrying owner, need and note', pipeline.length === rowsBefore + 1 && mRow[1] === 'Org M' && mRow[0] === 'Org M' && mRow[6] === 'Owner A' && /Need: Spring member summit, hybrid/.test(mRow[12]) && /Met at the conference/.test(mRow[12]) && mRow.length === 14, JSON.stringify(mRow));
    await call(env, '/dashboard/intake', { method: 'POST', cookie: s.cookie, form: { key: 'org-m', owner: 'Owner B', back: '/dashboard/flow/org-m' } });
    check('intake: once in his tracker, the owner is written to its Owner cell', pipeline.at(-1)[6] === 'Owner B');

    // The Get in touch form (15 Nov 2026): first and last name, title, the service from the six, and
    // for Virtual / hybrid event production the event dates, carried into the deal and his tracker.
    const gt = new URLSearchParams({ lead_type: 'productions_start_a_project', first_name: 'Person', last_name: 'P', job_title: 'Director P', email: 'org-p@example.test', organization: 'Org P', initiative: 'A two-day member summit', service: 'Virtual / hybrid event production', event_start: '2027-04-08', event_end: '2027-04-09', heard_about: 'Search', source_page: '/get-in-touch' });
    const gtRes = await onRequestPost({ request: new Request('https://westpeekproductions.com/api/lead', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: gt }), env: leadEnv });
    const recP = await call(env, '/dashboard/flow/org-p', { cookie: s.cookie });
    check('get in touch: the person, title, service and event dates reach the deal record; no Source line', gtRes.status === 200 && /Person P/.test(recP.text) && /Title<\/span><span>Director P/.test(recP.text) && /Service<\/span><span>Virtual &#x2F; hybrid event production|Service<\/span><span>Virtual \/ hybrid event production/.test(recP.text) && /Event dates<\/span><span>Thu, Apr 8 to Fri, Apr 9/.test(recP.text) && !/<span>Source<\/span>/.test(recP.text) && /Form request/.test(recP.text));
    const gtInq = await call(env, '/dashboard/inquiries', { cookie: s.cookie });
    check('get in touch: Inquiries shows the service and the event dates', /Service: Virtual (&#x2F;|\/) hybrid event production · event Thu, Apr 8 to Fri, Apr 9/.test(gtInq.text));
    const gtDisc = await call(env, '/dashboard/flow/org-p/discovery', { cookie: s.cookie });
    check('get in touch: Discovery starts with their service picked and their event dates filled', /value="virtual-hybrid-events" checked/.test(gtDisc.text) && /name="event_start" type="date" value="2027-04-08"/.test(gtDisc.text));
    await call(env, '/dashboard/deal/add', { method: 'POST', cookie: s.cookie, form: { key: 'org-p', back: '/dashboard/flow/org-p' } });
    const pRow = pipeline.at(-1);
    check('get in touch: added to his tracker as ONE row with the service in his Service column and the event dates in Notes', pRow[1] === 'Org P' && /Virtual \/ hybrid event production/.test(pRow[3]) && /Event: 2027-04-08 to 2027-04-09/.test(pRow[12]) && pRow.length === 14, JSON.stringify(pRow));
    const { recordWebInquiry } = await import('../functions/_lib/pd/deal.mjs');
    await recordWebInquiry(env, { first_name: 'Person', last_name: 'Q', organization: 'Org Q', email: 'org-q@example.test', service: 'Brand strategy', event_start: '2027-01-01' });
    check('get in touch: event dates are kept only for Virtual / hybrid event production', Boolean(await env.PRODUCTIONS_DB.prepare("SELECT id FROM web_inquiry WHERE org = 'Org Q' AND service = 'brand-strategy' AND event_start = '' AND name = 'Person Q'").first()));

    // A researched lead he picks by hand: one row, Source "Researched" only if his tracker has that column (it has not: nothing added).
    const before2 = pipeline.length;
    await call(env, '/dashboard/lead/add', { method: 'POST', cookie: s.cookie, form: { org: 'Org N', name: 'Person N', email: 'org-n@example.test', need: 'Annual report film', owner: 'Owner A', back: '/dashboard/inquiries' } });
    check('researched lead: exactly one row, only in his columns, never a new column', pipeline.length === before2 + 1 && pipeline.at(-1)[1] === 'Org N' && pipeline.at(-1)[6] === 'Owner A' && pipeline.at(-1).length === 14 && pipeline[10].length === 14);
    await call(env, '/dashboard/lead/add', { method: 'POST', cookie: s.cookie, form: { org: 'Org N', back: '/dashboard/inquiries' } });
    check('researched lead: never added twice', pipeline.length === before2 + 1);

    // Discovery: different questions for a foundation asking for brand work and a brand asking for an activation.
    const fq = discoveryQuestions({ services: ['brand-strategy'], buyer: 'foundation', objective: 'funding', budget: 'unknown' }).map((q) => q.id);
    const bq = discoveryQuestions({ services: ['virtual-hybrid-events'], buyer: 'brand', objective: 'sales', budget: 'initiative' }).map((q) => q.id);
    const both = discoveryQuestions({ services: ['brand-strategy', 'virtual-hybrid-events'] }).map((q) => q.id);
    check('discovery: a foundation\'s brand strategy and a brand\'s hybrid event get different questions; two services ask both sets', fq.includes('f_board') && fq.includes('b_gap') && !fq.includes('e_format') && bq.includes('e_format') && bq.includes('br_kpi') && !bq.includes('f_board') && fq.slice(0, 5).join() === bq.slice(0, 5).join() && both.includes('b_gap') && both.includes('e_format'));
    const { SERVICES } = await import('../functions/_lib/services.mjs');
    check('services: the six, in Scooter\'s order, one list', SERVICES.map((x) => x.name).join('|') === 'Content production|Podcast production|Virtual / hybrid event production|Community-As-A-Service|Brand strategy|Web development');
    const dPage = await call(env, '/dashboard/flow/org-k/discovery', { cookie: s.cookie });
    const tiles = [...dPage.text.matchAll(/<label class="d-svc"><svg[^]*?<\/svg><span>([^<]+)<\/span><input type="checkbox" name="p_services" value="([a-z-]+)"/g)];
    check('discovery: starts with the six services as icon tiles, in the site\'s order, before anything else', tiles.map((t) => t[2]).join('|') === SERVICES.map((x) => x.id).join('|') && dPage.text.indexOf('name="p_services"') < dPage.text.indexOf('name="p_buyer"') && dPage.text.indexOf('name="p_buyer"') < dPage.text.indexOf('name="a_call_department"'), tiles.map((t) => t[1]).join('|'));
    check('discovery: the deal\'s own Service and Buyer type columns pre-pick the service and Organization type', /value="brand-strategy" checked/.test(dPage.text) && /value="foundation" selected/.test(dPage.text) && /board or trustees/.test(dPage.text) && />Organization type</.test(dPage.text) && !/Who is buying/.test(dPage.text));
    check('discovery: space for his sales-call notes, all six', ['call_department', 'call_happening', 'call_working', 'call_length', 'call_timeline', 'call_next'].every((id) => new RegExp(`name="a_${id}"`).test(dPage.text)) && /Which department are we working with/.test(dPage.text) && /What is working, and what is not working/.test(dPage.text) && /Next steps/.test(dPage.text));
    await call(env, '/dashboard/discovery', { method: 'POST', cookie: s.cookie, form: [['key', 'org-k'], ['p_services', 'brand-strategy'], ['p_services', 'virtual-hybrid-events'], ['p_services', 'not-a-service'], ['p_buyer', 'foundation'], ['p_objective', 'funding'], ['p_budget', 'unknown'], ['event_start', '2027-03-04'], ['event_end', '2027-03-05'], ['a_outcome', 'Funders understand the grantee work'], ['a_audience', 'Program officers'], ['a_call_department', 'Communications team'], ['back', '/dashboard/flow/org-k/discovery']] });
    const dBack = (await call(env, '/dashboard/flow/org-k/discovery', { cookie: second.cookie })).text;
    check('discovery: services, event dates, call notes and answers persist on a second device (an unknown service is dropped)', /Funders understand the grantee work/.test(dBack) && /Communications team/.test(dBack) && /value="brand-strategy" checked/.test(dBack) && /value="virtual-hybrid-events" checked/.test(dBack) && !/not-a-service/.test(dBack) && /name="event_start" type="date" value="2027-03-04"/.test(dBack) && /name="event_end" type="date" value="2027-03-05"/.test(dBack) && /What should attendees do in the week after the event/.test(dBack));
    check('discovery: the deal record shows the event dates carried from discovery', /Event dates<\/span><span>Thu, Mar 4 to Fri, Mar 5/.test((await call(env, '/dashboard/flow/org-k', { cookie: s.cookie })).text));

    // Money hold: a Google connection that still holds the wide grant refuses rates and quotes.
    await env.PRODUCTIONS_DB.prepare("UPDATE connection SET scopes = ? WHERE provider = 'google'").bind('openid https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.compose').run();
    const held = await call(env, '/dashboard/quote', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', qty_L11: '1', price: '9', back: '/dashboard/flow/org-k/quote' } });
    check('money hold: no quote is kept while the wide Google grant stands', /m=money_held/.test(held.location || '') && !(await env.PRODUCTIONS_DB.prepare('SELECT id FROM quote').first()));
    // The next sync withdraws the wide grant at Google by itself, and Today says so.
    const revoked0 = g.revoked.length;
    await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
    const today = await call(env, '/dashboard', { cookie: s.cookie });
    check('grant: the next sync withdraws the wider Google grant at Google; his named sheets stay', g.revoked.length === revoked0 + 1 && !(await env.PRODUCTIONS_DB.prepare("SELECT provider FROM connection WHERE provider = 'google'").first()) && (await env.PRODUCTIONS_DB.prepare("SELECT kind FROM source WHERE kind = 'tracker'").first()) && /Google(&#39;|')s wider access was withdrawn/.test(today.text));
    const st = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
    check('grant: reconnecting asks Google for no Gmail and no Drive contents', !/gmail|drive\.readonly/.test(new URL(st.location).searchParams.get('scope')));
    await call(env, `/dashboard/oauth/callback?state=${new URL(st.location).searchParams.get('state')}&code=good`, { cookie: s.cookie });

    // The catalog (optional now; kept for a possible event rate card): rates are his, kept encrypted.
    const cat = await call(env, '/dashboard/catalog', { cookie: s.cookie });
    check('catalog: the structure is there and every rate starts unknown', /Account lead time/.test(cat.text) && !/name="cost_0" inputmode="decimal" value="\d/.test(cat.text));
    const catForm = { n: '3', id_0: 'L11', line_0: 'Discovery workshop', service_0: 'brand', unit_0: 'session', cost_0: '700', id_1: 'L12', line_1: 'Narrative and messaging', service_1: 'brand', unit_1: 'deliverable', cost_1: '', id_2: 'L20', line_2: 'Account lead time', service_2: 'team', unit_2: 'hour', cost_2: '90', back: '/dashboard/catalog' };
    const cs = await call(env, '/dashboard/catalog', { method: 'POST', cookie: s.cookie, form: catForm });
    const catRow = await env.PRODUCTIONS_DB.prepare('SELECT data_enc FROM catalog').first();
    check('catalog: saved, read back, and stored encrypted (no rate in plain)', /m=catalog_saved/.test(cs.location || '') && catRow && !/700|Discovery workshop/.test(catRow.data_enc));
    // A rate-card line keeps its tier and quantity through the page's own fields (review, 16 Nov 2026).
    {
      const { readCatalog } = await import('../functions/_lib/pd/deal.mjs');
      await call(env, '/dashboard/catalog', { method: 'POST', cookie: s.cookie, form: { ...catForm, tier_0: 'Gold', qty_0: '2' } });
      const page = await call(env, '/dashboard/catalog', { cookie: s.cookie });
      const f = (page.text.match(/<form class="d-form" method="post" action="\/dashboard\/catalog">([\s\S]*?)<\/form>/) || [])[1] || '';
      const form = {};
      for (const m of f.matchAll(/<input ([^>]*)>/g)) { const name = (m[1].match(/name="([^"]*)"/) || [])[1]; if (name) form[name] = ((m[1].match(/value="([^"]*)"/) || [])[1] || ''); }
      for (const m of f.matchAll(/<select id="[^"]*" name="([^"]*)">([\s\S]*?)<\/select>/g)) form[m[1]] = ((m[2].match(/<option value="([^"]*)" selected>/) || [])[1] || '');
      form.cost_2 = '95';
      await call(env, '/dashboard/catalog', { method: 'POST', cookie: s.cookie, form });
      const back = await readCatalog(env, false);
      const l0 = back.find((l) => l.id === 'L11');
      check('catalog: a tier and quantity survive correcting another rate on the page', l0?.tier === 'Gold' && l0?.qty === 2 && back.find((l) => l.id === 'L20')?.cost === 95 && back.filter((l) => l.tier).length === 1);
      await call(env, '/dashboard/catalog', { method: 'POST', cookie: s.cookie, form: catForm });
    }
    // The quote builder (Scooter, 15 Nov 2026; quote-builder-format.pdf): a service loads its roles and
    // cost categories; people come from a team directory; each role is billed its own way.
    const formOf = (html) => {
      const out = [];
      const f = (html.match(/<form class="d-form" method="post" action="\/dashboard\/quote">([\s\S]*?)<\/form>/) || [])[1] || '';
      for (const m of f.matchAll(/<input ([^>]*)>/g)) {
        const a = m[1]; const name = (a.match(/name="([^"]*)"/) || [])[1]; if (!name) continue;
        const value = ((a.match(/value="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
        if (/type="checkbox"/.test(a)) { if (/ checked/.test(a)) out.push([name, value]); } else out.push([name, value]);
      }
      for (const m of f.matchAll(/<select [^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) out.push([m[1], ((m[2].match(/<option value="([^"]*)" selected>/) || m[2].match(/<option value="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&')]);
      for (const m of f.matchAll(/<textarea id="[^"]*" name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) out.push([m[1], m[2]]);
      return out;
    };
    const setF = (pairs, changes) => { const out = pairs.filter(([k]) => !(k in changes)); for (const [k, v] of Object.entries(changes)) if (v !== null) out.push([k, v]); return out; };
    const qp0 = await call(env, '/dashboard/flow/org-k/quote', { cookie: s.cookie });
    check('quote: each service from Discovery loads its roles and cost categories (strategy, account management, coordination), every rate and box blank',
      /hybrid event production<\/h3>/.test(qp0.text) && /Brand strategy<\/h3>/.test(qp0.text) && ['Brand lead', 'Strategy and planning', 'Account management', 'Coordination', 'Strategy and run of show', 'Production manager'].every((r) => qp0.text.includes(`>${r}</span>`)) && /Licences and fonts<\/span><span class="d-role__tag">Other cost/.test(qp0.text)
      && !/name="rl_[^"]+_(rate|qty|hours|months)" inputmode="decimal" value="[^"]/.test(qp0.text) && /name="price_brand-strategy" inputmode="decimal" value=""/.test(qp0.text) && !/name="rl_content-production/.test(qp0.text)
      && qp0.text.indexOf('name="rl_virtual-hybrid-events_0_who"') < qp0.text.indexOf('name="rl_brand-strategy_0_who"'));
    check('quote: every role has Assigned to (with add a person) and Billed as with all six units, defaulting by role', ['Flat fee for the whole job', 'Flat fee per month', 'Flat fee per episode or event', 'Hourly, hours per month', 'Hourly, hours per episode or event', 'Hourly, total hours for the job'].every((l) => qp0.text.includes(l)) && /Not chosen<\/option>/.test(qp0.text) && /\+ Add a new person/.test(qp0.text)
      && /name="rl_brand-strategy_0_billed">[\s\S]*?<option value="job" selected>/.test(qp0.text) && /name="rl_brand-strategy_2_billed">[\s\S]*?<option value="hourly_total" selected>/.test(qp0.text));
    check('quote: nothing is hard-coded as "You" and nobody is pre-assigned', !/>You<|"You"|Your client price|Your price/.test(qp0.text) && !/name="rl_[^"]+_who">(?:(?!<\/select>)[\s\S])*<option value="p[A-Za-z0-9_-]{8}" selected>/.test(qp0.text));

    // The team directory: owner, team member and contractor; rates per hour, month or job; add and remove.
    const td = await call(env, '/dashboard/team', { method: 'POST', cookie: s.cookie, form: { n: '4', pname_0: 'Person A', ptype_0: 'owner', prate_0: '150', pper_0: 'hour', pname_1: 'Person C', ptype_1: 'contractor', prate_1: '2000', pper_1: 'job', pname_2: 'Person T', ptype_2: 'team', prate_2: '', pper_2: 'month', pname_3: 'Person Gone', ptype_3: 'team', back: '/dashboard/flow/org-k/quote' } });
    const dirRow = await env.PRODUCTIONS_DB.prepare('SELECT data_enc FROM team_directory WHERE sample = 0').first();
    const tdv = await call(env, '/dashboard/team', { cookie: second.cookie });
    const goneId = (tdv.text.match(/name="pid_3" value="([^"]+)"/) || [])[1];
    check('team directory: saved, read back on a second device, encrypted (no name or rate in plain), a blank rate stays blank', /m=team_dir_saved/.test(td.location || '') && dirRow && !/Person A|150/.test(dirRow.data_enc) && /value="Person A"/.test(tdv.text) && /value="Person T"/.test(tdv.text) && /name="prate_2" inputmode="decimal" value=""/.test(tdv.text) && /<option value="owner" selected>Owner/.test(tdv.text));
    const keep = [...tdv.text.matchAll(/name="pid_(\d)" value="([^"]+)"/g)].map((x) => x[2]);
    await call(env, '/dashboard/team', { method: 'POST', cookie: s.cookie, form: { n: '4', pid_0: keep[0], pname_0: 'Person A', ptype_0: 'owner', prate_0: '150', pper_0: 'hour', pid_1: keep[1], pname_1: 'Person C', ptype_1: 'contractor', prate_1: '2000', pper_1: 'job', pid_2: keep[2], pname_2: 'Person T', ptype_2: 'team', prate_2: '', pper_2: 'month', pid_3: goneId, pname_3: '', back: '/dashboard/team' } });
    const tdv2 = await call(env, '/dashboard/team', { cookie: s.cookie });
    check('team directory: clearing a name removes that person; the others keep their ids', !/Person Gone/.test(tdv2.text) && keep.slice(0, 3).every((id) => tdv2.text.includes(`value="${id}"`)));
    const [idA, idC, idT] = keep;

    const qp1 = await call(env, '/dashboard/flow/org-k/quote', { cookie: s.cookie });
    check('quote: the directory fills Assigned to, grouped by type', /<optgroup label="Owner"><option value="[^"]+">Person A</.test(qp1.text) && /<optgroup label="Contractor"><option value="[^"]+">Person C</.test(qp1.text));
    const B = 'rl_brand-strategy_'; const E = 'rl_virtual-hybrid-events_';
    const build = (extra) => setF(formOf(qp1.text), {
      [`${B}0_who`]: idC, // Brand lead, flat for the job, Person C's standard 2000 a job
      [`${B}1_who`]: idA, [`${B}1_hours`]: '10', // Strategy, hourly total, owner at 150 an hour = 1500
      [`${B}2_who`]: idA, [`${B}2_hours`]: '5', [`${B}2_rate`]: '100', // Account management, rate for this quote only = 500
      [`${B}3_out`]: '1', // Coordination left out
      [`${B}4_newname`]: 'Person N', [`${B}4_newtype`]: 'contractor', [`${B}4_newrate`]: '800', [`${B}4_newper`]: 'job', // Designer: a new person, 800 a job
      [`${E}3_qty`]: '2', [`${E}3_rate`]: '700', // Production manager, per event, nobody assigned = 1400
      'price_brand-strategy': '7500', 'price_virtual-hybrid-events': '4500', disc: '1000', disc_mode: 'amount',
      own_model: 'hours', own_who: idA, own_hours: '4', ov_value: '10', ov_mode: 'pct', tax: '20', term: '6', plan: 'monthly', rationale: 'A story funders can repeat', title: 'Proposal for Org K', ...extra
    });
    // Billed as swaps a row's boxes the moment it changes, before a save (review 16 Nov 2026): every box is
    // on the row and the page's CSS shows only the ones the checked choice needs.
    const row0 = (qp1.text.match(/<div class="d-role">[\s\S]*?name="rl_brand-strategy_0_billed"[\s\S]*?<p class="d-role__cost">/) || [''])[0];
    check('quote: Billed as swaps the row\'s boxes without a save', ['rate', 'qty', 'hours', 'months'].every((k) => row0.includes(`data-box="${k}"`)) && /class="d-billed"/.test(row0) && qp1.text.includes('.d-role:has(.d-billed option[value="job"]:checked) .d-box:not([data-box="rate"]){display:none}') && qp1.text.includes('.d-role:has(.d-billed option[value="hourly_month"]:checked) .d-box:not([data-box="rate"],[data-box="hours"],[data-box="months"]){display:none}'));
    const q1 = await call(env, '/dashboard/quote', { method: 'POST', cookie: s.cookie, form: build({}) });
    const qp = await call(env, '/dashboard/flow/org-k/quote', { cookie: second.cookie });
    const strip = (qp.text.match(/<div class="d-strip">([\s\S]*?)<\/div>\s*<details/) || [])[1] || '';
    check('quote: client price, discount, costs and margin together: price as typed, a discount lowers price not cost, costs from the billed units', /m=quote_saved/.test(q1.location || '') && /Client price<\/span><strong>[$]12,000/.test(strip) && /Discount<\/span><strong>[$]1,000/.test(strip) && /Costs so far<\/span><strong>[$]6,200/.test(strip), strip.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    // net 11,000 − costs 6,200 − owner time 600 − overhead 1,100 = 3,100; tax reserve 20% = 620; margin 2,480.
    check('quote: owner time, overhead and tax reserve are separate visible costs, and the margin says what it includes', /Margin<\/span><strong class="">[$]2,480 · 23%/.test(strip) && /Owner time \(planned\)<br><span class="d-sub">In the margin<\/span><\/span><span>[$]600/.test(qp.text) && /Overhead<br><span class="d-sub">In the margin<\/span><\/span><span>[$]1,100/.test(qp.text) && /[$]620/.test(qp.text) && /minus roles, other costs, owner time, overhead, tax reserve/.test(qp.text) && /Roles assigned to an owner<\/span><span>[$]2,000/.test(qp.text));
    check('quote: unknown costs stay blank and flagged, never zero; margin provisional while a role is unpriced or unassigned', /provisional/.test(strip) && /Not priced yet: [^<]*Brand strategy · Licences and fonts/.test(qp.text) && /Nobody assigned: [^<]*Production manager/.test(qp.text) && /name="rl_brand-strategy_5_rate" inputmode="decimal" value=""/.test(qp.text) && /Not priced: rate needed/.test(qp.text));
    check('quote: a rate typed on a quote is for that quote only; the standard rate is untouched', /name="rl_brand-strategy_2_rate" inputmode="decimal" value="100"/.test(qp.text) && /rate set for this quote only/.test(qp.text) && /name="prate_0" inputmode="decimal" value="150"/.test((await call(env, '/dashboard/team', { cookie: s.cookie })).text));
    check('quote: a person added on a role is saved to the directory and assigned there', /<option value="[^"]+" selected>Person N</.test(qp.text) && /value="Person N"/.test((await call(env, '/dashboard/team', { cookie: second.cookie })).text) && /Cost [$]800/.test(qp.text));
    check('quote: a left-out role stays listed but out of the math', /d-role d-role--out[\s\S]*?Coordination[\s\S]*?Left out of this quote/.test(qp.text));
    check('quote: each role keeps its own hours, quantity and months, apart from the 6-month engagement', /name="rl_brand-strategy_1_hours" inputmode="decimal" value="10"/.test(qp.text) && /name="rl_virtual-hybrid-events_3_qty" inputmode="decimal" value="2"/.test(qp.text) && /[$]1,833 a month for 6 months/.test(qp.text));
    // A custom role, and the margin without overhead.
    await call(env, '/dashboard/quote', { method: 'POST', cookie: s.cookie, form: setF(build({ 'nr_brand-strategy_name': 'Photo retoucher', 'nr_brand-strategy_kind': 'role' }), { inc_overhead: null }) });
    const qpC = await call(env, '/dashboard/flow/org-k/quote', { cookie: s.cookie });
    check('quote: a custom role can be added (and is billed by its kind\'s default); the margin can leave overhead out and says so', /value="Photo retoucher"/.test(qpC.text) && /name="rl_brand-strategy_6_billed">[\s\S]*?<option value="hourly_total" selected>/.test(qpC.text) && /Not included: overhead/.test(qpC.text) && /Margin<\/span><strong class="">[$]3,360/.test(qpC.text));
    // The last save, with no discount and nothing custom, for the proposal below.
    await call(env, '/dashboard/quote', { method: 'POST', cookie: s.cookie, form: build({ disc: '' }) });
    const qp2 = await call(env, '/dashboard/flow/org-k/quote', { cookie: second.cookie });
    check('quote: payment timing against when costs go out, month by month', /Month 1/.test(qp2.text) && /Month 6/.test(qp2.text) && /[$]2,000 a month for 6 months/.test(qp2.text));

    const { roleCost, rolesFromCatalog, catalogTiers } = await import('../functions/_lib/pd/deal.mjs');
    const rc = (billed, v) => roleCost({ billed, ...v }).cost;
    check('billing units: flat job, per month, per episode, hourly per month, per episode, in total', rc('job', { rate: 900 }) === 900 && rc('month', { rate: 500, months: 3 }) === 1500 && rc('unit', { rate: 200, qty: 6 }) === 1200 && rc('hourly_month', { rate: 50, hours: 10, months: 3 }) === 1500 && rc('hourly_unit', { rate: 50, hours: 2, qty: 6 }) === 600 && rc('hourly_total', { rate: 50, hours: 7 }) === 350);
    check('billing units: any box the unit needs that is empty leaves the cost unknown (never zero)', rc('hourly_month', { rate: 50, hours: 10 }) === null && rc('unit', { qty: 6 }) === null && roleCost({ billed: 'month', months: 2, who: 'x' }, [{ id: 'x', rate: 40, per: 'hour' }]).mismatch === true);
    const card = [{ id: 'L1', service: 'virtual-hybrid-events', line: 'Stream crew', unit: 'day', cost: 300, tier: 'Gold', qty: 2 }, { id: 'L2', service: 'virtual-hybrid-events', line: 'Stream crew', unit: 'day', cost: 300, tier: 'Silver', qty: 1 }, { id: 'L3', service: 'virtual-hybrid-events', line: 'Producer time', unit: 'hour', cost: 80, tier: 'Gold', qty: 10 }];
    const gold = rolesFromCatalog(card, 'virtual-hybrid-events', 'Gold');
    check('event rate card: its tiers are offered and a tier loads its lines with their quantities and standard rates', catalogTiers(card, 'virtual-hybrid-events').join() === 'Gold,Silver' && gold.length === 2 && roleCost(gold[0]).cost === 600 && roleCost(gold[1]).cost === 800 && gold.every((r) => r.rate === null));
    const qmD = quoteMath({ services: [{ id: 'a', name: 'A', price: 1000, roles: [{ name: 'R', billed: 'job', rate: 400, who: 'p' }] }], discount: { mode: 'pct', value: 10 }, include: { owner: false, overhead: false, tax: false } }, [{ id: 'p', type: 'team' }]);
    check('discount: lowers the price, not the cost, so it comes out of margin; fully priced and assigned is no longer provisional', qmD.net === 900 && qmD.cost === 400 && qmD.margin.amount === 500 && qmD.margin.provisional.length === 0);
    const qmO = (model, v) => quoteMath({ services: [{ id: 'a', name: 'A', price: 1000, roles: [] }], term: 3, ownerPlan: { model, ...v } }).ownerTime;
    check('owner time: planned by hours at a rate, a monthly amount over the engagement, or a share of price; not planned is named', qmO('hours', { hours: 3, rate: 100 }) === 300 && qmO('monthly', { monthly: 200 }) === 600 && qmO('share', { share: 10 }) === 100 && quoteMath({ services: [{ id: 'a', name: 'A', price: 1000, roles: [] }] }).margin.provisional.includes('owner time not set'));
    // The cash timeline carries every cost the margin includes (review 16 Nov 2026): roles, owner time,
    // overhead and the tax reserve; its total out equals price after discount minus the margin.
    const qT = (include) => quoteMath({ services: [{ id: 'a', name: 'A', price: 1200, roles: [{ name: 'R', billed: 'job', rate: 300, who: 'p' }] }], term: 3, ownerPlan: { model: 'monthly', monthly: 50 }, overhead: { mode: 'pct', value: 10 }, taxReserve: 20, include }, [{ id: 'p', type: 'team' }]);
    const tAll = qT({ owner: true, overhead: true, tax: true });
    const outAll = tAll.timeline.reduce((a, t) => a + t.cashOut, 0);
    check('cash timeline: total out equals the costs the margin includes (roles, owner time, overhead, tax reserve)', Math.abs(outAll - (tAll.net - tAll.margin.amount)) < 1e-6 && Math.abs(tAll.timeline[2].position - tAll.margin.amount) < 1e-6 && outAll > tAll.cost, `out ${outAll}, net ${tAll.net}, margin ${tAll.margin.amount}`);
    const tNone = qT({ owner: false, overhead: false, tax: false });
    check('cash timeline: a cost left out of the margin is left out of cash out too', Math.abs(tNone.timeline.reduce((a, t) => a + t.cashOut, 0) - tNone.cost) < 1e-6);
    check('owner time on a monthly plan goes out each month', Math.abs(tAll.timeline[0].cashOut - tAll.timeline[1].cashOut) < 1e-6);
    check('a discount bigger than the price is flagged', quoteMath({ services: [{ id: 'a', name: 'A', price: 100, roles: [] }], discount: { mode: 'amount', value: 300 } }).overDiscount === true && tAll.overDiscount === false);
    const qm0 = quoteMath({ services: [{ name: 'x', cost: 2000, price: null }] });
    check('quote: nothing ever derives a client price from a cost', qm0.price === null && qm0.margin === null);
    const m = quoteMath({ services: [{ name: 'x', cost: 5000, price: 6000, month: 1 }], term: 3, plan: 'monthly' });
    check('quote: a month where costs go out before payment arrive is named', m.shortMonths.includes(1) && m.timeline[2].position === 1000);
    check('quote: every quote is stored encrypted', !(await env.PRODUCTIONS_DB.prepare('SELECT data_enc FROM quote').all()).results.some((r) => /7500|Person|Brand lead|funders/.test(r.data_enc)));

    // Quote to proposal: the draft carries price, scope and term; never the floor, a rate or the margin.
    await call(env, '/dashboard/proposal', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', do: 'draft', back: '/dashboard/flow/org-k/proposal' } });
    const pp = await call(env, '/dashboard/flow/org-k/proposal', { cookie: s.cookie });
    const text = (pp.text.match(/<textarea id="pr-text"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '';
    check('proposal: drafted from the quote and discovery, editable: services with his prices, the event dates, his total', /Funders understand the grantee work/.test(text) && /[$]12,000 in total/.test(text) && /bundled over 6 months, [$]2,000 a month/.test(text) && /Brand strategy: [$]7,500/.test(text) && /hybrid event production: [$]4,500/.test(text) && /Event dates: 2027-03-04 to 2027-03-05/.test(text));
    // Internal costs never reach anything the client sees (Scooter, 15 Nov 2026).
    check('proposal: never a role, a person, a rate, a cost or the margin', !/Person [ACTN]|Brand lead|Account management|Production manager|Designer|\b150\b|\b700\b|\b800\b|1,400|6,200|margin|floor|cost|overhead|tax reserve|owner time/i.test(text));
    await call(env, '/dashboard/proposal', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', do: 'save', status: 'sent', text: `${text.replace(/&amp;/g, '&')}\nEdited by hand.`, back: '/dashboard/flow/org-k/proposal' } });
    const pp2 = await call(env, '/dashboard/flow/org-k/proposal', { cookie: second.cookie });
    check('proposal: his edit and its Sent status persist on a second device', /Edited by hand\./.test(pp2.text) && /Sent to the client · version 2/.test(pp2.text));
    check('proposal: the deal record carries discovery, quote, proposal, documents and emails in one place', ((t) => /Discovery ›/.test(t) && /Sent to the client/.test(t) && /href="\/dashboard\/find\?q=Org%20K">Documents</.test(t) && /mail\.google\.com\/mail\/u\/0\/#search/.test(t))((await call(env, '/dashboard/flow/org-k', { cookie: s.cookie })).text));

    // Accepted: the deal moves to his signed stage in his tracker, and the work side starts.
    const acc = await call(env, '/dashboard/proposal', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', do: 'accept', team: 'Owner A: account lead', back: '/dashboard/flow/org-k/proposal' } });
    const tokenK = new URL(`${PROD}${acc.location}`).searchParams.get('portal');
    check('accepted: the deal moves to Signed agreement in his tracker, read back', pipeline[11][5] === 'Signed agreement' && /m=accepted/.test(acc.location || ''));
    const dv = await call(env, acc.location, { cookie: s.cookie });
    check('accepted: account team, a task per quoted service (never a specialist) and the portal link shown once', /Owner A: account lead/.test(dv.text) && />Brand strategy</.test(dv.text) && /hybrid event production</.test(dv.text) && !/Person [ACTN]|Brand lead|Production manager/.test(dv.text) && dv.text.includes(`/portal/${tokenK}`));
    check('accepted: no invoice is created', !(await env.PRODUCTIONS_DB.prepare("SELECT row_id FROM row_cache WHERE kind = 'invoices'").first()) && !Object.values(g.sheets).some((x) => x.tabs.Invoices));
    check('accepted: the portal link itself is never stored, only its hash', !JSON.stringify((await env.PRODUCTIONS_DB.prepare('SELECT * FROM portal').all()).results).includes(tokenK));
    await call(env, '/dashboard/delivery/task', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', title: 'Internal budget check', owner: 'Owner A', back: '/dashboard/flow/org-k/delivery' } });
    await call(env, '/dashboard/delivery/asset', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', label: 'Shared folder K', url: 'https://drive.google.com/drive/folders/folder-k', client: '1', back: '/dashboard/flow/org-k/delivery' } });
    const taskId = (await env.PRODUCTIONS_DB.prepare("SELECT id FROM task WHERE key = 'org-k' AND title = 'Brand strategy'").first())?.id ?? -1;
    await call(env, '/dashboard/delivery/task/set', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', id: String(taskId), field: 'done', value: '1', back: '/dashboard/flow/org-k/delivery' } });

    // A second client, accepted the same way, has its own portal.
    await call(env, '/dashboard/quote', { method: 'POST', cookie: s.cookie, form: { key: 'org-l', svc: 'web-development', 'price_web-development': '4000', back: '/dashboard/flow/org-l/quote' } });
    await call(env, '/dashboard/proposal', { method: 'POST', cookie: s.cookie, form: { key: 'org-l', do: 'draft', back: '/dashboard/flow/org-l/proposal' } });
    const accL = await call(env, '/dashboard/proposal', { method: 'POST', cookie: s.cookie, form: { key: 'org-l', do: 'accept', team: '', back: '/dashboard/flow/org-l/proposal' } });
    const tokenL = new URL(`${PROD}${accL.location}`).searchParams.get('portal');
    await call(env, '/dashboard/delivery/task', { method: 'POST', cookie: s.cookie, form: { key: 'org-l', title: 'Venue walk-through L', client: '1', back: '/dashboard/flow/org-l/delivery' } });

    const { handlePortal } = await import('../functions/_lib/productions-dashboard.mjs');
    const portal = async (t, host = PROD) => { const r = await handlePortal({ request: new Request(`${host}/portal/${t}`), env }); return { status: r.status, text: await r.text() }; };
    const pK = await portal(tokenK);
    check('portal: the client sees their own tasks (done marked) and shared files', pK.status === 200 && /Org K/.test(pK.text) && /<s>Brand strategy<\/s>/.test(pK.text) && /Shared folder K/.test(pK.text));
    check('portal: never an internal task, another client, a note, a quote, a specialist, a cost, a price or money', !/Internal budget check|Org L|Venue walk-through L|Board|First note|12,000|7,500|7500|2000|2,000|1500|Specialist B|Specialist V|Person [ACTN]|Brand lead|\$|Proposal|margin|floor|cost/i.test(pK.text.replace(/<style>[\s\S]*?<\/style>/, '')));
    const pL = await portal(tokenL);
    check('portal: each client sees only their own', /Venue walk-through L/.test(pL.text) && !/Shared folder K|Org K/.test(pL.text) && !/<s>/.test(pL.text));
    check('portal: a made-up link opens nothing', (await portal('A'.repeat(32))).status === 404);
    check('portal: other hosts 404', (await portal(tokenK, 'https://joinwestpeek.com')).status === 404);
    await call(env, '/dashboard/delivery/portal', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', do: 'off', back: '/dashboard/flow/org-k/delivery' } });
    check('portal: turned off, the link stops working at once', (await portal(tokenK)).status === 404 && (await portal(tokenL)).status === 200);
    const nw = await call(env, '/dashboard/delivery/portal', { method: 'POST', cookie: s.cookie, form: { key: 'org-k', do: 'new', back: '/dashboard/flow/org-k/delivery' } });
    const tokenK2 = new URL(`${PROD}${nw.location}`).searchParams.get('portal');
    check('portal: a new link works, the old one does not', (await portal(tokenK2)).status === 200 && (await portal(tokenK)).status === 404);

    // Keep money out also holds the pricing builder.
    await call(env, '/dashboard/choice', { method: 'POST', cookie: s.cookie, form: { key: 'money', value: 'off', back: '/dashboard/access#limit' } });
    check('money hold: with Keep money out, the quote page shows no figures', /Keep money out is on/.test((await call(env, '/dashboard/flow/org-k/quote', { cookie: s.cookie })).text) && !/[$]12,000|Specialist B/.test((await call(env, '/dashboard/flow/org-k/quote', { cookie: s.cookie })).text));
    await call(env, '/dashboard/choice', { method: 'POST', cookie: s.cookie, form: { key: 'money', value: 'on', back: '/dashboard/access#limit' } });

    // Synced copies can be deleted on request; his sheets are not touched.
    const pipeBefore = JSON.stringify(pipeline);
    await call(env, '/dashboard/copies/delete', { method: 'POST', cookie: s.cookie });
    check('copies: Delete the synced copies empties the copy and leaves his sheet as it was', Number((await env.PRODUCTIONS_DB.prepare('SELECT COUNT(*) AS n FROM row_cache').first()).n) === 0 && JSON.stringify(pipeline) === pipeBefore);
    check('access: the page says what is stored, who can reach it and how it is deleted', ((t) => /How it is deleted/.test(t) && /Backups are kept 30 days/.test(t) && /administrators could technically open/.test(t))((await call(env, '/dashboard/access', { cookie: s.cookie })).text));
    check('backup: every new table is carried', ['web_inquiry', 'intake', 'discovery', 'catalog', 'quote', 'proposal', 'delivery', 'task', 'asset', 'portal'].every((t) => BACKUP_TABLES.includes(t) && TABLE_WORDS[t]));
  } finally {
    globalThis.fetch = realFetch;
  }

  // The cash rules, as numbers.
  const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
  const pic = cashPicture({
    now: NOW,
    cash: [{ week: day(-2), opening: '10000' }],
    invoices: [
      { id: 'I1', client: 'Org A', amount: '1000', status: 'Paid', settled_on: '' },
      { id: 'I2', client: 'Org B', amount: '2000', status: 'Paid', settled_on: day(-5) },
      { id: 'I3', client: 'Org C', amount: '3000', status: 'Sent', issued: day(-10), terms: 'Net 30' },
      { id: 'I4', client: 'Org D', amount: '4000', status: 'Sent', terms: 'On delivery' },
      { id: 'I5', client: 'Org E', amount: '500', status: 'Sent', issued: day(-40), terms: 'Net 30' }
    ],
    receipts: [{ client: 'Org C', amount: '3000', date: day(20) }, { client: 'Org F', amount: '700', date: day(-3) }, { client: 'Org G', amount: '800', date: day(5) }]
  });
  check('cash: "paid" on a sheet with no settled date is neither cash nor forecast', pic.markedOnly.length === 1 && pic.markedOnly[0].what === 'Invoice I1' && !pic.forecast.some((f) => f.what === 'Invoice I1'));
  check('cash: actual and forecast stay two numbers', pic.actual.amount === 10000 && pic.forecastNext4 === 4300 && pic.forecast.find((f) => f.client === 'Org E')?.overdue === true);
  check('cash: a payment already in the balance is not counted again, and a receipt that is an open invoice counts once', pic.alreadyInBalance === 2 && pic.forecast.filter((f) => f.client === 'Org C').length === 1);
  check('cash: payment terms carry through: Net 30 from issue; "on delivery" waits out of the forecast', new Date(pic.forecast.find((f) => f.client === 'Org C').at).toISOString().slice(0, 10) === day(20) && pic.held.some((h) => h.client === 'Org D' && /delivery/i.test(h.waits)));
  check('proposal draft: no unknown or team line leaks', !/Specialist/.test(proposalDraft({ name: 'Org A', quote: { lines: [{ line: 'Specialist time', qty: 2, unit: 'hour', team: true, cost: 100 }], price: 100, term: 0, plan: 'signing' }, discovery: null })));
}

// His Pipeline tab exactly as he describes it (Porter takeover, 14 Nov 2026): a summary block on rows 1-10
// whose own labels reuse his column words (Stage, Owner, Value, Notes, Organization), the header row on
// row 11 across A to N (Opportunity through Flag), data from row 12. Read: only the table. Update: only
// the cell he changes, in place; the summary block, the header row and every other row stay as they were.
{
  const g = fakeGoogle();
  const PIPE = 'PIPELINESHEETID00000000000002';
  const head = ['Opportunity', 'Organization', 'Contact', 'Service', 'Buyer type', 'Stage', 'Owner', 'Value', 'Probability', 'Expected close', 'Next step', 'Next step date', 'Notes', 'Flag'];
  const summary = [
    ['Pipeline', '', '', '', 'Updated', '11/14/2026'],
    ['Stage', 'Count', 'Value', 'Weighted', 'Owner', 'Open'],
    ['Discovery', '=COUNTIF(F12:F,"Discovery")', '9', '4.5', 'Lead', '2'],
    ['Proposal', '=COUNTIF(F12:F,"Proposal")', '9', '2.7', '', ''],
    ['Organization', 'Stage', 'Value', 'Notes'],
    ['Org Z (top)', 'Proposal', '9', 'A summary line, not a deal'],
    [],
    ['Total', '2', '18', '7.2'],
    ['Flag', 'Hot', '1'],
    []
  ];
  const pipeline = [...summary, head,
    ['Org P film', 'Org P', 'Contact P', 'Brand', 'Foundation', 'Discovery', 'Lead', '9', '50%', '12/15/2026', 'Scope call', '11/20/2026', 'His own note', ''],
    ['Org Q summit', 'Org Q', 'Contact Q', 'Events', 'Brand', 'Proposal', 'Lead', '9', '30%', '1/10/2027', '', '', '', 'Hot']];
  check('his tracker fixture: header on row 11, A to N, data from row 12', pipeline[10] === head && head.length === 14 && pipeline[11][1] === 'Org P');
  const { parseGrid } = await import('../functions/_lib/pd/data.mjs');
  const parsed = parseGrid('deals', pipeline);
  check('his tracker: the header is row 11, never a summary line that reuses his column words', parsed.headerRow === 10 && parsed.recognised && parsed.idx.org === 1 && parsed.idx.stage === 5 && parsed.idx.notes === 12 && parsed.idx.flag === 13, `headerRow=${parsed.headerRow + 1}`);
  check('his tracker: exactly his two deals, from rows 12 and 13; nothing from the summary', parsed.rows.length === 2 && parsed.rows[0]._row === 12 && parsed.rows[1]._row === 13 && !parsed.rows.some((r) => /Org Z|Discovery|Total/.test(r.org)));
  g.sheets[PIPE] = { title: 'Pipeline test 2', tabs: { Pipeline: pipeline } };
  globalThis.fetch = g.fetch;
  try {
    const env = ENV({ google: true });
    await seedOwner(env);
    const s = await signIn(env, OWNER, PW);
    const start = await call(env, '/dashboard/connect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
    await call(env, `/dashboard/oauth/callback?state=${new URL(start.location).searchParams.get('state')}&code=good`, { cookie: s.cookie });
    await call(env, '/dashboard/source', { method: 'POST', cookie: s.cookie, form: { group: 'tracker', link: `https://docs.google.com/spreadsheets/d/${PIPE}/edit` } });
    const deals = await call(env, '/dashboard/deals', { cookie: s.cookie });
    check('his tracker on Deals: two deals, read from row 11, the summary line never shown as a deal', /Deals · 2/.test(deals.text) && /Org P/.test(deals.text) && /Org Q/.test(deals.text) && !/Org Z/.test(deals.text) && /Pipeline, column names on row 11/.test((await call(env, '/dashboard/connections', { cookie: s.cookie })).text));
    const before = JSON.parse(JSON.stringify(pipeline));
    await call(env, '/dashboard/note', { method: 'POST', cookie: s.cookie, form: { key: 'org-p', text: 'Edited on the dashboard', back: '/dashboard/flow/org-p' } });
    await call(env, '/dashboard/deal', { method: 'POST', cookie: s.cookie, form: { row: 'k:org-p', stage: 'Proposal', back: '/dashboard/flow/org-p' } });
    const changed = [];
    pipeline.forEach((row, r) => (row || []).forEach((v, c) => { if (v !== (before[r] || [])[c]) changed.push(`${String.fromCharCode(65 + c)}${r + 1}`); }));
    check('his tracker: a note and a stage change through the dashboard write M12 and F12 only, in place', changed.sort().join() === 'F12,M12' && pipeline[11][12] === 'Edited on the dashboard' && pipeline[11][5] === 'Proposal', changed.join());
    check('his tracker: no row or column added, and the summary block is untouched', pipeline.length === before.length && pipeline.every((row, r) => (row || []).length === (before[r] || []).length) && JSON.stringify(pipeline.slice(0, 11)) === JSON.stringify(before.slice(0, 11)));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Where each deal sits (review, 15 Nov 2026): a stage typed with stray spaces is that stage, and a stage
// his tracker carries outside the list keeps its own labelled list; only a blank Stage cell is "No stage set".
{
  const { groupByStage, actionChanges, stageOptions } = await import('../functions/_lib/pd/data.mjs');
  const deals = [{ org: 'A', stage: 'Proposal ' }, { org: 'B', stage: '  discovery' }, { org: 'C', stage: 'On  hold' }, { org: 'D', stage: 'on hold' }, { org: 'E', stage: '' }, { org: 'F', stage: 'Proposal' }];
  const g = groupByStage(deals, ['Discovery', 'Proposal', 'Won']);
  const names = (x) => x.deals.map((d) => d.org).join('');
  check('stages: trailing or doubled spaces still place the deal under its stage', names(g.listed[0]) === 'B' && names(g.listed[1]) === 'AF' && names(g.listed[2]) === '', JSON.stringify(g.listed.map(names)));
  check('stages: an off-list stage gets its own list under its own name, never "No stage set"', g.extra.length === 1 && g.extra[0].label === 'On hold' && names(g.extra[0]) === 'CD' && g.blank.map((d) => d.org).join('') === 'E', JSON.stringify(g.extra));
  check('stages: every deal lands in exactly one list', g.listed.concat(g.extra).reduce((n, x) => n + x.deals.length, 0) + g.blank.length === deals.length);
  check('stages: Next stage moves "Proposal " on to the next stage', actionChanges('stage', { stage: 'Proposal ' }, Date.now(), { stages: ['Discovery', 'Proposal', 'Won'], ordered: true })?.stage === 'Won');
  check('stages: "Proposal " and "proposal" are one stage when no list is set', stageOptions([{ stage: 'Proposal ' }, { stage: 'proposal' }, { stage: 'Pitch' }]).stages.length === 2);
}

// The Start a project form's multiple choice reaches the dashboard as what they need (Scooter, 14 Nov 2026).
{
  const { needFrom } = await import('../functions/_lib/pd/deal.mjs');
  check('intake: the chosen need is carried, with any extra note', needFrom({ need_type: 'Build community', initiative: 'Alumni network' }) === 'Build community. Alumni network');
  check('intake: "something else" carries his visitor\'s own words', needFrom({ need_type: 'Other', need_other: 'A podcast for donors' }) === 'Other: A podcast for donors');
  check('intake: an older submission with only a message still reads', needFrom({ message: 'A summit' }) === 'A summit' && needFrom({}) === '');
}

if (failures.length) {
  console.error(`test:dashboard FAILED ${failures.length}/${cases}:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`test:dashboard OK ${cases} cases`);
