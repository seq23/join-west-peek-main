#!/usr/bin/env node
/**
 * npm run dashboard:status -- --env preview|production
 *
 * Read-only: what the Productions dashboard in that environment reads and writes, and what is still
 * disconnected (Scooter, 19 Nov 2026: "Please confirm whether the live dashboard reads and writes my
 * real tracker, and what's still disconnected"). It runs SELECTs only against that environment's own
 * D1 (`west-peek-productions-dashboard-<env>`) and prints states, counts and times; never a row, a
 * name, a sheet title, an address or a figure. Changes nothing.
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (injected by the runner). Missing either, an
 * unknown --env, or no database is a NAMED STOP, exit 2. Ends with one `OUTPUT dashboard:status …` line.
 */
import { statusReport, addressReadable, nextSteps } from './lib/dashboard_status.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
function stop(line) { console.log(line); console.error(line); process.exit(2); }
const env = arg('env');
if (!['preview', 'production'].includes(env)) stop('NAMED STOP dashboard:status: --env must be preview or production');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop('NAMED STOP dashboard:status: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');

const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status} ${(body.errors || []).map((e) => e.code).join(',')}`);
  return body.result;
}
async function emailObfuscation() {
  try {
    const base = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
    const get = async (path) => { const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } }); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(`${r.status}`); return j.result; };
    const zone = (await get('/zones?name=westpeekproductions.com'))?.[0];
    if (!zone) return 'unknown (the token cannot see the zone)';
    return String((await get(`/zones/${zone.id}/settings/email_obfuscation`))?.value || 'unknown');
  } catch (err) { return `unknown (zone settings answered ${err.message})`; }
}
// The live dashboard's own answer: does production already serve the no-transform opt-out? GET with no
// cookie (the sign-in screen carries the same headers); reads one header, sends nothing else.
async function liveCacheControl() {
  const site = process.env.DASHBOARD_STATUS_SITE || 'https://westpeekproductions.com';
  try { const r = await fetch(`${site}/dashboard`, { redirect: 'manual' }); return r.headers.get('cache-control') || ''; }
  catch { return null; }
}
// Are the Google sign-in app's keys on this environment? Names only, from the Pages project's own config
// (a Pages secret wins) or a pair Scooter pasted on Connections (the app_key row). Never a value.
async function googleApp(query) {
  const NAMES = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'];
  let pasted = false;
  try { pasted = (await query("SELECT COUNT(*) AS n FROM app_key WHERE provider = 'google'"))[0]?.n > 0; } catch { /* older schema: no app_key table */ }
  if (pasted) return 'set';
  try {
    const proj = await cf('/pages/projects/west-peek-productions');
    const vars = proj?.deployment_configs?.[env]?.env_vars || {};
    return NAMES.every((n) => n in vars) ? 'set' : 'not_set';
  } catch (err) { return 'unknown'; }
}
const dbName = `west-peek-productions-dashboard-${env}`;
let db;
try { db = (await cf(`/d1/database?name=${encodeURIComponent(dbName)}`) || []).find((d) => d.name === dbName); } catch (err) { console.error(`dashboard:status env=${env}: ${err.message}`); process.exit(1); }
if (!db) stop(`NAMED STOP dashboard:status no_database: ${dbName} does not exist; run npm run dashboard:setup -- --env ${env}`);
// SELECT only: refuse anything else before it leaves this machine.
const query = async (sql) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('dashboard:status runs SELECT only');
  const r = await cf(`/d1/database/${db.uuid}/query`, { method: 'POST', body: JSON.stringify({ sql, params: [] }) });
  return r?.[0]?.results || [];
};
try {
  const rep = await statusReport(query);
  console.log(`dashboard:status env=${env} d1=${dbName}`);
  for (const l of rep.lines) console.log(`  ${l}`);
  // Why "[email protected]" shows on the live Inquiries page: the production zone's Email Address
  // Obfuscation. Read only; the dashboard opts out of it (Cache-Control no-transform + email_off markers).
  const obf = env === 'production' ? await emailObfuscation() : 'n/a (pages.dev is not proxied)';
  console.log(`  email obfuscation on westpeekproductions.com: ${obf}; dashboard pages opt out with no-transform and email_off markers`);
  let readable = 'n/a';
  if (env === 'production') {
    const cc = await liveCacheControl();
    readable = addressReadable({ obfuscation: obf, cacheControl: cc });
    console.log(`  live /dashboard cache-control: ${cc == null ? 'unreachable' : (cc || 'none')}; addresses readable on the live Inquiries page: ${readable}${readable === 'after_land' ? ' (the fix is on the preview; production still serves the code before it)' : ''}`);
  }
  const app = await googleApp(query);
  const next = nextSteps({ readable, googleApp: app, disconnected: rep.disconnected, named: rep.named, reads: rep.reads, writes: rep.writes });
  console.log(`  Google sign-in app keys on this environment: ${app}`);
  console.log(`  still to do, in order: ${next.join(', ')}`);
  console.log(`OUTPUT dashboard:status env=${env} ${rep.output} email_obfuscation=${obf.split(' ')[0]} address_readable=${readable} google_app=${app} next=${next.join(',')}`);
  if (!rep.ownerPresent) stop(`NAMED STOP dashboard:status owner_missing: ${dbName} has no owner row; run npm run dashboard:setup -- --env ${env}`);
} catch (err) {
  console.error(`dashboard:status env=${env}: ${err.message}`);
  process.exit(1);
}
