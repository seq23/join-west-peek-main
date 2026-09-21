// Securities disclosure + outbound link-rel validator.
//
// Two defects went undetected because the repo had no content or link-rel
// validator at all:
//
//   DISC-1  The ventures property is securities-adjacent - it names a
//           registered representative, it solicits founder submissions, and it
//           names companies - so the disclosure must be reachable from every
//           page and complete where it lives.
//
//           Owner's decision, 20 Sep 2026 (Sequoia, the registered rep): the
//           disclosure lives on ONE landing page, /disclosures, and every other
//           ventures page LINKS to it. The earlier form of this check demanded
//           the offer statement inline on every page; that pin is replaced by
//           two stricter ones rather than dropped:
//             (a) /disclosures carries the full approved language - the offer
//                 statement, the Rainmaker/FINRA/SIPC line, the success-fee
//                 paragraph, the risk paragraph and the named-companies line;
//             (b) every other ventures page carries a link to /disclosures,
//                 and carries NO inline disclosure block (the owner asked for
//                 the paragraphs off the pages, so a reappearance is a defect).
//
//   LINK-1  Five third-party links carried no rel attribute at all, four of
//           them the regulatory citations on the disclosures page itself
//           (finra.org, sipc.org, brokercheck.finra.org, rainmakersecurities.com)
//           and one on the community podcast page. The repo's own convention
//           everywhere else is rel="noopener".
//
// Runs against sites/ AND dist/, so a built page cannot regress independently
// of its source. Wired into `npm run validate` and
// .github/workflows/entity-validation.yml.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** First-party West Peek origins. Absolute links between the company's own
 *  properties are not "outbound" for the purposes of LINK-1 and are exempt.
 *  Derived from shared/identity.json so this cannot drift from the build. */
const identity = JSON.parse(
  fs.readFileSync(path.join(root, "shared", "identity.json"), "utf8")
);
const FIRST_PARTY = new Set([
  ...Object.values(identity.sites).map((s) => new URL(s.origin).hostname),
  // Sibling properties that are not build targets in this repo.
  "dilution.joinwestpeek.com",
  "westpeek.live",
]);

/** Pages that must carry an on-page securities disclosure. */
const DISCLOSURE_SCOPE = /(^|\/)ventures\//;

/** A built 404 is assembled by scripts/build.mjs from the index page's styles
 *  and footer only; it carries no body content by design and is noindex, so it
 *  is not a page a visitor reads a disclosure on. */
const DISCLOSURE_EXEMPT = /(^|\/)404\.html$/;

/** The one page that carries the language. */
const DISCLOSURE_PAGE = /(^|\/)ventures\/disclosures\/index\.html$/;

/** Approved language, 20 Sep 2026. Every one of these must appear on
 *  /disclosures, in substance. */
const OFFER_STATEMENT =
  /(does not|Nothing on this website) represents? an offer or solicitation to buy or sell (securities|Securities)/;
const REQUIRED_ON_DISCLOSURES = [
  ["offer statement", OFFER_STATEMENT],
  ["Rainmaker registered-representative line", /Sequoia Taylor is a registered representative of Rainmaker Securities, LLC, member FINRA\/SIPC/],
  ["success-fee paragraph", /RMS is entitled to a success fee/],
  ["risk paragraph", /speculative and involve a high degree of risk/],
  ["named-companies line", /Naming them is not a recommendation to buy or sell any security/],
];

/** A link to the disclosures page, in any of the forms the site writes it. */
const DISCLOSURES_LINK = /<a\b[^>]*href\s*=\s*["'](?:\/disclosures\/?|disclosures\/|\.\/disclosures\/|https:\/\/westpeek\.ventures\/disclosures\/?)["']/i;

const errors = [];
const notes = [];

function htmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(abs));
    else if (e.name.endsWith(".html")) out.push(abs);
  }
  return out.sort();
}

