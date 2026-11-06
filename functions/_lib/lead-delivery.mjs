/**
 * Lead delivery: two channels, a loud alarm, and the signed weekly probe.
 *
 * WHY (6 Nov 2026). From 2 Nov 2026 (about 04:20 UTC) every form on these sites failed. The
 * Resend key in the Pages secret RESEND_API_KEY had been deleted from the Resend account, so
 * functions/api/lead.js got a non-OK answer, returned 502 delivery_failed, and wrote the reason
 * only to console.error. Nobody knew for four days. Sequoia: "fix it at the root and make sure
 * any more outages are loud with an email to info@ and sequoia@ and scooter@".
 *
 * So a lead now has two independent ways out, and every failure becomes an email:
 *   1. Cloudflare email (PRIMARY, her call 6 Nov 2026): the west-peek-forms-mailer Worker's
 *      send_email binding, reached from Pages by the service binding FORMS_MAILER
 *      (workers/forms-mailer/). Pages Functions cannot hold a send_email binding themselves.
 *   2. Resend (BACKUP): the Pages secret RESEND_API_KEY, the key used only by these forms.
 * Only when BOTH fail does the visitor see the error with the os@ fallback.
 *
 * Alarms (any channel failure, delivery_not_configured, bot_check_not_configured,
 * bot_check_unavailable) go to the addresses in FORMS_ALARM_TO, an env var on the Worker and on
 * each Pages project, never in this public repo. The Worker keeps one record per incident code
 * in KV: first seen, how many submissions, how many still delivered. At most one alarm per code
 * per hour, and a "fixed" email once a later submission proves that code healthy again. Each alarm
 * goes out through a channel that did not fail.
 *
 * This file is plain functions with no Cloudflare globals, so scripts/test_lead_delivery.mjs can
 * run all of it under Node.
 */

export const ALARM_INTERVAL_MS = 60 * 60 * 1000;
export const PROBE_HEADER = 'x-wp-forms-probe';
export const PROBE_MAX_AGE_SECONDS = 600;
/** The West Peek OS inbox (routed): where a probe lands instead of the founders' inbox. */
export const PROBE_TO = 'os@joinwestpeek.com';

/** Every code that raises an alarm, with the plain words the alarm leads with. */
export const INCIDENTS = {
  cloudflare_failed: 'Cloudflare email (the main way form submissions reach you) is failing.',
  resend_failed: 'Resend (the backup way form submissions reach you) is failing.',
  delivery_failed: 'BOTH ways of delivering form submissions failed. Visitors saw an error and their submission did not reach you.',
  delivery_not_configured: 'Neither way of delivering form submissions is set up on this site. Visitors saw an error.',
  bot_check_not_configured: 'The ventures bot check (Turnstile) has no keys, so every ventures form submission is refused.',
  bot_check_unavailable: 'The ventures bot check (Turnstile) could not be reached, so ventures form submissions were refused.',
  mailer_unreachable: 'The Cloudflare email Worker could not be reached from the site, so alarms are going out through Resend directly.'
};

/** What a lead submission's outcome says is broken. */
export function incidentsFor(outcome) {
  const codes = [];
  if (outcome.bot_check === 'not_configured') codes.push('bot_check_not_configured');
  if (outcome.bot_check === 'unavailable') codes.push('bot_check_unavailable');
  const ch = outcome.channels || {};
  if (ch.cloudflare === 'failed') codes.push('cloudflare_failed');
  if (ch.resend === 'failed') codes.push('resend_failed');
  if (outcome.error === 'delivery_failed') codes.push('delivery_failed');
  if (outcome.error === 'delivery_not_configured') codes.push('delivery_not_configured');
  return codes;
}

/** What a lead submission's outcome PROVES is working again (closes an open incident). */
export function healthyFor(outcome) {
  const codes = [];
  if (outcome.bot_check === 'ok') codes.push('bot_check_not_configured', 'bot_check_unavailable');
  const ch = outcome.channels || {};
  if (ch.cloudflare === 'ok') codes.push('cloudflare_failed', 'mailer_unreachable');
  if (ch.resend === 'ok') codes.push('resend_failed');
  if (outcome.delivered) codes.push('delivery_failed', 'delivery_not_configured');
  return codes;
}

/** The channel an alarm about `code` must NOT rely on. */
export function alarmAvoids(code) {
  if (code === 'cloudflare_failed' || code === 'mailer_unreachable') return 'cloudflare';
  if (code === 'resend_failed') return 'resend';
  return null;
}

export function parseAddressList(value) {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s));
}

/**
 * Update the incident records for one outcome and return the emails that must go out now.
 * `store` is KV-shaped: get(key) -> string|null, put(key, value), delete(key).
 * The alarm's last-sent time is written BEFORE the email is attempted (by the caller), so two
 * submissions in the same second cannot both send one.
 */
