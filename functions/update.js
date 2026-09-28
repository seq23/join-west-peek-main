/**
 * Gates The Update form on joinwestpeek.com to its quarterly window.
 *
 * The site is a static build that ships once and serves for months, so the
 * only way for the form to be genuinely ABSENT from the page before the
 * window opens - not just hidden by CSS, which still puts every question on
 * the wire for anyone who looks - is to strip it server-side, per request,
 * before the static HTML reaches the visitor. sites/community/update.html
 * marks the form with <!-- UPDATE_FORM_START --> / <!-- UPDATE_FORM_END -->;
 * this reads the built page through the Pages static asset binding and
 * slices between those markers when the window is closed.
 *
 * *.pages.dev preview hosts always get the form (Scooter needs to see it on
 * the preview link the night this ships, before Oct 1) - see the plan, "Show
 * me that form".
 *
 * The window: opens 2026-10-01T00:00:00 America/New_York, stays open through
 * 2026-10-31T23:59:59 America/New_York, then closes until the next quarter
 * opens (2027-01-01T00:00:00 America/New_York). Both October boundaries fall
 * in EDT (UTC-4); the next-open date falls in EST (UTC-5) - hand-converted
 * below rather than pulling in a timezone library for three fixed instants.
 */
const OPENS_AT = Date.parse('2026-10-01T04:00:00Z');   // Oct 1 2026 00:00 ET (EDT, UTC-4)
const CLOSES_AT = Date.parse('2026-11-01T03:59:59Z');  // Oct 31 2026 23:59:59 ET (EDT, UTC-4)

const START_MARKER = '<!-- UPDATE_FORM_START -->';
const END_MARKER = '<!-- UPDATE_FORM_END -->';

export async function onRequestGet({ request, env }) {
  const res = await env.ASSETS.fetch(request);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return res;

  const host = new URL(request.url).hostname;
  if (host.endsWith('.pages.dev')) return res; // preview: always show, per Scooter

  const now = Date.now();
  if (now >= OPENS_AT && now <= CLOSES_AT) return res; // window open: ship as-is

  const html = await res.text();
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return res; // markers missing: fail open rather than corrupt the page

  const stripped = html.slice(0, start) + html.slice(end + END_MARKER.length);
  return new Response(stripped, res);
}
