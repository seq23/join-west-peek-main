/**
 * The quote tool (Scooter, 19 Nov 2026, "WPP Quote Tool Builder Brief"): owner-only settings, the
 * people and vendor rate list, the service catalog built from cost components, templates, and ONE
 * pure function that prices a quote. Screens read `priceQuote`'s output and do no math of their own.
 *
 * His words, 19 Nov 2026: "I need custom quotes, not fixed packages. I can add, remove, change or leave
 * lines unfinished. Missing costs should be clearly flagged without blocking me from working. Show my
 * time as a cost, keep my pay separate from company profit, and keep all internal costs and margins
 * out of the client view." And: "Payment schedules are for seeing deposit and expense timing, not
 * enforcing terms. No automatic changes to the existing cash forecast in this phase."
 *
 * Nothing here is a real figure. Every setting and rate starts blank; the 36 catalog services carry
 * names, categories and units only (the brief's 4a), with no components until he fills them.
 * This module never reads or writes the Money sheet, `cashPicture` or any cash record.
 * Settings, rates, catalog, templates and quotes are AES-GCM encrypted (PRODUCTIONS_TOKEN_KEY), one
 * store per environment (the host's own D1) and per mode (sample rows apart from his).
 */
import { dbOf, ensureSchema } from './schema.mjs';
import { decryptJson, encryptJson, num, randomToken } from './core.mjs';

const clip = (v, n = 300) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const idOr = (v, prefix) => (ID_RE.test(String(v || '')) ? String(v) : `${prefix}${randomToken(5)}`);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (DAY_RE.test(String(v || '')) ? String(v) : '');
const pctOk = (v) => { const n = num(v); return n === null ? null : Math.max(0, Math.min(99.99, n)); };
const nonNeg = (v) => { const n = num(v); return n === null ? null : Math.max(0, n); };

/* ------------------------------------------------------------------ settings (brief section 3) */

/**
 * About a dozen, each blank until he types it. The owner hourly cost is calculated (pay divided by
 * billable hours), never typed. Team rates live on the rate list, not here.
 */
export const SETTINGS = [
  { id: 'ownerPay', label: 'Your yearly pay target', unit: '$', help: 'What you aim to pay yourself in a year.' },
  { id: 'ownerHours', label: 'Your billable hours in a year', unit: 'hours', help: 'With the pay target, this makes your hourly cost.' },
  { id: 'overheadPct', label: 'Overhead', unit: '%', help: 'Added to direct cost on every line.' },
  { id: 'contingencyPct', label: 'Contingency', unit: '%', help: 'Added only to the part of a cost marked Guess.' },
  { id: 'targetMarginPct', label: 'Target margin', unit: '%', help: 'Margin on price. Sets the starting number.' },
  { id: 'warnMarginPct', label: 'Warning line', unit: '%', help: 'A margin under this shows a note. It never blocks a quote.' },
  { id: 'passMarkupPct', label: 'Pass-through handling markup', unit: '%', help: 'On pass-through costs only, such as a platform license.' },
  { id: 'taxPct', label: 'Tax set-aside', unit: '%', help: 'Shown beside the price as cash held. Your accountant sets it.' },
  { id: 'depositPct', label: 'Default deposit', unit: '%', help: 'Fills the deposit on a new quote. Change it on any quote.' },
  // Open in the brief (section 10): "whether contingency should also pad the owner's own hours". His choice, never a
  // fixed rule. Not chosen follows the brief's own test numbers (yes) until he picks; the screen says so.
  { id: 'contingencyOwner', label: 'Contingency on your own hours', unit: 'choice', choices: { yes: 'Yes', no: 'No' }, help: 'When your own hours are marked Guess, should contingency pad them too? Not chosen yet counts as yes, which is what the brief\'s test numbers assume. No: contingency pads team, vendor and other costs only.' }
];
const PCT_SETTINGS = new Set(['overheadPct', 'contingencyPct', 'targetMarginPct', 'warnMarginPct', 'passMarkupPct', 'taxPct', 'depositPct']);
export function cleanSettings(raw = {}) {
  return Object.fromEntries(SETTINGS.map((s) => [s.id, s.unit === 'choice' ? (Object.hasOwn(s.choices, String(raw[s.id] ?? '')) ? String(raw[s.id]) : null) : PCT_SETTINGS.has(s.id) ? pctOk(raw[s.id]) : nonNeg(raw[s.id])]));
}
/** Pay divided by billable hours, or null when either is blank (never typed). */
export function ownerHourly(settings = {}) {
  const pay = num(settings.ownerPay);
  const hours = num(settings.ownerHours);
  return pay === null || hours === null || hours <= 0 ? null : pay / hours;
}

