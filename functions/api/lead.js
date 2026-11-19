/**
 * Lead intake for the three West Peek sites.
 *
 * Every contact form on joinwestpeek.com, and its ventures and productions
 * siblings, POSTs here. Until now nothing answered: /api/lead responded exactly
 * as a nonexistent path did - 405 to POST, 404 to GET - so every submission
 * failed. The form does not fake success, it tells the visitor to email instead,
 * so nobody was deceived; but a form on the fund's own front door that never
 * works is a conversion leak, and README_DEPLOY.md described it as "a real
 * contact form".
 *
 * That is fixed and deployed. Measured 2026-08-27, read-only GET on all three
 * production hostnames:
 *   GET https://westpeek.ventures/api/lead         -> 405 {"ok":false,"error":"method_not_allowed",...}
 *   GET https://joinwestpeek.com/api/lead          -> 405 (same body)
 *   GET https://westpeekproductions.com/api/lead   -> 405 (same body)
 *   GET https://<each>/api/zzz-nonexistent-xyz     -> 404 + the site's 404.html
 * The endpoint now answers differently from a path that does not exist, on
 * every one of the three Pages projects. Whether RESEND_API_KEY / EMAIL_FROM
 * are populated per project is NOT MEASURED - proving that needs a POST, and a
 * POST to production would create a real record.
 *
 * Delivery is by Resend. If the key is absent the handler returns 503 rather
 * than 200, because the form shows its email fallback on a non-ok response -
 * answering 200 without delivering would turn a visible failure into a silent
 * one, which is strictly worse.
 *
 * ---------------------------------------------------------------------------
 * THE SHEET, ADDED 22 SEP 2026
 *
 * The owner's rule: "make all forms automatically default to adding names to
 * our master network sheet." Until now this handler emailed Scooter and stored
 * nothing, so the fund's master network sheet never learned about anyone who
 * filled in a form on its own front door. Every submission now ALSO posts to
 * the West Peek Network OS intake door, which appends or updates a row on the
 * contacts tab.
 *
 * FAILURE SEMANTICS, decided and stated rather than left to be discovered:
 *
 *   The EMAIL is what the visitor's success has always meant. A sheet outage
 *   must never cost somebody their submission, so if the email was delivered
 *   the visitor still gets {"ok":true} even when the sheet write failed.
 *
 *   But the failure is never silent. Every response carries a `sheet` field -
 *   "ok", "failed", "not_configured" or "skipped" - which the tests can read,
 *   and a failure is logged with the form and the host. The other half of the
 *   signal lives in Network OS: GET /api/health reports the door's readiness
 *   under `siteFormIntake`, so a door that is silently rejecting everything is
 *   visible without anyone having to make a submission to find out.
 *
 * The two calls run concurrently, so adding the sheet does not double the time
 * the visitor waits, and the sheet call is bounded by its own timeout so a slow
 * door cannot hold a submission open.
 *
 * Config, per Pages project, vendor-prefixed so it can never collide with a
 * reserved runtime name:
 *   WP_NETWORK_OS_INTAKE_URL     plain var - the door's URL
 *   WP_NETWORK_OS_INTAKE_SECRET  secret - the shared secret it requires
 *
 * Which forms are meant to reach the sheet is declared in
 * shared/forms-register.json and enforced by rule FORM-10 in
 * scripts/validate_forms.mjs. A form that goes somewhere else is a named
 * exception in that file, not an accident.
 */

import {
  PROBE_HEADER, PROBE_TO, verifyProbe, incidentsFor, alarmEmail, ALARM_INTERVAL_MS, parseAddressList
} from '../_lib/lead-delivery.mjs';
import { recordWebInquiry } from '../_lib/pd/deal.mjs';

const MAX_FIELD = 5000;
const REQUIRED = ['email'];

/** The one file field this handler accepts, and how big it may be. */
const FILE_FIELD = 'deck_file';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Fields that exist ONLY to catch bots. Every one of these must be genuinely
 * hidden in every form that carries it - no label, display:none, tabindex="-1".
 *
 * This list used to read ['company_website', '_gotcha'], which was exactly
 * backwards. `company_website` is the VISIBLE "Website (optional)" input on
 * pitch.html, and the actually-hidden trap in that same form is named
 * `website` - a name this handler never looked at. So the trap caught nothing,
 * and every founder who answered the visible website question honestly was
 * dropped on the floor and told "Received. We'll reply soon."
 *
 * scripts/validate_forms.mjs parses this array and asserts that every form in
 * the repo hides exactly these names and exposes no others, so the two halves
 * cannot drift apart again.
 */
