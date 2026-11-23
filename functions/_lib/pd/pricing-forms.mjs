/**
 * The quote tool's forms, read into the shapes `pricing.mjs` cleans and saves. A field missing from
 * the page is never read as "cleared": each form changes only what it shows. An edit on a quote
 * (who does it, how much, a rate for this quote only) starts as a Guess until he marks it Agreed
 * (brief, section 6).
 */
import { OWNER, SETTINGS, customLine, lineFromService, newQuote } from './pricing.mjs';

const reader = (form) => (k) => { const x = form.get(k); return typeof x === 'string' ? x : ''; };
const on = (x) => x === '1' || x === 'on';
const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const blank = (x) => String(x ?? '').trim() === '';

export function settingsFromForm(form) {
  const f = reader(form);
  return Object.fromEntries(SETTINGS.map((s) => [s.id, f(s.id)]));
}

export function peopleFromForm(form, current = []) {
  const f = reader(form);
  const n = Math.min(Number(f('n')) || 0, 302);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const p = (k) => f(`p_${i}_${k}`);
    if (!p('name').trim()) continue;
    const was = current.find((x) => x.id === p('id'));
    out.push({ id: was ? was.id : '', name: p('name'), role: p('role'), rate: p('rate'), unit: p('unit'), status: p('status'), source: p('source'), asOf: p('asOf'), archived: on(p('archived')) });
  }
  return out;
}

export function servicesFromForm(form, current = []) {
  const f = reader(form);
  const posted = new Set(form.getAll('sid').map(String));
  const out = current.map((s) => {
    if (!posted.has(s.id)) return s;
    const g = (k) => f(`s_${s.id}_${k}`);
    const n = Math.min(Number(g('cn')) || 0, 30);
    const components = [];
    for (let j = 0; j < n; j += 1) {
      const c = (k) => g(`c${j}_${k}`);
      if (on(c('del'))) continue;
      components.push({ cid: c('cid'), who: c('who'), qty: c('qty'), qtyStatus: c('qtyStatus') });
    }
    if (g('new_who')) components.push({ cid: '', who: g('new_who'), qty: g('new_qty'), qtyStatus: g('new_qtyStatus') || 'guess' });
    return { ...s, name: g('name') || s.name, unit: g('unit') || s.unit, category: g('category') || s.category, legacy: g('legacy'), description: g('description'), pass: on(g('pass')), archived: on(g('archived')), components };
  });
  if (f('new_name').trim()) out.push({ id: '', name: f('new_name'), unit: f('new_unit') || 'each', category: f('new_category') || 'Other', description: '', pass: false, legacy: null, components: [], archived: false });
  return out;
}

export function templatesFromForm(form, current = []) {
  const f = reader(form);
  const n = Math.min(Number(f('n')) || 0, 60);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = (k) => f(`t_${i}_${k}`);
    if (!t('name').trim()) continue;
    const was = current.find((x) => x.id === t('id'));
    const m = Math.min(Number(t('n')) || 0, 40);
    const items = [];
    for (let j = 0; j < m; j += 1) if (!on(t(`${j}_del`)) && t(`${j}_sid`)) items.push({ sid: t(`${j}_sid`), qty: t(`${j}_qty`) || 1 });
    if (t('new_sid')) items.push({ sid: t('new_sid'), qty: t('new_qty') || 1 });
    out.push({ id: was ? was.id : '', name: t('name'), items });
  }
  if (f('new_name').trim()) out.push({ id: '', name: f('new_name'), items: [] });
  return out;
}

/**
 * A quote from its page, on top of the version it was built from. Lines keep what the page does not
 * show (the service they came from, pass-through, legacy price); components keep their id.
 */
/** Words that mean his own hours on a "who does it" row. */
const ME = new Set(['me', 'myself', 'i', 'owner', 'my time', 'my hours']);
export const isMe = (name) => ME.has(String(name || '').trim().toLowerCase());
/** The category a quote line belongs to (older lines carry none: read it from the catalog). */
export const lineCategory = (l, services = []) => l.category || (l.sid ? services.find((s) => s.id === l.sid)?.category || '' : '');

/**
 * One "who does it" row per cost (step 2): a typed name ("me" for his own hours), how many, and the
 * price of each. A row left as it was keeps what it had (a rate-list person keeps the rate list's
 * rate); an edited row becomes this quote's own and starts as a Guess unless he ticks Agreed with it.
 * A row with nothing in it is dropped.
 */
