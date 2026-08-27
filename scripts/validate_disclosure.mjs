// Securities disclosure + outbound link-rel validator.
//
// Two defects went undetected because the repo had no content or link-rel
// validator at all:
//
//   DISC-1  Six of the seven sites/ventures/ pages carried no on-page
//           securities disclosure. Only sites/ventures/disclosures/index.html
//           did; the rest carried a footer LINK to /disclosures and nothing
//           else. A footer link is not a disclosure. The ventures property is
//           securities-adjacent - it names a registered representative, it
//           solicits founder submissions, and it names companies - so the
//           statement has to be readable on the page a visitor is actually on.
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

/** Every sentence below must already appear, in substance, on
 *  sites/ventures/disclosures/index.html. A page satisfies DISC-1 by carrying
 *  the core no-offer statement; the disclosures page itself satisfies it with
 *  its own "This communication does not represent an offer..." wording. */
const OFFER_STATEMENT =
  /does not represent an offer or solicitation to buy or sell (securities|Securities)/;

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
      const body = withoutFooter(html);
      if (OFFER_STATEMENT.test(body)) disclosureOk += 1;
      else
        errors.push(
          `DISC-1 ${rel}: no on-page securities disclosure. The page body ` +
            `(footer excluded) does not state that it "does not represent an ` +
            `offer or solicitation to buy or sell securities". A footer link ` +
            `to /disclosures does not satisfy this.`
        );
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
    `${label}: securities disclosure on ${disclosureOk}/${disclosurePages} ventures page(s); ` +
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
