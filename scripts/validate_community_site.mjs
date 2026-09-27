// joinwestpeek.com redesign guard (23 Sep 2026; rewritten to the 27 Sep 2026
// brightened redesign — strengthened, never weakened, per this repo's rule).
//
// The Site Architecture & Design Brief sets rules a build could silently drift
// away from with no visible break: the same four-item nav on every page, the
// homepage sections in one exact order, a hero carrying the brief's own line
// with no photo shipped until one is set, no italic/script type anywhere, no
// navigation back to the sister properties or to LinkedIn, no Dinners on the
// homepage or nav (removed 27 Sep 2026 — no photos yet), no "Who built it" on
// /about, no embedded third-party form (Airtable) anywhere, the podcast
// series intro present everywhere the podcast is, The Update form actually
// gated to its window, and the retired /podcast and /history routes actually
// redirecting. None of that is proven by the build or by validate:forms, so
// this reads the pages and fails on each one. Runs over sites/community AND
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
];
const REQUIRED_PAGES = ["index.html", "episodes.html", "about.html", "update.html", "pitch.html", "workshops.html", "join.html"];
const FORBIDDEN_HOSTS = new Set(["westpeek.ventures", "www.westpeek.ventures", "westpeekproductions.com", "www.westpeekproductions.com", "westpeek.live", "www.westpeek.live"]);
const HERO_LINE = "West Peek is a community for the world's top professionals, creatives, and entrepreneurs to learn, partner, and connect.";
const SERIES_INTRO = "What happens when you meet the right person at the right time under the right context?";
const HOMEPAGE_ORDER = ["top", "origin", "podcast-home", "update-home", "pitch-home", "workshops-home"];

function htmlFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(abs, acc);
    else if (entry.name.endsWith(".html") && entry.name !== "404.html") acc.push(abs);
  }
  return acc;
}
function rel(p) { return path.relative(root, p).split(path.sep).join("/"); }
function text(s) { return s.replace(/<[^>]+>/g, "").replace(/&rarr;/g, "").replace(/\s+/g, " ").trim(); }

