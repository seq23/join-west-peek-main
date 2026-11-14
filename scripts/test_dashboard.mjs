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
import { ensureSchema, resetSchemaMemo, BACKUP_TABLES } from '../functions/_lib/pd/schema.mjs';
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
          'Waiting on client': [['ID', 'Project ID', 'Waiting for', 'Since', 'Status', 'Contact email'], ['W1', 'P1', 'Logo files', '2026-10-28', 'Waiting', 'client-a@example.test'], ['W2', 'P1', 'Speaker list', '2026-11-10', 'Waiting', '']],
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
            tab[Number(m[3]) - 1][col] = d.values[0][0];
          }
        }
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
  check('a client item 17 days old is red on Today, with Mark received', /d-dot red/.test(today.text) && /Logo files/.test(today.text) && /value="received"/.test(today.text));
  const stale = await call(env, '/dashboard/work', { cookie: s.cookie, now: NOW + 3 * 3600000 });
  check('older than 2 hours: "may be out of date"', /may be out of date/.test(stale.text));

  // move a row: the action must still find W1 by ID
  const tab = g.sheets.WORKSHEETID00000000000000001.tabs['Waiting on client'];
  tab.splice(1, 0, ['W0', 'P1', 'Inserted row', '2026-11-12', 'Waiting', '']);
  const r1 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'received', row: 'W1', back: '/dashboard' } });
  const shown = await call(env, r1.location, { cookie: s.cookie });
  check('Mark received writes the source row found by ID and is confirmed', tab[2][4] === 'Received' && /Saved and checked/.test(shown.text));
  check('…the row above it is untouched', tab[1][4] === 'Waiting');
  check('…and it survives a reload', !(await call(env, '/dashboard', { cookie: s.cookie })).text.includes('Logo files'));

  g.dropWrites = true;
  const r2 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'stage', row: 'D1', back: '/dashboard/deals' } });
  const failed = await call(env, r2.location, { cookie: s.cookie });
  check('a write the sheet does not show is reported failed, never assumed', /d-flash--bad/.test(failed.text) && /Discovery/.test(failed.text) && !/Saved and checked/.test(failed.text));
  g.dropWrites = false;
  const r3 = await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'stage', row: 'D1', back: '/dashboard/deals' } });
  check('Move to next stage writes the CRM row', g.sheets.WORKSHEETID00000000000000001.tabs.Deals[1][2] === 'Solution and budget' && /Saved and checked/.test((await call(env, r3.location, { cookie: s.cookie })).text));
  const second = await signIn(env, OWNER, PW);
  check('…and shows on a second device', /Solution and budget/.test((await call(env, '/dashboard/deals', { cookie: second.cookie })).text));

  const before = g.calls.length;
  await call(env, '/dashboard/act', { method: 'POST', cookie: s.cookie, form: { action: 'remind', kind: 'waiting', row: 'W2', back: '/dashboard' } });
  check('a reminder is a Gmail draft, never a send', g.drafts.length === 1 && g.calls.slice(before).every((c) => !/send/.test(c)));

  await call(env, '/dashboard/tick', { method: 'POST', cookie: s.cookie, form: { item: 'draft:A1' } });
  check('a ticked Today item stays hidden after a reload', !(await call(env, '/dashboard', { cookie: s.cookie })).text.includes('Update draft'));

  // a failed sync and a broken connection show on Today
  delete g.sheets.WORKSHEETID00000000000000001;
  await call(env, '/dashboard/refresh', { method: 'POST', cookie: s.cookie, form: { back: '/dashboard' } });
  const red = await call(env, '/dashboard', { cookie: s.cookie });
  check('a failed sync is a red row on Today with Reconnect', /Could not read your work sheet/.test(red.text) && /href="\/dashboard\/connections">Reconnect/.test(red.text));
  await env.PRODUCTIONS_DB.prepare("UPDATE connection SET status = 'broken' WHERE provider = 'google'").run();
  check('a broken connection shows on Today', /Google stopped syncing/.test((await call(env, '/dashboard', { cookie: s.cookie })).text));

  const dis = await call(env, '/dashboard/disconnect', { method: 'POST', cookie: s.cookie, form: { provider: 'google' } });
  check('Disconnect revokes at Google and deletes the token', g.revoked.includes('REFRESH-TOKEN-PLAIN') && dis.location === '/dashboard/connections?m=disconnected' && !(await env.PRODUCTIONS_DB.prepare("SELECT * FROM connection WHERE provider = 'google'").first()));
  const off = (await call(env, '/dashboard', { cookie: s.cookie })).text;
  check('a disconnected account shows on Today with Connect', /Google is disconnected/.test(off) && /href="\/dashboard\/connections">Connect</.test(off));
  check('…and Today\'s folds say "not connected yet", never a zero count', /Money · not connected yet/.test(off) && !/· 0 (milestones|invoices|drafts)/.test(off));

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

// Money: incomplete costs show no margin.
{
  const env = ENV();
  await seedOwner(env);
  const s = await signIn(env, OWNER, PW);
  const db = env.PRODUCTIONS_DB;
  await db.prepare("INSERT INTO connection (provider, status, token_enc) VALUES ('google','ok', ?)").bind(await encryptJson(env, { access_token: 'x', expires_at: NOW + 3600000 })).run();
  await db.prepare("INSERT INTO source (kind, spreadsheet_id, title) VALUES ('money','MONEYSHEETID00000000000000001','Money test')").run();
  await db.prepare("INSERT INTO row_cache (kind,row_id,origin,data,synced_at) VALUES ('margin','M1','{}',?,?)").bind(JSON.stringify({ id: 'M1', project: 'P9', contract: '1000', costs: '400', complete: 'No' }), NOW).run();
  const m = await call(env, '/dashboard/money', { cookie: s.cookie });
  check('a margin with costs not all entered shows no percentage', m.status === 200 && !/60%/.test(m.text));
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
  check('dashboard:setup applies migrations on a brand-new database', /migrations applied=1/.test(first.out) && !/\/query/.test(first.out), first.out.trim());
  check('…and the tables exist after it', Number((await sqlite.prepare('SELECT MAX(version) AS v FROM schema_version').first().catch(() => null))?.v) === 1);
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

    for (const provider of ['dropbox', 'quickbooks', 'xero']) await call(env, '/dashboard/disconnect', { method: 'POST', cookie: s.cookie, form: { provider } });
    check('Disconnect revokes at Dropbox, QuickBooks and Xero', ['api.dropboxapi.com', 'developer.api.intuit.com', 'identity.xero.com'].every((h) => seen.revoked.includes(h)), seen.revoked.join(','));
    check('…and deletes each token', !(await env.PRODUCTIONS_DB.prepare("SELECT provider FROM connection WHERE provider IN ('dropbox','quickbooks','xero')").first()));
  } finally {
    globalThis.fetch = realFetch;
  }
}

if (failures.length) {
  console.error(`test:dashboard FAILED ${failures.length}/${cases}:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`test:dashboard OK ${cases} cases`);
