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
  check('Help opens signed out and holds no rows', h.status === 200 && /id="google-app"/.test(h.text) && !h.text.includes(MARK));
  check('the test identity is not offered on production', !r.text.includes(SAMPLE_PASSWORD));
}

// Password sign-in, sessions, sign-out.
{
  const env = ENV();
  await seedOwner(env);
  check('a password without an email opens nothing', (await signIn(env, '', PW)).status === 401);
  check('a record off the owners list opens nothing', (await signIn(env, OTHER, 'owner-b-own-password')).status === 401);
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
  check('a cross-site sign-in is refused', (await call(env, '/dashboard/login', { method: 'POST', form: { email: OWNER, password: PW }, origin: false, cookie: '' }).then(() => handleDashboard({ request: new Request(`${PROD}/dashboard/login`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${OWNER}&password=${PW}` }), env, now: NOW }))).status === 403);
  for (let i = 0; i < OWNER_FAIL_LIMIT; i++) await signIn(env, OWNER, 'wrong-password-here');
  check('5 wrong tries lock the owner for 15 minutes', (await signIn(env, OWNER, PW)).status === 429);
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
  check('the code works once', (await signIn(env, OWNER, code)).status === 401);
  const chosen = await call(env, '/dashboard/password', { method: 'POST', cookie: used.cookie, form: { password: 'a-brand-new-pass', confirm: 'a-brand-new-pass' } });
  check('choosing a password opens the dashboard', chosen.status === 303 && (await call(env, '/dashboard', { cookie: chosen.cookie })).status === 200);
  const other = await signIn(env, OWNER, 'a-brand-new-pass');
  await call(env, '/dashboard/password', { method: 'POST', cookie: chosen.cookie, form: { current: 'a-brand-new-pass', password: 'another-new-pass', confirm: 'another-new-pass' } });
  check('changing the password signs other devices out', (await call(env, '/dashboard', { cookie: other.cookie })).status === 401);
  const env2 = ENV();
  await seedOwner(env2, { pw: null });
  await call(env2, '/dashboard/forgot', { method: 'POST', form: { email: OWNER } });
  const c2 = env2.sent[0].text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/)[0];
  check('an unused code stops working after 7 days', (await signIn(env2, OWNER, c2, { now: NOW + 8 * 86400000 })).status === 401);
}

// Sample mode: preview only, synthetic rows only.
{
  const env = ENV();
  await seedOwner(env);
  check('the test identity is refused on production', (await signIn(env, SAMPLE_EMAIL, SAMPLE_PASSWORD)).status === 401);
  check('…and on the production pages.dev host', (await signIn(env, SAMPLE_EMAIL, SAMPLE_PASSWORD, { host: 'https://west-peek-productions.pages.dev' })).status === 401);
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

  // Google sign-in: only the owner's account opens it
  const gs = await call(env, '/dashboard/google', { method: 'POST', form: { remember: '1' } });
  const st = new URL(gs.location).searchParams.get('state');
  const okIn = await call(env, `/dashboard/oauth/callback?state=${st}&code=good`);
  check('Sign in with Google opens it for the owner, remembered', okIn.status === 303 && /Max-Age=2592000/.test(okIn.rawCookie));
  const gs2 = await call(env, '/dashboard/google', { method: 'POST', form: {} });
  const st2 = new URL(gs2.location).searchParams.get('state');
  check('Sign in with Google refuses any other account', (await call(env, `/dashboard/oauth/callback?state=${st2}&code=other`)).status === 403);

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

if (failures.length) {
  console.error(`test:dashboard FAILED ${failures.length}/${cases}:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`test:dashboard OK ${cases} cases`);
