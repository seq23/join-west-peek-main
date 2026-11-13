#!/usr/bin/env node
/**
 * dashboard:owners — put the dashboard owners in the private store, prove the sign-in on the live
 * dashboard, then send each owner their one-time password email.
 *
 *   npm run dashboard:owners -- --env preview|production --file <owners JSON outside the repo>
 *                               [--url https://<the dashboard's site>] [--send]
 *
 * The file (never committed; the owner's address never lives in this public repo):
 *   { "owners": [ { "id": "scooter", "name": "Scooter", "email": "<his firm email>" } ] }
 * Every id must be on OWNER_IDS in functions/_lib/productions-dashboard.mjs, which is Scooter alone
 * (Scooter, 13 Nov 2026: "the owners list is Scooter alone, and nobody else can be added except by
 * Scooter asking"). The file is the whole list: anyone in the store and not in the file is removed.
 *
 * Steps (Scooter, 13 Nov 2026: "Prove it on the dashboard before anything is sent ... Then send
 * Scooter his one-time password email, and Sequoia hers, one email each"):
 *   1. Writes the owners into the KV namespace "west-peek-productions-dashboard-<env>" (made by
 *      dashboard:store) under the key `owners`. An owner whose email is unchanged keeps their
 *      password and state; the file is the whole list.
 *   2. With --url: waits until that site serves the per-owner sign-in, then PROVES it there with
 *      a throwaway owner (an example.invalid address that receives nothing, removed afterwards):
 *      signed out shows no data; a one-time password forces a new password, shows nothing first,
 *      then stops working; the chosen password opens everything including Money; a password
 *      typed without an email opens nothing; an owner record whose id is not on OWNER_IDS opens
 *      nothing even with its own email and password; and the store's owners are the file's.
 *   3. With --send, and only when every proof step passed: asks the site's own "Forgot it?" for
 *      each owner, so the site's existing mail sender emails the one-time password to that owner's
 *      own address. It reads back which channel carried each. An owner already sent one that is
 *      still unused, or who has a password, is skipped: one email each, however often this runs.
 * Prints owner ids and counts only — never an address, code or password. Needs
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; without them it is a NAMED STOP, exit 2.
 */
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { hashSecret, newOneTimePassword, normalOtp, OWNERS_KEY, OTP_DAYS, OWNER_IDS, PROOF_OWNER_MAX_MS } from '../functions/_lib/productions-dashboard.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function stop(code, line) { console.error(line); process.exit(code); }

const env = arg('env');
const file = arg('file');
const site = arg('url') ? String(arg('url')).replace(/\/+$/, '') : '';
const send = process.argv.includes('--send');
if (!['preview', 'production'].includes(env)) stop(2, 'NAMED STOP dashboard:owners: --env must be preview or production');
if (!file) stop(2, 'NAMED STOP dashboard:owners: --file <owners JSON> is required');
if (send && !site) stop(2, 'NAMED STOP dashboard:owners: --send needs --url (the proof runs on that site first)');
if (site && !/^https:\/\//.test(site)) stop(2, 'NAMED STOP dashboard:owners: --url must be https');
const abs = resolve(file);
if (!relative(process.cwd(), abs).startsWith('..')) stop(2, 'NAMED STOP dashboard:owners: the owners file must live outside this public repo');

let doc;
try { doc = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { stop(2, `NAMED STOP dashboard:owners: cannot read the owners file (${e.code || 'not JSON'})`); }
const listed = Array.isArray(doc?.owners) ? doc.owners : [];
const bad = listed.filter((o) => !/^[a-z0-9-]{2,30}$/.test(o?.id || '') || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o?.email || '') || o.id.startsWith('proof-'));
if (!listed.length) stop(1, 'dashboard:owners refused the file: "owners" must be a non-empty list');
if (bad.length) stop(1, `dashboard:owners refused the file: ${bad.length} owner(s) need an id (a-z, 0-9, -) and an email`);
const unlisted = listed.filter((o) => !OWNER_IDS.includes(o.id));
if (unlisted.length) stop(1, `dashboard:owners refused the file: ${unlisted.map((o) => o.id).join(', ')} is not on the owners list (${OWNER_IDS.join(', ')}); only Scooter can ask for someone to be added`);
if (new Set(listed.map((o) => o.email.toLowerCase())).size !== listed.length) stop(1, 'dashboard:owners refused the file: two owners share an email');

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) stop(2, 'NAMED STOP dashboard:owners: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed');
const API = `${process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${account}`;
const WAITS_MS = [2000, 5000, 10000, 20000, 40000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Workers KV serves a value cached at the edge for up to 60 s after an API write, so the site
// reads what this script wrote only after that. DASHBOARD_OWNERS_SETTLE_MS exists for tests.
const SETTLE_MS = Number(process.env.DASHBOARD_OWNERS_SETTLE_MS || 65000);

/** Cloudflare API with retries on 429/5xx. raw: the KV value body itself, not the JSON envelope. */
async function cf(path, init = {}, { raw = false, missingOk = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
    } catch (e) {
      res = { ok: false, status: 0, text: async () => String(e.code || 'network') };
    }
    if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < WAITS_MS.length) {
      console.error(`dashboard:owners: Cloudflare ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}; retry ${attempt + 1}/${WAITS_MS.length}`);
      await sleep(WAITS_MS[attempt]);
      continue;
    }
    if (missingOk && res.status === 404) return null;
    if (!res.ok) stop(1, `dashboard:owners: Cloudflare ${init.method || 'GET'} ${path.split('?')[0]} answered ${res.status}`);
    if (raw) return res.text();
    const body = await res.json().catch(() => ({}));
    if (body.success === false) stop(1, `dashboard:owners: Cloudflare ${path.split('?')[0]} refused (${(body.errors || []).map((e) => e.code).join(',')})`);
    return body.result;
  }
}

