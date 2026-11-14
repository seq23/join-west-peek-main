/**
 * The West Peek Productions dashboard v1.0 (westpeekproductions.com/dashboard), Scooter only.
 *
 * v1.0 (Sequoia's go, 13 Nov 2026): "his working phone screen onto his own Google files". His
 * Google Sheets are the source of truth; the dashboard reads them, writes quick actions back to the
 * row by stable ID and re-reads to confirm. Sessions, the owner record, connection metadata, the
 * quick-action log and ticks live in D1 (PRODUCTIONS_DB: one preview database, one production
 * database). The pre-v1.0 KV snapshot is retired from every screen; KV is read only to carry
 * Scooter's existing sign-in across (auth.mjs).
 *
 * Routes (all under /dashboard; Productions hosts and their previews only, 404 elsewhere):
 *   GET  /                Today          GET /work, /work/<id>, /deals, /inquiries, /find
 *   GET  /money           (Scooter only)  GET /agents, /connections, /check, /help (public, no data)
 *   POST /login /forgot /password /logout /google /connect /disconnect /act /tick /choice
 *        /source /source/create /refresh
 *   GET  /oauth/callback  (Google sign-in and every connection)
 *   POST /cron/sync       (the cron Worker, every 15 minutes; secret checked against a hash in D1)
 */
import { dbOf, ensureSchema } from './pd/schema.mjs';
import { canEncrypt as canEncryptCheck, dashboardHost, isPreviewHost, isProductionHost, sha256b64, sameText, secretMatches, hashSecret } from './pd/core.mjs';
import {
  OWNER_IDS, MIN_PASSWORD, SAMPLE_ID, checkPasswordSignIn, clearCookies, createSession, findOwnerByEmail, issueOneTimePassword,
  overLimit, revokeOtherSessions, revokeSession, saveOwner, sessionFromRequest, upgradeLegacyCookie, countFail
} from './pd/auth.mjs';
import { PROVIDERS, disconnect, finishOAuth, listConnections, providerReady, startOAuth } from './pd/providers.mjs';
import {
  ACTION_KINDS, createSheet, draftReminder, findDocuments, loadView, makeChoice, nextMeeting, readAction, readChoices, realCheck,
  runAction, setSource, syncAll, tick, ticks, todayItems, getSetting
} from './pd/data.mjs';
import * as V from './pd/views.mjs';

export { OWNER_IDS, COOKIE, SAMPLE_EMAIL, SAMPLE_PASSWORD, oneTimePasswordEmail, newOneTimePassword, normalOtp } from './pd/auth.mjs';
export { hashSecret } from './pd/core.mjs';
export { COLD_EMAIL_SENDING, COLD_EMAIL_WEEKLY_CAP, FUNNEL_STAGES, KINDS, parseGrid, sampleRows, syncAll } from './pd/data.mjs';
export { MIGRATIONS, BACKUP_TABLES } from './pd/schema.mjs';
export { OAUTH_SECRET_NAMES } from './pd/providers.mjs';

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  // same-origin, never no-referrer: under no-referrer a browser posts forms with "Origin: null",
  // and the foreign-origin check refused every real sign-in (13 Nov 2026).
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; manifest-src 'self'; form-action 'self' https://accounts.google.com https://www.dropbox.com https://account.docusign.com https://appcenter.intuit.com https://login.xero.com; frame-ancestors 'none'; base-uri 'none'"
};
function html(body, status = 200, extra = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS });
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'set-cookie') for (const c of [].concat(v)) headers.append('set-cookie', c);
    else headers.set(k, v);
  }
  return new Response(body, { status, headers });
}
function redirect(location, extra = {}) { return html(null, 303, { location, ...extra }); }

function foreignOrigin(request, url) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return false;
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host !== url.host; } catch { return true; }
}
async function formOf(request) { try { return await request.formData(); } catch { return new FormData(); } }
const field = (form, name) => String(form.get(name) || '');
const safeBack = (v, fallback = '/dashboard') => (/^\/dashboard(\/[A-Za-z0-9/_%.-]*)?$/.test(v) ? v : fallback);
const googleReady = (env) => providerReady(env, 'google');

