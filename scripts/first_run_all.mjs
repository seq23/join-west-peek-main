#!/usr/bin/env node
/**
 * first-run for this repo: one command, every first-run the open work needs.
 *   npm run first-run -- --url <preview> [--url …]   (or FIRST_RUN_URL; one value may
 *   list several URLs separated by " · ", commas or spaces)
 * 1. scripts/dashboard_first_run.mjs on each Productions URL given (public pages,
 *    favicon/link preview, the /dashboard sign-in, read, write and reload);
 * 2. scripts/first_run_privacy.mjs on every URL (privacy pages, then the GA4 first-run).
 * Prints `FIRST_RUN OK` only when every part passed; exits 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const urlsIn = (v) => String(v || "").match(/https?:\/\/[^\s,·]+/g) || [];
const urls = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--url" && process.argv[i + 1]) urls.push(...urlsIn(process.argv[++i]));
  else if (process.argv[i].startsWith("--url=")) urls.push(...urlsIn(process.argv[i].slice(6)));
}
if (!urls.length) urls.push(...urlsIn(process.env.FIRST_RUN_URL));
const bases = [...new Set(urls.map((u) => new URL(u).origin))];
if (!bases.length) { console.error("FIRST_RUN FAIL no URL: pass --url <preview> or set FIRST_RUN_URL"); process.exit(1); }

const script = (f) => fileURLToPath(new URL(`./${f}`, import.meta.url));
const run = (f, args) => {
  const r = spawnSync(process.execPath, [script(f), ...args], { encoding: "utf8", env: { ...process.env, FIRST_RUN_URL: "" } });
  process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
  return r.status === 0 && /FIRST_RUN OK/.test(r.stdout || "");
};
const failed = [];
// A local run (localhost) is the Productions site too: the dashboard treats it as a preview (core.mjs isPreviewHost).
const productions = bases.filter((b) => /productions/i.test(new URL(b).hostname) || ["localhost", "127.0.0.1"].includes(new URL(b).hostname));
for (const b of productions) if (!run("dashboard_first_run.mjs", ["--url", b])) failed.push(`dashboard ${b}`);
if (!run("first_run_privacy.mjs", bases.flatMap((b) => ["--url", b]))) failed.push("privacy + GA4");
if (failed.length) { console.error(`FIRST_RUN FAIL ${failed.join(", ")}`); process.exit(1); }
console.log(`FIRST_RUN OK ${productions.length} productions dashboard run(s); privacy + GA4 on ${bases.length} site(s)`);
