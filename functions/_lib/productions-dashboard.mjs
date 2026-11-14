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
 *   GET  /                Today          GET /flow, /flow/<key> (lead to client to cash, with notes)
 *   GET  /work, /work/<id>, /deals, /inquiries, /find, /access (who can open what, what is kept)
 *   GET  /money           (Scooter only)  GET /agents, /connections, /check, /help (public, no data)
 *   POST /login /forgot /password /logout /google /google/narrow /connect /disconnect /act /deal
 *        /deal/add /note /tick /choice /source /source/create /source/remove /refresh
 *        /keys (app keys pasted on Connections; never shown again)
 *   GET  /flow/<key>/discovery, /quote, /proposal, /delivery; /catalog (lead to delivery)
 *   POST /intake /lead/add /discovery /quote /catalog /catalog/import /proposal /delivery/team
 *        /delivery/task /delivery/task/set /delivery/asset /delivery/portal /copies/delete
 *   GET  /portal/<token>  (a client's own page: their tasks and files marked for them, nothing else)
 *   GET  /oauth/callback  (Google sign-in and every connection)
 *   POST /cron/sync       (the cron Worker, every 15 minutes; secret checked against a hash in D1)
 */
import { dbOf, ensureSchema } from './pd/schema.mjs';
import { canEncrypt as canEncryptCheck, dashboardHost, isPreviewHost, isProductionHost, sha256b64, sameText, secretMatches, hashSecret } from './pd/core.mjs';
import {
  OWNER_IDS, MIN_PASSWORD, SAMPLE_ID, checkPasswordSignIn, clearCookies, createSession, findOwnerByEmail, issueOneTimePassword,
  overLimit, revokeOtherSessions, revokeSession, saveOwner, sessionFromRequest, upgradeLegacyCookie, countFail, countRefused
} from './pd/auth.mjs';
import { PROVIDERS, appKeysSaved, disconnect, finishOAuth, listConnections, providerReady, saveAppKeys, startOAuth, withAppKeys } from './pd/providers.mjs';
import {
  ACTION_KINDS, addDealFromInquiry, createSheet, orgKey, stageOptions, fileAccess, findDocuments, journeys, latestNotes, loadView, makeChoice, nextMeeting, noteHistory,
  readAction, readChoices, realCheck, removeSource, runAction, saveNote, setSource, storedCounts, syncAll, tick, ticks, todayItems, updateDeal, getSetting
} from './pd/data.mjs';
import * as V from './pd/views.mjs';
import * as D from './pd/views-deal.mjs';
import {
  addAsset, addTask, catalogFromGrid, cleanQuote, deliveryOf, intakeAll, latestDiscovery, latestProposal, latestQuote, newPortal, portalView,
  proposalDraft, readCatalog, revokePortal, saveCatalog, saveDiscovery, saveIntake, saveProposal, saveQuote, saveTeam, setTask, startDelivery, validKey
} from './pd/deal.mjs';
import { readSheetGrid } from './pd/data.mjs';
import { wideGoogleScopes } from './pd/providers.mjs';

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
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; manifest-src 'self'; form-action 'self' https://accounts.google.com https://www.dropbox.com https://account.docusign.com https://account-d.docusign.com https://appcenter.intuit.com https://login.xero.com; frame-ancestors 'none'; base-uri 'none'"
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

// A refused sign-in redirects (303) back to the sign-in screen with its message, so a reload never resubmits the form.
const SIGNIN_WORDS = {
  wrong: 'That email and password did not open the dashboard. Try again, or use Forgot it?',
  locked: 'Too many wrong tries for this email. Wait 15 minutes, or use Forgot it?',
  busy: 'Too many tries from this connection. Wait 15 minutes and try again.',
  unavailable: 'Sign-in is not available right now. Try again in a minute.',
  foreign: 'That sign-in came from another site and was refused.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google did not confirm the sign-in. Try again, or use your email.',
  google_other: 'That Google account does not open this dashboard. Use the account the dashboard belongs to.'
};
export function refuseSignIn(code) { return redirect(`/dashboard?signin=${code}`); }

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
  const notes = await latestNotes(env, session.sample);
  const words = { source_removed: 'Stopped. That sheet is no longer read, and the copy of its rows here is deleted.', narrowed_failed: 'Google did not take the narrower access. Nothing changed; try again.', declined: 'You cancelled on the sign-in screen. Nothing was connected.', exchange_failed: 'The service did not finish connecting. Nothing was stored; try Connect again.', expired: 'That took too long. Try Connect again.', not_set_up: 'That account is not set up yet. See Help for the steps.', no_token_key: 'Connections cannot be saved safely right now. Nothing was stored.', provider_error: 'The service reported a problem. Nothing was connected.', not_a_sheet_link: 'That is not a Google Sheets link. Copy the address of the sheet itself.', cannot_open_sheet: 'That sheet could not be opened with your Google account. Check it is shared with you.', needs_google: 'Connect Google first.', connected: 'Connected. The first sync has run.', disconnected: 'Disconnected, and its access withdrawn.', disconnected_local: 'Disconnected and its key deleted here. Also remove the app in that service\'s settings.', source_saved: 'Sheet saved, and read.', created: 'Sheet created in your Google Drive and read.', refreshed: 'Refreshed.', refresh_failed: 'Refresh finished with problems; see the red rows on Today.', choice_saved: 'Saved. You can change it any time.' };
  Object.assign(words, { keys_sample: 'App keys cannot be saved in sample mode. Nothing was stored.', keys_incomplete: 'Paste every key for that app, then press Save. Nothing was stored.', keys_too_long: 'That does not look like an app key (it is too long). Nothing was stored.', keys_foreign: 'That came from another page and was refused. Nothing was stored.' });
  const keyFor = url.searchParams.get('p');
  if (PROVIDERS[keyFor]) words.keys_saved = `Saved. You can connect ${V.providerName(keyFor)} now.`;
  const m = url.searchParams.get('m');
  Object.assign(words, DEAL_WORDS);
  const good = ['source_removed', 'keys_saved', 'connected', 'disconnected', 'disconnected_local', 'source_saved', 'created', 'refreshed', 'choice_saved', ...DEAL_GOOD].includes(m);
  const note = m && words[m] ? `<p class="d-flash ${good ? 'd-flash--ok' : 'd-flash--bad'}" role="${good ? 'status' : 'alert'}">${words[m]}</p>` : '';
  const googleConnected = Boolean(connections.find((c) => c.provider === 'google'));
  const counts = {
    today: items.length,
    work: view.rows.projects.filter((p) => !/closed|done|complete/i.test(p.status || '')).length,
    money: view.rows.invoices.filter((i) => !/paid/i.test(i.status || '') && (Date.parse(i.due) || Infinity) < now).length,
    agents: view.rows.drafts.filter((a) => /^(|waiting|new|to approve)$/i.test(String(a.status || '').trim())).length
  };
  const g = connections.find((c) => c.provider === 'google');
  const intake = await intakeAll(env, session.sample);
  return { notes, view, now, sample: session.sample, connections, connected, choices, items, counts, flash: flash + note, googleConnected, googleWide: Boolean(g && wideGoogleScopes(g.scopes).length), intake, sources: view.sources, settings: view.settings, origin: url.origin, session };
}

