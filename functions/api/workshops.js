/**
 * Reads West Peek Community's public Luma calendar and returns the workshops still to come, for the
 * /workshops page and the homepage Workshops tile (Scooter, 27 Nov 2026: "Can the tile show title,
 * date and registration link from that feed?").
 *
 * A browser cannot read Luma's ICS feed directly (no CORS), so this is a server-side fetch, cached
 * 15 minutes with the platform Cache API. Luma's feed is read fresh on each of our reads past that
 * cache, so a new Luma event reaches the site within about 15 minutes of Luma publishing it.
 *
 * Each upcoming event carries { title, start, end, url } (start/end in ms since the epoch; url is the
 * event's own Luma page, where people register). An event stays listed until it ENDS, so one in
 * progress still shows, and it drops off within the 15-minute cache after it ends.
 *
 * Fails closed: any fetch or parse error answers ok:false with no events rather than guessing. The
 * page and the tile then show "Coming soon" with the Luma calendar link, never an empty box.
 */
const ICS_URL = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-xCKjrj2krXtyqGh';
export const CALENDAR_URL = 'https://luma.com/westpeekcommunity';
const CACHE_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_LENGTH_MS = 2 * 3600 * 1000; // an event with no end time is treated as two hours long

/** ICS text escapes: \n, \, \; \\ */
function unescapeText(v) {
  return String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

/** Offset (ms) of an IANA zone at a given instant, from Intl, so a TZID local time becomes UTC. */
function zoneOffsetMs(zone, utcMs) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .reduce((o, p) => ((o[p.type] = p.value), o), {});
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return asUtc - utcMs;
  } catch {
    return 0;
  }
}

/** One ICS date property (DTSTART/DTEND with its parameters) → ms, or NaN. */
function parseIcsDate(params, value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (z) return naive;
  const tz = (/TZID=([^;:]+)/i.exec(params || '') || [])[1];
  if (!tz) return naive; // floating time: read as UTC rather than guess the visitor's zone
  // Two passes settle the offset across a clock change.
  let t = naive - zoneOffsetMs(tz, naive);
  t = naive - zoneOffsetMs(tz, t);
  return t;
}

/** The event's own Luma page: URL:, else the first lu.ma / luma.com link in LOCATION or DESCRIPTION. */
function eventUrl(props) {
  const candidates = [props.URL, props.LOCATION, props.DESCRIPTION].filter(Boolean).map(unescapeText);
  for (const c of candidates) {
    const m = /https:\/\/(?:lu\.ma|luma\.com)\/[A-Za-z0-9_\-/?=&.%]+/.exec(c);
    if (m) return m[0].replace(/[.,)]+$/, '');
  }
  return null;
}

export function parseIcsEvents(ics) {
  // Unfold continuation lines (RFC 5545: a line starting with a space or tab continues the last).
  const text = String(ics || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const props = {};
    const params = {};
    for (const line of body.split('\n')) {
      const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
      if (!m || props[m[1]] !== undefined) continue;
      props[m[1]] = m[3];
      params[m[1]] = m[2];
    }
    const start = parseIcsDate(params.DTSTART, props.DTSTART);
    if (Number.isNaN(start)) continue;
    let end = parseIcsDate(params.DTEND, props.DTEND);
    if (Number.isNaN(end) || end < start) end = start + DEFAULT_LENGTH_MS;
    events.push({ title: unescapeText(props.SUMMARY), start, end, url: eventUrl(props) });
  }
  return events;
}

/** Events that have not ended yet, soonest first. */
export function upcomingEvents(events, now = Date.now()) {
  return events.filter((e) => e.end > now).sort((a, b) => a.start - b.start);
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
    if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('luma answered something that is not a calendar');
    const upcoming = upcomingEvents(parseIcsEvents(ics));
    result = { ok: true, hasUpcoming: upcoming.length > 0, upcoming, calendar: CALENDAR_URL };
  } catch (err) {
    console.error('workshops feed read failed', String(err).slice(0, 300));
    result = { ok: false, hasUpcoming: false, upcoming: [], calendar: CALENDAR_URL };
  }

  const response = json(result);
  await cache.put(cacheKey, response.clone());
  return response;
}
