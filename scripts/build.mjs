import fs from "node:fs";
import path from "node:path";
import { SERVICES } from "../functions/_lib/services.mjs";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/build.mjs <ventures|productions|community>");
  process.exit(1);
}

const root = process.cwd();
const src = path.join(root, "sites", target);
const out = path.join(root, "dist", target);
const sharedAssets = path.join(root, "shared", "assets");

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function fail(msg){ console.error(msg); process.exit(1); }

if (!exists(src)) fail(`Missing source directory: ${src}`);
if (!exists(sharedAssets)) fail(`Missing shared assets directory: ${sharedAssets}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

copyRecursive(src, out);

// Give and Take submissions are closed for the first launch (Scooter, 28 Nov 2026: "show 'Opening
// soon' and no form ... keep the form built behind it"). The source pages keep the ask box, the board
// and the offer form between <!--GT:open--> and <!--/GT:open-->, and the "Opening soon" block between
// <!--GT:closed--> and <!--/GT:closed-->; GIVE_TAKE_OPEN (functions/_lib/give-take.mjs, the same
// switch lead.js obeys) decides which one the built page carries. The other block is removed whole.
if (target === "community") {
  const { GIVE_TAKE_OPEN } = await import("../functions/_lib/give-take.mjs");
  const drop = GIVE_TAKE_OPEN ? "closed" : "open";
  const keep = GIVE_TAKE_OPEN ? "open" : "closed";
  let pages = 0;
  for (const name of fs.readdirSync(out)) {
    if (!name.endsWith(".html")) continue;
    const abs = path.join(out, name);
    const html = fs.readFileSync(abs, "utf8");
    if (!html.includes("<!--GT:")) continue;
    const opens = (html.match(/<!--GT:(open|closed)-->/g) || []).length;
    const closes = (html.match(/<!--\/GT:(open|closed)-->/g) || []).length;
    if (opens !== closes) fail(`community/${name}: unbalanced <!--GT:…--> markers (${opens} open, ${closes} close)`);
    let next = html.replace(new RegExp(`<!--GT:${drop}-->[\\s\\S]*?<!--/GT:${drop}-->`, "g"), "");
    next = next.replaceAll(`<!--GT:${keep}-->`, "").replaceAll(`<!--/GT:${keep}-->`, "");
    if (next.includes("<!--GT:") || next.includes("<!--/GT:")) fail(`community/${name}: a <!--GT:…--> marker survived the build`);
    if (!GIVE_TAKE_OPEN && /give_and_take_(ask|offer)/.test(next)) fail(`community/${name}: Give and Take is closed but the built page still carries an ask or offer form`);
    fs.writeFileSync(abs, next);
    pages++;
  }
  if (!pages) fail("community: no page carries a <!--GT:…--> block; the Give and Take switch would decide nothing");
  console.log(`give and take: submissions ${GIVE_TAKE_OPEN ? "OPEN" : "CLOSED (Opening soon, no form)"} on ${pages} page(s)`);
}

// West Peek Productions' six services come from ONE list (functions/_lib/services.mjs), shared with
// the dashboard (Scooter, 15 Nov 2026: "same list on the site and the dashboard picker"). Pages carry
// markers; the build writes the list in, so the site can never drift from the dashboard.
if (target === "productions") {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const grid = SERVICES.map((s) => `<li id="${s.id}"><button type="button" class="wpp-capgrid__btn" aria-expanded="false" aria-controls="cap-${s.id}">${s.icon}<span>${esc(s.name)}</span></button><p id="cap-${s.id}" class="wpp-capgrid__desc">${esc(s.line)}</p></li>`).join("\n        ");
  const options = SERVICES.map((s) => `<option value="${esc(s.name)}"${s.events ? " data-events" : ""}>${esc(s.name)}</option>`).join("\n            ");
  let marked = 0;
  for (const name of fs.readdirSync(out)) {
    if (!name.endsWith(".html")) continue;
    const abs = path.join(out, name);
    const html = fs.readFileSync(abs, "utf8");
    if (!html.includes("<!--SERVICES:")) continue;
    fs.writeFileSync(abs, html.replaceAll("<!--SERVICES:grid-->", grid).replaceAll("<!--SERVICES:options-->", options));
    marked += 1;
  }
  if (!marked) fail("productions: no page carries a <!--SERVICES:…--> marker; the six services would be missing from the site");
  console.log(`services: wrote the ${SERVICES.length} services into ${marked} page(s)`);
}

// Per-episode pages for community: one template + episodes.json, not one
// hand-written file per guest, so a new episode is a JSON row rather than a
// page somebody has to remember to write. Generated before the 404/schema/
// sitemap passes below so an episode page gets the same treatment as any
// other page (Organization schema, sitemap entry, dated lastmod).
if (target === "community") {
  const templatePath = path.join(src, "episode-template.html");
  const episodesPath = path.join(src, "assets", "data", "episodes.json");
  if (exists(templatePath) && exists(episodesPath)) {
    const template = fs.readFileSync(templatePath, "utf8");
    // Newest first, by episode number (Scooter, 27 Nov 2026: "Order, newest first"). The order of
    // rows in episodes.json never decides it; community.js sorts the /episodes grid the same way.
    const episodes = JSON.parse(fs.readFileSync(episodesPath, "utf8")).sort((a, b) => b.number - a.number);
    const numbers = episodes.map((e) => e.number);
    if (new Set(numbers).size !== numbers.length) fail(`community episodes: two episodes share a number (${numbers.join(", ")})`);
    const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    // "Coming Monday, Nov 30" while the release date is ahead; community.js turns it back into
    // "Coming soon" on the visitor's screen once the date has passed and there is still no video,
    // so a built page can never show a date in the past.
    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const soonLabel = (ep) => {
      if (!ep.releaseDate) return "Coming soon";
      if (!DAY_RE.test(ep.releaseDate)) fail(`community episode "${ep.guest}": releaseDate must be YYYY-MM-DD`);
      const d = new Date(`${ep.releaseDate}T12:00:00Z`);
      return `Coming ${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}`;
    };
    const releaseAttr = (ep) => (ep.releaseDate ? ` data-release-date="${esc(ep.releaseDate)}"` : "");
    const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    // A guest with no headshot yet gets a marked initials tile, never a guessed photo.
    const photoTag = (ep, cls) => ep.headshot
      ? `<img class="${cls}" src="/${esc(ep.headshot)}" alt="${esc(ep.headshotAlt || ep.guest)}" loading="lazy">`
      : `<div class="${cls} wpc-initials" role="img" aria-label="${esc(ep.guest)}: headshot to come"><span>${esc(initials(ep.guest))}</span><small>Headshot to come</small></div>`;
    const videoBlock = (ep) => ep.youtube
      ? `      <div class="wpc-card__player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ep.youtube)}" title="${esc(ep.guest)} on Good People Should Meet Good People" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `      <div class="wpc-card__soon"${releaseAttr(ep)} data-soon-label>${esc(soonLabel(ep))}</div>`;
    const synopsisBlock = (ep) => ep.synopsis
      ? `<p>${esc(ep.synopsis)}</p>`
      : `<p class="wpc-placeholder-line">Synopsis to come${ep.youtube ? "; watch the episode above" : ""}.</p>`;
    const numberLine = (ep) => `Episode ${ep.number}${ep.youtube ? "" : ` &middot; <span${releaseAttr(ep)} data-soon-label>${esc(soonLabel(ep))}</span>`}`;
    const otherEpisodeCard = (ep) =>
      `      <a class="wpc-card" href="/episodes/${esc(ep.slug)}/">${photoTag(ep, "wpc-card__photo")}<div class="wpc-card__body"><p class="wpc-card__number">${numberLine(ep)}</p><h3 class="wpc-card__name">${esc(ep.guest)}</h3></div></a>`;

    for (const ep of episodes) {
      if (!ep.slug) fail(`community episode "${ep.guest}" has no slug; cannot generate /episodes/${"<slug>"}`);
      const others = episodes.filter((e) => e.slug !== ep.slug).map(otherEpisodeCard).join("\n");
      const page = template
        .replaceAll("{{SLUG}}", esc(ep.slug))
        .replaceAll("{{NUMBER}}", esc(ep.number))
        .replaceAll("{{GUEST}}", esc(ep.guest))
        .replaceAll("{{TITLE}}", esc(ep.title))
        .replaceAll("{{FEED_GUID}}", esc(ep.feedGuid || ""))
        .replace("{{PHOTO}}", photoTag(ep, "wpc-episode__img"))
        .replace("{{SYNOPSIS_BLOCK}}", synopsisBlock(ep))
        .replace("{{VIDEO_BLOCK}}", videoBlock(ep))
        .replace("{{OTHER_EPISODES}}", others);
      if (/\{\{[A-Z_]+\}\}/.test(page)) fail(`community episode "${ep.slug}": template marker left unfilled: ${page.match(/\{\{[A-Z_]+\}\}/)[0]}`);
      const outDir = path.join(out, "episodes", ep.slug);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "index.html"), page);
    }
    // The template itself is source, not a page - it has no real content and
    // must not ship or show up in the sitemap.
    fs.rmSync(path.join(out, "episode-template.html"), { force: true });
    console.log(`episodes: generated ${episodes.length} page(s) under /episodes/<slug>`);
  }

  // Past workshops get the same treatment as episodes: one template, not one
  // hand-written file per workshop, and the same reorienting layout (flyer
  // left, recording right, the rest in a row underneath) Scooter asked for
  // ("list the workshops the same way as the podcast episodes").
  const workshopTemplatePath = path.join(src, "workshop-template.html");
  const workshopsPath = path.join(src, "assets", "data", "workshops.json");
  if (exists(workshopTemplatePath) && exists(workshopsPath)) {
    const template = fs.readFileSync(workshopTemplatePath, "utf8");
    const workshops = JSON.parse(fs.readFileSync(workshopsPath, "utf8"));
    const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const videoBlock = (w) => w.youtube
      ? `      <div class="wpc-card__player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(w.youtube)}" title="${esc(w.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : `      <div class="wpc-card__soon">Recording coming soon</div>`;
    const otherWorkshopCard = (w) =>
      `      <a class="wpc-card" href="/workshops/${esc(w.slug)}/"><img class="wpc-card__photo" src="/${esc(w.flyer)}" alt="${esc(w.flyerAlt || w.title)}" loading="lazy"><div class="wpc-card__body"><h3 class="wpc-card__name">${esc(w.title)}</h3></div></a>`;

    for (const w of workshops) {
      if (!w.slug) fail(`community workshop "${w.title}" has no slug; cannot generate /workshops/${"<slug>"}`);
      const others = workshops.filter((o) => o.slug !== w.slug).map(otherWorkshopCard).join("\n");
      const page = template
        .replaceAll("{{SLUG}}", esc(w.slug))
        .replaceAll("{{TITLE}}", esc(w.title))
        .replaceAll("{{GUEST}}", esc(w.guest))
        .replaceAll("{{FLYER}}", esc(w.flyer))
        .replaceAll("{{FLYER_ALT}}", esc(w.flyerAlt || w.title))
        .replace("{{VIDEO_BLOCK}}", videoBlock(w))
        .replace("{{OTHER_WORKSHOPS}}", others);
      const outDir = path.join(out, "workshops", w.slug);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "index.html"), page);
    }
    fs.rmSync(path.join(out, "workshop-template.html"), { force: true });
    console.log(`workshops: generated ${workshops.length} page(s) under /workshops/<slug>`);
  }
}

// A real 404. Without a 404.html in the output, Cloudflare Pages answers 200 with
// the site index for every address that does not exist, so search engines can
// index unlimited synthetic URLs carrying a duplicate of the homepage. Verified
// on all three of these domains before this was added.
(function writeNotFound() {
  const indexPath = path.join(out, "index.html");
  if (!fs.existsSync(indexPath)) return;
  const index = fs.readFileSync(indexPath, "utf8");
  const styles = [
    ...(index.match(/<style[\s\S]*?<\/style>/gi) || []),
    ...(index.match(/<link[^>]+rel=["'](?:stylesheet|preconnect|icon|apple-touch-icon)["'][^>]*>/gi) || []),
  ].join("\n");
  const footer = (index.match(/<footer[\s\S]*?<\/footer>/i) || [""])[0];
  const titleRaw = (index.match(/<title>([^<]*)<\/title>/i) || [, "This site"])[1];
  const siteName = titleRaw.split(/\s+[|\u2014-]\s+/)[0].trim();
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  fs.writeFileSync(path.join(out, "404.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found &middot; ${esc(siteName)}</title>
  <meta name="robots" content="noindex, follow">
  <meta name="description" content="That page could not be found on ${esc(siteName)}.">
${styles}
  <style>
    .nf-wrap { max-width: 40rem; margin: 0 auto; padding: 4rem 1.25rem; }
    .nf-code { font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; opacity: .7; margin: 0 0 .75rem; }
    .nf-wrap h1 { margin: 0 0 .75rem; text-wrap: balance; }
    .nf-wrap p { margin: 0 0 1.5rem; max-width: 34rem; }
  </style>
</head>
<body>
  <main class="nf-wrap">
    <p class="nf-code">Error 404</p>
    <h1>We couldn&rsquo;t find that page</h1>
    <p>The address may be mistyped, or the page may have been moved or retired since it was linked.</p>
    <p><a href="/">Return to ${esc(siteName)}</a></p>
  </main>
${footer}
</body>
</html>
`);
  console.log("404: wrote 404.html");
})();

