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

const MAX_FIELD = 5000;
const REQUIRED = ['email'];

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

/** How long the sheet write may take before the visitor stops waiting for it. */
const INTAKE_TIMEOUT_MS = 5000;

function clean(value) {
  return String(value ?? '').slice(0, MAX_FIELD).trim();
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
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

  if (!url || !secret) {
    console.error('lead sheet write not configured', JSON.stringify({ site, form, has_url: Boolean(url), has_secret: Boolean(secret) }));
    return 'not_configured';
  }

  // One id per submission, so a retry of this call cannot create a second row.
  const submissionId = `sub_${Date.now()}_${crypto.randomUUID()}`;
  const payload = { submission_id: submissionId, host: site, form };
  for (const [key, value] of Object.entries(fields)) {
    if (HONEYPOT_FIELDS.includes(key)) continue;
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

export async function onRequestPost({ request, env }) {
  let fields = {};
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      fields = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) fields[k] = typeof v === 'string' ? v : '';
    }
  } catch {
    return json({ ok: false, error: 'unreadable_body' }, 400);
  }

  // A bot filling a genuinely hidden field is the cheapest possible filter.
  // Answer 200 so it does not learn anything, and drop the message. Only names
  // in HONEYPOT_FIELDS may trigger this: a field a human can see and was asked
  // to fill in must never be able to discard their submission.
  if (HONEYPOT_FIELDS.some((key) => clean(fields[key]))) return json({ ok: true, sheet: 'skipped' }, 200);

  const email = clean(fields.email);
  for (const key of REQUIRED) {
    if (!clean(fields[key])) return json({ ok: false, error: `missing_${key}` }, 400);
  }
  if (!looksLikeEmail(email)) return json({ ok: false, error: 'invalid_email' }, 400);

  const leadSource = clean(fields.lead_source);
  const isCommunityViabilityAssessment = leadSource === 'community_viability_assessment';
  const to = isCommunityViabilityAssessment
    ? clean(env.COMMUNITY_ASSESSMENT_TO) || 'scooter@westpeek.ventures'
    : clean(env.LEAD_TO) || 'scooter@westpeek.ventures';
  const from = clean(env.EMAIL_FROM);
  const apiKey = clean(env.RESEND_API_KEY);
  const site = new URL(request.url).hostname;

  // The sheet write starts now and is awaited at the end, so it runs alongside
  // the email rather than after it. It is started even when Resend is
  // unconfigured: the person still belongs in the network sheet, and losing
  // them because a mail key is missing would be a second failure caused by the
  // first.
  const sheetWrite = addToNetworkSheet(fields, env, request, site);

  if (!apiKey || !from) {
    // Deliberately not 200. The form falls back to a visible email prompt.
    return json({ ok: false, error: 'delivery_not_configured', sheet: await sheetWrite }, 503);
  }

  // Only the traps are stripped from the notification. company_website is real
  // founder-supplied data the fund wants, so it stays in the email body.
  const lines = Object.entries(fields)
    .filter(([k]) => !HONEYPOT_FIELDS.includes(k))
    .map(([k, v]) => `${k}: ${clean(v)}`)
    .concat([`submitted_at: ${new Date().toISOString()}`])
    .join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: isCommunityViabilityAssessment
          ? `New Community Viability Assessment — ${clean(fields.organization) || email}`
          : `New enquiry from ${site}`,
        text: `${lines}\n\nSubmitted from: ${request.url}`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('lead delivery failed', res.status, detail.slice(0, 300));
      return json({ ok: false, error: 'delivery_failed', sheet: await sheetWrite }, 502);
    }
  } catch (err) {
    console.error('lead delivery threw', String(err).slice(0, 300));
    return json({ ok: false, error: 'delivery_failed', sheet: await sheetWrite }, 502);
  }

  // The email is delivered, so the visitor succeeded. The sheet result is
  // reported, never allowed to overturn that.
  return json({ ok: true, sheet: await sheetWrite }, 200);
}

// A GET should say what this endpoint is rather than 404, so the next person
// checking whether it exists gets an answer.
export function onRequestGet() {
  return json({ ok: false, error: 'method_not_allowed', hint: 'POST a contact form here' }, 405);
}
