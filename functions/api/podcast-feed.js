/**
 * The podcast's published episodes, read from its own RSS feed (Scooter, 27 Nov 2026: "Can the site
 * read published episodes from it, so a new release doesn't need a separate email to you?").
 *
 * A browser cannot read the anchor.fm feed directly (no CORS), so this is a server-side fetch,
 * cached 15 minutes. It answers { ok, items: [{ guid, title, date, link, image, description }] },
 * newest first. On any failure it answers ok:false with no items, and the site shows exactly what
 * sites/community/assets/data/episodes.json says.
 *
 * episodes.json stays the record and always wins (community.js does the matching): a record is
 * matched by its `feedGuid`, else by the guest's name appearing in the feed title; a matched record
 * gains a "Listen on Spotify" link; a feed item with no record shows with the feed's own title, date
 * and artwork, linking to the episode on Spotify, until its record is added. The feed never releases
 * a record that is still "coming soon" (only a YouTube id in the record does that).
 *
 * The feed numbers every episode "1", so episode numbers never come from it.
 */
export const FEED_URL = 'https://anchor.fm/s/1010e60d0/podcast/rss';
const CACHE_TTL_SECONDS = 900;
const MAX_ITEMS = 50;
const MAX_TEXT = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
/** Plain text: tags stripped, whitespace collapsed, clipped. Never HTML into the page. */
function plain(s, max = MAX_TEXT) {
  return decode(decode(s)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function tag(item, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  return m ? m[1] : '';
}
/** Only an https link survives; anything else is dropped rather than put into an href. */
function httpsOnly(u) {
  const v = decode(u).trim();
  try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
}

export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const title = plain(tag(it, 'title'), 300);
    const guid = plain(tag(it, 'guid'), 200);
    const date = Date.parse(plain(tag(it, 'pubDate'), 80));
    if (!title || !guid) continue;
    const image = httpsOnly((/<itunes:image[^>]*href="([^"]+)"/i.exec(it) || [])[1] || '');
    items.push({
      guid,
      title,
      date: Number.isNaN(date) ? null : new Date(date).toISOString(),
      link: httpsOnly(plain(tag(it, 'link'), 500)),
      image,
      description: plain(tag(it, 'description') || tag(it, 'itunes:summary')),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` },
  });
}

export async function onRequestGet({ request }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/podcast-feed', request.url).toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let result;
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/rss+xml, application/xml' } });
    if (!res.ok) throw new Error(`feed responded ${res.status}`);
    const xml = await res.text();
    if (!/<rss[\s>]/i.test(xml)) throw new Error('feed answered something that is not RSS');
    result = { ok: true, items: parseFeed(xml) };
  } catch (err) {
    console.error('podcast feed read failed', String(err).slice(0, 300));
    result = { ok: false, items: [] };
  }
  const response = json(result);
  await cache.put(cacheKey, response.clone());
  return response;
}
