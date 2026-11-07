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

/** A world: Cloudflare email up or down, Resend up or down, one shared KV and one clock. */
function world({ cloudflare = 'up', resend = 'up', kv = memKV(), unverified = [], pages = {} } = {}) {
  const sent = { cloudflare: [], resend: [] };
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
    if (u.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: true, hostname: 'westpeek.ventures' });
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
    ...pages
  };
  return { sent, workerEnv, pagesEnv, fetchStub, kv };
}

async function submit(w, { host = 'joinwestpeek.com', headers = {}, body = { email: 'founder@example.test', name: 'A Founder', lead_type: 'community_join' }, env } = {}) {
  const pending = [];
  const real = globalThis.fetch;
  globalThis.fetch = w.fetchStub;
  try {
    const request = new Request(`https://${host}/api/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `https://${host}`, ...headers },
      body: JSON.stringify(body)
    });
    const res = await lead.onRequestPost({ request, env: env || w.pagesEnv, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = real;
  }
}

const alarmsIn = (list) => list.filter((m) => /\[West Peek forms\]/.test(m.subject) && !/Fixed/.test(m.subject));
const fixedIn = (list) => list.filter((m) => /\[West Peek forms\] Fixed/.test(m.subject));
const leadsIn = (list) => list.filter((m) => /New enquiry/.test(m.subject));

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

  // 4. Ventures with no Turnstile keys: refused, and the alarm fires.
  {
    const w = world();
    const r = await submit(w, { host: 'westpeek.ventures', body: { email: 'f@example.test', lead_type: 'founder_apply' } });
    check('bot check not configured: refused', r.status === 503 && r.body.error === 'bot_check_not_configured', JSON.stringify(r.body));
    check('bot check not configured: alarm sent', alarmsIn(w.sent.cloudflare).some((m) => /bot_check_not_configured/.test(m.subject)));
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
