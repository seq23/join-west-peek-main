/**
 * Lead to delivery: intake, discovery, the pricing builder, proposals, the work side of an accepted
 * deal, the client portal, and the cash rules.
 *
 * Scooter, 14 Nov 2026: "a lead comes in, becomes a deal, becomes a signed client, becomes delivered
 * work with a client portal, and the money stays mine to see. If any piece is demo buttons that do
 * not populate from real data, I will end up back in Google Sheets."
 *
 * Everything here keys on the organization key (`orgKey`) the Lead to cash record already uses, so an
 * inquiry, his tracker row, its discovery, quote, proposal, tasks and portal are one record.
 * Rates, quotes, the catalog and proposals are AES-GCM encrypted at rest (PRODUCTIONS_TOKEN_KEY); a
 * client portal reads ONLY tasks and assets marked for the client, of that one client, and never a
 * quote, a proposal, a rate or a money row.
 */
import { dbOf, ensureSchema } from './schema.mjs';
import { decryptJson, encryptJson, httpsOnly, isoDay, num, randomToken, sha256b64, toTime } from './core.mjs';

const DAY = 86400000;
const KEY_RE = /^[a-z0-9~-]{1,120}$/;
export const validKey = (k) => KEY_RE.test(String(k || ''));
const clip = (v, n = 300) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

/* ------------------------------------------------------------------ intake from his own site */

/**
 * One submission of the Start a project form on westpeekproductions.com, kept for the dashboard's
 * Inquiries list. Called from functions/api/lead.js on productions hosts only, after the email to
 * Scooter has been decided; any failure here is logged and never changes what the visitor sees
 * (productions forms email Scooter and never reach any network sheet: Sequoia, 22 Sep 2026).
 */