/* ------------------------------------------------------------------ the rate list: people and vendors */

export const UNITS = { hour: 'an hour', day: 'a day', month: 'a month', piece: 'a piece', flat: 'flat' };
export const STATUS = { agreed: 'Agreed', guess: 'Guess' };
/** The owner's own hours on any component: priced at the owner hourly cost from Settings. */
export const OWNER = 'owner';
export function cleanPeople(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((p) => ({
    id: idOr(p.id, 'v'), name: clip(p.name, 120), role: clip(p.role, 120), rate: nonNeg(p.rate),
    unit: UNITS[p.unit] ? p.unit : 'hour', status: STATUS[p.status] ? p.status : 'guess', source: clip(p.source, 160), asOf: day(p.asOf), archived: Boolean(p.archived)
  })).filter((p) => p.name && p.id !== OWNER && !seen.has(p.id) && seen.add(p.id)).slice(0, 300);
}

/* ------------------------------------------------------------------ the catalog (brief section 4a) */

const P = true;
const SEED = [
  ['Virtual events', [['Event management', 'per event'], ['Pre-event onboarding', 'per event'], ['Speaker onboarding', 'per speaker'], ['Technical director / webcast crew', 'per show day'], ['Speaker + attendee tech support', 'per show day'], ['Event asset design bundle', 'per event'], ['Production management', 'per week'], ['Event platform license (pass-through)', 'per event', P], ['Attendee processing (pass-through)', 'per attendee', P], ['Live webinar (prep, soundcheck, stream)', 'per webinar'], ['Hybrid event virtual stage', 'per event day']]],
  ['Podcast production', [['Series branding (name, logo, show art)', 'per series'], ['Guest booking + prep', 'per episode'], ['Recording (studio)', 'per episode'], ['Full-episode edit', 'per episode'], ['Cutdowns + vertical clips', 'per episode'], ['Carousel + story graphics', 'per episode'], ['Social rollout + release plan', 'per series']]],
  ['Content production', [['Event video coverage (crew, gear, planning, travel)', 'per event'], ['Event recap video (edit)', 'per video'], ['Full-length multicam edit', 'per video'], ['Social reels (set of 3)', 'per set'], ['Guest testimonials (set of 3)', 'per set'], ['Social content piece', 'per piece'], ['Street interview shoot day', 'per shoot day'], ['Studio shoot day', 'per shoot day']]],
  ['Brand', [['Brand strategy + identity', 'per project'], ['Social asset kit + content playbook', 'per sprint']]],
  ['Web development', [['Website design + build', 'per project']]],
  ['Community', [['Community portal setup', 'per project']]],
  ['Exec positioning', [['Creative lead', 'per month'], ['LinkedIn ghostwriting', 'per month'], ['Account + project management', 'per month'], ['Owner time: strategy + client calls', 'per month'], ['Salon (10-12 guests)', 'per salon']]],
  ['Retainer', [['Ongoing support + maintenance', 'per month']]]
];
/** The 36 services, names, categories and units only; every one starts with no components. */
export const SEED_SERVICES = SEED.flatMap(([category, list]) => list.map(([name, unit, pass]) => ({ name, category, unit, pass: Boolean(pass) })))
  .map((x, i) => ({ id: `s${String(i + 1).padStart(2, '0')}`, name: x.name, category: x.category, unit: x.unit, description: '', pass: x.pass, legacy: null, components: [], archived: false }));
export const CATEGORIES = [...new Set(SEED.map(([c]) => c))];

function cleanComponent(c = {}) {
  return { cid: idOr(c.cid, 'c'), who: c.who === OWNER ? OWNER : (ID_RE.test(String(c.who || '')) ? String(c.who) : ''), qty: nonNeg(c.qty), qtyStatus: STATUS[c.qtyStatus] ? c.qtyStatus : 'guess', rate: nonNeg(c.rate), rateStatus: STATUS[c.rateStatus] ? c.rateStatus : 'guess' };
}
export function cleanServices(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((s) => ({
    id: idOr(s.id, 's'), name: clip(s.name, 160), category: clip(s.category, 80) || 'Other', unit: clip(s.unit, 40) || 'each', description: clip(s.description, 600),
    pass: Boolean(s.pass), legacy: nonNeg(s.legacy), archived: Boolean(s.archived),
    // A catalog component names who delivers it and how much; its rate is the rate list's (no override here).
    components: (Array.isArray(s.components) ? s.components : []).map(cleanComponent).map(({ rate, rateStatus, ...c }) => c).slice(0, 30)
  })).filter((s) => s.name && !seen.has(s.id) && seen.add(s.id)).slice(0, 200);
}