/** Strip the footer so a footer-only mention cannot satisfy DISC-1. The whole
 *  point of the finding is that a link in the footer was passing for a
 *  disclosure. */
function withoutFooter(html) {
  return html.replace(/<footer[\s\S]*?<\/footer>/gi, "");
}

const ANCHOR = /<a\b[^>]*>/gi;

function checkTree(label, dir) {
  const files = htmlFiles(dir);
  if (!files.length) {
    errors.push(`${label}: no HTML files found under ${dir}`);
    return { disclosurePages: 0, disclosureOk: 0, links: 0, linksOk: 0 };
  }

  let disclosurePages = 0;
  let disclosureOk = 0;
  let links = 0;
  let linksOk = 0;

  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const html = fs.readFileSync(abs, "utf8");

    // ---- DISC-1 --------------------------------------------------------
    if (DISCLOSURE_SCOPE.test(rel) && !DISCLOSURE_EXEMPT.test(rel)) {
      disclosurePages += 1;
      if (DISCLOSURE_PAGE.test(rel)) {
        const missing = REQUIRED_ON_DISCLOSURES.filter(([, re]) => !re.test(html)).map(([n]) => n);
        if (!missing.length) disclosureOk += 1;
        else errors.push(`DISC-1 ${rel}: the disclosures page is missing: ${missing.join(", ")}.`);
      } else {
        const problems = [];
        if (!DISCLOSURES_LINK.test(html)) problems.push("no link to /disclosures/");
        if (OFFER_STATEMENT.test(withoutFooter(html)))
          problems.push("carries an inline disclosure block; the owner moved the language to /disclosures (20 Sep 2026)");
        if (!problems.length) disclosureOk += 1;
        else errors.push(`DISC-1 ${rel}: ${problems.join("; ")}.`);
      }
    }

    // ---- LINK-1 --------------------------------------------------------
    for (const m of html.matchAll(ANCHOR)) {
      const tag = m[0];
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href || !/^https?:\/\//i.test(href)) continue;
      let host;
      try {
        host = new URL(href).hostname;
      } catch {
        errors.push(`LINK-1 ${rel}: unparseable href ${href}`);
        continue;
      }
      if (FIRST_PARTY.has(host)) continue;

      links += 1;
      const relAttr = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
      if (relAttr === undefined) {
        errors.push(
          `LINK-1 ${rel}: outbound link to ${host} carries no rel attribute ` +
            `(${href}). The repo convention is rel="noopener".`
        );
        continue;
      }
      const tokens = relAttr.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.includes("noopener")) {
        errors.push(
          `LINK-1 ${rel}: outbound link to ${host} has rel="${relAttr}" but ` +
            `not "noopener" (${href}).`
        );
        continue;
      }
      // An editorial or regulatory citation must not be marked as paid or
      // untrusted. Nothing in this repo is a paid placement.
      const bad = tokens.filter((t) => t === "sponsored" || t === "nofollow" || t === "ugc");
      if (bad.length) {
        errors.push(
          `LINK-1 ${rel}: citation to ${host} is marked ${bad.join("/")} ` +
            `(${href}). Editorial and regulatory citations must not be.`
        );
        continue;
      }
      linksOk += 1;
    }
  }

  notes.push(
    `${label}: disclosure page complete or linked on ${disclosureOk}/${disclosurePages} ventures page(s); ` +
      `${linksOk}/${links} outbound link(s) carry rel="noopener"`
  );
  return { disclosurePages, disclosureOk, links, linksOk };
}

const src = checkTree("sites", path.join(root, "sites"));
const built = checkTree("dist", path.join(root, "dist"));

// A source page cannot be the only one that is correct.
if (src.disclosurePages && !built.disclosurePages) {
  errors.push("dist/ has no ventures pages - did the build run?");
}

for (const n of notes) console.log(n);

if (errors.length) {
  console.error(`\nvalidate:disclosure FAILED - ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("validate:disclosure PASS");
