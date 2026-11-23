/**
 * The Pipeline board (Scooter, 23 Nov 2026: "one board, everything tracked"). Six columns, each lead a
 * card with the days since its last update; every lead lands on it by itself. The column names are his
 * sketch's ("I'll adjust names once I see it"); his tracker's own stage words decide which column a
 * deal sits in, and a stage the board does not recognise shows on its card under New leads.
 * Top Barz rows never reach it: they are filtered at read time (data.mjs productionsOnly).
 */
import { dbOf, ensureSchema } from './schema.mjs';
import { toTime } from './core.mjs';
import { addDealFromInquiry, getSetting, stageKey, syncAll } from './data.mjs';

export const COLUMNS = [
  { id: 'new', label: 'New leads' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'quote', label: 'Quote' },
  { id: 'proposal', label: 'Proposal out' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost / cold' }
];
export const COLUMN_BY_ID = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));
/** How many cards a column shows before "See all". */
export const BOARD_SHOWN = 4;

// Lost first, so "Closed lost" is never read as a win; then won, then the funnel from the far end.
const RULES = [
  ['lost', /\blost\b|\bcold\b|dead|declin|no go|not a fit|no response|ghost|passed|on hold/],
  ['won', /\bwon\b|signed|deposit|handoff|hand-off|contract|kick ?off|delivery|closed/],
  ['proposal', /proposal|negotiat|\bsent\b|pending signature/],
  ['quote', /quote|estimat|scop|solution|budget|pricing/],
  ['discovery', /discover|intro|conversation|qualif|meeting|\bcall\b|needs/],
  ['new', /relationship|\bnew\b|lead|inquir|prospect|identified|contacted/]
];
/** The column a tracker stage sits in; `known` says whether a rule matched (else it shows on the card). */
export function columnOf(stage) {
  const k = stageKey(stage);
  if (!k) return { id: 'new', known: false };
  for (const [id, re] of RULES) if (re.test(k)) return { id, known: true };
  return { id: 'new', known: false };
}

/**
 * When each lead was last touched here: a saved change to its tracker row, a note, Discovery, a quote,
 * a proposal or the intake fields. { byKey: {orgKey: ms}, byRow: {rowId: ms} }.
 */
export async function lastTouches(env, sample) {
  const db = dbOf(env);
  await ensureSchema(db);
  const s = sample ? 1 : 0;
  const keyed = await db.prepare(`SELECT key, MAX(at) AS at FROM (
      SELECT subject AS key, at FROM note WHERE sample = ?1
      UNION ALL SELECT key, at FROM discovery WHERE sample = ?1
      UNION ALL SELECT key, at FROM estimate WHERE sample = ?1
      UNION ALL SELECT key, at FROM proposal WHERE sample = ?1
      UNION ALL SELECT key, at FROM intake WHERE sample = ?1) GROUP BY key`).bind(s).all();
  const rows = await db.prepare("SELECT row_id, MAX(at) AS at FROM action_log WHERE sample = ? AND kind = 'deals' AND outcome = 'saved' AND row_id IS NOT NULL GROUP BY row_id").bind(s).all();
  return {
    byKey: Object.fromEntries((keyed.results || []).map((r) => [r.key, Number(r.at)])),
    byRow: Object.fromEntries((rows.results || []).map((r) => [r.row_id, Number(r.at)]))
  };
}

/** The latest moment anything about this lead changed (null when nothing carries a date). */
export function lastUpdate(j, touches = { byKey: {}, byRow: {} }) {
  const d = j.deal;
  const times = [
    ...j.inquiries.map((i) => toTime(i.at)),
    d ? toTime(d.last_contact) : null,
    d ? toTime(d.proposal_sent) : null,
    d?._changed ?? null,
    d ? touches.byRow[d._id] : null,
    touches.byKey[j.key]
  ].filter((t) => typeof t === 'number' && Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}

/**
 * Every lead as a card in its column, the stalest first (so a lead going quiet surfaces itself).
 * A lead is anyone with a tracker row or a form request; a client with only a project or invoice is
 * past the pipeline and lives on Clients.
 */
export function boardCards(list, { touches, now = Date.now() } = {}) {
  const cols = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const j of list) {
    if (!j.deal && !j.inquiries.length) continue;
    const col = j.deal ? columnOf(j.deal.stage) : { id: j.lost ? 'lost' : 'new', known: true };
    if (j.signedBy === 'DocuSign' && col.id !== 'lost') col.id = 'won';
    const at = lastUpdate(j, touches);
    const days = at === null ? null : Math.max(0, Math.floor((now - at) / 86400000));
    cols[col.id].push({ key: j.key, name: j.name, days, stage: j.deal?.stage || '', unknownStage: Boolean(j.deal) && !col.known, deal: j.deal, inquiry: !j.deal });
  }
  for (const c of Object.values(cols)) c.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name));
  return cols;
}

/** "2 days", "today", "no date" for a card's chip. */
export function daysWords(days) {
  if (days === null || days === undefined) return 'no date';
  if (days === 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Every lead lands on the board by itself and in his tracker (Scooter, 23 Nov 2026: "Every lead lands on
 * the board by itself: website form, AI employee, all of it. Remove the 'Save to my tracker' step. If a
 * lead exists, it's tracked."). A form request not in his tracker yet gets its one appended row there,
 * exactly as the old button did. Each lead is tried once: a row he later deletes from his tracker is
 * never put back. At most `cap` per run, so one bad sync can never flood his sheet.
 */
export async function trackNewLeads(env, { list, session, cap = 10 }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const out = { added: 0, failed: 0, skipped: 0 };
  if (!session.sample) {
    const layout = await getSetting(env, 'layout:deals');
    if (!layout?.recognised || !layout.tab) return { ...out, stop: 'no_tracker' };
  }
  const fresh = list.filter((j) => !j.deals.length && j.inquiries.length && !j.lost);
  for (const j of fresh) {
    if (out.added + out.failed >= cap) break;
    const mark = `auto_tracked:${session.sample ? 's' : 'r'}:${j.key}`;
    if (await db.prepare('SELECT 1 FROM setting WHERE key = ?').bind(mark).first()) { out.skipped += 1; continue; }
    const intake = await db.prepare('SELECT owner, need FROM intake WHERE key = ? AND sample = ?').bind(j.key, session.sample ? 1 : 0).first();
    const r = await addDealFromInquiry(env, { journey: j, session, carry: { owner: intake?.owner || '', need: intake?.need || '', note: j.note?.text }, resync: false }, now);
    // A lead already in the tracker under another spelling counts as tracked; anything else is retried.
    if (r.outcome === 'saved' || r.detail === 'already_in_tracker') {
      await db.prepare('INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)').bind(mark, JSON.stringify(now)).run();
      out.added += r.outcome === 'saved' ? 1 : 0;
    } else out.failed += 1;
  }
  // One sync after the batch, so the new rows come back as deals (with their row IDs) on the board.
  if (out.added && !session.sample) await syncAll(env, now).catch(() => null);
  return out;
}
