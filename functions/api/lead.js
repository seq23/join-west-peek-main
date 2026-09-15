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

function clean(value) {
  return String(value ?? '').slice(0, MAX_FIELD).trim();
}

function looksLikeEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
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
  if (HONEYPOT_FIELDS.some((key) => clean(fields[key]))) return json({ ok: true }, 200);

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

  if (!apiKey || !from) {
    // Deliberately not 200. The form falls back to a visible email prompt.
    return json({ ok: false, error: 'delivery_not_configured' }, 503);
  }

  const site = new URL(request.url).hostname;
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
      return json({ ok: false, error: 'delivery_failed' }, 502);
    }
  } catch (err) {
    console.error('lead delivery threw', String(err).slice(0, 300));
    return json({ ok: false, error: 'delivery_failed' }, 502);
  }

  return json({ ok: true }, 200);
}

// A GET should say what this endpoint is rather than 404, so the next person
// checking whether it exists gets an answer.
export function onRequestGet() {
  return json({ ok: false, error: 'method_not_allowed', hint: 'POST a contact form here' }, 405);
}
