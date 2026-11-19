#!/usr/bin/env node
/**
 * live-links: the links Scooter gets back once the three sites are live
 * ("Please reply with the live links once complete", 19 Nov 2026), each one
 * fetched and checked, so the reply carries only links that were seen working.
 *
 *   npm run live-links                       # the three production hosts
 *   npm run live-links -- --url https://<branch>.<project>.pages.dev [--url …]
 *   (or LIVE_LINKS_URL; several URLs separated by " · ", commas or spaces)
 *
 * For each host it tells the site from the host name, then fetches the home
 * page, /privacy and (Productions) /work, /what-we-do, /about, /get-in-touch,
 * and fails on: a non-200; not exactly one gtag.js tag with that site's GA4 ID;
 * another site's ID; Microsoft Clarity or any other tracker; and, on
 * Productions, a favicon that is not the WP mark, a link preview that is not
 * the "We make people care" card (or an image that does not load), or the old
 * preview/client-permission line. Every link checked is printed, one per line.
 * Prints `LIVE_LINKS OK <n> links` when all passed; exits 1 otherwise, and 2
 * (NAMED STOP no_hosts) when it was given nothing to check.
 */

const PROD = {
  productions: "https://westpeekproductions.com",
  ventures: "https://westpeek.ventures",
  community: "https://joinwestpeek.com",
};
const GA = { productions: "G-17BHLS1RWJ", community: "G-X0CDKY3DXT", ventures: "G-Y7371XLG0L" };
const PAGES = {
  productions: ["/", "/work", "/what-we-do", "/about", "/get-in-touch", "/privacy"],
  ventures: ["/", "/privacy"],
  community: ["/", "/privacy"],
};
const TRACKERS = /clarity\.ms|googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+|connect\.facebook\.net|static\.hotjar\.com|snap\.licdn\.com|analytics\.tiktok\.com|plausible\.io|cdn\.segment\.com/i;

function siteOf(host) {
  if (/productions/.test(host)) return "productions";
  if (/ventures/.test(host)) return "ventures";
  if (/community|joinwestpeek/.test(host)) return "community";
  return null;
}

function hostsFromArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--url" && argv[i + 1]) out.push(argv[++i]);
  if (!out.length && process.env.LIVE_LINKS_URL) out.push(...process.env.LIVE_LINKS_URL.split(/\s*·\s*|[,\s]+/).filter(Boolean));
  return out.length ? out : Object.values(PROD);
}

async function get(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "west-peek-live-links" } });
  return { status: r.status, body: r.headers.get("content-type")?.includes("text") ? await r.text() : "" };
}

export function checkPage(site, html) {
  const errs = [];
  const id = GA[site];
  const tags = html.match(/googletagmanager\.com\/gtag\/js\?id=G-[A-Z0-9]+/g) || [];
  if (tags.length !== 1 || !tags[0].endsWith(id)) errs.push(`expected exactly one GA4 tag ${id}, saw ${tags.length ? tags.join(",") : "none"}`);
  for (const [other, oid] of Object.entries(GA)) if (other !== site && html.includes(oid)) errs.push(`carries ${other}'s GA4 ID`);
  const t = html.match(TRACKERS);
  if (t) errs.push(`other tracking present (${t[0]})`);
  if (site === "productions") {
    if (!/<link rel="icon"[^>]*href="\/assets\/img\/favicon-32\.png"/.test(html)) errs.push("favicon is not the WP mark");
    if (!/<meta property="og:image" content="[^"]*og-we-make-people-care\.png"/.test(html)) errs.push("link preview is not the WP 'We make people care' card");
    if (/client-permission|preview-banner|preview only/i.test(html)) errs.push("preview/client-permission line still on the page");
  }
  return errs;
}

async function main() {
  const hosts = hostsFromArgs(process.argv.slice(2));
  let failed = 0, links = 0;
  for (const raw of hosts) {
    const base = raw.replace(/\/+$/, "");
    const site = siteOf(new URL(base).host);
    if (!site) { console.log(`FAIL ${base} — cannot tell which site this host is`); failed++; continue; }
    for (const path of PAGES[site]) {
      const url = base + path;
      links++;
      let res;
      try { res = await get(url); } catch (e) { console.log(`FAIL ${url} — ${e.message}`); failed++; continue; }
      const errs = res.status === 200 ? checkPage(site, res.body) : [`status ${res.status}`];
      if (site === "productions" && path === "/" && res.status === 200) {
        const og = (res.body.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
        const ogUrl = og && base + new URL(og).pathname;
        const ogRes = ogUrl ? await fetch(ogUrl) : null;
        if (!ogRes || ogRes.status !== 200) errs.push(`link preview image ${ogUrl || "(none)"} → ${ogRes?.status ?? "missing"}`);
        const fav = await fetch(base + "/assets/img/favicon-32.png");
        if (fav.status !== 200) errs.push(`favicon → ${fav.status}`);
      }
      if (errs.length) { failed++; console.log(`FAIL ${url} — ${errs.join("; ")}`); }
      else console.log(`ok   ${url} — 200, one GA4 tag ${GA[site]}, no other tracking`);
    }
  }
  if (!links) { console.log("NAMED STOP no_hosts — nothing to check"); process.exit(2); }
  if (failed) { console.log(`LIVE_LINKS FAILED ${failed} of ${links}`); process.exit(1); }
  console.log(`LIVE_LINKS OK ${links} links`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
