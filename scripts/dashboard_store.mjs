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
 *   3. makes sure the west-peek-productions Pages project binds it as PRODUCTIONS_DASHBOARD for that
 *      environment (takes effect on the next deployment of that environment);
 *   4. writes three keys: team, finance, meta. Finance is its own key so a team session never
 *      reads it.
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

const API = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    stop(1, `dashboard:store: Cloudflare ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status} ${(body.errors || []).map((e) => e.code).join(',')}`);
  }
  return body.result;
}

const title = `${PROJECT}-dashboard-${env}`;
let nsState = 'existing';
const namespaces = await cf('/storage/kv/namespaces?per_page=100');
let ns = namespaces.find((n) => n.title === title);
if (!ns) { ns = await cf('/storage/kv/namespaces', { method: 'POST', body: JSON.stringify({ title }) }); nsState = 'created'; }

const project = await cf(`/pages/projects/${PROJECT}`);
const bound = project?.deployment_configs?.[env]?.kv_namespaces?.[BINDING]?.namespace_id;
let bindingState = 'present';
if (bound !== ns.id) {
  await cf(`/pages/projects/${PROJECT}`, {
    method: 'PATCH',
    body: JSON.stringify({ deployment_configs: { [env]: { kv_namespaces: { [BINDING]: { namespace_id: ns.id } } } } })
  });
  bindingState = bound ? 'replaced' : 'added';
}

const meta = { updated_at: doc.updated_at || new Date().toISOString(), loaded_at: new Date().toISOString() };
await cf(`/storage/kv/namespaces/${ns.id}/bulk`, {
  method: 'PUT',
  body: JSON.stringify([
    { key: 'team', value: JSON.stringify(doc.team) },
    { key: 'finance', value: JSON.stringify(doc.finance) },
    { key: 'meta', value: JSON.stringify(meta) }
  ])
});

const rows = (part) => Object.values(doc[part]).filter(Array.isArray).reduce((a, l) => a + l.length, 0);
console.log(`OUTPUT dashboard:store env=${env} namespace=${nsState} binding=${bindingState} keys=3 team_rows=${rows('team')} finance_rows=${rows('finance')}${bindingState === 'present' ? '' : ' (binding takes effect on the next deployment)'}`);