const DEAL_WORDS = {
  intake_saved: 'Saved. It shows on this record on every device.', discovery_saved: 'Answers saved. They show on every device, and the quote starts from them.',
  quote_saved: 'Quote saved and read back.', catalog_saved: 'Catalog saved and read back, encrypted.', catalog_read: 'Your rate card was read into the catalog. Check the lines, then build a quote.',
  proposal_saved: 'Proposal saved.', proposal_drafted: 'A first draft was written from your quote. Edit it, then save it.', accepted: 'Accepted. The deal moved in your tracker, and delivery is set up below.',
  accepted_stage_failed: 'Accepted and delivery set up, but your tracker did not show the new stage when read back. Open your tracker to check it.',
  team_saved: 'Team saved.', task_saved: 'Task saved.', asset_saved: 'Asset added.', portal_off: 'The portal is off. No link opens it now.', portal_new: 'A new portal link was made. The old one no longer works.',
  lead_added: 'Added to your tracker as one new row, and read back.', copies_deleted: 'The synced copies are deleted. Your sheets were not touched.',
  money_held: 'Nothing about money was saved: see Who can see what.', no_token_key: 'That cannot be saved safely right now (no encryption key). Nothing was stored.',
  deal_failed: 'That did not save. Nothing was changed.', bad_link: 'That link could not be used. Use an https link.', no_rate_card: 'No Item and Rate (or Cost) columns were found in that sheet. Nothing was changed.',
  needs_tracker: 'Add them to your tracker first, so the deal can move there.', note_kept_here: 'Note saved here. Your tracker has no Notes column, so it was not written there.', already_in_tracker: 'They are already in your tracker.'
};
const DEAL_GOOD = ['intake_saved', 'discovery_saved', 'quote_saved', 'catalog_saved', 'catalog_read', 'proposal_saved', 'proposal_drafted', 'accepted', 'team_saved', 'task_saved', 'asset_saved', 'portal_off', 'portal_new', 'lead_added', 'copies_deleted', 'note_kept_here'];