export async function applyOutcome(store, outcome, now = Date.now()) {
  const alarms = [];
  const fixed = [];
  const failing = incidentsFor(outcome);
  for (const code of failing) {
    const key = `incident:${code}`;
    const raw = await store.get(key);
    const rec = raw ? JSON.parse(raw) : { code, first_seen: new Date(now).toISOString(), count: 0, delivered: 0, lost: 0, last_alarm_at: 0 };
    rec.count += 1;
    if (outcome.delivered) rec.delivered += 1; else rec.lost += 1;
    rec.last_seen = new Date(now).toISOString();
    rec.last_detail = String(outcome.detail || '').slice(0, 300);
    rec.last_host = outcome.host || '';
    const due = now - (rec.last_alarm_at || 0) >= ALARM_INTERVAL_MS;
    if (due) rec.last_alarm_at = now;
    await store.put(key, JSON.stringify(rec));
    if (due) alarms.push({ code, record: { ...rec }, outcome });
  }
  for (const code of healthyFor(outcome)) {
    if (failing.includes(code)) continue;
    const key = `incident:${code}`;
    const raw = await store.get(key);
    if (!raw) continue;
    await store.delete(key);
    fixed.push({ code, record: JSON.parse(raw), outcome });
  }
  return { alarms, fixed };
}

function line(label, value) {
  return `${label}: ${value}`;
}

export function alarmEmail({ code, record, outcome }, { test = false } = {}) {
  const tag = test ? 'TEST - ' : '';
  const delivered = outcome.delivered
    ? `Yes. This submission still reached the inbox, through ${outcome.delivered_by === 'cloudflare' ? 'Cloudflare email' : 'Resend'}.`
    : 'NO. This submission was not delivered. The visitor saw "We could not send that just now" and the email fallback.';
  const text = [
    test ? 'THIS IS A TEST of the form alarm. Nothing is broken.\n' : '',
    INCIDENTS[code] || code,
    '',
    line('What broke', code),
    line('Since', record.first_seen),
    line('Submissions affected so far', record.count),
    line('Still delivered', record.delivered),
    line('Lost (visitor saw the error)', record.lost),
    line('Was this one delivered', delivered),
    line('Site', outcome.host || 'unknown'),
    line('Form', outcome.form || 'unknown'),
    line('Detail', record.last_detail || 'none'),
    '',
    'Lost submissions are not stored anywhere else. Community and ventures forms still add the person to the Network OS sheet (contacts tab), so look there for anyone who tried.',
    'You get at most one of these an hour for this problem, and a "fixed" email when a later submission works.',
    'Runbook: RUNBOOK.md in seq23/join-west-peek-main, section "Lead delivery and alarms".'
  ].filter((s, i) => i !== 0 || s).join('\n');
  return { subject: `${tag}[West Peek forms] ${outcome.delivered ? 'Problem' : 'LEADS LOST'}: ${code} on ${outcome.host || 'a site'}`, text };
}

export function fixedEmail({ code, record, outcome }) {
  const text = [
    `Fixed: ${code}. A form submission on ${outcome.host || 'a site'} just worked again.`,
    '',
    line('Broken since', record.first_seen),
    line('Last failure', record.last_seen),
    line('Submissions affected', record.count),
    line('Still delivered', record.delivered),
    line('Lost (visitor saw the error)', record.lost),
    '',
    record.lost ? 'Look in the Network OS sheet (contacts tab) for people who tried while it was broken and follow up.' : 'No submission was lost.'
  ].join('\n');
  return { subject: `[West Peek forms] Fixed: ${code}`, text };
}

// ---------------------------------------------------------------------------------------------
// The signed probe. Header: x-wp-forms-probe: t=<unix seconds>,sig=<hex HMAC-SHA256(secret, "t.host")>.
// A valid one skips the rate limit and the bot checks and mails PROBE_TO instead of the founders.

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signProbe(secret, host, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${String(host).toLowerCase()}`)));
  return `t=${t},sig=${sig}`;
}

/** 'none' (no header), 'ok', or 'refused' (header present but wrong, stale, or no secret set). */
export async function verifyProbe(headerValue, secret, host, now = Date.now()) {
  if (!headerValue) return 'none';
  if (!secret) return 'refused';
  const m = /^t=(\d{9,12}),sig=([0-9a-f]{64})$/.exec(String(headerValue).trim());
  if (!m) return 'refused';
  const t = Number(m[1]);
  if (Math.abs(now / 1000 - t) > PROBE_MAX_AGE_SECONDS) return 'refused';
  const expected = (await signProbe(secret, host, t)).split('sig=')[1];
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? 'ok' : 'refused';
}
