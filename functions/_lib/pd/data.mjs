/**
 * Where every row comes from, and how a quick action goes back to it.
 *
 * v1.0 ruling (13 Nov 2026): "His Google Sheets are the source of truth: the dashboard reads them
 * and writes quick actions back to the row (by stable ID), then re-reads to confirm; a failed write
 * is shown, never assumed."
 *
 * Sources: Scooter names (or lets the dashboard create) two spreadsheets and one form sheet:
 *   work      — tabs Projects, Waiting on client, Deals, Agent drafts, Agent activity, Cold email log
 *   money     — tabs Invoices, Expected receipts, Vendor obligations, Project margin, Cash, Tracker
 *               (Scooter only; agents are never given this spreadsheet)
 *   inquiries — his inquiry Form response sheet (read only; never feeds any West Peek network sheet)
 * Money also reads the same-named Finance tabs of every project binder the Projects tab links
 * (dashboard brief: "Build it from the Finance tabs in each project binder, with the same layout
 * for every client"). Columns are found by header name, so a sheet with extra columns still reads.
 *
 * A SAMPLE session (preview only) reads and writes the `sample_sheet` table instead: synthetic rows,
 * no real names, the same write-then-re-read path. It never touches a connection.
 */
import { BACKUP_TABLES, dbOf, ensureSchema } from './schema.mjs';
import { accessToken, connectionRow, docusignHost, markConnection, wideGoogleScopes } from './providers.mjs';
import { daysSince, isoDay, num, toTime } from './core.mjs';

export const FUNNEL_STAGES = [
  'Relationship identified', 'Introductory conversation', 'Qualified opportunity', 'Discovery',
  'Solution and budget', 'Proposal', 'Negotiation', 'Signed agreement', 'Deposit received',
  'Delivery handoff'
];
export const COLD_EMAIL_SENDING = false;
export const COLD_EMAIL_WEEKLY_CAP = 25;
export const SYNC_MINUTES = 15;
export const STALE_MS = 2 * 3600000;

export const GROUPS = {
  work: { label: 'Work sheet', makeTitle: 'West Peek Productions · Dashboard · Work' },
  money: { label: 'Money sheet (Scooter only)', makeTitle: 'West Peek Productions · Dashboard · Money (Scooter only)' },
  tracker: { label: 'Your deal tracker', makeTitle: null },
  inquiries: { label: 'Inquiry form responses', makeTitle: null }
};
/** The group a kind is read from now: his own deal tracker, once named, wins over the Work sheet's Deals tab. */
export const groupFor = (kind, sources = {}) => (KINDS[kind].altGroup && sources[KINDS[kind].altGroup] ? KINDS[kind].altGroup : KINDS[kind].group);

const ID = ['ID', 'Row ID'];
export const KINDS = {
  projects: { group: 'work', tabs: ['Projects', 'Project register'], cols: { id: [...ID, 'Project ID'], name: ['Project', 'Name'], client: ['Client', 'Organization'], status: ['Status', 'Where it is'], milestone: ['Next milestone', 'Milestone'], milestone_date: ['Milestone date', 'Due', 'When'], lead: ['Lead'], binder: ['Binder', 'Binder link'], folder: ['Drive folder', 'Folder'], contacts: ['Contacts'], approvers: ['Approval owners', 'Approvers'], sow_envelope: ['SOW envelope', 'DocuSign envelope', 'Envelope ID'], deliverables: ['Deliverables'], email: ['Client email', 'Contact email'] } },
  waiting: { group: 'work', tabs: ['Waiting on client', 'Waiting'], cols: { id: ID, project: ['Project ID', 'Project'], item: ['Waiting for', 'Item'], since: ['Since', 'Asked on'], owner: ['Who chases', 'Owner'], status: ['Status'], received: ['Received on'], email: ['Contact email', 'Email'] } },
  // His existing tracker is read as it is laid out (Scooter, 14 Nov 2026: "make it read and update
  // that tracker without creating a second pipeline or changing the original records"): the tab is
  // found by its columns, the header row may sit below a title, and a tracker with no ID column is
  // keyed by its organization name (`keyFrom`), so no column is ever added to his sheet.
  deals: { group: 'work', altGroup: 'tracker', keyFrom: 'org', layout: ['org', 'stage'], tabs: ['Deals', 'CRM', 'Pipeline', 'Deal tracker', 'Sales tracker', 'Sales pipeline', 'Tracker', 'Leads', 'Prospects', 'Opportunities'], cols: { id: ID, org: ['Organization', 'Organisation', 'Organization name', 'Company', 'Company name', 'Client', 'Client name', 'Account', 'Prospect', 'Org'], stage: ['Stage', 'Pipeline stage', 'Deal stage', 'Funnel stage', 'Sales stage', 'Status', 'Step'], owner: ['Owner', 'Deal owner', 'Assigned to', 'Rep', 'Who'], contact: ['Contact', 'Contact name', 'Primary contact', 'Decision maker'], next_action: ['Next action', 'Next step', 'Next steps', 'Action'], next_date: ['Next date', 'Next action date', 'Next step date', 'Due', 'Due date', 'Date'], proposal_sent: ['Proposal sent', 'Proposal date', 'Proposal sent on'], follow_up: ['Follow up', 'Follow-up', 'Follow up on', 'Follow-up date', 'Follow up date'], value: ['Value', 'Deal value', 'Estimated value', 'Est. value', 'Budget'], source: ['Source', 'Lead source', 'How they heard', 'Referral'], last_contact: ['Last contact', 'Last touch', 'Last contacted'], notes: ['Notes', 'Note', 'Comments'], email: ['Contact email', 'Email', 'Email address'] } },
  drafts: { group: 'work', tabs: ['Agent drafts', 'Drafts'], cols: { id: ID, project: ['Project'], document: ['Document', 'Draft'], link: ['Link'], agent: ['Agent'], drafted: ['Drafted', 'Date'], status: ['Status'] } },
  activity: { group: 'work', tabs: ['Agent activity', 'Agent log', 'Activity'], idless: true, cols: { at: ['When', 'Date', 'Timestamp'], agent: ['Agent'], project: ['Project'], document: ['Document'], action: ['Action', 'Did'], approver: ['Approver', 'Approved by'] } },
  cold: { group: 'work', tabs: ['Cold email log'], idless: true, cols: { date: ['Date'], org: ['Organization'], recipient: ['Recipient', 'To'], subject: ['Subject'], status: ['Status'], replies: ['Replies'] } },
  invoices: { group: 'money', binder: true, tabs: ['Invoices'], cols: { id: [...ID, 'Invoice', 'Invoice #', 'Invoice number'], client: ['Client'], project: ['Project'], amount: ['Amount'], due: ['Due', 'Due date'], status: ['Status'], paid_on: ['Paid on'], email: ['Contact email', 'Billing email', 'Email'] } },
  receipts: { group: 'money', binder: true, tabs: ['Expected receipts'], cols: { id: ID, client: ['From', 'Client'], amount: ['Amount'], date: ['Expected', 'Expected on', 'Date'], confidence: ['How sure', 'Confidence'] } },
  vendors: { group: 'money', binder: true, tabs: ['Vendor obligations', 'Vendors'], cols: { id: ID, vendor: ['Vendor'], project: ['Project'], amount: ['Amount'], date: ['Due', 'Date'], note: ['Note'] } },
  margin: { group: 'money', binder: true, tabs: ['Project margin', 'Margin'], cols: { id: ID, project: ['Project'], contract: ['Contract', 'Contract value'], costs: ['Direct costs', 'Costs'], complete: ['Costs complete', 'All costs in'] } },
  cash: { group: 'money', tabs: ['Cash'], idless: true, cols: { week: ['Week of', 'Week'], opening: ['Opening cash', 'Cash now', 'Opening'], cash_in: ['Cash in', 'In'], cash_out: ['Cash out', 'Out'], closing: ['Closing cash', 'Closing'] } },
  tracker: { group: 'money', tabs: ['Tracker', 'Targets'], idless: true, cols: { measure: ['Measure'], actual: ['Actual'], target: ['Target'] } },
  inquiries: { group: 'inquiries', tabs: null, idless: true, cols: { at: ['Timestamp', 'Date'], name: ['Name', 'Your name'], org: ['Organization', 'Organization name'], email: ['Email', 'Email address'], initiative: ['Initiative', 'What are you working on?', 'Project'] } }
};
/** The header row the dashboard writes when it creates his sheets for him. */
export const TEMPLATE_HEADERS = {
  projects: ['ID', 'Project', 'Client', 'Status', 'Next milestone', 'Milestone date', 'Lead', 'Binder', 'Drive folder', 'Contacts', 'Approval owners', 'SOW envelope', 'Deliverables', 'Client email'],
  waiting: ['ID', 'Project ID', 'Waiting for', 'Since', 'Who chases', 'Status', 'Received on', 'Contact email'],
  deals: ['ID', 'Organization', 'Stage', 'Owner', 'Next action', 'Next date', 'Proposal sent', 'Follow up', 'Contact email'],
  drafts: ['ID', 'Project', 'Document', 'Link', 'Agent', 'Drafted', 'Status'],
  activity: ['When', 'Agent', 'Project', 'Document', 'Action', 'Approver'],
  cold: ['Date', 'Organization', 'Recipient', 'Subject', 'Status', 'Replies'],
  invoices: ['ID', 'Client', 'Project', 'Amount', 'Due', 'Status', 'Paid on', 'Contact email'],
  receipts: ['ID', 'From', 'Amount', 'Expected', 'How sure'],
  vendors: ['ID', 'Vendor', 'Project', 'Amount', 'Due', 'Note'],
  margin: ['ID', 'Project', 'Contract', 'Direct costs', 'Costs complete'],
  cash: ['Week of', 'Opening cash', 'Cash in', 'Cash out', 'Closing cash'],
  tracker: ['Measure', 'Actual', 'Target']
};

