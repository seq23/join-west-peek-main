// west-peek-forms-mailer: the PRIMARY delivery channel and the alarm for every West Peek site form.
// Why it exists and how the pieces fit: functions/_lib/lead-delivery.mjs (top comment).
//
//   POST /send    one lead email through Cloudflare email (send_email binding EMAIL)
//   POST /report  one submission's outcome -> incident records in KV, alarm / "fixed" emails
//   POST /test-alarm  a TEST alarm to FORMS_ALARM_TO through both channels (proves the alarm path)
//   POST /probe   the end-to-end probe now; body {"sites": [...]} limits it to those hosts
//   POST /quota   count one submission against the daily caps (QUOTA below); refuses over a cap,
//                 and answers 503 count_unreadable when the count cannot be read or written
//   cron          the end-to-end probe at 8 AM Central: westpeek.ventures daily, the other two
//                 sites on Mondays (see wrangler.toml and probeSitesFor)
//
// Reachable from the three Pages projects by the service binding FORMS_MAILER; no route and no
// workers.dev URL. Every call must also carry FORMS_MAILER_SECRET (x-forms-mailer-secret).
import {
  applyOutcome, alarmEmail, fixedEmail, alarmAvoids, parseAddressList, signProbe, PROBE_HEADER, PROBE_TO
} from '../../../functions/_lib/lead-delivery.mjs';

export const FROM = { email: 'forms@joinwestpeek.com', name: 'West Peek forms' };
export const PROBE_SITES = ['westpeek.ventures', 'joinwestpeek.com', 'westpeekproductions.com'];
/** Checked every day, not only Mondays (Sequoia, 7 Nov 2026: "the form checks need to go back to daily for west peek ventures"). */
export const DAILY_PROBE_SITES = ['westpeek.ventures'];

/**
 * Daily caps on lead submissions (jwp-lead-lock, 23 Nov 2026), counted in the existing ALARMS KV.
 * 'unchecked' = no Turnstile verdict (widget blocked, or siteverify down): still delivered (her
 * 15 Nov ruling) but capped hard, because nothing proved a person sent it. 'checked' = Turnstile
 * passed. A day is a Chicago calendar day. Real volume is a handful a week, so these sit far above
 * a real day and only stop a flood that would burn the send quota.
 */
export const QUOTA = {
  perIpUnchecked: 3,
  perIpAll: 10,
  globalUnchecked: 25,
  globalChecked: 60
};
const QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;

function chicagoDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** A raw IP is never stored: SHA-256, first 16 hex characters. */
async function ipKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(ip || 'unknown')));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Count one submission. { ok: true, allowed: true } counts it; { ok: true, allowed: false, reason }
 * refuses it without counting. Any KV failure (or no KV) is { ok: false, error: 'count_unreadable' }:
 * never "allowed" by default. Read-then-write is not atomic, so a burst can overshoot a cap by the
 * few requests in flight at once; the caps exist to stop a flood, not to count exactly.
 */
export async function countSubmission(env, { ip, lane }, now = Date.now()) {
  if (lane !== 'checked' && lane !== 'unchecked') return { ok: false, error: 'bad_lane', status: 400 };
  const kv = env.ALARMS;
  if (!kv) return { ok: false, error: 'count_unreadable', detail: 'ALARMS_KV_MISSING' };
  const day = chicagoDay(now);
  const ipHash = await ipKey(ip);
  const keys = {
    ipAll: `quota:${day}:ip:${ipHash}`,
    ipUnchecked: `quota:${day}:ip-unchecked:${ipHash}`,
    global: `quota:${day}:all:${lane}`
  };
  try {
    const read = async (k) => {
      const v = await kv.get(k);
      const n = v === null ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`unreadable count at ${k}`);
      return n;
    };
    const ipAll = await read(keys.ipAll);
    const ipUnchecked = lane === 'unchecked' ? await read(keys.ipUnchecked) : 0;
    const global = await read(keys.global);
    if (ipAll >= QUOTA.perIpAll || (lane === 'unchecked' && ipUnchecked >= QUOTA.perIpUnchecked)) return { ok: true, allowed: false, reason: 'ip' };
    if (global >= (lane === 'unchecked' ? QUOTA.globalUnchecked : QUOTA.globalChecked)) return { ok: true, allowed: false, reason: 'global' };
    const opts = { expirationTtl: QUOTA_TTL_SECONDS };
    await kv.put(keys.ipAll, String(ipAll + 1), opts);
    if (lane === 'unchecked') await kv.put(keys.ipUnchecked, String(ipUnchecked + 1), opts);
    await kv.put(keys.global, String(global + 1), opts);
    return { ok: true, allowed: true };
  } catch (err) {
    return { ok: false, error: 'count_unreadable', detail: String(err && err.message ? err.message : err).slice(0, 200) };
  }
}

