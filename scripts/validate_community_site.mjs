// joinwestpeek.com community guard (trimmed 10 Nov 2026 to the rules that carry
// risk; the layout and wording pins were cut under the owner's validator bar).
//   - no navigable link from the community site to the sister properties
//     (westpeek.ventures, westpeekproductions.com, westpeek.live): Scooter's
//     20 Sep 2026 rule, same as validate_ventures_isolation.mjs;
//   - no personal address on the site; every form falls back to the routed
//     OS inbox;
//   - The Update: newsletter consent stays a Yes/No radio choice, the fields the
//     lead email and intake row are keyed on stay, and the form is gated
//     server-side (UPDATE_FORM markers + functions/update.js).
// Runs over sites/community AND dist/community.
//
// Usage: node scripts/validate_community_site.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
let checks = 0;
const check = () => { checks += 1; };
const FORBIDDEN_HOSTS = new Set(["westpeek.ventures", "www.westpeek.ventures", "westpeekproductions.com", "www.westpeekproductions.com", "westpeek.live", "www.westpeek.live"]);

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

function checkTree(label, dir, isBuilt) {
  const files = htmlFiles(dir);
  if (!files.length) { errors.push(`${label}: no HTML pages under ${dir}`); return; }

  for (const abs of files) {
    const r = rel(abs);
    const rDir = path.relative(dir, abs).split(path.sep).join("/");
    const html = fs.readFileSync(abs, "utf8");

    // Sister-property navigation. JSON-LD is structured data, not navigation, so
    // <script> blocks are stripped before the scan.
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    check();
    for (const m of withoutScripts.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      let host;
      try { host = new URL(m[1], "https://joinwestpeek.com/").hostname; } catch { continue; }
      if (FORBIDDEN_HOSTS.has(host)) errors.push(`${r}: navigable link to sister property ${m[1]}`);
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
  }

  // The Update: gated markup present, and the Function that strips it exists.
  const updatePath = path.join(dir, "update.html");
  check();
  if (fs.existsSync(updatePath)) {
    const updateHtml = fs.readFileSync(updatePath, "utf8");
    if (!updateHtml.includes("<!-- UPDATE_FORM_START -->") || !updateHtml.includes("<!-- UPDATE_FORM_END -->")) {
      errors.push(`${label}: update.html is missing the UPDATE_FORM_START/END markers functions/update.js needs to gate the form server-side.`);
    }
    // Newsletter consent is a Yes/No radio choice, never a text box; the field
    // names the lead email and the Network OS intake read stay the same.
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

  console.log(`${label}: ${files.length} page(s) checked: no sister-property links, no personal address, Update consent and gate intact`);
}

checkTree("sites", path.join(root, "sites", "community"), false);
checkTree("dist", path.join(root, "dist", "community"), true);

// The homepage, Scooter 27 Nov 2026. Each rule here is his words, checked on the built page too.
function checkHomepage(label, dir) {
  const file = path.join(dir, "index.html");
  if (!fs.existsSync(file)) { errors.push(`${label}: index.html is missing`); return; }
  const html = fs.readFileSync(file, "utf8");
  const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();
  // Six tiles, his order.
  check();
  const order = [...html.matchAll(/<section class="wpc-tile" data-tile="([a-z]+)"/g)].map((m) => m[1]);
  const want = ["about", "values", "give", "podcasts", "pitch", "workshops"];
  if (order.join() !== want.join()) errors.push(`${label}/index.html: tiles are [${order.join(", ")}]; Scooter's order is [${want.join(", ")}]`);
  check();
  const titles = [...html.matchAll(/class="wpc-tile__btn"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1]);
  if (titles.join("|") !== "About|Core Values|Give and Take|Podcasts|Pitch Competitions|Workshops") errors.push(`${label}/index.html: tile titles are "${titles.join(" | ")}"`);
  // Each tile title is a real button that controls its panel.
  check();
  for (const m of html.matchAll(/<button type="button" class="wpc-tile__btn"[^>]*aria-controls="([^"]+)"/g)) {
    if (!html.includes(`id="${m[1]}"`)) errors.push(`${label}/index.html: tile button controls #${m[1]}, which does not exist`);
  }
  if ((html.match(/class="wpc-tile__btn"[^>]*aria-expanded=/g) || []).length !== 6) errors.push(`${label}/index.html: every tile title must be a button with aria-expanded`);
  // Core Values: his three sentences, word for word.
  check();
  for (const line of ["There is enough to go around. We share what we know and who we know.", "We say what is true, including what we need.", "Nobody builds alone. Our strength is how we are connected."]) {
    if (!html.includes(line)) errors.push(`${label}/index.html: Core Values is missing his sentence "${line}"`);
  }
  // Give and Take: his line under the title, the board link and the ask box.
  check();
  if (!html.includes("Ask for what you need. Give what you can.")) errors.push(`${label}/index.html: the Give and Take tile lacks "Ask for what you need. Give what you can."`);
  if (!/href="\/give-and-take"[^>]*>See who you can help</.test(html)) errors.push(`${label}/index.html: the Give and Take tile lacks the "See who you can help" link`);
  if (!/name="lead_type" value="give_and_take_ask"/.test(html)) errors.push(`${label}/index.html: the Give and Take tile has no ask box`);
  // The proposed description he did not approve (his answer, 27 Nov 22:38 UTC: the line under the
  // title is his own words) never ships, here or on /give-and-take.
  check();
  for (const page of ["index.html", "give-and-take.html"]) {
    const f = path.join(dir, page);
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("Tell us one thing you need help with")) errors.push(`${label}/${page}: carries the Give and Take description Scooter did not approve`);
  }
  // No "hover on a computer, tap on a phone" instruction anywhere (Scooter: "Hover and tap should just work").
  check();
  if (/\b(hover|tap)\b[^.<]{0,60}\b(computer|phone|tap|hover)\b/i.test(text(html))) errors.push(`${label}/index.html: shows a hover/tap instruction; Scooter: "Don't show any 'hover on a computer, tap on a phone' instruction on the page"`);
  // The hero: the wordmark, then ONE rotating line through his four phrases, in his order.
  check();
  const phrases = (() => { try { return JSON.parse((/data-phrases='([^']+)'/.exec(html) || [])[1] || "[]"); } catch { return []; } })();
  const his = ["Good people should meet good people.", "We’re a community where you get introduced to new ideas, opportunities, and relationships.", "We’re a space for entrepreneurs, creatives and professionals.", "We help you feel less lonely building companies."];
  if (phrases.join("|") !== his.join("|")) errors.push(`${label}/index.html: the rotating line is [${phrases.join(" | ")}], not his four phrases in order`);
  if (!/id="hero-line">Good people should meet good people\.</.test(html)) errors.push(`${label}/index.html: the line's real text (no-JS, reduced motion, screen readers) must be the first phrase`);
  if ((html.match(/data-phrases=/g) || []).length !== 1) errors.push(`${label}/index.html: there must be exactly one rotating line`);
}

// The motion is off under prefers-reduced-motion: the stylesheet's reduced-motion block turns off
// every transition and the tile/button transforms (lift, spring, rise, squish).
function checkReducedMotion() {
  check();
  const css = fs.readFileSync(path.join(root, "sites", "community", "assets", "community.css"), "utf8");
  const block = (/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css) || [])[1] || "";
  if (!/transition: none !important/.test(block)) errors.push("community.css: the reduced-motion block does not turn transitions off");
  for (const sel of [".wpc-tile:hover", ".wpc-btn:active", ".wpc-rise"]) if (!block.includes(sel)) errors.push(`community.css: the reduced-motion block does not reset ${sel}`);
  if (!/transform: none !important/.test(block)) errors.push("community.css: the reduced-motion block does not reset transforms");
  const js = fs.readFileSync(path.join(root, "sites", "community", "assets", "community.js"), "utf8");
  if (!/function heroTyping\(\)[\s\S]{0,900}if \(reduceMotion\) return;/.test(js)) errors.push("community.js: the typing line must not start under prefers-reduced-motion");
}

// Give and Take never adds anyone to the network list (Scooter, 27 Nov 2026), and the board API
// never returns a name or an email.
function checkGiveTake() {
  check();
  const lead = fs.readFileSync(path.join(root, "functions", "api", "lead.js"), "utf8");
  if (!/NEVER_SHEET_FORMS = \['give_and_take_ask', 'give_and_take_offer'\]/.test(lead) || !/writesToSheet\(site, form\)/.test(lead)) errors.push("functions/api/lead.js: Give and Take must skip the network sheet (NEVER_SHEET_FORMS, writesToSheet(site, form))");
  check();
  const lib = fs.readFileSync(path.join(root, "functions", "_lib", "give-take.mjs"), "utf8");
  const board = (/export async function boardAsks[\s\S]*?\n\}/.exec(lib) || [""])[0];
  const mapped = (/rows\.map\(\(r\) => \(\{(.*)\}\)\);/.exec(board) || [])[1] || "";
  if (!mapped || /name|email/.test(mapped)) errors.push("functions/_lib/give-take.mjs: the board must return only the ask's words, kind of help, public id and day");
}

checkHomepage("sites", path.join(root, "sites", "community"));
checkHomepage("dist", path.join(root, "dist", "community"));
checkReducedMotion();
checkGiveTake();

console.log(`validate:community-site: ${checks} check(s) run`);
if (errors.length) {
  console.error(`\nvalidate:community-site FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate:community-site PASS");