const norm = (s) => String(s || '').toLowerCase().replace(/^finance\s*[-:·]?\s*/, '').replace(/[^a-z0-9]/g, '');
export const spreadsheetIdFrom = (link) => (String(link || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) || String(link || '').match(/^([A-Za-z0-9_-]{30,})$/) || [])[1] || '';

/** One organization, one key: "The Sample Org, Inc." and "sample org" are the same record. */
export function orgKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^the /, '').replace(/ (inc|llc|ltd|co|corp|corporation|company|pbc)$/, '').trim().replace(/ /g, '-').slice(0, 100);
}

/** Which of this kind's columns a header line names: exact names first, then a header that starts with one. */
function headerIndex(def, line) {
  const head = (line || []).map(norm);
  const idx = {};
  const used = new Set();
  for (const pass of ['exact', 'prefix']) {
    for (const [key, names] of Object.entries(def.cols)) {
      if (idx[key] !== undefined) continue;
      const want = names.map(norm);
      const i = head.findIndex((h, j) => h && !used.has(j) && (pass === 'exact' ? want.includes(h) : want.some((w) => w.length >= 5 && h.startsWith(w))));
      if (i > -1) { idx[key] = i; used.add(i); }
    }
  }
  return idx;
}
const HEADER_SCAN = 10;

/**
 * Rows from a values grid. The header row is whichever of the top ten names the most of this kind's
 * columns (a tracker often has a title line above it). Each row: { ...keys, _row (the sheet's own
 * row number), _id }. A kind with `keyFrom` and no ID in the row is keyed by that column's value.
 */
export function parseGrid(kind, grid) {
  const def = KINDS[kind];
  let headerRow = 0;
  let idx = headerIndex(def, grid[0]);
  for (let r = 1; r < Math.min(grid.length, HEADER_SCAN); r += 1) {
    const t = headerIndex(def, grid[r]);
    if (Object.keys(t).length > Object.keys(idx).length) { headerRow = r; idx = t; }
  }
  const rows = [];
  const seen = new Set();
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    if (!line.some((v) => String(v ?? '').trim())) continue;
    const row = { _row: r + 1 };
    for (const [key, i] of Object.entries(idx)) row[key] = String(line[i] ?? '').trim();
    let id = def.idless ? `r${r + 1}` : row.id;
    if (!id && def.keyFrom && orgKey(row[def.keyFrom])) {
      const base = `k:${orgKey(row[def.keyFrom])}`;
      id = base;
      for (let n = 2; seen.has(id); n += 1) id = `${base}~${n}`;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    row._id = id;
    rows.push(row);
  }
  const recognised = !def.layout || def.layout.every((k) => idx[k] !== undefined);
  return { rows, idx, headerRow, headers: (grid[headerRow] || []).map((h) => String(h ?? '').trim()), recognised, missingId: !def.idless && !def.keyFrom && idx.id === undefined };
}

