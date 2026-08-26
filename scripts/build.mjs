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