const HONEYPOT_FIELDS = ['website', '_gotcha'];

/** Cloudflare Turnstile: the token field the widget adds, and where it is verified. */
const TURNSTILE_FIELD = 'cf-turnstile-response';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 4000;

/**
 * Per-IP limit on every site (security sweep, 3 Nov 2026). A person sends one enquiry; a script
 * replaying the endpoint sends many. This repo has no storage binding, so the count lives in the
 * Cache API: per data centre, which is where one address's requests land. A missing or failing
 * cache never blocks a submission (the limit is a brake on volume, not the bot check).
 */
const LEAD_LIMIT_PER_IP = 5;
const LEAD_LIMIT_WINDOW_SECONDS = 3600;

async function overIpLimit(request) {
  const ip = request.headers.get('cf-connecting-ip');
  const cache = globalThis.caches?.default;
  if (!ip || !cache) return false;
  const windowStart = Math.floor(Date.now() / 1000 / LEAD_LIMIT_WINDOW_SECONDS);
  const key = new Request(`https://lead-limit.invalid/${encodeURIComponent(ip)}/${windowStart}`);
  try {
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= LEAD_LIMIT_PER_IP) return true;
    await cache.put(key, new Response(String(count + 1), {
      headers: { 'cache-control': `max-age=${LEAD_LIMIT_WINDOW_SECONDS}` }
    }));
    return false;
  } catch {
    return false;
  }
}

/** How long the sheet write may take before the visitor stops waiting for it. */
const INTAKE_TIMEOUT_MS = 5000;

/**
 * Which property a request arrived on. Productions is tested FIRST so a
 * productions preview deployment can never fall through into a sheet write.
 */
const PRODUCTIONS_HOSTS = [
  'westpeekproductions.com',
  'www.westpeekproductions.com',
  'productions.joinwestpeek.com',
  'productions.westpeek.co',
  'westpeek-productions.com',
  'west-peek-productions.pages.dev'
];
const VENTURES_HOSTS = [
  'westpeek.ventures',
  'www.westpeek.ventures',
  'ventures.joinwestpeek.com',
  // A ventures custom domain on the west-peek-ventures Pages project. Without this entry it fell
  // through to the community suffix 'westpeek.co' below and skipped the ventures bot checks.
  'ventures.westpeek.co',
  'westpeekventures.com',
  'west-peek-ventures.pages.dev'
];
const COMMUNITY_HOSTS = [
  'joinwestpeek.com',
  'www.joinwestpeek.com',
  'westpeek.co',
  // The Pages project is named join-west-peek-main but its pages.dev alias is
  // west-peek-community.pages.dev (the name it had first; every preview is
  // <branch>.west-peek-community.pages.dev). The old entry named a host that
  // does not exist, so a real person submitting through the alias skipped the
  // sheet - measured 28 Sep 2026: a preview POST answered sheet:"not_applicable".
  // FORM-10 pins the real one. Preview deployments share this suffix but carry
  // no intake variables (the preview environment is empty on purpose), so a
  // test submission on a preview never reaches the sheet.
  'west-peek-community.pages.dev'
];

/** Only these properties' visitors are West Peek's own network contacts. */
const SHEET_SITES = ['community', 'ventures'];

function hostMatches(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * Exported so scripts/validate_forms.mjs can EXECUTE this decision against
 * every row in the forms register, in both directions, rather than pattern
 * matching the source and hoping.
 */
export function siteForHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (hostMatches(host, PRODUCTIONS_HOSTS)) return 'productions';
  if (hostMatches(host, VENTURES_HOSTS)) return 'ventures';
  if (hostMatches(host, COMMUNITY_HOSTS)) return 'community';
  return 'unknown';
}

export function writesToSheet(hostname) {
  return SHEET_SITES.includes(siteForHost(hostname));
}

/** The bot checks apply to ventures only (the 8 Oct 2026 request was about westpeek.ventures). */
function botChecksApply(hostname) {
  return siteForHost(hostname) === 'ventures';
}

/**
 * Every ventures form submits by same-origin fetch, and browsers always send
 * Origin on a POST. A missing or foreign Origin (Referer as the fallback) is a
 * script replaying the endpoint, not a visitor.
 */
