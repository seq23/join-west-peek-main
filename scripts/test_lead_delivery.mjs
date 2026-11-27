#!/usr/bin/env node
/**
 * Lead delivery: two channels, the alarm, and the probe (functions/_lib/lead-delivery.mjs).
 *
 * Runs functions/api/lead.js and workers/forms-mailer/src/index.js together under Node, with the
 * service binding wired straight to the Worker's fetch, an in-memory KV, a stub send_email
 * binding and a stub Resend. Each case states the behaviour it pins. LEAD_HANDLER=<path> runs the
 * same cases against another copy of lead.js (how the old code was proven to fail them).
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { signProbe } from '../functions/_lib/lead-delivery.mjs';
import worker from '../workers/forms-mailer/src/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fakeD1 } from './lib/fake_d1.mjs';
import { MIGRATIONS as GT_MIGRATIONS, resetGiveTakeSchemaMemo } from '../functions/_lib/give-take.mjs';
import * as gtBoard from '../functions/api/give-take/board.js';
import * as gtReview from '../functions/api/give-take/review.js';

const handlerPath = resolve(process.env.LEAD_HANDLER || 'functions/api/lead.js');
const lead = await import(pathToFileURL(handlerPath).href);

const ALARM_TO = 'alarm-a@example.test, alarm-b@example.test, alarm-c@example.test';
const failures = [];
let cases = 0;
function check(name, cond, detail = '') {
  cases += 1;
  if (!cond) failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
}

function memKV() {
  const m = new Map();
  return { map: m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}

/** A KV that cannot be read (or written): what an outage or the free-plan write limit looks like. */
function deadKV() {
  const boom = async () => { throw new Error('KV GET failed: 503 Service Unavailable'); };
  return { map: new Map(), get: boom, put: boom, delete: boom };
}

/** A real-looking PDF and a fake one. Only the first five bytes decide. */
const PDF = new Uint8Array([...new TextEncoder().encode('%PDF-1.7\n'), ...new Uint8Array(64)]);
const FAKE_PDF = new TextEncoder().encode('MZ\x90 this is an exe named deck.pdf');

/** Siteverify as Cloudflare answers it. 'pass' = a real token solved on the host it was posted to. */
const TOKENS = {
  pass: (host) => ({ success: true, hostname: host }),
  'other-site': () => ({ success: true, hostname: 'evil.example' }),
  'test-key': () => ({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }),
  forged: () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  spent: () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] })
};
let nextIp = 1;
const SITES = ['joinwestpeek.com', 'westpeek.ventures', 'westpeekproductions.com'];

/** A world: Cloudflare email up or down, Resend up or down, one shared KV and one clock. */
function world({ cloudflare = 'up', resend = 'up', kv = memKV(), unverified = [], pages = {}, siteverify = 'up' } = {}) {
  const sent = { cloudflare: [], resend: [] };
  const verify = [];
  const sheet = [];
  let currentHost = '';
  const workerEnv = {
    FORMS_MAILER_SECRET: 'mailer-secret',
    FORMS_ALARM_TO: ALARM_TO,
    FORMS_PROBE_SECRET: 'probe-secret',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'West Peek <hello@joinwestpeek.com>',
    ALARMS: kv,
    EMAIL: {
      send: async (msg) => {
        if (cloudflare !== 'up') throw new Error('internal error sending email');
        // What the real binding says for a destination added but never verified (7 Nov 2026).
        if (unverified.includes(msg.to)) throw new Error('destination address is not a verified address');
        sent.cloudflare.push(msg);
        return { messageId: 'm1' };
      }
    }
  };
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) {
      if (resend !== 'up') return new Response('{"name":"validation_error","message":"API key is invalid"}', { status: 401 });
      sent.resend.push(JSON.parse(init.body));
      return Response.json({ id: 'r1' });
    }
    if (u.startsWith('https://challenges.cloudflare.com/')) {
      const form = new URLSearchParams(init.body);
      verify.push({ secret: form.get('secret'), response: form.get('response'), remoteip: form.get('remoteip') });
      if (siteverify === 'down') throw new TypeError('fetch failed');
      if (siteverify === 'http500') return new Response('oops', { status: 500 });
      const answer = TOKENS[form.get('response')];
      return Response.json(answer ? answer(currentHost) : TOKENS.forged());
    }
    if (u.startsWith('https://intake.example.test/')) {
      sheet.push(JSON.parse(init.body));
      return Response.json({ ok: true, contact_id: 'c1', result: 'created' });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  const pagesEnv = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'West Peek <hello@joinwestpeek.com>',
    LEAD_TO: 'leads@example.test',
    FORMS_MAILER_SECRET: 'mailer-secret',
    FORMS_PROBE_SECRET: 'probe-secret',
    FORMS_ALARM_TO: ALARM_TO,
    FORMS_MAILER: { fetch: (u, init) => worker.fetch(new Request(u, init), workerEnv) },
    TURNSTILE_SITE_KEY: '0x4AAAAAAAsite',
    TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecret-real',
    WP_NETWORK_OS_INTAKE_URL: 'https://intake.example.test/api/intake/site-form',
    WP_NETWORK_OS_INTAKE_SECRET: 'intake-secret',
    ...pages
  };
  return { sent, workerEnv, pagesEnv, fetchStub: (u, i) => fetchStub(u, i), kv, verify, sheet, setHost: (h) => { currentHost = h; } };
}

/**
 * One POST to /api/lead. By default a real visitor: same-origin, its own IP, and a token that
 * passes siteverify (the CHECKED lane). `token: null` sends none (the unchecked lane). `file`
 * makes it multipart with a deck_file part, exactly as the browser's FormData sends it.
 */