/** Build the context every signed-in screen shares. */
async function context(env, session, url, now) {
  const view = await loadView(env, { sample: session.sample }, now);
  const connections = session.sample ? [] : await listConnections(env);
  const connected = Object.fromEntries(connections.map((c) => [c.provider, c.status === 'ok']));
  const ticked = await ticks(env, session.sample);
  const choices = await readChoices(env, session.sample);
  const items = todayItems(view, { connections, ticked, now });
  const actionRow = await readAction(env, url.searchParams.get('a'));
  const flash = actionRow && (actionRow.sample === 1) === session.sample ? V.flashBox(actionRow) : '';
  const words = { declined: 'You cancelled on the sign-in screen. Nothing was connected.', exchange_failed: 'The service did not finish connecting. Nothing was stored; try Connect again.', expired: 'That took too long. Try Connect again.', not_set_up: 'That account is not set up yet. See Help for the steps.', no_token_key: 'Connections cannot be saved safely right now. Nothing was stored.', provider_error: 'The service reported a problem. Nothing was connected.', not_a_sheet_link: 'That is not a Google Sheets link. Copy the address of the sheet itself.', cannot_open_sheet: 'That sheet could not be opened with your Google account. Check it is shared with you.', needs_google: 'Connect Google first.', connected: 'Connected. The first sync has run.', disconnected: 'Disconnected, and its access withdrawn.', disconnected_local: 'Disconnected and its key deleted here. Also remove the app in that service\'s settings.', source_saved: 'Sheet saved, and read.', created: 'Sheet created in your Google Drive and read.', refreshed: 'Refreshed.', refresh_failed: 'Refresh finished with problems; see the red rows on Today.', choice_saved: 'Saved. You can change it any time.' };
  const m = url.searchParams.get('m');
  const good = ['connected', 'disconnected', 'disconnected_local', 'source_saved', 'created', 'refreshed', 'choice_saved'].includes(m);
  const note = m && words[m] ? `<p class="d-flash ${good ? 'd-flash--ok' : 'd-flash--bad'}" role="${good ? 'status' : 'alert'}">${words[m]}</p>` : '';
  const googleConnected = Boolean(connections.find((c) => c.provider === 'google'));
  const counts = {
    today: items.length,
    work: view.rows.projects.filter((p) => !/closed|done|complete/i.test(p.status || '')).length,
    money: view.rows.invoices.filter((i) => !/paid/i.test(i.status || '') && (Date.parse(i.due) || Infinity) < now).length,
    agents: view.rows.drafts.filter((a) => /^(|waiting|new|to approve)$/i.test(String(a.status || '').trim())).length
  };
  return { view, now, sample: session.sample, connections, connected, choices, items, counts, flash: flash + note, googleConnected, sources: view.sources, settings: view.settings, origin: url.origin, session };
}

async function cronAllowed(env, request) {
  const given = request.headers.get('x-dashboard-cron') || '';
  if (!given) return false;
  const want = await getSetting(env, 'cron_secret_hash');
  return Boolean(want) && sameText(await sha256b64(given), want);
}