export function sameOrigin(request, hostname) {
  const source = request.headers.get('origin') || request.headers.get('referer') || '';
  if (!source) return false;
  try {
    return new URL(source).hostname.toLowerCase() === String(hostname).toLowerCase();
  } catch {
    return false;
  }
}

function turnstileConfigured(env) {
  return Boolean(clean(env.TURNSTILE_SECRET_KEY) && clean(env.TURNSTILE_SITE_KEY));
}

/**
 * Siteverify error codes that are about OUR side (secret, request, Cloudflare itself), not the
 * visitor's token. They say nothing about whether a person sent the form, so they never drop it.
 */
const TURNSTILE_NOT_A_VERDICT = ['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error'];

/**
 * Returns 'ok', 'failed' (Cloudflare says this real token is invalid), 'no_token' (the widget
 * never produced one: blocked script, ad blocker, privacy browser) or 'unavailable' (siteverify
 * unreachable, slow, non-OK, or an error that is not about the token). Only 'failed' drops.
 */
async function verifyTurnstile(token, env, request) {
  if (!token) return 'no_token';
  try {
    const body = new URLSearchParams({ secret: clean(env.TURNSTILE_SECRET_KEY), response: token });
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) body.set('remoteip', ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
    });
    if (!res.ok) return 'unavailable';
    const result = await res.json().catch(() => null);
    if (!result || typeof result.success !== 'boolean') return 'unavailable';
    if (result.success !== true) {
      const codes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];
      return codes.some((c) => TURNSTILE_NOT_A_VERDICT.includes(c)) ? 'unavailable' : 'failed';
    }
    if (result.hostname && siteForHost(result.hostname) !== 'ventures') return 'failed';
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