/* ------------------------------------------------------------------ templates */

const T_NAMES = ['Virtual event', 'Podcast season', 'Webinar series', 'Event with video', 'Exec positioning (6 months)', 'Brand + web'];
/** The brief's six starting sets, by name only: he chooses what goes in each. */
export const SEED_TEMPLATES = T_NAMES.map((name, i) => ({ id: `t${i + 1}`, name, items: [] }));
export function cleanTemplates(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((t) => ({ id: idOr(t.id, 't'), name: clip(t.name, 120), items: (Array.isArray(t.items) ? t.items : []).filter((x) => ID_RE.test(String(x.sid || ''))).map((x) => ({ sid: String(x.sid), qty: nonNeg(x.qty) ?? 1 })).slice(0, 40) }))
    .filter((t) => t.name && !seen.has(t.id) && seen.add(t.id)).slice(0, 60);
}

/* ------------------------------------------------------------------ storage: one encrypted row per kind and mode */

const KINDS = { settings: { clean: cleanSettings, empty: () => cleanSettings({}) }, people: { clean: cleanPeople, empty: () => [] }, services: { clean: cleanServices, empty: () => SEED_SERVICES.map((s) => ({ ...s, components: [] })) }, templates: { clean: cleanTemplates, empty: () => SEED_TEMPLATES.map((t) => ({ ...t, items: [] })) } };
export async function readPricing(env, kind, sample) {
  const db = dbOf(env);
  const k = KINDS[kind];
  if (!db || !k) return null;
  await ensureSchema(db);
  const r = await db.prepare('SELECT data_enc, at FROM pricing WHERE kind = ? AND sample = ?').bind(kind, sample ? 1 : 0).first();
  if (!r) return k.empty();
  const data = await decryptJson(env, r.data_enc);
  return data === null ? { unreadable: true } : data;
}
export async function savedAt(env, sample) {
  const rows = (await dbOf(env).prepare('SELECT kind, at FROM pricing WHERE sample = ?').bind(sample ? 1 : 0).all()).results || [];
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.at)]));
}
/** Saves, reads back, and says 'saved' only when the read-back is the same. */
export async function savePricing(env, { kind, data, sample }, now = Date.now()) {
  const db = dbOf(env);
  const k = KINDS[kind];
  if (!db || !k) return 'failed';
  await ensureSchema(db);
  const clean = k.clean(data);
  let blob;
  try { blob = await encryptJson(env, clean); } catch { return 'no_token_key'; }
  await db.prepare('INSERT INTO pricing (kind, sample, data_enc, at) VALUES (?,?,?,?) ON CONFLICT(kind, sample) DO UPDATE SET data_enc = excluded.data_enc, at = excluded.at').bind(kind, sample ? 1 : 0, blob, now).run();
  const back = await readPricing(env, kind, sample);
  return JSON.stringify(back) === JSON.stringify(clean) ? 'saved' : 'failed';
}
export async function readAllPricing(env, sample) {
  const [settings, people, services, templates] = await Promise.all(['settings', 'people', 'services', 'templates'].map((k) => readPricing(env, k, sample)));
  return { settings, people, services, templates };
}

/* ------------------------------------------------------------------ a quote (brief section 4) */

export const DUE = { booking: 'At booking', before: 'Before delivery', after: 'After delivery', monthly: 'Monthly' };
/** Paid out before the client's second payment (a monthly cost counts in full: planning, not terms). */
const DUE_EARLY = new Set(['booking', 'before', 'monthly']);
export const QUOTE_STATUS = { draft: 'Draft', sent: 'Sent (frozen)' };

