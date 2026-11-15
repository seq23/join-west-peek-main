#!/usr/bin/env node
/**
 * first-run — plays Scooter's first session on a deployed preview (or production) URL.
 *
 *   npm run first-run -- --url https://<preview>.west-peek-productions.pages.dev   (or FIRST_RUN_URL)
 *
 * Public pages: each changed Productions page loads (200) with no placeholder text or error.
 * Dashboard, signed out: no data, the sign-in screen, Help reachable (and asking for no key by email).
 * App keys: in sample mode the Paste your app keys section shows no box and a save is refused.
 * Preview only (the test identity does not exist on production): signs in with the sample
 * identity, sees real-looking (synthetic, non-empty) rows on Pipeline (each deal under its stage),
 * Clients, Inquiries, Money and Agents, moves one deal to its next stage (written to the sample sheet and read back), reloads and sees it, signs in
 * as a second device and sees it there too, signs the first device out and proves that session is
 * dead while the second still opens. A deal record: one screen with the tracker form, notes and the
 * discovery-to-delivery steps; a note saved on it persists after a reload and on the second device, and Who can see what opens. One deal all the way through:
 * discovery, a priced quote, a proposal, accepted, delivery, and a client portal with no money.
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
for (const p of ['/', '/work', '/what-we-do', '/about', '/get-in-touch', '/event-production-cost']) {
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
// App keys are pasted on Connections, never emailed (14 Nov 2026): Help points at the boxes and asks for no key by email.
if (/SECRET [A-Z_]+=|two lines, exactly/.test(help.text) || !/Paste each key into its box on the Connections page/.test(help.text)) fail('help', 'Help still asks for an app key by email, or does not point at the boxes on Connections');
ok('Help sends every app key to its box on Connections, none by email');

// 2a. A wrong sign-in redirects back with its message, so a reload never asks to resubmit.
const wrong = await post('/dashboard/login', { email: 'nobody@example.invalid', password: 'not-a-real-password' });
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
for (const [p, want] of [['/dashboard', /<h2 id="stage-\d+-h">[^<]+ · [1-9]/], ['/dashboard/inquiries', /Sample/], ['/dashboard/work', /Sample Org/], ['/dashboard/money', /Invoices due/], ['/dashboard/agents', /Drafts waiting/], ['/dashboard/connections', /Your choices/]]) {
  const r = await get(p, A);
  if (r.status !== 200) fail(`open ${p}`, `answered ${r.status}`);
  if (!want.test(r.text) || !/class="d-row__title|class="d-conn"/.test(r.text)) fail(`open ${p}`, 'no rows shown');
  if (PLACEHOLDER.test(r.text)) fail(`open ${p}`, 'placeholder text');
}
ok('Pipeline (deals listed under their stages), Inquiries, Clients, Money, Agents and Connections show rows');
{
  const p = (await get('/dashboard', A)).text;
  if (/Sample Top Barz show/.test(p) || !/Top Barz row(s are| is) not shown here/.test(p) || !/Form requests ·/.test(p) || /New inquiries/.test(p)) fail('pipeline', 'Top Barz work shows, or Form requests is not named');
  ok('Pipeline is Productions only (the Top Barz sample row is left out and said so) and names Form requests');
}
{
  const m = await get('/dashboard/money', A);
  if (!/The cash rules, walked first/.test(m.text) || (m.text.match(/id="rule-[a-z]+"/g) || []).length < 5) fail('cash rules', 'Money does not show the five cash rules to walk');
  ok('Money shows the cash rules to walk');
}

// 4b. App keys: sample mode shows the section but no box, and a save is refused with nothing stored.
const conn = await get('/dashboard/connections', A);
if (!/Paste your app keys/.test(conn.text) || /action="\/dashboard\/keys"/.test(conn.text)) fail('app keys', 'sample mode should show the app keys section without a form');
const keyTry = await post('/dashboard/keys', { provider: 'dropbox', id: 'first-run-test-key', secret: 'first-run-test-secret' }, A);
if (keyTry.status !== 303 || !/m=keys_sample/.test(keyTry.location || '')) fail('app keys', `sample mode did not refuse the save (${keyTry.status} ${keyTry.location || ''})`);
const keyBack = await get(keyTry.location, A);
if (!/cannot be saved in sample mode/.test(keyBack.text) || /first-run-test-(key|secret)/.test(keyBack.text)) fail('app keys', 'the refusal is not said, or a value came back');
ok('sample mode refuses to save app keys and says so');

// 5. One quick action, written and read back.
function dealRows(text) {
  return text.split('<li class="d-row" data-stage="').slice(1).map((li) => ({
    row: (li.match(/name="action" value="stage"><input type="hidden" name="row" value="([^"]+)"/) || [])[1],
    stage: (li.match(/^([^"]*)"/) || [])[1].replace(/&amp;/g, '&').trim()
  })).filter((d) => d.row);
}
let deals = dealRows((await get('/dashboard', A)).text);
if (!deals.length) {
  await post('/dashboard/sample/reset', {}, A);
  deals = dealRows((await get('/dashboard', A)).text);
}
if (!deals.length) fail('quick action', 'no deal can move to a next stage');
const pick = deals[0];
const act = await post('/dashboard/act', { action: 'stage', row: pick.row, back: '/dashboard' }, A);
if (act.status !== 303 || !/a=\d+/.test(act.location || '')) fail('quick action', `expected a 303 to the outcome, got ${act.status}`);
const shown = await get(act.location, A);
if (!/Saved and checked/.test(shown.text)) fail('quick action', 'the dashboard did not confirm the write');
const STAGES = ['Relationship identified', 'Introductory conversation', 'Qualified opportunity', 'Discovery', 'Solution and budget', 'Proposal', 'Negotiation', 'Signed agreement', 'Deposit received', 'Delivery handoff'];
const after = STAGES[STAGES.findIndex((x) => x.toLowerCase() === pick.stage.toLowerCase()) + 1];
const moved = dealRows(shown.text).find((d) => d.row === pick.row);
if (!after || (moved ? moved.stage !== after : !shown.text.includes(after))) fail('quick action', `deal ${pick.row} does not show "${after}" after the write`);
ok(`moved deal ${pick.row}: ${pick.stage} → ${after}, confirmed`);

// 6. Reload, and a second device.
const reload = await get('/dashboard', A);
if (!reload.text.includes(after)) fail('reload', 'the change is gone after a reload');
const B = await signIn();
const second = await get('/dashboard', B);
if (!second.text.includes(after)) fail('second device', 'the change does not show on a second device');
ok('the change persists after a reload and on a second device');

// 6b. A deal record from the pipeline: one screen to act on (tracker form, notes, the steps) and a
// way back; a note saved on it persists across a reload and on the second device; Who can see what opens.
const flow = await get('/dashboard', A);
const recLink = (flow.text.match(/data-stage="[^"]*"><div class="d-row__main"><a class="d-row__title" href="(\/dashboard\/flow\/[a-z0-9~-]+)"/) || [])[1];
if (flow.status !== 200 || !/Sample Org/.test(flow.text) || !recLink) fail('pipeline', `no deal rows shown (${flow.status})`);
if (PLACEHOLDER.test(flow.text)) fail('pipeline', 'placeholder text');
const rec = await get(recLink, A);
if (rec.status !== 200 || !/action="\/dashboard\/note"/.test(rec.text) || !/action="\/dashboard\/deal"/.test(rec.text) || !/Discovery ›/.test(rec.text) || !/href="\/dashboard">← Pipeline/.test(rec.text)) fail('deal record', 'the record lacks the tracker form, the notes form, the steps or the way back');
if (PLACEHOLDER.test(rec.text)) fail('deal record', 'placeholder text');
const key = recLink.split('/').pop();
const noteText = `First-run note ${Date.now()}`;
const saved = await post('/dashboard/note', { key, text: noteText, back: recLink }, A);
if (saved.status !== 303 || !/Note saved|Saved and checked/.test((await get(saved.location, A)).text)) fail('notes', 'the note was not confirmed');
if (!(await get(recLink, A)).text.includes(noteText)) fail('notes', 'the note is gone after a reload');
if (!(await get(recLink, B)).text.includes(noteText)) fail('notes', 'the note does not show on a second device');
const access = await get('/dashboard/access', A);
if (access.status !== 200 || !/Who can open the dashboard/.test(access.text) || !/What the dashboard keeps/.test(access.text) || /gmail\.compose/.test(access.text)) fail('access', `Who can see what did not load as expected (${access.status})`);
ok('a deal opens on one screen to act on; a note persists after a reload and on a second device; Who can see what opens');

// 6c. One deal all the way through: discovery, a priced quote, a proposal, accepted, delivery and a
// client portal that shows the client's tasks and no money (Scooter, 14 Nov 2026: "First test: one
// real deal, all the way through"). On a preview this runs on the sample deal.
const dealKey = 'sample-org-d';
const deal = `/dashboard/flow/${dealKey}`;
const outcome = `First-run outcome ${Date.now()}`;
// A clean sample deal each run, so an earlier run's accepted deal never stands in for this one.
await post('/dashboard/sample/reset', {}, A);
const disc = await get(`${deal}/discovery`, A);
if (disc.status !== 200 || (disc.text.match(/name="p_services"/g) || []).length !== 6 || !/Organization type/.test(disc.text) || !/Which department are we working with/.test(disc.text)) fail('discovery', `no service picker, Organization type or sales-call notes (${disc.status})`);
await post('/dashboard/discovery', [['key', dealKey], ['p_services', 'brand-strategy'], ['p_services', 'virtual-hybrid-events'], ['p_buyer', 'foundation'], ['p_objective', 'funding'], ['p_budget', 'unknown'], ['event_start', '2027-03-04'], ['event_end', '2027-03-05'], ['a_outcome', outcome], ['a_call_department', 'First-run department'], ['back', `${deal}/discovery`]], A);
const discB = (await get(`${deal}/discovery`, B)).text;
if (!discB.includes(outcome) || !/First-run department/.test(discB) || !/board or trustees/.test(discB) || !/What should attendees do in the week after the event/.test(discB) || !/name="event_start" type="date" value="2027-03-04"/.test(discB)) fail('discovery', 'services, event dates, call notes or answers do not show on a second device');
ok('discovery: services first, questions shaped by them, event dates and call notes persist on a second device');
const q = await post('/dashboard/quote', [['key', dealKey], ['svc', 'brand-strategy'], ['svc', 'virtual-hybrid-events'], ['sp_brand-strategy', 'Sample Specialist'], ['cost_brand-strategy', '2000'], ['price_brand-strategy', '5000'], ['price_virtual-hybrid-events', '1000'], ['term', '3'], ['plan', 'monthly'], ['rationale', 'First-run rationale'], ['back', `${deal}/quote`]], A);
if (!/m=quote_saved/.test(q.location || '')) fail('quote', `not saved (${q.location || q.status})`);
const qv = await get(`${deal}/quote`, B);
if (!/value="Sample Specialist"/.test(qv.text) || !/[$]6,000/.test(qv.text) || !/[$]2,000 a month for 3 months/.test(qv.text) || !/Month 3/.test(qv.text) || /qty_|per day/.test(qv.text)) fail('quote', 'the specialist, his typed price, the 3-month bundle or the timing is missing');
ok('quote: each service with its specialist and cost, his own client price, the 3-month bundle and timing, on a second device');
let prop = await get(`${deal}/proposal`, A);
if (!/Accepted ·|>Accepted</.test(prop.text)) {
  await post('/dashboard/proposal', { key: dealKey, do: 'draft', back: `${deal}/proposal` }, A);
  prop = await get(`${deal}/proposal`, A);
  if (!/in total/.test(prop.text) || !/First-run rationale/.test(prop.text) || /Sample Specialist|2,000 |\b2000\b|margin|cost/i.test((prop.text.match(/<textarea id="pr-text"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '')) fail('proposal', 'the draft lacks the price or rationale, or shows a specialist or a cost');
  const accepted = await post('/dashboard/proposal', { key: dealKey, do: 'accept', team: 'Sample Lead: account lead', back: `${deal}/proposal` }, A);
  if (!/delivery\?m=accepted/.test(accepted.location || '')) fail('accepted', `delivery did not start (${accepted.location || accepted.status})`);
}
ok('proposal: drafted from the quote, accepted, deal moved');
const fresh = await post('/dashboard/delivery/portal', { key: dealKey, do: 'new', back: `${deal}/delivery` }, A);
const token = new URL(`${base}${fresh.location || '/'}`).searchParams.get('portal');
if (!token) fail('portal', 'no portal link was made');
const dv = await get(`${deal}/delivery`, B);
if (!/Account team/.test(dv.text) || !/>Brand strategy</.test(dv.text)) fail('delivery', 'no team or a task per service on the work side');
const portal = await get(`/portal/${token}`);
const portalText = portal.text.replace(/<style>[\s\S]*?<\/style>/, '');
if (portal.status !== 200 || !/Brand strategy/.test(portalText) || /[$]|Sample Specialist|2000|2,000|First-run rationale|First-run note|Sample Org E|margin|floor|cost/i.test(portalText)) fail('portal', `the client page is missing its tasks or shows money or another client (${portal.status})`);
await post('/dashboard/delivery/portal', { key: dealKey, do: 'off', back: `${deal}/delivery` }, A);
if ((await get(`/portal/${token}`)).status !== 404) fail('portal', 'a turned-off portal link still opens');
ok('delivery: team and tasks; the client portal shows their tasks, no money, and stops when turned off');

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