function clean(value) {
  return String(value ?? '').slice(0, MAX_FIELD).trim();
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

/**
 * This repo has no storage binding, so a file part is never held past this
 * one request: it is read into memory, validated, and either attached to the
 * outgoing Resend email or rejected. Nothing is written to disk or R2.
 */
async function readDeckFile(value) {
  if (!(value instanceof File) || value.size === 0) return { file: null, error: null };
  if (value.size > MAX_FILE_BYTES) return { file: null, error: 'deck_file_too_large' };
  const bytes = new Uint8Array(await value.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  const looksPdf = header === '%PDF-' && (value.type === 'application/pdf' || /\.pdf$/i.test(value.name || ''));
  if (!looksPdf) return { file: null, error: 'deck_file_invalid' };
  return { file: { filename: value.name || 'deck.pdf', bytes }, error: null };
}

/** Resend wants attachment content as base64. Chunked so a 10MB file does not blow the call stack. */
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Post one submission to the Network OS intake door.
 *
 * Returns a short status string rather than throwing, because no outcome here
 * may change what the visitor sees. The caller records it and moves on.
 */
async function addToNetworkSheet(fields, env, request, site) {
  const url = clean(env.WP_NETWORK_OS_INTAKE_URL);
  const secret = clean(env.WP_NETWORK_OS_INTAKE_SECRET);
  const form = clean(fields.lead_type) || clean(fields.lead_source) || 'unknown';

  // The owner's rule, before anything else happens. A productions submission is
  // a client's, and it goes to Scooter's inbox only.
  if (!writesToSheet(site)) {
    const property = siteForHost(site);
    if (property === 'unknown') {
      console.error('lead sheet write skipped: unrecognised host', JSON.stringify({ site, form }));
    }
    return 'not_applicable';
  }

  if (!url || !secret) {
    console.error('lead sheet write not configured', JSON.stringify({ site, form, has_url: Boolean(url), has_secret: Boolean(secret) }));
    return 'not_configured';
  }

  // One id per submission, so a retry of this call cannot create a second row.
  const submissionId = `sub_${Date.now()}_${crypto.randomUUID()}`;
  const payload = { submission_id: submissionId, host: site, form };
  for (const [key, value] of Object.entries(fields)) {
    if (HONEYPOT_FIELDS.includes(key) || key === TURNSTILE_FIELD) continue;
    payload[key] = clean(value);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wp-network-os-intake-secret': secret,
        'x-wp-network-os-submission-id': submissionId
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(INTAKE_TIMEOUT_MS)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('lead sheet write failed', JSON.stringify({ site, form, status: res.status, detail: detail.slice(0, 300) }));
      return 'failed';
    }
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) {
      console.error('lead sheet write refused', JSON.stringify({ site, form, body: JSON.stringify(body).slice(0, 300) }));
      return 'failed';
    }
    return 'ok';
  } catch (err) {
    console.error('lead sheet write threw', JSON.stringify({ site, form, error: String(err).slice(0, 300) }));
    return 'failed';
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const later = typeof waitUntil === 'function' ? waitUntil : () => {};
  // The signed probe (workers/forms-mailer runProbe; daily on ventures, Mondays elsewhere). A header that is present but wrong,
  // stale, or unverifiable is refused outright: it never falls through to a normal submission.
  const probe = await verifyProbe(request.headers.get(PROBE_HEADER), clean(env.FORMS_PROBE_SECRET), new URL(request.url).hostname);
  if (probe === 'refused') {
    console.error('lead refused', JSON.stringify({ reason: 'probe_signature', host: new URL(request.url).hostname }));
    return json({ ok: false, error: 'probe_refused' }, 401);
  }
  const isProbe = probe === 'ok';
  // Before the body is read: an address over its limit costs nothing more. The form shows its
  // email fallback on any non-ok answer, so a real person who hits this still has a way through.
  if (!isProbe && await overIpLimit(request)) {
    console.error('lead dropped', JSON.stringify({ reason: 'ip_limit', host: new URL(request.url).hostname }));
    return json({ ok: false, error: 'rate_limited' }, 429);
  }
  let fields = {};
  let deckFile = null;
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      fields = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') { fields[k] = v; continue; }
        if (k !== FILE_FIELD) { fields[k] = ''; continue; }
        const { file, error } = await readDeckFile(v);
        if (error) return json({ ok: false, error }, 400);
        deckFile = file;
        fields[k] = file ? file.filename : '';
      }
    }
  } catch {
    return json({ ok: false, error: 'unreadable_body' }, 400);
  }

  // A bot filling a genuinely hidden field is the cheapest possible filter.
  // Answer 200 so it does not learn anything, and drop the message. Only names
  // in HONEYPOT_FIELDS may trigger this: a field a human can see and was asked
  // to fill in must never be able to discard their submission.
  const host = new URL(request.url).hostname;
  const formName = clean(fields.lead_type) || clean(fields.lead_source) || 'unknown';
  if (HONEYPOT_FIELDS.some((key) => clean(fields[key]))) {
    console.error('lead dropped', JSON.stringify({ reason: 'honeypot', form: formName, host }));
    return json({ ok: true, sheet: 'skipped' }, 200);
  }

  // Bot checks, ventures only, before any email or sheet write.
  //
  // THE RULE (owner, 15 Nov 2026: "I wouldn't have started this bot check if it was going to mess
  // up the form"): the bot check can never block a real inquiry. A submission is DROPPED only when
  //   - the honeypot is filled (above), or Origin/Referer is missing or foreign (here), or
  //   - Cloudflare siteverify definitively rejects a real token (verdict 'failed').
  // Every other case is DELIVERED exactly like a normal inquiry, with bot_check recorded in the
  // logs and reportOutcome (never shown to the visitor): keys unset -> 'not_configured', siteverify
  // down/slow/erroring -> 'unavailable', no token because the widget did not load -> 'no_token'.
  // 'not_configured' and 'unavailable' still raise the alarm. This replaces the 3 Nov 2026 fail-
  // closed rule. Pinned by FORM-13 in scripts/validate_forms.mjs and by case 4 in
  // scripts/test_lead_delivery.mjs.
  let botCheck = 'not_applicable';
  if (botChecksApply(host) && !isProbe) {
    if (!sameOrigin(request, host)) {
      console.error('lead dropped', JSON.stringify({ reason: 'origin', form: formName, host }));
      return json({ ok: true, sheet: 'skipped' }, 200);
    }
    botCheck = turnstileConfigured(env)
      ? await verifyTurnstile(clean(fields[TURNSTILE_FIELD]), env, request)
      : 'not_configured';
    if (botCheck === 'failed') {
      console.error('lead dropped', JSON.stringify({ reason: 'turnstile', verdict: botCheck, form: formName, host }));
      return json({ ok: false, error: 'bot_check_failed' }, 400);
    }
    if (botCheck !== 'ok') {
      console.error('lead bot check skipped, delivering', JSON.stringify({ bot_check: botCheck, form: formName, host }));
    }
  }

  // The Get in touch form asks first and last name apart (Scooter, 15 Nov 2026); everything
  // downstream (his email, the dashboard, the test flag) reads one name.
  if (!clean(fields.name) && (clean(fields.first_name) || clean(fields.last_name))) {
    fields.name = [clean(fields.first_name), clean(fields.last_name)].filter(Boolean).join(' ');
  }
  const email = clean(fields.email);
  for (const key of REQUIRED) {
    if (!clean(fields[key])) return json({ ok: false, error: `missing_${key}` }, 400);
  }
  if (!looksLikeEmail(email)) return json({ ok: false, error: 'invalid_email' }, 400);

  const leadSource = clean(fields.lead_source);
  const isCommunityViabilityAssessment = leadSource === 'community_viability_assessment';
  const to = isProbe
    ? PROBE_TO
    : isCommunityViabilityAssessment
      ? clean(env.COMMUNITY_ASSESSMENT_TO) || 'scooter@westpeek.ventures'
      : clean(env.LEAD_TO) || 'scooter@westpeek.ventures';
  const site = host;

  // The sheet write starts now and is awaited at the end, so it runs alongside
  // the email rather than after it. It is started even when delivery is
  // unconfigured: the person still belongs in the network sheet, and losing
  // them because a mail key is missing would be a second failure caused by the
  // first. A probe never writes.
  const sheetWrite = isProbe ? Promise.resolve('skipped') : addToNetworkSheet(fields, env, request, site);
  // A productions inquiry also lands in Scooter's own dashboard (his private database on this same
  // Pages project), beside his form's responses (Scooter, 14 Nov 2026: "Wire the forms on my live
  // sites to feed this same flow"). Never a network sheet; it never changes what the visitor sees.
  const dashboardKept = !isProbe && siteForHost(host) === 'productions' ? recordWebInquiry(env, fields) : Promise.resolve('not_applicable');

  // Only the traps are stripped from the notification. company_website is real
  // founder-supplied data the fund wants, so it stays in the email body.
  const lines = Object.entries(fields)
    .filter(([k]) => !HONEYPOT_FIELDS.includes(k) && k !== TURNSTILE_FIELD)
    .map(([k, v]) => (k === FILE_FIELD && v ? `${k}: ${clean(v)} (attached to this email)` : `${k}: ${clean(v)}`))
    .concat([`submitted_at: ${new Date().toISOString()}`])
    .join('\n');
  // A productions inquiry is read on Scooter's phone (Scooter, 15 Nov 2026): his own layout, no
  // empty or tracking lines, a link to Inquiries. Every other site keeps its raw field list.
  const inquiry = siteForHost(host) === 'productions' ? productionsInquiryMail(fields, request.url) : null;
  const mail = {
    to,
    replyTo: email,
    subject: `${isProbe ? '[probe] ' : ''}${inquiry ? inquiry.subject : isCommunityViabilityAssessment
      ? `New Community Viability Assessment — ${clean(fields.organization) || email}`
      : `New enquiry from ${site}`}`,
    text: inquiry ? inquiry.text : `${lines}\n\nSubmitted from: ${request.url}`,
    ...(inquiry ? { html: inquiry.html } : {}),
    deckFile
  };

  // Two independent channels: Cloudflare email first (Sequoia, 6 Nov 2026), Resend only if it
  // did not deliver. A probe exercises BOTH so a dead backup is found on a quiet week.
  const delivery = await deliver(env, mail, { both: isProbe });

  if (isProbe) {
    // A channel-1 address still waiting for its verification click is a NOTE, not a failure
    // (Sequoia, 7 Nov 2026): the lead path is Resend meanwhile, and it starts working by itself
    // once the address is verified.
    const cfOk = delivery.channels.cloudflare === 'ok' || delivery.channels.cloudflare === 'unverified';
    const ok = cfOk && delivery.channels.resend === 'ok';
    console.log('lead probe', JSON.stringify({ host, channels: delivery.channels, detail: delivery.detail }));
    return json({ ok, probe: true, channels: delivery.channels, ...(delivery.unverified ? { unverified: delivery.unverified } : {}), ...(ok ? {} : { error: 'probe_failed', detail: delivery.detail }) }, ok ? 200 : 502);
  }

  const delivered = Boolean(delivery.deliveredBy);
  const bothUnconfigured = delivery.channels.cloudflare === 'not_configured' && delivery.channels.resend === 'not_configured';
  const error = delivered ? null : bothUnconfigured ? 'delivery_not_configured' : 'delivery_failed';
  // For the alarm, an unconfigured channel is a broken channel: the lead has one way out, not two.
  const alarmChannels = {};
  for (const [ch, v] of Object.entries(delivery.channels)) alarmChannels[ch] = !bothUnconfigured && v === 'not_configured' ? 'failed' : v;
  later(reportOutcome(env, {
    host, form: formName, delivered, delivered_by: delivery.deliveredBy, channels: alarmChannels,
    bot_check: botCheck, error, detail: delivery.detail
  }));

  if (!delivered) {
    console.error('lead delivery failed on every channel', JSON.stringify({ host, form: formName, channels: delivery.channels, detail: delivery.detail }));
    await dashboardKept;
    return json({ ok: false, error, sheet: await sheetWrite, bot_check: botCheck, channels: delivery.channels }, bothUnconfigured ? 503 : 502);
  }

  // The email is delivered, so the visitor succeeded. The sheet result is
  // reported, never allowed to overturn that.
  await dashboardKept;
  return json({ ok: true, sheet: await sheetWrite, bot_check: botCheck, delivered_by: delivery.deliveredBy, channels: delivery.channels }, 200);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A submission is a TEST when it came through a preview deployment (pages.dev, localhost) or its
 * name, organization or email says test (a reserved .test / example domain, or the word "test").
 */
