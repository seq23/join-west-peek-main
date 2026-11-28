#!/usr/bin/env node
/**
 * test:give-take-setup — runs scripts/give_take_setup.mjs against a fake Cloudflare API that behaves
 * like the real one where it has bitten us: the Pages project list refuses per_page > 10 with
 * 400 8000024 (the preview run of 27 Nov 2026 stopped there), and the project serving
 * joinwestpeek.com sits on the SECOND page. D1 queries run on a real SQLite (node:sqlite).
 * Proves: the project is found across pages, the DB is created, migrations apply, the binding and
 * signing key are patched, only --branch's own preview is redeployed, and a second run changes nothing. Prints `GIVE_TAKE_SETUP_TEST OK`.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const SETUP = fileURLToPath(new URL('./give_take_setup.mjs', import.meta.url));
const projects = Array.from({ length: 13 }, (_, i) => ({ name: `other-${i}`, domains: [`other-${i}.pages.dev`] }));
projects.splice(11, 0, { name: 'join-west-peek-main', domains: ['join-west-peek-main.pages.dev', 'joinwestpeek.com'], deployment_configs: { preview: {}, production: {} } });
const dbs = new Map();
const calls = [];
const retried = [];

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/accounts\/acct/, '');
  calls.push(`${req.method} ${p}`);
  const send = (status, result, errors = []) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status < 400, errors, result })); };
  if (req.method === 'GET' && p === '/pages/projects') {
    const per = Number(u.searchParams.get('per_page') || 10);
    const page = Number(u.searchParams.get('page') || 1);
    if (per > 10) return send(400, null, [{ code: 8000024, message: 'Invalid list options provided.' }]);
    return send(200, projects.slice((page - 1) * per, page * per).map(({ name, domains }) => ({ name, domains })));
  }
  if (req.method === 'GET' && p === '/d1/database') return send(200, [...dbs.values()].filter((d) => d.name === u.searchParams.get('name')).map(({ name, uuid }) => ({ name, uuid })));
  if (req.method === 'POST' && p === '/d1/database') { const d = { name: body.name, uuid: `uuid-${dbs.size + 1}`, sql: new DatabaseSync(':memory:') }; dbs.set(d.uuid, d); return send(200, { name: d.name, uuid: d.uuid }); }
  const q = p.match(/^\/d1\/database\/([^/]+)\/query$/);
  if (q && req.method === 'POST') {
    const d = dbs.get(q[1]);
    try {
      const st = d.sql.prepare(body.sql);
      const results = /^\s*(SELECT|PRAGMA)/i.test(body.sql) ? st.all(...(body.params || [])) : (st.run(...(body.params || [])), []);
      return send(200, [{ results, success: true }]);
    } catch (e) { return send(400, null, [{ code: 7500, message: String(e.message) }]); }
  }
  const pr = p.match(/^\/pages\/projects\/([^/]+)$/);
  if (pr) {
    const proj = projects.find((x) => x.name === pr[1]);
    if (!proj) return send(404, null, [{ code: 8000007 }]);
    if (req.method === 'PATCH') {
      for (const [env, patch] of Object.entries(body.deployment_configs || {})) {
        const cfg = proj.deployment_configs[env];
        if (patch.d1_databases) cfg.d1_databases = { ...cfg.d1_databases, ...patch.d1_databases };
        // Like the real API: a secret's value is never read back, a plain_text value is, and null deletes.
        if (patch.env_vars) {
          cfg.env_vars = { ...cfg.env_vars };
          for (const [k, v] of Object.entries(patch.env_vars)) {
            if (v === null) delete cfg.env_vars[k];
            else cfg.env_vars[k] = v.type === 'plain_text' ? { type: v.type, value: v.value } : { type: v.type };
          }
        }
      }
    }
    return send(200, proj);
  }
  if (/\/deployments\?/.test(req.url) && req.method === 'GET') return send(200, [
    { id: 'other-branch-dep', deployment_trigger: { metadata: { branch: 'work/other' } }, latest_stage: { name: 'deploy', status: 'success' } },
    { id: 'our-branch-dep', deployment_trigger: { metadata: { branch: 'work/ours' } }, latest_stage: { name: 'deploy', status: 'success' } }
  ]);
  const retry = p.match(/\/deployments\/([^/]+)\/retry$/);
  if (retry && req.method === 'POST') { retried.push(retry[1]); return send(200, { id: `re-${retry[1]}` }); }
  const one = p.match(/\/deployments\/(re-[^/]+)$/);
  if (one) return send(200, { id: one[1], latest_stage: { name: 'deploy', status: 'success' } });
  return send(404, null, [{ code: 404 }]);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const fails = [];
const run = (env = 'preview') => new Promise((resolve) => {
  const c = spawn(process.execPath, [SETUP, '--env', env, ...(env === 'preview' ? ['--branch', 'work/ours'] : [])], { env: { ...process.env, CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_BASE: base, GIVE_TAKE_SETUP_FAST: '1' } });
    let out = '';
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { out += b; });
    c.on('close', (code) => resolve({ code, out }));
});

const first = await run();
if (first.code !== 0 || !/GIVE_TAKE_SETUP OK env=preview/.test(first.out)) fails.push(`first run exit ${first.code}: ${first.out.trim().split('\n').pop()}`);
if (!/project join-west-peek-main/.test(first.out)) fails.push('first run did not find join-west-peek-main on page 2 of the project list');
if (!/d1 created/.test(first.out) || !/binding bound/.test(first.out) || !/signing key added/.test(first.out)) fails.push(`first run did not create/bind/key: ${first.out.trim().split('\n').pop()}`);
const proj = projects.find((x) => x.name === 'join-west-peek-main');
if (!proj.deployment_configs.preview.d1_databases?.GIVE_TAKE_DB?.id) fails.push('GIVE_TAKE_DB not bound on preview');
if (retried.join() !== 'our-branch-dep') fails.push(`redeployed ${retried.join() || 'nothing'}, not this branch's own preview`);
if (proj.deployment_configs.production.d1_databases) fails.push('production was touched by a preview run');
if (proj.deployment_configs.preview.env_vars?.GIVE_TAKE_PREVIEW_LINKS?.value !== 'on') fails.push('preview did not get GIVE_TAKE_PREVIEW_LINKS=on (first-run could not approve its own TEST ask)');
if (proj.deployment_configs.production.env_vars?.GIVE_TAKE_PREVIEW_LINKS) fails.push('a preview run put GIVE_TAKE_PREVIEW_LINKS on production');
const second = await run();
if (second.code !== 0 || !/d1 found/.test(second.out) || !/binding present/.test(second.out) || !/signing key present/.test(second.out) || !/migrations applied=0/.test(second.out)) fails.push(`second run was not a no-op: ${second.out.trim().split('\n').pop()}`);
// Production never keeps the preview-links flag: planted there, the production run removes it, and
// never adds it.
proj.deployment_configs.production.env_vars = { GIVE_TAKE_PREVIEW_LINKS: { type: 'plain_text', value: 'on' } };
const prod = await run('production');
if (prod.code !== 0 || !/preview links flag removed/.test(prod.out)) fails.push(`production run did not remove the planted flag: ${prod.out.trim().split('\n').pop()}`);
if (proj.deployment_configs.production.env_vars?.GIVE_TAKE_PREVIEW_LINKS) fails.push('GIVE_TAKE_PREVIEW_LINKS still on production after the production run');
if (!proj.deployment_configs.production.env_vars?.GIVE_TAKE_SIGNING_KEY) fails.push('production run did not add its own signing key');
const prod2 = await run('production');
if (prod2.code !== 0 || !/preview links flag absent/.test(prod2.out)) fails.push(`second production run added the flag: ${prod2.out.trim().split('\n').pop()}`);
server.close();

if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); process.exit(1); }
console.log(`GIVE_TAKE_SETUP_TEST OK project found on page 2, created, bound, keyed; redeployed this branch only; second run a no-op; preview-links flag on preview only, removed from production (${calls.length} API calls)`);