function componentsFromForm(g, l, people) {
  const n = Math.min(Number(g('cn')) || 0, 30);
  const out = [];
  for (let j = 0; j < n; j += 1) {
    const c = (k) => g(`c${j}_${k}`);
    const name = c('name').trim();
    const qty = c('qty');
    const rate = c('rate');
    if (!name && blank(qty) && blank(rate)) continue;
    const stored = (l.components || []).find((x) => x.cid === c('cid'));
    const agreed = on(c('agreed'));
    const toggled = agreed !== on(c('agreedwas'));
    const changed = !stored || !same(name, c('namewas')) || !same(qty, c('qtywas')) || !same(rate, c('ratewas'));
    if (!changed) {
      out.push(toggled ? { ...stored, qtyStatus: agreed ? 'agreed' : 'guess', rateStatus: stored.rate === null ? stored.rateStatus : agreed ? 'agreed' : 'guess' } : stored);
      continue;
    }
    const me = isMe(name);
    const match = !me && name ? people.find((p) => !p.archived && p.name.trim().toLowerCase() === name.toLowerCase()) : null;
    const status = agreed && (toggled || !stored) ? 'agreed' : 'guess';
    out.push({ cid: stored?.cid || '', who: me ? OWNER : match ? match.id : '', name: me || match ? '' : name, qty: blank(qty) ? (me ? null : 1) : qty, qtyStatus: status, rate: blank(rate) ? null : rate, rateStatus: blank(rate) ? 'agreed' : status });
  }
  return out;
}

/**
 * The guided quote's five forms (Scooter, 23 Nov 2026: "Five screens, one decision each"). Each step
 * posts only its own fields; anything not on the page is kept exactly as it was.
 */
export function estimateFromForm(form, prev, pricing) {
  const f = reader(form);
  const has = (k) => form.has(k);
  const base = prev && !prev.unreadable ? prev : newQuote(pricing.settings);
  const services = (pricing.services || []).filter((s) => !s.archived);
  const people = pricing.people || [];
  const posted = new Set(form.getAll('lid').map(String));
  let lines = [];
  for (const l of base.lines || []) {
    if (!posted.has(l.lid)) { lines.push(l); continue; }
    const g = (k) => f(`l_${l.lid}_${k}`);
    const gh = (k) => has(`l_${l.lid}_${k}`);
    if (on(g('del'))) continue;
    const next = { ...l, category: lineCategory(l, services) };
    if (gh('qty')) next.qty = g('qty');
    if (gh('keepon')) next.cut = !on(g('keep'));
    if (gh('name') && g('name').trim()) next.name = g('name');
    if (gh('description')) next.description = g('description');
    if (gh('due')) next.due = g('due') || l.due;
    if (gh('actual')) next.actual = g('actual');
    if (gh('cn')) next.components = componentsFromForm(g, l, people);
    lines.push(next);
  }
  // Step 1: ticking a kind of work brings in every one of its services not already in the quote (a line he
  // cut stays cut, never doubled), priced from the rate list. Unticking removes its lines only when the tile
  // was shown ticked (catwas); a tile shown part-filled and left unticked leaves his lines exactly as they are.
  if (has('cats')) {
    const picked = new Set(form.getAll('cat').map(String));
    const was = new Set(form.getAll('catwas').map(String));
    const sids = new Set(lines.map((l) => l.sid).filter(Boolean));
    lines = lines.filter((l) => { const c = lineCategory(l, services); return !c || picked.has(c) || !was.has(c); });
    for (const c of picked) for (const s of services.filter((x) => x.category === c && !sids.has(x.id))) lines.push(lineFromService(s));
  }
  // More ways to add: one of his sets, one catalog service, or a line of his own.
  const svc = (sid) => services.find((s) => s.id === sid);
  const tpl = (pricing.templates || []).find((t) => t.id === f('add_tid'));
  if (tpl) for (const it of tpl.items) { const s = svc(it.sid); if (s) lines.push(lineFromService(s, it.qty)); }
  if (svc(f('add_sid'))) lines.push(lineFromService(svc(f('add_sid')), blank(f('add_qty')) ? 1 : f('add_qty')));
  if (f('add_custom').trim()) lines.push(customLine(f('add_custom')));

  const out = { ...base, lines };
  if (has('on')) {
    out.others = [];
    const n = Math.min(Number(f('on')) || 0, 61);
    for (let i = 0; i < n; i += 1) {
      const o = (k) => f(`o_${i}_${k}`);
      if (!o('item').trim()) continue;
      out.others.push({ oid: o('oid'), item: o('item'), vendor: o('vendor'), cost: o('cost'), pass: on(o('pass')), status: o('status'), due: o('due'), cut: on(o('cut')) });
    }
  }
  if (has('mn')) {
    out.milestones = [];
    const n = Math.min(Number(f('mn')) || 0, 13);
    for (let i = 0; i < n; i += 1) {
      const m = (k) => f(`m_${i}_${k}`);
      if (!m('label').trim() && blank(m('pct')) && blank(m('amount'))) continue;
      out.milestones.push({ mid: m('mid'), label: m('label'), pct: m('pct'), amount: m('amount'), trigger: m('trigger'), date: m('date') });
    }
  }
  if (has('client')) out.client = f('client');
  if (has('project')) out.project = f('project');
  if (has('extra_hours')) { out.extraHours = f('extra_hours'); out.extraStatus = f('extra_status'); }
  if (has('price')) out.price = f('price');
  if (has('disc')) out.discount = { mode: f('disc_mode'), value: f('disc') };
  if (has('reason')) out.reason = f('reason');
  return out;
}
export { OWNER };
