#!/usr/bin/env node
/**
 * The Productions dashboard gate (functions/_lib/productions-dashboard.mjs), executed.
 *
 * Scooter, 13 Nov 2026: "No dashboard page or data without the password ... finance view for
 * Scooter and Sequoia only ... Cold Email Log with sending off. Private figures never in the repo."
 * Each case below states the behaviour it pins. The figures used are invented test markers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { handleDashboard, storeProblems, COLD_EMAIL_SENDING } from '../functions/_lib/productions-dashboard.mjs';

const failures = [];
let cases = 0;
function check(name, cond, detail = '') {
  cases += 1;
  if (!cond) failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
}

const TEAM_MARK = 'TEAMROW-7731';
const FIN_MARK = 'FINROW-4412';
function kv(over = {}) {
  const m = new Map(Object.entries({
    meta: JSON.stringify({ updated_at: '2026-11-13T15:00:00Z' }),
    team: JSON.stringify({
      projects: [{ name: TEAM_MARK, client: 'Client A', status: 'In delivery', next_milestone: 'Sprint 2', due: '2026-12-01', lead: 'Lead A' }],
      waiting_on_client: [], proposals_out: [], agent_log: [],
      agent_drafts: [{ project: 'P', document: 'Draft A', agent: 'Notes agent', drafted: '2026-11-12T10:00:00Z', status: 'waiting' }],
      opportunities: [{ organization: 'Org A', stage: 'Discovery', next_action: 'Call', owner: 'Scooter', target_date: '2026-11-20' }],
      cold_email_log: []
    }),
    finance: JSON.stringify({
      tracker: { period: '2027', signed: 100, invoiced: 50, collected: 25 },
      targets: [{ label: 'Floor', amount: 1000 }], revenue_model: [], pipeline_values: [],
      invoices: [{ client: FIN_MARK, project: 'P', amount: 777, due: '2026-11-01', status: 'sent' }],
      expected_receipts: [], vendor_obligations: [], project_margin: [], cash_weeks: [], cash: {}
    }),
    ...over
  }));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), reads: [], map: m };
}
function trackedKv(over) {
  const store = kv(over);
  const get = store.get;
  store.get = async (k) => { store.reads.push(k); return get(k); };
  return store;
}
const ENV = () => ({ PRODUCTIONS_DASHBOARD_PASSWORD: 'team-pass', PRODUCTIONS_DASHBOARD_OWNER_PASSWORD: 'owner-pass', PRODUCTIONS_DASHBOARD: trackedKv() });
const HOST = 'https://westpeekproductions.com';
const NOW = Date.parse('2026-11-13T16:00:00Z');

async function call(path, { method = 'GET', env = ENV(), cookie, form, origin, host = HOST } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (origin) headers.set('origin', origin);
  let body;
  if (form) { body = new URLSearchParams(form); headers.set('content-type', 'application/x-www-form-urlencoded'); }
  const res = await handleDashboard({ request: new Request(`${host}${path}`, { method, headers, body }), env, now: NOW });
  return { res, text: await res.text(), env };
}
async function login(password, env = ENV()) {
  const { res } = await call('/dashboard/login', { method: 'POST', form: { password }, env, origin: HOST });
  const sc = res.headers.get('set-cookie') || '';
  return { res, cookie: sc.split(';')[0], env };
}

// 1. No password, no page and no data: the store is never read.
{
  const { res, text, env } = await call('/dashboard');
  check('anonymous GET is refused', res.status === 401, `status ${res.status}`);
  check('anonymous GET shows no data', !text.includes(TEAM_MARK) && !text.includes(FIN_MARK));
  check('anonymous GET never reads the store', env.PRODUCTIONS_DASHBOARD.reads.length === 0, env.PRODUCTIONS_DASHBOARD.reads.join(','));
  check('dashboard is never cached or indexed', res.headers.get('cache-control')?.includes('no-store') && res.headers.get('x-robots-tag')?.includes('noindex'));
}
// 2. Wrong password refused, no cookie.
{
  const { res, cookie } = await login('guess');
  check('wrong password is refused', res.status === 401 && !cookie.includes('.'));
}
// 3. Team password: team views, never finance, finance key never read.
{
  const { cookie, env } = await login('team-pass');
  check('team password sets a session', cookie.startsWith('wpp_dash=team.'));
  const { res, text } = await call('/dashboard', { cookie, env });
  check('team sees the dashboard', res.status === 200 && text.includes(TEAM_MARK), `status ${res.status}`);
  check('team never sees finance', !text.includes(FIN_MARK) && !text.includes('id="money"'));
  check('team session never reads the finance key', !env.PRODUCTIONS_DASHBOARD.reads.includes('finance'));
  for (const id of ['work', 'waiting', 'proposals', 'funnel', 'cold', 'drafts', 'activity']) check(`team view has section ${id}`, text.includes(`id="${id}"`));
}
// 4. Owner password: finance view included, overdue invoice raised.
{
  const { cookie, env } = await login('owner-pass');
  const { text } = await call('/dashboard', { cookie, env });
  check('owner sees finance', text.includes('id="money"') && text.includes(FIN_MARK));
  check('owner line 1 counts the draft and the overdue invoice', text.includes('2 need you'), text.match(/<h1>[^<]*/)?.[0]);
}
// 5. A forged or tampered cookie opens nothing.
{
  const { cookie } = await login('team-pass');
  const forged = cookie.replace('wpp_dash=team.', 'wpp_dash=owner.');
  const { res, text } = await call('/dashboard', { cookie: forged });
  check('a cookie edited from team to owner is refused', res.status === 401 && !text.includes(FIN_MARK));
  const { res: r2 } = await call('/dashboard', { cookie, env: { ...ENV(), PRODUCTIONS_DASHBOARD_PASSWORD: 'rotated' } });
  check('changing a password signs existing sessions out', r2.status === 401);
}
// 6. No password configured: shut, no store read, login refused.
{
  const env = { PRODUCTIONS_DASHBOARD: trackedKv() };
  const { res, text } = await call('/dashboard', { env });
  check('unconfigured dashboard is shut', res.status === 503 && text.includes('not switched on'));
  const { res: r2 } = await call('/dashboard/login', { method: 'POST', form: { password: '' }, env });
  check('unconfigured login refuses', r2.status === 503 && !r2.headers.get('set-cookie'));
  check('unconfigured dashboard never reads the store', env.PRODUCTIONS_DASHBOARD.reads.length === 0);
}
// 7. Only the Productions host serves it (Functions are shared with the other two sites).
for (const host of ['https://joinwestpeek.com', 'https://westpeek.ventures', 'https://x.west-peek-community.pages.dev']) {
  const { res } = await call('/dashboard', { host });
  check(`${host} has no dashboard`, res.status === 404, `status ${res.status}`);
}
{
  const { res } = await call('/dashboard', { host: 'https://work-x.west-peek-productions.pages.dev' });
  check('a productions preview serves the gate', res.status === 401);
}
// 8. A sign-in posted from another site is refused.
{
  const { res } = await call('/dashboard/login', { method: 'POST', form: { password: 'team-pass' }, origin: 'https://evil.example' });
  check('cross-site sign-in is refused', res.status === 403 && !res.headers.get('set-cookie'));
}
// 9. A store that is not connected is said, never shown as all clear.
{
  const env = { ...ENV(), PRODUCTIONS_DASHBOARD: undefined };
  const { cookie } = await login('team-pass', env);
  const { text } = await call('/dashboard', { cookie, env });
  check('missing store is named', text.includes('not connected') && !text.includes('Nothing needs you'));
}
// 10. Sending is off; the Cold Email Log says so.
{
  check('cold email sending is off in code', COLD_EMAIL_SENDING === false);
  const { cookie, env } = await login('team-pass');
  const { text } = await call('/dashboard', { cookie, env });
  check('Cold Email Log shows sending off and the cap', text.includes('Sending off') && text.includes('of 25 this week'));
}
// 11. Store text is escaped.
{
  const env = ENV();
  env.PRODUCTIONS_DASHBOARD = trackedKv({ team: JSON.stringify({ projects: [{ name: '<script>x</script>' }], waiting_on_client: [], proposals_out: [], agent_drafts: [], agent_log: [], opportunities: [], cold_email_log: [] }) });
  const { cookie } = await login('team-pass', env);
  const { text } = await call('/dashboard', { cookie, env });
  check('store text is escaped', !text.includes('<script>x') && text.includes('&lt;script&gt;'));
}
// 12. The store validator refuses a broken document (used by dashboard:store before any write).
check('storeProblems refuses a document with no finance part', storeProblems({ team: {} }).length > 0);
check('storeProblems refuses an unknown funnel stage', storeProblems({ team: { opportunities: [{ organization: 'A', stage: 'Maybe' }] }, finance: {} }).some((p) => p.includes('unknown stage')));

// 13. No private store document is committed: nothing in the repo carries the store's shape with data.
{
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.json$/i.test(name)) {
        const s = readFileSync(p, 'utf8');
        if (s.includes('"cold_email_log"') || s.includes('"vendor_obligations"')) hits.push(p);
      }
    }
  };
  walk('.');
  check('no dashboard store file is committed to this public repo', hits.length === 0, hits.join(', '));
}

if (cases === 0) { console.error('test_dashboard: NAMED STOP - zero cases ran'); process.exit(2); }
if (failures.length) {
  console.error(`test_dashboard: ${failures.length} of ${cases} failed\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`OUTPUT test_dashboard: ${cases} cases passed`);