/** A quote line from a catalog service: its structure is copied, so a later catalog edit never changes it. */
export function lineFromService(s, qty = 1) {
  return { lid: `l${randomToken(5)}`, sid: s.id, name: s.name, description: s.description || '', unit: s.unit, pass: Boolean(s.pass), legacy: s.legacy ?? null, qty: nonNeg(qty) ?? 1, cut: false, due: 'before', actual: null,
    components: (s.components || []).map((c) => ({ ...cleanComponent({ ...c, cid: c.cid }), rate: null, rateStatus: 'agreed' })) };
}
export function customLine(name = '') {
  return { lid: `l${randomToken(5)}`, sid: '', name: clip(name, 160), description: '', unit: 'each', pass: false, legacy: null, qty: 1, cut: false, due: 'before', actual: null, components: [] };
}
/**
 * A new quote's payments: the brief's deposit (its % prefilled from Settings) and the second client payment it
 * measures timing against (section 8). When each falls is his to write on the quote: no trigger is assumed
 * (Scooter, 19 Nov 2026: "My approved direction is the email and brief I sent, not additional decisions taken
 * on my behalf"; the brief: "accepts any deposit terms the owner sets").
 */
export function defaultMilestones(settings = {}) {
  const dep = num(settings.depositPct);
  return [{ mid: 'm1', label: 'Deposit', pct: dep, amount: null, trigger: '', date: '' }, { mid: 'm2', label: 'Second payment', pct: dep === null ? null : 100 - dep, amount: null, trigger: '', date: '' }];
}
export function newQuote(settings = {}) {
  return { v: 1, client: '', project: '', lines: [], others: [], extraHours: null, extraStatus: 'guess', price: null, discount: { mode: 'amount', value: null }, reason: '', milestones: defaultMilestones(settings) };
}
export function cleanEstimate(raw = {}) {
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((l) => ({
    lid: idOr(l.lid, 'l'), sid: ID_RE.test(String(l.sid || '')) ? String(l.sid) : '', name: clip(l.name, 160), description: clip(l.description, 600), unit: clip(l.unit, 40) || 'each',
    pass: Boolean(l.pass), legacy: nonNeg(l.legacy), qty: nonNeg(l.qty), cut: Boolean(l.cut), due: DUE[l.due] ? l.due : 'before', actual: nonNeg(l.actual),
    components: (Array.isArray(l.components) ? l.components : []).map(cleanComponent).slice(0, 30)
  })).filter((l) => l.name).slice(0, 80);
  const others = (Array.isArray(raw.others) ? raw.others : []).map((o) => ({ oid: idOr(o.oid, 'o'), item: clip(o.item, 160), vendor: clip(o.vendor, 120), cost: nonNeg(o.cost), pass: Boolean(o.pass), status: STATUS[o.status] ? o.status : 'guess', due: DUE[o.due] ? o.due : 'before', cut: Boolean(o.cut) }))
    .filter((o) => o.item).slice(0, 60);
  const milestones = (Array.isArray(raw.milestones) ? raw.milestones : []).map((m, i) => ({ mid: idOr(m.mid, 'm'), label: clip(m.label, 80) || `Payment ${i + 1}`, pct: pctOk(m.pct), amount: nonNeg(m.amount), trigger: clip(m.trigger, 120), date: day(m.date) })).slice(0, 12);
  return {
    v: 1, client: clip(raw.client, 160), project: clip(raw.project, 160), lines, others,
    extraHours: nonNeg(raw.extraHours), extraStatus: STATUS[raw.extraStatus] ? raw.extraStatus : 'guess',
    price: nonNeg(raw.price), discount: { mode: raw.discount?.mode === 'pct' ? 'pct' : 'amount', value: nonNeg(raw.discount?.value) }, reason: clip(raw.reason, 200), milestones
  };
}

/* ------------------------------------------------------------------ the math (brief section 5): one pure function */

/** Rounds a recommended price up: to the next 25 dollars, and under 100 dollars to the next 50 cents (brief, section 7). */
export function roundUp(x) {
  if (x === null || x === undefined) return null;
  const step = x < 100 ? 0.5 : 25;
  return Math.ceil(x / step - 1e-9) * step;
}

/**
 * Prices one quote. Full precision inside; screens round for display only.
 *   component cost  = quantity x rate (owner hours at the owner hourly cost), x the line's quantity
 *   loaded cost     = (direct + contingency% x guessed part) x (1 + overhead%); his own guessed hours are in
 *                     the guessed part unless Settings says No to "Contingency on your own hours"
 *   starting number = loaded / (1 - target margin)
 *   pass-through    = cost x (1 + markup); no overhead, contingency or margin
 *   your pay        = owner hours x owner hourly cost (already inside total cost)
 *   company profit  = price after discount - total cost; margin = profit / price
 *   service margin  = the same with pass-through billing and cost removed (only when there is one)
 *   tax set-aside   = price x tax%, beside the price, never inside margin
 * A missing cost is counted and never summed as zero. A cut line counts for nothing.
 */
