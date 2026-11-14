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
 * Preview and production never share a database, a bucket or a Worker, so approving the preview
 * cannot break the live page. Bindings and the token key take effect on that environment's next
 * deployment. Prints names and counts only. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 * (the firm's, injected by the runner); without them it is a NAMED STOP, exit 2.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { MIGRATIONS } from '../functions/_lib/pd/schema.mjs';

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
const WAITS = [2000, 5000, 10000, 20000, 40000];
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
      await new Promise((r) => setTimeout(r, WAITS[attempt]));
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
const query = (sql, params = []) => cf(`/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) });

// 2. migrations
let have = 0;
try { have = Number((await query('SELECT MAX(version) AS v FROM schema_version'))?.[0]?.results?.[0]?.v) || 0; } catch { have = 0; }
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

const line = `OUTPUT dashboard:setup env=${env} d1=${dbName} migrations_applied=${applied} binding=${bindingState} token_key=${keyState} bucket=${bucketState} lifecycle=${lifecycle} worker=${worker} site_url=${siteUrl || 'none'} restore=${proof}${bindingState === 'bound' || keyState === 'added' ? ' (binding/key take effect on the next deployment)' : ''}`;
console.log(line);
console.error(line);
if (proof.startsWith('FAILED')) process.exit(1);