export async function recordWebInquiry(env, fields, now = Date.now()) {
  const db = dbOf(env);
  if (!db) return 'no_database';
  try {
    await ensureSchema(db);
    const f = (k, n) => clip(fields[k], n);
    await db.prepare('INSERT INTO web_inquiry (at, form, name, org, email, need, timing, budget, heard, page) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(now, f('lead_type', 80), f('name', 200), f('organization', 200) || f('company', 200), f('email', 200).toLowerCase(), f('initiative', 2000) || f('message', 2000), f('timing', 120), f('budget_range', 120), [f('heard_about', 120), f('heard_about_detail', 200)].filter(Boolean).join(' · '), f('source_page', 300)).run();
    return 'ok';
  } catch (err) {
    console.error('productions inquiry not kept for the dashboard', String(err).slice(0, 200));
    return 'failed';
  }
}
/** The site's inquiries as rows the Lead to cash record reads beside his form's response sheet. */
export async function webInquiryRows(db) {
  const rows = (await db.prepare('SELECT * FROM web_inquiry ORDER BY id').all()).results || [];
  return rows.map((r) => ({ _id: `w${r.id}`, _origin: 'Start a project form on your site', at: isoDay(Number(r.at)), name: r.name, org: r.org, email: r.email, initiative: r.need, timing: r.timing, budget: r.budget, heard: r.heard, from_site: true }));
}

/** Owner and need on an inquiry that is not in his tracker yet (once it is, his tracker holds them). */
export async function saveIntake(env, { key, owner, need, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!validKey(key)) return 'failed';
  await db.prepare('INSERT INTO intake (key, sample, owner, need, at) VALUES (?,?,?,?,?) ON CONFLICT(key, sample) DO UPDATE SET owner = excluded.owner, need = excluded.need, at = excluded.at')
    .bind(key, sample ? 1 : 0, clip(owner, 120), clip(need, 1000), now).run();
  const back = await db.prepare('SELECT owner, need FROM intake WHERE key = ? AND sample = ?').bind(key, sample ? 1 : 0).first();
  return back && back.owner === clip(owner, 120) && back.need === clip(need, 1000) ? 'saved' : 'failed';
}
export async function intakeAll(env, sample) {
  const rows = (await dbOf(env).prepare('SELECT key, owner, need, at FROM intake WHERE sample = ?').bind(sample ? 1 : 0).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

/* ------------------------------------------------------------------ discovery */

/** What shapes the questions: the four capabilities, who is buying, what it is for, and the scale. */
export const DISCOVERY_PROFILE = {
  service: { label: 'Service', options: { content: 'Content and media', events: 'Events and experiences', brand: 'Brand and storytelling', web: 'Web and digital', activation: 'Brand activation or sponsorship' } },
  buyer: { label: 'Who is buying', options: { foundation: 'Foundation or funder', education: 'School, college or education group', nonprofit: 'Nonprofit', association: 'Association or membership body', brand: 'Brand or company', public: 'Public agency' } },
  objective: { label: 'What it is for', options: { awareness: 'Be known and understood', funding: 'Raise money or win funders', members: 'Grow members, enrollment or attendance', advocacy: 'Change a policy or a public view', launch: 'Launch something new', sales: 'Sell, or win sponsors', culture: 'Align their own people' } },
  budget: { label: 'Scale', options: { unknown: 'Budget not shared yet', pilot: 'One piece or a pilot', initiative: 'One full initiative', ongoing: 'Several parts, or ongoing' } }
};

const Q = (id, text) => ({ id, text });
const BANK = {
  always: [
    Q('outcome', 'What has to be true six months from now for this to have been worth it?'),
    Q('audience', 'Who exactly needs to care, and what do they believe today?'),
    Q('trigger', 'Why now: what is launching, changing or at stake?'),
    Q('decide', 'Who signs off, who else has a say, and how do they decide?'),
    Q('timing', 'What dates are fixed, and what happens if one slips?')
  ],
  service: {
    content: [Q('c_use', 'Where will the content live and be seen first, and for how long?'), Q('c_voices', 'Whose voices and stories carry it, and are they available to film or record?'), Q('c_assets', 'What footage, photos or brand assets already exist that we can use?')],
    events: [Q('e_format', 'In person, virtual or hybrid, and how many people in each?'), Q('e_after', 'What should attendees do in the week after the event?'), Q('e_venue', 'Is a venue, platform or date already booked, and under whose contract?')],
    brand: [Q('b_gap', 'Where does the way they describe themselves fall short of the work they do?'), Q('b_owners', 'Who owns the brand inside, and who has to live with the result every day?'), Q('b_keep', 'What must stay (names, marks, colours, commitments to funders)?')],
    web: [Q('w_job', 'What is the one job the site must do for its main visitor?'), Q('w_today', 'What runs the site today, and who updates it after we hand it over?'), Q('w_content', 'Which pages and content exist, and which must be written new?')],
    activation: [Q('a_moment', 'Which moment, place or audience is the activation built around?'), Q('a_measure', 'How will the brand count it a success: reach, sign-ups, sales or something else?'), Q('a_rights', 'What sponsor rights, approvals or brand rules apply?')]
  },
  buyer: {
    foundation: [Q('f_grantees', 'Is this about the foundation\'s own story, or the work of its grantees?'), Q('f_board', 'What will the board or trustees need to see, and when?'), Q('f_evidence', 'What evidence of impact can be shown publicly, and what must stay private?')],
    education: [Q('ed_cal', 'Which academic dates or cycles does this have to fit?'), Q('ed_voices', 'Which students, staff or alumni can take part, with the consents that needs?')],
    nonprofit: [Q('n_donors', 'Which supporters or partners does this have to move, and to do what?'), Q('n_capacity', 'Who on their team will carry this after launch?')],
    association: [Q('as_members', 'Which members are they trying to keep, win back or bring in?'), Q('as_value', 'What do members say they get today, in their own words?')],
    brand: [Q('br_kpi', 'Which business number does this need to move?'), Q('br_prior', 'What have they run before, and what did it return?'), Q('br_proc', 'Is there a procurement, legal or agency-roster step before a contract?')],
    public: [Q('p_rules', 'Which procurement, accessibility or records rules apply?'), Q('p_comms', 'Who must approve public statements, and how long does it take?')]
  },
  objective: {
    awareness: [Q('o_aw', 'Where should people come across this, and what should they remember?')],
    funding: [Q('o_fu', 'Which funders or donors, what ask, and by when?')],
    members: [Q('o_me', 'How many people, by when, and from where they are today?')],
    advocacy: [Q('o_ad', 'Which decision-makers or public, and which decision or view should change?')],
    launch: [Q('o_la', 'What is launching, on what date, and what must people do on day one?')],
    sales: [Q('o_sa', 'Which buyers or sponsors, and what does a yes look like?')],
    culture: [Q('o_cu', 'Which people inside, and what should they understand or do differently?')]
  },
  budget: {
    unknown: [Q('m_range', 'Is there a budget set aside, or a range they have spent on similar work before?'), Q('m_cycle', 'When is their budget decided, and who holds it?')],
    pilot: [Q('m_next', 'If the first piece works, what comes next?')],
    initiative: [Q('m_phase', 'Should the work be phased, and where does each phase end?')],
    ongoing: [Q('m_term', 'Would a 3, 6 or 12-month partnership fit how they plan and pay?'), Q('m_base', 'What should be covered every month, and what is scoped separately?')]
  }
};

/** The guided questions for one deal, in order: always, then by service, buyer, objective and scale. */
export function discoveryQuestions(profile = {}) {
  const out = [...BANK.always];
  for (const part of ['service', 'buyer', 'objective', 'budget']) out.push(...(BANK[part][profile[part]] || []));
  const seen = new Set();
  return out.filter((q) => (seen.has(q.id) ? false : seen.add(q.id)));
}
export function cleanProfile(p = {}) {
  return Object.fromEntries(Object.keys(DISCOVERY_PROFILE).map((k) => [k, DISCOVERY_PROFILE[k].options[p[k]] ? p[k] : '']));
}
export async function saveDiscovery(env, { key, profile, answers, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!validKey(key)) return 'failed';
  const data = { profile: cleanProfile(profile), answers: Object.fromEntries(Object.entries(answers || {}).map(([k, v]) => [k, clip(v, 2000)]).filter(([, v]) => v)) };
  const r = await db.prepare('INSERT INTO discovery (key, sample, at, data) VALUES (?,?,?,?) RETURNING id').bind(key, sample ? 1 : 0, now, JSON.stringify(data)).first();
  const back = await db.prepare('SELECT data FROM discovery WHERE id = ?').bind(r?.id ?? -1).first();
  return back && back.data === JSON.stringify(data) ? 'saved' : 'failed';
}
export async function latestDiscovery(env, key, sample) {
  const r = await dbOf(env).prepare('SELECT data, at FROM discovery WHERE key = ? AND sample = ? ORDER BY id DESC LIMIT 1').bind(key, sample ? 1 : 0).first();
  return r ? { ...JSON.parse(r.data), at: Number(r.at) } : null;
}

/* ------------------------------------------------------------------ service catalog (his rate cards) */

/**
 * The catalog STRUCTURE: service lines with a unit, under the four capabilities, plus team time.
 * The rates are his private inputs: every line starts with no rate (unknown), and he fills them on
 * the Catalog page or reads them from his own rate card sheet. Nothing here is a price.
 */
export const CATALOG_STRUCTURE = [
  ['content', 'Creative direction and pre-production', 'day'], ['content', 'Shoot day (crew and kit)', 'day'], ['content', 'Edit and finishing', 'day'], ['content', 'Motion graphics', 'day'], ['content', 'Photography', 'day'],
  ['events', 'Event strategy and run of show', 'event'], ['events', 'Production management', 'day'], ['events', 'Virtual or hybrid platform', 'event'], ['events', 'Stage, AV and crew', 'day'], ['events', 'Venue and hospitality (pass-through)', 'event'],
  ['brand', 'Discovery workshop', 'session'], ['brand', 'Narrative and messaging', 'deliverable'], ['brand', 'Identity design', 'deliverable'], ['brand', 'Brand guidelines', 'deliverable'],
  ['web', 'Site strategy and design', 'page'], ['web', 'Build and launch', 'page'], ['web', 'Content writing and migration', 'page'],
  ['activation', 'Activation concept', 'deliverable'], ['activation', 'On-site activation team', 'day'],
  ['team', 'Account lead time', 'hour'], ['team', 'Creative lead time', 'hour'], ['team', 'Producer time', 'hour'], ['team', 'Specialist time', 'hour']
].map(([service, line, unit], i) => ({ id: `L${i + 1}`, service, line, unit, cost: null, team: service === 'team' }));
export const SERVICE_NAMES = { ...DISCOVERY_PROFILE.service.options, team: 'Team time' };

async function sealed(env, sql, binds) {
  const r = await dbOf(env).prepare(sql).bind(...binds).first();
  return r ? decryptJson(env, r.data_enc ?? r.text_enc) : null;
}
export async function readCatalog(env, sample) {
  const c = await sealed(env, 'SELECT data_enc FROM catalog WHERE sample = ?', [sample ? 1 : 0]);
  return Array.isArray(c) && c.length ? c : CATALOG_STRUCTURE.map((x) => ({ ...x }));
}
export function cleanCatalog(lines) {
  return lines.map((l, i) => ({ id: clip(l.id, 20) || `L${i + 1}`, service: SERVICE_NAMES[l.service] ? l.service : 'team', line: clip(l.line, 120), unit: clip(l.unit, 30) || 'each', cost: num(l.cost), team: l.service === 'team' || Boolean(l.team) })).filter((l) => l.line).slice(0, 200);
}
export async function saveCatalog(env, { lines, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const clean = cleanCatalog(lines);
  if (!clean.length) return 'failed';
  let blob;
  try { blob = await encryptJson(env, clean); } catch { return 'no_token_key'; }
  await db.prepare('INSERT INTO catalog (sample, data_enc, at) VALUES (?,?,?) ON CONFLICT(sample) DO UPDATE SET data_enc = excluded.data_enc, at = excluded.at').bind(sample ? 1 : 0, blob, now).run();
  const back = await readCatalog(env, sample);
  return JSON.stringify(back) === JSON.stringify(clean) ? 'saved' : 'failed';
}
/** Lines from his own rate card grid (Service / Item / Unit / Rate or Cost columns), wherever its header row sits. */
export function catalogFromGrid(grid) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const want = { service: ['service', 'serviceline', 'category', 'capability'], line: ['item', 'line', 'lineitem', 'deliverable', 'description', 'name'], unit: ['unit', 'per', 'units'], cost: ['cost', 'costrate', 'rate', 'ourcost', 'internalrate', 'unitcost'] };
  for (let r = 0; r < Math.min(grid.length, 40); r += 1) {
    const head = (grid[r] || []).map(norm);
    const idx = Object.fromEntries(Object.entries(want).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    if (idx.line < 0 || idx.cost < 0) continue;
    const guess = (s) => { const n = norm(s); return Object.entries(SERVICE_NAMES).find(([k, v]) => n.includes(k) || n.includes(norm(v).slice(0, 6)))?.[0] || 'team'; };
    return grid.slice(r + 1).filter((row) => String(row?.[idx.line] ?? '').trim()).map((row, i) => ({ id: `R${i + 1}`, service: idx.service > -1 ? guess(row[idx.service]) : 'team', line: String(row[idx.line]).trim(), unit: idx.unit > -1 ? String(row[idx.unit] || '').trim() : 'each', cost: num(row[idx.cost]) }));
  }
  return null;
}

/* ------------------------------------------------------------------ the pricing builder */

export const TERMS = { 0: 'One project', 3: '3-month package', 6: '6-month package', 12: '12-month package' };
export const PAY_PLANS = { signing: 'All at signing', split: 'Half at signing, half at delivery', monthly: 'Monthly, paid at the start of each month', custom: 'My own split (for example 30/30/20/20)' };

/**
 * The quote's numbers. Three stay separate, always: the COST FLOOR (every line's quantity times his
 * cost rate, team time included; a line with no rate is UNKNOWN and named, never zero), the PRICE he
 * chooses (never picked or suggested here), and the RATIONALE the client hears (his words).
 * Returns the floor, the unknowns, the margin math (only once he has set a price), and month by month
 * when payments arrive against when costs go out.
 */
export function quoteMath(q) {
  const term = TERMS[q.term] !== undefined ? Number(q.term) : 0;
  const months = Math.max(1, term || Number(q.months) || 1);
  const lines = (q.lines || []).filter((l) => num(l.qty) > 0);
  const known = lines.filter((l) => num(l.cost) !== null);
  const unknown = lines.filter((l) => num(l.cost) === null);
  const lineCost = (l) => num(l.qty) * num(l.cost);
  const floor = known.reduce((a, l) => a + lineCost(l), 0);
  const team = known.filter((l) => l.team).reduce((a, l) => a + lineCost(l), 0);
  const price = num(q.price);
  const margin = price === null ? null : { amount: price - floor, pct: price ? Math.round(((price - floor) / price) * 1000) / 10 : null, atMost: unknown.length > 0, belowFloor: price < floor };
  // Payments in, by month (month 1 = signing).
  const inflow = new Array(months).fill(0);
  if (price !== null) {
    const plan = PAY_PLANS[q.plan] ? q.plan : (term ? 'monthly' : 'split');
    if (plan === 'signing') inflow[0] = price;
    else if (plan === 'split') { inflow[0] += price / 2; inflow[months - 1] += price / 2; }
    else if (plan === 'monthly') for (let m = 0; m < months; m += 1) inflow[m] = price / months;
    else {
      const parts = String(q.split || '').split(/[^\d.]+/).map(Number).filter((x) => x > 0);
      const total = parts.reduce((a, b) => a + b, 0) || 1;
      parts.forEach((p, i) => { const m = parts.length === 1 ? 0 : Math.round((i * (months - 1)) / (parts.length - 1)); inflow[m] += (price * p) / total; });
    }
  }
  // Costs out, by month: a line goes out in its own month, or spread evenly over the term.
  const outflow = new Array(months).fill(0);
  for (const l of known) {
    const m = Math.min(months, Math.max(0, Number(l.month) || 0));
    if (m) outflow[m - 1] += lineCost(l);
    else for (let i = 0; i < months; i += 1) outflow[i] += lineCost(l) / months;
  }
  let running = 0;
  const timeline = inflow.map((cashIn, i) => { running += cashIn - outflow[i]; return { month: i + 1, cashIn, cashOut: outflow[i], position: running }; });
  return { term, months, floor, team, unknown: unknown.map((l) => l.line), price, margin, monthly: price !== null && term ? price / term : null, timeline, shortMonths: timeline.filter((t) => t.position < 0).map((t) => t.month) };
}

export function cleanQuote(raw, catalog) {
  const byId = Object.fromEntries(catalog.map((l) => [l.id, l]));
  const lines = (raw.lines || []).map((l) => {
    const c = byId[l.id];
    if (!c) return null;
    const qty = num(l.qty);
    if (!(qty > 0)) return null;
    // A rate typed on the quote wins for this quote only; else the catalog rate; blank stays unknown.
    const cost = num(l.cost) ?? c.cost;
    return { id: c.id, service: c.service, line: c.line, unit: c.unit, qty, cost, team: c.team, month: Math.max(0, Math.min(12, Number(l.month) || 0)) };
  }).filter(Boolean);
  return { lines, price: num(raw.price), term: TERMS[raw.term] !== undefined ? Number(raw.term) : 0, months: Math.max(1, Math.min(24, Number(raw.months) || 1)), plan: PAY_PLANS[raw.plan] ? raw.plan : '', split: clip(raw.split, 40), rationale: clip(raw.rationale, 3000), title: clip(raw.title, 160) };
}
export async function saveQuote(env, { key, quote, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!validKey(key)) return { outcome: 'failed' };
  let blob;
  try { blob = await encryptJson(env, quote); } catch { return { outcome: 'no_token_key' }; }
  const r = await db.prepare('INSERT INTO quote (key, sample, at, data_enc) VALUES (?,?,?,?) RETURNING id').bind(key, sample ? 1 : 0, now, blob).first();
  const back = await sealed(env, 'SELECT data_enc FROM quote WHERE id = ?', [r?.id ?? -1]);
  return { outcome: JSON.stringify(back) === JSON.stringify(quote) ? 'saved' : 'failed', id: r?.id };
}
export async function latestQuote(env, key, sample) {
  const r = await dbOf(env).prepare('SELECT id, at, data_enc FROM quote WHERE key = ? AND sample = ? ORDER BY id DESC LIMIT 1').bind(key, sample ? 1 : 0).first();
  if (!r) return null;
  const q = await decryptJson(env, r.data_enc);
  return q ? { ...q, _id: r.id, _at: Number(r.at) } : { unreadable: true, _id: r.id, _at: Number(r.at) };
}

/* ------------------------------------------------------------------ proposal */

const usd = (n) => (n === null || n === undefined ? '' : `$${Math.round(n).toLocaleString('en-US')}`);
/**
 * A first proposal from a quote and the discovery answers, for him to edit. It carries the scope
 * (lines and quantities), the term with its bundled duration, his price, the payment plan and his
 * rationale. It never carries a cost rate, the cost floor or the margin.
 */
export function proposalDraft({ name, quote, discovery }) {
  const m = quoteMath(quote);
  const outcome = discovery?.answers?.outcome;
  const audience = discovery?.answers?.audience;
  const scope = quote.lines.filter((l) => !l.team).map((l) => `- ${l.line}: ${l.qty} ${l.unit}${l.qty === 1 ? '' : 's'}`);
  const termWords = m.term ? `${TERMS[m.term]}: the work below is bundled over ${m.term} months${m.monthly !== null ? `, ${usd(m.monthly)} a month` : ''}.` : 'One project, scoped below.';
  const plan = PAY_PLANS[quote.plan] || (m.term ? PAY_PLANS.monthly : PAY_PLANS.split);
  return [
    `${quote.title || `Proposal for ${name}`}`,
    '',
    'What you told us',
    outcome ? `- Success looks like: ${outcome}` : '- Success looks like: (from our discovery conversation)',
    audience ? `- Who needs to care: ${audience}` : '',
    '',
    'Why this approach',
    quote.rationale || '(Your reasoning for the client goes here.)',
    '',
    'What we will do',
    ...(scope.length ? scope : ['- (Scope lines from the quote)']),
    '',
    'Term',
    termWords,
    '',
    'Investment',
    m.price !== null ? `${usd(m.price)} in total. Payment: ${plan}.` : '(Set your price on the quote.)',
    '',
    'Next step',
    'Reply to confirm and we will send the agreement for signature.'
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
}
export const PROPOSAL_STATUS = { draft: 'Draft', sent: 'Sent to the client', accepted: 'Accepted', declined: 'Declined' };
export async function saveProposal(env, { key, text, status, quoteId, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!validKey(key) || !PROPOSAL_STATUS[status]) return 'failed';
  const body = clip(text, 20000);
  if (!body) return 'failed';
  let blob;
  try { blob = await encryptJson(env, { text: body }); } catch { return 'no_token_key'; }
  const r = await db.prepare('INSERT INTO proposal (key, sample, at, quote_id, status, text_enc) VALUES (?,?,?,?,?,?) RETURNING id').bind(key, sample ? 1 : 0, now, quoteId || null, status, blob).first();
  const back = await sealed(env, 'SELECT text_enc FROM proposal WHERE id = ?', [r?.id ?? -1]);
  return back?.text === body ? 'saved' : 'failed';
}
export async function latestProposal(env, key, sample) {
  const db = dbOf(env);
  const r = await db.prepare('SELECT id, at, status, quote_id, text_enc FROM proposal WHERE key = ? AND sample = ? ORDER BY id DESC LIMIT 1').bind(key, sample ? 1 : 0).first();
  if (!r) return null;
  const n = await db.prepare('SELECT COUNT(*) AS n FROM proposal WHERE key = ? AND sample = ?').bind(key, sample ? 1 : 0).first();
  const t = await decryptJson(env, r.text_enc);
  return { id: r.id, at: Number(r.at), status: r.status, quoteId: r.quote_id, text: t?.text ?? null, versions: Number(n?.n) || 1 };
}
export async function proposalStatuses(env, sample) {
  const rows = (await dbOf(env).prepare('SELECT p.key, p.status, p.at FROM proposal p JOIN (SELECT key, MAX(id) AS id FROM proposal WHERE sample = ? GROUP BY key) m ON p.id = m.id').bind(sample ? 1 : 0).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.key, { status: r.status, at: Number(r.at) }]));
}

/* ------------------------------------------------------------------ the work side, and the portal */

/** An accepted deal gets its work side: the account team, tasks from the quote's scope, and a portal. */
export async function startDelivery(env, { key, team, quote, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const s = sample ? 1 : 0;
  const have = await db.prepare('SELECT key FROM delivery WHERE key = ? AND sample = ?').bind(key, s).first();
  if (have) return { created: false };
  const stmts = [db.prepare('INSERT INTO delivery (key, sample, at, team) VALUES (?,?,?,?)').bind(key, s, now, clip(team, 1000))];
  for (const l of (quote?.lines || []).filter((x) => !x.team)) stmts.push(db.prepare('INSERT INTO task (key, sample, at, title, owner, due, done, client) VALUES (?,?,?,?,?,?,0,1)').bind(key, s, now, clip(l.line, 200), '', ''));
  await db.batch(stmts);
  const token = await newPortal(env, { key, sample }, now);
  return { created: true, token };
}
export async function deliveryOf(env, key, sample) {
  const db = dbOf(env);
  const s = sample ? 1 : 0;
  const d = await db.prepare('SELECT at, team FROM delivery WHERE key = ? AND sample = ?').bind(key, s).first();
  if (!d) return null;
  const tasks = (await db.prepare('SELECT id, title, owner, due, done, client FROM task WHERE key = ? AND sample = ? ORDER BY done, id').bind(key, s).all()).results || [];
  const assets = (await db.prepare('SELECT id, label, url, client FROM asset WHERE key = ? AND sample = ? ORDER BY id').bind(key, s).all()).results || [];
  const portal = await db.prepare('SELECT created_at FROM portal WHERE key = ? AND sample = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(key, s).first();
  return { at: Number(d.at), team: d.team || '', tasks, assets, portalSince: portal ? Number(portal.created_at) : null };
}
export async function saveTeam(env, { key, team, sample }) {
  await dbOf(env).prepare('UPDATE delivery SET team = ? WHERE key = ? AND sample = ?').bind(clip(team, 1000), key, sample ? 1 : 0).run();
}
export async function addTask(env, { key, title, owner, due, client, sample }, now = Date.now()) {
  const t = clip(title, 200);
  if (!t) return 'failed';
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return 'failed';
  await dbOf(env).prepare('INSERT INTO task (key, sample, at, title, owner, due, done, client) VALUES (?,?,?,?,?,?,0,?)').bind(key, sample ? 1 : 0, now, t, clip(owner, 120), due || '', client ? 1 : 0).run();
  return 'saved';
}
export async function setTask(env, { key, id, field, value, sample }) {
  if (!['done', 'client'].includes(field)) return 'failed';
  const r = await dbOf(env).prepare(`UPDATE task SET ${field} = ? WHERE id = ? AND key = ? AND sample = ?`).bind(value ? 1 : 0, Number(id), key, sample ? 1 : 0).run();
  return r?.meta?.changes === 0 ? 'failed' : 'saved';
}
export async function addAsset(env, { key, label, url, client, sample }, now = Date.now()) {
  const u = httpsOnly(url);
  if (!u || !clip(label, 160)) return 'failed';
  await dbOf(env).prepare('INSERT INTO asset (key, sample, at, label, url, client) VALUES (?,?,?,?,?,?)').bind(key, sample ? 1 : 0, now, clip(label, 160), u.slice(0, 1000), client ? 1 : 0).run();
  return 'saved';
}
/** A new portal link for this client; any earlier link for them stops working. Returns the token (shown once). */
export async function newPortal(env, { key, sample }, now = Date.now()) {
  const db = dbOf(env);
  const token = randomToken(24);
  await db.batch([
    db.prepare('UPDATE portal SET revoked_at = ? WHERE key = ? AND sample = ? AND revoked_at IS NULL').bind(now, key, sample ? 1 : 0),
    db.prepare('INSERT INTO portal (token_hash, key, sample, created_at) VALUES (?,?,?,?)').bind(await sha256b64(`portal:${token}`), key, sample ? 1 : 0, now)
  ]);
  return token;
}
export async function revokePortal(env, { key, sample }, now = Date.now()) {
  await dbOf(env).prepare('UPDATE portal SET revoked_at = ? WHERE key = ? AND sample = ? AND revoked_at IS NULL').bind(now, key, sample ? 1 : 0).run();
}
/**
 * What one client's portal shows: their own tasks and assets marked for the client, nothing else.
 * No quote, proposal, rate, note or money row is ever read here.
 */
export async function portalView(env, token) {
  const db = dbOf(env);
  if (!db || !/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  await ensureSchema(db);
  const p = await db.prepare('SELECT key, sample FROM portal WHERE token_hash = ? AND revoked_at IS NULL').bind(await sha256b64(`portal:${token}`)).first();
  if (!p) return null;
  const tasks = (await db.prepare('SELECT title, due, done FROM task WHERE key = ? AND sample = ? AND client = 1 ORDER BY done, id').bind(p.key, p.sample).all()).results || [];
  const assets = (await db.prepare('SELECT label, url FROM asset WHERE key = ? AND sample = ? AND client = 1 ORDER BY id').bind(p.key, p.sample).all()).results || [];
  return { key: p.key, sample: Boolean(p.sample), tasks, assets };
}

/* ------------------------------------------------------------------ cash, counted correctly */

/**
 * The cash rules (Scooter, 14 Nov 2026): "'paid' on a tracker is not the same as money settled in the
 * bank, actuals and forecasts stay separate, a balance that already includes a payment must not count
 * it twice, and contract payment conditions carry through to when cash actually moves."
 *   1. SETTLED only with a settled date (Settled on / Cleared / In bank on). "Paid" alone is
 *      "marked paid, not seen in the bank yet", and is neither cash nor forecast.
 *   2. ACTUAL (the balance as of its date) and FORECAST (dated money still to come) are two numbers,
 *      never added together.
 *   3. A receipt or settled invoice dated on or before the balance's as-of date is already inside the
 *      balance and is not counted again.
 *   4. An open invoice's expected date comes from its payment terms: Net N from its issue date, or a
 *      condition ("on delivery", "on milestone") that holds it out of the dated forecast until met.
 */
/**
 * The rules walk (Scooter, 14 Nov 2026: "We will walk the rules before any money view ships").
 * Each rule is shown to him in plain words with a worked example; he marks it right, or says how it
 * should work. Until every rule is marked right (setting `cash_rule:<id>`), the Money page shows the
 * walk and no figure from his Money sheet. A rule whose words change gets a new `v`, which asks him again.
 */
export const CASH_RULES = [
  { id: 'settled', v: 1, rule: '"Paid" on a sheet is not cash. An invoice counts as money in the bank only when its row has a Settled on (or Cleared, In bank on) date.', example: 'Invoice A is marked Paid on 3 March but has no Settled on date. It is listed as "marked paid, not yet seen in the bank", and is in neither cash nor the forecast until the date is entered.' },
  { id: 'apart', v: 1, rule: 'Actual and forecast are two numbers and are never added together.', example: 'The bank shows a balance as of Monday, and two invoices are due in over the next four weeks. You see the balance as actual and the two invoices as forecast, side by side, never added into one total.' },
  { id: 'once', v: 1, rule: 'A payment already inside a balance is not counted again. A payment dated on or before the balance date is in it; an expected receipt that matches an open invoice is that invoice, counted once.', example: 'The balance is as of 1 March and a receipt is dated 28 February: it is already in the balance and is not added. An expected payment from Client B beside an open invoice to Client B for the same amount counts once.' },
  { id: 'terms', v: 1, rule: 'Contract payment terms decide when cash is expected. Net 30 dates it 30 days after the invoice was issued; a condition such as "on delivery" or "on milestone" keeps it out of the dated forecast until it is met.', example: 'An invoice issued 1 March on Net 30 is expected 31 March. An invoice "due on delivery" shows under "Waiting on a condition" with no date, and is not in the forecast.' },
  { id: 'late', v: 1, rule: 'An unpaid invoice past its date is still forecast, marked overdue. It never becomes cash because the date passed.', example: 'An invoice expected 1 February is unpaid on 1 March. It stays in the forecast, marked overdue, until a Settled on date is entered.' }
];
/** Where the walk stands, from the saved `cash_rule:<id>` settings. */
export function rulesWalk(settings = {}) {
  const rules = CASH_RULES.map((r) => {
    const s = settings[`cash_rule:${r.id}`];
    const current = s && s.v === r.v ? s : null;
    return { ...r, state: current ? (current.ok ? 'right' : 'change') : 'open', note: current?.note || '', at: current?.at || null, sent: current?.sent || null, sentAt: current?.sent_at || null };
  });
  const right = rules.filter((r) => r.state === 'right').length;
  return { rules, right, all: right === rules.length, lastAt: Math.max(0, ...rules.map((r) => r.at || 0)) || null };
}

export function termsDate(inv) {
  const t = String(inv.terms || '').trim();
  const issued = toTime(inv.issued);
  const net = t.match(/net\s*(\d{1,3})/i) || t.match(/^(\d{1,3})\s*days?$/i);
  if (net && issued !== null) return { at: issued + Number(net[1]) * DAY, how: `${t} from ${isoDay(issued)}` };
  if (/on (receipt|signing)|due now|immediate/i.test(t) && issued !== null) return { at: issued, how: t };
  if (t && !net) return { at: null, waits: t };
  const due = toTime(inv.due);
  return due === null ? { at: null, waits: 'no due date or terms entered' } : { at: due, how: 'its due date' };
}
export function cashPicture({ invoices = [], receipts = [], cash = [], acct = null, useAcct = false, now = Date.now() }) {
  const weeks = cash.filter((c) => toTime(c.week) !== null && num(c.opening) !== null).sort((a, b) => toTime(a.week) - toTime(b.week));
  const current = [...weeks].reverse().find((w) => toTime(w.week) <= now) || null;
  const balance = useAcct && acct?.amount !== null && acct?.amount !== undefined
    ? { amount: acct.amount, asOf: acct.at, from: acct.tool }
    : current ? { amount: num(current.opening), asOf: toTime(current.week), from: 'cash_tab' } : null;
  const settledAt = (i) => toTime(i.settled_on);
  const paid = (i) => /paid|settled|received/i.test(i.status || '');
  const draft = (i) => /draft|void|cancel/i.test(i.status || '');
  const settled = invoices.filter((i) => settledAt(i) !== null);
  const markedOnly = invoices.filter((i) => paid(i) && settledAt(i) === null);
  const open = invoices.filter((i) => !paid(i) && settledAt(i) === null && !draft(i));
  const asOf = balance?.asOf ?? null;
  const inBalance = (t) => asOf !== null && t !== null && t <= asOf;
  const forecast = [];
  const held = [];
  for (const i of open) {
    const d = termsDate(i);
    // An unpaid invoice is never inside the balance, however late it is: late money is still to come.
    if (d.at === null) held.push({ what: `Invoice ${i.id || ''}`.trim(), client: i.client, amount: num(i.amount), waits: d.waits });
    else forecast.push({ what: `Invoice ${i.id || ''}`.trim(), client: i.client, amount: num(i.amount), at: d.at, how: d.at < now ? `${d.how}, overdue` : d.how, overdue: d.at < now });
  }
  const invoiced = new Set(open.map((i) => String(i.client || '').toLowerCase()));
  let skipped = 0;
  for (const r of receipts) {
    const at = toTime(r.date);
    if (inBalance(at)) { skipped += 1; continue; }
    // An expected receipt for a client who also has an open invoice of the same amount is that invoice, counted once.
    if (open.some((i) => invoiced.has(String(r.client || '').toLowerCase()) && num(i.amount) === num(r.amount) && String(i.client || '').toLowerCase() === String(r.client || '').toLowerCase())) { skipped += 1; continue; }
    if (at === null) held.push({ what: 'Expected receipt', client: r.client, amount: num(r.amount), waits: 'no date entered' });
    else forecast.push({ what: 'Expected receipt', client: r.client, amount: num(r.amount), at, how: r.confidence || 'expected' });
  }
  const soon = forecast.filter((f) => f.at <= now + 28 * DAY);
  const sum = (xs) => xs.reduce((a, x) => a + (x.amount || 0), 0);
  return {
    actual: balance, settledSinceBalance: settled.filter((i) => !inBalance(settledAt(i))).map((i) => ({ what: `Invoice ${i.id || ''}`.trim(), client: i.client, amount: num(i.amount), at: settledAt(i) })),
    markedOnly: markedOnly.map((i) => ({ what: `Invoice ${i.id || ''}`.trim(), client: i.client, amount: num(i.amount) })),
    forecast: forecast.sort((a, b) => a.at - b.at), forecastNext4: sum(soon), held, alreadyInBalance: skipped
  };
}
