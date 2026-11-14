#!/usr/bin/env node
/**
 * first-run — plays Scooter's first session on a deployed preview (or production) URL.
 *
 *   npm run first-run -- --url https://<preview>.west-peek-productions.pages.dev   (or FIRST_RUN_URL)
 *
 * Public pages: each changed Productions page loads (200) with no placeholder text or error.
 * Dashboard, signed out: no data, the sign-in screen, Help reachable.
 * Preview only (the test identity does not exist on production): signs in with the sample
 * identity, sees real-looking (synthetic, non-empty) rows on Today, Work, Money and Agents, moves one
 * deal to its next stage (written to the sample sheet and read back), reloads and sees it, signs in
 * as a second device and sees it there too, signs the first device out and proves that session is
 * dead while the second still opens.
 * Exits non-zero on any failure; prints one line starting "FIRST_RUN OK" when every step passed.
 */
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const base = String(arg('url') || process.env.FIRST_RUN_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('FIRST_RUN FAILED: --url <https://site> (or FIRST_RUN_URL) is required'); process.exit(2); }
const host = new URL(base).hostname;
const production = ['westpeekproductions.com', 'www.westpeekproductions.com', 'west-peek-productions.pages.dev'].includes(host);
const steps = [];
function fail(step, why) { console.error(`FIRST_RUN FAILED at "${step}": ${why}`); process.exit(1); }
function ok(step) { steps.push(step); console.log(`  ✓ ${step}`); }

async function get(path, cookie = '') {
  const r = await fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { status: r.status, text: await r.text(), location: r.headers.get('location'), cookies: r.headers.getSetCookie?.() || [] };
}
async function post(path, body, cookie = '') {
  const r = await fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(body), headers: { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) } });
  return { status: r.status, text: await r.text(), location: r.headers.get('location'), cookies: r.headers.getSetCookie?.() || [] };
}
const sessionOf = (res) => (res.cookies.find((c) => /^wpp_s=[^;]+/.test(c) && !/^wpp_s=;/.test(c)) || '').split(';')[0];

// 1. Public pages.
const PLACEHOLDER = /lorem ipsum|\bTODO\b|coming soon|undefined<|\[object Object\]/i;
for (const p of ['/', '/work', '/what-we-do', '/about', '/start', '/event-production-cost']) {
  const r = await get(p);
  if (r.status !== 200) fail(`page ${p}`, `answered ${r.status}`);
  if (PLACEHOLDER.test(r.text)) fail(`page ${p}`, `carries placeholder text (${r.text.match(PLACEHOLDER)[0]})`);
}
ok('public pages load with no placeholder text');

