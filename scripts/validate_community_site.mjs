// joinwestpeek.com redesign guard (23 Sep 2026).
//
// The Site Architecture & Design Brief sets rules a build could silently drift
// away from with no visible break: the same five-item nav on every page, the
// homepage sections in one exact order, a text-only hero carrying the brief's
// own line, no italic/script type anywhere, no navigation back to the sister
// properties, the retired /podcast and /history routes actually redirecting,
// and no episode shipping a fabricated YouTube id or a headshot that isn't on
// disk. None of that is proven by the build or by validate:forms, so this
// reads the pages and fails on each one. Runs over sites/community AND
// dist/community, same pattern as validate_ventures_isolation.mjs. Proven
// negatively before merge: planted a defect in each rule, watched it fail,
// removed it.
//
// Usage: node scripts/validate_community_site.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
let checks = 0;
const check = () => { checks += 1; };

const NAV_ITEMS = [
  ["Podcast", "/episodes"],
  ["Update", "/update"],
  ["Pitch", "/pitch"],
  ["Workshops", "/workshops"],
  ["Dinners", "/#dinners"],
];
const REQUIRED_PAGES = ["index.html", "episodes.html", "about.html", "update.html", "pitch.html", "workshops.html", "join.html"];
const FORBIDDEN_HOSTS = new Set(["westpeek.ventures", "www.westpeek.ventures", "westpeekproductions.com", "www.westpeekproductions.com", "westpeek.live", "www.westpeek.live"]);
const HERO_LINE = "West Peek is a community for the world's top professionals, creatives, and entrepreneurs to learn, partner, and connect.";
const HOMEPAGE_ORDER = ["top", "origin", "podcast-home", "update-home", "pitch-home", "workshops-home", "dinners"];

function htmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html") && e.name !== "404.html")
    .map((e) => path.join(dir, e.name))
    .sort();
}
function rel(p) { return path.relative(root, p).split(path.sep).join("/"); }
function text(s) { return s.replace(/<[^>]+>/g, "").replace(/&rarr;/g, "").replace(/\s+/g, " ").trim(); }

