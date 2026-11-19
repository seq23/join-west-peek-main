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
import { EVENT_SERVICE, SERVICES, SERVICE_BY_ID, serviceFrom } from '../services.mjs';

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
/**
 * What they need, from the Start a project form (Scooter, 14 Nov 2026: a multiple-choice "what's your
 * problem", with "other" and a text box): the choice, the "something else" words, then any extra note.
 */
export function needFrom(fields) {
  const f = (k, n) => clip(fields[k], n);
  const pick = f('need_type', 120);
  const choice = pick === 'Other' ? (f('need_other', 300) ? `Other: ${f('need_other', 300)}` : 'Other') : pick;
  return [choice, f('initiative', 2000) || f('message', 2000)].filter(Boolean).join('. ').slice(0, 2000);
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export async function recordWebInquiry(env, fields, now = Date.now()) {
  const db = dbOf(env);
  if (!db) return 'no_database';
  try {
    await ensureSchema(db);
    const f = (k, n) => clip(fields[k], n);
    const name = f('name', 200) || [f('first_name', 100), f('last_name', 100)].filter(Boolean).join(' ');
    const service = serviceFrom(f('service', 120));
    // Event dates only for Virtual / hybrid event production (Scooter, 15 Nov 2026).
    const day = (k) => (service === EVENT_SERVICE.id && DAY_RE.test(f(k, 10)) ? f(k, 10) : '');
    await db.prepare('INSERT INTO web_inquiry (at, form, name, org, email, need, timing, budget, heard, page, service, title, event_start, event_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(now, f('lead_type', 80), name, f('organization', 200) || f('company', 200), f('email', 200).toLowerCase(), needFrom(fields), f('timing', 120), f('budget_range', 120), [f('heard_about', 120), f('heard_about_detail', 200)].filter(Boolean).join(' · '), f('source_page', 300), service, f('job_title', 160), day('event_start'), day('event_end')).run();
    return 'ok';
  } catch (err) {
    console.error('productions inquiry not kept for the dashboard', String(err).slice(0, 200));
    return 'failed';
  }
}
/** The site's inquiries as rows the Lead to cash record reads beside his form's response sheet. */
export async function webInquiryRows(db) {
  const rows = (await db.prepare('SELECT * FROM web_inquiry ORDER BY id').all()).results || [];
  return rows.map((r) => ({ _id: `w${r.id}`, _origin: 'Get in touch form on your site', at: isoDay(Number(r.at)), name: r.name, org: r.org, email: r.email, initiative: r.need, timing: r.timing, budget: r.budget, heard: r.heard, service: r.service || '', title: r.title || '', event_start: r.event_start || '', event_end: r.event_end || '', from_site: true }));
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

/**
 * What shapes the questions. Services come first and are picked from the site's own six (Scooter,
 * 15 Nov 2026: "Start Discovery with a service picker using the site's icons"), several at once;
 * then Organization type (was "Who is buying"), what it is for, and the scale.
 */
export const SERVICE_OPTIONS = Object.fromEntries(SERVICES.map((x) => [x.id, x.name]));
/** Service keys saved before 15 Nov 2026, read as today's services. */
const OLD_SERVICE = { content: 'content-production', events: 'virtual-hybrid-events', brand: 'brand-strategy', web: 'web-development', activation: 'content-production' };
export const DISCOVERY_PROFILE = {
  buyer: { label: 'Organization type', options: { foundation: 'Foundation or funder', education: 'School, college or education group', nonprofit: 'Nonprofit', association: 'Association or membership body', brand: 'Brand or company', public: 'Public agency' } },
  objective: { label: 'What it is for', options: { awareness: 'Be known and understood', funding: 'Raise money or win funders', members: 'Grow members, enrollment or attendance', advocacy: 'Change a policy or a public view', launch: 'Launch something new', sales: 'Sell, or win sponsors', culture: 'Align their own people' } },
  budget: { label: 'Scale', options: { unknown: 'Budget not shared yet', pilot: 'One piece or a pilot', initiative: 'One full initiative', ongoing: 'Several parts, or ongoing' } }
};

const Q = (id, text) => ({ id, text });
/**
 * His sales-call notes, asked on every deal before the guided questions (Scooter, 15 Nov 2026:
 * "department, what's happening, what's working and not working, engagement length, timeline to
 * getting started, and next steps").
 */
export const CALL_NOTES = [
  Q('call_department', 'Which department are we working with?'),
  Q('call_happening', 'What is happening with them right now?'),
  Q('call_working', 'What is working, and what is not working?'),
  Q('call_length', 'How long an engagement are they thinking of?'),
  Q('call_timeline', 'What is the timeline to getting started?'),
  Q('call_next', 'Next steps')
];
const BANK = {
  always: [
    Q('outcome', 'What has to be true six months from now for this to have been worth it?'),
    Q('audience', 'Who exactly needs to care, and what do they believe today?'),
    Q('trigger', 'Why now: what is launching, changing or at stake?'),
    Q('decide', 'Who signs off, who else has a say, and how do they decide?'),
    Q('timing', 'What dates are fixed, and what happens if one slips?')
  ],
  service: {
    'content-production': [Q('c_use', 'Where will the content live and be seen first, and for how long?'), Q('c_voices', 'Whose voices and stories carry it, and are they available to film or record?'), Q('c_assets', 'What footage, photos or brand assets already exist that we can use?')],
    'podcast-production': [Q('pc_show', 'Is this a new show or an existing one, and who hosts it?'), Q('pc_guests', 'Who are the guests or voices, and how often should episodes go out?'), Q('pc_home', 'Where will it be published and promoted?')],
    'virtual-hybrid-events': [Q('e_format', 'In person, virtual or hybrid, and how many people in each?'), Q('e_after', 'What should attendees do in the week after the event?'), Q('e_venue', 'Is a venue, platform or date already booked, and under whose contract?')],
    'community-as-a-service': [Q('cs_who', 'Who is the community for, and where do they gather today?'), Q('cs_value', 'What should members get from it, every month?'), Q('cs_owner', 'Who on their side will be its face, and for how long?')],
    'brand-strategy': [Q('b_gap', 'Where does the way they describe themselves fall short of the work they do?'), Q('b_owners', 'Who owns the brand inside, and who has to live with the result every day?'), Q('b_keep', 'What must stay (names, marks, colours, commitments to funders)?')],
    'web-development': [Q('w_job', 'What is the one job the site must do for its main visitor?'), Q('w_today', 'What runs the site today, and who updates it after we hand it over?'), Q('w_content', 'Which pages and content exist, and which must be written new?')],
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

/** The services picked on a deal, in the site's order (old single-service saves read as one). */
export function servicesOf(profile = {}) {
  const raw = [...(Array.isArray(profile.services) ? profile.services : []), profile.service].filter(Boolean).map((x) => OLD_SERVICE[x] || x);
  return SERVICES.map((x) => x.id).filter((id) => raw.includes(id));
}
/** The guided questions for one deal, in order: always, then by each service, organization type, objective and scale. */
export function discoveryQuestions(profile = {}) {
  const out = [...BANK.always];
  for (const id of servicesOf(profile)) out.push(...(BANK.service[id] || []));
  for (const part of ['buyer', 'objective', 'budget']) out.push(...(BANK[part][profile[part]] || []));
  const seen = new Set();
  return out.filter((q) => (seen.has(q.id) ? false : seen.add(q.id)));
}
export function cleanProfile(p = {}) {
  return { services: servicesOf(p), ...Object.fromEntries(Object.keys(DISCOVERY_PROFILE).map((k) => [k, DISCOVERY_PROFILE[k].options[p[k]] ? p[k] : ''])) };
}
/** Event dates on a deal (Virtual / hybrid event production only): YYYY-MM-DD, or ''. */
export function cleanEvent(e = {}, services = []) {
  if (!services.includes(EVENT_SERVICE.id)) return { start: '', end: '' };
  const d = (v) => (DAY_RE.test(String(v || '')) ? String(v) : '');
  return { start: d(e.start), end: d(e.end) };
}
export async function saveDiscovery(env, { key, profile, answers, event, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!validKey(key)) return 'failed';
  const clean = cleanProfile(profile);
  const data = { profile: clean, event: cleanEvent(event, clean.services), answers: Object.fromEntries(Object.entries(answers || {}).map(([k, v]) => [k, clip(v, 2000)]).filter(([, v]) => v)) };
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
].map(([service, line, unit], i) => ({ id: `L${i + 1}`, service: OLD_SERVICE[service] || service, line, unit, cost: null, team: service === 'team' }));
export const SERVICE_NAMES = { ...SERVICE_OPTIONS, team: 'Team time' };

async function sealed(env, sql, binds) {
  const r = await dbOf(env).prepare(sql).bind(...binds).first();
  return r ? decryptJson(env, r.data_enc ?? r.text_enc) : null;
}
export async function readCatalog(env, sample) {
  const c = await sealed(env, 'SELECT data_enc FROM catalog WHERE sample = ?', [sample ? 1 : 0]);
  return Array.isArray(c) && c.length ? c.map((l) => ({ ...l, service: OLD_SERVICE[l.service] || l.service })) : CATALOG_STRUCTURE.map((x) => ({ ...x }));
}
export function cleanCatalog(lines) {
  // Tier and quantity keep his event rate card's tiers and quantities (Scooter, 15 Nov 2026).
  return lines.map((l, i) => ({ id: clip(l.id, 20) || `L${i + 1}`, service: SERVICE_NAMES[l.service] ? l.service : 'team', line: clip(l.line, 120), unit: clip(l.unit, 30) || 'each', cost: num(l.cost), team: l.service === 'team' || Boolean(l.team), ...(clip(l.tier, 60) ? { tier: clip(l.tier, 60) } : {}), ...(num(l.qty) !== null ? { qty: num(l.qty) } : {}) })).filter((l) => l.line).slice(0, 200);
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
  const want = { service: ['service', 'serviceline', 'category', 'capability'], line: ['item', 'line', 'lineitem', 'deliverable', 'description', 'name'], unit: ['unit', 'per', 'units'], cost: ['cost', 'costrate', 'rate', 'ourcost', 'internalrate', 'unitcost'], tier: ['tier', 'package', 'level', 'tierpackage'], qty: ['qty', 'quantity', 'quantities', 'count', 'number'] };
  for (let r = 0; r < Math.min(grid.length, 40); r += 1) {
    const head = (grid[r] || []).map(norm);
    const idx = Object.fromEntries(Object.entries(want).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    if (idx.line < 0 || idx.cost < 0) continue;
    const guess = (s) => { const n = norm(s); return serviceFrom(s) || Object.entries(SERVICE_NAMES).find(([k, v]) => n.includes(norm(k)) || n.includes(norm(v).slice(0, 6)))?.[0] || 'team'; };
    return grid.slice(r + 1).filter((row) => String(row?.[idx.line] ?? '').trim()).map((row, i) => ({ id: `R${i + 1}`, service: idx.service > -1 ? guess(row[idx.service]) : (serviceFrom(row[idx.line]) || 'team'), line: String(row[idx.line]).trim(), unit: idx.unit > -1 ? String(row[idx.unit] || '').trim() : 'each', cost: num(row[idx.cost]), ...(idx.tier > -1 && String(row[idx.tier] || '').trim() ? { tier: String(row[idx.tier]).trim().slice(0, 60) } : {}), ...(idx.qty > -1 && num(row[idx.qty]) !== null ? { qty: num(row[idx.qty]) } : {}) }));
  }
  return null;
}

/* ------------------------------------------------------------------ the pricing builder */

export const TERMS = { 0: 'One project', 3: '3-month package', 6: '6-month package', 12: '12-month package' };
export const PAY_PLANS = { signing: 'All at signing', split: 'Half at signing, half at delivery', monthly: 'Monthly, paid at the start of each month', custom: 'A custom split (for example 30/30/20/20)' };

/**
 * How each role is billed (Scooter, 15 Nov 2026, quote-builder-format.pdf "Billing units that fit the
 * work"). `needs` are the boxes the cost is built from; `per` is the unit a standard rate must be in.
 */
export const BILLED = {
  job: { label: 'Flat fee for the whole job', needs: ['rate'], per: 'job' },
  month: { label: 'Flat fee per month', needs: ['rate', 'months'], per: 'month' },
  unit: { label: 'Flat fee per episode or event', needs: ['rate', 'qty'], per: 'job' },
  hourly_month: { label: 'Hourly, hours per month', needs: ['rate', 'hours', 'months'], per: 'hour' },
  hourly_unit: { label: 'Hourly, hours per episode or event', needs: ['rate', 'hours', 'qty'], per: 'hour' },
  hourly_total: { label: 'Hourly, total hours for the job', needs: ['rate', 'hours'], per: 'hour' }
};
/** What each box is called on a role row, by billing. */
export const BOX_WORDS = { rate: 'Rate', qty: 'Episodes or events', hours: { hourly_month: 'Hours a month', hourly_unit: 'Hours each', hourly_total: 'Total hours' }, months: 'Months' };
export const RATE_PER = { hour: 'an hour', month: 'a month', job: 'a job' };
/** People in the team directory are one of these; roles are kept apart from people. */
export const PERSON_TYPES = { owner: 'Owner', team: 'Team member', contractor: 'Contractor' };
/** A row on a service is a role (someone does it) or another cost (a booking, licence or tool). */
export const ROLE_KINDS = { role: 'A role (someone does it)', cost: 'Another cost (a booking, licence or tool)' };
const KIND_DEFAULT_BILLED = { role: 'hourly_total', cost: 'job' };

const R = (name, billed, kind = 'role') => ({ name, billed, kind });
/**
 * What choosing a service loads: its roles and cost categories, each with the billing that fits it
 * (Scooter, 15 Nov 2026: "Choosing a service loads its roles and cost categories (including strategy,
 * account management, coordination)"). Structure only: no rate, quantity, hours or months is filled in.
 */
export const SERVICE_ROLES = {
  'content-production': [R('Strategy and planning', 'hourly_month'), R('Account management', 'hourly_month'), R('Coordination', 'hourly_month'), R('Producer', 'unit'), R('Camera and crew per shoot', 'unit'), R('Video editor per piece', 'unit'), R('Graphics and templates', 'month'), R('Gear, locations and talent', 'unit', 'cost')],
  'podcast-production': [R('Strategy and planning', 'hourly_month'), R('Account management', 'hourly_month'), R('Coordination', 'hourly_unit'), R('Editor per episode', 'unit'), R('Clip cutter', 'unit'), R('Graphics and templates', 'month'), R('Studio booking (pass-through)', 'unit', 'cost')],
  'virtual-hybrid-events': [R('Strategy and run of show', 'job'), R('Account management', 'hourly_total'), R('Coordination', 'hourly_total'), R('Production manager', 'unit'), R('Technical director and platform operator', 'unit'), R('Stage, AV and crew', 'unit', 'cost'), R('Event platform licence', 'job', 'cost'), R('Venue and hospitality (pass-through)', 'job', 'cost')],
  'community-as-a-service': [R('Strategy and planning', 'hourly_month'), R('Account management', 'hourly_month'), R('Coordination', 'hourly_month'), R('Community lead', 'month'), R('Content and graphics', 'month'), R('Community tools and platforms', 'month', 'cost')],
  'brand-strategy': [R('Brand lead', 'job'), R('Strategy and planning', 'hourly_total'), R('Account management', 'hourly_total'), R('Coordination', 'hourly_total'), R('Designer', 'job'), R('Licences and fonts', 'job', 'cost')],
  'web-development': [R('Strategy and planning', 'hourly_total'), R('Account management', 'hourly_total'), R('Coordination', 'hourly_total'), R('Designer', 'job'), R('Developer', 'hourly_total'), R('Content writing', 'job'), R('Hosting and tools', 'month', 'cost')]
};
export function templateRoles(serviceId) {
  return (SERVICE_ROLES[serviceId] || []).map((r, i) => ({ rid: `t${i + 1}`, name: r.name, kind: r.kind, billed: r.billed, who: '', rate: null, qty: null, hours: null, months: null, out: false, custom: false, std: null, stdPer: '' }));
}

/** The event rate card's lines (his catalog, his tiers and quantities) as rows on a service. */
const UNIT_TO_BILLED = (unit) => {
  const u = String(unit || '').toLowerCase();
  if (/hour|hr/.test(u)) return { billed: 'hourly_total', box: 'hours', per: 'hour' };
  if (/month/.test(u)) return { billed: 'month', box: 'months', per: 'month' };
  return { billed: 'unit', box: 'qty', per: 'job' };
};
export function catalogTiers(catalog, serviceId) {
  const lines = (catalog || []).filter((l) => l.service === serviceId);
  return [...new Set(lines.map((l) => l.tier || ''))];
}
export function rolesFromCatalog(catalog, serviceId, tier) {
  return (catalog || []).filter((l) => l.service === serviceId && (l.tier || '') === (tier || '')).map((l, i) => {
    const u = UNIT_TO_BILLED(l.unit);
    return { rid: `c${l.id || i + 1}`, name: l.line, kind: 'cost', billed: u.billed, who: '', rate: null, qty: null, hours: null, months: null, [u.box]: num(l.qty), out: false, custom: false, std: num(l.cost), stdPer: u.per, card: tier || 'rate card' };
  });
}

/* The team directory: people, kept apart from roles. A rate is only there when it is known. */
export function cleanPeople(list) {
  const seen = new Set();
  return (list || []).map((p) => ({ id: /^[A-Za-z0-9_-]{2,24}$/.test(String(p.id || '')) ? String(p.id) : `p${randomToken(6)}`, name: clip(p.name, 120), type: PERSON_TYPES[p.type] ? p.type : 'contractor', rate: num(p.rate), per: RATE_PER[p.per] ? p.per : 'hour' }))
    .filter((p) => p.name && !seen.has(p.id) && seen.add(p.id)).slice(0, 200);
}
export async function readDirectory(env, sample) {
  const d = await sealed(env, 'SELECT data_enc FROM team_directory WHERE sample = ?', [sample ? 1 : 0]);
  return Array.isArray(d) ? d : [];
}
export async function saveDirectory(env, { people, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const clean = cleanPeople(people);
  let blob;
  try { blob = await encryptJson(env, clean); } catch { return 'no_token_key'; }
  await db.prepare('INSERT INTO team_directory (sample, data_enc, at) VALUES (?,?,?) ON CONFLICT(sample) DO UPDATE SET data_enc = excluded.data_enc, at = excluded.at').bind(sample ? 1 : 0, blob, now).run();
  const back = await readDirectory(env, sample);
  return JSON.stringify(back) === JSON.stringify(clean) ? 'saved' : 'failed';
}

/**
 * One role's rate and cost. The rate typed on the quote wins (this quote only; the standard rate is
 * not changed), then the rate card's standard rate, then the assigned person's standard rate when it
 * is in the unit the billing needs. Any box the billing needs that is empty makes the cost unknown:
 * left out of the math and named, never counted as zero.
 */
export function roleCost(r, dir = []) {
  const b = BILLED[r.billed] || BILLED.job;
  const person = dir.find((p) => p.id === r.who) || null;
  let rate = num(r.rate); let from = rate === null ? '' : 'quote';
  if (rate === null && num(r.std) !== null && (!r.stdPer || r.stdPer === b.per)) { rate = num(r.std); from = 'card'; }
  if (rate === null && person && num(person.rate) !== null && person.per === b.per) { rate = num(person.rate); from = 'directory'; }
  const vals = { rate, qty: num(r.qty), hours: num(r.hours), months: num(r.months) };
  const missing = b.needs.filter((k) => vals[k] === null);
  const cost = missing.length ? null : b.needs.reduce((a, k) => a * vals[k], 1);
  const mismatch = rate === null && person && num(person.rate) !== null && person.per !== b.per;
  return { cost, rate, from, missing, person, mismatch };
}

/** The services on a quote, each with its rows, its known cost and the client price typed for it. */
export function quoteServices(q = {}, dir = []) {
  if (Array.isArray(q.services)) {
    return q.services.map((x) => {
      if (!Array.isArray(x.roles)) return { ...x, roles: null };
      const rows = x.roles.map((r) => ({ ...r, ...roleCost(r, dir) }));
      const live = rows.filter((r) => !r.out);
      const known = live.filter((r) => r.cost !== null);
      return { ...x, rows, cost: known.length ? known.reduce((a, r) => a + r.cost, 0) : (live.length ? null : 0), unknown: live.filter((r) => r.cost === null).length };
    });
  }
  // A quote saved before 15 Nov 2026 (catalog lines): each line read as one item, its cost kept.
  return (q.lines || []).filter((l) => num(l.qty) > 0).map((l) => ({ id: l.id, name: l.line, specialist: '', cost: num(l.cost) === null ? null : num(l.qty) * num(l.cost), price: null, team: Boolean(l.team), roles: null }));
}
export const OWNER_MODELS = { hours: 'Hours at an hourly rate', monthly: 'A set amount each month of the engagement', share: 'A share of the client price (after discount)' };

/**
 * The numbers, kept apart (quote-builder-format.pdf "How the numbers read"): the client price is set
 * by the value of the work and never built from costs; costs are roles at their billed unit plus other
 * costs, internal only; a discount lowers the price, not the cost, so it comes out of margin; margin is
 * price minus the costs it includes, provisional while anything it includes is unpriced or unassigned.
 * Owner time is its own visible cost (planned one of three ways), apart from overhead and the tax
 * reserve; which of those the margin includes is shown and chosen on the quote.
 */
export function quoteMath(q, dir = []) {
  const term = TERMS[q.term] !== undefined ? Number(q.term) : 0;
  const months = Math.max(1, term || Number(q.months) || 1);
  const items = quoteServices(q, dir);
  const rows = items.flatMap((x) => (x.rows || []).filter((r) => !r.out).map((r) => ({ ...r, service: x.name })));
  const sum = (list) => list.reduce((a, r) => a + r.cost, 0);
  const isOwner = (r) => r.person?.type === 'owner';
  const known = (list) => list.filter((r) => r.cost !== null);
  const groups = {
    people: sum(known(rows.filter((r) => r.kind !== 'cost' && !isOwner(r)))),
    ownerRoles: sum(known(rows.filter((r) => r.kind !== 'cost' && isOwner(r)))),
    other: sum(known(rows.filter((r) => r.kind === 'cost')))
  };
  // Older quotes (one cost per service) still add up.
  const legacy = items.filter((x) => !x.rows && num(x.cost) !== null).reduce((a, x) => a + num(x.cost), 0);
  groups.people += legacy;
  const unpriced = [...rows.filter((r) => r.cost === null).map((r) => `${r.service} · ${r.name}`), ...items.filter((x) => !x.rows && num(x.cost) === null).map((x) => x.name)];
  const unassigned = rows.filter((r) => r.kind !== 'cost' && !r.person).map((r) => `${r.service} · ${r.name}`);
  const cost = groups.people + groups.ownerRoles + groups.other;

  const priced = items.filter((x) => num(x.price) !== null);
  const price = priced.length ? priced.reduce((a, x) => a + num(x.price), 0) : num(q.price);
  const d = q.discount || {};
  const dv = num(d.value);
  const discount = price === null || dv === null ? null : d.mode === 'pct' ? (price * dv) / 100 : dv;
  const net = price === null ? null : price - (discount || 0);

  const inc = { owner: q.include?.owner !== false, overhead: q.include?.overhead !== false, tax: q.include?.tax !== false };
  const o = q.ownerPlan || {};
  const ownerPerson = dir.find((p) => p.id === o.who) || null;
  const ownerRate = num(o.rate) ?? (ownerPerson && ownerPerson.per === 'hour' ? num(ownerPerson.rate) : null);
  const ownerTime = o.model === 'hours' ? (num(o.hours) === null || ownerRate === null ? null : num(o.hours) * ownerRate)
    : o.model === 'monthly' ? (num(o.monthly) === null ? null : num(o.monthly) * months)
      : o.model === 'share' ? (num(o.share) === null || net === null ? null : (net * num(o.share)) / 100) : null;
  const ov = q.overhead || {};
  const overhead = num(ov.value) === null ? null : ov.mode === 'amount' ? num(ov.value) : net === null ? null : (net * num(ov.value)) / 100;
  const taxPct = num(q.taxReserve);

  const notSet = [];
  if (inc.owner && ownerTime === null) notSet.push('owner time');
  if (inc.overhead && overhead === null) notSet.push('overhead');
  if (inc.tax && taxPct === null) notSet.push('tax reserve');
  const beforeTax = net === null ? null : net - cost - (inc.owner ? ownerTime || 0 : 0) - (inc.overhead ? overhead || 0 : 0);
  const tax = beforeTax === null || taxPct === null ? null : (Math.max(0, beforeTax) * taxPct) / 100;
  const amount = beforeTax === null ? null : beforeTax - (inc.tax ? tax || 0 : 0);
  const provisional = [...(unpriced.length ? [`${unpriced.length} not priced`] : []), ...(unassigned.length ? [`${unassigned.length} with nobody assigned`] : []), ...notSet.map((x) => `${x} not set`)];
  const includes = ['roles', 'other costs', ...(inc.owner ? ['owner time'] : []), ...(inc.overhead ? ['overhead'] : []), ...(inc.tax ? ['tax reserve'] : [])];
  const leftOut = [...(inc.owner ? [] : ['owner time']), ...(inc.overhead ? [] : ['overhead']), ...(inc.tax ? [] : ['tax reserve'])];
  const margin = net === null ? null : { amount, pct: net ? (amount / net) * 100 : null, provisional, belowCost: amount < 0, includes, leftOut, atMost: provisional.length > 0 };

  const inflow = new Array(months).fill(0);
  if (net !== null) {
    const plan = PAY_PLANS[q.plan] ? q.plan : (term ? 'monthly' : 'split');
    if (plan === 'signing') inflow[0] = net;
    else if (plan === 'split') { inflow[0] += net / 2; inflow[months - 1] += net / 2; }
    else if (plan === 'monthly') for (let m = 0; m < months; m += 1) inflow[m] = net / months;
    else {
      const parts = String(q.split || '').split(/[^\d.]+/).map(Number).filter((x) => x > 0);
      const total = parts.reduce((a, b) => a + b, 0) || 1;
      parts.forEach((p, i) => { const m = parts.length === 1 ? 0 : Math.round((i * (months - 1)) / (parts.length - 1)); inflow[m] += (net * p) / total; });
    }
  }
  // Costs go out in the month set on the service, else spread evenly over the engagement.
  const outflow = new Array(months).fill(0);
  for (const x of items.filter((y) => num(y.cost) !== null)) {
    const m = Math.min(months, Math.max(0, Number(x.month) || 0));
    if (m) outflow[m - 1] += num(x.cost);
    else for (let i = 0; i < months; i += 1) outflow[i] += num(x.cost) / months;
  }
  // The other costs the margin includes go out too, so the cash position never reads higher than the
  // margin: owner time and overhead (in the month set on each, else spread over the engagement), and the tax reserve set aside from each payment as it arrives. A cost left out of
  // the margin is left out here; one not set is not counted (the quote already says it is not set).
  // Owner time and overhead may be set to go out in one month, like a service; blank spreads them.
  const place = (v, at) => { const m = Math.min(months, Math.max(0, Number(at) || 0)); if (m) outflow[m - 1] += v; else for (let i = 0; i < months; i += 1) outflow[i] += v / months; };
  if (inc.owner && ownerTime !== null) place(ownerTime, o.month);
  if (inc.overhead && overhead !== null) place(overhead, ov.month);
  if (inc.tax && tax !== null && tax > 0 && net) inflow.forEach((cashIn, i) => { outflow[i] += (tax * cashIn) / net; });
  let running = 0;
  const timeline = inflow.map((cashIn, i) => { running += cashIn - outflow[i]; return { month: i + 1, cashIn, cashOut: outflow[i], position: running }; });
  return {
    term, months, items, rows, groups, cost, unpriced, unassigned, noCost: unpriced, price, discount, net,
    noPrice: items.filter((x) => num(x.price) === null).map((x) => x.name), ownerTime, overhead, taxPct, tax, include: inc, margin,
    overDiscount: net !== null && net < 0,
    monthly: net !== null && term ? net / term : null, timeline, shortMonths: timeline.filter((t) => t.position < 0).map((t) => t.month)
  };
}

const flag = (v) => v === true || v === 'on' || v === '1' || v === 'yes';
/** A quote from the form. Every service carried from Discovery, in the site's order, with its rows. */
export function cleanQuote(raw) {
  const byId = Object.fromEntries((raw.services || []).map((x) => [x.id, x]));
  const services = SERVICES.filter((x) => byId[x.id]).map((x) => {
    const r = byId[x.id];
    const roles = (Array.isArray(r.roles) ? r.roles : templateRoles(x.id)).map((y, i) => {
      const kind = ROLE_KINDS[y.kind] ? y.kind : 'role';
      return {
        rid: clip(y.rid, 30) || `r${i + 1}`, name: clip(y.name, 120), kind, billed: BILLED[y.billed] ? y.billed : KIND_DEFAULT_BILLED[kind], who: clip(y.who, 30),
        rate: num(y.rate), qty: num(y.qty), hours: num(y.hours), months: num(y.months), out: flag(y.out), custom: flag(y.custom), std: num(y.std), stdPer: RATE_PER[y.stdPer] ? y.stdPer : '', ...(y.card ? { card: clip(y.card, 60) } : {})
      };
    }).filter((y) => y.name).slice(0, 60);
    return { id: x.id, name: x.name, roles, price: num(r.price), month: Math.max(0, Math.min(12, Number(r.month) || 0)) };
  });
  const pick = (v, list, d = '') => (list.includes(v) ? v : d);
  return {
    v: 3, services,
    term: TERMS[raw.term] !== undefined ? Number(raw.term) : 0, months: Math.max(1, Math.min(24, Number(raw.months) || 1)), plan: PAY_PLANS[raw.plan] ? raw.plan : '', split: clip(raw.split, 40),
    discount: { mode: pick(raw.discount?.mode, ['amount', 'pct'], 'amount'), value: num(raw.discount?.value) },
    ownerPlan: { model: OWNER_MODELS[raw.ownerPlan?.model] ? raw.ownerPlan.model : '', who: clip(raw.ownerPlan?.who, 30), hours: num(raw.ownerPlan?.hours), rate: num(raw.ownerPlan?.rate), monthly: num(raw.ownerPlan?.monthly), share: num(raw.ownerPlan?.share), month: Math.max(0, Math.min(24, Number(raw.ownerPlan?.month) || 0)) },
    overhead: { mode: pick(raw.overhead?.mode, ['pct', 'amount'], 'pct'), value: num(raw.overhead?.value), month: Math.max(0, Math.min(24, Number(raw.overhead?.month) || 0)) },
    taxReserve: num(raw.taxReserve),
    include: { owner: flag(raw.include?.owner), overhead: flag(raw.include?.overhead), tax: flag(raw.include?.tax) },
    rationale: clip(raw.rationale, 3000), title: clip(raw.title, 160)
  };
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
 * A first proposal from a quote and the discovery answers, for him to edit. It carries the services,
 * his client price for each, the term, the payment plan and his rationale. It NEVER carries a
 * specialist's name, a specialist's cost, or what is left between cost and price: those are his only
 * (Scooter, 15 Nov 2026: "These internal costs must stay separate from anything the client sees").
 */
export function proposalDraft({ name, quote, discovery }) {
  const m = quoteMath(quote);
  const outcome = discovery?.answers?.outcome;
  const audience = discovery?.answers?.audience;
  const scope = m.items.filter((x) => !x.team).map((x) => `- ${x.name}${num(x.price) === null ? '' : `: ${usd(num(x.price))}`}`);
  const termWords = m.term ? `${TERMS[m.term]}: the work below is bundled over ${m.term} months${m.monthly !== null ? `, ${usd(m.monthly)} a month` : ''}.` : 'One project, scoped below.';
  const plan = PAY_PLANS[quote.plan] || (m.term ? PAY_PLANS.monthly : PAY_PLANS.split);
  const ev = discovery?.event;
  const when = ev?.start ? `Event dates: ${ev.start}${ev.end && ev.end !== ev.start ? ` to ${ev.end}` : ''}.` : '';
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
    ...(scope.length ? scope : ['- (Services from the quote)']),
    when,
    '',
    'Term',
    termWords,
    '',
    'Investment',
    // The client sees the price and any discount; never a role, a person, a rate, a cost or the margin.
    m.net !== null ? `${usd(m.net)} in total${m.discount ? ` (${usd(m.price)} less a ${usd(m.discount)} discount)` : ''}. Payment: ${plan}.` : '(Set the client price on the quote.)',
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

/** An accepted deal gets its work side: the account team, a task per quoted service, and a portal. */
export async function startDelivery(env, { key, team, quote, sample }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  const s = sample ? 1 : 0;
  const have = await db.prepare('SELECT key FROM delivery WHERE key = ? AND sample = ?').bind(key, s).first();
  if (have) return { created: false };
  const stmts = [db.prepare('INSERT INTO delivery (key, sample, at, team) VALUES (?,?,?,?)').bind(key, s, now, clip(team, 1000))];
  // One task per service (or per line of an older quote); never a specialist's name or cost.
  for (const x of (quote ? quoteServices(quote) : []).filter((y) => !y.team)) stmts.push(db.prepare('INSERT INTO task (key, sample, at, title, owner, due, done, client) VALUES (?,?,?,?,?,?,0,1)').bind(key, s, now, clip(x.name, 200), '', ''));
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
