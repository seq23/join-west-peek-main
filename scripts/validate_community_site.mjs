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

console.log(`validate:community-site: ${checks} check(s) run`);
if (errors.length) {
  console.error(`\nvalidate:community-site FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("validate:community-site PASS");