export function isTestInquiry(fields, requestUrl) {
  const host = new URL(requestUrl).hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev')) return true;
  const email = clean(fields.email).toLowerCase();
  if (/\.test$/.test(email) || /@(?:[^@]+\.)?example\.(?:com|org|net)$/.test(email)) return true;
  return [fields.name, fields.organization, email.split('@')[0]].some((v) => /(^|[^a-z])test([^a-z]|$)/i.test(clean(v)));
}

/** "Saturday, November 15, 2026 at 3:42 PM EST": the moment it arrived, in Eastern time. */
export function easternTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}

/**
 * Scooter's inquiry email (15 Nov 2026), in his order: Name, Email (a link), Organization, Title,
 * Service, Event dates (virtual / hybrid only), Needs
 * (the choice and their own words), Timing, Heard about us, Submitted (Eastern), then Open in the
 * dashboard (Inquiries on the same site the form was sent from). Empty fields and the hidden
 * tracking fields are left out; a test submission says TEST in the subject.
 */
/**
 * Event dates from the Get in touch form, asked only when Virtual / hybrid event production is the
 * service (Scooter, 15 Nov 2026: "ask for event start and end dates and carry them into the deal").
 * Plain YYYY-MM-DD only; an end before the start is kept as typed but never reordered.
 */