/** Email Routing refused the recipient: it is not (yet) a verified destination address. */
export class UnverifiedRecipientError extends Error {
  constructor(address, cause) {
    super(`${address} is not a verified Email Routing destination address yet (${cause})`);
    this.address = address;
  }
}
const UNVERIFIED_RE = /not a verified (destination )?address|destination address (is )?not verified/i;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function callerOk(request, env) {
  const want = String(env.FORMS_MAILER_SECRET || '');
  const got = String(request.headers.get('x-forms-mailer-secret') || '');
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** One email through Cloudflare. Throws on failure (the caller records why). */
export async function sendCloudflare(env, msg) {
  if (!env.EMAIL) throw new Error('send_email binding EMAIL missing');
  const attachments = (msg.attachments || []).map((a) => ({
    content: b64ToBytes(a.contentBase64), filename: a.filename, type: a.type || 'application/octet-stream', disposition: 'attachment'
  }));
  try {
    await env.EMAIL.send({
      to: msg.to, from: FROM, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}), ...(attachments.length ? { attachments } : {})
    });
  } catch (err) {
    const why = String(err && err.message ? err.message : err);
    if (UNVERIFIED_RE.test(why)) throw new UnverifiedRecipientError(String(msg.to), why.slice(0, 120));
    throw err;
  }
}