export function priceQuote({ settings = {}, people = [], quote = {} }) {
  const S = cleanSettings(settings);
  const rate0 = ownerHourly(S);
  const pct = (k) => (S[k] === null ? null : S[k] / 100);
  const o = pct('overheadPct');
  const c = pct('contingencyPct');
  const t = pct('targetMarginPct');
  const mk = pct('passMarkupPct');
  const padOwner = S.contingencyOwner !== 'no';
  const notSet = SETTINGS.filter((s) => s.id !== 'depositPct' && s.unit !== 'choice' && S[s.id] === null).map((s) => s.label);
  const byId = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const loadOf = (direct, guessed) => (direct + (c || 0) * guessed) * (1 + (o || 0));
  const startOf = (loaded) => (t === null ? null : loaded / (1 - t));

  const lines = (quote.lines || []).map((l) => {
    const lq = num(l.qty);
    let direct = 0; let guessed = 0; let missing = 0; let ownerHours = 0; let rawOut = 0; let guess = false;
    const comps = (l.components || []).map((cp) => {
      const isOwner = cp.who === OWNER;
      const person = isOwner ? null : byId[cp.who] || null;
      const over = num(cp.rate);
      const rate = over !== null ? over : isOwner ? rate0 : person && !person.archived ? num(person.rate) : null;
      const rateStatus = over !== null ? cp.rateStatus : isOwner ? 'agreed' : person?.status || 'guess';
      const qty = num(cp.qty);
      const why = !cp.who ? 'nobody chosen' : !isOwner && !person ? 'not on the rate list' : rate === null ? (isOwner ? 'your hourly cost is not set' : 'no rate') : qty === null ? 'no quantity' : lq === null ? 'no line quantity' : '';
      const g = rateStatus === 'guess' || cp.qtyStatus === 'guess';
      if (why) { missing += 1; return { ...cp, person, isOwner, rate, rateStatus, cost: null, why, guess: g }; }
      const cost = qty * rate * lq;
      direct += cost;
      if (g) { guess = true; if (!isOwner || padOwner) guessed += cost; }
      if (isOwner) ownerHours += qty * lq; else rawOut += cost;
      return { ...cp, person, isOwner, rate, rateStatus, cost, why: '', guess: g };
    });
    if (!comps.length) missing += 1;
    const loaded = l.pass ? direct : loadOf(direct, guessed);
    const start = l.pass ? direct * (1 + (mk || 0)) : startOf(loaded);
    const legacy = num(l.legacy) !== null && lq !== null ? num(l.legacy) * lq : null;
    const rec = start === null ? null : Math.max(start, legacy ?? 0);
    const out = { ...l, comps, direct, guessed, loaded, start, rec, missing, guess, ownerHours, rawOut, incomplete: missing > 0 };
    out.variance = num(l.actual) === null ? null : num(l.actual) - loaded;
    return out;
  });
  const live = lines.filter((l) => !l.cut);

  const others = (quote.others || []).map((x) => {
    const cost = num(x.cost);
    const guess = x.status === 'guess';
    if (cost === null) return { ...x, loaded: null, start: null, missing: 1, guess };
    const loaded = x.pass ? cost : cost * (1 + (guess ? c || 0 : 0)) * (1 + (o || 0));
    const start = x.pass ? cost * (1 + (mk || 0)) : startOf(loaded);
    return { ...x, loaded, start, missing: 0, guess };
  });
  const liveOthers = others.filter((x) => !x.cut);

  const xh = num(quote.extraHours);
  const extra = xh === null || xh === 0 ? null : (() => {
    const guess = quote.extraStatus === 'guess';
    if (rate0 === null) return { hours: xh, loaded: null, start: null, missing: 1, guess };
    const loaded = xh * rate0 * (1 + (guess && padOwner ? c || 0 : 0)) * (1 + (o || 0));
    return { hours: xh, loaded, start: startOf(loaded), missing: 0, guess };
  })();

  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
  const parts = [...live, ...liveOthers, ...(extra ? [extra] : [])];
  const missing = parts.reduce((a, x) => a + x.missing, 0);
  const estimate = parts.some((x) => x.guess);
  const totalCost = sum(parts, 'loaded');
  const start = t === null && parts.some((x) => !x.pass) ? null : sum(parts, 'start');
  const ownerHours = sum(live, 'ownerHours') + (extra && rate0 !== null ? extra.hours : 0);
  const pay = rate0 === null ? (ownerHours ? null : 0) : ownerHours * rate0;
  const passParts = [...live.filter((l) => l.pass), ...liveOthers.filter((x) => x.pass && x.loaded !== null)];
  const ptBilling = sum(passParts, 'start');
  const ptCost = sum(passParts, 'loaded');
  const recBase = start === null ? null : start + live.reduce((a, l) => a + ((l.rec ?? 0) - (l.start ?? 0)), 0);
  const recommended = roundUp(recBase);

  const price = num(quote.price);
  const d = quote.discount || {};
  const dv = num(d.value);
  const discount = price === null || dv === null ? null : d.mode === 'pct' ? (price * dv) / 100 : dv;
  const net = price === null ? null : price - (discount || 0);
  const profit = net === null ? null : net - totalCost;
  const margin = net ? profit / net : null;
  const serviceMargin = passParts.length && net !== null && net - ptBilling ? (net - ptBilling - (totalCost - ptCost)) / (net - ptBilling) : null;
  const tax = net === null || S.taxPct === null ? null : (net * S.taxPct) / 100;

  // Flags, never blocks: few and meaningful.
  const flags = [];
  if (missing) flags.push({ id: 'missing', text: `${missing} ${missing === 1 ? 'cost is' : 'costs are'} missing. Totals count what is known.` });
  if (net !== null && start !== null && net < start - 0.005) flags.push({ id: 'below', text: `The price is below the starting number by ${dollars(start - net)}.` });
  if (margin !== null && S.warnMarginPct !== null && margin * 100 < S.warnMarginPct) flags.push({ id: 'warn', text: `Margin ${(margin * 100).toFixed(1)}% is under your warning line of ${S.warnMarginPct}%.` });
  if (discount !== null && net !== null && net < 0) flags.push({ id: 'discount', text: 'The discount is bigger than the price.' });

  // When below the starting number, the lowest-value lines to cut, until the gap is covered.
  let suggestCuts = [];
  if (flags.some((f) => f.id === 'below')) {
    let gap = start - net;
    for (const l of [...live].filter((x) => x.start !== null && x.start > 0).sort((a, b) => a.start - b.start)) {
      if (gap <= 0 || suggestCuts.length >= 3) break;
      suggestCuts.push({ lid: l.lid, name: l.name, saves: l.start });
      gap -= l.start;
    }
  }

  const timing = paymentTiming({ quote, net, live, liveOthers, pay });
  if (timing.short !== null && timing.short > 0) flags.push({ id: 'short', text: `The deposit is short of what goes out before the second payment by ${dollars(timing.short)}.` });

  return {
    settings: S, ownerRate: rate0, notSet, lines, others, extra, missing, estimate, totalCost, start, recommended, ownerHours, pay,
    price, discount, net, profit, margin, serviceMargin, hasPass: passParts.length > 0, ptBilling, ptCost, tax, flags, suggestCuts, timing
  };
}
const dollars = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Payment timing (brief section 8), information only: what goes out before the client's second
 * payment (the raw costs due at booking, before delivery or monthly, plus the owner's pay on the job,
 * which goes out when the deposit lands) against the deposit. "Covered" or "short by"; short is a
 * flag, never a block, and any terms he sets are accepted. Nothing here writes to a cash record.
 */
