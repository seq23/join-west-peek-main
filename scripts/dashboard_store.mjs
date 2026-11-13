#!/usr/bin/env node
/**
 * dashboard:store — load the Productions dashboard's private figures into its private store.
 *
 *   npm run dashboard:store -- --env preview|production --file <path to the store JSON>
 *
 * The file lives OUTSIDE this public repo (the job directory, or a private Drive export) and is
 * never committed. The script:
 *   1. checks the file's shape with storeProblems() (the same rules the dashboard reads by);
 *   2. finds or creates the KV namespace "west-peek-productions-dashboard-<env>";
 *   3. writes three keys: team, finance, meta. Finance is its own key so a team session never
 *      reads it;
 *   4. makes sure the west-peek-productions Pages project binds it as PRODUCTIONS_DASHBOARD for that
 *      environment (takes effect on the next deployment of that environment). Writing comes first so
 *      a Pages API outage cannot cost the load; a failure here says the figures are already in.
 * It prints counts only, never a value. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 * (the firm's, injected by the runner); without them it is a NAMED STOP, exit 2.
 */
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { storeProblems } from '../functions/_lib/productions-dashboard.mjs';

const PROJECT = 'west-peek-productions';
const BINDING = 'PRODUCTIONS_DASHBOARD';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function stop(code, line) { console.error(line); process.exit(code); }

const env = arg('env');
const file = arg('file');
if (!['preview', 'production'].includes(env)) stop(2, 'NAMED STOP dashboard:store: --env must be preview or production');
if (!file) stop(2, 'NAMED STOP dashboard:store: --file <store JSON> is required');
const abs = resolve(file);
if (!relative(process.cwd(), abs).startsWith('..')) stop(2, 'NAMED STOP dashboard:store: the store file must live outside this public repo');

let doc;
try { doc = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { stop(2, `NAMED STOP dashboard:store: cannot read the store file (${e.code || 'not JSON'})`); }
const problems = storeProblems(doc);
if (problems.length) stop(1, `dashboard:store refused the file: ${problems.join('; ')}`);

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop(2, 'NAMED STOP dashboard:store: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');

// CLOUDFLARE_API_BASE exists only so scripts/test_dashboard.mjs can point this at a local fake.
const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
// Cloudflare's API answers 429 and 5xx now and then (13 Nov 2026: one 503 on GET pages/projects
// failed the first preview load). Those are retried with backoff; every call here is idempotent
// (GETs, a PATCH to the same binding, a bulk PUT of the same three keys). The namespace POST is
// guarded by the lookup before it; KV titles are unique, so a retried create that already
// landed is refused, never duplicated, and the next run finds it.
const TRANSIENT = (s) => s === 429 || s >= 500;
// A second preview load (13 Nov 2026) met a Cloudflare "Workers API availability" incident: the
// Pages project endpoint answered 503 for the whole 37-second window, so the window is now ~4 minutes.
const WAITS_MS = (process.env.DASHBOARD_STORE_RETRY_MS || '2000,5000,10000,20000,40000,60000,90000').split(',').map(Number);
async function cf(path, init = {}, onFail) {
  let res;
  let body;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      res = { ok: false, status: 0 };
      body = { errors: [{ code: e.code || 'network' }] };
    }
    if (!(TRANSIENT(res.status) || res.status === 0) || attempt >= WAITS_MS.length) break;
    console.error(`dashboard:store: Cloudflare ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}; retry ${attempt + 1}/${WAITS_MS.length}`);
    await new Promise((r) => setTimeout(r, WAITS_MS[attempt]));
  }
  if (!res.ok || body.success === false) {
    if (onFail) onFail(res.status);
    stop(1, `dashboard:store: Cloudflare ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status} ${(body.errors || []).map((e) => e.code).join(',')}`);
  }
  return body.result;
}

const title = `${PROJECT}-dashboard-${env}`;
let nsState = 'existing';
const namespaces = await cf('/storage/kv/namespaces?per_page=100');
let ns = namespaces.find((n) => n.title === title);
if (!ns) { ns = await cf('/storage/kv/namespaces', { method: 'POST', body: JSON.stringify({ title }) }); nsState = 'created'; }

const meta = { updated_at: doc.updated_at || new Date().toISOString(), loaded_at: new Date().toISOString() };
await cf(`/storage/kv/namespaces/${ns.id}/bulk`, {
  method: 'PUT',
  body: JSON.stringify([
    { key: 'team', value: JSON.stringify(doc.team) },
    { key: 'finance', value: JSON.stringify(doc.finance) },
    { key: 'meta', value: JSON.stringify(meta) }
  ])
});

// The figures are in the store now. Binding it to the Pages project is the second step; when only
// that step fails, say exactly that, so a re-run is known to be safe and the data is not re-guessed.
const bindingFailed = (status) => console.error(`dashboard:store: the figures ARE loaded into ${title} (3 keys); binding it to ${PROJECT} as ${BINDING} did not finish (Cloudflare answered ${status}). Re-run the same command: every step is safe to repeat.`);
const project = await cf(`/pages/projects/${PROJECT}`, {}, bindingFailed);
const bound = project?.deployment_configs?.[env]?.kv_namespaces?.[BINDING]?.namespace_id;
let bindingState = 'present';
if (bound !== ns.id) {
  await cf(`/pages/projects/${PROJECT}`, {
    method: 'PATCH',
    body: JSON.stringify({ deployment_configs: { [env]: { kv_namespaces: { [BINDING]: { namespace_id: ns.id } } } } })
  }, bindingFailed);
  bindingState = bound ? 'replaced' : 'added';
}

const rows = (part) => Object.values(doc[part]).filter(Array.isArray).reduce((a, l) => a + l.length, 0);
const done = `OUTPUT dashboard:store env=${env} namespace=${nsState} binding=${bindingState} keys=3 team_rows=${rows('team')} finance_rows=${rows('finance')}${bindingState === 'present' ? '' : ' (binding takes effect on the next deployment)'}`;
// The success line ends BOTH streams. The job runner records one line per run; on 13 Nov 2026 a
// successful preview load (exit 0) was recorded as its last retry line ("answered 503; retry 5/7"),
// which read as a failure. Retry lines go to stderr, so the OUTPUT line must close stderr too.
console.log(done);
console.error(done);
