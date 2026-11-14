#!/usr/bin/env node
/**
 * dashboard:setup — give one environment of the Productions dashboard its own storage and clock.
 *
 *   npm run dashboard:setup -- --env preview|production [--site-url https://…] [--prove-restore]
 *
 * Every step is safe to repeat:
 *   1. finds or creates the D1 database  west-peek-productions-dashboard-<env>;
 *   2. applies the dashboard's migrations (functions/_lib/pd/schema.mjs; additive, idempotent);
 *   3. binds it to the west-peek-productions Pages project as PRODUCTIONS_DB for that environment;
 *   4. makes sure that environment has PRODUCTIONS_TOKEN_KEY (32 random bytes, a Pages secret that
 *      encrypts OAuth refresh tokens) — generated here only when absent, never printed;
 *   5. finds or creates the private R2 bucket west-peek-productions-dashboard-backups-<env>, with a
 *      30-day expiry on backups/;
 *   6. deploys the Worker west-peek-productions-dashboard-<env> (workers/productions-dashboard)
 *      bound to that D1 and R2, with a fresh CRON_SECRET; the dashboard keeps only its hash;
 *   7. with --prove-restore: writes a marker row, backs up, deletes the marker, restores the
 *      backup, and checks the marker and the row count came back.
 * Two steps make the environment work the moment setup ends (review, 14 Nov 2026: production would
 * otherwise answer "not set up" until some unrelated push, with nobody able to sign in):
 *   3b. production with no owner row: copies Scooter's owner record (address, name, password hash;
 *       never sessions or codes) from the preview database, or, before his first preview sign-in,
 *       from the pre-v1.0 KV `owners` record bound to preview. None in either →
 *       NAMED STOP owner_missing, exit 2: run dashboard:owners --env production --file <owners JSON>.
 *   3c. when a binding or the key changed (or with --redeploy): waits for that environment's newest
 *       deployment to finish, then redeploys that same commit so it carries them, and waits for it.
 *       The same commit, never an older one, so a merge that is still building is never undone.
 * Preview and production never share a database, a bucket or a Worker, so approving the preview
 * cannot break the live page. Prints names and counts only. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 * (the firm's, injected by the runner); without them it is a NAMED STOP, exit 2.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { MIGRATIONS } from '../functions/_lib/pd/schema.mjs';
import { OWNER_IDS } from '../functions/_lib/pd/auth.mjs';

const PROJECT = 'west-peek-productions';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (n) => process.argv.includes(`--${n}`);
function stop(code, line) { console.log(line); console.error(line); process.exit(code); }
const env = arg('env');
if (!['preview', 'production'].includes(env)) stop(2, 'NAMED STOP dashboard:setup: --env must be preview or production');
const siteUrl = (arg('site-url') || (env === 'production' ? 'https://westpeekproductions.com' : '')).replace(/\/+$/, '');
if (siteUrl && !/^https:\/\//.test(siteUrl)) stop(2, 'NAMED STOP dashboard:setup: --site-url must be https');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop(2, 'NAMED STOP dashboard:setup: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');

const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
const WAITS = (process.env.DASHBOARD_SETUP_FAST ? [10, 10, 10, 10, 10] : [2000, 5000, 10000, 20000, 40000]);
const POLL_MS = process.env.DASHBOARD_SETUP_FAST ? 10 : 10000;
const DEPLOY_WAIT_MS = 12 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = [];
async function cf(path, init = {}, { allow404 = false, soft = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res; let body;
    try {
      res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } });
      body = await res.json().catch(() => ({}));
    } catch (e) { res = { ok: false, status: 0 }; body = { errors: [{ code: e.code || 'network' }] }; }
    if (allow404 && res.status === 404) return null;
    if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < WAITS.length) {
      console.error(`dashboard:setup: ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}; retry ${attempt + 1}/${WAITS.length}`);
      await sleep(WAITS[attempt]);
      continue;
    }
    if ((!res.ok || body.success === false) && soft) return false;
    if (!res.ok || body.success === false) stop(1, `dashboard:setup env=${env} stopped at ${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${(body.errors || []).map((e) => e.code).join(',')}; done so far: ${done.join(', ') || 'nothing'}. Every step is safe to re-run.`);
    return body.result;
  }
}
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256b64 = async (t) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))));

// 1. D1
const dbName = `${PROJECT}-dashboard-${env}`;
let db = (await cf(`/d1/database?name=${encodeURIComponent(dbName)}`) || []).find((d) => d.name === dbName);
if (!db) { db = await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name: dbName }) }); done.push('d1 created'); } else done.push('d1 found');
const dbId = db.uuid;
const query = (sql, params = [], opts = {}) => cf(`/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }, opts);

// 2. migrations. A brand-new database has no schema_version table yet: D1 answers that probe with
// 400 7500 ("no such table"), which means version 0, not a stop (13 Nov 2026 preview run).
const probe = await query('SELECT MAX(version) AS v FROM schema_version', [], { soft: true });
const have = probe === false ? 0 : Number(probe?.[0]?.results?.[0]?.v) || 0;
let applied = 0;
for (const m of MIGRATIONS) {
  if (m.version <= have) continue;
  for (const s of m.sql) await query(s);
  await query('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)', [m.version, Date.now()]);
  applied += 1;
}
done.push(`migrations applied=${applied}`);

// 3 + 4. Pages binding and the token key
const project = await cf(`/pages/projects/${PROJECT}`);
const cfg = project?.deployment_configs?.[env] || {};
const patch = {};
if (cfg.d1_databases?.PRODUCTIONS_DB?.id !== dbId) patch.d1_databases = { PRODUCTIONS_DB: { id: dbId } };
const keyState = cfg.env_vars?.PRODUCTIONS_TOKEN_KEY ? 'present' : 'added';
if (keyState === 'added') patch.env_vars = { PRODUCTIONS_TOKEN_KEY: { type: 'secret_text', value: b64url(crypto.getRandomValues(new Uint8Array(32))) } };
if (Object.keys(patch).length) await cf(`/pages/projects/${PROJECT}`, { method: 'PATCH', body: JSON.stringify({ deployment_configs: { [env]: patch } }) });
const bindingState = patch.d1_databases ? 'bound' : 'present';
done.push(`binding ${bindingState}`, `token key ${keyState}`);

// 3b. the owner row on production (the pre-v1.0 KV record exists on preview only)
let ownerState = 'kept';
if (env === 'production') {
  const have = Number((await query('SELECT COUNT(*) AS n FROM owner'))?.[0]?.results?.[0]?.n) || 0;
  if (!have) {
    const pvName = `${PROJECT}-dashboard-preview`;
    const pv = (await cf(`/d1/database?name=${encodeURIComponent(pvName)}`) || []).find((d) => d.name === pvName);
    let rows = pv ? ((await cf(`/d1/database/${pv.uuid}/query`, { method: 'POST', body: JSON.stringify({ sql: 'SELECT id, name, email, pw FROM owner', params: [] }) }, { soft: true })) || [])?.[0]?.results || [] : [];
    let from = 'preview';
    // The preview database copies his pre-v1.0 KV record only on its first sign-in; until then the
    // KV `owners` record bound to preview (the same source the site imports from) is read instead.
    const ns = project?.deployment_configs?.preview?.kv_namespaces?.PRODUCTIONS_DASHBOARD?.namespace_id;
    if (!rows.some((x) => OWNER_IDS.includes(x.id)) && ns) {
      let kv = null;
      try {
        const r = await fetch(`${API}/storage/kv/namespaces/${ns}/values/owners`, { headers: { authorization: `Bearer ${token}` } });
        kv = r.ok ? JSON.parse(await r.text()) : null;
      } catch { kv = null; }
      rows = Object.entries(kv || {}).map(([id, o]) => ({ id, name: o?.name, email: o?.email, pw: o?.pw ? JSON.stringify(o.pw) : null }));
      from = 'preview_kv';
    }
    let copied = 0;
    for (const r of rows.filter((x) => OWNER_IDS.includes(x.id) && /@/.test(String(x.email || '')))) {
      await query('INSERT OR IGNORE INTO owner (id, name, email, pw, gen, updated_at) VALUES (?,?,?,?,0,?)', [r.id, r.name || null, r.email, r.pw || null, Date.now()]);
      copied += 1;
    }
    ownerState = copied ? `copied_from_${from}(${copied})` : 'missing';
  }
  done.push(`owner ${ownerState}`);
}

// 3c. a fresh deployment of the same commit, so the binding and key are live when setup ends
let redeployState = 'not_needed';
if (patch.d1_databases || patch.env_vars || flag('redeploy')) {
  const newest = async () => (await cf(`/pages/projects/${PROJECT}/deployments?env=${env}&per_page=1`))?.[0];
  const settled = async (pick) => {
    const until = Date.now() + DEPLOY_WAIT_MS;
    for (;;) {
      const d = await pick();
      const st = d?.latest_stage;
      if (!d || (st?.name === 'deploy' && ['success', 'failure', 'canceled'].includes(st.status)) || ['failure', 'canceled'].includes(st?.status)) return d;
      if (Date.now() > until) return { ...d, timedOut: true };
      await sleep(POLL_MS);
    }
  };
  const last = await settled(newest);
  if (!last) redeployState = 'none_yet(the first deployment carries them)';
  else if (last.timedOut) redeployState = `FAILED(deployment ${String(last.id).slice(0, 8)} still building after 12 min)`;
  else {
    const again = await cf(`/pages/projects/${PROJECT}/deployments/${last.id}/retry`, { method: 'POST' });
    const fin = await settled(async () => (await cf(`/pages/projects/${PROJECT}/deployments/${again.id}`)));
    redeployState = fin?.latest_stage?.name === 'deploy' && fin.latest_stage.status === 'success' ? `done(${String(again.id).slice(0, 8)})` : `FAILED(${String(again.id).slice(0, 8)} ${fin?.timedOut ? 'still building after 12 min' : fin?.latest_stage?.status || 'unknown'})`;
  }
  done.push(`redeploy ${redeployState}`);
}

// 5. R2
const bucket = `${PROJECT}-dashboard-backups-${env}`;
let bucketState = 'found';
if (!(await cf(`/r2/buckets/${bucket}`, {}, { allow404: true }))) { await cf('/r2/buckets', { method: 'POST', body: JSON.stringify({ name: bucket }) }); bucketState = 'created'; }
// The Worker also deletes backups older than 30 days, so a refused lifecycle rule is a note, not a stop.
const lifecycle = (await cf(`/r2/buckets/${bucket}/lifecycle`, { method: 'PUT', body: JSON.stringify({ rules: [{ id: 'keep-30-days', enabled: true, conditions: { prefix: 'backups/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86400 } } }] }) }, { soft: true })) === false ? 'worker-only' : 'set';
done.push(`bucket ${bucketState}`);

// 6. the Worker
const worker = `${PROJECT}-dashboard-${env}`;
const cronSecret = b64url(crypto.getRandomValues(new Uint8Array(32)));
const dir = mkdtempSync(join(tmpdir(), 'wpp-dash-'));
const config = join(dir, 'wrangler.toml');
writeFileSync(config, [
  `name = "${worker}"`, `main = "${resolve('workers/productions-dashboard/src/index.js')}"`, 'compatibility_date = "2026-10-01"', 'workers_dev = true', 'preview_urls = false',
  '[vars]', `SITE_URL = "${siteUrl}"`, `DASHBOARD_ENV = "${env}"`,
  '[[d1_databases]]', 'binding = "DB"', `database_name = "${dbName}"`, `database_id = "${dbId}"`,
  '[[r2_buckets]]', 'binding = "BACKUPS"', `bucket_name = "${bucket}"`,
  '[triggers]', 'crons = ["*/15 * * * *", "30 8 * * *"]', '[observability]', 'enabled = true', ''
].join('\n'));
const wenv = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account };
try {
  execFileSync('npx', ['--yes', 'wrangler@4.151.0', 'deploy', '--config', config], { env: wenv, stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('npx', ['--yes', 'wrangler@4.151.0', 'secret', 'put', 'CRON_SECRET', '--config', config], { env: wenv, input: cronSecret, stdio: ['pipe', 'ignore', 'pipe'] });
} catch (e) {
  rmSync(dir, { recursive: true, force: true });
  stop(1, `dashboard:setup env=${env} stopped deploying ${worker}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300)}; done so far: ${done.join(', ')}`);
}
rmSync(dir, { recursive: true, force: true });
await query("INSERT INTO setting (key, value) VALUES ('cron_secret_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(await sha256b64(cronSecret))]);
done.push('worker deployed');

// 7. one restore, proven
let proof = 'not_asked';
if (flag('prove-restore')) {
  const sub = (await cf('/workers/subdomain'))?.subdomain;
  const base = `https://${worker}.${sub}.workers.dev`;
  const call = async (path, body) => {
    for (let i = 0; i < 8; i++) {
      try {
        const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-dashboard-cron': cronSecret, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
        if (r.ok) return r.json();
      } catch { /* not live yet */ }
      await new Promise((r) => setTimeout(r, 4000 + i * 3000));
    }
    return null;
  };
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const count = async () => Number((await query('SELECT (SELECT COUNT(*) FROM setting) + (SELECT COUNT(*) FROM owner) + (SELECT COUNT(*) FROM session) + (SELECT COUNT(*) FROM action_log) AS n'))?.[0]?.results?.[0]?.n) || 0;
  await query("INSERT OR REPLACE INTO setting (key, value) VALUES ('restore_proof', ?)", [JSON.stringify(nonce)]);
  const before = await count();
  const b = await call('/backup');
  await query("DELETE FROM setting WHERE key = 'restore_proof'");
  const r = b?.key ? await call('/restore', { key: b.key }) : null;
  const back = (await query("SELECT value FROM setting WHERE key = 'restore_proof'"))?.[0]?.results?.[0]?.value;
  const after = await count();
  proof = b && r?.ok && back === JSON.stringify(nonce) && after === before ? `proven(${b.key} rows=${r.rows})` : `FAILED(backup=${b ? 'ok' : 'no'} restore=${r?.ok ? 'ok' : 'no'} marker=${back ? 'back' : 'missing'} rows ${before}->${after})`;
  await query("DELETE FROM setting WHERE key = 'restore_proof'");
}

const line = `OUTPUT dashboard:setup env=${env} d1=${dbName} migrations_applied=${applied} binding=${bindingState} token_key=${keyState} owner=${ownerState} redeploy=${redeployState} bucket=${bucketState} lifecycle=${lifecycle} worker=${worker} site_url=${siteUrl || 'none'} restore=${proof}`;
console.log(line);
console.error(line);
if (proof.startsWith('FAILED') || redeployState.startsWith('FAILED')) process.exit(1);
if (ownerState === 'missing') stop(2, `NAMED STOP dashboard:setup owner_missing: ${dbName} has no owner row and the preview store has none to copy; run npm run dashboard:owners -- --env ${env} --file <owners JSON outside the repo>`);
