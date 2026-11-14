#!/usr/bin/env node
/**
 * validate:dashboard-privacy — no figure or name of Scooter's in this public repo.
 *
 * v1.0 ruling (13 Nov 2026): "No figure, client name, contract amount or contractor pay in the
 * repo, PR, logs, fixtures or commit messages; a check fails the build if loader input or a
 * fixture with real names sits in the repo."
 *
 * Fails when:
 *   1. a tracked file looks like loader input: JSON with an `owners` list carrying addresses, a
 *      `team` + `finance` pair, or dashboard row lists (invoices, projects, deals …);
 *   2. a sample row (sampleRows() in functions/_lib/pd/data.mjs) carries a name that does not start
 *      with "Sample", or an address outside example.test;
 *   3. a dashboard source, script or test carries an email address other than the routed OS inbox
 *      and the reserved test domains, or a dollar figure;
 *   4. a document copied from the private package sits in the repo (.docx, or a file named like the
 *      Operating Blueprint);
 *   5. (when DASHBOARD_PRIVATE_NAMES_FILE points at a list outside the repo, one name per line)
 *      any tracked text file contains one of those names.
 * Zero files scanned is a failure, never a pass.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { sampleRows } from '../functions/_lib/pd/data.mjs';

const failures = [];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => existsSync(f));
if (!files.length) { console.error('validate:dashboard-privacy FAILED: no files scanned'); process.exit(1); }

// 1. loader input
const ROW_LISTS = ['invoices', 'projects', 'deals', 'waiting_on_client', 'expected_receipts', 'vendor_obligations', 'project_margin', 'cash_weeks'];
let jsonScanned = 0;
for (const f of files.filter((x) => x.endsWith('.json') && !x.startsWith('node_modules/') && !x.endsWith('package-lock.json'))) {
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  jsonScanned += 1;
  if (!doc || typeof doc !== 'object') continue;
  const ownersWithMail = Array.isArray(doc.owners) ? doc.owners.some((o) => /@/.test(String(o?.email || ''))) : doc.owners && typeof doc.owners === 'object' && Object.values(doc.owners).some((o) => /@/.test(String(o?.email || '')));
  if (ownersWithMail) failures.push(`${f}: looks like an owners file (owner addresses belong outside this repo)`);
  if (doc.team && doc.finance) failures.push(`${f}: looks like dashboard loader input (team + finance)`);
  const lists = ROW_LISTS.filter((k) => Array.isArray(doc[k]) || Array.isArray(doc.team?.[k]) || Array.isArray(doc.finance?.[k]));
  if (lists.length >= 2) failures.push(`${f}: carries dashboard rows (${lists.join(', ')})`);
}

// 2. sample rows are synthetic
const NAME_KEYS = ['name', 'client', 'org', 'vendor', 'document', 'agent', 'contacts', 'approvers', 'lead', 'owner', 'item', 'milestone', 'next_action', 'initiative', 'note'];
let sampleScanned = 0;
for (const [kind, rows] of Object.entries(sampleRows(Date.UTC(2026, 10, 14)))) {
  for (const r of rows) {
    sampleScanned += 1;
    for (const k of NAME_KEYS) if (r[k] && !/^(Sample\b|First cut review|Run of show sign-off|Final files|In delivery|Planning|Wrap|Drafted)/.test(r[k])) failures.push(`sample ${kind}.${k} "${r[k]}" is not marked Sample`);
    for (const v of Object.values(r)) for (const m of String(v).match(/[\w.+-]+@[\w.-]+/g) || []) if (!/@example\.test$/.test(m)) failures.push(`sample ${kind} carries a non-test address`);
  }
}
if (!sampleScanned) failures.push('no sample rows were scanned');

// 3. addresses and figures in dashboard code
const DASH = files.filter((f) => /^(functions\/_lib\/pd\/|functions\/_lib\/productions-dashboard\.mjs|functions\/dashboard\/|scripts\/dashboard_|scripts\/test_dashboard\.mjs|scripts\/lib\/fake_d1\.mjs|workers\/productions-dashboard\/)/.test(f));
if (DASH.length < 8) failures.push(`only ${DASH.length} dashboard files found; the scan is not seeing the dashboard`);
const ALLOWED_MAIL = /^(os@joinwestpeek\.com|[\w.+-]+@(example\.test|example\.invalid|preview\.invalid))$/i;
for (const f of DASH) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.match(/[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g) || []) {
    if (/^(wrangler|types|anthropic-ai)@/.test(m) || /@\d/.test(m)) continue;
    if (!ALLOWED_MAIL.test(m)) failures.push(`${f}: carries an email address (${m.replace(/^[^@]+/, '…')})`);
  }
  for (const m of text.match(/\$\s?\d[\d,]{2,}/g) || []) failures.push(`${f}: carries a dollar figure (${m})`);
}

// 4. private package documents
for (const f of files) {
  if (/\.docx?$/i.test(f) || /operating[ _-]?blueprint/i.test(f)) failures.push(`${f}: a private package document is in the repo`);
}

// 5. a private list of names, when the runner provides one
const namesFile = process.env.DASHBOARD_PRIVATE_NAMES_FILE;
let namesNote = 'no private names list given (DASHBOARD_PRIVATE_NAMES_FILE unset)';
if (namesFile && existsSync(namesFile)) {
  const names = readFileSync(namesFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s.length >= 4);
  const textFiles = files.filter((f) => /\.(m?js|json|html|md|css|txt|toml|ya?ml)$/.test(f) && !f.startsWith('node_modules/'));
  for (const f of textFiles) {
    const text = readFileSync(f, 'utf8').toLowerCase();
    for (const n of names) if (text.includes(n.toLowerCase())) failures.push(`${f}: carries a name from the private list`);
  }
  namesNote = `${names.length} private names checked across ${textFiles.length} files`;
}

if (failures.length) {
  console.error(`validate:dashboard-privacy FAILED (${failures.length}):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`validate:dashboard-privacy OK files=${files.length} json=${jsonScanned} dashboard_files=${DASH.length} sample_rows=${sampleScanned}; ${namesNote}`);