// Microsoft Clarity was removed (Scooter, 19 Nov 2026: "Google Analytics only.
// Remove Microsoft Clarity and leave other tracking off"). guardTrackers below
// refuses any build that carries it or another tracker.

// Organization schema on every page, not just the index.
//
// Three of the fourteen built pages carried an Organization node; the other
// eleven were anonymous. An answer engine that lands on /thesis or /team had
// nothing telling it which company published the page, which is the one thing
// structured data on a small landing property is actually for.
//
// The index pages already hand-author a richer @graph and a CI check asserts its
// shape, so they are left exactly as they are: this only fills pages that carry
// no Organization node at all. Identity comes from shared/identity.json so the
// injected node and the hand-authored one cannot drift apart.
const identity = JSON.parse(fs.readFileSync(path.join(root, "shared", "identity.json"), "utf8"));
const site = identity.sites[target];
if (!site) fail(`No identity entry for target: ${target}`);
const siteOrg = identity.organizations[site.orgId];
if (!siteOrg) fail(`No organization for ${site.orgId}`);
const productionsOrg = identity.organizations["https://westpeekproductions.com/#organization"];

const htmlFiles = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(abs, acc);
    else if (e.name.endsWith(".html")) acc.push(abs);
  }
  return acc;
};

const escAttr = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const textOf = (re, html) => { const m = html.match(re); return m ? m[1].trim() : ""; };

