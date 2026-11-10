// westpeek.ventures isolation + navigation validator.
//
// Scooter, 20 Sep 2026: "I do not want anyone who's on West Peek Ventures to
// get back to our community... These are three separate sister things." So no
// ventures page may carry a navigable link to joinwestpeek.com,
// westpeekproductions.com or westpeek.live. The one allowed host on that
// family is dilution.joinwestpeek.com, which he asked for by name under
// Resources. Structured data (JSON-LD) is not navigation and is not scanned.
//
// The same note demanded the nav collapse on mobile and that every item scroll
// to a homepage section. Both are asserted here so a page cannot quietly ship
// with the old tab bar or a dead anchor:
//   NAV-1  every ventures page carries the shared nav with its toggle and the
//          exact item list below - one list, held here, so no page can keep
//          its own;
//   NAV-2  every in-page anchor the nav points at resolves to an id on the
//          homepage;
//   NAV-3  the retired pages stay retired and their _redirects entries exist.
//
// Runs over sites/ventures AND dist/ventures. Hard-fails on zero pages.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const FORBIDDEN_HOSTS = new Set(["joinwestpeek.com", "www.joinwestpeek.com", "westpeekproductions.com", "www.westpeekproductions.com", "westpeek.live", "www.westpeek.live"]);
const ALLOWED_SISTER_HOSTS = new Set(["dilution.joinwestpeek.com"]);

/** The nav, in order. Labels and the section each one lands on. */
const NAV_ITEMS = [
  ["Home", "top"],
  ["Thesis", "thesis"],
  ["What We Look For", "look-for"],
  ["Portfolio", "portfolio"],
  ["Team", "team"],
  ["Community", "community"],
  ["Resources", null],
  ["Submit Your Company", "apply"],
];
const RESOURCES_LINK = "https://dilution.joinwestpeek.com/";
const RETIRED = ["team.html", "what-we-look-for.html"];
const REDIRECTS = [/^\/team\s+\/#team\s+301$/m, /^\/what-we-look-for\s+\/#look-for\s+301$/m];

const errors = [];
const htmlFiles = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(abs, acc);
    else if (e.name.endsWith(".html")) acc.push(abs);
  }
  return acc.sort();
};
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function checkTree(label, dir) {
  const files = htmlFiles(dir);
  if (!files.length) { errors.push(`${label}: no HTML under ${dir}`); return; }
  const home = files.find((f) => path.relative(dir, f) === "index.html");
  const homeIds = new Set(home ? [...fs.readFileSync(home, "utf8").matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]) : []);
  let pages = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const html = fs.readFileSync(abs, "utf8");
    if (RETIRED.includes(path.basename(abs))) errors.push(`NAV-3 ${rel}: retired page is back.`);
    // ISO-1: no navigable link to a sister property.
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      let host; try { host = new URL(m[1], "https://westpeek.ventures/").hostname; } catch { continue; }
      if (FORBIDDEN_HOSTS.has(host) && !ALLOWED_SISTER_HOSTS.has(host)) errors.push(`ISO-1 ${rel}: links to ${m[1]}`);
    }
    if (/404\.html$/.test(rel)) continue;
    pages += 1;
    // NAV-1: shared nav present with toggle and the canonical item list.
    const nav = /<nav class="wp-nav[^"]*"[\s\S]*?<\/nav>/.exec(html)?.[0];
    if (!nav) { errors.push(`NAV-1 ${rel}: no shared nav (<nav class="wp-nav">).`); continue; }
    if (!/<button class="wp-nav__toggle"[^>]*aria-expanded=/.test(nav)) errors.push(`NAV-1 ${rel}: nav has no mobile toggle.`);
    const topLevel = nav.replace(/<ul class="wp-nav__submenu"[\s\S]*?<\/ul>/g, "");
    const items = [...topLevel.matchAll(/<li[^>]*>\s*(?:<a\b[^>]*href="([^"]+)"[^>]*>|<button\b[^>]*>)([^<]+)</g)].map((m) => [text(m[2]), m[1] ?? null]);
    const labels = items.map(([l]) => l);
    const want = NAV_ITEMS.map(([l]) => l);
    if (JSON.stringify(labels) !== JSON.stringify(want)) errors.push(`NAV-1 ${rel}: nav items are [${labels.join(" · ")}], expected [${want.join(" · ")}].`);
    // NAV-2: anchors resolve on the homepage.
    for (const [label, href] of items) {
      const target = NAV_ITEMS.find(([l]) => l === label)?.[1];
      if (!target) continue;
      const frag = href && (href.startsWith("#") ? href.slice(1) : href.startsWith("/#") ? href.slice(2) : href === "/" ? "top" : null);
      if (frag !== target) errors.push(`NAV-2 ${rel}: "${label}" points at ${href}, expected #${target}.`);
      else if (!homeIds.has(target)) errors.push(`NAV-2 ${rel}: "${label}" -> #${target} but the homepage has no id="${target}".`);
    }
    if (!nav.includes(`href="${RESOURCES_LINK}"`)) errors.push(`NAV-1 ${rel}: Resources menu does not link the Founder Dilution Dashboard.`);
  }
  const redirects = path.join(dir, "_redirects");
  const rtxt = fs.existsSync(redirects) ? fs.readFileSync(redirects, "utf8") : "";
  for (const re of REDIRECTS) if (!re.test(rtxt)) errors.push(`NAV-3 ${label}: _redirects lacks ${re}`);
  console.log(`${label}: ${pages} ventures page(s) isolated, shared nav on all, ${homeIds.size} homepage ids`);
}

checkTree("sites", path.join(root, "sites", "ventures"));
checkTree("dist", path.join(root, "dist", "ventures"));

if (errors.length) {
  console.error(`\nvalidate:ventures-isolation FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate:ventures-isolation PASS");
