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
import { dbOf, ensureSchema } from './schema.mjs';
import { accessToken, connectionRow, markConnection } from './providers.mjs';
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
  inquiries: { label: 'Inquiry form responses', makeTitle: null }
};

const ID = ['ID', 'Row ID'];
export const KINDS = {
  projects: { group: 'work', tabs: ['Projects', 'Project register'], cols: { id: [...ID, 'Project ID'], name: ['Project', 'Name'], client: ['Client', 'Organization'], status: ['Status', 'Where it is'], milestone: ['Next milestone', 'Milestone'], milestone_date: ['Milestone date', 'Due', 'When'], lead: ['Lead'], binder: ['Binder', 'Binder link'], folder: ['Drive folder', 'Folder'], contacts: ['Contacts'], approvers: ['Approval owners', 'Approvers'], sow_envelope: ['SOW envelope', 'DocuSign envelope', 'Envelope ID'], deliverables: ['Deliverables'], email: ['Client email', 'Contact email'] } },
  waiting: { group: 'work', tabs: ['Waiting on client', 'Waiting'], cols: { id: ID, project: ['Project ID', 'Project'], item: ['Waiting for', 'Item'], since: ['Since', 'Asked on'], owner: ['Who chases', 'Owner'], status: ['Status'], received: ['Received on'], email: ['Contact email', 'Email'] } },
  deals: { group: 'work', tabs: ['Deals', 'CRM', 'Pipeline'], cols: { id: ID, org: ['Organization', 'Client'], stage: ['Stage'], owner: ['Owner'], next_action: ['Next action'], next_date: ['Next date', 'Date'], proposal_sent: ['Proposal sent'], follow_up: ['Follow up', 'Follow-up', 'Follow up on'], email: ['Contact email', 'Email'] } },
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

/** Rows from a values grid (row 1 = headers). Each row: { ...keys, _row, _id }. */
export function parseGrid(kind, grid) {
  const def = KINDS[kind];
  const head = (grid[0] || []).map(norm);
  const idx = {};
  for (const [key, names] of Object.entries(def.cols)) {
    const i = head.findIndex((h) => names.map(norm).includes(h));
    if (i > -1) idx[key] = i;
  }
  const rows = [];
  const seen = new Set();
  for (let r = 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    if (!line.some((v) => String(v ?? '').trim())) continue;
    const row = { _row: r + 1 };
    for (const [key, i] of Object.entries(idx)) row[key] = String(line[i] ?? '').trim();
    const id = def.idless ? `r${r + 1}` : row.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    row._id = id;
    rows.push(row);
  }
  return { rows, idx, missingId: !def.idless && idx.id === undefined };
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
      { id: 'SD3', org: 'Sample Org F', stage: 'Relationship identified', owner: 'Sample Lead', next_action: 'Sample intro', next_date: d(7), proposal_sent: '', follow_up: '', email: '' }
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
    inquiries: [{ id: 'r2', at: d(-1), name: 'Sample Person', org: 'Sample Org G', email: 'sample-g@example.test', initiative: 'Sample annual gathering' }]
  };
}
async function ensureSample(db, now) {
  const have = await db.prepare('SELECT COUNT(*) AS n FROM sample_sheet').first();
  if (Number(have?.n) > 0) return;
  const stmts = [];
  for (const [kind, rows] of Object.entries(sampleRows(now))) {
    for (const r of rows) stmts.push(db.prepare('INSERT OR REPLACE INTO sample_sheet (kind, row_id, data) VALUES (?,?,?)').bind(kind, r.id, JSON.stringify(r)));
  }
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
  for (const r of (await db.prepare("SELECT key, value FROM setting WHERE key IN ('acct_cash','envelopes','last_sync_run') OR key LIKE 'disconnected:%'").all()).results || []) settings[r.key] = JSON.parse(r.value);
  for (const list of Object.values(rows)) list.sort((a, b) => (a._row || 0) - (b._row || 0));
  return { sample: false, rows, sync, sources, settings };
}

/* ------------------------------------------------------------------ sync */