/** Public URL for an output file, matching how Cloudflare Pages serves it. */
function publicUrl(abs) {
  const rel = path.relative(out, abs).split(path.sep).join("/");
  if (rel === "index.html") return `${site.origin}/`;
  // A nested index.html is served at the directory address WITH a trailing
  // slash; Pages 308-redirects the slashless form to it. Emitting the
  // slashless form put a permanent redirect in the sitemap and in the
  // canonical, which is exactly what neither is for. Verified live:
  // /disclosures was a 308 to /disclosures/.
  if (rel.endsWith("/index.html")) return `${site.origin}/${rel.slice(0, -"index.html".length)}`;
  // A flat foo.html is the opposite: Pages serves it at /foo and 308-redirects
  // /foo.html, so the extensionless form is the one that answers 200.
  return `${site.origin}/${rel.replace(/\.html$/, "")}`;
}

(function injectOrganization() {
  let injected = 0;
  for (const abs of htmlFiles(out)) {
    const html = fs.readFileSync(abs, "utf8");
    if (/"@type"\s*:\s*"Organization"/.test(html)) continue;
    if (!/<\/head>/i.test(html)) continue;
    const url = textOf(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i, html) || publicUrl(abs);
    const name = textOf(/<title>([^<]*)<\/title>/i, html) || site.siteName;
    const description = textOf(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html);
    const graph = [
      {
        "@type": "WebSite",
        "@id": `${site.origin}/#website`,
        url: `${site.origin}/`,
        name: site.siteName,
        publisher: { "@id": siteOrg["@id"] },
      },
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name,
        ...(description ? { description } : {}),
        isPartOf: { "@id": `${site.origin}/#website` },
        about: { "@id": siteOrg["@id"] },
      },
      siteOrg,
      // West Peek Productions is the entity with third-party profiles that
      // unambiguously identify it, so its node - and only its node - carries
      // them. Including it on the sibling sites' pages is what lets every page
      // in the repo resolve to a verifiable company rather than a bare name.
      ...(siteOrg["@id"] === productionsOrg["@id"] ? [] : [productionsOrg]),
      identity.person.scooter,
      ...(target === "ventures" ? [identity.person.sequoia] : []),
    ];
    const block = `<script type="application/ld+json" data-wp-identity>\n${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)}\n</script>\n`;
    fs.writeFileSync(abs, html.replace(/<\/head>/i, `${block}</head>`));
    injected += 1;
  }
  console.log(`schema: injected Organization graph into ${injected} page(s) for ${target}`);
})();