async function submit(w, { host = 'joinwestpeek.com', headers = {}, body = { email: 'founder@example.test', name: 'A Founder', lead_type: 'community_join' }, env, token = 'pass', ip, file } = {}) {
  const pending = [];
  const real = globalThis.fetch;
  globalThis.fetch = w.fetchStub;
  w.setHost(host);
  try {
    const fields = { ...body, ...(token !== null && !('cf-turnstile-response' in body) ? { 'cf-turnstile-response': token } : {}) };
    const baseHeaders = { origin: `https://${host}`, 'cf-connecting-ip': ip || `203.0.113.${nextIp++ % 250}`, ...headers };
    let init;
    if (file) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      fd.set('deck_file', new File([file.bytes], file.name || 'deck.pdf', { type: file.type || 'application/pdf' }));
      init = { method: 'POST', headers: baseHeaders, body: fd };
    } else {
      init = { method: 'POST', headers: { 'content-type': 'application/json', ...baseHeaders }, body: JSON.stringify(fields) };
    }
    const request = new Request(`https://${host}/api/lead`, init);
    const res = await lead.onRequestPost({ request, env: env || w.pagesEnv, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = real;
  }
}

const alarmsIn = (list) => list.filter((m) => /\[West Peek forms\]/.test(m.subject) && !/Fixed/.test(m.subject));
const fixedIn = (list) => list.filter((m) => /\[West Peek forms\] Fixed/.test(m.subject));
const leadsIn = (list) => list.filter((m) => /New (enquiry|inquiry)/.test(m.subject));
const allLeads = (w) => [...leadsIn(w.sent.cloudflare), ...leadsIn(w.sent.resend)];

const quiet = console.error;
console.error = () => {};
const loud = console.log;
console.log = () => {};
try {
  // 1. Primary channel (Cloudflare) down: the lead goes out by Resend, and the alarm fires ONCE for
  //    two failing submissions, through Resend (the channel that did not fail), to all three.
  {
    const w = world({ cloudflare: 'down', resend: 'up' });
    const a = await submit(w);
    const b = await submit(w);
    check('primary down: visitor succeeds', a.status === 200 && a.body.ok === true, JSON.stringify(a.body));
    check('primary down: delivered by resend', a.body.delivered_by === 'resend', JSON.stringify(a.body));
    check('primary down: second visitor succeeds too', b.status === 200 && b.body.ok === true);
    check('primary down: both leads reached the inbox', leadsIn(w.sent.resend).length === 2, `${leadsIn(w.sent.resend).length}`);
    const alarms = alarmsIn(w.sent.resend);
    check('primary down: one alarm per address, not two', alarms.length === 3, `${alarms.length} alarm emails`);
    check('primary down: alarm names the code and says the lead was delivered', alarms.every((m) => /cloudflare_failed/.test(m.subject) && /still reached the inbox/.test(m.text)));
    const rec = JSON.parse((await w.kv.get('incident:cloudflare_failed')) || '{}');
    check('primary down: incident counts both submissions', rec.count === 2 && rec.delivered === 2 && rec.lost === 0, JSON.stringify(rec));

    // Recovery: Cloudflare comes back, the next submission closes the incident with a "fixed" email.
    const healed = world({ cloudflare: 'up', resend: 'up', kv: w.kv });
    const c = await submit(healed);
    check('recovery: delivered by cloudflare', c.body.delivered_by === 'cloudflare', JSON.stringify(c.body));
    check('recovery: a fixed email goes out', fixedIn(healed.sent.cloudflare).length === 3, `${fixedIn(healed.sent.cloudflare).length}`);
    check('recovery: incident closed', (await w.kv.get('incident:cloudflare_failed')) === null);
  }

  // 1b. The 2 Nov 2026 outage itself: the Resend key is dead. The lead still arrives (Cloudflare).
  {
    const w = world({ cloudflare: 'up', resend: 'down' });
    const r = await submit(w);
    check('resend dead (the 2 Nov outage): visitor succeeds', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    check('resend dead: lead delivered by cloudflare', leadsIn(w.sent.cloudflare).length === 1);
  }

  // 2. Both channels down: the visitor sees the error (non-ok, so the form shows the fallback), and
  //    the incident is still RECORDED with the lost submission even though no alarm could be mailed.
  {
    const w = world({ cloudflare: 'down', resend: 'down' });
    const r = await submit(w);
    check('both down: visitor sees an error', r.status === 502 && r.body.ok === false && r.body.error === 'delivery_failed', JSON.stringify(r.body));
    const rec = JSON.parse((await w.kv.get('incident:delivery_failed')) || 'null');
    check('both down: incident recorded as a lost lead', rec && rec.count === 1 && rec.lost === 1, JSON.stringify(rec));
    check('both down: nothing claims to have been delivered', w.sent.cloudflare.length === 0 && w.sent.resend.length === 0);
  }

  // 3. Hourly dedupe: the same problem an hour later alarms again.
  {
    const kv = memKV();
    const outcome = { host: 'joinwestpeek.com', form: 'x', delivered: true, delivered_by: 'resend', channels: { cloudflare: 'failed', resend: 'ok' } };
    const w = world({ cloudflare: 'down', kv });
    const realFetch = globalThis.fetch;
    globalThis.fetch = w.fetchStub;
    const t0 = Date.UTC(2026, 10, 9, 15);
    const { handleReport } = await import('../workers/forms-mailer/src/index.js');
    const first = await handleReport(w.workerEnv, outcome, w.fetchStub, t0);
    const soon = await handleReport(w.workerEnv, outcome, w.fetchStub, t0 + 10 * 60 * 1000);
    const later = await handleReport(w.workerEnv, outcome, w.fetchStub, t0 + 61 * 60 * 1000);
    globalThis.fetch = realFetch;
    check('dedupe: first alarm sent', first.alarms.length === 1);
    check('dedupe: none ten minutes later', soon.alarms.length === 0);
    check('dedupe: again after an hour', later.alarms.length === 1);
  }

  // 4. Option B (her 15 Nov ruling kept, 23 Nov 2026): no token or siteverify down is DELIVERED on
  //    the unchecked lane (no attachment, tighter caps) and the broken check alarms; missing keys,
  //    a forged token or another site's token are REFUSED with nothing sent and no sheet row.
  {
    const ventures = { email: 'f@example.test', lead_type: 'founder_apply' };

    const nokeys = world({ pages: { TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' } });
    const r = await submit(nokeys, { host: 'westpeek.ventures', body: ventures });
    check('keys missing: refused 503', r.status === 503 && r.body.error === 'bot_check_not_configured', JSON.stringify(r.body));
    check('keys missing: no lead sent, no sheet row', allLeads(nokeys).length === 0 && nokeys.sheet.length === 0);
    check('keys missing: alarm sent', alarmsIn(nokeys.sent.cloudflare).some((m) => /bot_check_not_configured/.test(m.subject)));

    const down = world({ siteverify: 'down' });
    const d = await submit(down, { host: 'westpeek.ventures', body: ventures });
    check('siteverify unreachable: delivered unchecked', d.status === 200 && d.body.ok === true && d.body.bot_check === 'unavailable' && d.body.lane === 'unchecked', JSON.stringify(d.body));
    check('siteverify unreachable: lead reached the inbox', allLeads(down).length >= 1);
    check('siteverify unreachable: alarm sent', alarmsIn(down.sent.cloudflare).some((m) => /bot_check_unavailable/.test(m.subject)));

    const h500 = world({ siteverify: 'http500' });
    const e = await submit(h500, { host: 'westpeek.ventures', body: ventures });
    check('siteverify 500: delivered unchecked', e.status === 200 && e.body.lane === 'unchecked', JSON.stringify(e.body));

    const nt = world();
    const n = await submit(nt, { host: 'westpeek.ventures', body: ventures, token: null });
    check('no token: delivered unchecked', n.status === 200 && n.body.ok === true && n.body.bot_check === 'no_token' && n.body.lane === 'unchecked', JSON.stringify(n.body));
    check('no token: siteverify not called', nt.verify.length === 0);

    const spent = world();
    const sp = await submit(spent, { host: 'westpeek.ventures', body: ventures, token: 'spent' });
    check('spent token: refused 400', sp.status === 400 && sp.body.error === 'bot_check_failed', JSON.stringify(sp.body));
  }

  // 10. Every host verifies with ITS project's secret, and refuses a forged token or another site's
  //     token: nothing sent, no sheet row. A passing token is the checked lane.
  for (const host of SITES) {
    const secret = `0x4AAAAAAA-secret-for-${host}`;
    const w = world({ pages: { TURNSTILE_SECRET_KEY: secret } });
    const forged = await submit(w, { host, token: 'forged' });
    check(`${host} forged token: refused 400`, forged.status === 400 && forged.body.error === 'bot_check_failed', JSON.stringify(forged.body));
    const other = await submit(w, { host, token: 'other-site' });
    check(`${host} another site's token: refused 400`, other.status === 400 && other.body.error === 'bot_check_failed', JSON.stringify(other.body));
    check(`${host} refused: no lead sent, no sheet row`, allLeads(w).length === 0 && w.sheet.length === 0, `${allLeads(w).length} leads, ${w.sheet.length} rows`);
    const ok = await submit(w, { host, token: 'pass' });
    check(`${host} valid token: delivered on the checked lane`, ok.status === 200 && ok.body.ok === true && ok.body.lane === 'checked', JSON.stringify(ok.body));
    check(`${host} siteverify was called with this site's own secret`, w.verify.length === 3 && w.verify.every((v) => v.secret === secret), JSON.stringify(w.verify.map((v) => v.secret)));
    const nt = await submit(w, { host, token: null });
    check(`${host} no token: delivered on the unchecked lane`, nt.status === 200 && nt.body.lane === 'unchecked', JSON.stringify(nt.body));
    const noOrigin = await submit(w, { host, headers: { origin: '' } });
    check(`${host} no Origin: dropped, nothing more sent`, noOrigin.status === 200 && noOrigin.body.sheet === 'skipped' && allLeads(w).length === 2, JSON.stringify(noOrigin.body));
  }

  // 11. Cloudflare's published TEST secret is a rubber stamp: refused as "no key" on a real host,
  //     accepted only on a preview (where its fixed hostname "example.com" is expected).
  {
    const testKeys = { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' };
    const w = world({ pages: testKeys });
    const prod = await submit(w, { host: 'westpeek.ventures', token: 'test-key' });
    check('test secret on a real host: refused 503', prod.status === 503 && prod.body.error === 'bot_check_not_configured' && allLeads(w).length === 0, JSON.stringify(prod.body));
    const prev = await submit(w, { host: 'jwp-lead-lock.west-peek-ventures.pages.dev', token: 'test-key' });
    check('test secret on a preview: checked lane', prev.status === 200 && prev.body.lane === 'checked', JSON.stringify(prev.body));
    check('a preview lead is TEST in the subject', allLeads(w).some((m) => /^TEST: New enquiry/.test(m.subject)), allLeads(w).map((m) => m.subject).join(' | '));
    const real = world();
    const notPreview = await submit(real, { host: 'westpeek.ventures', token: 'test-key' });
    check('a test-key token on a real secret: refused (wrong hostname)', notPreview.status === 400, JSON.stringify(notPreview.body));
    const { onRequestGet } = lead;
    const g = await onRequestGet({ request: new Request('https://westpeekproductions.com/api/lead'), env: w.pagesEnv }).json();
    check('GET on a real host with the test key: no site key handed out', g.bot_check === 'not_configured' && !g.turnstile_site_key, JSON.stringify(g));
    for (const host of SITES) {
      const gr = await onRequestGet({ request: new Request(`https://${host}/api/lead`), env: real.pagesEnv }).json();
      check(`GET ${host}: hands out the site key`, gr.bot_check === 'ok' && gr.turnstile_site_key === '0x4AAAAAAAsite', JSON.stringify(gr));
    }
  }

  // 12. Daily caps. Unchecked: 3 per IP, then refused 429 with nothing sent. Any lane: 10 per IP.
  //     Site-wide unchecked: 25. A refused submission is not counted.
  {
    const w = world();
    const ip = '198.51.100.7';
    const got = [];
    for (let i = 0; i < 4; i += 1) got.push((await submit(w, { token: null, ip })).status);
    check('unchecked per-IP cap: 3 delivered, the 4th refused 429', got.join(',') === '200,200,200,429', got.join(','));
    check('unchecked per-IP cap: only 3 leads sent', allLeads(w).length === 3, `${allLeads(w).length}`);
    const checked = await submit(w, { ip });
    check('a checked lead from the same IP still gets through', checked.status === 200 && checked.body.lane === 'checked', JSON.stringify(checked.body));
    for (let i = 0; i < 6; i += 1) await submit(w, { ip });
    const eleventh = await submit(w, { ip });
    check('any-lane per-IP cap: the 11th from one IP refused 429', eleventh.status === 429 && eleventh.body.error === 'rate_limited', JSON.stringify(eleventh.body));

    const g = world();
    const statuses = [];
    for (let i = 0; i < 26; i += 1) statuses.push((await submit(g, { token: null, ip: `192.0.2.${i}` })).status);
    check('site-wide unchecked cap: 25 delivered, the 26th refused', statuses.slice(0, 25).every((x) => x === 200) && statuses[25] === 429, statuses.join(','));
    const stillChecked = await submit(g, { ip: '192.0.2.200' });
    check('site-wide unchecked cap: a checked lead still gets through', stillChecked.status === 200, JSON.stringify(stillChecked.body));
    check('caps never store a raw IP', [...g.kv.map.keys()].every((k) => !k.includes('192.0.2.')), [...g.kv.map.keys()].slice(0, 3).join(','));

    const c = world();
    for (let i = 0; i < 60; i += 1) await submit(c, { ip: `100.64.0.${i}` });
    const over = await submit(c, { ip: '100.64.1.1' });
    check('site-wide checked cap: the 61st refused', over.status === 429, JSON.stringify(over.body));
  }

  // 13. The count cannot be read (KV down): unchecked REFUSED 503 try_again with nothing sent;
  //     checked still delivered, and it alarms. Siteverify down AND KV down: refused, retry message.
  {
    const w = world({ kv: deadKV(), siteverify: 'down' });
    const r = await submit(w);
    check('verify down + count unreadable: refused 503 try_again', r.status === 503 && r.body.error === 'try_again' && /try again/i.test(r.body.message || ''), JSON.stringify(r.body));
    check('verify down + count unreadable: nothing sent, no sheet row', allLeads(w).length === 0 && w.sheet.length === 0);
    const c = world({ kv: deadKV() });
    const ok = await submit(c);
    check('checked + count unreadable: delivered', ok.status === 200 && ok.body.lane === 'checked', JSON.stringify(ok.body));
    check('count unreadable: alarm sent', alarmsIn([...c.sent.cloudflare, ...c.sent.resend]).some((m) => /count_unreadable/.test(m.subject)), [...c.sent.cloudflare, ...c.sent.resend].map((m) => m.subject).join(' | '));
    const junk = memKV();
    const realGet = junk.get;
    junk.get = async (k) => (k.startsWith('quota:') ? 'garbage' : realGet(k));
    const jw = world({ kv: junk });
    const j = await submit(jw, { token: null });
    check('a corrupt count is unreadable, never a free pass', j.status === 503 && j.body.error === 'try_again', JSON.stringify(j.body));
    const noMailer = world({ pages: { FORMS_MAILER: undefined } });
    const nm = await submit(noMailer, { token: null });
    check('no mailer binding (count unreadable): unchecked refused', nm.status === 503 && nm.body.error === 'try_again', JSON.stringify(nm.body));
  }

  // 14. The deck. Checked lane: a real PDF is attached on BOTH channels and one sheet row is
  //     written. A fake PDF (wrong magic bytes, right name and type) or an oversize file is refused
  //     with nothing sent. Unchecked lane: the file is never read or attached, and the response
  //     says so. A hostile filename is cleaned.
  {
    const w = world({ pages: { FORMS_PROBE_CF_TO: 'verified@example.test' } });
    const body = { email: 'founder@acme.example.test', name: 'Ada Founder', lead_type: 'founder_apply' };
    const ok = await submit(w, { host: 'westpeek.ventures', body, file: { bytes: PDF, name: '../../Acme <Seed>.pdf' } });
    check('valid lead + deck: delivered, deck attached', ok.status === 200 && ok.body.deck === 'attached' && ok.body.sheet === 'ok', JSON.stringify(ok.body));
    const cf = leadsIn(w.sent.cloudflare)[0];
    const rs = leadsIn(w.sent.resend)[0];
    check('valid lead + deck: Cloudflare email carries the PDF', cf && cf.attachments && cf.attachments.length === 1 && cf.attachments[0].type === 'application/pdf', JSON.stringify(cf && cf.attachments && cf.attachments.map((a) => a.filename)));
    check('valid lead + deck: Resend email carries the PDF', rs && rs.attachments && rs.attachments.length === 1 && Buffer.from(rs.attachments[0].content, 'base64').subarray(0, 5).toString() === '%PDF-', JSON.stringify(rs && rs.attachments && rs.attachments.map((a) => a.filename)));
    check('valid lead + deck: filename cleaned', rs && rs.attachments[0].filename === 'Acme Seed.pdf', rs && rs.attachments[0].filename);
    check('valid lead + deck: exactly one sheet row', w.sheet.length === 1 && w.sheet[0].email === body.email, `${w.sheet.length}`);

    const fake = world();
    const f = await submit(fake, { host: 'westpeek.ventures', body, file: { bytes: FAKE_PDF, name: 'deck.pdf', type: 'application/pdf' } });
    check('fake PDF: refused 400 deck_file_invalid', f.status === 400 && f.body.error === 'deck_file_invalid', JSON.stringify(f.body));
    check('fake PDF: nothing sent, no sheet row', allLeads(fake).length === 0 && fake.sheet.length === 0);

    const big = world();
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set(new TextEncoder().encode('%PDF-'));
    const o = await submit(big, { host: 'westpeek.ventures', body, file: { bytes: huge } });
    check('oversize PDF: refused 400 deck_file_too_large', o.status === 400 && o.body.error === 'deck_file_too_large', JSON.stringify(o.body));
    check('oversize PDF: nothing sent', allLeads(big).length === 0 && big.sheet.length === 0);
    const edge = world();
    const exact = new Uint8Array(10 * 1024 * 1024);
    exact.set(new TextEncoder().encode('%PDF-'));
    const x = await submit(edge, { host: 'westpeek.ventures', body, file: { bytes: exact } });
    check('exactly 10 MB: accepted', x.status === 200 && x.body.deck === 'attached', JSON.stringify(x.body));

    const un = world();
    const u = await submit(un, { host: 'westpeek.ventures', body, token: null, file: { bytes: FAKE_PDF } });
    check('unchecked + file: delivered without it, response says not_attached', u.status === 200 && u.body.deck === 'not_attached', JSON.stringify(u.body));
    check('unchecked + file: no attachment on any channel', [...un.sent.cloudflare, ...un.sent.resend].every((m) => !m.attachments), '');
    check('unchecked + file: the email says a file was sent but not attached', allLeads(un).every((m) => /NOT attached/.test(m.text)));
  }

  // 15. replyTo is one validated address. A list, a display name or a line break is refused.
  {
    const w = world();
    for (const bad of ['a@x.test, b@y.test', 'Ann <a@x.test>', 'a@x.test\r\nBcc: v@y.test', 'a@x.test b@y.test', 'a@localhost', `${'a'.repeat(250)}@x.test`]) {
      const r = await submit(w, { body: { email: bad, lead_type: 'community_join' } });
      check(`replyTo ${JSON.stringify(bad).slice(0, 30)}: refused invalid_email`, r.status === 400 && r.body.error === 'invalid_email', JSON.stringify(r.body));
    }
    check('replyTo: nothing sent for any of them', allLeads(w).length === 0);
    const good = await submit(w, { body: { email: "o'neil+deals@sub.example.test", lead_type: 'community_join' } });
    check('replyTo: a plus-tagged, apostrophe address is fine', good.status === 200, JSON.stringify(good.body));
    check('replyTo: it is the reply-to, exactly', leadsIn(w.sent.cloudflare)[0]?.replyTo === "o'neil+deals@sub.example.test");
  }

  // 5. The probe: a wrong, stale or missing-secret signature is refused and sends nothing; a right
  //    one skips the bot check, mails the OS inbox (never LEAD_TO) through BOTH channels.
  {
    const w = world();
    const bad = await submit(w, { host: 'westpeek.ventures', headers: { 'x-wp-forms-probe': await signProbe('wrong-secret', 'westpeek.ventures') } });
    check('probe: wrong signature refused', bad.status === 401 && bad.body.error === 'probe_refused', JSON.stringify(bad.body));
    const stale = await submit(w, { host: 'westpeek.ventures', headers: { 'x-wp-forms-probe': await signProbe('probe-secret', 'westpeek.ventures', Math.floor(Date.now() / 1000) - 3600) } });
    check('probe: stale signature refused', stale.status === 401, JSON.stringify(stale.body));
    const otherHost = await submit(w, { host: 'westpeek.ventures', headers: { 'x-wp-forms-probe': await signProbe('probe-secret', 'joinwestpeek.com') } });
    check('probe: signature for another host refused', otherHost.status === 401, JSON.stringify(otherHost.body));
    check('probe: refusals sent nothing', w.sent.cloudflare.length === 0 && w.sent.resend.length === 0);

    const good = await submit(w, { host: 'westpeek.ventures', headers: { 'x-wp-forms-probe': await signProbe('probe-secret', 'westpeek.ventures') }, body: { email: 'os@joinwestpeek.com', lead_type: 'probe' } });
    check('probe: valid signature passes without Turnstile keys', good.status === 200 && good.body.probe === true, JSON.stringify(good.body));
    const all = [...w.sent.cloudflare.map((m) => m.to), ...w.sent.resend.flatMap((m) => m.to)];
    check('probe: both channels used', w.sent.cloudflare.length === 1 && w.sent.resend.length === 1, JSON.stringify(all));
    check('probe: only the OS inbox', all.every((to) => to === 'os@joinwestpeek.com'), JSON.stringify(all));

    const dead = world({ resend: 'down' });
    const p = await submit(dead, { host: 'joinwestpeek.com', headers: { 'x-wp-forms-probe': await signProbe('probe-secret', 'joinwestpeek.com') }, body: { email: 'os@joinwestpeek.com', lead_type: 'probe' } });
    check('probe: a dead backup fails the probe', p.status === 502 && p.body.channels?.resend === 'failed', JSON.stringify(p.body));
  }

  // 6. The 7 Nov 2026 incident: LEAD_TO was added as an Email Routing destination but never
  //    verified. Channel 1 must answer "unverified" (not a 502 failure), Resend carries the lead,
  //    and the alarm is cloudflare_unverified, names the address, and comes at most once a day.
  {
    const w = world({ unverified: ['leads@example.test'] });
    const a = await submit(w);
    const b = await submit(w);
    check('unverified: visitor succeeds', a.status === 200 && a.body.ok === true, JSON.stringify(a.body));
    check('unverified: channel 1 reports unverified, not failed', a.body.channels?.cloudflare === 'unverified', JSON.stringify(a.body.channels));
    check('unverified: lead delivered by resend to LEAD_TO', a.body.delivered_by === 'resend' && leadsIn(w.sent.resend).length === 2 && leadsIn(w.sent.resend).every((m) => m.to.includes('leads@example.test')));
    check('unverified: never raised as cloudflare_failed', (await w.kv.get('incident:cloudflare_failed')) === null);
    const alarms = alarmsIn([...w.sent.resend, ...w.sent.cloudflare]).filter((m) => /cloudflare_unverified/.test(m.subject));
    check('unverified: one alarm per address for two submissions', alarms.length === 3, `${alarms.length}`);
    check('unverified: alarm names the unverified address', alarms.every((m) => m.text.includes('leads@example.test') && /verif/i.test(m.text)));
  }

  // 7. Channel 1 goes to the verified FORMS_PROBE_CF_TO; LEAD_TO still gets every lead by Resend.
  {
    const w = world({ unverified: ['leads@example.test'], pages: { FORMS_PROBE_CF_TO: 'verified@example.test' } });
    const r = await submit(w);
    check('verified cf address: delivered by cloudflare', r.status === 200 && r.body.delivered_by === 'cloudflare', JSON.stringify(r.body));
    check('verified cf address: cloudflare leg went to the verified address only', leadsIn(w.sent.cloudflare).length === 1 && leadsIn(w.sent.cloudflare)[0].to === 'verified@example.test');
    check('verified cf address: LEAD_TO still got it by resend', leadsIn(w.sent.resend).length === 1 && leadsIn(w.sent.resend)[0].to.includes('leads@example.test'));
    check('verified cf address: no alarm', alarmsIn([...w.sent.resend, ...w.sent.cloudflare]).length === 0);
  }

  // 8. The schedule: 8 AM Chicago only, westpeek.ventures daily, all three on Mondays, both DST states.
  {
    const { probeSitesFor, runProbe } = await import('../workers/forms-mailer/src/index.js');
    const tueCst8 = probeSitesFor(new Date(Date.UTC(2026, 10, 10, 14)));
    const tueCst7 = probeSitesFor(new Date(Date.UTC(2026, 10, 10, 13)));
    const monCst8 = probeSitesFor(new Date(Date.UTC(2026, 10, 9, 14)));
    const tueCdt8 = probeSitesFor(new Date(Date.UTC(2026, 6, 14, 13)));
    const tueCdt9 = probeSitesFor(new Date(Date.UTC(2026, 6, 14, 14)));
    check('schedule: Tuesday 8 AM CST probes ventures only', JSON.stringify(tueCst8) === '["westpeek.ventures"]', JSON.stringify(tueCst8));
    check('schedule: 7 AM CST probes nothing', tueCst7.length === 0);
    check('schedule: Monday 8 AM probes all three', monCst8.length === 3);
    check('schedule: Tuesday 8 AM CDT probes ventures', JSON.stringify(tueCdt8) === '["westpeek.ventures"]');
    check('schedule: 9 AM CDT probes nothing', tueCdt9.length === 0);

    // The daily probe while the channel-1 address awaits verification: a note, not an alarm.
    const w = world({ unverified: ['verified@example.test'], pages: { FORMS_PROBE_CF_TO: 'verified@example.test' } });
    w.pagesEnv.TURNSTILE_SITE_KEY = '';
    const siteFetch = async (url, init) => {
      if (String(url).endsWith('/api/lead')) {
        const host = new URL(String(url)).host;
        const real = globalThis.fetch;
        globalThis.fetch = w.fetchStub;
        try {
          return await lead.onRequestPost({ request: new Request(String(url), { ...init, headers: { ...init.headers, origin: `https://${host}` } }), env: w.pagesEnv, waitUntil: () => {} });
        } finally { globalThis.fetch = real; }
      }
      return w.fetchStub(url, init);
    };
    const res = await runProbe(w.workerEnv, siteFetch, ['westpeek.ventures']);
    check('daily probe: unverified channel-1 address is ok with a note', res.ok === true && res.notes.length === 1 && res.notes[0].includes('verified@example.test'), JSON.stringify(res));
    check('daily probe: no alarm for an unverified address', alarmsIn([...w.sent.resend, ...w.sent.cloudflare]).length === 0);
    const none = await runProbe(w.workerEnv, siteFetch, []);
    check('probe: zero sites is a named stop', none.ok === false && none.stop === 'NO_SITES_SELECTED');
  }

  // 9. A productions inquiry reads on a phone in Scooter's layout (15 Nov 2026): his subject, his
  //    order, no empty or tracking lines, Reply-To the submitter, a link to Inquiries, TEST flagged.
  {
    const body = {
      lead_type: 'productions_start_a_project', site: 'westpeekproductions.com', source_page: '/start', landing_page: '/what-we-do',
      utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'fall', referrer_host: 'www.linkedin.com',
      need_type: 'Build community', need_other: '', initiative: 'A spring alumni series.', timing: '1 to 3 months',
      name: 'Dana Reyes', email: 'dana@harborfund.org', organization: 'Harbor Fund', heard_about: 'LinkedIn', website: ''
    };
    const w = world({ cloudflare: 'down' });
    const r = await submit(w, { host: 'westpeekproductions.com', body });
    const m = w.sent.resend.find((x) => /New inquiry/.test(x.subject)) || {};
    check('inquiry: delivered', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    check('inquiry: subject is New inquiry: Organization - Name', m.subject === 'New inquiry: Harbor Fund - Dana Reyes', m.subject);
    check('inquiry: Reply-To is the submitter', m.reply_to === 'dana@harborfund.org', m.reply_to);
    const order = ['Name: Dana Reyes', 'Email: dana@harborfund.org', 'Organization: Harbor Fund', 'Needs: Build community — A spring alumni series.', 'Timing: 1 to 3 months', 'Heard about us: LinkedIn', 'Submitted: '];
    const at = order.map((l) => (m.text || '').indexOf(l));
    check('inquiry: fields in his order', at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1])), JSON.stringify(at));
    check('inquiry: Submitted is a readable Eastern time', /Submitted: \w+day, \w+ \d+, \d{4} at \d+:\d\d [AP]M E[SD]T/.test(m.text || ''), (m.text || '').match(/Submitted: .*/)?.[0]);
    check('inquiry: no tracking labels or raw field names', !/utm_|source_page|landing_page|referrer_host|lead_type|submitted_at|site:|website:|\/api\/lead/.test(`${m.text}${m.html}`));
    check('inquiry: links to Inquiries on the same site', (m.text || '').includes('https://westpeekproductions.com/dashboard/inquiries') && /href="https:\/\/westpeekproductions\.com\/dashboard\/inquiries"/.test(m.html || ''));
    check('inquiry: the email is a clickable link in the html part', /href="mailto:dana@harborfund\.org"/.test(m.html || ''));
    check('inquiry: a real one is not marked TEST', !/TEST/.test(`${m.subject}${m.text}`));

    const t = world({ cloudflare: 'down' });
    await submit(t, { host: 'work-wpc.west-peek-productions.pages.dev', body: { ...body, organization: '', need_type: 'Other', need_other: 'A gala film', initiative: '' } });
    const tm = t.sent.resend.find((x) => /New inquiry/.test(x.subject)) || {};
    check('inquiry: a preview submission is TEST in the subject', tm.subject === 'TEST: New inquiry: Dana Reyes', tm.subject);
    check('inquiry: an empty field is left out, not shown blank', !/Organization:/.test(tm.text || '') && /Needs: Something else: A gala film\n/.test(tm.text || ''), tm.text);
    check('inquiry: on a preview the link opens that preview\'s Inquiries', (tm.text || '').includes('https://work-wpc.west-peek-productions.pages.dev/dashboard/inquiries'));
    check('inquiry: a test address on production is TEST too', lead.isTestInquiry({ email: 'scooter+x@example.test', name: 'Scooter' }, 'https://westpeekproductions.com/api/lead') && !lead.isTestInquiry({ email: 'a@testament.org', name: 'Testament Fund' }, 'https://westpeekproductions.com/api/lead'));

    const c = world({ cloudflare: 'down' });
    await submit(c);
    check('inquiry: other sites keep their own email', leadsIn(c.sent.resend).length === 1 && !c.sent.resend.some((x) => /New inquiry/.test(x.subject)));

    // The Get in touch form (Scooter, 15 Nov 2026): first and last name, title, the service, and for
    // Virtual / hybrid event production the event dates, in his email in that order.
    const g = world({ cloudflare: 'down' });
    const gt = await submit(g, { host: 'westpeekproductions.com', body: { lead_type: 'productions_start_a_project', site: 'westpeekproductions.com', source_page: '/get-in-touch', first_name: 'Dana', last_name: 'Reyes', job_title: 'Director of Programs', organization: 'Harbor Fund', email: 'dana@harborfund.org', initiative: 'A two-day member summit.', service: 'Virtual / hybrid event production', event_start: '2027-04-08', event_end: '2027-04-09', heard_about: 'Search', website: '' } });
    const gm = g.sent.resend.find((x) => /New inquiry/.test(x.subject)) || {};
    check('get in touch: first and last name make one name in the subject', gt.status === 200 && gm.subject === 'New inquiry: Harbor Fund - Dana Reyes', gm.subject);
    const gOrder = ['Name: Dana Reyes', 'Email: dana@harborfund.org', 'Organization: Harbor Fund', 'Title: Director of Programs', 'Service: Virtual / hybrid event production', 'Event dates: Thu, Apr 8, 2027 to Fri, Apr 9, 2027', 'Needs: A two-day member summit.', 'Heard about us: Search', 'Submitted: '];
    const gAt = gOrder.map((l) => (gm.text || '').indexOf(l));
    check('get in touch: title, service and event dates in his order', gAt.every((i, n) => i >= 0 && (n === 0 || i > gAt[n - 1])), JSON.stringify(gAt) + (gm.text || ''));
    check('get in touch: no raw field names in his email', !/first_name|last_name|job_title|event_start|event_end/.test(`${gm.text}${gm.html}`));
  }
  // Give and Take (joinwestpeek.com, Scooter 27 Nov 2026). An ask is saved as waiting and emailed to
  // Scooter with signed review links; it is NEVER added to the network list; it is on the board only
  // after he approves it, and the board carries words only. Offers need the giver's consent, are
  // private, and follow his spec's rules (no own ask, one per giver per ask, approved asks only).
  {
    resetGiveTakeSchemaMemo();
    const GT = { GIVE_TAKE_DB: fakeD1(), GIVE_TAKE_SIGNING_KEY: 'k'.repeat(43) };
    const w = world({ pages: GT });
    const gtMails = (x) => [...x.sent.cloudflare, ...x.sent.resend].filter((m) => /^(TEST: )?Give and Take/.test(m.subject));
    const ask = { lead_type: 'give_and_take_ask', site: 'community', name: 'Asker Person', email: 'asker@example.test', ask: 'Looking for a warm intro to a food-safety consultant.', help_kind: 'Introduction' };
    const a = await submit(w, { body: ask });
    const row = await GT.GIVE_TAKE_DB.prepare('SELECT * FROM gt_ask').first();
    check('give and take: an ask is saved as waiting', a.status === 200 && a.body.give_take === 'saved' && row?.status === 'waiting' && row?.help_kind === 'Introduction', JSON.stringify(a.body));
    check('give and take: an ask never reaches the network list', w.sheet.length === 0 && a.body.sheet === 'not_applicable', JSON.stringify(w.sheet));
    const mail = gtMails(w)[0] || {};
    const mailText = String(mail.text || '');
    check('give and take: Scooter gets the ask with three signed review links', /Approve for the board.*\/api\/give-take\/review\?t=/.test(mailText) && /Decline: /.test(mailText) && /Take down/.test(mailText) && /NOT added to the network list/.test(mailText), mailText.slice(0, 400));
    check('give and take: production never returns the review links to the browser', !a.body.review);
    const prev = await submit(w, { host: 'work-x.west-peek-community.pages.dev', body: { ...ask, email: 'asker2@example.test', ask: 'Second ask, preview host.' }, token: 'test-key', env: { ...w.pagesEnv, TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' } });
    check('give and take: a preview returns the review links (first-run approves its own TEST ask)', prev.status === 200 && /\/api\/give-take\/review\?t=/.test(prev.body.review?.approve || ''), JSON.stringify(prev.body));

    const boardRead = async () => { const r = await gtBoard.onRequestGet({ request: new Request('https://joinwestpeek.com/api/give-take/board'), env: w.pagesEnv }); return { status: r.status, text: await r.text() }; };
    check('give and take: a waiting ask is not on the board', JSON.parse((await boardRead()).text).asks.length === 0);

    const link = /Approve for the board[^:]*: (\S+)/.exec(mailText)?.[1] || '';
    const tok = new URL(link || 'https://x/').searchParams.get('t') || '';
    const getPage = await gtReview.onRequestGet({ request: new Request(link || 'https://joinwestpeek.com/api/give-take/review'), env: w.pagesEnv });
    const after = await GT.GIVE_TAKE_DB.prepare('SELECT status FROM gt_ask WHERE public_id = ?').bind(row.public_id).first();
    check('give and take: opening a review link changes nothing (a mail scanner approves nothing)', getPage.status === 200 && after.status === 'waiting' && /<form method="POST"/.test(await getPage.text()));
    const post = (t, origin = 'https://joinwestpeek.com') => gtReview.onRequestPost({ request: new Request('https://joinwestpeek.com/api/give-take/review', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t }) }), env: w.pagesEnv });
    const forged = await post(tok.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
    const crossSite = await post(tok, 'https://evil.example');
    check('give and take: a forged or cross-site approval is refused', forged.status === 400 && crossSite.status === 403 && (await GT.GIVE_TAKE_DB.prepare('SELECT status FROM gt_ask WHERE public_id = ?').bind(row.public_id).first()).status === 'waiting');
    const ok = await post(tok);
    const board = await boardRead();
    const asks = JSON.parse(board.text).asks;
    check('give and take: approving puts the words on the board', ok.status === 200 && asks.length === 1 && asks[0].ask === ask.ask && asks[0].help === 'Introduction', board.text);
    check('give and take: the board carries no name, email or row id', !/Asker|asker@|"name"|"email"|"id":\d/.test(board.text) && Object.keys(asks[0]).sort().join() === 'approved,ask,help,id', board.text);
    const log = await GT.GIVE_TAKE_DB.prepare('SELECT action, result FROM gt_review_log').all();
    check('give and take: every review action is logged', log.results.some((r) => r.action === 'approve' && r.result === 'done'), JSON.stringify(log.results));

    const offer = { lead_type: 'give_and_take_offer', site: 'community', ask_id: asks[0].id, name: 'Giver Person', email: 'giver@example.test', offer: 'I know two consultants and can introduce you.', help_kind: 'Introduction', share_consent: 'yes' };
    const noConsent = await submit(w, { body: { ...offer, share_consent: '' } });
    check('give and take: an offer without the giver\'s consent is refused', noConsent.status === 400 && noConsent.body.error === 'missing_consent');
    const badKind = await submit(w, { body: { ...offer, help_kind: 'Money' } });
    check('give and take: an unknown kind of help is refused, not guessed', badKind.status === 400 && badKind.body.error === 'invalid_help_kind');
    const waitingId = (await GT.GIVE_TAKE_DB.prepare("SELECT public_id FROM gt_ask WHERE status = 'waiting'").first())?.public_id || 'AAAAAAAAAAAAAAAA';
    const onWaiting = await submit(w, { body: { ...offer, ask_id: waitingId } });
    check('give and take: an ask that is not approved takes no offer', onWaiting.status === 400 && onWaiting.body.error === 'ask_not_found');
    const own = await submit(w, { body: { ...offer, email: 'ASKER@example.test' } });
    check('give and take: nobody offers on their own ask', own.status === 409 && own.body.error === 'own_ask');
    const before = gtMails(w).length;
    const o = await submit(w, { body: offer });
    const orow = await GT.GIVE_TAKE_DB.prepare('SELECT * FROM gt_offer').first();
    const omail = String((gtMails(w)[before] || {}).text || '');
    check('give and take: an offer is saved with the consent time', o.status === 200 && orow?.offer === offer.offer && Number(orow?.consent_at) > 0, JSON.stringify(o.body));
    check('give and take: the offer email carries both people for the intro, by hand', /asker@example\.test/.test(omail) && /giver@example\.test/.test(omail) && /by hand/.test(omail), omail.slice(0, 300));
    check('give and take: an offer never reaches the network list or the board', w.sheet.length === 0 && !/Giver|giver@|consultants/.test((await boardRead()).text));
    const again = await submit(w, { body: { ...offer, offer: 'Second try.' } });
    check('give and take: one offer per giver per ask', again.status === 409 && again.body.error === 'already_offered');

    // Board order: the fewest offers first, then the newest.
    const t2 = prev.body.review ? new URL(prev.body.review.approve).searchParams.get('t') : '';
    await post(t2);
    const order = JSON.parse((await boardRead()).text).asks.map((x) => x.ask);
    check('give and take: the ask with no offers comes first', order[0] === 'Second ask, preview host.' && order[1] === ask.ask, JSON.stringify(order));

    // No store on this deployment: refused before anything is sent.
    const bare = world();
    const nostore = await submit(bare, { body: ask });
    check('give and take: no store means refused, nothing emailed', nostore.status === 503 && nostore.body.error === 'give_take_unavailable' && gtMails(bare).length === 0);
    // Not the community site: not here.
    const v = await submit(world({ pages: GT }), { host: 'westpeek.ventures', body: ask });
    check('give and take: only joinwestpeek.com takes an ask', v.status === 404);
    // Both mail channels down: the ask is not kept to sit unseen.
    resetGiveTakeSchemaMemo();
    const GT2 = { GIVE_TAKE_DB: fakeD1(), GIVE_TAKE_SIGNING_KEY: 'k'.repeat(43) };
    const down = world({ cloudflare: 'down', resend: 'down', pages: GT2 });
    const dr = await submit(down, { body: ask });
    check('give and take: an ask nobody was told about is not kept', dr.status >= 500 && !(await GT2.GIVE_TAKE_DB.prepare('SELECT id FROM gt_ask').first()));
    const missing = await submit(w, { body: { ...ask, ask: '   ' } });
    check('give and take: an empty ask is refused', missing.status === 400 && missing.body.error === 'missing_ask');

    // The migration files are the same statements the code applies.
    const fileSql = readdirSync('migrations/give-take').sort().map((f) => readFileSync(`migrations/give-take/${f}`, 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n')).join('\n');
    const norm = (x) => x.replace(/\s+/g, ' ').replace(/;\s*/g, ';').trim();
    check('give and take: migrations/ and MIGRATIONS match', norm(fileSql) === norm(GT_MIGRATIONS.flatMap((m) => m.sql).map((q) => `${q};`).join('\n')), norm(fileSql).slice(0, 120));
  }
} finally {
  console.error = quiet;
  console.log = loud;
}

if (cases === 0) {
  console.error('test_lead_delivery: NAMED_STOP=ZERO_CASES');
  process.exit(1);
}
if (failures.length) {
  console.error(`test_lead_delivery FAIL (${failures.length}/${cases}) against ${handlerPath}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`test_lead_delivery PASS (${cases} checks)`);