const title = `west-peek-productions-dashboard-${env}`;
const ns = (await cf('/storage/kv/namespaces?per_page=100')).find((n) => n.title === title);
if (!ns) stop(1, `dashboard:owners: the private store ${title} does not exist yet — run dashboard:store for ${env} first`);
const valuePath = `/storage/kv/namespaces/${ns.id}/values/${OWNERS_KEY}`;
async function readOwners() {
  const raw = await cf(valuePath, {}, { raw: true, missingOk: true });
  return raw ? JSON.parse(raw) : {};
}
async function writeOwners(owners) {
  await cf(valuePath, { method: 'PUT', body: JSON.stringify(owners), headers: { 'content-type': 'text/plain' } });
}

// 1. The owners, merged: unchanged email keeps its password and state.
const before = await readOwners();
const owners = {};
for (const o of listed) {
  const had = before[o.id];
  owners[o.id] = had && String(had.email).toLowerCase() === o.email.toLowerCase()
    ? { ...had, name: o.name || had.name }
    : { name: o.name || o.id, email: o.email, pw: null, otp: null, gen: (had?.gen || 0) + 1 };
}
await writeOwners(owners);
const removed = Object.keys(before).filter((k) => !owners[k] && !k.startsWith('proof-'));
const lines = [`owners=${Object.keys(owners).join(',')}`, `removed=${removed.length ? removed.join(',') : 'none'}`];