// Sitemap with a real lastmod.
//
// The previous sitemaps were hand-maintained, carried no <lastmod>, and had
// already drifted: the community one listed a single URL. This derives the URL
// set from what was actually built and takes each date from the committed
// git-history ledger, so a crawler gets a freshness signal that is true rather
// than one stamped from the build clock.
(function writeSitemap() {
  const ledger = (() => {
    const f = path.join(root, "shared", "lastmod.json");
    if (!exists(f)) return {};
    return JSON.parse(fs.readFileSync(f, "utf8")).entries || {};
  })();
  const rows = [];
  const undated = [];
  for (const abs of htmlFiles(out).sort()) {
    const rel = path.relative(out, abs).split(path.sep).join("/");
    if (rel === "404.html") continue;
    const html = fs.readFileSync(abs, "utf8");
    // A page telling crawlers not to index it has no business in the sitemap.
    if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) continue;
    const lastmod = ledger[`sites/${target}/${rel}`];
    if (!lastmod) undated.push(rel);
    rows.push(`  <url><loc>${escAttr(publicUrl(abs))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  }
  fs.writeFileSync(
    path.join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`
  );
  // robots.txt has to name the sitemap or nothing points a crawler at it.
  const robotsPath = path.join(out, "robots.txt");
  const sitemapLine = `Sitemap: ${site.origin}/sitemap.xml`;
  let robots = exists(robotsPath) ? fs.readFileSync(robotsPath, "utf8") : "User-agent: *\nAllow: /\n";
  if (!robots.split(/\r?\n/).some((l) => l.trim().toLowerCase() === sitemapLine.toLowerCase())) {
    robots = `${robots.replace(/\s*$/, "")}\n${sitemapLine}\n`;
  }
  fs.writeFileSync(robotsPath, robots);
  console.log(
    `sitemap: ${rows.length} URL(s) for ${target}` +
    (undated.length ? `; ${undated.length} without a git date, emitted with no <lastmod>: ${undated.join(", ")}` : "")
  );
})();

