/**
 * Reads West Peek Community's public Luma calendar and reports whether any
 * workshop is still upcoming, so sites/community/workshops.html can hide the
 * "Upcoming" section when the calendar is empty rather than show a stale or
 * fabricated list.
 *
 * A browser cannot read Luma's ICS feed directly (no CORS), so this has to be
 * a server-side fetch - the reason it is a shared Pages Function rather than
 * client-only JS. Cached 15 minutes with the platform Cache API (no KV/R2/D1
 * binding exists in this repo, and none is needed for a public, cache-safe
 * read like this one).
 *
 * Fails closed: any fetch or parse error reports hasUpcoming:false rather
 * than guessing, because showing an empty or wrong "Upcoming" section is
 * worse than not showing one at all.
 */
const ICS_URL = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-xCKjrj2krXtyqGh';
const CACHE_TTL_SECONDS = 900; // 15 minutes

function parseIcsEvents(ics) {
  const events = [];
  const blocks = ics.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const dtstart = (body.match(/DTSTART[^:]*:(\d{8}T\d{6}Z?)/) || [])[1];
    const summary = (body.match(/SUMMARY:(.*)/) || [])[1];
    if (!dtstart) continue;
    const iso = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}T${dtstart.slice(9, 11)}:${dtstart.slice(11, 13)}:${dtstart.slice(13, 15)}Z`;
    const start = Date.parse(iso);
    if (Number.isNaN(start)) continue;
    events.push({ title: (summary || '').trim(), start });
  }
  return events;
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` },
  });
}

export async function onRequestGet({ request }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/workshops', request.url).toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let result;
  try {
    const res = await fetch(ICS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`luma responded ${res.status}`);
    const ics = await res.text();
    const events = parseIcsEvents(ics);
    const now = Date.now();
    const upcoming = events.filter((e) => e.start > now).sort((a, b) => a.start - b.start);
    result = { ok: true, hasUpcoming: upcoming.length > 0, upcoming };
  } catch (err) {
    console.error('workshops feed read failed', String(err).slice(0, 300));
    result = { ok: false, hasUpcoming: false, upcoming: [] };
  }

  const response = json(result);
  await cache.put(cacheKey, response.clone());
  return response;
}