// 2. The proof, on the live site.
let proof = 'not_run';
if (site) {
  const page = (p, init = {}) => fetch(`${site}${p}`, { redirect: 'manual', ...init, headers: { origin: site, ...(init.headers || {}) } });
  const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
  const withCookie = (c) => ({ headers: { cookie: c } });

  // Wait for the deployment that carries the per-owner sign-in (a push redeploys the preview).
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    const res = await page('/dashboard').catch(() => null);
    const text = res ? await res.text() : '';
    // The deployment with the email-only sign-in: Forgot it? present, no team hint.
    ready = text.includes('href="/dashboard/forgot"') && !text.includes('Team:');
    if (!ready) await sleep(15000);
  }
  if (!ready) stop(1, `dashboard:owners: ${site}/dashboard does not serve the per-owner sign-in after 10 minutes; nothing was sent`);

  const id = `proof-${Date.now().toString(36)}`;
  const email = `${id}@example.invalid`;
  const code = newOneTimePassword();
  const steps = [];
  const step = (name, ok) => { steps.push(`${ok ? 'ok' : 'FAIL'} ${name}`); return ok; };
  // A record under an id that is not on OWNER_IDS, with a password we know: it must open nothing.
  const extraId = `extra-${Date.now().toString(36)}`;
  const extraEmail = `${extraId}@example.invalid`;
  const extraPw = `extra-${newOneTimePassword()}`;
  const withProof = await readOwners();
  withProof[id] = { name: 'Proof (removed after this run)', email, pw: null, gen: 0, proof_until: Date.now() + PROOF_OWNER_MAX_MS, otp: { ...(await hashSecret(normalOtp(code))), issued_at: Date.now(), expires_at: Date.now() + OTP_DAYS * 86400000 } };
  withProof[extraId] = { name: 'Not an owner (removed after this run)', email: extraEmail, pw: await hashSecret(extraPw), otp: null, gen: 0 };
  await writeOwners(withProof);
  await sleep(SETTLE_MS);
  try {
    const out = await page('/dashboard');
    const outText = await out.text();
    step('signed out shows no data', out.status === 401 && !outText.includes('id="work"') && !outText.includes('Figures as of'));

    const first = await page('/dashboard/login', form({ email, password: code }));
    const choose = cookieOf(first);
    step('a one-time password goes straight to choosing a password', first.status === 303 && first.headers.get('location') === '/dashboard/password' && choose.includes('~choose.'));
    const peek = await page('/dashboard', withCookie(choose));
    const peekText = await peek.text();
    step('nothing is shown before a password is chosen', peek.status === 303 && peek.headers.get('location') === '/dashboard/password' && !peekText.includes('id="work"'));

    const reuse = await page('/dashboard/login', form({ email, password: code }));
    step('the one-time password stops working once used', reuse.status === 401 && !cookieOf(reuse).includes('.'));

    const pw = `proof-${newOneTimePassword()}`;
    const set = await page('/dashboard/password', { ...form({ password: pw, confirm: pw }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: choose } });
    const full = cookieOf(set);
    step('choosing a password opens the dashboard', set.status === 303 && full.includes('~full.'));
    const view = await page('/dashboard', withCookie(full));
    const viewText = await view.text();
    step('the owner sees everything, Money included', view.status === 200 && viewText.includes('id="money"') && viewText.includes('Change password'));

    const shared = await page('/dashboard/login', form({ email: '', password: pw }));
    step('a password typed without an email opens nothing', shared.status === 401 && !cookieOf(shared).includes('.'));

    const extra = await page('/dashboard/login', form({ email: extraEmail, password: extraPw }));
    step('a record not on the owners list opens nothing, even with its own email and password', extra.status === 401 && !cookieOf(extra).includes('.'));

    const real = Object.keys(await readOwners()).filter((k) => k !== id && k !== extraId).sort().join(',');
    step(`the store's owners are exactly the file's (${listed.map((o) => o.id).sort().join(',')})`, real === listed.map((o) => o.id).sort().join(','));
  } finally {
    const after = await readOwners();
    delete after[id];
    delete after[extraId];
    await writeOwners(after);
    await sleep(SETTLE_MS);
  }
  const failed = steps.filter((s) => s.startsWith('FAIL'));
  for (const s of steps) console.error(`dashboard:owners proof: ${s}`);
  proof = failed.length ? 'failed' : 'ok';
  lines.push(`proof=${proof}(${steps.length - failed.length}/${steps.length})`);
  if (failed.length) stop(1, `dashboard:owners: the proof failed on ${site} (${failed.join('; ')}); nothing was sent`);
}

// 3. One email each, through the site's own "Forgot it?" and its mail sender.
if (send) {
  const sent = [];
  let problem = false;
  const current = await readOwners();
  for (const [id, o] of Object.entries(current)) {
    if (!OWNER_IDS.includes(id)) continue; // only the owners list; never a proof or stray record
    const pending = o.otp && o.otp.expires_at > Date.now() && ['cloudflare', 'resend'].includes(o.last_issue?.by);
    if (o.pw || pending) { sent.push(`${id}:${o.pw ? 'has_password' : 'already_sent'}`); continue; }
    const res = await fetch(`${site}/dashboard/forgot`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: o.email }), headers: { origin: site, 'content-type': 'application/x-www-form-urlencoded' } });
    const by = (await readOwners())[id]?.last_issue?.by || 'no_record';
    if (res.status !== 200 || !['cloudflare', 'resend'].includes(by)) problem = true;
    sent.push(`${id}:${res.status === 200 ? by : `http_${res.status}`}`);
  }
  lines.push(`sent=${sent.join(',')}`);
  // A site read from before the proof owner was removed can write it back; clear any leftover.
  await sleep(SETTLE_MS);
  const tidy = await readOwners();
  const left = Object.keys(tidy).filter((k) => k.startsWith('proof-') || k.startsWith('extra-'));
  if (left.length) { for (const k of left) delete tidy[k]; await writeOwners(tidy); }
  if (problem) stop(1, `dashboard:owners env=${env} ${lines.join(' ')} — at least one one-time password was not delivered (not_configured = the site has no mail sender set for ${env})`);
}

const done = `OUTPUT dashboard:owners env=${env} ${lines.join(' ')}`;
console.log(done);
console.error(done);