/** A client's portal: their own page, no sign-in, nothing but what is marked for them. */
export async function handlePortal({ request, env = {} }) {
  const url = new URL(request.url);
  const headers = { ...SECURITY_HEADERS, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'referrer-policy': 'no-referrer' };
  if (!dashboardHost(url.hostname) || request.method !== 'GET') return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const token = url.pathname.replace(/^\/portal\/?/, '').replace(/\/+$/, '');
  const pv = await portalView(env, token).catch(() => null);
  if (!pv || (pv.sample && !isPreviewHost(url.hostname))) return new Response(D.portalGone(), { status: 404, headers });
  const view = await loadView(env, { sample: pv.sample });
  const j = journeys(view, {}).find((x) => x.key === pv.key);
  return new Response(D.renderPortal(pv, j?.name || 'Your project'), { headers });
}

/** The money hold for a session: figures are refused while it stands. */
function moneyHeld(ctx) { return Boolean(D.moneyHold(ctx)); }

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
  // The app keys each connection uses: the Worker secret first; a pair pasted on Connections
  // (encrypted in this host's own database) only where the secret is missing.
  const siteEnv = env;
  env = await withAppKeys(env);

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
    if (foreignOrigin(request, url)) return refuseSignIn('foreign');
    if (await overLimit(request, 'login', { count: false })) return refuseSignIn('busy');
    const form = await formOf(request);
    const email = field(form, 'email').trim();
    const remember = field(form, 'remember') === '1';
    const r = await checkPasswordSignIn(env, { email, typed: field(form, 'password'), hostname: url.hostname }, now);
    if (r.kind === 'sample') return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: SAMPLE_ID, sample: true, remember, how: 'sample' }, now) });
    if (r.kind === 'full') return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: r.owner.id, gen: r.owner.gen, remember, how: 'password' }, now) });
    if (r.kind === 'choose') return redirect('/dashboard/password', { 'set-cookie': await createSession(env, { ownerId: r.owner.id, gen: r.owner.gen, stage: 'choose', remember, how: 'otp' }, now) });
    if (r.kind === 'unavailable') return refuseSignIn('unavailable');
    await countRefused(request, 'login');
    if (r.kind === 'locked') return refuseSignIn('locked');
    return refuseSignIn('wrong');
  }

  if (post && path === '/dashboard/google') {
    if (foreignOrigin(request, url)) return refuseSignIn('foreign');
    if (!googleReady(env)) return redirect('/dashboard');
    const form = await formOf(request);
    return redirect(await startOAuth(env, { provider: 'google', purpose: 'signin', remember: field(form, 'remember') === '1', origin: url.origin }, now));
  }

  if (path === '/dashboard/oauth/callback') {
    const done = await finishOAuth(env, url, now);
    if (done.purpose === 'signin') {
      if (done.error) return refuseSignIn(done.error === 'declined' ? 'google_cancelled' : 'google_failed');
      const owner = await findOwnerByEmail(env, done.email);
      if (!owner) {
        console.log('OUTPUT dashboard google sign-in refused (not the owner)');
        return refuseSignIn('google_other');
      }
      return redirect('/dashboard', { 'set-cookie': await createSession(env, { ownerId: owner.id, gen: owner.gen, remember: done.remember, how: 'google' }, now) });
    }
    const s = await sessionFromRequest(env, request, now);
    if (!s || s.sample || s.stage !== 'full' || (done.ownerId && done.ownerId !== s.ownerId)) return redirect('/dashboard');
    if (done.error) return redirect(`/dashboard/connections?m=${done.error}`);
    // Every account syncs the moment it connects, so its row shows a real synced time (or a red
    // Reconnect) straight away rather than "not synced yet" until the next 15-minute run.
    await syncAll(env, now).catch(() => null);
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
  if (!session) return html(V.renderSignIn({ googleReady: googleReady(env), preview, message: SIGNIN_WORDS[url.searchParams.get('signin')] }), 401);

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
      // Reminders open in his own Gmail as links; there is no server-side email action at all.
      if (!ACTION_KINDS[action]) return redirect(back);
      const r = await runAction(env, { action, rowId, session }, now);
      return redirect(withA(r.id));
    }
    if (path === '/dashboard/deal') {
      const fields = {};
      for (const k of ['stage', 'next_action', 'next_date']) if (form.has(k)) fields[k] = field(form, k);
      const r = await updateDeal(env, { rowId: field(form, 'row'), fields, session }, now);
      return redirect(withA(r.id));
    }
    if (path === '/dashboard/deal/add' || path === '/dashboard/note') {
      const key = field(form, 'key');
      const view = await loadView(env, { sample: session.sample }, now);
      const notes = await latestNotes(env, session.sample);
      const j = journeys(view, { notes, now }).find((x) => x.key === key);
      if (path === '/dashboard/note') {
        // Every save is a version here; the note itself goes into his tracker's Notes cell.
        const kept = await saveNote(env, { subject: key, text: field(form, 'text'), session }, now);
        if (!j?.deal) return redirect(withA(kept));
        const layout = session.sample ? { columns: { notes: 'Notes' } } : view.settings['layout:deals'];
        if (layout?.columns?.notes === undefined) return redirect(`${back}?m=note_kept_here`);
        const r = await updateDeal(env, { rowId: j.deal._id, fields: { notes: field(form, 'text') }, session }, now);
        return redirect(withA(r.id));
      }
      if (!j || j.deals.length || !j.inquiries.length) return redirect(back);
      const intake = (await intakeAll(env, session.sample))[key] || {};
      const r = await addDealFromInquiry(env, { journey: j, session, carry: { owner: intake.owner, need: intake.need, note: j.note?.text } }, now);
      return redirect(withA(r.id));
    }
    const deal = await dealPost(env, { path, form, session, now, back, withA, url });
    if (deal) return deal;
    if (path === '/dashboard/tick') {
      const item = field(form, 'item').slice(0, 300);
      if (item) await tick(env, { item, sample: session.sample }, now);
      return redirect('/dashboard');
    }
    if (path === '/dashboard/choice') {
      const ok = await makeChoice(env, { key: field(form, 'key'), value: field(form, 'value'), session }, now);
      const to = safeBack(field(form, 'back').split('#')[0], '/dashboard/connections');
      return redirect(`${to}${ok ? '?m=choice_saved' : ''}#${field(form, 'back').split('#')[1] || 'choices'}`);
    }
    if (path === '/dashboard/keys') {
      // Same-origin only, strictly: a request that does not say where it came from is refused too.
      const site = request.headers.get('sec-fetch-site');
      const origin = request.headers.get('origin');
      const sameOrigin = site ? site === 'same-origin' : Boolean(origin) && (() => { try { return new URL(origin).host === url.host; } catch { return false; } })();
      if (!sameOrigin) return redirect('/dashboard/connections?m=keys_foreign#keys');
      if (session.sample) return redirect('/dashboard/connections?m=keys_sample#keys');
      const provider = field(form, 'provider');
      if (!PROVIDERS[provider]) return redirect('/dashboard/connections#keys');
      const r = await saveAppKeys(env, provider, { id: field(form, 'id'), secret: field(form, 'secret') }, now);
      if (r === 'saved') return redirect(`/dashboard/connections?m=keys_saved&p=${provider}`);
      return redirect(`/dashboard/connections?m=${r === 'no_token_key' ? 'no_token_key' : `keys_${r}`}#keys-${provider}`);
    }
    if (session.sample) {
      // Preview only: put the sample rows back as they started (first-run uses it when every sample deal has moved on).
      if (path === '/dashboard/sample/reset') {
        await db.prepare('DELETE FROM sample_sheet').run();
        for (const t of ['tick', 'intake', 'discovery', 'catalog', 'quote', 'proposal', 'delivery', 'task', 'asset', 'portal']) await db.prepare(`DELETE FROM ${t} WHERE sample = 1`).run();
      }
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
      const server = provider === 'docusign' && field(form, 'server') === 'test' ? 'test' : 'live';
      return redirect(await startOAuth(env, { provider, purpose: 'connect', ownerId: session.ownerId, origin: url.origin, server }, now));
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
    if (path === '/dashboard/source/remove') {
      await removeSource(env, field(form, 'group'));
      await syncAll(env, now).catch(() => null);
      return redirect('/dashboard/connections?m=source_removed#sheets');
    }
    if (path === '/dashboard/google/narrow') {
      // Withdraw the wider grant at Google first (a revoke ends every scope it held), then ask again
      // for only what the dashboard uses. His named sheets and their rows stay as they are.
      if (!providerReady(env, 'google')) return redirect('/dashboard/connections?m=not_set_up');
      await disconnect(env, 'google');
      return redirect(await startOAuth(env, { provider: 'google', purpose: 'connect', ownerId: session.ownerId, origin: url.origin }, now));
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
  if (path === '/dashboard/flow') return html(V.renderFlow(ctx.view, ctx, journeys(ctx.view, { notes: ctx.notes, now }), url.searchParams.get('show') || 'all'));
  if (path.startsWith('/dashboard/flow/')) {
    const [key, part = ''] = decodeURIComponent(path.slice('/dashboard/flow/'.length)).split('/');
    const j = journeys(ctx.view, { notes: ctx.notes, now }).find((x) => x.key === key);
    if (!j) return redirect('/dashboard/flow');
    const s = session.sample;
    const deal = { ...ctx, discovery: await latestDiscovery(env, key, s), quote: await latestQuote(env, key, s), proposal: await latestProposal(env, key, s), delivery: await deliveryOf(env, key, s) };
    if (part === 'discovery') {
      // The pickers on the page re-shape the questions without saving (a plain GET form).
      const p = Object.fromEntries(['service', 'buyer', 'objective', 'budget'].map((k) => [k, url.searchParams.get(`p_${k}`)]).filter(([, v]) => v !== null));
      if (Object.keys(p).length) deal.discovery = { ...(deal.discovery || { answers: {}, at: null }), profile: { ...(deal.discovery?.profile || {}), ...p } };
      return html(D.renderDiscovery(j, deal));
    }
    if (part === 'quote') return html(D.renderQuote(j, { ...deal, catalog: moneyHeld(ctx) ? null : await readCatalog(env, s) }));
    if (part === 'proposal') return html(D.renderProposal(j, deal));
    if (part === 'delivery') return html(D.renderDelivery(j, deal, { origin: url.origin, token: /^[A-Za-z0-9_-]{20,64}$/.test(url.searchParams.get('portal') || '') ? url.searchParams.get('portal') : '' }));
    if (part) return redirect(`/dashboard/flow/${encodeURIComponent(key)}`);
    return html(V.renderFlowRecord(ctx.view, j, { ...deal, history: await noteHistory(env, key, s) }));
  }
  if (path === '/dashboard/catalog') return html(D.renderCatalog({ ...ctx, catalog: moneyHeld(ctx) ? null : await readCatalog(env, session.sample) }));
  if (path === '/dashboard/access') {
    return html(V.renderAccess({ ...ctx, access: await fileAccess(env, ctx.view, { sample: session.sample }), counts_stored: session.sample ? null : await storedCounts(env) }));
  }
  if (path === '/dashboard/deals') return html(V.renderDeals(ctx.view, ctx));
  if (path === '/dashboard/inquiries') return html(V.renderInquiries(ctx.view, ctx, Object.fromEntries(journeys(ctx.view, { notes: ctx.notes, now }).map((j) => [j.key, j]))));
  if (path === '/dashboard/find') {
    const term = url.searchParams.get('q') || '';
    return html(V.renderFind(term ? await findDocuments(env, term, { sample: session.sample }) : { results: [], searched: [] }, term, ctx));
  }
  if (path === '/dashboard/money') return html(V.renderMoney(ctx.view, ctx));
  if (path === '/dashboard/agents') return html(V.renderAgents(ctx.view, ctx));
  if (path === '/dashboard/connections') {
    const ready = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, providerReady(env, p)]));
    const keysFromSite = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, providerReady(siteEnv, p)]));
    const keysSaved = session.sample ? {} : await appKeysSaved(env);
    return html(V.renderConnections({ ...ctx, ready, keysFromSite, keysSaved, tokenKeyMissing: !session.sample && !(await canEncryptCheck(env)) }));
  }
  if (path === '/dashboard/check') {
    if (session.sample) return redirect('/dashboard/connections');
    return html(V.renderCheck(await realCheck(env, now), ctx));
  }
  if (path === '/dashboard/help') return html(V.renderHelp({ origin: url.origin, signedIn: true, counts: ctx.counts, sample: session.sample }));
  return redirect('/dashboard');
}

