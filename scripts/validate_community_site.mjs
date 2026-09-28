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
const REQUIRED_PAGES = ["index.html", "episodes.html", "about.html", "update.html", "pitch.html", "workshops.html", "join.html", "welcome.html"];
// /welcome - the friends-testing link (Scooter, 28 Sep 2026). Carries the same
// four-item nav as every page, is noindex (so the build keeps it out of the
// sitemap), shows his note VERBATIM, and gives one clear button into the site.
const WELCOME_NOTE = "hey y'all. as you remember in 2020 i hosted a virtual event and 5,000 entrepreneurs, creatives and professionals showed up. Six years later I'm continuing to build community amongst them in a way that makes building a business feel less lonely. This website is the first step.";
const FORBIDDEN_HOSTS = new Set(["westpeek.ventures", "www.westpeek.ventures", "westpeekproductions.com", "www.westpeekproductions.com", "westpeek.live", "www.westpeek.live"]);
const HERO_LINE = "West Peek is a community for the world's top professionals, creatives, and entrepreneurs to learn, partner, and connect.";
const SERIES_INTRO = "What happens when you meet the right person at the right time under the right context?";
const HOMEPAGE_ORDER = ["top", "origin", "podcast-home", "update-home", "pitch-home", "workshops-home"];
// The live hero (Scooter, 28 Sep 2026): "West Peek" fixed, these phrases typed
// out, backspaced and rotated by community.js. The brief's exact line
// (HERO_LINE) stays the h1's real, shipped text underneath.
const HERO_PHRASES = ["is a community", "is a space for entrepreneurs, creatives and professionals", "helps you feel less lonely building companies"];
// Scooter, 28 Sep 2026: it is the "<partner> pitch competition" or simply "the
// pitch competition" - never "West Peek pitch competition". The partner is
// spelled Sengo (owner, 28 Sep 2026); "Sango" was a misspelling that shipped
// briefly and is forbidden below.
const WINNERS_HEADING = "Congratulations to the companies below - 1st place winners of the Sengo pitch competition.";
const FORBIDDEN_PHRASES = [
  [/West Peek pitch competition/i, 'says "West Peek pitch competition" - it is the Sengo pitch competition (Scooter, 28 Sep 2026).'],
  [/\bSango\b/, 'spells the pitch partner "Sango" - it is spelled Sengo (owner, 28 Sep 2026).'],
];

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
        // The exact line must be the h1's own shipped text - the element the
        // no-JS / reduced-motion visitor reads - not merely somewhere in the
        // hero, and the typed copy must be decoration (aria-hidden, hidden
        // until community.js starts it) so readers never hear both.
        const lineSpan = /<span class="wpc-hero__line" id="hero-line">([^<]*)<\/span>/.exec(hero)?.[1] || "";
        if (text(lineSpan) !== HERO_LINE) errors.push(`${r}: #hero-line is not exactly the brief's line.`);
        if (!/<h1 class="wpc-hero__title" id="hero-title" data-phrases='(\[[^']*\])'>/.test(hero)) {
          errors.push(`${r}: hero h1 lost its data-phrases attribute, so nothing can type.`);
        } else {
          let phrases = null;
          try { phrases = JSON.parse(/data-phrases='(\[[^']*\])'/.exec(hero)[1]); } catch { /* reported below */ }
          if (JSON.stringify(phrases) !== JSON.stringify(HERO_PHRASES)) errors.push(`${r}: hero data-phrases are ${JSON.stringify(phrases)}, expected ${JSON.stringify(HERO_PHRASES)}.`);
        }
        if (!/<span class="wpc-hero__live" id="hero-live" aria-hidden="true" hidden>/.test(hero)) errors.push(`${r}: the typed copy (#hero-live) must ship aria-hidden and hidden.`);
        if (!/<span class="wpc-hero__fixed">West Peek<\/span>/.test(hero)) errors.push(`${r}: the fixed "West Peek" span is missing from the typed copy.`);
        if (!/id="hero-rotor"/.test(hero)) errors.push(`${r}: no #hero-rotor for the typed phrases.`);
        if (!/href="#origin"/.test(hero)) errors.push(`${r}: the hero does not lead into Origin (no href="#origin").`);
        if (!/href="\/join"/.test(hero)) errors.push(`${r}: hero carries no Join button.`);
        const heroImgs = [...hero.matchAll(/<img\b[^>]*>/gi)];
        for (const m of heroImgs) {
          if (!/id="hero-photo"/.test(m[0])) errors.push(`${r}: hero carries an <img> other than the hero-photo slot.`);
          else if (/\ssrc="/.test(m[0])) errors.push(`${r}: hero-photo slot ships with a src baked in — it must stay empty until community.js sets it from hero.json.`);
        }
      }
    }

    // No personal address on the community site (28 Sep 2026): the "if the
    // form fails, email scooter@..." line is gone, and every form names a firm
    // inbox for its failure fallback - os@joinwestpeek.com, the West Peek OS
    // inbox, which is routed - so forms.js's default (a personal address) can
    // never be what a visitor sees here.
    check();
    if (/scooter@westpeek\.ventures/i.test(withoutScripts)) errors.push(`${r}: shows scooter@westpeek.ventures. No personal address on the community site; forms fall back to os@joinwestpeek.com.`);
    for (const m of withoutScripts.matchAll(/<form\b[^>]*data-westpeek-form[^>]*>/gi)) {
      check();
      const fb = /data-fallback-email="([^"]*)"/.exec(m[0])?.[1] || "";
      if (fb !== "os@joinwestpeek.com") errors.push(`${r}: a data-westpeek-form has data-fallback-email="${fb}", expected os@joinwestpeek.com (the routed OS inbox) so a failed send never shows a personal address.`);
    }

    // Naming: never "West Peek pitch competition", never "Sengo" - on any page.
    check();
    for (const [re, what] of FORBIDDEN_PHRASES) if (re.test(html)) errors.push(`${r}: ${what}`);

    // /pitch: the winners section carries ONE heading - the congratulations
    // sentence, accent-coloured - not a tag and an h2 both saying "Past
    // Winners" (Scooter, 28 Sep 2026).
    if (path.basename(abs) === "pitch.html") {
      const section = /<section\b[^>]*>(?:(?!<\/section>)[\s\S])*id="winner-grid"[\s\S]*?<\/section>/.exec(html)?.[0];
      check();
      if (!section) {
        errors.push(`${r}: no <section> wrapping id="winner-grid".`);
      } else {
        const headings = [...section.matchAll(/<(h2|h3|p class="wpc-section__tag")(?=[\s>])[^>]*>([\s\S]*?)<\/(?:h2|h3|p)>/g)].map((m) => text(m[2]));
        if (headings.length !== 1) errors.push(`${r}: winners section carries ${headings.length} heading(s) [${headings.join(" | ")}], expected exactly one.`);
        if (!headings.includes(WINNERS_HEADING)) errors.push(`${r}: winners heading is not the exact sentence "${WINNERS_HEADING}".`);
        if (!/<h2 class="wpc-section__heading" data-accent="pitch">/.test(section)) errors.push(`${r}: winners heading lost its pitch accent (h2.wpc-section__heading[data-accent="pitch"]).`);
      }
    }

    // /welcome: noindex, the note verbatim, signed, one button into the site.
    if (path.basename(abs) === "welcome.html") {
      check();
      if (!/<meta name="robots" content="noindex[^"]*">/.test(html)) errors.push(`${r}: /welcome must be noindex (a testing link, not a public page).`);
      if (!html.includes(WELCOME_NOTE)) errors.push(`${r}: Scooter's note is not present verbatim.`);
      if (!/<p class="wpc-note__sig">- scooter<\/p>/.test(html)) errors.push(`${r}: the note is not signed "- scooter".`);
      if (!/<a class="wpc-btn" href="\/"[^>]*>/.test(html)) errors.push(`${r}: no wpc-btn button into the site (href="/").`);
      if (!/Thank you for testing/i.test(html)) errors.push(`${r}: does not thank the tester.`);
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

  // The built sitemap never lists the noindex testing page.
  if (isBuilt) {
    check();
    const sm = path.join(dir, "sitemap.xml");
    const smTxt = fs.existsSync(sm) ? fs.readFileSync(sm, "utf8") : "";
    if (!smTxt) errors.push(`${label}: no sitemap.xml was built.`);
    else if (/\/welcome</.test(smTxt)) errors.push(`${label}: sitemap.xml lists /welcome, which is noindex.`);
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
    // The Update's questions, in Scooter's words (28 Sep 2026): no "Update
    // Type" field at all; "Your city" with its one-line explanation; the
    // shout-out and additional-updates labels verbatim; and the newsletter
    // consent as a yes/no radio choice, never a text box - while the field
    // names the lead email and the Network OS intake read stay the same.
    check();
    if (/name="update_type"/.test(updateHtml)) errors.push(`${label}: update.html still carries the "Update Type" field - removed entirely 28 Sep 2026.`);
    const UPDATE_COPY = [
      '<label for="update-dinner-city">Your city</label>',
      "When enough of us are in the same city - or passing through - we put a table together.",
      "Shout out someone you're proud of and want to hype up.",
      "Can we share your wins with the broader community in our newsletter?",
      '<label for="update-context">Additional updates.</label>',
    ];
    for (const needle of UPDATE_COPY) {
      check();
      if (!updateHtml.includes(needle)) errors.push(`${label}: update.html lost the line ${JSON.stringify(needle)}.`);
    }
    const shareInputs = [...updateHtml.matchAll(/<input\b[^>]*name="okay_to_share_publicly"[^>]*>/g)].map((m) => m[0]);
    check();
    if (shareInputs.length !== 2 || !shareInputs.every((t) => /type="radio"/.test(t)) || !shareInputs.some((t) => /value="Yes"/.test(t)) || !shareInputs.some((t) => /value="No"/.test(t))) {
      errors.push(`${label}: update.html's okay_to_share_publicly must be exactly two radio inputs, Yes and No (found ${shareInputs.length}).`);
    }
    for (const name of ["name", "email", "company", "role", "city", "win_or_progress", "help_needed", "current_challenge", "introduction_requested", "workshop_topics", "dinner_city", "community_shoutout", "okay_to_share_publicly", "additional_context"]) {
      check();
      if (!new RegExp(`name="${name}"`).test(updateHtml)) errors.push(`${label}: update.html lost the field name "${name}" the lead email and intake row are keyed on.`);
    }
    // A confirmed Update is answered with a visible thank-you panel that
    // replaces the whole wizard, not a one-line status (28 Sep 2026).
    check();
    if (!/data-success-panel="#update-form-wrap"/.test(updateHtml)) errors.push(`${label}: update.html's form no longer opts into the thank-you panel (data-success-panel="#update-form-wrap").`);
    if (!/data-success-title="[^"]+"/.test(updateHtml)) errors.push(`${label}: update.html's form has no data-success-title for the thank-you panel.`);
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

  // Workshop records: same treatment as episodes - no missing flyer, every
  // workshop has a usable slug, and (built tree only) a generated
  // /workshops/<slug>/ page actually exists. Scooter asked for workshops to
  // be listed "the same way as the podcast episodes."
  const workshopsPath = path.join(dir, "assets", "data", "workshops.json");
  check();
  if (!fs.existsSync(workshopsPath)) {
    errors.push(`${label}: assets/data/workshops.json is missing.`);
  } else {
    let workshops;
    try { workshops = JSON.parse(fs.readFileSync(workshopsPath, "utf8")); }
    catch (err) { errors.push(`${label}: workshops.json is not valid JSON: ${err.message}`); workshops = []; }
    if (!Array.isArray(workshops) || !workshops.length) errors.push(`${label}: workshops.json lists zero workshops.`);
    for (const w of workshops) {
      check();
      const flyerAbs = path.join(dir, w.flyer || "");
      if (!w.flyer || !fs.existsSync(flyerAbs)) {
        errors.push(`${label}: workshop "${w.title}" flyer "${w.flyer}" does not exist.`);
      }
      check();
      if (!w.slug || !/^[a-z0-9-]+$/.test(w.slug)) {
        errors.push(`${label}: workshop "${w.title}" has no usable slug for /workshops/<slug>.`);
      } else if (isBuilt && !fs.existsSync(path.join(dir, "workshops", w.slug, "index.html"))) {
        errors.push(`${label}: workshop "${w.title}" slug "${w.slug}" has no generated /workshops/${w.slug}/ page.`);
      }
    }
  }

  // The iMessage/social preview: every page carries the branded card image,
  // never a guest photo scraped by the browser's own fallback (Scooter:
  // "Change the iMessage preview image to a 'Good People Should Meet Good
  // People' card instead of showing Shanna and Darean").
  for (const abs of files) {
    const r = rel(abs);
    const html = fs.readFileSync(abs, "utf8");
    check();
    if (!/<meta property="og:image" content="https:\/\/joinwestpeek\.com\/assets\/img\/og-good-people\.jpg"/.test(html)) {
      errors.push(`${r}: missing the branded og:image (og-good-people.jpg) - the social preview would fall back to whatever photo the browser scrapes.`);
    }
  }

  // The scroll cue (Scooter, 27 Sep 2026: "I don't know if people know they can
  // scroll on the flyers"). Every sideways scroller - the event-history flyer
  // carousels and the More Episodes / workshops rows - must be wrapped by
  // community.js with a hint line, labelled previous/next arrows and edge fades
  // that community.css actually styles; the cue must remove itself when the
  // track fits. A scroller with no cue is the defect he named.
  const jsPath = path.join(dir, "assets", "community.js");
  const cssPath = path.join(dir, "assets", "community.css");
  check();
  if (!fs.existsSync(jsPath) || !fs.existsSync(cssPath)) {
    errors.push(`${label}: assets/community.js or assets/community.css is missing - no scroll cue can run.`);
  } else {
    const js = fs.readFileSync(jsPath, "utf8");
    const css = fs.readFileSync(cssPath, "utf8");
    const jsNeeds = [
      ["function heroTyping(", "the live-hero typing loop"],
      ["'data-phrases'", "the hero reading its phrases from the markup"],
      ["prefers-reduced-motion", "the reduced-motion guard on the hero typing"],
      ["'wpc-visually-hidden'", "keeping the brief's line in the DOM for readers while typing runs"],
      ["function scrollCue(", "the scrollCue enhancer"],
      ["wpc-scroller__hint", "the hint line"],
      ["'Scroll back'", "the labelled previous arrow"],
      ["'Scroll forward'", "the labelled next arrow"],
      ["'data-at-end'", "the end-of-track state"],
      ["'data-fits'", "the everything-fits state that hides the cue"],
      ["scrollCue(carousel,", "the flyer carousel wired to the cue"],
      ["scrollCue(row,", "the More Episodes / workshops row wired to the cue"],
    ];
    for (const [needle, what] of jsNeeds) {
      check();
      if (!js.includes(needle)) errors.push(`${label}: assets/community.js lost ${what} (${needle}) - people would not know the flyers scroll.`);
    }
    const cssNeeds = [
      [".wpc-hero__caret", "the hero caret"],
      ["@keyframes wpc-caret", "the caret blink"],
      [".wpc-visually-hidden", "the off-screen class the hero line moves to"],
      [".wpc-hero__scroll", "the scroll-to-Origin cue"],
      ['.wpc-section h2[data-accent="pitch"]', "the accent colour on a sentence heading (the /pitch winners heading)"],
      [".wp-form-thanks", "the thank-you panel forms.js shows after a confirmed submission"],
      [".wpc-scroller__edge--end", "the end-edge fade"],
      ["[data-at-end] .wpc-scroller__edge--end", "hiding the end fade at the end of the track"],
      ["[data-fits] .wpc-scroller__bar", "hiding the cue when everything fits"],
      [".wpc-scroller__btn", "the arrow buttons"],
    ];
    for (const [needle, what] of cssNeeds) {
      check();
      if (!css.includes(needle)) errors.push(`${label}: assets/community.css lost ${what} (${needle}).`);
    }
    // Under prefers-reduced-motion the caret and scroll nudge must not run.
    check();
    const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] || "";
    if (!/animation:\s*none\s*!important/.test(rm)) errors.push(`${label}: the prefers-reduced-motion block no longer switches animations off.`);
    // The edge fade must stay a hint, not a curtain (Scooter, 28 Sep 2026:
    // the side flyers faded so far into white that Jason Geter's face was
    // hard to see): at most 32px wide, and starting from a colour that is at
    // most 60% opaque.
    check();
    const edgeRule = /\.wpc-scroller__edge\s*\{([^}]*)\}/.exec(css)?.[1] || "";
    const edgeWidth = parseFloat(/width\s*:\s*([\d.]+)px/.exec(edgeRule)?.[1] || "NaN");
    if (!(edgeWidth <= 32)) errors.push(`${label}: .wpc-scroller__edge width is ${edgeWidth}px, must be <= 32px so side flyers stay visible.`);
    const fadeAlpha = parseFloat(/--wp-scroller-fade\s*:\s*rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(css)?.[1] || "NaN");
    if (!(fadeAlpha <= 0.6)) errors.push(`${label}: --wp-scroller-fade alpha is ${fadeAlpha}, must be <= 0.6 (a solid fade hid the side flyers).`);
    for (const edge of ["--start", "--end"]) {
      check();
      const rule = new RegExp(`\\.wpc-scroller__edge${edge}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || "";
      if (!/var\(--wp-scroller-fade\)/.test(rule)) errors.push(`${label}: .wpc-scroller__edge${edge} does not fade from var(--wp-scroller-fade).`);
    }
  }

  // The naming rule applies to the data files the pages render from, too.
  for (const dataFile of ["winners.json", "episodes.json", "history-events.json", "workshops.json"]) {
    const dp = path.join(dir, "assets", "data", dataFile);
    if (!fs.existsSync(dp)) continue;
    const txt = fs.readFileSync(dp, "utf8");
    check();
    for (const [re, what] of FORBIDDEN_PHRASES) if (re.test(txt)) errors.push(`${label}: assets/data/${dataFile} ${what}`);
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