export function paymentTiming({ quote = {}, net, live = [], liveOthers = [], pay }) {
  const ms = (quote.milestones || []).map((m) => ({ ...m, value: num(m.amount) !== null ? num(m.amount) : num(m.pct) !== null && net !== null ? (net * num(m.pct)) / 100 : null }));
  const outs = [];
  for (const l of live) if (l.rawOut) outs.push({ what: l.name, amount: l.rawOut, due: DUE[l.due] ? l.due : 'before' });
  for (const x of liveOthers) if (x.loaded !== null) outs.push({ what: x.item, amount: num(x.cost), due: DUE[x.due] ? x.due : 'before' });
  const early = outs.filter((x) => DUE_EARLY.has(x.due));
  const unknownPay = pay === null;
  const required = early.reduce((a, x) => a + x.amount, 0) + (pay || 0);
  const deposit = ms.length ? ms[0].value : null;
  const covered = deposit === null ? null : deposit - required;
  const planned = ms.reduce((a, m) => a + (m.value || 0), 0);
  return { milestones: ms, outs, early, required, deposit, covered: covered !== null && covered >= 0 ? covered : null, short: covered !== null && covered < 0 ? -covered : null, unknownPay, planned, unplanned: net === null ? null : net - planned };
}

/**
 * What the client sees (brief, "the one hard rule"): the included services, their descriptions and the
 * price. Never a person, rate, cost, margin, cut line, flag or internal history. Built from the quote
 * itself, never from the priced result, so nothing internal can leak through it.
 */