export { isProductionHost, isPreviewHost };

/* ------------------------------------------------------------------ lead to delivery: the POSTs */

const dealBack = (key, part = '') => `/dashboard/flow/${encodeURIComponent(key)}${part ? `/${part}` : ''}`;
async function dealPost(env, { path, form, session, now, back, withA, url }) {
  const s = session.sample;
  const key = field(form, 'key');
  const go = (m, to = back) => redirect(`${to.split('?')[0]}?m=${m}`);
  const needsKey = ['/dashboard/intake', '/dashboard/discovery', '/dashboard/quote', '/dashboard/proposal', '/dashboard/delivery/team', '/dashboard/delivery/task', '/dashboard/delivery/task/set', '/dashboard/delivery/asset', '/dashboard/delivery/portal'];
  if (needsKey.includes(path) && !validKey(key)) return redirect('/dashboard/flow');
  // Money inputs (rates, quotes, prices, proposals) wait for the narrow Google grant and Money on.
  const moneyPaths = ['/dashboard/quote', '/dashboard/catalog', '/dashboard/catalog/import', '/dashboard/proposal'];
  if (moneyPaths.includes(path)) {
    const connections = s ? [] : await listConnections(env);
    const g = connections.find((c) => c.provider === 'google');
    const ctx = { sample: s, choices: await readChoices(env, s), googleWide: Boolean(g && wideGoogleScopes(g.scopes).length) };
    if (moneyHeld(ctx)) return go('money_held');
  }
  const record = async () => {
    const view = await loadView(env, { sample: s }, now);
    return { view, j: journeys(view, { notes: await latestNotes(env, s), now }).find((x) => x.key === key) };
  };

  if (path === '/dashboard/intake') {
    const { j } = await record();
    if (!j) return redirect('/dashboard/flow');
    if (j.deal) {
      const r = await updateDeal(env, { rowId: j.deal._id, fields: { owner: field(form, 'owner') }, session }, now);
      return redirect(withA(r.id));
    }
    return go((await saveIntake(env, { key, owner: field(form, 'owner'), need: field(form, 'need'), sample: s }, now)) === 'saved' ? 'intake_saved' : 'deal_failed');
  }
  if (path === '/dashboard/lead/add') {
    // A researched lead he picked by hand: one appended row in his tracker, Source "Researched".
    const org = field(form, 'org').trim().slice(0, 160);
    const k = orgKeyOf(org);
    if (!k) return go('deal_failed', '/dashboard/inquiries');
    const { view } = await record();
    if (journeys(view, { now }).find((x) => x.key === k)?.deals.length) return go('already_in_tracker', '/dashboard/inquiries');
    const journey = { key: k, name: org, inquiries: [{ name: field(form, 'name').slice(0, 160), email: field(form, 'email').trim().slice(0, 200), initiative: field(form, 'need').slice(0, 1000) }], deals: [] };
    const r = await addDealFromInquiry(env, { journey, session, carry: { owner: field(form, 'owner').slice(0, 120), source: 'Researched', next_action: 'First outreach' } }, now);
    return redirect(r.outcome === 'saved' ? `${dealBack(k)}?a=${r.id}` : `/dashboard/inquiries?a=${r.id}`);
  }
  if (path === '/dashboard/discovery') {
    const profile = Object.fromEntries(['service', 'buyer', 'objective', 'budget'].map((k) => [k, field(form, `p_${k}`)]));
    const answers = {};
    for (const [k, v] of form.entries()) if (k.startsWith('a_') && typeof v === 'string') answers[k.slice(2)] = v;
    return go((await saveDiscovery(env, { key, profile, answers, sample: s }, now)) === 'saved' ? 'discovery_saved' : 'deal_failed', dealBack(key, 'discovery'));
  }
  if (path === '/dashboard/quote') {
    const catalog = await readCatalog(env, s);
    const raw = { price: field(form, 'price'), term: field(form, 'term'), months: field(form, 'months'), plan: field(form, 'plan'), split: field(form, 'split'), rationale: field(form, 'rationale'), title: field(form, 'title'), lines: catalog.map((l) => ({ id: l.id, qty: field(form, `qty_${l.id}`), cost: field(form, `cost_${l.id}`), month: field(form, `month_${l.id}`) })) };
    const r = await saveQuote(env, { key, quote: cleanQuote(raw, catalog), sample: s }, now);
    return go(r.outcome === 'saved' ? 'quote_saved' : r.outcome === 'no_token_key' ? 'no_token_key' : 'deal_failed', dealBack(key, 'quote'));
  }
  if (path === '/dashboard/catalog') {
    const n = Math.min(Number(field(form, 'n')) || 0, 201);
    const lines = Array.from({ length: n }, (_, i) => ({ id: field(form, `id_${i}`) || `N${now.toString(36)}${i}`, line: field(form, `line_${i}`), service: field(form, `service_${i}`), unit: field(form, `unit_${i}`), cost: field(form, `cost_${i}`) }));
    const r = await saveCatalog(env, { lines, sample: s }, now);
    return go(r === 'saved' ? 'catalog_saved' : r, '/dashboard/catalog');
  }
  if (path === '/dashboard/catalog/import') {
    if (s) return go('deal_failed', '/dashboard/catalog');
    const grid = await readSheetGrid(env, field(form, 'link')).catch(() => null);
    if (!grid) return go('bad_link', '/dashboard/catalog');
    const lines = catalogFromGrid(grid);
    if (!lines?.length) return go('no_rate_card', '/dashboard/catalog');
    const r = await saveCatalog(env, { lines, sample: s }, now);
    return go(r === 'saved' ? 'catalog_read' : r, '/dashboard/catalog');
  }
  if (path === '/dashboard/proposal') {
    const what = field(form, 'do');
    const to = dealBack(key, 'proposal');
    if (what === 'draft') {
      const q = await latestQuote(env, key, s);
      if (!q || q.unreadable) return go('deal_failed', to);
      const { j } = await record();
      const text = proposalDraft({ name: j?.name || key, quote: q, discovery: await latestDiscovery(env, key, s) });
      return go((await saveProposal(env, { key, text, status: 'draft', quoteId: q._id, sample: s }, now)) === 'saved' ? 'proposal_drafted' : 'deal_failed', to);
    }
    const p = await latestProposal(env, key, s);
    if (what === 'save') {
      if (p?.status === 'accepted') return go('deal_failed', to);
      const status = field(form, 'status') === 'sent' ? 'sent' : 'draft';
      return go((await saveProposal(env, { key, text: field(form, 'text'), status, quoteId: p?.quoteId, sample: s }, now)) === 'saved' ? 'proposal_saved' : 'deal_failed', to);
    }
    if (what === 'accept') {
      if (!p || p.text === null || p.status === 'accepted') return go('deal_failed', to);
      const { view, j } = await record();
      if (!j?.deal) return go('needs_tracker', to);
      if ((await saveProposal(env, { key, text: p.text, status: 'accepted', quoteId: p.quoteId, sample: s }, now)) !== 'saved') return go('deal_failed', to);
      const stages = stageOptionsFor(view);
      const signed = stages.find((x) => /signed/i.test(x));
      let stageOk = true;
      if (signed && signed !== j.deal.stage) stageOk = (await updateDeal(env, { rowId: j.deal._id, fields: { stage: signed }, session }, now)).outcome === 'saved';
      const q = await latestQuote(env, key, s);
      const started = await startDelivery(env, { key, team: field(form, 'team'), quote: q && !q.unreadable ? q : null, sample: s }, now);
      return redirect(`${dealBack(key, 'delivery')}?m=${stageOk ? 'accepted' : 'accepted_stage_failed'}${started.token ? `&portal=${started.token}` : ''}`);
    }
    return redirect(to);
  }
  const to = dealBack(key, 'delivery');
  if (path.startsWith('/dashboard/delivery/') && !(await deliveryOf(env, key, s))) return redirect(to);
  if (path === '/dashboard/delivery/team') { await saveTeam(env, { key, team: field(form, 'team'), sample: s }); return go('team_saved', to); }
  if (path === '/dashboard/delivery/task') return go((await addTask(env, { key, title: field(form, 'title'), owner: field(form, 'owner'), due: field(form, 'due'), client: field(form, 'client') === '1', sample: s }, now)) === 'saved' ? 'task_saved' : 'deal_failed', to);
  if (path === '/dashboard/delivery/task/set') return go((await setTask(env, { key, id: field(form, 'id'), field: field(form, 'field'), value: field(form, 'value') === '1', sample: s })) === 'saved' ? 'task_saved' : 'deal_failed', to);
  if (path === '/dashboard/delivery/asset') return go((await addAsset(env, { key, label: field(form, 'label'), url: field(form, 'url'), client: field(form, 'client') === '1', sample: s }, now)) === 'saved' ? 'asset_saved' : 'bad_link', to);
  if (path === '/dashboard/delivery/portal') {
    if (field(form, 'do') === 'off') { await revokePortal(env, { key, sample: s }, now); return go('portal_off', to); }
    const token = await newPortal(env, { key, sample: s }, now);
    return redirect(`${to}?m=portal_new&portal=${token}`);
  }
  if (path === '/dashboard/copies/delete') {
    if (s) return redirect('/dashboard/access');
    const db = dbOf(env);
    await db.batch([db.prepare('DELETE FROM row_cache'), db.prepare('DELETE FROM sync_state')]);
    console.log('OUTPUT dashboard synced copies deleted by the owner');
    return redirect('/dashboard/access?m=copies_deleted#stored');
  }
  return null;
}
function orgKeyOf(name) { return orgKey(name); }
function stageOptionsFor(view) { return stageOptions(view.rows.deals, view.settings?.['layout:deals']?.stages).stages; }
