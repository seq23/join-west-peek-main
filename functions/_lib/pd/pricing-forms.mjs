/**
 * The quote tool's forms, read into the shapes `pricing.mjs` cleans and saves. Every page posts its
 * whole form, so a field missing from the page is never read as "cleared". An edit on a quote
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
export function estimateFromForm(form, prev, pricing) {
  const f = reader(form);
  const base = prev && !prev.unreadable ? prev : newQuote(pricing.settings);
  const posted = new Set(form.getAll('lid').map(String));
  const lines = [];
  for (const l of base.lines || []) {
    if (!posted.has(l.lid)) { lines.push(l); continue; }
    const g = (k) => f(`l_${l.lid}_${k}`);
    if (on(g('del'))) continue;
    const n = Math.min(Number(g('cn')) || 0, 30);
    const components = [];
    for (let j = 0; j < n; j += 1) {
      const c = (k) => g(`c${j}_${k}`);
      if (on(c('del'))) continue;
      const stored = (l.components || []).find((x) => x.cid === c('cid')) || {};
      const who = c('who');
      const qty = c('qty');
      const rate = c('rate');
      // An edit here is an override for this quote only, and starts as a Guess.
      const qtyChanged = !same(qty, c('qtywas')) || !same(who, c('whowas'));
      const rateChanged = !blank(rate) && !same(rate, c('ratewas'));
      components.push({ cid: stored.cid || c('cid'), who, qty, qtyStatus: qtyChanged ? 'guess' : c('qtyStatus') || stored.qtyStatus, rate: blank(rate) ? null : rate, rateStatus: blank(rate) ? 'agreed' : rateChanged ? 'guess' : c('rateStatus') || 'guess' });
    }
    if (g('new_who')) components.push({ cid: '', who: g('new_who'), qty: g('new_qty'), qtyStatus: 'guess', rate: null, rateStatus: 'agreed' });
    lines.push({ ...l, name: g('name') || l.name, description: form.has(`l_${l.lid}_description`) ? g('description') : l.description, qty: g('qty'), due: g('due') || l.due, actual: g('actual'), cut: on(g('cut')), components });
  }
  // Adding: a template's services, one catalog service, or a custom line.
  const services = pricing.services || [];
  const svc = (sid) => services.find((s) => s.id === sid && !s.archived);
  const tpl = (pricing.templates || []).find((t) => t.id === f('add_tid'));
  if (tpl) for (const it of tpl.items) { const s = svc(it.sid); if (s) lines.push(lineFromService(s, it.qty)); }
  if (svc(f('add_sid'))) lines.push(lineFromService(svc(f('add_sid')), blank(f('add_qty')) ? 1 : f('add_qty')));
  if (f('add_custom').trim()) lines.push(customLine(f('add_custom')));

  const others = [];
  const on2 = Math.min(Number(f('on')) || 0, 61);
  for (let i = 0; i < on2; i += 1) {
    const o = (k) => f(`o_${i}_${k}`);
    if (!o('item').trim()) continue;
    others.push({ oid: o('oid'), item: o('item'), vendor: o('vendor'), cost: o('cost'), pass: on(o('pass')), status: o('status'), due: o('due'), cut: on(o('cut')) });
  }
  const milestones = [];
  const mn = Math.min(Number(f('mn')) || 0, 13);
  for (let i = 0; i < mn; i += 1) {
    const m = (k) => f(`m_${i}_${k}`);
    if (!m('label').trim() && blank(m('pct')) && blank(m('amount'))) continue;
    milestones.push({ mid: m('mid'), label: m('label'), pct: m('pct'), amount: m('amount'), trigger: m('trigger'), date: m('date') });
  }
  return {
    ...base, lines, others, milestones,
    client: f('client'), project: f('project'), extraHours: f('extra_hours'), extraStatus: f('extra_status'),
    price: f('price'), discount: { mode: f('disc_mode'), value: f('disc') }, reason: f('reason')
  };
}
export { OWNER };