export function eventDatesFrom(fields) {
  const day = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(fields[k])) ? clean(fields[k]) : '');
  const start = day('event_start');
  const end = day('event_end');
  if (!start && !end) return null;
  const say = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { start, end, words: start && end && start !== end ? `${say(start)} to ${say(end)}` : say(start || end) };
}

export function productionsInquiryMail(fields, requestUrl, now = new Date()) {
  const v = (k) => clean(fields[k]);
  const name = v('name');
  const org = v('organization') || v('company');
  const email = v('email');
  const choice = v('need_type') === 'Other' ? (v('need_other') ? `Something else: ${v('need_other')}` : 'Something else') : v('need_type');
  const needs = [choice, v('initiative') || v('message')].filter(Boolean).join(' — ');
  const heard = [v('heard_about'), v('heard_about_detail')].filter(Boolean).join(' · ');
  const dashboard = `${new URL(requestUrl).origin}/dashboard/inquiries`;
  const test = isTestInquiry(fields, requestUrl);
  const events = eventDatesFrom(fields);
  const rows = [
    ['Name', name], ['Email', email], ['Organization', org], ['Title', v('job_title')], ['Service', v('service')],
    ['Event dates', events ? events.words : ''], ['Needs', needs],
    ['Timing', v('timing')], ['Heard about us', heard], ['Submitted', easternTime(now)]
  ].filter(([, val]) => val);
  const who = [org, name].filter(Boolean).join(' - ') || email;
  const subject = `${test ? 'TEST: ' : ''}New inquiry: ${who}`;
  const text = `${test ? 'TEST SUBMISSION\n\n' : ''}${rows.map(([k, val]) => `${k}: ${val}`).join('\n')}\n\nOpen in the dashboard: ${dashboard}\n\nReply to this email to answer ${name || email} directly.`;
  const cell = (k, val) => {
    const shown = k === 'Email' ? `<a href="mailto:${escapeHtml(val)}" style="color:#c25e00">${escapeHtml(val)}</a>` : escapeHtml(val).replace(/\n/g, '<br>');
    return `<tr><td style="padding:10px 0 2px;font-size:13px;color:#6b6b6b">${k}</td></tr><tr><td style="padding:0 0 10px;font-size:17px;line-height:1.45;color:#111;border-bottom:1px solid #eee;word-break:break-word;overflow-wrap:anywhere">${shown}</td></tr>`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#fff"><div style="max-width:560px;margin:0 auto;padding:20px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + (test ? '<p style="margin:0 0 12px;padding:8px 12px;background:#fff3e0;color:#8a3c00;font-weight:700;font-size:14px;border-radius:6px">TEST SUBMISSION</p>' : '')
    + `<h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#111">New inquiry: ${escapeHtml(who)}</h1>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${rows.map(([k, val]) => cell(k, val)).join('')}</table>`
    + `<p style="margin:20px 0 8px"><a href="${escapeHtml(dashboard)}" style="display:inline-block;padding:14px 20px;background:#ff8500;color:#111;font-weight:700;font-size:16px;text-decoration:none;border-radius:8px">Open in the dashboard</a></p>`
    + `<p style="margin:12px 0 0;font-size:13px;color:#6b6b6b">Reply to this email to answer ${escapeHtml(name || email)} directly.</p></div></body></html>`;
  return { subject, text, html, test, dashboard };
}

const MAILER_URL = 'https://forms-mailer.internal';

function mailerReady(env) {
  return Boolean(env.FORMS_MAILER && typeof env.FORMS_MAILER.fetch === 'function' && clean(env.FORMS_MAILER_SECRET));
}

async function callMailer(env, path, payload) {
  return env.FORMS_MAILER.fetch(`${MAILER_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forms-mailer-secret': clean(env.FORMS_MAILER_SECRET) },
    body: JSON.stringify(payload)
  });
}

/**
 * Channel 1: the forms-mailer Worker's send_email binding.
 * 'ok' | 'failed' | 'unverified' | 'not_configured'. 'unverified' means Email Routing refused the
 * recipient because it is not (yet) a verified destination address: the Worker answers 422
 * recipient_unverified and names it, and Resend carries the lead instead.
 */
export async function sendViaCloudflare(env, mail) {
  if (!mailerReady(env)) return { status: 'not_configured', detail: 'cloudflare: FORMS_MAILER binding or FORMS_MAILER_SECRET not set' };
  try {
    const res = await callMailer(env, '/send', {
      to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}),
      ...(mail.deckFile ? { attachments: [{ filename: mail.deckFile.filename, contentBase64: bytesToBase64(mail.deckFile.bytes), type: 'application/pdf' }] } : {})
    });
    if (res.ok) return { status: 'ok' };
    const raw = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(raw); } catch { /* not JSON */ }
    if (res.status === 422 && body && body.error === 'recipient_unverified') {
      return { status: 'unverified', address: body.address || mail.to, detail: `cloudflare: ${body.address || mail.to} is not a verified Email Routing destination address yet` };
    }
    return { status: 'failed', detail: `cloudflare: ${res.status} ${raw.slice(0, 200)}` };
  } catch (err) {
    return { status: 'failed', detail: `cloudflare: ${String(err).slice(0, 200)}` };
  }
}

/** Channel 2: Resend. 'ok' | 'failed' | 'not_configured'. */
export async function sendViaResend(env, mail) {
  const apiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM);
  if (!apiKey || !from) return { status: 'not_configured', detail: 'resend: RESEND_API_KEY or EMAIL_FROM not set' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [mail.to],
        reply_to: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        ...(mail.deckFile ? { attachments: [{ filename: mail.deckFile.filename, content: bytesToBase64(mail.deckFile.bytes) }] } : {})
      })
    });
    if (res.ok) return { status: 'ok' };
    return { status: 'failed', detail: `resend: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` };
  } catch (err) {
    return { status: 'failed', detail: `resend: ${String(err).slice(0, 200)}` };
  }
}

/**
 * Channel 1 sends to FORMS_PROBE_CF_TO, the one address that is a verified Email Routing
 * destination (vault WP_FORMS_PROBE_CF_TO; never committed), because Cloudflare email reaches
 * nothing else (7 Nov 2026: LEAD_TO had been added as a destination on 6 Nov but never verified,
 * so every submission's Cloudflare leg failed with "destination address is not a verified
 * address"; Sequoia: send channel 1 to that verified address instead). When that address is not
 * LEAD_TO, Resend ALSO sends to LEAD_TO, so the lead recipient gets every lead unchanged.
 * Without FORMS_PROBE_CF_TO, channel 1 tries LEAD_TO itself.
 */
async function deliver(env, mail, { both = false } = {}) {
  const channels = { cloudflare: 'not_configured', resend: 'skipped' };
  const details = [];
  let deliveredBy = null;
  const cfTo = parseAddressList(env.FORMS_PROBE_CF_TO)[0] || mail.to;
  const cf = await sendViaCloudflare(env, { ...mail, to: cfTo });
  channels.cloudflare = cf.status;
  if (cf.detail) details.push(cf.detail);
  if (cf.status === 'ok') deliveredBy = 'cloudflare';
  const alsoResend = both || cfTo.toLowerCase() !== String(mail.to).toLowerCase();
  if (!deliveredBy || alsoResend) {
    const rs = await sendViaResend(env, mail);
    channels.resend = rs.status;
    if (rs.detail) details.push(rs.detail);
    if (rs.status === 'ok' && !deliveredBy) deliveredBy = 'resend';
  }
  return { channels, deliveredBy, detail: details.join(' | '), ...(cf.address ? { unverified: cf.address } : {}) };
}

/**
 * Hand one outcome to the forms-mailer Worker, which keeps the incident records and sends the
 * alarm / "fixed" emails. If the Worker cannot be reached and something is wrong, the alarm goes
 * out from here through Resend instead (deduped per code per hour, per data centre).
 */
export async function reportOutcome(env, outcome) {
  const incidents = incidentsFor(outcome);
  if (mailerReady(env)) {
    try {
      const res = await callMailer(env, '/report', outcome);
      if (res.ok) return 'reported';
      outcome = { ...outcome, detail: `${outcome.detail || ''} | report: ${res.status}` };
    } catch (err) {
      outcome = { ...outcome, detail: `${outcome.detail || ''} | report: ${String(err).slice(0, 120)}` };
    }
  }
  if (!incidents.length) return 'nothing_to_report';
  const codes = [...incidents, 'mailer_unreachable'];
  let sent = 0;
  for (const code of codes) {
    if (!(await claimDirectAlarm(code))) continue;
    const mail = alarmEmail({ code, record: { first_seen: 'unknown (the alarm Worker could not be reached, so no history)', count: 'at least 1', delivered: outcome.delivered ? 'at least 1' : 0, lost: outcome.delivered ? 0 : 'at least 1', last_detail: outcome.detail }, outcome });
    for (const to of parseAddressList(env.FORMS_ALARM_TO)) {
      const r = await sendViaResend(env, { to, subject: mail.subject, text: mail.text });
      if (r.status === 'ok') sent += 1;
      else console.error('lead alarm could not be sent', JSON.stringify({ code, detail: r.detail }));
    }
  }
  if (!parseAddressList(env.FORMS_ALARM_TO).length) console.error('lead alarm NAMED_STOP=FORMS_ALARM_TO_MISSING', JSON.stringify({ incidents }));
  return sent ? 'alarmed_direct' : 'alarm_not_sent';
}

/** At most one direct alarm per code per hour (Cache API, per data centre; no cache = send). */
async function claimDirectAlarm(code) {
  const cache = globalThis.caches?.default;
  if (!cache) return true;
  const slot = Math.floor(Date.now() / ALARM_INTERVAL_MS);
  const key = new Request(`https://lead-alarm.invalid/${code}/${slot}`);
  try {
    if (await cache.match(key)) return false;
    await cache.put(key, new Response('1', { headers: { 'cache-control': `max-age=${ALARM_INTERVAL_MS / 1000}` } }));
  } catch { /* a failing cache never silences an alarm */ }
  return true;
}

// A GET should say what this endpoint is rather than 404, so the next person
// checking whether it exists gets an answer.
export function onRequestGet({ request, env } = {}) {
  const body = { ok: false, error: 'method_not_allowed', hint: 'POST a contact form here' };
  let host = '';
  try { host = new URL(request.url).hostname; } catch { /* no request: bare probe */ }
  if (host && botChecksApply(host)) {
    body.bot_check = turnstileConfigured(env || {}) ? 'ok' : 'not_configured';
    // The site key is public by design; the page needs it to render the widget.
    if (turnstileConfigured(env || {})) body.turnstile_site_key = clean(env.TURNSTILE_SITE_KEY);
  }
  return json(body, 405);
}