const outAssets = path.join(out, "assets");
fs.mkdirSync(outAssets, { recursive: true });
copyRecursive(sharedAssets, outAssets);

// Google Analytics 4 (Scooter, 17 Nov 2026: "Standard gtag.js in the <head> of
// every page, one tag per page"). Written by the build, so
// the pages the build generates (404, episodes, workshops) are covered and no
// source file can carry a second copy. What the tag sends is cut down to what
// GA needs and nothing personal: page_location is origin + path plus only the
// campaign/click keys (a value that looks like an email address is dropped),
// the referrer loses its query string and hash, Google signals and ad
// personalisation are off. On any host that is not the site's own domain
// (*.pages.dev previews, localhost) Google's own opt-out flag is set, so test
// visits never reach the counts; events still land in dataLayer for checking.
// The CTA and form events live in shared/assets/js/wp-analytics.js.
const GA4 = {
  productions: { id: "G-17BHLS1RWJ", hosts: ["westpeekproductions.com", "www.westpeekproductions.com"] },
  community: { id: "G-X0CDKY3DXT", hosts: ["joinwestpeek.com", "www.joinwestpeek.com"] },
  ventures: { id: "G-Y7371XLG0L", hosts: ["westpeek.ventures", "www.westpeek.ventures", "ventures.joinwestpeek.com"] },
};
(function injectGa4() {
  const ga = GA4[target];
  if (!ga) fail(`No GA4 measurement ID for target: ${target}`);
  const keep = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "gbraid", "wbraid"];
  const snippet = [
    `<!-- Google tag (gtag.js) -->`,
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga.id}" data-wp-ga></script>`,
    `<script data-wp-ga-config>`,
    `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}`,
    `(function(id,hosts,keep){var l=window.location;if(hosts.indexOf(l.hostname.toLowerCase())<0)window["ga-disable-"+id]=true;var q="";try{var i=new URLSearchParams(l.search),o=new URLSearchParams();keep.forEach(function(k){var v=i.get(k);if(v&&!/@|%40/.test(v))o.set(k,v)});q=o.toString()}catch(e){}var r="";try{if(document.referrer){var u=new URL(document.referrer);r=u.origin+u.pathname}}catch(e){}`,
    `gtag("js",new Date());gtag("set",{page_location:l.origin+l.pathname+(q?"?"+q:""),page_referrer:r,allow_google_signals:false,allow_ad_personalization_signals:false});gtag("config",id)})(${JSON.stringify(ga.id)},${JSON.stringify(ga.hosts)},${JSON.stringify(keep)});`,
    `</script>`,
    `<script src="/assets/js/wp-analytics.js" defer data-wp-analytics data-site="${target}"></script>`,
  ].join("\n");
  const headOpen = /<head(?:\s[^>]*)?>/i;
  const allIds = Object.values(GA4).map((g) => g.id);
  const problems = [];
  let tagged = 0;
  for (const abs of htmlFiles(out)) {
    let html = fs.readFileSync(abs, "utf8");
    const rel = path.relative(out, abs);
    if (!headOpen.test(html)) { problems.push(`${rel}: no <head> to put the tag in`); continue; }
    if (!html.includes("data-wp-ga-config")) {
      html = html.replace(headOpen, (m) => `${m}\n${snippet}`);
      fs.writeFileSync(abs, html);
      tagged += 1;
    }
    // Exactly one Google tag per page, and only this site's ID.
    const loaders = (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length;
    const configs = (html.match(/gtag\(\s*["']config["']/g) || []).length;
    const gtm = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(html);
    const foreign = allIds.filter((id) => id !== ga.id && html.includes(id));
    if (loaders !== 1 || configs !== 1 || gtm || foreign.length) {
      problems.push(`${rel}: ${loaders} gtag.js loader(s), ${configs} config call(s)${gtm ? ", a GTM container" : ""}${foreign.length ? `, foreign ID ${foreign.join(" ")}` : ""}`);
    }
  }
  if (!tagged && !htmlFiles(out).length) fail(`ga4: no pages found for ${target}`);
  if (problems.length) fail(`ga4: every ${target} page must carry exactly one Google tag (${ga.id}):\n  ${problems.join("\n  ")}`);
  console.log(`ga4: tagged ${tagged} page(s) for ${target} with ${ga.id}; every page has exactly one tag`);
})();

const required = {
  ventures: [
    path.join(outAssets, "base.css"),
    path.join(outAssets, "js", "forms.js"),
    path.join(outAssets, "js", "wp-analytics.js"),
    // 20 Sep 2026 update: shared nav, the WP monogram, the two portfolio companies.
    path.join(outAssets, "ventures.css"),
    path.join(outAssets, "ventures.js"),
    path.join(outAssets, "img", "wp-monogram.png"),
    path.join(outAssets, "img", "portfolio", "sensori-logo.svg"),
    path.join(outAssets, "img", "portfolio", "sensori-founders.jpg"),
    path.join(outAssets, "img", "portfolio", "cxffeeblack-logo.png"),
    path.join(outAssets, "img", "portfolio", "cxffeeblack-founders.jpg"),
    path.join(outAssets, "img", "portfolio", "anyplace-icon.svg"),
    path.join(outAssets, "img", "portfolio", "anyplace-founders.jpg"),
  ],
  productions: [
    path.join(outAssets, "base.css"),
    path.join(outAssets, "img", "productions-hero.jpg"),
    path.join(outAssets, "img", "productions-logo.jpg"),
    path.join(outAssets, "js", "forms.js"),
    path.join(outAssets, "js", "wp-analytics.js"),
  ],
  community: [
    // 23 Sep 2026 redesign: black/orange visual system, self-hosted Maax, and
    // the data files the episode/winner/history pages read at runtime.
    path.join(outAssets, "js", "forms.js"),
    path.join(outAssets, "js", "wp-analytics.js"),
    path.join(outAssets, "community.css"),
    path.join(outAssets, "community.js"),
    path.join(outAssets, "img", "community-monogram.png"),
    path.join(outAssets, "fonts", "Maax-Regular.woff2"),
    path.join(outAssets, "fonts", "Maax-Medium.woff2"),
    path.join(outAssets, "fonts", "Maax-Bold.woff2"),
    path.join(outAssets, "data", "episodes.json"),
    path.join(outAssets, "data", "winners.json"),
    path.join(outAssets, "data", "history-events.json"),
    path.join(outAssets, "data", "hero.json"),
    path.join(outAssets, "data", "workshops.json"),
  ],
};

if (!required[target]) fail(`Unknown target: ${target}`);
for (const f of required[target]) {
  if (!exists(f)) fail(`Build contract failed for ${target}. Missing: ${f}`);
}

// Privacy (Scooter, 17 Nov 2026: "Privacy pages naming Google Analytics (and
// Clarity)"; risk rule R-PRV-04). Runs last, over what was actually built, so it
// sees every tag the build added (GA4) and every
// generated page (404, episodes, workshops). It fails the build when:
//   - the site has no /privacy page;
//   - any built page carries no link to /privacy;
//   - the build put a tool on the site that its privacy page does not name.
// One direction only: a page may name a tool before the tag arrives, so this
// and a tag change can land in either order, but a tool can never go live
// undisclosed.
const PRIVACY_TOOLS = [
  { name: "Google Analytics", loaded: /googletagmanager\.com\/gtag\/js/ },
  { name: "Microsoft Clarity", loaded: /clarity\.ms\/tag\// },
  { name: "Cloudflare Turnstile", loaded: /data-bot-check\s*=\s*["']turnstile["']/ },
];
(function guardPrivacy() {
  const pages = htmlFiles(out);
  if (!pages.length) fail(`privacy: no pages found for ${target}`);
  const privacyPath = path.join(out, "privacy.html");
  if (!exists(privacyPath)) fail(`privacy: ${target} has no privacy page (sites/${target}/privacy.html)`);
  const privacyText = fs.readFileSync(privacyPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const linkRe = new RegExp(`<a\\b[^>]*href\\s*=\\s*["'](?:${site.origin.replace(/[.]/g, "\\.")})?/privacy/?["']`, "i");
  const unlinked = [];
  const loaded = new Map();
  for (const abs of pages) {
    const html = fs.readFileSync(abs, "utf8");
    const rel = path.relative(out, abs).split(path.sep).join("/");
    if (!linkRe.test(html)) unlinked.push(rel);
    for (const tool of PRIVACY_TOOLS) if (tool.loaded.test(html) && !loaded.has(tool.name)) loaded.set(tool.name, rel);
  }
  const unnamed = [...loaded].filter(([name]) => !privacyText.includes(name));
  const problems = [
    ...unlinked.map((rel) => `${rel}: no link to /privacy (put it in the footer)`),
    ...unnamed.map(([name, rel]) => `${name} is loaded (first seen on ${rel}) but sites/${target}/privacy.html does not name it`),
  ];
  if (problems.length) fail(`privacy: ${target} build refused:\n  ${problems.join("\n  ")}`);
  console.log(`privacy: ${pages.length} page(s) link /privacy; tools loaded and named: ${[...loaded.keys()].join(", ") || "none"}`);
})();

// Google Analytics is the only tracking on all three sites (Scooter, 19 Nov
// 2026: "Google Analytics only. Remove Microsoft Clarity and leave other
// tracking off"). Any other analytics, session-recording or ad tag on a built
// page fails the build.
(function guardTrackers() {
  const OTHER = [
    ["Microsoft Clarity", /clarity\.ms|data-clarity-loader|window\.clarity|w\.clarity/],
    ["Google Tag Manager", /googletagmanager\.com\/gtm\.js/],
    ["Meta pixel", /connect\.facebook\.net|fbq\(/],
    ["Hotjar", /static\.hotjar\.com|hj\(/],
    ["LinkedIn Insight", /snap\.licdn\.com/],
    ["TikTok pixel", /analytics\.tiktok\.com/],
    ["Plausible", /plausible\.io\/js/],
    ["Segment", /cdn\.segment\.com/],
  ];
  const pages = htmlFiles(out);
  if (!pages.length) fail(`trackers: no pages found for ${target}`);
  const problems = [];
  for (const abs of pages) {
    const html = fs.readFileSync(abs, "utf8");
    for (const [name, re] of OTHER) if (re.test(html)) problems.push(`${path.relative(out, abs)}: ${name}`);
  }
  if (problems.length) fail(`trackers: Google Analytics only on ${target}; found:\n  ${problems.join("\n  ")}`);
  console.log(`trackers: ${pages.length} page(s), Google Analytics only`);
})();

// Productions favicon and link preview (Scooter, 19 Nov 2026: "WP mark for the
// favicon. WP logo and 'We make people care' for the link preview, not Peggy
// Kim or another case-study image"). Every page's icon is the WP mark; every
// page except the 404 names the one WP card as its og:image and twitter:image.
if (target === "productions") (function guardProductionsShare() {
  const CARD = "https://westpeekproductions.com/assets/img/og-we-make-people-care.png";
  for (const f of ["favicon-32.png", "favicon-192.png", "apple-touch-icon.png", "og-we-make-people-care.png"]) {
    if (!exists(path.join(outAssets, "img", f))) fail(`share: missing assets/img/${f}`);
  }
  const problems = [];
  const pages = htmlFiles(out);
  for (const abs of pages) {
    const rel = path.relative(out, abs).split(path.sep).join("/");
    const html = fs.readFileSync(abs, "utf8");
    const icons = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi) || [];
    if (!icons.length || icons.some((l) => !/\/assets\/img\/favicon-(?:32|192)\.png/.test(l))) problems.push(`${rel}: icon is not the WP mark`);
    if (rel === "404.html") continue;
    const og = [...html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);
    const tw = [...html.matchAll(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);
    if (og.length !== 1 || og[0] !== CARD) problems.push(`${rel}: og:image must be the WP card once (saw ${og.join(", ") || "none"})`);
    if (tw.length !== 1 || tw[0] !== CARD) problems.push(`${rel}: twitter:image must be the WP card once (saw ${tw.join(", ") || "none"})`);
  }
  if (problems.length) fail(`share: productions build refused:\n  ${problems.join("\n  ")}`);
  console.log(`share: ${pages.length} page(s) carry the WP mark icon; link preview is the WP card`);
})();

console.log(`Built ${target}: ${src} -> ${out}`);

function copyRecursive(from, to) {
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const e of entries) {
    const fromPath = path.join(from, e.name);
    const toPath = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(toPath, { recursive: true });
      copyRecursive(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}
