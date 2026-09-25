// Productions search-surface validator (westpeekproductions.com).
//
// IMG-ALT-1  Bing Webmaster Site Scan (25 Sep 2026) reported "Alt attribute for
//            images is missing" on /community-as-a-service/: two logos had
//            alt="". Bing counts an empty alt as missing, so every productions
//            <img> must carry a non-empty alt.
// META-1     Every indexable productions page carries a <title> of 30-70
//            characters and a meta description of 110-160, and no two indexable
//            pages share either. On 25 Sep 2026, 10 of the 15 sitemap pages had
//            descriptions of 166-209 characters; Bing truncates past 160 and its
//            Site Scan flags titles past 70.
//
// Scope: sites/productions and dist/productions, so a built page cannot regress
// independently of its source. noindex pages (the generated 404) are exempt from
// META-1. Hard-fails if it scans zero images or zero indexable pages.
// Wired into `npm run validate` and .github/workflows/entity-validation.yml.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dirs = ["sites/productions", "dist/productions"].map((d) => path.join(root, d));
const TITLE = [30, 70];
const DESC = [110, 160];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const decode = (v) =>
  v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&middot;/g, "·").replace(/\s+/g, " ").trim();

let images = 0;
let pages = 0;
const failures = [];
for (const dir of dirs) {
  const rel0 = path.relative(root, dir);
  if (!fs.existsSync(dir)) {
    failures.push(`${rel0}: directory missing (run the build first)`);
    continue;
  }
  const titles = new Map();
  const descs = new Map();
  for (const file of walk(dir)) {
    const rel = path.relative(root, file);
    const html = fs.readFileSync(file, "utf8");
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      images++;
      const alt = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      if (!alt || !alt[2].trim()) failures.push(`IMG-ALT-1 ${rel}: ${tag}`);
    }
    if (/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) continue;
    const t = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (!t) continue; // fragments carry no document title
    pages++;
    const title = decode(t[1]);
    const dm = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
    const desc = dm ? decode(dm[1]) : "";
    if (title.length < TITLE[0] || title.length > TITLE[1]) failures.push(`META-1 ${rel}: title is ${title.length} characters (${TITLE[0]}-${TITLE[1]}): "${title}"`);
    if (!desc) failures.push(`META-1 ${rel}: no meta description`);
    else if (desc.length < DESC[0] || desc.length > DESC[1]) failures.push(`META-1 ${rel}: description is ${desc.length} characters (${DESC[0]}-${DESC[1]})`);
    if (titles.has(title)) failures.push(`META-1 ${rel}: duplicate title (also ${titles.get(title)})`); else titles.set(title, rel);
    if (desc && descs.has(desc)) failures.push(`META-1 ${rel}: duplicate description (also ${descs.get(desc)})`); else if (desc) descs.set(desc, rel);
  }
}

if (images === 0) failures.push("scanned zero <img> tags; IMG-ALT-1 cannot prove anything");
if (pages === 0) failures.push("scanned zero indexable pages; META-1 cannot prove anything");
if (failures.length) {
  console.error(`validate:productions-seo FAIL: ${failures.length} problem(s):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`validate:productions-seo PASS: ${images} images carry alt text; ${pages} indexable pages have titles ${TITLE[0]}-${TITLE[1]} and descriptions ${DESC[0]}-${DESC[1]}, all unique.`);
