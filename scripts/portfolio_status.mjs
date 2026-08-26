#!/usr/bin/env node
/**
 * Portfolio status, collected rather than asserted.
 *
 * The 20-goal board lived only in conversation. That is how several goals came
 * to be marked Done while being demonstrably not done: nothing on disk recorded
 * what had actually been verified, so each restatement inherited the last one's
 * claims instead of re-checking them.
 *
 * This writes docs/portfolio/STATUS.md from live checks and from each repo's own
 * validators. Every row is something measured at run time. Where a thing cannot
 * be checked from here - whether a Cloudflare deployment succeeded, whether a
 * Search Console property is still authorised - it is recorded as UNVERIFIABLE
 * rather than assumed, because an assumed pass is what this file exists to stop.
 *
 * Usage: node scripts/portfolio_status.mjs [--write]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const WRITE = process.argv.includes('--write');
const PORTFOLIO = path.resolve(process.env.PORTFOLIO_ROOT || path.join(process.cwd(), '..'));

const DOMAINS = [
  'billionairehighperformancecoach.com', 'spryexecutiveos.com', 'aplayermode.com',
  'virtualagency-os.com', 'porchandparty901.com', 'partyandporch.com',
  'approvalprep.com', 'horselegalguide.com', 'hicksconsulting.org',
  'founderoperatorlibrary.com', 'memphisvendorlibrary.com', 'professionalresourcelibrary.com',
  'westpeekproductions.com', 'theindustryguides.com', 'hormonesivhair.com',
  'uscisexam.com', 'theaccidentguides.com', 'neuroevalguides.com', 'dentistryguides.com',
];

const REPOS = [
  'sprylabs-hpc-site', 'local-guides-citation-velocity', 'WPP-llm',
  'authority-backlink-network', 'p-n-p', 'approvalprep', 'dream-wedding-builder',
  'join-west-peek-main', 'local-guides-generator', 'hicks-consulting-canonical',
  'horse-legal-guide-velocity',
];

async function curlCode(url) {
  try {
    const { stdout } = await run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', url]);
    return stdout.trim();
  } catch { return 'ERR'; }
}
async function curlBody(url) {
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '15', url], { maxBuffer: 8e6 });
    return stdout;
  } catch { return ''; }
}

async function checkDomain(d) {
  const [home, missing, pkg] = await Promise.all([
    curlCode(`https://${d}/`),
    curlCode(`https://${d}/zzz-does-not-exist-12345`),
    curlCode(`https://${d}/package.json`),
  ]);
  const body = await curlBody(`https://${d}/`);
  return {
    domain: d, home, missing, package_json: pkg,
    clarity: /clarity\.ms/.test(body) ? 'yes' : 'no',
    real_404: missing === '404' ? 'yes' : (missing === '301' ? 'redirect' : 'NO'),
    source_exposed: pkg === '200' ? 'YES' : 'no',
  };
}

async function checkRepo(name) {
  const dir = path.join(PORTFOLIO, name);
  const out = { repo: name };
  if (!fs.existsSync(dir)) return { ...out, present: 'MISSING' };
  try {
    const { stdout } = await run('git', ['-C', dir, 'status', '--porcelain']);
    out.uncommitted = stdout.trim() ? String(stdout.trim().split('\n').length) : '0';
  } catch { out.uncommitted = 'ERR'; }
  try {
    const { stdout } = await run('git', ['-C', dir, 'status', '-sb'], {});
    out.in_sync = /\[(ahead|behind)/.test(stdout) ? 'NO' : 'yes';
  } catch { out.in_sync = 'ERR'; }
  try {
    const { stdout } = await run('gh', ['run', 'list', '--limit', '12', '--json', 'name,conclusion'], { cwd: dir });
    const runs = JSON.parse(stdout);
    const latest = new Map();
    for (const r of runs) if (!latest.has(r.name)) latest.set(r.name, r.conclusion);
    const vals = [...latest.values()];
    out.workflows_red = String(vals.filter((v) => v === 'failure' || v === 'startup_failure').length);
    out.workflows_green = String(vals.filter((v) => v === 'success').length);
  } catch { out.workflows_red = 'UNVERIFIABLE'; out.workflows_green = 'UNVERIFIABLE'; }
  return out;
}

const rows = [];
for (const d of DOMAINS) rows.push(await checkDomain(d));
const repos = [];
for (const r of REPOS) repos.push(await checkRepo(r));

const table = (objs, cols) => {
  const head = `| ${cols.join(' | ')} |`;
  const sep = `|${cols.map(() => '---').join('|')}|`;
  const body = objs.map((o) => `| ${cols.map((c) => String(o[c] ?? '')).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
};

const stamp = new Date().toISOString().slice(0, 10);
const exposed = rows.filter((r) => r.source_exposed === 'YES').map((r) => r.domain);
const soft404 = rows.filter((r) => r.real_404 === 'NO').map((r) => r.domain);
const noClarity = rows.filter((r) => r.clarity === 'no').map((r) => r.domain);
const red = repos.filter((r) => r.workflows_red && r.workflows_red !== '0' && r.workflows_red !== 'UNVERIFIABLE');

const md = `# Portfolio status

Collected ${stamp} by \`scripts/portfolio_status.mjs\`. Every row here was measured
when this file was written. Nothing in it is carried over from a previous report.

Regenerate with \`npm run portfolio:status\`. If a claim is not in this file, it
has not been verified.

## Live domains

${table(rows, ['domain', 'home', 'real_404', 'source_exposed', 'clarity'])}

## Repositories

${table(repos, ['repo', 'in_sync', 'uncommitted', 'workflows_green', 'workflows_red'])}

## Open findings

${exposed.length ? `- **Source exposed**: \`/package.json\` returns 200 on ${exposed.join(', ')}.` : '- No source exposure detected.'}
${soft404.length ? `- **No real 404**: ${soft404.join(', ')} answer 200 for unknown paths.` : '- Every domain returns a real 404 for unknown paths.'}
${noClarity.length ? `- **No Clarity tag**: ${noClarity.join(', ')}.` : '- Clarity present on every domain checked.'}
${red.length ? `- **Red workflows**: ${red.map((r) => `${r.repo} (${r.workflows_red})`).join(', ')}.` : '- No red workflows in the most recent run of each.'}

## Not verifiable from here

- Whether a Cloudflare Pages or Workers deployment succeeded. This checks what
  the domain serves, which is a different claim.
- Whether a Search Console or Bing property is still authorised, and whether the
  GitHub secrets backing ingestion are set.
- Whether an edge-cached response matches what the current deployment contains.
  A stale cached object can keep serving a file the build no longer produces.
`;

if (WRITE) {
  fs.mkdirSync(path.join(process.cwd(), 'docs/portfolio'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'docs/portfolio/STATUS.md'), md);
  console.log(`portfolio status written: ${rows.length} domains, ${repos.length} repos`);
} else {
  console.log(md);
}