export async function handleDashboard({ request, env = {}, now = Date.now(), waitUntil = null }) {
  const url = new URL(request.url);
  if (!dashboardHost(url.hostname)) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const path = url.pathname.replace(/\/+$/, '') || '/dashboard';
  const post = request.method === 'POST';
  const db = dbOf(env);
  const preview = isPreviewHost(url.hostname);

  // Public, no data: the home-screen manifest and Help (linked from the sign-in screen).
  if (path === '/dashboard/manifest.webmanifest') return new Response(V.manifest(), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });

  if (!db) {
    if (path === '/dashboard/help') return html(V.renderHelp({ origin: url.origin }));
    return html(V.renderSignIn({ configured: false }), 503);
  }
  await ensureSchema(db);

  if (post && path === '/dashboard/cron/sync') {
    if (!(await cronAllowed(env, request))) return new Response('refused', { status: 401 });
    const out = await syncAll(env, now);
    const check = url.searchParams.get('check') === '1' ? await realCheck(env, now).catch(() => null) : null;
    return new Response(JSON.stringify({ ok: out.ok, failed: out.failed, check: check && { ok: check.ok, lines: check.lines } }), { headers: { 'content-type': 'application/json' } });
  }

  if (post && path === '/dashboard/logout') {
    await revokeSession(env, request, now);
    return redirect('/dashboard', { 'set-cookie': clearCookies() });
  }

  if (post && path === '/dashboard/login') {
    if (foreignOrigin(request, url)) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: 'That sign-in came from another site and was refused.' }), 403);
    if (await overLimit(request, 'login')) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: 'Too many tries from this connection. Wait 15 minutes and try again.' }), 429);
    const form = await formOf(request);
    const email = field(form, 'email').trim();
    const remember = field(form, 'remember') === '1';
    const r = await checkPasswordSignIn(env, { email, typed: field(form, 'password'), hostname: url.hostname }, now);
    if (r.kind === 'sample') return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: SAMPLE_ID, sample: true, remember, how: 'sample' }, now) });
    if (r.kind === 'full') return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: r.owner.id, gen: r.owner.gen, remember, how: 'password' }, now) });
    if (r.kind === 'choose') return redirect('/dashboard/password', { 'set-cookie': await createSession(env, { ownerId: r.owner.id, gen: r.owner.gen, stage: 'choose', remember, how: 'otp' }, now) });
    if (r.kind === 'locked') return html(V.renderSignIn({ googleReady: googleReady(env), preview, email, message: 'Too many wrong tries for this email. Wait 15 minutes, or use Forgot it?' }), 429);
    if (r.kind === 'unavailable') return html(V.renderSignIn({ googleReady: googleReady(env), preview, email, message: 'Sign-in is not available right now. Try again in a minute.' }), 503);
    return html(V.renderSignIn({ googleReady: googleReady(env), preview, email, message: 'That email and password did not open the dashboard. Try again, or use Forgot it?' }), 401);
  }

  if (post && path === '/dashboard/google') {
    if (foreignOrigin(request, url)) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: 'That came from another site and was refused.' }), 403);
    if (!googleReady(env)) return redirect('/dashboard');
    const form = await formOf(request);
    return redirect(await startOAuth(env, { provider: 'google', purpose: 'signin', remember: field(form, 'remember') === '1', origin: url.origin }, now));
  }

  if (path === '/dashboard/oauth/callback') {
    const done = await finishOAuth(env, url, now);
    if (done.purpose === 'signin') {
      if (done.error) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: done.error === 'declined' ? 'Google sign-in was cancelled.' : 'Google did not confirm the sign-in. Try again, or use your email.' }), 401);
      const owner = await findOwnerByEmail(env, done.email);
      if (!owner) {
        console.log('OUTPUT dashboard google sign-in refused (not the owner)');
        return html(V.renderSignIn({ googleReady: true, preview, message: 'That Google account does not open this dashboard. Use the account the dashboard belongs to.' }), 403);
      }
      return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: owner.id, gen: owner.gen, remember: done.remember, how: 'google' }, now) });
    }
    const s = await sessionFromRequest(env, request, now);
    if (!s || s.sample || s.stage !== 'full' || (done.ownerId && done.ownerId !== s.ownerId)) return redirect('/dashboard');
    if (done.error) return redirect(`/dashboard/connections?m=${done.error}`);
    if (done.provider === 'google') await syncAll(env, now).catch(() => null);
    return redirect('/dashboard/connections?m=connected');
  }

  if (path === '/dashboard/forgot') {
    if (!post) return html(V.renderForgot({}));
    if (foreignOrigin(request, url)) return html(V.renderForgot({ message: 'That request came from another site and was refused.' }), 403);
    if (await overLimit(request, 'forgot')) return html(V.renderForgot({ message: 'Too many tries from this connection. Wait 15 minutes and try again.' }), 429);
    const form = await formOf(request);
    const owner = await findOwnerByEmail(env, field(form, 'email'));
    if (owner) await issueOneTimePassword(env, owner, url.origin, now);
    return html(V.renderForgot({ sent: true }));
  }

  // Everything below needs a session. A still-valid pre-v1.0 cookie is swapped for a D1 one.
  let session = await sessionFromRequest(env, request, now);
  if (!session && !post) {
    const upgraded = await upgradeLegacyCookie(env, request, now);
    if (upgraded) return redirect(url.pathname + url.search, { 'set-cookie': upgraded });
  }
  if (path === '/dashboard/help' && !post) {
    if (!session || session.stage !== 'full') return html(V.renderHelp({ origin: url.origin }));
  }
  if (!session) return html(V.renderSignIn({ googleReady: googleReady(env), preview }), 401);

  if (path === '/dashboard/password') {
    if (session.sample) return redirect('/dashboard');
    if (!post) return html(V.renderChoose({ stage: session.stage }));
    if (foreignOrigin(request, url)) return html(V.renderChoose({ stage: session.stage, message: 'That came from another site and was refused.' }), 403);
    const form = await formOf(request);
    const next = field(form, 'password');
    const owner = session.owner;
    const again = (message, status = 400) => html(V.renderChoose({ stage: session.stage, message }), status);
    if (session.stage === 'full' && owner.pw && !(await secretMatches(field(form, 'current'), owner.pw))) {
      countFail(owner, now);
      await saveOwner(db, owner);
      return again('Your current password was not right.', 401);
    }
    if (next.length < MIN_PASSWORD) return again(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next !== field(form, 'confirm')) return again('The two passwords were not the same. Type them again.');
    owner.pw = await hashSecret(next);
    owner.otp = null;
    owner.gen += 1;
    owner.fails = null;
    await saveOwner(db, owner);
    await revokeSession(env, request, now);
    await revokeOtherSessions(env, owner.id, '', now);
    return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: owner.id, gen: owner.gen, remember: session.remember, how: 'password' }, now) });
  }
  if (session.stage === 'choose') return redirect('/dashboard/password');

  if (post) {
    if (foreignOrigin(request, url)) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: 'That came from another site and was refused.' }), 403);
    const form = await formOf(request);
    const back = safeBack(field(form, 'back'));
    const withA = (id) => `${back}${back.includes('?') ? '&' : '?'}a=${id}`;
    if (path === '/dashboard/act') {
      const action = field(form, 'action');
      const rowId = field(form, 'row');
      if (action === 'remind') {
        const kind = field(form, 'kind');
        if (!['waiting', 'invoices', 'deals'].includes(kind)) return redirect(back);
        return redirect(withA(await draftReminder(env, { kind, rowId, session }, now)));
      }
      if (!ACTION_KINDS[action]) return redirect(back);
      const r = await runAction(env, { action, rowId, session }, now);
      return redirect(withA(r.id));
    }
    if (path === '/dashboard/tick') {
      const item = field(form, 'item').slice(0, 300);
      if (item) await tick(env, { item, sample: session.sample }, now);
      return redirect('/dashboard');
    }
    if (path === '/dashboard/choice') {
      const ok = await makeChoice(env, { key: field(form, 'key'), value: field(form, 'value'), session }, now);
      return redirect(`/dashboard/connections${ok ? '?m=choice_saved' : ''}#choices`);
    }
    if (session.sample) {
      // Preview only: put the sample rows back as they started (first-run uses it when every sample deal has moved on).
      if (path === '/dashboard/sample/reset') { await db.prepare('DELETE FROM sample_sheet').run(); await db.prepare('DELETE FROM tick WHERE sample = 1').run(); }
      return redirect('/dashboard');
    }
    if (path === '/dashboard/refresh') {
      const out = await syncAll(env, now);
      return redirect(`${back}${back.includes('?') ? '&' : '?'}m=${out.failed ? 'refresh_failed' : 'refreshed'}`);
    }
    if (path === '/dashboard/connect') {
      const provider = field(form, 'provider');
      if (!PROVIDERS[provider] || !providerReady(env, provider)) return redirect('/dashboard/connections?m=not_set_up');
      if (!(await canEncryptCheck(env))) return redirect('/dashboard/connections?m=no_token_key');
      return redirect(await startOAuth(env, { provider, purpose: 'connect', ownerId: session.ownerId, origin: url.origin }, now));
    }
    if (path === '/dashboard/disconnect') {
      const provider = field(form, 'provider');
      if (!PROVIDERS[provider]) return redirect('/dashboard/connections');
      const how = await disconnect(env, provider);
      return redirect(`/dashboard/connections?m=${how === 'revoked' ? 'disconnected' : 'disconnected_local'}`);
    }
    if (path === '/dashboard/source') {
      const r = await setSource(env, field(form, 'group'), field(form, 'link'), now);
      if (r.ok) await syncAll(env, now).catch(() => null);
      return redirect(`/dashboard/connections?m=${r.ok ? 'source_saved' : r.why}#sheets`);
    }
    if (path === '/dashboard/source/create') {
      const group = field(form, 'group');
      if (!['work', 'money'].includes(group)) return redirect('/dashboard/connections#sheets');
      try { await createSheet(env, group, now); await syncAll(env, now).catch(() => null); return redirect('/dashboard/connections?m=created#sheets'); } catch (err) { return redirect(`/dashboard/connections?m=${err.message === 'needs_reconnect' ? 'needs_google' : 'cannot_open_sheet'}#sheets`); }
    }
    return redirect('/dashboard');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return html('', 405, { allow: 'GET, POST' });
  const ctx = await context(env, session, url, now);
  if (path === '/dashboard') return html(V.renderToday(ctx.view, ctx));
  if (path === '/dashboard/work') return html(V.renderWork(ctx.view, ctx));
  if (path.startsWith('/dashboard/work/')) {
    const id = decodeURIComponent(path.slice('/dashboard/work/'.length));
    const p = ctx.view.rows.projects.find((x) => x._id === id);
    if (!p) return redirect('/dashboard/work');
    ctx.meeting = session.sample ? { none: true } : await nextMeeting(env, p.client, now);
    return html(V.renderClient(ctx.view, p, ctx));
  }
  if (path === '/dashboard/deals') return html(V.renderDeals(ctx.view, ctx));
  if (path === '/dashboard/inquiries') return html(V.renderInquiries(ctx.view, ctx));
  if (path === '/dashboard/find') {
    const term = url.searchParams.get('q') || '';
    return html(V.renderFind(term ? await findDocuments(env, term, { sample: session.sample }) : { results: [], searched: [] }, term, ctx));
  }
  if (path === '/dashboard/money') return html(V.renderMoney(ctx.view, ctx));
  if (path === '/dashboard/agents') return html(V.renderAgents(ctx.view, ctx));
  if (path === '/dashboard/connections') {
    const ready = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, providerReady(env, p)]));
    return html(V.renderConnections({ ...ctx, ready, tokenKeyMissing: !session.sample && !(await canEncryptCheck(env)) }));
  }
  if (path === '/dashboard/check') {
    if (session.sample) return redirect('/dashboard/connections');
    return html(V.renderCheck(await realCheck(env, now), ctx));
  }
  if (path === '/dashboard/help') return html(V.renderHelp({ origin: url.origin, signedIn: true, counts: ctx.counts, sample: session.sample }));
  return redirect('/dashboard');
}

export { isProductionHost, isPreviewHost };