/** One email through Resend (the backup). Throws on failure. */
export async function sendResend(env, msg, fetchImpl = fetch) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.EMAIL_FROM || '').trim();
  if (!key || !from) throw new Error('resend not configured');
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) })
  });
  if (!res.ok) throw new Error(`resend ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/**
 * An alarm to every FORMS_ALARM_TO address, each one separately: through the channel that did not
 * fail first, then the other. Returns per-address results so a named stop is visible in the log.
 */
export async function sendAlarm(env, mail, avoid, fetchImpl = fetch) {
  const to = parseAddressList(env.FORMS_ALARM_TO);
  if (!to.length) {
    console.error('OUTPUT alarm NAMED_STOP=FORMS_ALARM_TO_MISSING', mail.subject);
    return { sent: 0, results: [], stop: 'FORMS_ALARM_TO_MISSING' };
  }
  const order = avoid === 'cloudflare' ? ['resend', 'cloudflare'] : ['cloudflare', 'resend'];
  const results = [];
  for (const addr of to) {
    let via = null;
    const errors = [];
    for (const ch of order) {
      try {
        if (ch === 'cloudflare') await sendCloudflare(env, { ...mail, to: addr });
        else await sendResend(env, { ...mail, to: addr }, fetchImpl);
        via = ch;
        break;
      } catch (err) {
        errors.push(`${ch}: ${String(err && err.message ? err.message : err).slice(0, 200)}`);
      }
    }
    results.push({ to: addr, via, errors });
  }
  const sent = results.filter((r) => r.via).length;
  console.log(`OUTPUT alarm sent=${sent}/${to.length} ${JSON.stringify(results.map((r) => ({ via: r.via, errors: r.errors })))} subject=${mail.subject}`);
  return { sent, results };
}

export async function handleReport(env, outcome, fetchImpl = fetch, now = Date.now()) {
  if (!env.ALARMS) {
    console.error('OUTPUT report NAMED_STOP=ALARMS_KV_MISSING');
    return { ok: false, error: 'ALARMS_KV_MISSING' };
  }
  const { alarms, fixed } = await applyOutcome(env.ALARMS, outcome, now);
  const sent = [];
  for (const a of alarms) sent.push({ code: a.code, ...(await sendAlarm(env, alarmEmail(a), alarmAvoids(a.code), fetchImpl)) });
  for (const f of fixed) sent.push({ code: f.code, fixed: true, ...(await sendAlarm(env, fixedEmail(f), null, fetchImpl)) });
  return { ok: true, alarms: alarms.map((a) => a.code), fixed: fixed.map((f) => f.code), sent };
}

/**
 * The probe: each given site's /api/lead, signed, must deliver through BOTH channels. A channel-1
 * address still waiting for its verification click is a NOTE in the OUTPUT line, not an alarm
 * (Sequoia, 7 Nov 2026); once it is verified, channel 1 uses it with no change here.
 */
export async function runProbe(env, fetchImpl = fetch, sites = PROBE_SITES) {
  const kind = sites.length < PROBE_SITES.length ? 'Daily' : 'Weekly';
  if (!sites.length) {
    console.error('OUTPUT probe NAMED_STOP=NO_SITES_SELECTED');
    return { ok: false, stop: 'NO_SITES_SELECTED' };
  }
  const secret = String(env.FORMS_PROBE_SECRET || '');
  if (!secret) {
    const mail = { subject: `[West Peek forms] ${kind} check could not run: FORMS_PROBE_SECRET missing`, text: `The ${kind.toLowerCase()} end-to-end check of the site forms did not run because the Worker west-peek-forms-mailer has no FORMS_PROBE_SECRET. Set it from the vault (same value as on the Pages projects).` };
    await sendAlarm(env, mail, null, fetchImpl);
    console.error('OUTPUT probe NAMED_STOP=FORMS_PROBE_SECRET_MISSING');
    return { ok: false, stop: 'FORMS_PROBE_SECRET_MISSING' };
  }
  const results = [];
  for (const host of sites) {
    let r = { host, ok: false };
    try {
      const res = await fetchImpl(`https://${host}/api/lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PROBE_HEADER]: await signProbe(secret, host) },
        body: JSON.stringify({ email: PROBE_TO, name: `[probe] ${kind.toLowerCase()} form check`, lead_type: 'probe', message: `Automatic ${kind.toLowerCase()} check. Ignore.` })
      });
      const body = await res.json().catch(() => null);
      const cf = body?.channels?.cloudflare;
      r = { host, status: res.status, ok: Boolean(res.ok && body && body.ok && body.probe && (cf === 'ok' || cf === 'unverified') && body.channels?.resend === 'ok'), channels: body?.channels, error: body?.error, ...(body?.unverified ? { unverified: body.unverified } : {}) };
    } catch (err) {
      r = { host, ok: false, error: String(err && err.message ? err.message : err).slice(0, 200) };
    }
    results.push(r);
  }
  const failed = results.filter((r) => !r.ok);
  const pending = [...new Set(results.map((r) => r.unverified).filter(Boolean))];
  const notes = pending.map((a) => `note: Cloudflare destination ${a} not verified yet; channel 1 waits, Resend delivers`);
  console.log(`OUTPUT probe ${kind.toLowerCase()} ok=${results.length - failed.length}/${results.length}${notes.length ? ` ${notes.join('; ')}` : ''} ${JSON.stringify(results)}`);
  if (failed.length) {
    const cfDown = failed.some((r) => r.channels?.cloudflare !== 'ok' && r.channels?.cloudflare !== 'unverified');
    const text = [
      `The ${kind.toLowerCase()} end-to-end check of the West Peek site forms FAILED.`,
      '',
      ...results.map((r) => `${r.host}: ${r.ok ? 'OK' : 'FAILED'} (HTTP ${r.status ?? 'none'}; Cloudflare email: ${r.channels?.cloudflare ?? 'unknown'}; Resend: ${r.channels?.resend ?? 'unknown'}${r.error ? `; error: ${r.error}` : ''})`),
      '',
      'Real submissions still try both channels, so a lead is lost only when both fail; you get a separate alarm the moment that happens.',
      'Runbook: RUNBOOK.md in seq23/join-west-peek-main, section "Lead delivery and alarms".'
    ].join('\n');
    await sendAlarm(env, { subject: `[West Peek forms] ${kind} check FAILED on ${failed.map((r) => r.host).join(', ')}`, text }, cfDown ? 'cloudflare' : null, fetchImpl);
  }
  return { ok: failed.length === 0, results, notes };
}

