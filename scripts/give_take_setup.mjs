#!/usr/bin/env node
/**
 * give-take:setup — give one environment of Give and Take (joinwestpeek.com) its own store.
 *
 *   npm run give-take:setup -- --env preview|production [--branch <git branch>] [--redeploy]
 *
 * Every step is safe to repeat:
 *   1. finds the community Pages project (the one serving joinwestpeek.com; --project overrides);
 *   2. finds or creates the D1 database  west-peek-community-give-take-<env>;
 *   3. applies the migrations in functions/_lib/give-take.mjs (MIGRATIONS; additive; each version
 *      recorded in gt_schema_version, so a re-run applies nothing twice);
 *   4. binds it to that project as GIVE_TAKE_DB for that environment;
 *   5. makes sure that environment has GIVE_TAKE_SIGNING_KEY (32 random bytes, the Pages secret that
 *      signs the review links in Scooter's email) — generated here only when absent, never printed;
 *   6. when the binding or the key changed (or with --redeploy): waits for that environment's newest
 *      deployment to finish and redeploys that same commit, so the binding is live when setup exits.
 * Preview and production never share a database or a key: approving the preview cannot touch live
 * asks. Prints names and counts only. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the
 * firm's, injected by the runner); without them it is a NAMED STOP, exit 2.
 * Prints one line `GIVE_TAKE_SETUP OK env=<env> …` on success.
 */
import { webcrypto as crypto } from 'node:crypto';
import { MIGRATIONS } from '../functions/_lib/give-take.mjs';

const HOST = 'joinwestpeek.com';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (n) => process.argv.includes(`--${n}`);
function stop(code, line) { console.log(line); console.error(line); process.exit(code); }
const env = arg('env');
if (!['preview', 'production'].includes(env)) stop(2, 'NAMED STOP give-take:setup: --env must be preview or production');
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop(2, 'NAMED STOP give-take:setup: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');

const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
const FAST = Boolean(process.env.GIVE_TAKE_SETUP_FAST);
const WAITS = FAST ? [10, 10, 10] : [2000, 5000, 10000, 20000, 40000];
const POLL_MS = FAST ? 10 : 10000;
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
      console.error(`give-take:setup: ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}; retry ${attempt + 1}/${WAITS.length}`);
      await sleep(WAITS[attempt]);
      continue;
    }
    if ((!res.ok || body.success === false) && soft) return false;
    if (!res.ok || body.success === false) stop(1, `give-take:setup env=${env} stopped at ${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${(body.errors || []).map((e) => e.code).join(',')}; done so far: ${done.join(', ') || 'nothing'}. Every step is safe to re-run.`);
    return body.result;
  }
}
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// 1. The project that serves joinwestpeek.com. Found by its domain, so a renamed project is still found.
let PROJECT = arg('project');
if (!PROJECT) {
  // The Pages list API pages at 10 and refuses a bigger per_page with 400 8000024 (seen 27 Nov 2026),
  // so walk the pages until one comes back short.
  let hit = null;
  for (let page = 1; page <= 20 && !hit; page++) {
    const projects = (await cf(`/pages/projects?per_page=10&page=${page}`)) || [];
    hit = projects.find((p) => (p.domains || []).some((d) => d === HOST || d === `www.${HOST}`)) || null;
    if (projects.length < 10) break;
  }
  if (!hit) stop(2, `NAMED STOP give-take:setup: no Pages project serves ${HOST}; pass --project <name>`);
  PROJECT = hit.name;
}
done.push(`project ${PROJECT}`);

// 2. D1
const dbName = `west-peek-community-give-take-${env}`;
let db = (await cf(`/d1/database?name=${encodeURIComponent(dbName)}`) || []).find((d) => d.name === dbName);
if (!db) { db = await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name: dbName }) }); done.push('d1 created'); } else done.push('d1 found');
const dbId = db.uuid;
const query = (sql, params = [], opts = {}) => cf(`/d1/database/${dbId}/query`, { method: 'POST', body: JSON.stringify({ sql, params }) }, opts);

// 3. Migrations. Version 1 is all CREATE … IF NOT EXISTS (always safe); later versions run once each.
for (const s of MIGRATIONS[0].sql) await query(s);
const have = new Set((((await query('SELECT version FROM gt_schema_version'))?.[0]?.results) || []).map((r) => Number(r.version)));
let applied = 0;
for (const m of MIGRATIONS) {
  if (have.has(m.version)) continue;
  if (m.version > 1) {
    for (const s of m.sql) {
      const r = await query(s, [], { soft: true });
      if (r === false && !/^ALTER TABLE/i.test(s)) stop(1, `give-take:setup env=${env}: migration ${m.version} failed at "${s.slice(0, 60)}"; done so far: ${done.join(', ')}`);
    }
  }
  await query('INSERT OR IGNORE INTO gt_schema_version (version, applied_at) VALUES (?, ?)', [m.version, Date.now()]);
  applied += 1;
}
// Prove the schema is really there (an ALTER that failed for a reason other than "already there"
// would otherwise hide behind the soft call above).
const cols = ((await query("SELECT name FROM pragma_table_info('gt_offer')"))?.[0]?.results || []).map((r) => r.name);
if (!cols.includes('consent_at')) stop(1, `give-take:setup env=${env}: gt_offer has no consent_at column after migrating; done so far: ${done.join(', ')}`);
done.push(`migrations applied=${applied}`);

// 4 + 5. Pages binding and the link-signing key
const project = await cf(`/pages/projects/${PROJECT}`);
const cfg = project?.deployment_configs?.[env] || {};
const patch = {};
if (cfg.d1_databases?.GIVE_TAKE_DB?.id !== dbId) patch.d1_databases = { GIVE_TAKE_DB: { id: dbId } };
const keyState = cfg.env_vars?.GIVE_TAKE_SIGNING_KEY ? 'present' : 'added';
if (keyState === 'added') patch.env_vars = { GIVE_TAKE_SIGNING_KEY: { type: 'secret_text', value: b64url(crypto.getRandomValues(new Uint8Array(32))) } };
if (Object.keys(patch).length) await cf(`/pages/projects/${PROJECT}`, { method: 'PATCH', body: JSON.stringify({ deployment_configs: { [env]: patch } }) });
done.push(`binding ${patch.d1_databases ? 'bound' : 'present'}`, `signing key ${keyState}`);

// 6. A fresh deployment of the same commit, so the binding and key are live when setup ends.
let redeployState = 'not_needed';
if (patch.d1_databases || patch.env_vars || flag('redeploy')) {
  // On preview, several branches share the environment: --branch picks this PR's own newest build,
  // so the binding goes live on the preview the partner is sent, not on another branch's.
  const branch = arg('branch');
  const newest = async () => {
    const list = (await cf(`/pages/projects/${PROJECT}/deployments?env=${env}`)) || [];
    return branch ? list.find((d) => d.deployment_trigger?.metadata?.branch === branch) : list[0];
  };
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

const counts = (await query("SELECT (SELECT COUNT(*) FROM gt_ask) AS asks, (SELECT COUNT(*) FROM gt_ask WHERE status = 'approved') AS approved, (SELECT COUNT(*) FROM gt_offer) AS offers"))?.[0]?.results?.[0] || {};
if (redeployState.startsWith('FAILED')) stop(1, `give-take:setup env=${env} ${done.join(', ')}`);
console.log(`GIVE_TAKE_SETUP OK env=${env} db=${dbName} ${done.join(', ')} asks=${counts.asks ?? '?'} approved=${counts.approved ?? '?'} offers=${counts.offers ?? '?'}`);