function checkTree(label, dir, isBuilt) {
  const files = htmlFiles(dir);
  if (!files.length) { errors.push(`${label}: no HTML pages under ${dir}`); return; }

  // Missing route.
  for (const page of REQUIRED_PAGES) {
    check();
    if (!fs.existsSync(path.join(dir, page))) errors.push(`${label}: missing required route ${page}`);
  }

  let sawSeriesIntro = 0;
  let sawEpisodePage = false;

  for (const abs of files) {
    const r = rel(abs);
    const rDir = path.relative(dir, abs).split(path.sep).join("/");
    const html = fs.readFileSync(abs, "utf8");
    const isEpisodePage = /^episodes\/[^/]+\/index\.html$/.test(rDir);
    if (isEpisodePage) sawEpisodePage = true;

    // NAV — exact four items, exact hrefs, on every page (Dinners removed 27
    // Sep 2026 — no photos yet; see RUNBOOK).
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

    // No Dinners anywhere: no /#dinners link, no id="dinners" section.
    check();
    if (/\/#dinners/.test(html)) errors.push(`${r}: still links to /#dinners. Dinners was removed from the homepage and nav 27 Sep 2026.`);
    if (/id="dinners"/.test(html)) errors.push(`${r}: still carries an id="dinners" section.`);

    // No sister-property navigation, and no LinkedIn navigation. JSON-LD is
    // structured data, not navigation — the entity graph is required to
    // reference the sister orgs AND carries West Peek's own LinkedIn in
    // `sameAs` — so <script> blocks are stripped before either scan.
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    check();
    if (/linkedin\.com/i.test(withoutScripts)) errors.push(`${r}: links to LinkedIn outside structured data. The footer carries no LinkedIn link (27 Sep 2026).`);

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

    // No embedded third-party form anywhere (the Airtable Update embed was
    // removed 27 Sep 2026; the Airtable base and its data are untouched, only
    // the embed on this site is gone).
    check();
    if (/airtable\.com\/embed/i.test(html)) errors.push(`${r}: still embeds an Airtable form. The Update now posts through /api/lead like every other West Peek form.`);

    // The podcast series intro, verbatim (start of it), wherever the podcast
    // lives: /episodes and every generated /episodes/<slug> page.
    if (path.basename(abs) === "episodes.html" || isEpisodePage) {
      check();
      if (!html.includes(SERIES_INTRO)) errors.push(`${r}: missing the podcast series intro.`);
      else sawSeriesIntro += 1;
    }

    if (rDir === "index.html") {
      // Homepage order: every section id appears, in this exact order.
      const positions = HOMEPAGE_ORDER.map((id) => ({ id, i: html.indexOf(`id="${id}"`) }));
      check();
      for (const { id, i } of positions) if (i === -1) errors.push(`${r}: homepage is missing id="${id}".`);
      const found = positions.filter((p) => p.i !== -1);
      for (let i = 1; i < found.length; i++) {
        if (found[i].i < found[i - 1].i) errors.push(`${r}: homepage section "${found[i].id}" appears before "${found[i - 1].id}", out of order.`);
      }

      // Hero: the brief's exact line, a Join CTA, and NO shipped photo unless
      // assets/data/hero.json names one — the only <img> allowed in the hero
      // is the hero-photo slot itself, and it must still carry no `src` in
      // the built markup (community.js sets it at runtime only if hero.json
      // has a photo).
      const hero = /<header class="wpc-hero"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0];
      check();
      if (!hero) {
        errors.push(`${r}: no <header class="wpc-hero"> found.`);
      } else {
        if (!text(hero).includes(HERO_LINE)) errors.push(`${r}: hero text does not match the brief's exact line.`);
        if (!/href="\/join"/.test(hero)) errors.push(`${r}: hero carries no Join button.`);
        const heroImgs = [...hero.matchAll(/<img\b[^>]*>/gi)];
        for (const m of heroImgs) {
          if (!/id="hero-photo"/.test(m[0])) errors.push(`${r}: hero carries an <img> other than the hero-photo slot.`);
          else if (/\ssrc="/.test(m[0])) errors.push(`${r}: hero-photo slot ships with a src baked in — it must stay empty until community.js sets it from hero.json.`);
        }
      }
    }

    // /about: no "Who built it" founding-team section.
    if (path.basename(abs) === "about.html") {
      check();
      if (/Who built it/i.test(html)) errors.push(`${r}: still carries a "Who built it" section. Removed 27 Sep 2026 — goes straight from Origin to event history.`);
    }
  }

  // The podcast intro must actually have been checked on at least /episodes
  // and one episode page — a tree with zero episode pages would pass the
  // per-file loop vacuously. Episode pages are BUILD OUTPUT ONLY (generated
  // by scripts/build.mjs from episode-template.html + episodes.json), so
  // this only applies to dist/, not sites/.
  if (isBuilt) {
    check();
    if (!sawEpisodePage) errors.push(`${label}: no generated /episodes/<slug> page found.`);
    check();
    if (sawSeriesIntro < 2) errors.push(`${label}: podcast series intro found on fewer than 2 pages (episodes.html + at least one episode page).`);
  }

  // /podcast and /history: retired, must redirect, never 404.
  const redirects = path.join(dir, "_redirects");
  check();
  const rtxt = fs.existsSync(redirects) ? fs.readFileSync(redirects, "utf8") : "";
  if (!/^\/podcast(\.html)?\s+\/episodes\s+301$/m.test(rtxt)) errors.push(`${label}: _redirects has no 301 from /podcast to /episodes.`);
  if (!/^\/history(\.html)?\s+\/about\s+301$/m.test(rtxt)) errors.push(`${label}: _redirects has no 301 from /history to /about.`);
  if (fs.existsSync(path.join(dir, "podcast.html"))) errors.push(`${label}: retired page podcast.html is back.`);
  if (fs.existsSync(path.join(dir, "history.html"))) errors.push(`${label}: retired page history.html is back.`);

  // The Update: gated markup present, and the Function that strips it exists.
  const updatePath = path.join(dir, "update.html");
  check();
  if (fs.existsSync(updatePath)) {
    const updateHtml = fs.readFileSync(updatePath, "utf8");
    if (!updateHtml.includes("<!-- UPDATE_FORM_START -->") || !updateHtml.includes("<!-- UPDATE_FORM_END -->")) {
      errors.push(`${label}: update.html is missing the UPDATE_FORM_START/END markers functions/update.js needs to gate the form server-side.`);
    }
  }
  check();
  const updateFn = path.join(root, "functions", "update.js");
  if (!fs.existsSync(updateFn)) errors.push(`${label}: functions/update.js is missing — the Update form would ship ungated on production.`);
  else {
    const fnSrc = fs.readFileSync(updateFn, "utf8");
    if (!/UPDATE_FORM_START/.test(fnSrc) || !/pages\.dev/.test(fnSrc)) {
      errors.push(`functions/update.js: does not reference the UPDATE_FORM markers or the *.pages.dev preview exemption.`);
    }
  }

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
      check();
      if (!ep.slug || !/^[a-z0-9-]+$/.test(ep.slug)) {
        errors.push(`${label}: episode ${ep.number} (${ep.guest}) has no usable slug for /episodes/<slug>.`);
      } else if (isBuilt && !fs.existsSync(path.join(dir, "episodes", ep.slug, "index.html"))) {
        errors.push(`${label}: episode ${ep.number} (${ep.guest}) slug "${ep.slug}" has no generated /episodes/${ep.slug}/ page.`);
      }
    }
  }

  // History-event photos: every declared photo file must actually exist on
  // disk. A missing file is worse than no carousel at all.
  const historyPath = path.join(dir, "assets", "data", "history-events.json");
  check();
  if (!fs.existsSync(historyPath)) {
    errors.push(`${label}: assets/data/history-events.json is missing.`);
  } else {
    let series;
    try { series = JSON.parse(fs.readFileSync(historyPath, "utf8")); }
    catch (err) { errors.push(`${label}: history-events.json is not valid JSON: ${err.message}`); series = []; }
    if (!Array.isArray(series) || series.length < 2) errors.push(`${label}: history-events.json lists fewer than 2 event series.`);
    let photoCount = 0;
    for (const s of series) {
      for (const photo of s.photos || []) {
        photoCount += 1;
        if (!fs.existsSync(path.join(dir, photo.src || ""))) {
          errors.push(`${label}: history series "${s.slug}" declares photo "${photo.src}" which does not exist.`);
        }
      }
    }
    check();
    if (!photoCount) errors.push(`${label}: no history-event photos declared at all.`);
  }

  console.log(`${label}: ${files.length} page(s) checked, shared nav verified, no Dinners/LinkedIn/sister-property links, no italic/script markup, no Airtable embed`);
}

checkTree("sites", path.join(root, "sites", "community"), false);
checkTree("dist", path.join(root, "dist", "community"), true);

console.log(`validate:community-site: ${checks} check(s) run`);
if (errors.length) {
  console.error(`\nvalidate:community-site FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate:community-site PASS");
