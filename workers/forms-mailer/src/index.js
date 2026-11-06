// west-peek-forms-mailer: the PRIMARY delivery channel and the alarm for every West Peek site form.
// Why it exists and how the pieces fit: functions/_lib/lead-delivery.mjs (top comment).
//
//   POST /send    one lead email through Cloudflare email (send_email binding EMAIL)
//   POST /report  one submission's outcome -> incident records in KV, alarm / "fixed" emails
//   POST /test-alarm  a TEST alarm to FORMS_ALARM_TO through both channels (proves the alarm path)
//   cron          the weekly end-to-end probe, Monday 8 AM Central (see wrangler.toml)
//
// Reachable from the three Pages projects by the service binding FORMS_MAILER; no route and no
// workers.dev URL. Every call must also carry FORMS_MAILER_SECRET (x-forms-mailer-secret).
import {
  applyOutcome, alarmEmail, fixedEmail, alarmAvoids, parseAddressList, signProbe, PROBE_HEADER, PROBE_TO
} from '../../../functions/_lib/lead-delivery.mjs';

export const FROM = { email: 'forms@joinwestpeek.com', name: 'West Peek forms' };
export const PROBE_SITES = ['westpeek.ventures', 'joinwestpeek.com', 'westpeekproductions.com'];

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
  await env.EMAIL.send({
    to: msg.to, from: FROM, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    subject: msg.subject, text: msg.text, ...(attachments.length ? { attachments } : {})
  });
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

/** The weekly probe: every site's /api/lead, signed, must deliver through BOTH channels. */
export async function runProbe(env, fetchImpl = fetch) {
  const secret = String(env.FORMS_PROBE_SECRET || '');
  if (!secret) {
    const mail = { subject: '[West Peek forms] Weekly check could not run: FORMS_PROBE_SECRET missing', text: 'The weekly end-to-end check of the site forms did not run because the Worker west-peek-forms-mailer has no FORMS_PROBE_SECRET. Set it from the vault (same value as on the Pages projects).' };
    await sendAlarm(env, mail, null, fetchImpl);
    console.error('OUTPUT probe NAMED_STOP=FORMS_PROBE_SECRET_MISSING');
    return { ok: false, stop: 'FORMS_PROBE_SECRET_MISSING' };
  }
  const results = [];
  for (const host of PROBE_SITES) {
    let r = { host, ok: false };
    try {
      const res = await fetchImpl(`https://${host}/api/lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PROBE_HEADER]: await signProbe(secret, host) },
        body: JSON.stringify({ email: PROBE_TO, name: '[probe] weekly form check', lead_type: 'probe', message: 'Automatic weekly check. Ignore.' })
      });
      const body = await res.json().catch(() => null);
      r = { host, status: res.status, ok: Boolean(res.ok && body && body.ok && body.probe && body.channels?.cloudflare === 'ok' && body.channels?.resend === 'ok'), channels: body?.channels, error: body?.error };
    } catch (err) {
      r = { host, ok: false, error: String(err && err.message ? err.message : err).slice(0, 200) };
    }
    results.push(r);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`OUTPUT probe ok=${results.length - failed.length}/${results.length} ${JSON.stringify(results)}`);
  if (failed.length) {
    const cfDown = failed.some((r) => r.channels?.cloudflare !== 'ok');
    const text = [
      'The weekly end-to-end check of the West Peek site forms FAILED.',
      '',
      ...results.map((r) => `${r.host}: ${r.ok ? 'OK' : 'FAILED'} (HTTP ${r.status ?? 'none'}; Cloudflare email: ${r.channels?.cloudflare ?? 'unknown'}; Resend: ${r.channels?.resend ?? 'unknown'}${r.error ? `; error: ${r.error}` : ''})`),
      '',
      'Real submissions still try both channels, so a lead is lost only when both fail; you get a separate alarm the moment that happens.',
      'Runbook: RUNBOOK.md in seq23/join-west-peek-main, section "Lead delivery and alarms".'
    ].join('\n');
    await sendAlarm(env, { subject: `[West Peek forms] Weekly check FAILED on ${failed.map((r) => r.host).join(', ')}`, text }, cfDown ? 'cloudflare' : null, fetchImpl);
  }
  return { ok: failed.length === 0, results };
}

/** Monday, 8 AM in Chicago (the cron fires at 13:00 and 14:00 UTC; only one is 8 AM there). */
export function isProbeTime(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return get('weekday') === 'Mon' && Number(get('hour')) === 8;
}

const worker = {
  async scheduled(event, env, ctx) {
    const at = new Date(event.scheduledTime);
    if (!isProbeTime(at)) { console.log(`OUTPUT probe skipped: not Monday 8 AM Chicago (${at.toISOString()})`); return; }
    ctx.waitUntil(runProbe(env));
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
        return Response.json({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) }, { status: 502 });
      }
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
    if (path === '/probe') return Response.json(await runProbe(env));
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  }
};

export default worker;