/* ------------------------------------------------------------------ Google Sheets */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
async function gfetch(env, url, init = {}) {
  const token = await accessToken(env, 'google');
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`google_${res.status}`), { status: res.status, reason: body?.error?.status || `http_${res.status}` });
  return body;
}
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
function colLetter(i) { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

async function sheetTabs(env, spreadsheetId) {
  const meta = await gfetch(env, `${SHEETS}/${spreadsheetId}?fields=properties.title,sheets.properties.title`);
  return { title: meta.properties?.title || '', tabs: (meta.sheets || []).map((s) => s.properties.title) };
}
async function readTab(env, spreadsheetId, tab) {
  const v = await gfetch(env, `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${q(tab)}!A1:Z5000`)}?valueRenderOption=FORMATTED_VALUE`);
  return v.values || [];
}
function findTab(kind, tabs) {
  const def = KINDS[kind];
  if (!def.tabs) return tabs[0] || null;
  const want = def.tabs.map(norm);
  return tabs.find((t) => want.includes(norm(t))) || null;
}

/**
 * The tab a kind reads. For deals the tab must carry an organization and a stage column, wherever
 * it sits: a named tab first, then every other tab of that spreadsheet not claimed by another kind
 * (so a Projects tab with Client and Status is never read as deals). A recognised tab with rows wins
 * over an empty one (an empty Deals tab made by "Create it for me" never hides his real tracker).
 */
async function pickTab(env, kind, spreadsheetId, tabs, siblings) {
  const named = findTab(kind, tabs);
  if (!KINDS[kind].layout) return named ? { tab: named, parsed: parseGrid(kind, await readTab(env, spreadsheetId, named)) } : null;
  const claimed = new Set(siblings.filter((k) => k !== kind).flatMap((k) => (KINDS[k].tabs || []).map(norm)));
  const order = [...(named ? [named] : []), ...tabs.filter((t) => t !== named && !claimed.has(norm(t)))].slice(0, 12);
  let empty = null;
  let fallback = null;
  let first = null;
  for (const tab of order) {
    const parsed = parseGrid(kind, await readTab(env, spreadsheetId, tab));
    if (parsed.recognised && parsed.rows.length) return { tab, parsed };
    if (parsed.recognised && !empty) empty = { tab, parsed };
    if (tab === named) fallback = { tab, parsed };
    if (!first && parsed.headers.some(Boolean)) first = parsed;
  }
  // Nothing recognised: no tab is read, but the columns seen are kept so the Deals page can name them.
  return empty || fallback || { tab: null, parsed: first, looked: order };
}

/** The stage dropdown on his tracker's Stage column, when it has one (his own words, his order). */
async function stageListFromSheet(env, spreadsheetId, tab, col, headerRow) {
  try {
    const range = `${q(tab)}!${colLetter(col)}${headerRow + 2}:${colLetter(col)}${headerRow + 40}`;
    const r = await gfetch(env, `${SHEETS}/${spreadsheetId}?ranges=${encodeURIComponent(range)}&fields=sheets.data.rowData.values.dataValidation`);
    for (const row of r.sheets?.[0]?.data?.[0]?.rowData || []) {
      for (const v of row.values || []) {
        const c = v.dataValidation?.condition;
        if (c?.type === 'ONE_OF_LIST') { const list = (c.values || []).map((x) => String(x.userEnteredValue || '').trim()).filter(Boolean); if (list.length >= 2) return list; }
      }
    }
  } catch { /* no dropdown read: the stages come from the rows */ }
  return null;
}

/**
 * The stages a deal can be moved to, in order: his Stage column's dropdown when it has one; the ten
 * funnel stages when every stage his rows use is one of them; otherwise his own stage words, in the
 * order they first appear. `ordered` says whether "next stage" means anything.
 */
export function stageOptions(deals, listed = null) {
  if (listed?.length >= 2) return { stages: listed, ordered: true };
  const seen = [...new Set(deals.map((d) => String(d.stage || '').trim()).filter(Boolean))];
  const funnel = FUNNEL_STAGES.map((x) => x.toLowerCase());
  if (seen.every((x) => funnel.includes(x.toLowerCase()))) return { stages: FUNNEL_STAGES, ordered: true };
  return { stages: seen, ordered: false };
}

/* ------------------------------------------------------------------ sample rows (preview only) */

const DAY = 86400000;
/** Synthetic rows for the preview's sample mode. Every name is "Sample …" (scripts/validate_dashboard_privacy.mjs pins it). */
export function sampleRows(now = Date.now()) {
  const d = (n) => isoDay(now + n * DAY);
  return {
    projects: [
      { id: 'SP1', name: 'Sample Project One', client: 'Sample Org A', status: 'In delivery', milestone: 'First cut review', milestone_date: d(2), lead: 'Sample Lead', binder: 'https://docs.google.com/spreadsheets/d/sample-binder-one', folder: 'https://drive.google.com/drive/folders/sample-folder-one', contacts: 'Sample Contact A (sample-a@example.test)', approvers: 'Sample Approver A', sow_envelope: '', deliverables: 'https://drive.google.com/file/d/sample-cut-one', email: 'sample-a@example.test' },
      { id: 'SP2', name: 'Sample Project Two', client: 'Sample Org B', status: 'Planning', milestone: 'Run of show sign-off', milestone_date: d(5), lead: 'Sample Lead', binder: '', folder: '', contacts: 'Sample Contact B', approvers: 'Sample Approver B', sow_envelope: '', deliverables: '', email: 'sample-b@example.test' },
      { id: 'SP3', name: 'Sample Project Three', client: 'Sample Org C', status: 'Wrap', milestone: 'Final files', milestone_date: d(9), lead: 'Sample Lead', binder: '', folder: '', contacts: '', approvers: '', sow_envelope: '', deliverables: '', email: '' }
    ],
    waiting: [
      { id: 'SW1', project: 'SP1', item: 'Sample logo files', since: d(-16), owner: 'Sample Lead', status: 'Waiting', received: '', email: 'sample-a@example.test' },
      { id: 'SW2', project: 'SP2', item: 'Sample speaker list', since: d(-8), owner: 'Sample Lead', status: 'Waiting', received: '', email: 'sample-b@example.test' },
      { id: 'SW3', project: 'SP3', item: 'Sample approval on cut', since: d(-2), owner: 'Sample Lead', status: 'Waiting', received: '', email: '' }
    ],
    deals: [
      { id: 'SD1', org: 'Sample Org D', stage: 'Discovery', owner: 'Sample Lead', next_action: 'Sample follow-up call', next_date: d(3), proposal_sent: '', follow_up: '', email: '' },
      { id: 'SD2', org: 'Sample Org E', stage: 'Proposal', owner: 'Sample Lead', next_action: 'Sample proposal follow-up', next_date: d(-1), proposal_sent: d(-10), follow_up: d(-1), email: 'sample-e@example.test' },
      { id: 'SD3', org: 'Sample Org F', stage: 'Relationship identified', owner: 'Sample Lead', next_action: 'Sample intro', next_date: d(7), proposal_sent: '', follow_up: '', email: '' },
      { id: 'SD4', org: 'Sample Org A', stage: 'Delivery handoff', owner: 'Sample Lead', next_action: 'Sample wrap call', next_date: d(12), proposal_sent: d(-50), follow_up: '', email: 'sample-a@example.test' }
    ],
    drafts: [
      { id: 'SA1', project: 'SP1', document: 'Sample client update draft', link: 'https://docs.google.com/document/d/sample-draft-one', agent: 'Sample client-update assistant', drafted: d(-1), status: 'Waiting' }
    ],
    activity: [
      { id: 'r2', at: d(-1), agent: 'Sample client-update assistant', project: 'SP1', document: 'Sample client update draft', action: 'Drafted', approver: '' }
    ],
    cold: [],
    invoices: [
      { id: 'SI1', client: 'Sample Org A', project: 'SP1', amount: '4200', due: d(-12), status: 'Sent', paid_on: '', email: 'sample-a@example.test' },
      { id: 'SI2', client: 'Sample Org B', project: 'SP2', amount: '2500', due: d(4), status: 'Sent', paid_on: '', email: 'sample-b@example.test' },
      { id: 'SI3', client: 'Sample Org C', project: 'SP3', amount: '1800', due: d(20), status: 'Draft', paid_on: '', email: '' }
    ],
    receipts: [{ id: 'SR1', client: 'Sample Org B', amount: '2500', date: d(6), confidence: 'Promised' }],
    vendors: [{ id: 'SV1', vendor: 'Sample Crew Co', project: 'SP1', amount: '1200', date: d(10), note: 'Sample crew day' }],
    margin: [
      { id: 'SM1', project: 'SP1', contract: '12000', costs: '7000', complete: 'Yes' },
      { id: 'SM2', project: 'SP2', contract: '8000', costs: '2000', complete: 'No' }
    ],
    cash: [
      { id: 'r2', week: d(0), opening: '15000', cash_in: '2500', cash_out: '1800', closing: '15700' },
      { id: 'r3', week: d(7), opening: '15700', cash_in: '0', cash_out: '1200', closing: '14500' },
      { id: 'r4', week: d(14), opening: '14500', cash_in: '4200', cash_out: '900', closing: '17800' },
      { id: 'r5', week: d(21), opening: '17800', cash_in: '0', cash_out: '1500', closing: '16300' }
    ],
    tracker: [
      { id: 'r2', measure: 'Signed', actual: '20000', target: '60000' },
      { id: 'r3', measure: 'Invoiced', actual: '8500', target: '60000' },
      { id: 'r4', measure: 'Collected', actual: '4300', target: '60000' }
    ],
    inquiries: [
      { id: 'r2', at: d(-60), name: 'Sample Person A', org: 'Sample Org A', email: 'sample-a@example.test', initiative: 'Sample donor film' },
      { id: 'r3', at: d(-21), name: 'Sample Person E', org: 'Sample Org E', email: 'sample-e@example.test', initiative: 'Sample member summit' },
      { id: 'r4', at: d(-1), name: 'Sample Person', org: 'Sample Org G', email: 'sample-g@example.test', initiative: 'Sample annual gathering' }
    ]
  };
}
const SAMPLE_VERSION = 2;
/** Fills the sample sheet once per sample version; rows already there (and moved) are kept. */
async function ensureSample(db, now) {
  const have = await db.prepare("SELECT value FROM setting WHERE key = 'sample_version'").first();
  const count = await db.prepare('SELECT COUNT(*) AS n FROM sample_sheet').first();
  if (Number(count?.n) > 0 && have && JSON.parse(have.value) === SAMPLE_VERSION) return;
  const stmts = [];
  for (const [kind, rows] of Object.entries(sampleRows(now))) {
    for (const r of rows) stmts.push(db.prepare('INSERT OR IGNORE INTO sample_sheet (kind, row_id, data) VALUES (?,?,?)').bind(kind, r.id, JSON.stringify(r)));
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO setting (key, value) VALUES ('sample_version', ?)").bind(JSON.stringify(SAMPLE_VERSION)));
  await db.batch(stmts);
}

/* ------------------------------------------------------------------ reading what is on screen */

/**
 * Everything a screen needs. { sample, rows: {kind: [...]}, sync: {kind: state}, sources, connections }.
 * Real sessions read the last synced copy (row_cache); sample sessions read sample_sheet.
 */
export async function loadView(env, { sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const rows = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  const sync = {};
  if (sample) {
    await ensureSample(db, now);
    for (const r of (await db.prepare('SELECT kind, row_id, data FROM sample_sheet').all()).results || []) {
      if (rows[r.kind]) rows[r.kind].push({ ...JSON.parse(r.data), _id: r.row_id, _origin: 'Sample sheet' });
    }
    for (const k of Object.keys(KINDS)) sync[k] = { status: 'ok', synced_at: now, rows: rows[k].length, origins: 'Sample sheet' };
    return { sample: true, rows, sync, sources: { work: { title: 'Sample work sheet' }, money: { title: 'Sample money sheet' }, inquiries: { title: 'Sample form responses' } }, settings: {} };
  }
  for (const r of (await db.prepare('SELECT kind, row_id, origin, data FROM row_cache').all()).results || []) {
    if (rows[r.kind]) rows[r.kind].push({ ...JSON.parse(r.data), _id: r.row_id, _origin: JSON.parse(r.origin).title || '' });
  }
  for (const r of (await db.prepare('SELECT * FROM sync_state').all()).results || []) sync[r.kind] = r;
  const sources = {};
  for (const r of (await db.prepare('SELECT * FROM source').all()).results || []) sources[r.kind] = r;
  const settings = {};
  for (const r of (await db.prepare("SELECT key, value FROM setting WHERE key IN ('acct_cash','envelopes','last_sync_run') OR key LIKE 'disconnected:%' OR key LIKE 'layout:%'").all()).results || []) settings[r.key] = JSON.parse(r.value);
  for (const list of Object.values(rows)) list.sort((a, b) => (a._row || 0) - (b._row || 0));
  return { sample: false, rows, sync, sources, settings };
}

/* ------------------------------------------------------------------ sync */

async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)).run();
}
/** Forgets the kept copy of these kinds (a sheet he stopped using, or Money switched off). */
export async function purgeKinds(db, kinds, status = null) {
  if (!kinds.length) return;
  await db.batch([
    ...kinds.map((k) => db.prepare('DELETE FROM row_cache WHERE kind = ?').bind(k)),
    ...kinds.map((k) => (status ? db.prepare('INSERT INTO sync_state (kind, synced_at, status, error, rows, origins) VALUES (?,NULL,?,NULL,0,NULL) ON CONFLICT(kind) DO UPDATE SET status=excluded.status, rows=0, origins=NULL').bind(k, status) : db.prepare('DELETE FROM sync_state WHERE kind = ?').bind(k)))
  ]);
}
export async function getSetting(env, key) {
  const db = dbOf(env);
  await ensureSchema(db);
  const r = await db.prepare('SELECT value FROM setting WHERE key = ?').bind(key).first();
  return r ? JSON.parse(r.value) : null;
}

/**
 * Pulls every source into the cache. Runs every 15 minutes (the cron Worker) and on "Refresh now".
 * Returns { ok, failed, notes } — counts only, safe to log. ok counts each sheet section and each
 * non-Google account that synced; failed counts each that did not, so a run that did nothing says so.
 */
export async function syncAll(env, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const out = { ok: 0, failed: 0, notes: [] };
  const google = await connectionRow(env, 'google');
  const sources = {};
  for (const r of (await db.prepare('SELECT * FROM source').all()).results || []) sources[r.kind] = r;

  const moneyOff = (await db.prepare("SELECT value FROM choice WHERE key = 'money'").first())?.value === 'off';
  if (moneyOff) await purgeKinds(db, Object.keys(KINDS).filter((k) => KINDS[k].group === 'money'), 'off');

  if (google) {
    let googleOk = true;
    const binderIds = [];
    for (const group of ['work', 'tracker', 'money', 'inquiries']) {
      const src = sources[group];
      const kinds = Object.keys(KINDS).filter((k) => groupFor(k, sources) === group && !(moneyOff && KINDS[k].group === 'money'));
      if (!src || !kinds.length) continue;
      let tabs;
      try {
        ({ tabs } = await sheetTabs(env, src.spreadsheet_id));
      } catch (err) {
        googleOk = googleOk && !(err.message === 'needs_reconnect' || err.status === 401);
        for (const k of kinds) await db.prepare('INSERT INTO sync_state (kind, synced_at, status, error, rows) VALUES (?,?,?,?,0) ON CONFLICT(kind) DO UPDATE SET status=excluded.status, error=excluded.error').bind(k, null, 'failed', err.status === 404 || err.status === 403 ? 'cannot_open_sheet' : (err.reason || 'failed')).run();
        out.failed += kinds.length;
        continue;
      }
      for (const kind of kinds) {
        const origins = [];
        const all = [];
        try {
          const picked = await pickTab(env, kind, src.spreadsheet_id, tabs, kinds);
          const tab = picked?.tab || null;
          if (tab) {
            const { parsed } = picked;
            origins.push({ id: src.spreadsheet_id, tab, title: `${src.title || GROUPS[group].label} · ${tab}` });
            for (const r of parsed.rows) all.push({ r, o: origins.at(-1), id: r._id });
            if (kind === 'projects') for (const p of parsed.rows) { const b = spreadsheetIdFrom(p.binder); if (b) binderIds.push(b); }
            if (parsed.missingId) out.notes.push(`${kind}:no_id_column`);
          }
          if (KINDS[kind].layout) {
            // What the dashboard made of his tracker, said on the Deals page (column names only, never a value).
            const parsed = picked?.parsed;
            const columns = parsed ? Object.fromEntries(Object.entries(parsed.idx).map(([k, i]) => [k, parsed.headers[i]])) : {};
            const listed = tab && parsed?.recognised && parsed.idx.stage !== undefined ? await stageListFromSheet(env, src.spreadsheet_id, tab, parsed.idx.stage, parsed.headerRow) : null;
            await setSetting(db, `layout:${kind}`, { group, id: src.spreadsheet_id, title: src.title || '', tab, headerRow: parsed ? parsed.headerRow + 1 : null, recognised: Boolean(parsed?.recognised), columns, headers: (parsed?.headers || []).filter(Boolean).slice(0, 20), looked: picked?.looked || null, stages: listed, keyed: Boolean(parsed && parsed.idx.id === undefined) });
            if (!parsed?.recognised) out.notes.push(`${kind}:layout_not_recognised`);
          }
          if (KINDS[kind].binder) {
            for (const b of [...new Set(binderIds)]) {
              try {
                const bt = await sheetTabs(env, b);
                const btab = findTab(kind, bt.tabs);
                if (!btab) continue;
                const parsed = parseGrid(kind, await readTab(env, b, btab));
                origins.push({ id: b, tab: btab, title: `${bt.title} · ${btab}` });
                for (const r of parsed.rows) all.push({ r, o: origins.at(-1), id: `${b.slice(0, 6)}:${r._id}` });
              } catch { out.notes.push(`${kind}:binder_unreadable`); }
            }
          }
          const status = !tab && !origins.length ? 'missing_tab' : 'ok';
          await db.batch([
            db.prepare('DELETE FROM row_cache WHERE kind = ?').bind(kind),
            ...all.map(({ r, o, id }) => db.prepare('INSERT OR REPLACE INTO row_cache (kind, row_id, origin, data, synced_at) VALUES (?,?,?,?,?)').bind(kind, id, JSON.stringify({ id: o.id, tab: o.tab, title: o.title, sheet_row_id: r._id }), JSON.stringify(r), now)),
            db.prepare('INSERT INTO sync_state (kind, synced_at, status, error, rows, origins) VALUES (?,?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET synced_at=excluded.synced_at, status=excluded.status, error=excluded.error, rows=excluded.rows, origins=excluded.origins')
              .bind(kind, now, status, null, all.length, origins.map((o) => o.title).join(' + '))
          ]);
          out.ok += 1;
        } catch (err) {
          googleOk = googleOk && !(err.message === 'needs_reconnect' || err.status === 401);
          await db.prepare('INSERT INTO sync_state (kind, synced_at, status, error, rows) VALUES (?,?,?,?,0) ON CONFLICT(kind) DO UPDATE SET status=excluded.status, error=excluded.error').bind(kind, null, 'failed', err.reason || 'failed').run();
          out.failed += 1;
        }
      }
    }
    await markConnection(env, 'google', googleOk ? { status: 'ok', synced: now } : { status: 'broken', error: 'needs_reconnect' });
  }

  // DocuSign: the SOW envelope status for each project that names one.
  // A connection whose account details did not arrive when it connected looks them up again here;
  // without them it is a red Reconnect row, never a silent "connected" that never syncs.
  const docusign = await connectionRow(env, 'docusign');
  if (docusign) {
    try {
      const token = await accessToken(env, 'docusign', now);
      if (!docusign.meta?.base_uri || !docusign.meta?.account_id) {
        const r = await fetch(`https://${docusignHost(docusign.meta?.server)}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } });
        const u = await r.json().catch(() => ({}));
        const acct = (u.accounts || []).find((a) => a.is_default) || (u.accounts || [])[0];
        if (!r.ok || !acct?.base_uri || !acct?.account_id) throw new Error('no_account');
        docusign.meta = { ...(docusign.meta || {}), account_id: acct.account_id, base_uri: acct.base_uri };
        await db.prepare('UPDATE connection SET meta = ? WHERE provider = ?').bind(JSON.stringify(docusign.meta), 'docusign').run();
      }
      const ids = ((await db.prepare("SELECT data FROM row_cache WHERE kind = 'projects'").all()).results || []).map((r) => JSON.parse(r.data).sow_envelope).filter(Boolean);
      const statuses = {};
      for (const id of ids.slice(0, 40)) {
        const res = await fetch(`${docusign.meta.base_uri}/restapi/v2.1/accounts/${docusign.meta.account_id}/envelopes/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
        const e = await res.json().catch(() => ({}));
        statuses[id] = res.ok ? { status: e.status, at: now } : { status: 'unreadable', at: now };
      }
      await setSetting(db, 'envelopes', statuses);
      await markConnection(env, 'docusign', { status: 'ok', synced: now });
      out.ok += 1;
    } catch { await markConnection(env, 'docusign', { status: 'broken', error: 'needs_reconnect' }); out.failed += 1; }
  }

  // Dropbox: a light check that the connection still answers (search runs live).
  if (await connectionRow(env, 'dropbox')) {
    try {
      const token = await accessToken(env, 'dropbox', now);
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      await markConnection(env, 'dropbox', res.ok ? { status: 'ok', synced: now } : { status: 'broken', error: 'needs_reconnect' });
      if (res.ok) out.ok += 1; else out.failed += 1;
    } catch { await markConnection(env, 'dropbox', { status: 'broken', error: 'needs_reconnect' }); out.failed += 1; }
  }

  // Accounting: cash now from the bank accounts the tool sees (read only).
  for (const tool of ['quickbooks', 'xero']) {
    const c = await connectionRow(env, tool);
    if (!c) continue;
    try {
      const token = await accessToken(env, tool, now);
      let amount = null;
      if (tool === 'quickbooks') {
        const query = encodeURIComponent("select * from Account where AccountType = 'Bank'");
        const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${c.meta.realm}/query?query=${query}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
        const b = await res.json();
        if (!res.ok) throw new Error('read_failed');
        amount = (b.QueryResponse?.Account || []).reduce((a, x) => a + (Number(x.CurrentBalance) || 0), 0);
      } else {
        const res = await fetch('https://api.xero.com/api.xro/2.0/Reports/BankSummary', { headers: { authorization: `Bearer ${token}`, 'xero-tenant-id': c.meta.tenant, accept: 'application/json' } });
        const b = await res.json();
        if (!res.ok) throw new Error('read_failed');
        const rows = (b.Reports?.[0]?.Rows || []).flatMap((s) => s.Rows || []);
        const total = rows.find((r) => r.RowType === 'SummaryRow') || rows.at(-1);
        amount = num(total?.Cells?.at(-1)?.Value);
      }
      await setSetting(db, 'acct_cash', { tool, amount, at: now });
      await markConnection(env, tool, { status: 'ok', synced: now });
      out.ok += 1;
    } catch { await markConnection(env, tool, { status: 'broken', error: 'needs_reconnect' }); out.failed += 1; }
  }
  await setSetting(db, 'last_sync_run', { at: now, ok: out.ok, failed: out.failed });
  console.log(`OUTPUT dashboard sync ok=${out.ok} failed=${out.failed}${out.notes.length ? ` notes=${out.notes.join(',')}` : ''}`);
  return out;
}

/* ------------------------------------------------------------------ sources */

export async function setSource(env, group, link, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!GROUPS[group]) return { ok: false, why: 'not_a_sheet_link' };
  const id = spreadsheetIdFrom(link);
  if (!id) return { ok: false, why: 'not_a_sheet_link' };
  let title = '';
  try { ({ title } = await sheetTabs(env, id)); } catch (err) { return { ok: false, why: err.message === 'needs_reconnect' ? 'needs_google' : 'cannot_open_sheet' }; }
  await db.prepare('INSERT INTO source (kind, spreadsheet_id, title, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id, title=excluded.title, updated_at=excluded.updated_at').bind(group, id, title, now).run();
  return { ok: true, title };
}

/** Stops reading a sheet: its row is removed and the copy of everything read from it is forgotten. */
export async function removeSource(env, group) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!GROUPS[group]) return false;
  const before = {};
  for (const r of (await db.prepare('SELECT * FROM source').all()).results || []) before[r.kind] = r;
  const after = { ...before };
  delete after[group];
  await db.prepare('DELETE FROM source WHERE kind = ?').bind(group).run();
  await purgeKinds(db, Object.keys(KINDS).filter((k) => groupFor(k, before) === group || !after[groupFor(k, after)]));
  if (group === 'tracker' || !after[groupFor('deals', after)]) await db.prepare("DELETE FROM setting WHERE key = 'layout:deals'").run();
  return true;
}

/** Creates his Work or Money spreadsheet with every tab and header row, then names it as the source. */
export async function createSheet(env, group, now = Date.now()) {
  const kinds = Object.keys(KINDS).filter((k) => KINDS[k].group === group && TEMPLATE_HEADERS[k]);
  const body = {
    properties: { title: GROUPS[group].makeTitle },
    sheets: kinds.map((k) => ({ properties: { title: KINDS[k].tabs[0] }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: TEMPLATE_HEADERS[k].map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }] }] }))
  };
  const made = await gfetch(env, SHEETS, { method: 'POST', body: JSON.stringify(body) });
  const db = dbOf(env);
  await db.prepare('INSERT INTO source (kind, spreadsheet_id, title, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id, title=excluded.title, updated_at=excluded.updated_at').bind(group, made.spreadsheetId, made.properties.title, now).run();
  return made.spreadsheetId;
}
export const sheetUrl = (id) => (id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '');

/* ------------------------------------------------------------------ quick actions */

/** What each quick action writes. Values are what lands in the sheet cell. */
export function actionChanges(action, row, now = Date.now(), stages = stageOptions([row])) {
  switch (action) {
    case 'received': return { status: 'Received', received: isoDay(now) };
    case 'paid': return { status: 'Paid', paid_on: isoDay(now) };
    case 'approve': return { status: 'Approved' };
    case 'changes': return { status: 'Changes asked' };
    case 'skip': return { status: 'Skipped' };
    case 'stage': {
      if (!stages.ordered) return null;
      const i = stages.stages.findIndex((s) => s.toLowerCase() === String(row.stage || '').toLowerCase());
      if (i === -1 || i >= stages.stages.length - 1) return null;
      return { stage: stages.stages[i + 1] };
    }
    default: return null;
  }
}
export const ACTION_KINDS = { received: 'waiting', paid: 'invoices', approve: 'drafts', changes: 'drafts', skip: 'drafts', stage: 'deals' };
const DATE_KEYS = new Set(['received', 'paid_on', 'next_date']);
const sameCell = (k, a, b) => (DATE_KEYS.has(k) ? toTime(a) === toTime(b) : String(a ?? '').trim() === String(b ?? '').trim());

async function logAction(db, entry) {
  const r = await db.prepare('INSERT INTO action_log (at, owner_id, sample, kind, row_id, action, outcome, detail, link) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
    .bind(entry.at, entry.owner, entry.sample ? 1 : 0, entry.kind || null, entry.rowId || null, entry.action, entry.outcome, entry.detail || null, entry.link || null).first();
  return r?.id;
}

/** The stages for his deals: the dropdown read from his tracker at the last sync, or his rows. */
async function dealStages(db, sample) {
  const rows = sample
    ? ((await db.prepare("SELECT data FROM sample_sheet WHERE kind = 'deals'").all()).results || [])
    : ((await db.prepare("SELECT data FROM row_cache WHERE kind = 'deals'").all()).results || []);
  const layout = sample ? null : await db.prepare("SELECT value FROM setting WHERE key = 'layout:deals'").first();
  return stageOptions(rows.map((r) => JSON.parse(r.data)), layout ? JSON.parse(layout.value).stages : null);
}

/**
 * Writes changes to ONE row of its own sheet, found again by its ID (or, in a tracker with no ID
 * column, by its organization), then re-reads it; only what the sheet now shows counts as saved.
 * Only the cells named in `changes` are written; no row or column is ever added or removed. A
 * column his sheet does not have is skipped (status and stage are required where they are the point).
 */
async function writeRow(env, db, { kind, rowId, changes, base, label, session }, now) {
  const fail = async (detail) => ({ id: await logAction(db, { ...base, outcome: 'failed', detail }), outcome: 'failed', detail });
  if (session.sample) {
    const r = await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
    if (!r) return fail('row_not_found');
    const row = JSON.parse(r.data);
    await db.prepare('UPDATE sample_sheet SET data = ? WHERE kind = ? AND row_id = ?').bind(JSON.stringify({ ...row, ...changes }), kind, rowId).run();
    const back = JSON.parse((await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first()).data);
    const ok = Object.entries(changes).every(([k, v]) => sameCell(k, back[k], v));
    return { id: await logAction(db, { ...base, outcome: ok ? 'saved' : 'failed', detail: ok ? `${label}|Sample sheet` : 'not_confirmed' }), outcome: ok ? 'saved' : 'failed' };
  }
  const cached = await db.prepare('SELECT origin, data FROM row_cache WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
  if (!cached) return fail('row_not_found');
  const origin = JSON.parse(cached.origin);
  const row = JSON.parse(cached.data);
  try {
    const parsed = parseGrid(kind, await readTab(env, origin.id, origin.tab));
    const live = parsed.rows.find((r) => r._id === origin.sheet_row_id);
    if (!live) return fail('row_not_in_sheet');
    const data = [];
    const written = {};
    for (const [key, value] of Object.entries(changes)) {
      const col = parsed.idx[key];
      if (col === undefined) { if (key === 'status' || key === 'stage') return fail(`no_${key}_column`); continue; }
      if (sameCell(key, live[key], value)) continue;
      data.push({ range: `${q(origin.tab)}!${colLetter(col)}${live._row}`, values: [[value]] });
      written[key] = value;
    }
    if (!data.length) return fail(Object.keys(changes).some((k) => parsed.idx[k] !== undefined) ? 'nothing_to_change' : 'no_columns');
    await gfetch(env, `${SHEETS}/${origin.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
    // Re-read: only what the sheet now says counts as saved.
    const after = parseGrid(kind, await readTab(env, origin.id, origin.tab)).rows.find((r) => r._id === origin.sheet_row_id);
    const ok = after && Object.entries(written).every(([k, v]) => sameCell(k, after[k], v));
    if (ok) await db.prepare('UPDATE row_cache SET data = ?, synced_at = ? WHERE kind = ? AND row_id = ?').bind(JSON.stringify({ ...after, _id: row._id }), now, kind, rowId).run();
    return { id: await logAction(db, { ...base, outcome: ok ? 'saved' : 'failed', detail: ok ? `${label}|${origin.title}` : 'not_confirmed' }), outcome: ok ? 'saved' : 'failed' };
  } catch (err) {
    return fail(err.message === 'needs_reconnect' ? 'needs_reconnect' : err.reason || 'write_failed');
  }
}

async function currentRow(db, kind, rowId, sample) {
  const r = sample
    ? await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first()
    : await db.prepare('SELECT data FROM row_cache WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
  return r ? JSON.parse(r.data) : null;
}

/** One quick action. Returns { id (action_log), outcome: 'saved' | 'failed', detail }. */
export async function runAction(env, { action, rowId, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const kind = ACTION_KINDS[action];
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind, rowId, action };
  if (!kind) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'unknown_action' }), outcome: 'failed', detail: 'unknown_action' };
  const row = await currentRow(db, kind, rowId, session.sample);
  if (!row) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'row_not_found' }), outcome: 'failed', detail: 'row_not_found' };
  const changes = actionChanges(action, row, now, kind === 'deals' ? await dealStages(db, session.sample) : undefined);
  if (!changes) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'nothing_to_change' }), outcome: 'failed', detail: 'nothing_to_change' };
  return writeRow(env, db, { kind, rowId, changes, base, label: Object.values(changes)[0], session }, now);
}