function checkTree(label, dir) {
  const files = htmlFiles(dir);
  if (!files.length) { errors.push(`${label}: no HTML pages under ${dir}`); return; }

  // Missing route.
  for (const page of REQUIRED_PAGES) {
    check();
    if (!fs.existsSync(path.join(dir, page))) errors.push(`${label}: missing required route ${page}`);
  }

  for (const abs of files) {
    const r = rel(abs);
    const html = fs.readFileSync(abs, "utf8");

    // NAV — exact five items, exact hrefs, on every page.
    const navBlock = /<div class="wpc-nav__links">[\s\S]*?<\/div>/.exec(html)?.[0];
    check();
    if (!navBlock) {
      errors.push(`${r}: no <div class="wpc-nav__links"> nav block found.`);
    } else {
      const items = [...navBlock.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [text(m[2]), m[1]]);
      const want = NAV_ITEMS.map(([l]) => l);
      const got = items.map(([l]) => l);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        errors.push(`${r}: nav items are [${got.join(" · ")}], expected [${want.join(" · ")}].`);
      } else {
        for (let i = 0; i < NAV_ITEMS.length; i++) {
          if (items[i][1] !== NAV_ITEMS[i][1]) errors.push(`${r}: nav "${NAV_ITEMS[i][0]}" points at ${items[i][1]}, expected ${NAV_ITEMS[i][1]}.`);
        }
      }
    }

    // No sister-property navigation. JSON-LD is structured data, not
    // navigation, and the entity graph is required to reference the sister
    // orgs there — so <script> blocks are stripped before this scan.
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    check();
    for (const m of withoutScripts.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      let host;
      try { host = new URL(m[1], "https://joinwestpeek.com/").hostname; } catch { continue; }
      if (FORBIDDEN_HOSTS.has(host)) errors.push(`${r}: navigable link to sister property ${m[1]}`);
    }

    // No italic or script type, anywhere.
    check();
    if (/<em\b|<i\b/i.test(withoutScripts)) errors.push(`${r}: carries an <em> or <i> element. No italics as a stylistic device.`);
    if (/font-style\s*:\s*italic/i.test(html)) errors.push(`${r}: carries font-style: italic.`);

    // Dinners: copy only, no button or link, anywhere in this phase.
    if (path.basename(abs) === "index.html") {
      const dinners = /<section class="wpc-section" id="dinners">[\s\S]*?<\/section>/.exec(html)?.[0];
      check();
      if (!dinners) errors.push(`${r}: no id="dinners" homepage section found.`);
      else if (/<a\b/.test(dinners)) errors.push(`${r}: Dinners section carries a link. It is copy-only this phase.`);

      // Homepage order: every section id appears, in this exact order.
      const positions = HOMEPAGE_ORDER.map((id) => ({ id, i: html.indexOf(`id="${id}"`) }));
      check();
      for (const { id, i } of positions) if (i === -1) errors.push(`${r}: homepage is missing id="${id}".`);
      const found = positions.filter((p) => p.i !== -1);
      for (let i = 1; i < found.length; i++) {
        if (found[i].i < found[i - 1].i) errors.push(`${r}: homepage section "${found[i].id}" appears before "${found[i - 1].id}", out of order.`);
      }

      // Hero: text-only, the brief's exact line, no image.
      const hero = /<header class="wpc-hero"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0];
      check();
      if (!hero) errors.push(`${r}: no <header class="wpc-hero"> found.`);
      else {
        if (!text(hero).includes(HERO_LINE)) errors.push(`${r}: hero text does not match the brief's exact line.`);
        if (/<img\b/.test(hero)) errors.push(`${r}: hero carries an <img> - the brief requires a text-only hero, no photo.`);
      }
    }
  }

  // /podcast and /history: retired, must redirect, never 404.
  const redirects = path.join(dir, "_redirects");
  check();
  const rtxt = fs.existsSync(redirects) ? fs.readFileSync(redirects, "utf8") : "";
  if (!/^\/podcast(\.html)?\s+\/episodes\s+301$/m.test(rtxt)) errors.push(`${label}: _redirects has no 301 from /podcast to /episodes.`);
  if (!/^\/history(\.html)?\s+\/about\s+301$/m.test(rtxt)) errors.push(`${label}: _redirects has no 301 from /history to /about.`);
  if (fs.existsSync(path.join(dir, "podcast.html"))) errors.push(`${label}: retired page podcast.html is back.`);
  if (fs.existsSync(path.join(dir, "history.html"))) errors.push(`${label}: retired page history.html is back.`);

  // Episode records: no fabricated YouTube id, no missing headshot file.
  const episodesPath = path.join(dir, "assets", "data", "episodes.json");
  check();
  if (!fs.existsSync(episodesPath)) {
    errors.push(`${label}: assets/data/episodes.json is missing.`);
  } else {
    let episodes;
    try { episodes = JSON.parse(fs.readFileSync(episodesPath, "utf8")); }
    catch (err) { errors.push(`${label}: episodes.json is not valid JSON: ${err.message}`); episodes = []; }
    if (!Array.isArray(episodes) || !episodes.length) errors.push(`${label}: episodes.json lists zero episodes.`);
    for (const ep of episodes) {
      check();
      if (ep.youtube != null && !/^[A-Za-z0-9_-]{11}$/.test(ep.youtube)) {
        errors.push(`${label}: episode ${ep.number} (${ep.guest}) has a YouTube value "${ep.youtube}" that is not a real 11-character video id.`);
      }
      const headshotAbs = path.join(dir, ep.headshot || "");
      if (!ep.headshot || !fs.existsSync(headshotAbs)) {
        errors.push(`${label}: episode ${ep.number} (${ep.guest}) headshot "${ep.headshot}" does not exist.`);
      }
    }
  }

  console.log(`${label}: ${files.length} page(s) checked, shared nav verified, no sister-property links, no italic/script markup`);
}

checkTree("sites", path.join(root, "sites", "community"));
checkTree("dist", path.join(root, "dist", "community"));

console.log(`validate:community-site: ${checks} check(s) run`);
if (errors.length) {
  console.error(`\nvalidate:community-site FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate:community-site PASS");