/**
 * Which sites the cron run at `date` probes: none unless it is 8 AM in Chicago (the cron fires at
 * 13:00 and 14:00 UTC every day; only one of them is 8 AM there, CDT or CST), then
 * westpeek.ventures every day and all three sites on Mondays.
 */
export function probeSitesFor(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  if (Number(get('hour')) !== 8) return [];
  return get('weekday') === 'Mon' ? [...PROBE_SITES] : [...DAILY_PROBE_SITES];
}

const worker = {
  async scheduled(event, env, ctx) {
    const at = new Date(event.scheduledTime);
    const sites = probeSitesFor(at);
    if (!sites.length) { console.log(`OUTPUT probe skipped: not 8 AM Chicago (${at.toISOString()})`); return; }
    ctx.waitUntil(runProbe(env, fetch, sites));
  },
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (!callerOk(request, env)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const path = new URL(request.url).pathname;
    let body;
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
    if (path === '/send') {
      if (!body || !body.to || !body.subject || !body.text) return Response.json({ ok: false, error: 'to, subject and text are required' }, { status: 400 });
      try {
        await sendCloudflare(env, body);
        return Response.json({ ok: true });
      } catch (err) {
        if (err instanceof UnverifiedRecipientError) {
          console.log(`OUTPUT send skipped: ${err.address} not a verified Email Routing destination`);
          return Response.json({ ok: false, error: 'recipient_unverified', address: err.address }, { status: 422 });
        }
        return Response.json({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) }, { status: 502 });
      }
    }
    if (path === '/quota') {
      const result = await countSubmission(env, body || {});
      if (!result.ok) console.error(`OUTPUT quota ${result.error}`, result.detail || '');
      return Response.json(result, { status: result.ok ? 200 : result.status || 503 });
    }
    if (path === '/report') return Response.json(await handleReport(env, body || {}));
    if (path === '/test-alarm') {
      const outcome = { host: 'westpeek.ventures', form: 'test', delivered: true, delivered_by: 'cloudflare' };
      const mail = alarmEmail({ code: 'resend_failed', record: { first_seen: new Date().toISOString(), count: 1, delivered: 1, lost: 0, last_detail: 'TEST alarm, sent by hand' }, outcome }, { test: true });
      const results = [];
      for (const ch of ['cloudflare', 'resend']) {
        const one = await sendAlarm({ ...env, ...(ch === 'cloudflare' ? { RESEND_API_KEY: '' } : { EMAIL: null }) }, { ...mail, subject: `${mail.subject} (via ${ch})` }, null);
        results.push({ channel: ch, sent: one.sent, results: one.results });
      }
      return Response.json({ ok: true, results });
    }
    if (path === '/probe') {
      const sites = Array.isArray(body?.sites) ? PROBE_SITES.filter((h) => body.sites.includes(h)) : PROBE_SITES;
      return Response.json(await runProbe(env, fetch, sites));
    }
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  }
};

export default worker;