/**
 * The deal form on a record: stage, next action and next date, written to the same row of his
 * tracker (only the cells that changed; a column his tracker does not have is left alone).
 */
export async function updateDeal(env, { rowId, fields, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind: 'deals', rowId, action: 'deal' };
  const row = await currentRow(db, 'deals', rowId, session.sample);
  if (!row) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'row_not_found' }), outcome: 'failed' };
  const { stages } = await dealStages(db, session.sample);
  const changes = {};
  const stage = String(fields.stage ?? '').trim();
  if (stage && stage !== row.stage) {
    if (!stages.some((x) => x === stage)) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'unknown_stage' }), outcome: 'failed' };
    changes.stage = stage;
  }
  const action = String(fields.next_action ?? '').trim().slice(0, 300);
  if (fields.next_action !== undefined && action !== String(row.next_action || '')) changes.next_action = action;
  const date = String(fields.next_date ?? '').trim();
  if (fields.next_date !== undefined && date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'bad_date' }), outcome: 'failed' };
  if (fields.next_date !== undefined && !sameCell('next_date', date, row.next_date) && !(date === '' && !row.next_date)) changes.next_date = date;
  if (!Object.keys(changes).length) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'nothing_to_change' }), outcome: 'failed' };
  const words = { stage: 'stage', next_action: 'next action', next_date: 'next date' };
  return writeRow(env, db, { kind: 'deals', rowId, changes, base, label: `${row.org || 'the deal'}: ${Object.keys(changes).map((k) => words[k]).join(', ')}`, session }, now);
}