export function clientView(quote = {}) {
  const price = num(quote.price);
  const d = quote.discount || {};
  const dv = num(d.value);
  const discount = price === null || dv === null || !dv ? null : d.mode === 'pct' ? (price * dv) / 100 : dv;
  return {
    client: clip(quote.client, 160), project: clip(quote.project, 160),
    services: (quote.lines || []).filter((l) => !l.cut && l.name).map((l) => ({ name: l.name, description: l.description || '', qty: num(l.qty), unit: l.unit || '' })),
    price, discount, total: price === null ? null : price - (discount || 0)
  };
}

/* ------------------------------------------------------------------ versions: drafts reprice, sent quotes are frozen */

/** The newest version of a deal's quote, decrypted, with its frozen snapshot when sent. */
export async function latestEstimate(env, key, sample) {
  const db = dbOf(env);
  await ensureSchema(db);
  const r = await db.prepare('SELECT id, at, version, status, data_enc FROM estimate WHERE key = ? AND sample = ? ORDER BY id DESC LIMIT 1').bind(key, sample ? 1 : 0).first();
  if (!r) return null;
  const d = await decryptJson(env, r.data_enc);
  return d ? { ...d, _id: r.id, _at: Number(r.at), version: Number(r.version), status: r.status } : { unreadable: true, _id: r.id, _at: Number(r.at), version: Number(r.version), status: r.status };
}
export async function estimateHistory(env, key, sample) {
  const rows = (await dbOf(env).prepare('SELECT id, at, version, status FROM estimate WHERE key = ? AND sample = ? ORDER BY id DESC LIMIT 40').bind(key, sample ? 1 : 0).all()).results || [];
  // One line per version: its newest save.
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.version) ? false : seen.add(r.version))).map((r) => ({ id: r.id, at: Number(r.at), version: Number(r.version), status: r.status }));
}
/**
 * Saves a quote. A draft re-copies the live settings and rates on every save (so a rate change
 * reprices it). `send` freezes this version with the settings and rates it was priced with. Saving
 * on top of a sent version makes the next version, as a draft; the sent one is never changed.
 */
export async function saveEstimate(env, { key, quote, sample, send = false, pricing }, now = Date.now()) {
  const db = dbOf(env);
  await ensureSchema(db);
  if (!/^[a-z0-9~-]{1,120}$/.test(String(key || ''))) return { outcome: 'failed' };
  const prev = await latestEstimate(env, key, sample);
  const clean = cleanEstimate(quote);
  const version = !prev ? 1 : prev.status === 'sent' ? prev.version + 1 : prev.version;
  const snapshot = { settings: cleanSettings(pricing?.settings || {}), people: cleanPeople(pricing?.people || []) };
  const data = { ...clean, snapshot };
  let blob;
  try { blob = await encryptJson(env, data); } catch { return { outcome: 'no_token_key' }; }
  const status = send ? 'sent' : 'draft';
  const r = await db.prepare('INSERT INTO estimate (key, sample, at, version, status, data_enc) VALUES (?,?,?,?,?,?) RETURNING id').bind(key, sample ? 1 : 0, now, version, status, blob).first();
  const back = await latestEstimate(env, key, sample);
  const { _id, _at, version: v, status: st, ...rest } = back || {};
  const ok = back && _id === r?.id && v === version && st === status && JSON.stringify(rest) === JSON.stringify(data);
  return { outcome: ok ? 'saved' : 'failed', version, status };
}
/** The settings and rates a quote is priced with: live for a draft, its frozen snapshot once sent. */
export function pricingFor(est, live) {
  if (est && est.status === 'sent' && est.snapshot) return { settings: est.snapshot.settings, people: est.snapshot.people, frozen: true };
  return { settings: live.settings, people: live.people, frozen: false };
}
