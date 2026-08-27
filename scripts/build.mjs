import fs from "node:fs";
import path from "node:path";

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
    ...(index.match(/<link[^>]+rel=["'](?:stylesheet|preconnect)["'][^>]*>/gi) || []),
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

// Microsoft Clarity. The project for westpeekproductions.com already existed but
// no tag was ever installed, so it recorded nothing. Only that site has a Clarity
// project today; ventures and community have none, so nothing is injected there
// rather than pointing them at a project that is not theirs.
const CLARITY_PROJECTS = { productions: "y7l2pamzfh" };
const clarityId = CLARITY_PROJECTS[target];
if (clarityId) {
  const marker = "data-clarity-loader";
  const snippet = `<script ${marker}>(function(w,d,i){w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};var s=d.createElement("script");s.async=1;s.src="https://www.clarity.ms/tag/"+i;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)})(window,document,${JSON.stringify(clarityId)})</script>`;
  let tagged = 0;
  (function inject(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { inject(abs); continue; }
      if (!entry.name.endsWith(".html")) continue;
      const html = fs.readFileSync(abs, "utf8");
      if (html.includes(marker) || !/<\/head>/i.test(html)) continue;
      fs.writeFileSync(abs, html.replace(/<\/head>/i, `${snippet}</head>`));
      tagged += 1;
    }
  })(out);
  console.log(`clarity: tagged ${tagged} page(s) for ${target}`);
}

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

const required = {
  ventures: [
    path.join(outAssets, "base.css"),
    path.join(outAssets, "img", "ventures-hero.jpg"),
    path.join(outAssets, "img", "ventures-logo.png"),
    path.join(outAssets, "js", "forms.js"),
  ],
  productions: [
    path.join(outAssets, "base.css"),
    path.join(outAssets, "img", "productions-hero.jpg"),
    path.join(outAssets, "img", "productions-logo.jpg"),
    path.join(outAssets, "js", "forms.js"),
  ],
  community: [
    path.join(outAssets, "base.css"),
    path.join(outAssets, "img", "community-logo.jpg"),
    path.join(outAssets, "js", "forms.js"),
  ],
};

if (!required[target]) fail(`Unknown target: ${target}`);
for (const f of required[target]) {
  if (!exists(f)) fail(`Build contract failed for ${target}. Missing: ${f}`);
}

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
