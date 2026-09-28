#!/usr/bin/env node
/**
 * Record, per source page, the date its content last actually changed.
 *
 * The sitemaps in this repo were hand-maintained and carried no <lastmod> at
 * all, so a crawler had no freshness signal for any of these URLs. The obvious
 * fix - stamping the build date - is worse than nothing: it is a false claim
 * about every page that did not change, and it makes the signal uninformative
 * for the ones that did.
 *
 * So the date comes from git: the commit date of the last commit that touched
 * that page's source file. That is a real record of when the content changed.
 *
 * Two rules, both about not inventing dates:
 *   - A shallow clone does not contain the history this reads. Cloudflare Pages
 *     and most CI checkouts are shallow by default, so this refuses to run
 *     there rather than silently writing today's date for everything. The
 *     resulting ledger is committed, and the build reads it.
 *   - A file with no commit history yet (new, uncommitted) gets no entry. The
 *     build then emits its <url> without a <lastmod>, which is honest.
 *
 * Usage: node scripts/lastmod_from_git.mjs [--check]
 *   --check exits non-zero if the ledger is out of date, for CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const LEDGER = path.join(ROOT, 'shared', 'lastmod.json');
const CHECK = process.argv.includes('--check');

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

if (git(['rev-parse', '--is-shallow-repository']) !== 'false') {
  console.error(
    'lastmod: refusing to run in a shallow clone - the commit dates this reads are not present, ' +
    'and stamping the build date instead would be a false freshness claim. ' +
    'Run with a full clone (actions/checkout fetch-depth: 0) or use the committed ledger.'
  );
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, full));
  }
  return out;
}

const pages = walk(path.join(ROOT, 'sites')).sort();
const entries = {};
const missing = [];
for (const rel of pages) {
  const iso = git(['log', '-1', '--format=%cI', '--', rel]);
  if (!iso) { missing.push(rel); continue; }
  entries[rel] = iso.slice(0, 10);
}

/**
 * Community episode pages are BUILD OUTPUT, not source files under sites/ -
 * scripts/build.mjs generates dist/community/episodes/<slug>/index.html from
 * sites/community/episode-template.html + assets/data/episodes.json. Neither
 * of those is a page the walk above finds, so without this they would ship
 * with no <lastmod> forever, which CI's entity-graph check treats as a dated
 * sitemap gap. Date each generated page by whichever of its two real sources
 * (the template, or the record itself changing in episodes.json) changed most
 * recently - still a real git date, just attributed to the right two files.
 */
const episodesJsonRel = path.join('sites', 'community', 'assets', 'data', 'episodes.json');
const episodeTemplateRel = path.join('sites', 'community', 'episode-template.html');
const episodesJsonPath = path.join(ROOT, episodesJsonRel);
if (fs.existsSync(episodesJsonPath) && fs.existsSync(path.join(ROOT, episodeTemplateRel))) {
  const templateIso = git(['log', '-1', '--format=%cI', '--', episodeTemplateRel]);
  let episodes = [];
  try { episodes = JSON.parse(fs.readFileSync(episodesJsonPath, 'utf8')); } catch { /* validated elsewhere */ }
  for (const ep of episodes) {
    if (!ep.slug) continue;
    const rel = path.join('sites', 'community', 'episodes', ep.slug, 'index.html');
    const recordIso = git(['log', '-1', '--format=%cI', '-S', `"slug": "${ep.slug}"`, '--', episodesJsonRel]);
    const dates = [templateIso, recordIso].filter(Boolean);
    if (!dates.length) { missing.push(rel); continue; }
    entries[rel] = dates.sort().pop().slice(0, 10);
  }
}

// Same treatment for generated /workshops/<slug> pages (build output from
// workshop-template.html + workshops.json - see the comment above).
const workshopsJsonRel = path.join('sites', 'community', 'assets', 'data', 'workshops.json');
const workshopTemplateRel = path.join('sites', 'community', 'workshop-template.html');
const workshopsJsonPath = path.join(ROOT, workshopsJsonRel);
if (fs.existsSync(workshopsJsonPath) && fs.existsSync(path.join(ROOT, workshopTemplateRel))) {
  const templateIso = git(['log', '-1', '--format=%cI', '--', workshopTemplateRel]);
  let workshops = [];
  try { workshops = JSON.parse(fs.readFileSync(workshopsJsonPath, 'utf8')); } catch { /* validated elsewhere */ }
  for (const w of workshops) {
    if (!w.slug) continue;
    const rel = path.join('sites', 'community', 'workshops', w.slug, 'index.html');
    const recordIso = git(['log', '-1', '--format=%cI', '-S', `"slug": "${w.slug}"`, '--', workshopsJsonRel]);
    const dates = [templateIso, recordIso].filter(Boolean);
    if (!dates.length) { missing.push(rel); continue; }
    entries[rel] = dates.sort().pop().slice(0, 10);
  }
}

const next = {
  _why:
    'Per-source-file date of the last commit that changed that page, used for sitemap <lastmod>. ' +
    'Generated by scripts/lastmod_from_git.mjs from real git history; committed so the build can ' +
    'read it in a shallow CI clone. A page with no entry is emitted without a <lastmod> rather ' +
    'than being given an invented date.',
  generated_from: 'git log -1 --format=%cI -- <file>',
  entries,
};

const prevRaw = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8') : '';
const nextRaw = `${JSON.stringify(next, null, 2)}\n`;

if (CHECK) {
  if (prevRaw !== nextRaw) {
    console.error('lastmod: shared/lastmod.json is stale - run `npm run lastmod` and commit the result.');
    process.exit(1);
  }
  console.log(`lastmod: ledger current (${Object.keys(entries).length} pages).`);
  process.exit(0);
}

fs.writeFileSync(LEDGER, nextRaw);
const dates = [...new Set(Object.values(entries))].sort();
console.log(
  `lastmod: ${Object.keys(entries).length} pages dated from git history, ` +
  `${dates.length} distinct date(s) (${dates[0]} .. ${dates[dates.length - 1]})` +
  (missing.length ? `; ${missing.length} page(s) have no commit yet and will ship without <lastmod>: ${missing.join(', ')}` : '')
);