// 2. Signed out.
const out = await get('/dashboard');
if (out.status !== 401 || !/name="email"/.test(out.text)) fail('signed out', `expected the sign-in screen with 401, got ${out.status}`);
if (/Sample Org|class="d-row__title/.test(out.text)) fail('signed out', 'rows shown without a sign-in');
if (!/Sign in with Google|Google sign-in is not set up yet/.test(out.text)) fail('signed out', 'neither Google sign-in nor its not-set-up state is shown');
const help = await get('/dashboard/help');
if (help.status !== 200 || !/id="google-app"/.test(help.text)) fail('help', `Help did not load with the Google sign-in steps (${help.status})`);
ok('signed out shows no data, the sign-in screen and Help');

// 2a. A wrong sign-in redirects back with its message, so a reload never asks to resubmit.
const wrong = await post('/dashboard/login', { email: 'nobody@first-run.invalid', password: 'not-a-real-password' });
if (wrong.status !== 303 || wrong.location !== '/dashboard?signin=wrong' || sessionOf(wrong)) fail('wrong sign-in', `expected a 303 to /dashboard?signin=wrong with no session, got ${wrong.status} ${wrong.location || ''}`);
const told = await get(wrong.location);
if (told.status !== 401 || !/did not open the dashboard/.test(told.text) || /class="d-row__title/.test(told.text)) fail('wrong sign-in', 'the redirected screen does not say why, or shows rows');
ok('a wrong sign-in redirects back with its message and opens nothing');

// 2b. Sign in with Google, once its app keys are set on this site: the button must reach Google's
// own account screen for THIS site's callback. A key Google does not know (invalid_client) fails the
// run; a callback the Google app has not listed yet is named (the emailed code still opens it).
if (/Sign in with Google/.test(out.text) && !/Google sign-in is not set up yet/.test(out.text)) {
  const g = await post('/dashboard/google', { remember: '1' });
  if (g.status !== 303 || !/^https:\/\/accounts\.google\.com\//.test(g.location || '')) fail('google sign-in', `the button did not lead to Google (${g.status} ${String(g.location || '').slice(0, 40)})`);
  const want = `${base}/dashboard/oauth/callback`;
  if (new URL(g.location).searchParams.get('redirect_uri') !== want) fail('google sign-in', 'the callback sent to Google is not this site');
  // Google answers a refused app with a redirect to /signin/oauth/error whose authError parameter
  // (base64url) names the reason, e.g. invalid_client or redirect_uri_mismatch.
  const screen = await fetch(g.location, { redirect: 'manual', headers: { 'accept-language': 'en' } });
  const next = screen.headers.get('location') || '';
  const why = /\/signin\/oauth\/error/.test(next)
    ? Buffer.from(String(new URL(next, 'https://accounts.google.com').searchParams.get('authError') || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')
    : '';
  if (screen.status >= 400) fail('google sign-in', `Google answered ${screen.status}`);
  if (/invalid_client|deleted_client|disabled_client|unauthorized_client/.test(why)) fail('google sign-in', `Google does not accept the sign-in app keys set on this site (${why.match(/[a-z_]+_client/)[0]})`);
  if (/redirect_uri_mismatch/.test(why)) console.log(`  ! NAMED google_redirect_not_listed: add ${want} to the Google app's redirect URIs; the emailed code signs in meanwhile`);
  else if (why) fail('google sign-in', `Google refused the sign-in request (${why.replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, 80)})`);
  else ok('Sign in with Google reaches Google\'s own account screen');
}

if (production) {
  const s = await post('/dashboard/login', { email: 'sample@preview.invalid', password: 'preview-sample-only' });
  if (s.status === 303 || sessionOf(s)) fail('production', 'the preview test identity opened something on production');
  console.log(`FIRST_RUN OK production ${steps.length} steps (the sample identity is refused here; the real-data check runs nightly and on Connections → Check my numbers)`);
  process.exit(0);
}

// 3. Sign in (phone A, remember 30 days).
const signIn = async () => {
  const r = await post('/dashboard/login', { email: 'sample@preview.invalid', password: 'preview-sample-only', remember: '1' });
  const c = sessionOf(r);
  if (r.status !== 303 || !c) fail('sign in', `expected 303 and a session, got ${r.status}${/did not open/.test(r.text) ? ' (refused)' : ''}`);
  const raw = r.cookies.find((x) => x.startsWith('wpp_s=')) || '';
  if (!/Max-Age=2592000/.test(raw)) fail('sign in', '"remember this phone" did not give a 30-day session');
  return c;
};
const A = await signIn();
ok('signed in with the preview test identity, remembered for 30 days');

// 4. Real (synthetic, non-empty) rows on every tab.
for (const [p, want] of [['/dashboard', /need/], ['/dashboard/work', /Sample Org/], ['/dashboard/money', /Invoices due/], ['/dashboard/agents', /Drafts waiting/], ['/dashboard/connections', /Your choices/]]) {
  const r = await get(p, A);
  if (r.status !== 200) fail(`open ${p}`, `answered ${r.status}`);
  if (!want.test(r.text) || !/class="d-row__title|class="d-conn"/.test(r.text)) fail(`open ${p}`, 'no rows shown');
  if (PLACEHOLDER.test(r.text)) fail(`open ${p}`, 'placeholder text');
}
ok('Today, Work, Money, Agents and Connections show rows');

// 5. One quick action, written and read back.
function dealRows(text) {
  return text.split('<li class="d-row">').slice(1).map((li) => ({
    row: (li.match(/name="action" value="stage"><input type="hidden" name="row" value="([^"]+)"/) || [])[1],
    stage: ((li.match(/<span class="d-row__sub">([^<·]+)·/) || [])[1] || '').trim()
  })).filter((d) => d.row);
}
let deals = dealRows((await get('/dashboard/deals', A)).text);
if (!deals.length) {
  await post('/dashboard/sample/reset', {}, A);
  deals = dealRows((await get('/dashboard/deals', A)).text);
}
if (!deals.length) fail('quick action', 'no deal can move to a next stage');
const pick = deals[0];
const act = await post('/dashboard/act', { action: 'stage', row: pick.row, back: '/dashboard/deals' }, A);
if (act.status !== 303 || !/a=\d+/.test(act.location || '')) fail('quick action', `expected a 303 to the outcome, got ${act.status}`);
const shown = await get(act.location, A);
if (!/Saved and checked/.test(shown.text)) fail('quick action', 'the dashboard did not confirm the write');
const STAGES = ['Relationship identified', 'Introductory conversation', 'Qualified opportunity', 'Discovery', 'Solution and budget', 'Proposal', 'Negotiation', 'Signed agreement', 'Deposit received', 'Delivery handoff'];
const after = STAGES[STAGES.findIndex((x) => x.toLowerCase() === pick.stage.toLowerCase()) + 1];
const moved = dealRows(shown.text).find((d) => d.row === pick.row);
if (!after || (moved ? moved.stage !== after : !shown.text.includes(after))) fail('quick action', `deal ${pick.row} does not show "${after}" after the write`);
ok(`moved deal ${pick.row}: ${pick.stage} → ${after}, confirmed`);

// 6. Reload, and a second device.
const reload = await get('/dashboard/deals', A);
if (!reload.text.includes(after)) fail('reload', 'the change is gone after a reload');
const B = await signIn();
const second = await get('/dashboard/deals', B);
if (!second.text.includes(after)) fail('second device', 'the change does not show on a second device');
ok('the change persists after a reload and on a second device');

// 7. Sign-out revokes the session.
const so = await post('/dashboard/logout', {}, A);
if (so.status !== 303) fail('sign out', `expected 303, got ${so.status}`);
const dead = await get('/dashboard', A);
if (dead.status !== 401) fail('sign out', `the signed-out session still opens (${dead.status})`);
const alive = await get('/dashboard', B);
if (alive.status !== 200) fail('sign out', 'signing out one device signed the other out');
await post('/dashboard/logout', {}, B);
ok('sign-out revokes that session only');

console.log(`FIRST_RUN OK ${steps.length} steps on ${host}`);