/**
 * An inquiry becomes a deal in HIS tracker: one new row appended below his last one (never a second
 * pipeline, never a change to an existing row), filled only in the columns his tracker has. Then it
 * re-reads the tab and only a row that is really there counts.
 */
export async function addDealFromInquiry(env, { journey, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind: 'deals', rowId: journey.key, action: 'add_deal' };
  const fail = async (detail) => ({ id: await logAction(db, { ...base, outcome: 'failed', detail }), outcome: 'failed' });
  const inq = journey.inquiries.at(-1) || {};
  const { stages } = await dealStages(db, session.sample);
  const values = { org: journey.name, stage: stages[0] || FUNNEL_STAGES[0], contact: inq.name || '', email: inq.email || '', source: 'Website inquiry', next_action: 'Reply to the inquiry', next_date: isoDay(now) };
  if (session.sample) {
    const id = `SD-${orgKey(journey.name).slice(0, 20)}`;
    await db.prepare('INSERT OR IGNORE INTO sample_sheet (kind, row_id, data) VALUES (?,?,?)').bind('deals', id, JSON.stringify({ id, owner: 'Sample Lead', proposal_sent: '', follow_up: '', ...values })).run();
    return { id: await logAction(db, { ...base, outcome: 'saved', detail: `${journey.name}: added to the tracker|Sample sheet` }), outcome: 'saved' };
  }
  const layoutRow = await db.prepare("SELECT value FROM setting WHERE key = 'layout:deals'").first();
  const layout = layoutRow ? JSON.parse(layoutRow.value) : null;
  if (!layout?.recognised || !layout.tab) return fail('no_tracker');
  try {
    const grid = await readTab(env, layout.id, layout.tab);
    const parsed = parseGrid('deals', grid);
    if (parsed.rows.some((r) => orgKey(r.org) === journey.key)) return fail('already_in_tracker');
    const line = new Array(parsed.headers.length).fill('');
    if (parsed.idx.id !== undefined) {
      const ids = parsed.rows.map((r) => String(r.id || '').match(/^([A-Za-z-]*)(\d+)$/)).filter(Boolean);
      const top = ids.sort((a, b) => Number(b[2]) - Number(a[2]))[0];
      line[parsed.idx.id] = top ? `${top[1]}${Number(top[2]) + 1}` : `WEB-${isoDay(now).replace(/-/g, '')}`;
    }
    for (const [k, v] of Object.entries(values)) if (parsed.idx[k] !== undefined) line[parsed.idx[k]] = v;
    const range = `${q(layout.tab)}!A${parsed.headerRow + 1}`;
    await gfetch(env, `${SHEETS}/${layout.id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [line] }) });
    const after = parseGrid('deals', await readTab(env, layout.id, layout.tab)).rows.find((r) => orgKey(r.org) === journey.key);
    if (!after) return fail('not_confirmed');
    await syncAll(env, now).catch(() => null);
    return { id: await logAction(db, { ...base, outcome: 'saved', detail: `${journey.name}: added to the tracker|${layout.title ? `${layout.title} · ` : ''}${layout.tab}` }), outcome: 'saved' };
  } catch (err) {
    return fail(err.message === 'needs_reconnect' ? 'needs_reconnect' : err.reason || 'write_failed');
  }
}

/**
 * A reminder opens in HIS Gmail, written and ready; he presses Send himself. The dashboard holds no
 * Gmail permission at all (Scooter, 14 Nov 2026: the Google access "currently allow[s] broader file
 * access and email sending than this needs").
 */
export function composeLink(kind, row) {
  const what = kind === 'invoices' ? `invoice ${row.id} (due ${row.due})` : kind === 'deals' ? 'the proposal we sent' : `${row.item}`;
  const subject = kind === 'invoices' ? `Reminder: invoice ${row.id}` : kind === 'deals' ? 'Following up on our proposal' : `Reminder: ${row.item}`;
  const body = `Hi,\n\nA quick reminder about ${what}. When you have a moment, could you let me know where it stands?\n\nThank you,\nScooter`;
  return `https://mail.google.com/mail/?${new URLSearchParams({ view: 'cm', fs: '1', to: row.email || '', su: subject, body })}`;
}

/* ------------------------------------------------------------------ notes (his own, on each record) */

export const NOTE_MAX = 4000;
/** Saves his note on a lead or client. Every save is kept; the newest is the note. */
export async function saveNote(env, { subject, text, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind: 'note', rowId: subject, action: 'note' };
  if (!/^[a-z0-9~-]{1,120}$/.test(String(subject || ''))) return logAction(db, { ...base, outcome: 'failed', detail: 'row_not_found' });
  const body = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  const r = await db.prepare('INSERT INTO note (subject, sample, owner_id, at, text) VALUES (?,?,?,?,?) RETURNING id').bind(subject, session.sample ? 1 : 0, session.ownerId, now, body).first();
  const back = await db.prepare('SELECT text FROM note WHERE id = ?').bind(r?.id ?? -1).first();
  const ok = back && back.text === body;
  return logAction(db, { ...base, outcome: ok ? 'saved' : 'failed', detail: ok ? (body ? 'note' : 'note_cleared') : 'not_confirmed' });
}
/** The newest note for every record: { subject: { text, at } }. */
export async function latestNotes(env, sample) {
  const db = dbOf(env);
  await ensureSchema(db);
  const rows = (await db.prepare('SELECT n.subject, n.text, n.at FROM note n JOIN (SELECT subject, MAX(id) AS id FROM note WHERE sample = ? GROUP BY subject) m ON n.id = m.id').bind(sample ? 1 : 0).all()).results || [];
  return Object.fromEntries(rows.filter((r) => r.text).map((r) => [r.subject, { text: r.text, at: Number(r.at) }]));
}
export async function noteHistory(env, subject, sample) {
  return ((await dbOf(env).prepare('SELECT text, at FROM note WHERE subject = ? AND sample = ? ORDER BY id DESC LIMIT 20').bind(subject, sample ? 1 : 0).all()).results || []).map((r) => ({ text: r.text, at: Number(r.at) }));
}

export async function readAction(env, id) {
  if (!id) return null;
  return dbOf(env).prepare('SELECT * FROM action_log WHERE id = ?').bind(Number(id)).first();
}

/* ------------------------------------------------------------------ ticks and choices */

export async function tick(env, { item, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  await db.prepare('INSERT OR REPLACE INTO tick (item, sample, at) VALUES (?,?,?)').bind(item, sample ? 1 : 0, now).run();
}
export async function ticks(env, sample) {
  const rows = (await dbOf(env).prepare('SELECT item FROM tick WHERE sample = ?').bind(sample ? 1 : 0).all()).results || [];
  return new Set(rows.map((r) => r.item));
}
export const CHOICES = {
  accounting: { label: 'Your accounting tool', options: { quickbooks: 'QuickBooks', xero: 'Xero', sheets: 'Stay in Sheets' } },
  bank_cash: { label: 'Where cash now comes from', options: { accounting: 'From the accounting tool', sheet: 'From the Cash tab of the Money sheet' } },
  crm: { label: 'Where deals are kept', options: { sheets: 'My tracker in Google Sheets (recommended)', tool: 'A named CRM tool' } },
  money: { label: 'Money in the dashboard', options: { on: 'Show my money figures', off: 'Keep money out for now' } },
  shared_drive: { label: 'The "West Peek OS" Shared Drive', options: { yes: 'Yes, set it up', not_now: 'Not now' } },
  agent_seat: { label: 'A Workspace seat for agents (paid)', options: { yes: 'Yes, I will buy one', no: 'No' } },
  developer_view: { label: 'A developer view for Sequoia, without Money', options: { yes: 'Yes', no: 'No' } },
  link: { label: 'How you reach the dashboard', options: { hidden: 'Hidden link only', footer: 'A quiet footer link plus the home-screen icon' } }
};
export async function readChoices(env, sample) {
  if (sample) return {};
  const rows = (await dbOf(env).prepare('SELECT key, value, at FROM choice').all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}
export async function makeChoice(env, { key, value, session }, now = Date.now()) {
  if (!CHOICES[key]?.options[value] || session.sample) return false;
  const db = dbOf(env);
  await db.prepare('INSERT INTO choice (key, value, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at').bind(key, value, now).run();
  // Keep money out: the kept copy of every money row is deleted at once, not at the next sync.
  if (key === 'money' && value === 'off') await purgeKinds(db, Object.keys(KINDS).filter((k) => KINDS[k].group === 'money'), 'off');
  await logAction(db, { at: now, owner: session.ownerId, sample: false, action: `choice:${key}`, outcome: 'saved', detail: value });
  return true;
}

/* ------------------------------------------------------------------ find a document */

export async function findDocuments(env, text, { sample }) {
  const term = String(text || '').trim().slice(0, 80);
  if (!term) return { results: [], searched: [] };
  if (sample) return { results: [{ name: `Sample ${term} brief`, link: 'https://drive.google.com/file/d/sample', from: 'Sample Drive' }], searched: ['Sample Drive'] };
  const results = [];
  const searched = [];
  const failed = [];
  if (await connectionRow(env, 'google')) {
    try {
      const qs = new URLSearchParams({ q: `name contains '${term.replace(/['\\]/g, ' ')}' and trashed = false`, pageSize: '15', fields: 'files(name,webViewLink,modifiedTime)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
      const r = await gfetch(env, `https://www.googleapis.com/drive/v3/files?${qs}`);
      for (const f of r.files || []) results.push({ name: f.name, link: f.webViewLink, from: 'Google Drive', modified: f.modifiedTime });
      searched.push('Google Drive');
    } catch { failed.push('Google Drive'); }
  }
  if (await connectionRow(env, 'dropbox')) {
    try {
      const token = await accessToken(env, 'dropbox');
      const res = await fetch('https://api.dropboxapi.com/2/files/search_v2', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: term, options: { max_results: 15 } }) });
      const b = await res.json();
      if (!res.ok) throw new Error('dropbox');
      for (const m of b.matches || []) {
        const md = m.metadata?.metadata || {};
        results.push({ name: md.name, link: `https://www.dropbox.com/home${encodeURI(md.path_display || '')}`, from: 'Dropbox' });
      }
      searched.push('Dropbox');
    } catch { failed.push('Dropbox'); }
  }
  return { results, searched, failed };
}

/** Next calendar meeting whose title or attendees mention the client (live; read only). */
export async function nextMeeting(env, client, now = Date.now()) {
  if (!client || !(await connectionRow(env, 'google'))) return null;
  try {
    const qs = new URLSearchParams({ q: client, timeMin: new Date(now).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '1' });
    const r = await gfetch(env, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`);
    const e = (r.items || [])[0];
    return e ? { title: e.summary || '', at: e.start?.dateTime || e.start?.date, link: e.htmlLink } : { none: true };
  } catch { return { failed: true }; }
}

/**
 * The real-data first-run check (counts only, never a value): what is on screen against a fresh
 * read of the source. Ready for when his connections are on; the bar is 5 projects, 5 waiting
 * items, 3 invoices and a cash line that matches the Cash tab.
 */
export async function realCheck(env, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const want = { projects: 5, waiting: 5, invoices: 3, cash: 1 };
  const lines = [];
  let ok = true;
  const sources = {};
  for (const r of (await db.prepare('SELECT * FROM source').all()).results || []) sources[r.kind] = r;
  for (const [kind, min] of Object.entries(want)) {
    const shown = Number((await db.prepare('SELECT COUNT(*) AS n FROM row_cache WHERE kind = ?').bind(kind).first())?.n) || 0;
    let live = null;
    try {
      const src = sources[KINDS[kind].group];
      if (src) {
        const { tabs } = await sheetTabs(env, src.spreadsheet_id);
        const tab = findTab(kind, tabs);
        live = tab ? parseGrid(kind, await readTab(env, src.spreadsheet_id, tab)).rows.length : 0;
      }
    } catch { live = null; }
    // Binder rows are counted on screen but not in the one main tab, so on screen may be more.
    const pass = live !== null && shown >= live && shown >= min;
    ok = ok && pass;
    lines.push({ kind, shown, live, min, pass });
  }
  const cacheCash = ((await db.prepare("SELECT data FROM row_cache WHERE kind = 'cash'").all()).results || []).map((r) => JSON.parse(r.data));
  lines.push({ kind: 'cash_line', shown: cacheCash.length, live: null, min: 1, pass: cacheCash.length > 0 && cacheCash.every((c) => num(c.closing) !== null) });
  ok = ok && lines.at(-1).pass;
  return { ok, lines, at: now };
}

/* ------------------------------------------------------------------ Today */

/** What goes quiet when he disconnects an account (said on Today until he connects it again). */
const DISCONNECTED_STOPS = {
  google: 'Projects, deals, money and agents stop updating',
  dropbox: 'Finding video and media files is off',
  docusign: 'SOW signature status is paused',
  quickbooks: 'Cash now from QuickBooks is paused',
  xero: 'Cash now from Xero is paused'
};

/** The one tickable list. Each item: { key, kind, rowId, title, sub, tone, action }. */
export function todayItems(view, { connections, ticked, now = Date.now() }) {
  const items = [];
  const r = view.rows;
  for (const i of r.invoices) {
    const late = daysSince(i.due, now);
    if (!/paid/i.test(i.status || '') && late !== null && late > 0 && !/draft/i.test(i.status || '')) {
      items.push({ key: `inv:${i._id}:${i.due}`, kind: 'invoices', rowId: i._id, title: `Invoice ${i.id || ''} · ${i.client || ''}`.trim(), sub: `${late} day${late === 1 ? '' : 's'} overdue`, tone: late >= 14 ? 'red' : 'gold', action: 'chase', mail: composeLink('invoices', i), money: num(i.amount) });
    }
  }
  for (const w of r.waiting) {
    if (/received|done/i.test(w.status || '')) continue;
    const d = daysSince(w.since, now);
    if (d !== null && d >= 7) items.push({ key: `wait:${w._id}:${w.since}`, kind: 'waiting', rowId: w._id, title: `${w.item || 'An item'} · ${projectName(view, w.project)}`, sub: `Waiting ${d} days`, tone: d >= 14 ? 'red' : 'gold', action: 'received' });
  }
  for (const p of r.deals) {
    const d = daysSince(p.follow_up, now);
    if (p.proposal_sent && d !== null && d > 0 && !/signed|deposit|handoff/i.test(p.stage || '')) items.push({ key: `deal:${p._id}:${p.follow_up}`, kind: 'deals', rowId: p._id, title: `Proposal · ${p.org || ''}`, sub: `Follow-up was due ${d} day${d === 1 ? '' : 's'} ago`, tone: d >= 7 ? 'red' : 'gold', action: 'chase', mail: composeLink('deals', p) });
  }
  for (const a of r.drafts) {
    if (!/^(|waiting|new|to approve)$/i.test(String(a.status || '').trim())) continue;
    const d = daysSince(a.drafted, now);
    items.push({ key: `draft:${a._id}`, kind: 'drafts', rowId: a._id, title: `Draft · ${a.document || ''}`, sub: d === null ? 'Waiting for you' : `Drafted ${d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}`, tone: 'plain', action: 'approve', link: a.link });
  }
  for (const c of connections.filter((x) => x.status === 'broken')) {
    items.unshift({ key: `conn:${c.provider}:${c.last_error}`, kind: 'connection', rowId: c.provider, title: `${c.provider === 'google' ? 'Google' : c.provider[0].toUpperCase() + c.provider.slice(1)} stopped syncing`, sub: 'Reconnect it to bring the numbers back up to date', tone: 'red', action: 'reconnect' });
  }
  const g = connections.find((x) => x.provider === 'google');
  if (g && wideGoogleScopes(g.scopes).length) items.push({ key: `wide:google:${g.connected_at}`, kind: 'connection', rowId: 'google', title: 'Google still allows more than the dashboard needs', sub: 'Narrow it to sheets, file names and calendar events: one tap, then approve on Google', tone: 'gold', action: 'access' });
  for (const [key, at] of Object.entries(view.settings || {})) {
    const provider = key.startsWith('disconnected:') ? key.slice(13) : '';
    if (!provider || connections.some((c) => c.provider === provider)) continue;
    const label = provider === 'google' ? 'Google' : provider === 'docusign' ? 'DocuSign' : provider === 'quickbooks' ? 'QuickBooks' : provider[0].toUpperCase() + provider.slice(1);
    items.push({ key: `off:${provider}:${at}`, kind: 'connection', rowId: provider, title: `${label} is disconnected`, sub: `${DISCONNECTED_STOPS[provider] || 'What it showed is paused'} until you connect it again`, tone: 'gold', action: 'reconnect' });
  }
  for (const [kind, s] of Object.entries(view.sync)) {
    if (s.status === 'failed') items.unshift({ key: `sync:${kind}:${s.error}`, kind: 'sync', rowId: kind, title: `Could not read your ${KINDS[kind].group} sheet`, sub: s.error === 'cannot_open_sheet' ? 'The sheet could not be opened: check it still exists and is shared with you' : 'The last sync failed; the numbers below may be out of date', tone: 'red', action: 'reconnect' });
  }
  const seen = new Set();
  return items.filter((i) => !ticked.has(i.key) && !seen.has(i.key) && seen.add(i.key));
}
export function projectName(view, idOrName) {
  const p = view.rows.projects.find((x) => x._id === idOrName || x.id === idOrName);
  return p ? p.name || p.client || idOrName : idOrName || '';
}

/* ------------------------------------------------------------------ lead to client to cash */

export const JOURNEY_STEPS = ['Inquiry', 'Deal', 'Signed', 'Client', 'Invoiced', 'Paid'];
const SIGNED = /signed|deposit|handoff|won|closed won|contract/i;
const LOST = /lost|dead|declined|no go|not a fit|closed lost/i;

/**
 * One record per organization, from the first inquiry to the last payment, joined by organization
 * name (and by contact email for an inquiry whose organization was typed differently). Nothing is
 * copied anywhere: each part is still the row of its own sheet.
 */
export function journeys(view, { notes = {}, now = Date.now() } = {}) {
  const r = view.rows;
  const map = new Map();
  const at = (name) => {
    const key = orgKey(name);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { key, name: String(name).trim(), inquiries: [], deals: [], projects: [], invoices: [], receipts: [] });
    return map.get(key);
  };
  const byEmail = new Map();
  for (const d of r.deals) { const j = at(d.org); if (j) { j.deals.push(d); if (d.email) byEmail.set(d.email.toLowerCase(), j); } }
  for (const p of r.projects) { const j = at(p.client || p.name); if (j) { j.projects.push(p); if (p.email) byEmail.set(p.email.toLowerCase(), j); } }
  for (const i of r.invoices) at(i.client)?.invoices.push(i);
  for (const x of r.receipts) at(x.client)?.receipts.push(x);
  for (const i of r.inquiries) {
    const known = map.get(orgKey(i.org)) || byEmail.get(String(i.email || '').toLowerCase());
    (known || at(i.org || i.name))?.inquiries.push(i);
  }
  const envelopes = view.settings?.envelopes || {};
  const list = [...map.values()].map((j) => {
    j.name = j.deals[0]?.org || j.projects[0]?.client || j.inquiries[0]?.org || j.name;
    const deal = j.deals[0] || null;
    const signedBy = j.projects.map((p) => envelopes[p.sow_envelope]?.status).includes('completed') ? 'DocuSign' : deal && SIGNED.test(deal.stage || '') ? 'tracker' : '';
    const amount = (i) => num(i.amount) || 0;
    const invoiced = j.invoices.reduce((a, i) => a + amount(i), 0);
    const paidRows = j.invoices.filter((i) => /paid/i.test(i.status || ''));
    const paid = paidRows.reduce((a, i) => a + amount(i), 0);
    const openRows = j.invoices.filter((i) => !/paid/i.test(i.status || '') && !/draft/i.test(i.status || ''));
    const overdue = openRows.filter((i) => (daysSince(i.due, now) ?? 0) > 0);
    const lost = deal && LOST.test(deal.stage || '') && !j.projects.length && !j.invoices.length;
    let step = 0;
    if (j.inquiries.length) step = 1;
    if (deal) step = 2;
    if (signedBy) step = 3;
    if (j.projects.length) step = 4;
    if (j.invoices.length) step = 5;
    if (j.invoices.length && !openRows.length && paidRows.length) step = 6;
    const where = lost ? `Closed · ${deal.stage}` : step === 6 ? 'Paid in full'
      : step === 5 ? (overdue.length ? `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} overdue` : `Invoiced · ${openRows.length} open`)
        : step === 4 ? `Client · ${j.projects[0].status || 'project on the go'}`
          : step === 3 ? 'Signed' : step === 2 ? `Deal · ${deal.stage || 'no stage yet'}` : 'New inquiry';
    const next = overdue.length ? { text: `Chase invoice ${overdue[0].id || ''}`.trim(), date: overdue[0].due, tone: 'red' }
      : deal?.next_action ? { text: deal.next_action, date: deal.next_date, tone: (daysSince(deal.next_date, now) ?? -1) > 0 ? 'gold' : '' }
        : step === 1 ? { text: 'Reply, and add them to your tracker', date: j.inquiries.at(-1)?.at, tone: 'gold' } : null;
    const when = Math.max(0, ...j.inquiries.map((i) => toTime(i.at) || 0), ...j.invoices.map((i) => toTime(i.due) || 0), ...j.deals.map((d) => toTime(d.next_date) || 0));
    return { ...j, deal, signedBy, invoiced, paid, open: invoiced - paid - j.invoices.filter((i) => /draft/i.test(i.status || '')).reduce((a, i) => a + amount(i), 0), openRows, overdue, step, lost, where, next, when, note: notes[j.key] || null };
  });
  const rank = (j) => (j.overdue.length ? 0 : j.next?.tone === 'gold' ? 1 : j.lost ? 3 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || b.when - a.when || a.name.localeCompare(b.name));
}
/** Which list a record belongs to on the Lead to cash screen. */
export const JOURNEY_FILTERS = {
  all: { label: 'All', test: () => true },
  leads: { label: 'Leads', test: (j) => j.step <= 2 && !j.lost },
  clients: { label: 'Clients', test: (j) => j.step >= 3 },
  owed: { label: 'Owed', test: (j) => j.openRows.length > 0 }
};

/* ------------------------------------------------------------------ who can open what, and what is kept */

/**
 * Who can open each connected sheet, live from Google (names, links and sharing only; never a
 * file's contents): the sheets he named plus up to ten binders his Projects tab links.
 */
export async function fileAccess(env, view, { sample }) {
  if (sample) return { files: [{ label: 'Sample work sheet', name: 'Sample work sheet', ok: true, owners: ['Sample Lead'], people: [], anyone: false, domain: '' }], failed: 0 };
  if (!(await connectionRow(env, 'google'))) return { files: [], failed: 0, notConnected: true };
  const wanted = [];
  for (const [g, s] of Object.entries(view.sources || {})) if (GROUPS[g]) wanted.push({ id: s.spreadsheet_id, label: GROUPS[g].label });
  const binders = [...new Set(view.rows.projects.map((p) => spreadsheetIdFrom(p.binder)).filter(Boolean))].slice(0, 10);
  for (const b of binders) if (!wanted.some((w) => w.id === b)) wanted.push({ id: b, label: 'Client binder' });
  const files = [];
  let failed = 0;
  for (const w of wanted) {
    try {
      const f = await gfetch(env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(w.id)}?${new URLSearchParams({ fields: 'name,webViewLink,shared,owners(displayName,emailAddress),permissions(type,role,emailAddress,domain,displayName)', supportsAllDrives: 'true' })}`);
      const perms = f.permissions || null;
      files.push({
        label: w.label, name: f.name || '', link: f.webViewLink || sheetUrl(w.id), ok: true,
        owners: (f.owners || []).map((o) => o.displayName || o.emailAddress).filter(Boolean),
        people: perms ? perms.filter((x) => x.type === 'user' || x.type === 'group').filter((x) => x.role !== 'owner').map((x) => ({ who: x.displayName || x.emailAddress || 'Someone', email: x.emailAddress || '', role: { writer: 'can edit', commenter: 'can comment', reader: 'can view', organizer: 'manages', fileOrganizer: 'manages' }[x.role] || x.role })) : null,
        anyone: perms ? perms.some((x) => x.type === 'anyone') : null,
        domain: perms ? (perms.find((x) => x.type === 'domain')?.domain || '') : ''
      });
    } catch (err) {
      failed += 1;
      files.push({ label: w.label, name: '', link: sheetUrl(w.id), ok: false, why: err.message === 'needs_reconnect' ? 'needs_reconnect' : err.status === 403 || err.status === 401 ? 'not_allowed' : 'no_answer' });
    }
  }
  return { files, failed };
}

/** How many rows each table holds right now (counts only, never a value). */
export async function storedCounts(env) {
  const db = dbOf(env);
  await ensureSchema(db);
  const out = {};
  for (const t of BACKUP_TABLES) {
    try { out[t] = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first())?.n) || 0; } catch { out[t] = null; }
  }
  return out;
}