async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)).run();
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

  if (google) {
    let googleOk = true;
    const binderIds = [];
    for (const group of ['work', 'money', 'inquiries']) {
      const src = sources[group];
      const kinds = Object.keys(KINDS).filter((k) => KINDS[k].group === group);
      if (!src) continue;
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
        const tab = findTab(kind, tabs);
        try {
          if (tab) {
            const parsed = parseGrid(kind, await readTab(env, src.spreadsheet_id, tab));
            origins.push({ id: src.spreadsheet_id, tab, title: `${src.title || GROUPS[group].label} · ${tab}` });
            for (const r of parsed.rows) all.push({ r, o: origins.at(-1), id: r._id });
            if (kind === 'projects') for (const p of parsed.rows) { const b = spreadsheetIdFrom(p.binder); if (b) binderIds.push(b); }
            if (parsed.missingId) out.notes.push(`${kind}:no_id_column`);
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
      const token = await accessToken(env, 'docusign');
      if (!docusign.meta?.base_uri || !docusign.meta?.account_id) {
        const r = await fetch('https://account.docusign.com/oauth/userinfo', { headers: { authorization: `Bearer ${token}` } });
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
      const token = await accessToken(env, 'dropbox');
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
      const token = await accessToken(env, tool);
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
  const id = spreadsheetIdFrom(link);
  if (!id) return { ok: false, why: 'not_a_sheet_link' };
  let title = '';
  try { ({ title } = await sheetTabs(env, id)); } catch (err) { return { ok: false, why: err.message === 'needs_reconnect' ? 'needs_google' : 'cannot_open_sheet' }; }
  await db.prepare('INSERT INTO source (kind, spreadsheet_id, title, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind) DO UPDATE SET spreadsheet_id=excluded.spreadsheet_id, title=excluded.title, updated_at=excluded.updated_at').bind(group, id, title, now).run();
  return { ok: true, title };
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
export function actionChanges(action, row, now = Date.now()) {
  switch (action) {
    case 'received': return { status: 'Received', received: isoDay(now) };
    case 'paid': return { status: 'Paid', paid_on: isoDay(now) };
    case 'approve': return { status: 'Approved' };
    case 'changes': return { status: 'Changes asked' };
    case 'skip': return { status: 'Skipped' };
    case 'stage': {
      const i = FUNNEL_STAGES.findIndex((s) => s.toLowerCase() === String(row.stage || '').toLowerCase());
      if (i === -1 || i >= FUNNEL_STAGES.length - 1) return null;
      return { stage: FUNNEL_STAGES[i + 1] };
    }
    default: return null;
  }
}
export const ACTION_KINDS = { received: 'waiting', paid: 'invoices', approve: 'drafts', changes: 'drafts', skip: 'drafts', stage: 'deals' };

async function logAction(db, entry) {
  const r = await db.prepare('INSERT INTO action_log (at, owner_id, sample, kind, row_id, action, outcome, detail, link) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
    .bind(entry.at, entry.owner, entry.sample ? 1 : 0, entry.kind || null, entry.rowId || null, entry.action, entry.outcome, entry.detail || null, entry.link || null).first();
  return r?.id;
}

/**
 * Writes one quick action to the row's source, re-reads it, and logs what was SEEN.
 * Returns { id (action_log), outcome: 'saved' | 'failed', detail }.
 */
export async function runAction(env, { action, rowId, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const kind = ACTION_KINDS[action];
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind, rowId, action };
  if (!kind) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'unknown_action' }), outcome: 'failed', detail: 'unknown_action' };

  if (session.sample) {
    const r = await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
    const row = r ? JSON.parse(r.data) : null;
    const changes = row && actionChanges(action, row, now);
    if (!changes) return { id: await logAction(db, { ...base, outcome: 'failed', detail: row ? 'nothing_to_change' : 'row_not_found' }), outcome: 'failed', detail: row ? 'nothing_to_change' : 'row_not_found' };
    await db.prepare('UPDATE sample_sheet SET data = ? WHERE kind = ? AND row_id = ?').bind(JSON.stringify({ ...row, ...changes }), kind, rowId).run();
    const back = JSON.parse((await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first()).data);
    const ok = Object.entries(changes).every(([k, v]) => back[k] === v);
    return { id: await logAction(db, { ...base, outcome: ok ? 'saved' : 'failed', detail: ok ? Object.values(changes)[0] : 'not_confirmed' }), outcome: ok ? 'saved' : 'failed' };
  }

  const cached = await db.prepare('SELECT origin, data FROM row_cache WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
  if (!cached) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'row_not_found' }), outcome: 'failed', detail: 'row_not_found' };
  const origin = JSON.parse(cached.origin);
  const row = JSON.parse(cached.data);
  const changes = actionChanges(action, row, now);
  if (!changes) return { id: await logAction(db, { ...base, outcome: 'failed', detail: 'nothing_to_change' }), outcome: 'failed', detail: 'nothing_to_change' };
  try {
    const grid = await readTab(env, origin.id, origin.tab);
    const parsed = parseGrid(kind, grid);
    const live = parsed.rows.find((r) => r._id === origin.sheet_row_id);
    if (!live) throw Object.assign(new Error('row_moved'), { reason: 'row_not_in_sheet' });
    const data = [];
    for (const [key, value] of Object.entries(changes)) {
      const col = parsed.idx[key];
      if (col === undefined) { if (key === 'status' || key === 'stage') throw Object.assign(new Error('no_column'), { reason: `no_${key}_column` }); continue; }
      data.push({ range: `${q(origin.tab)}!${colLetter(col)}${live._row}`, values: [[value]] });
    }
    await gfetch(env, `${SHEETS}/${origin.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
    // Re-read: only what the sheet now says counts as saved.
    const after = parseGrid(kind, await readTab(env, origin.id, origin.tab)).rows.find((r) => r._id === origin.sheet_row_id);
    const ok = after && Object.entries(changes).every(([k, v]) => parsed.idx[k] === undefined || (k.endsWith('_on') || k === 'received' ? toTime(after[k]) === toTime(v) : after[k] === v));
    if (ok) await db.prepare('UPDATE row_cache SET data = ?, synced_at = ? WHERE kind = ? AND row_id = ?').bind(JSON.stringify({ ...after, _id: row._id }), now, kind, rowId).run();
    return { id: await logAction(db, { ...base, outcome: ok ? 'saved' : 'failed', detail: ok ? `${Object.values(changes)[0]}|${origin.title}` : 'not_confirmed' }), outcome: ok ? 'saved' : 'failed' };
  } catch (err) {
    const detail = err.message === 'needs_reconnect' ? 'needs_reconnect' : err.reason || 'write_failed';
    return { id: await logAction(db, { ...base, outcome: 'failed', detail }), outcome: 'failed', detail };
  }
}

/** A Gmail DRAFT reminder (never sent). Returns the action_log id. */
export async function draftReminder(env, { kind, rowId, session }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const base = { at: now, owner: session.ownerId, sample: session.sample, kind, rowId, action: 'remind' };
  const src = session.sample
    ? await db.prepare('SELECT data FROM sample_sheet WHERE kind = ? AND row_id = ?').bind(kind, rowId).first()
    : await db.prepare('SELECT data FROM row_cache WHERE kind = ? AND row_id = ?').bind(kind, rowId).first();
  const row = src ? JSON.parse(src.data) : null;
  if (!row) return logAction(db, { ...base, outcome: 'failed', detail: 'row_not_found' });
  const what = kind === 'invoices' ? `invoice ${row.id} (due ${row.due})` : kind === 'deals' ? 'the proposal we sent' : `${row.item}`;
  const text = `Hi,\n\nA quick reminder about ${what}. When you have a moment, could you let me know where it stands?\n\nThank you,\nScooter`;
  const subject = kind === 'invoices' ? `Reminder: invoice ${row.id}` : kind === 'deals' ? 'Following up on our proposal' : `Reminder: ${row.item}`;
  if (session.sample) return logAction(db, { ...base, outcome: 'saved', detail: 'sample_draft' });
  try {
    const raw = [`To: ${row.email || ''}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', text].join('\r\n');
    const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = await accessToken(env, 'google');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: { raw: b64 } }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.id) throw Object.assign(new Error('draft_failed'), { reason: res.status === 403 ? 'needs_reconnect' : 'draft_failed' });
    return logAction(db, { ...base, outcome: 'saved', detail: 'draft', link: `https://mail.google.com/mail/u/0/#drafts?compose=${d.message?.id || ''}` });
  } catch (err) {
    return logAction(db, { ...base, outcome: 'failed', detail: err.message === 'needs_reconnect' ? 'needs_reconnect' : err.reason || 'draft_failed' });
  }
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
  crm: { label: 'Where deals are kept', options: { sheets: 'A light Sheets CRM (the Deals tab, recommended)', tool: 'A named CRM tool' } },
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
      items.push({ key: `inv:${i._id}:${i.due}`, kind: 'invoices', rowId: i._id, title: `Invoice ${i.id || ''} · ${i.client || ''}`.trim(), sub: `${late} day${late === 1 ? '' : 's'} overdue`, tone: late >= 14 ? 'red' : 'gold', action: 'chase', money: num(i.amount) });
    }
  }
  for (const w of r.waiting) {
    if (/received|done/i.test(w.status || '')) continue;
    const d = daysSince(w.since, now);
    if (d !== null && d >= 7) items.push({ key: `wait:${w._id}:${w.since}`, kind: 'waiting', rowId: w._id, title: `${w.item || 'An item'} · ${projectName(view, w.project)}`, sub: `Waiting ${d} days`, tone: d >= 14 ? 'red' : 'gold', action: 'received' });
  }
  for (const p of r.deals) {
    const d = daysSince(p.follow_up, now);
    if (p.proposal_sent && d !== null && d > 0 && !/signed|deposit|handoff/i.test(p.stage || '')) items.push({ key: `deal:${p._id}:${p.follow_up}`, kind: 'deals', rowId: p._id, title: `Proposal · ${p.org || ''}`, sub: `Follow-up was due ${d} day${d === 1 ? '' : 's'} ago`, tone: d >= 7 ? 'red' : 'gold', action: 'chase' });
  }
  for (const a of r.drafts) {
    if (!/^(|waiting|new|to approve)$/i.test(String(a.status || '').trim())) continue;
    const d = daysSince(a.drafted, now);
    items.push({ key: `draft:${a._id}`, kind: 'drafts', rowId: a._id, title: `Draft · ${a.document || ''}`, sub: d === null ? 'Waiting for you' : `Drafted ${d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}`, tone: 'plain', action: 'approve', link: a.link });
  }
  for (const c of connections.filter((x) => x.status === 'broken')) {
    items.unshift({ key: `conn:${c.provider}:${c.last_error}`, kind: 'connection', rowId: c.provider, title: `${c.provider === 'google' ? 'Google' : c.provider[0].toUpperCase() + c.provider.slice(1)} stopped syncing`, sub: 'Reconnect it to bring the numbers back up to date', tone: 'red', action: 'reconnect' });
  }
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
