// Image alt-text validator for the productions site.
//
// IMG-ALT-1  Bing Webmaster Site Scan (25 Sep 2026) reported "Alt attribute for
//            images is missing" on westpeekproductions.com/community-as-a-service/.
//            That one page carried the West Peek and Productions logos with
//            alt="", while every other productions page names them. Bing counts
//            an empty alt as missing, so on this property every <img> must carry
//            a non-empty alt.
//
// Scope: sites/productions and dist/productions, so a built page cannot regress
// independently of its source. The ventures and community properties are out of
// scope: Bing has not flagged them, and their empty-alt monograms sit beside
// visible text as decoration.
//
// Hard-fails if it scans zero images (a check that reads nothing proves nothing).
// Wired into `npm run validate` and .github/workflows/entity-validation.yml.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dirs = ["sites/productions", "dist/productions"].map((d) => path.join(root, d));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

let images = 0;
const failures = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    failures.push(`${path.relative(root, dir)}: directory missing (run the build first)`);
    continue;
  }
  for (const file of walk(dir)) {
    const html = fs.readFileSync(file, "utf8");
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      images++;
      const alt = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      if (!alt || !alt[2].trim()) failures.push(`${path.relative(root, file)}: ${tag}`);
    }
  }
}

if (images === 0) {
  console.error("validate:img-alt FAIL: scanned zero <img> tags; the check cannot prove anything.");
  process.exit(1);
}
if (failures.length) {
  console.error(`validate:img-alt FAIL: ${failures.length} image(s) without a non-empty alt:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`validate:img-alt PASS: ${images} <img> tags across sites/productions and dist/productions all carry alt text.`);
