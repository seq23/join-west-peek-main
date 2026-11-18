#!/usr/bin/env node
/**
 * first-run (privacy): plays a visitor's first look at the privacy pages on a
 * deployed copy of one or more of the three sites.
 *
 *   npm run first-run -- --url https://<branch>.<project>.pages.dev [--url …]
 *   (or FIRST_RUN_URL; one value may list several URLs separated by " · ",
 *   commas or spaces)
 *
 * For each URL it:
 *   1. reads the homepage and tells which site it is from its canonical host;
 *   2. loads /privacy: it must answer 200, name every tool that site's privacy
 *      page has to name (Google Analytics everywhere, Microsoft Clarity on
 *      productions, Cloudflare Turnstile on ventures), carry the site's own
 *      contact address and a "Last updated" date, and carry no placeholder;
 *   3. loads EVERY page in the site's sitemap plus a missing address (the 404):
 *      each must answer as expected, link to /privacy, carry no placeholder,
 *      and any tool a page loads must be named on /privacy.
 * Prints one line starting `FIRST_RUN OK` when every step passed; exits 1 on
 * any failure. Read-only: it sends nothing to a form or to Google.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITES = {
  "westpeek.ventures": { key: "ventures", email: "info@westpeek.ventures", names: ["Google Analytics", "Cloudflare Turnstile"] },
  "joinwestpeek.com": { key: "community", email: "os@joinwestpeek.com", names: ["Google Analytics"] },
  "westpeekproductions.com": { key: "productions", email: "os@joinwestpeek.com", names: ["Google Analytics", "Microsoft Clarity"] },
};
const TOOLS = [
  { name: "Google Analytics", loaded: /googletagmanager\.com\/gtag\/js/ },
  { name: "Microsoft Clarity", loaded: /clarity\.ms\/tag\// },
  { name: "Cloudflare Turnstile", loaded: /data-bot-check\s*=\s*["']turnstile["']/ },
];
const PLACEHOLDER = /lorem ipsum|\bTODO\b|\{\{[A-Z_]+\}\}|\bTBD\b/i;

const urlsIn = (v) => String(v || "").match(/https?:\/\/[^\s,·]+/g) || [];
const urls = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--url" && process.argv[i + 1]) urls.push(...urlsIn(process.argv[++i]));
  else if (process.argv[i].startsWith("--url=")) urls.push(...urlsIn(process.argv[i].slice(6)));
}
if (!urls.length) urls.push(...urlsIn(process.env.FIRST_RUN_URL));
const bases = [...new Set(urls.map((u) => new URL(u).origin))];
if (!bases.length) {
  console.error("FIRST_RUN FAIL no URL: pass --url <preview> or set FIRST_RUN_URL");
  process.exit(1);
}

const failures = [];
const summary = [];
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "west-peek-first-run" } });
  return { status: res.status, text: await res.text() };
}

for (const base of bases) {
  const fail = (m) => failures.push(`${base} ${m}`);
  let home;
  try { home = await get(`${base}/`); } catch (e) { fail(`homepage unreachable: ${e.message}`); continue; }
  const canon = (home.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/([^/"']+)/i) || [])[1];
  const site = SITES[canon];
  if (home.status !== 200 || !site) { fail(`homepage ${home.status}; canonical host ${canon || "none"} is not one of the three sites`); continue; }

  const privacy = await get(`${base}/privacy`);
  const ptext = text(privacy.text);
  if (privacy.status !== 200) fail(`/privacy answered ${privacy.status}`);
  for (const n of site.names) if (!ptext.includes(n)) fail(`/privacy does not name ${n}`);
  if (!ptext.includes(site.email)) fail(`/privacy does not carry the contact address ${site.email}`);
  if (!/Last updated:\s*\d{1,2} \w+ \d{4}/.test(ptext)) fail(`/privacy has no "Last updated" date`);
  if (PLACEHOLDER.test(ptext)) fail(`/privacy carries a placeholder`);

  const sitemap = await get(`${base}/sitemap.xml`);
  const paths = [...sitemap.text.matchAll(/<loc>https:\/\/[^/<]+([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
  if (!paths.length) { fail(`sitemap lists no pages`); continue; }
  if (!paths.includes("/privacy")) fail(`sitemap does not list /privacy`);
  const checks = [...paths.map((p) => ({ p, want: 200 })), { p: "/first-run-missing-page", want: 404 }];
  let ok = 0;
  for (const { p, want } of checks) {
    const r = await get(`${base}${p}`);
    const before = failures.length;
    if (r.status !== want) fail(`${p} answered ${r.status}, expected ${want}`);
    if (!/<a\b[^>]*href=["'](?:https:\/\/[^"']+)?\/privacy\/?["']/i.test(r.text)) fail(`${p} has no link to /privacy`);
    if (PLACEHOLDER.test(text(r.text))) fail(`${p} carries a placeholder`);
    for (const t of TOOLS) if (t.loaded.test(r.text) && !ptext.includes(t.name)) fail(`${p} loads ${t.name}, which /privacy does not name`);
    if (failures.length === before) ok += 1;
  }
  summary.push(`${site.key} ${ok}/${checks.length} pages`);
}

// The GA4 job (PR #39) brings its own first-run, scripts/first_run.mjs. Both
// own the one `first-run` npm name, so this runs that one too when it exists:
// the privacy check never displaces the analytics check, or the reverse.
const ga = fileURLToPath(new URL("./first_run.mjs", import.meta.url));
if (existsSync(ga)) {
  const r = spawnSync(process.execPath, [ga, ...bases.flatMap((b) => ["--url", b])], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0) failures.push(`analytics first-run (scripts/first_run.mjs) exited ${r.status}: ${out.split("\n").slice(-3).join(" | ")}`);
  else summary.push(out.split("\n").filter((l) => l.startsWith("FIRST_RUN OK")).join(" ").replace(/^FIRST_RUN OK\s*/, "analytics: "));
}

if (failures.length) {
  for (const f of failures) console.error(`FIRST_RUN FAIL ${f}`);
  process.exit(1);
}
console.log(`FIRST_RUN OK privacy: ${summary.join(" · ")}`);
