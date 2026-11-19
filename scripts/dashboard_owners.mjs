#!/usr/bin/env node
/**
 * dashboard:owners — put the dashboard's owner record in that environment's own database (D1).
 *
 *   npm run dashboard:owners -- --env preview|production --file <owners JSON outside the repo>
 *                               [--url https://<the dashboard's site>] [--send]
 *
 * The file (never committed; the owner's address never lives in this public repo):
 *   { "owners": [ { "id": "scooter", "name": "Scooter", "email": "<his work email>" } ] }
 * Every id must be on OWNER_IDS (functions/_lib/pd/auth.mjs), which is Scooter alone (Scooter,
 * 13 Nov 2026: "the owners list is Scooter alone, and nobody else can be added except by Scooter
 * asking"). The file is the whole list: any other row is removed. An owner whose email is unchanged
 * keeps his password, sessions and state. A record the dashboard copied across from the pre-v1.0
 * store is the same row, so running this is never needed just to keep him signed in.
 * With --url and --send: presses that site's own "Forgot it?" for an owner who has no password yet
 * and no unused one-time code, so the site emails the code to his own address. One email each.
 * Prints ids and counts only. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (NAMED STOP, exit 2).
 */
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { OWNER_IDS } from '../functions/_lib/pd/auth.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
function stop(code, line) { console.log(line); console.error(line); process.exit(code); }
const env = arg('env');
const file = arg('file');
const site = (arg('url') || '').replace(/\/+$/, '');
const send = process.argv.includes('--send');
if (!['preview', 'production'].includes(env)) stop(2, 'NAMED STOP dashboard:owners: --env must be preview or production');
if (!file) stop(2, 'NAMED STOP dashboard:owners: --file <owners JSON> is required');
if (send && !/^https:\/\//.test(site)) stop(2, 'NAMED STOP dashboard:owners: --send needs --url https://<site>');
const abs = resolve(file);
if (!relative(process.cwd(), abs).startsWith('..')) stop(2, 'NAMED STOP dashboard:owners: the owners file must live outside this public repo');
let doc;
try { doc = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { stop(2, `NAMED STOP dashboard:owners: cannot read the owners file (${e.code || 'not JSON'})`); }
const list = Array.isArray(doc?.owners) ? doc.owners : [];
const bad = list.filter((o) => !OWNER_IDS.includes(o.id) || !/@/.test(String(o.email || '')));
if (!list.length || bad.length) stop(1, `dashboard:owners refused the file: ${list.length ? `${bad.length} owner(s) not on the owners list or without an email` : 'no owners'}`);

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop(2, 'NAMED STOP dashboard:owners: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');
const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) stop(1, `dashboard:owners: ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}`);
  return body.result;
}
const dbName = `west-peek-productions-dashboard-${env}`;
const db = ((await cf(`/d1/database?name=${dbName}`)) || []).find((d) => d.name === dbName);
if (!db) stop(2, `NAMED STOP dashboard:owners: ${dbName} does not exist yet; run npm run dashboard:setup -- --env ${env} first`);
const q = async (sql, params = []) => (await cf(`/d1/database/${db.uuid}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }))?.[0]?.results || [];

const existing = Object.fromEntries((await q('SELECT id, email, pw, otp, last_issue FROM owner')).map((r) => [r.id, r]));
let kept = 0; let changed = 0;
for (const o of list) {
  const before = existing[o.id];
  if (before && before.email.trim().toLowerCase() === o.email.trim().toLowerCase()) {
    await q('UPDATE owner SET name = ? WHERE id = ?', [o.name || null, o.id]);
    kept += 1;
  } else {
    await q('INSERT INTO owner (id, name, email, gen, updated_at) VALUES (?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email, pw=NULL, otp=NULL, gen=owner.gen+1, fails=NULL, updated_at=excluded.updated_at', [o.id, o.name || null, o.email.trim(), Date.now()]);
    changed += 1;
  }
}
const ids = list.map((o) => o.id);
const removed = Object.keys(existing).filter((id) => !ids.includes(id));
for (const id of removed) await q('DELETE FROM owner WHERE id = ?', [id]);

let sent = 0; let skipped = 0;
if (send) {
  for (const r of await q('SELECT id, email, pw, otp, last_issue FROM owner')) {
    const otp = r.otp ? JSON.parse(r.otp) : null;
    const by = r.last_issue ? JSON.parse(r.last_issue).by : '';
    if (r.pw || (otp && otp.expires_at > Date.now() && ['cloudflare', 'resend'].includes(by))) { skipped += 1; continue; }
    const res = await fetch(`${site}/dashboard/forgot`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: r.email }), headers: { origin: site, 'content-type': 'application/x-www-form-urlencoded' } });
    const after = (await q('SELECT last_issue FROM owner WHERE id = ?', [r.id]))[0];
    const how = after?.last_issue ? JSON.parse(after.last_issue).by : 'none';
    console.log(`dashboard:owners: ${r.id} one-time code ${res.ok ? 'requested' : `refused ${res.status}`}, channel=${how}`);
    if (['cloudflare', 'resend'].includes(how)) sent += 1;
  }
}
const line = `OUTPUT dashboard:owners env=${env} owners=${ids.join(',')} kept=${kept} changed=${changed} removed=${removed.length}${send ? ` sent=${sent} skipped=${skipped}` : ''}`;
console.log(line);
console.error(line);
