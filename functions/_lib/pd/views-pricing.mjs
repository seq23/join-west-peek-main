/**
 * The quote tool's screens (Scooter, 19 Nov 2026, the quote tool builder brief): Settings, the rate
 * list, the service catalog, templates, the quote on each deal, and the client view. Phone first at
 * 390px, plain forms, no script (the dashboard's CSP allows none). Every figure here is Scooter's
 * only; the client view carries services, descriptions and the price, nothing else.
 * Screens do no math: every number comes from `priceQuote`.
 */
import { esc, usTime } from './core.mjs';
import { CATEGORIES, DUE, OWNER, QUOTE_STATUS, SETTINGS, STATUS, UNITS, clientView, ownerHourly, priceQuote } from './pricing.mjs';
import { moneyHold } from './views-deal.mjs';
import { lineCategory } from './pricing-forms.mjs';
import { serviceFrom } from '../services.mjs';
import { empty, errorBox, gap, page, sec } from './views.mjs';

const shell = (title, body, ctx) => page(title, body, { tab: 'pipeline', counts: ctx.counts, sample: ctx.sample, signedIn: true });
const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(value ?? '')}">`;
const v = (n) => (n === null || n === undefined ? '' : esc(n));
const opts = (map, cur) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}"${String(cur) === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
/** Dollars and cents, never a blank for zero. */
export const c$ = (n) => (n === null || n === undefined ? '' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const or$ = (n, words) => (n === null || n === undefined ? gap(words) : esc(c$(n)));
const pctW = (x) => (x === null || x === undefined ? '' : `${(x * 100).toFixed(1)}%`);
const holdBox = (why) => errorBox(why, 'Nothing about money was saved.', '/dashboard/access#limit', 'Who can see what');

/** The four owner-only screens behind every quote. */
function toolNav(cur) {
  const links = [['quote-settings', 'Settings'], ['rates', 'Rate list'], ['services', 'Service catalog'], ['templates', 'Templates']];
  return `<nav class="d-files" aria-label="Quote tool">${links.map(([p, l]) => `<a class="d-btn${p === cur ? ' d-primary' : ''}" href="/dashboard/${p}"${p === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}
function head(title, ctx, cur, intro) {
  const back = ctx.back || '/dashboard';
  return `<p><a class="d-help" href="${esc(back)}">← ${back === '/dashboard' ? 'Pipeline' : 'Back'}</a></p><h1>${esc(title)}</h1>${toolNav(cur)}<p class="d-sub">${intro}</p>${ctx.flash || ''}`;
}
function unreadable(title, ctx, cur) {
  return shell(title, `${head(title, ctx, cur, '')}${errorBox('This could not be read back.', 'It is saved encrypted, and the key that opens it is not the one this site has now. Nothing else is affected.', '/dashboard/connections', 'Connections')}`, ctx);
}
const savedLine = (at, ctx) => (at ? `<p class="d-src">Saved and checked ${esc(usTime(at, ctx.now))}. Private to you, encrypted.</p>` : '<p class="d-src">Nothing saved yet.</p>');

/* ------------------------------------------------------------------ settings */

export function renderPricingSettings(ctx) {
  const title = 'Quote settings';
  const intro = 'Private to you. Every quote is priced with these. Leave anything you do not know yet blank: quotes flag it, they never stop you.';
  const hold = moneyHold(ctx);
  if (hold) return shell(title, `${head(title, ctx, 'quote-settings', intro)}${holdBox(hold)}`, ctx);
  const s = ctx.pricing.settings;
  if (s?.unreadable) return unreadable(title, ctx, 'quote-settings');
  const rate = ownerHourly(s);
  const choice = (d) => `<label for="qs-${d.id}">${esc(d.label)}</label><select id="qs-${d.id}" name="${d.id}"><option value=""${s[d.id] ? '' : ' selected'}>Not chosen yet (counts as yes)</option>${Object.entries(d.choices).map(([k, l]) => `<option value="${k}"${s[d.id] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><p class="d-sub">${esc(d.help)}</p>`;
  const field = (d) => d.unit === 'choice' ? choice(d) : `<label for="qs-${d.id}">${esc(d.label)}${d.unit === '%' ? ' (%)' : d.unit === '$' ? ' ($)' : ''}</label><input id="qs-${d.id}" name="${d.id}" inputmode="decimal" value="${v(s[d.id])}" placeholder="not set"><p class="d-sub">${esc(d.help)}</p>`;
  const first = Object.values(s).every((x) => x === null) ? '<div class="d-emptybox"><p>Nothing is set yet. Start with your pay target and billable hours: that gives your hourly cost, so your own time is priced on every quote.</p></div>' : '';
  const body = `${head(title, ctx, 'quote-settings', intro)}${first}
    <form class="d-form" method="post" action="/dashboard/quote-settings">${hidden('back', '/dashboard/quote-settings')}
    ${sec('you', 'Your time', `${SETTINGS.slice(0, 2).map(field).join('')}<p>Your hourly cost: <strong>${rate === null ? gap('set your pay and hours') : esc(c$(rate))}</strong> <span class="d-sub">(pay divided by hours, never typed)</span></p>`)}
    ${sec('rules', 'Pricing', SETTINGS.slice(2).map(field).join(''))}
    <p><button type="submit" class="d-primary">Save settings</button></p></form>
    ${savedLine(ctx.pricingAt?.settings, ctx)}
    <p class="d-sub">A draft quote is repriced with these on every edit. A sent quote keeps the settings it was sent with.</p>`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ the rate list */

export function renderRates(ctx) {
  const title = 'Rate list';
  const intro = 'The people and vendors who deliver the work, with their rates. Private to you, encrypted. A rate you are not sure of stays a Guess, and quotes that use it carry an "estimate" tag.';
  const hold = moneyHold(ctx);
  if (hold) return shell(title, `${head(title, ctx, 'rates', intro)}${holdBox(hold)}`, ctx);
  const list = ctx.pricing.people;
  if (list?.unreadable) return unreadable(title, ctx, 'rates');
  const rate = ownerHourly(ctx.pricing.settings || {});
  const row = (p, i) => `<li class="d-row"><div class="d-row__main">${hidden(`p_${i}_id`, p.id || '')}
    <div class="d-grid2"><div><label for="rp-${i}-n">Name</label><input id="rp-${i}-n" name="p_${i}_name" maxlength="120" value="${esc(p.name || '')}"${p.id ? '' : ' placeholder="Add a person or vendor"'}></div><div><label for="rp-${i}-r">Role</label><input id="rp-${i}-r" name="p_${i}_role" maxlength="120" value="${esc(p.role || '')}" placeholder="editor, platform, crew"></div></div>
    <div class="d-grid3"><div><label for="rp-${i}-rate">Rate ($)</label><input id="rp-${i}-rate" name="p_${i}_rate" inputmode="decimal" value="${v(p.rate)}" placeholder="unknown"></div><div><label for="rp-${i}-u">Per</label><select id="rp-${i}-u" name="p_${i}_unit">${opts(UNITS, p.unit || 'hour')}</select></div><div><label for="rp-${i}-s">Rate is</label><select id="rp-${i}-s" name="p_${i}_status">${opts(STATUS, p.status || 'guess')}</select></div><div><label for="rp-${i}-d">As of</label><input id="rp-${i}-d" name="p_${i}_asOf" type="date" value="${esc(p.asOf || '')}"></div></div>
    <label for="rp-${i}-src">Source</label><input id="rp-${i}-src" name="p_${i}_source" maxlength="160" value="${esc(p.source || '')}" placeholder="their invoice, an email, your estimate">
    ${p.id ? `<label class="d-check"><input type="checkbox" name="p_${i}_archived" value="1"${p.archived ? ' checked' : ''}> Archived (kept on old quotes, not offered on new ones)</label>` : ''}</div></li>`;
  const n = list.length;
  const first = n ? '' : '<div class="d-emptybox"><p>No one is on the rate list yet. Add each team member, contractor and vendor with their rate, then use them on the services in the catalog.</p></div>';
  const body = `${head(title, ctx, 'rates', intro)}${first}
    <ul class="d-kv"><li><span>Owner (your time)<br><span class="d-sub">From Settings, never typed</span></span><span>${rate === null ? gap('not set') : `${esc(c$(rate))} an hour`}</span></li></ul>
    <form class="d-form" method="post" action="/dashboard/rates">${hidden('back', '/dashboard/rates')}${hidden('n', n + 2)}
    ${sec('people', `People and vendors · ${n}`, `<ul class="d-list">${list.map(row).join('')}${row({}, n)}${row({}, n + 1)}</ul><p class="d-sub">The last two rows add someone. Clear a name to remove them. A blank rate is unknown, never zero.</p>`)}
    <p><button type="submit" class="d-primary">Save the rate list</button></p></form>${savedLine(ctx.pricingAt?.people, ctx)}
    <p class="d-sub">Changing a rate reprices every draft quote that uses it. Sent quotes do not change.</p>`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ the service catalog */

function whoOptions(people, cur, { withOwner = true } = {}) {
  const live = people.filter((p) => !p.archived || p.id === cur);
  const gone = cur && cur !== OWNER && !people.some((p) => p.id === cur) ? '<option value="" selected>Not chosen (removed from the rate list)</option>' : '';
  return `${gone}<option value=""${!cur ? ' selected' : ''}>Choose who</option>${withOwner ? `<option value="${OWNER}"${cur === OWNER ? ' selected' : ''}>Owner (your time, hours)</option>` : ''}${live.map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}${p.role ? ` · ${esc(p.role)}` : ''}${p.rate === null ? ' · no rate' : ''}</option>`).join('')}`;
}
/** Incomplete until it has components and every one has someone and a quantity. */
export function serviceIncomplete(s, people) {
  if (!s.components.length) return 'no cost components yet';
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const n = s.components.filter((c) => !c.who || c.qty === null || (c.who !== OWNER && (!byId[c.who] || byId[c.who].rate === null))).length;
  return n ? `${n} ${n === 1 ? 'component needs' : 'components need'} a person, quantity or rate` : '';
}
export function renderServices(ctx) {
  const title = 'Service catalog';
  const intro = 'Every service starts empty. Add who delivers it and how much (hours, days or pieces) for one unit: the rate comes from your rate list. Quotes copy a service when it is added, so editing it here never changes a quote already made.';
  const hold = moneyHold(ctx);
  if (hold) return shell(title, `${head(title, ctx, 'services', intro)}${holdBox(hold)}`, ctx);
  const { services, people } = ctx.pricing;
  if (services?.unreadable || people?.unreadable) return unreadable(title, ctx, 'services');
  const cats = [...new Set([...CATEGORIES, ...services.map((s) => s.category)])];
  const comp = (s, c, j) => {
    const f = (k) => `s_${s.id}_c${j}_${k}`;
    return `<div class="d-role">${hidden(f('cid'), c.cid)}<div class="d-grid3"><div><label for="${f('who')}">Who</label><select id="${f('who')}" name="${f('who')}">${whoOptions(people, c.who)}</select></div><div><label for="${f('qty')}">How much per ${esc(s.unit.replace(/^per /, ''))}</label><input id="${f('qty')}" name="${f('qty')}" inputmode="decimal" value="${v(c.qty)}" placeholder="hours, days, pieces"></div><div><label for="${f('qtyStatus')}">Quantity is</label><select id="${f('qtyStatus')}" name="${f('qtyStatus')}">${opts(STATUS, c.qtyStatus)}</select></div><div><label class="d-check"><input type="checkbox" name="${f('del')}" value="1"> Remove</label></div></div></div>`;
  };
  const svc = (s) => {
    const f = (k) => `s_${s.id}_${k}`;
    const why = serviceIncomplete(s, people);
    return `<details class="d-fold"><summary><span>${esc(s.name)} <span class="d-sub">· ${esc(s.unit)}${s.pass ? ' · pass-through' : ''}</span>${why ? ` <span class="d-gold">· incomplete</span>` : ''}</span></summary>${hidden('sid', s.id)}${hidden(f('cn'), s.components.length)}
      ${why ? `<p class="d-sub d-gold">Incomplete: ${esc(why)}.</p>` : ''}
      <div class="d-grid2"><div><label for="${f('name')}">Name</label><input id="${f('name')}" name="${f('name')}" maxlength="160" value="${esc(s.name)}"></div><div><label for="${f('unit')}">Unit</label><input id="${f('unit')}" name="${f('unit')}" maxlength="40" value="${esc(s.unit)}"></div></div>
      <div class="d-grid2"><div><label for="${f('category')}">Category</label><select id="${f('category')}" name="${f('category')}">${cats.map((c) => `<option${c === s.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div><div><label for="${f('legacy')}">Legacy price per unit ($, optional)</label><input id="${f('legacy')}" name="${f('legacy')}" inputmode="decimal" value="${v(s.legacy)}" placeholder="none"></div></div>
      <label for="${f('description')}">What the client reads</label><textarea id="${f('description')}" name="${f('description')}" maxlength="600" placeholder="One or two lines the client sees on the quote">${esc(s.description)}</textarea>
      <label class="d-check"><input type="checkbox" name="${f('pass')}" value="1"${s.pass ? ' checked' : ''}> Pass-through (billed at cost plus your handling markup, apart from service margin)</label>
      <h3>Cost components · ${s.components.length}</h3>
      ${s.components.map((c, j) => comp(s, c, j)).join('') || '<p class="d-sub">None yet. Add the first below.</p>'}
      <div class="d-role"><p class="d-sub">Add a component</p><div class="d-grid3"><div><label for="${f('new_who')}">Who</label><select id="${f('new_who')}" name="${f('new_who')}">${whoOptions(people, '')}</select></div><div><label for="${f('new_qty')}">How much</label><input id="${f('new_qty')}" name="${f('new_qty')}" inputmode="decimal" placeholder="hours, days, pieces"></div><div><label for="${f('new_qtyStatus')}">Quantity is</label><select id="${f('new_qtyStatus')}" name="${f('new_qtyStatus')}">${opts(STATUS, 'guess')}</select></div></div></div>
      <label class="d-check"><input type="checkbox" name="${f('archived')}" value="1"${s.archived ? ' checked' : ''}> Archived (not offered on new quotes)</label>
    </details>`;
  };
  const live = services.filter((s) => !s.archived);
  const done = live.filter((s) => !serviceIncomplete(s, people)).length;
  const byCat = cats.map((c) => [c, live.filter((s) => s.category === c)]).filter(([, l]) => l.length);
  const archived = services.filter((s) => s.archived);
  const noPeople = people.length ? '' : '<div class="d-emptybox"><p>Your rate list is empty, so only your own time can be added yet. Add the people and vendors first.</p><a class="d-btn d-primary" href="/dashboard/rates">Open the rate list</a></div>';
  const body = `${head(title, ctx, 'services', intro)}${noPeople}<p class="d-sub">${done} of ${live.length} services are complete.</p>
    <form class="d-form" method="post" action="/dashboard/services">${hidden('back', '/dashboard/services')}
    ${byCat.map(([c, l]) => sec(`cat-${c.toLowerCase().replace(/[^a-z]+/g, '-')}`, `${c} · ${l.length}`, l.map(svc).join(''))).join('')}
    ${archived.length ? sec('archived', `Archived · ${archived.length}`, archived.map(svc).join('')) : ''}
    ${sec('add', 'Add a service', `<div class="d-grid2"><div><label for="ns-name">Name</label><input id="ns-name" name="new_name" maxlength="160"></div><div><label for="ns-unit">Unit</label><input id="ns-unit" name="new_unit" maxlength="40" placeholder="per event"></div></div><label for="ns-cat">Category</label><select id="ns-cat" name="new_category">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>`)}
    <p><button type="submit" class="d-primary">Save the catalog</button></p></form>${savedLine(ctx.pricingAt?.services, ctx)}`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ templates */

function serviceSelect(name, services, cur = '', { blank = 'Choose a service' } = {}) {
  const live = services.filter((s) => !s.archived || s.id === cur);
  const cats = [...new Set(live.map((s) => s.category))];
  return `<select id="${esc(name)}" name="${esc(name)}"><option value="">${esc(blank)}</option>${cats.map((c) => `<optgroup label="${esc(c)}">${live.filter((s) => s.category === c).map((s) => `<option value="${esc(s.id)}"${s.id === cur ? ' selected' : ''}>${esc(s.name)} (${esc(s.unit)})</option>`).join('')}</optgroup>`).join('')}</select>`;
}
export function renderTemplates(ctx) {
  const title = 'Templates';
  const intro = 'A saved set of services and quantities, to start a quote in one click. You choose what goes in each.';
  const hold = moneyHold(ctx);
  if (hold) return shell(title, `${head(title, ctx, 'templates', intro)}${holdBox(hold)}`, ctx);
  const { templates, services } = ctx.pricing;
  if (templates?.unreadable || services?.unreadable) return unreadable(title, ctx, 'templates');
  const name = (sid) => services.find((s) => s.id === sid)?.name || 'A removed service';
  const t = (x, i) => `<details class="d-fold"${x.items.length ? '' : ' open'}><summary><span>${esc(x.name)} <span class="d-sub">· ${x.items.length ? `${x.items.length} services` : 'empty'}</span></span></summary>${hidden(`t_${i}_id`, x.id)}${hidden(`t_${i}_n`, x.items.length)}
    <label for="t-${i}-name">Name <span class="d-sub">(clear it to remove this template)</span></label><input id="t-${i}-name" name="t_${i}_name" maxlength="120" value="${esc(x.name)}">
    ${x.items.length ? `<ul class="d-list">${x.items.map((it, j) => `<li class="d-row"><div class="d-row__main">${hidden(`t_${i}_${j}_sid`, it.sid)}<span class="d-row__title">${esc(name(it.sid))}</span><div class="d-grid2"><div><label for="t-${i}-${j}-q">Quantity</label><input id="t-${i}-${j}-q" name="t_${i}_${j}_qty" inputmode="decimal" value="${v(it.qty)}"></div><div><label class="d-check"><input type="checkbox" name="t_${i}_${j}_del" value="1"> Remove</label></div></div></div></li>`).join('')}</ul>` : '<p class="d-sub">No services in this set yet. Add the first below.</p>'}
    <div class="d-grid2"><div><label for="t_${i}_new_sid">Add a service</label>${serviceSelect(`t_${i}_new_sid`, services)}</div><div><label for="t-${i}-nq">Quantity</label><input id="t-${i}-nq" name="t_${i}_new_qty" inputmode="decimal" placeholder="1"></div></div></details>`;
  const n = templates.length;
  const body = `${head(title, ctx, 'templates', intro)}
    <form class="d-form" method="post" action="/dashboard/templates">${hidden('back', '/dashboard/templates')}${hidden('n', n)}
    ${sec('sets', `Templates · ${n}`, templates.map(t).join('') || '<p class="d-sub">No templates yet.</p>')}
    ${sec('add', 'Add a template', '<label for="nt-name">Name</label><input id="nt-name" name="new_name" maxlength="120" placeholder="Conference season">')}
    <p><button type="submit" class="d-primary">Save templates</button></p></form>${savedLine(ctx.pricingAt?.templates, ctx)}`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ the quote on a deal */

const tag = (on, words = 'estimate') => (on ? ` <span class="d-tag">${words}</span>` : '');
const keyBox = (label, val, sub = '', cls = '') => `<div><span>${label}</span><strong${cls ? ` class="${cls}"` : ''}>${val}</strong>${sub}</div>`;

/**
 * The quote as a guided flow (Scooter, 23 Nov 2026: "a guided flow instead of one long form. Five
 * screens, one decision each"). Each screen saves what it shows and moves on; the math is
 * `priceQuote`'s, unchanged. The first screen carries no figures, settings links or warnings.
 */
export const QUOTE_STEPS = [
  { n: 1, label: 'The work', next: 'Next: who does what' },
  { n: 2, label: 'Who does what', next: 'Next: other costs and your time' },
  { n: 3, label: 'Other costs and your time', next: 'Next: the price' },
  { n: 4, label: 'The price', next: 'Next: review and send' },
  { n: 5, label: 'Review and send', next: '' }
];
export const stepPath = (key, n) => `/dashboard/flow/${encodeURIComponent(key)}/quote${n > 1 ? `/${n}` : ''}`;
/** Discovery's services suggest the work (site service → catalog category). */
const SUGGEST = { 'virtual-hybrid-events': 'Virtual events', 'podcast-production': 'Podcast production', 'content-production': 'Content production', 'brand-strategy': 'Brand', 'web-development': 'Web development', 'community-as-a-service': 'Community' };
const ME_WORDS = 'me';

function stepBar(key, cur) {
  return `<ol class="d-stepbar" aria-label="Quote steps">${QUOTE_STEPS.map((s) => `<li${s.n === cur ? ' aria-current="step"' : ''}${s.n < cur ? ' class="is-done"' : ''}><a href="${stepPath(key, s.n)}"><span>${s.n}</span>${esc(s.label)}</a></li>`).join('')}</ol>`;
}
function stepActs(step, frozen, est) {
  const back = step > 1 ? `<button type="submit" name="do" value="back">Back</button>` : '';
  if (step < 5) return `<div class="d-acts d-acts--step">${back}<button type="submit" name="do" value="next" class="d-primary">${QUOTE_STEPS[step - 1].next}</button></div>`;
  return `<div class="d-acts d-acts--step">${back}<button type="submit" name="do" value="save" class="d-primary">${frozen ? `Save as version ${est.version + 1} (draft)` : 'Save'}</button><button type="submit" name="do" value="send">Save and mark as sent</button></div>
    <p class="d-sub">Marking as sent freezes this version with today's settings and rates. Nothing is sent to anyone from here.</p>`;
}

/* Step 1: the work. Categories bring their services in; lines are kept or cut; no figures. */
function stepWork(j, q, ctx, live) {
  const services = (live.services || []).filter((s) => !s.archived);
  const cats = CATEGORIES.filter((c) => services.some((s) => s.category === c)).concat([...new Set(services.map((s) => s.category))].filter((c) => !CATEGORIES.includes(c)));
  // A tile is ticked only when every one of its services is in the quote; a part-filled one says how many.
  const sids = new Set((q.lines || []).map((l) => l.sid).filter(Boolean));
  const inOf = (c) => services.filter((s) => s.category === c && sids.has(s.id)).length;
  // Discovery's saved services; before Discovery is saved, the service their form or tracker row named.
  const picked = ctx.discovery?.at ? ctx.discovery.profile?.services || [] : [serviceFrom(j.deal?.service), serviceFrom(j.inquiries?.at(-1)?.service)];
  const suggested = new Set(picked.map((id) => SUGGEST[id]).filter(Boolean));
  const tiles = `<div class="d-cats">${cats.map((c) => { const n = services.filter((s) => s.category === c).length; const k = inOf(c); const full = n > 0 && k === n; return `<label class="d-cat"><input type="checkbox" name="cat" value="${esc(c)}"${full ? ' checked' : ''}>${full ? hidden('catwas', c) : ''}<span class="d-cat__name">${esc(c)}</span><span class="d-cat__sub">${k && !full ? `${k} of ${n} in · tick to bring in the rest` : `${n} ${n === 1 ? 'service' : 'services'}`}</span>${suggested.has(c) ? '<span class="d-cat__tag">From Discovery</span>' : ''}</label>`; }).join('')}</div>${hidden('cats', '1')}
    <p><button type="submit" name="do" value="stay">Bring in their services</button></p>`;
  const lines = q.lines || [];
  const row = (l) => {
    const f = (k) => `l_${l.lid}_${k}`;
    return `<li class="d-wline${l.cut ? ' d-cut' : ''}">${hidden('lid', l.lid)}${hidden(f('keepon'), '1')}
      <label class="d-check d-wline__keep"><input type="checkbox" name="${f('keep')}" value="1"${l.cut ? '' : ' checked'}><span class="d-wline__name">${esc(l.name)}</span></label>
      <div class="d-wline__qty"><label for="${f('qty')}">How many <span class="d-sub">(${esc(l.unit)})</span></label><input id="${f('qty')}" name="${f('qty')}" inputmode="decimal" value="${v(l.qty)}"></div>
      <details><summary>Name and what the client reads</summary><label for="${f('name')}">Name</label><input id="${f('name')}" name="${f('name')}" maxlength="160" value="${esc(l.name)}"><label for="${f('description')}">What the client reads</label><textarea id="${f('description')}" name="${f('description')}" maxlength="600">${esc(l.description)}</textarea></details></li>`;
  };
  const groups = [...new Set(lines.map((l) => lineCategory(l, services) || 'Your own lines'))];
  const list = lines.length ? groups.map((g) => `<h3 class="d-wgroup">${esc(g)}</h3><ul class="d-wlines">${lines.filter((l) => (lineCategory(l, services) || 'Your own lines') === g).map(row).join('')}</ul>`).join('') : '';
  const tpls = (live.templates || []).filter((t) => t.items.length);
  const more = `<details class="d-fold"><summary><span>More ways to add</span></summary>
    ${tpls.length ? `<label for="add_tid">One of your sets</label><select id="add_tid" name="add_tid"><option value="">Choose a set</option>${tpls.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${t.items.length} services)</option>`).join('')}</select>` : ''}
    <div class="d-grid2"><div><label for="add_sid">One service from your catalog</label>${serviceSelect('add_sid', services)}</div><div><label for="add-qty">How many</label><input id="add-qty" name="add_qty" inputmode="decimal" placeholder="1"></div></div>
    <p><button type="submit" name="do" value="stay">Add</button></p></details>`;
  return `<h2 class="d-qh">What is the work?</h2><p class="d-sub">Pick the kinds of work. Each brings its services in; untick any line to leave it out.</p>${tiles}
    ${list}
    <div class="d-wown"><label for="add-custom">Add a line of your own</label><div class="d-addrow"><input id="add-custom" name="add_custom" maxlength="160" placeholder="Something not in your catalog"><button type="submit" name="do" value="stay">Add</button></div></div>${more}`;
}

/* Step 2: who does what. A typed name and their price on each line ("me" for your hours). */
function stepWho(q, pq, people) {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const lines = (q.lines || []).filter((l) => !l.cut);
  if (!lines.length) return `<h2 class="d-qh">Who does what?</h2><div class="d-emptybox"><p>No lines kept yet. Go back to the work and pick what is in this quote.</p></div>`;
  const card = (l) => {
    const p = pq.lines.find((x) => x.lid === l.lid) || l;
    const f = (k) => `l_${l.lid}_${k}`;
    const comps = l.components || [];
    const rows = [...comps.map((c, j) => ({ c, pc: p.comps?.[j] })), { c: null }, { c: null }];
    const row = ({ c, pc }, j) => {
      const g = (k) => `${f(`c${j}_${k}`)}`;
      const person = c && c.who && c.who !== OWNER ? byId[c.who] : null;
      const name = !c ? '' : c.who === OWNER ? ME_WORDS : c.name || person?.name || '';
      const agreed = c ? !pc?.guess : false;
      const ph = !c ? 'their price' : c.who === OWNER ? (pq.ownerRate === null ? 'your hourly cost' : `your hourly cost ${c$(pq.ownerRate)}`) : person && person.rate !== null ? `rate list ${c$(person.rate)}` : 'their price';
      const cost = !c ? '' : pc?.cost === null || pc?.cost === undefined ? `<span class="d-gold">Cost missing: ${esc(pc?.why || 'not complete')}</span>` : `${esc(c$(pc.cost))}${pc.qty !== null && pc.rate !== null ? ` <span class="d-sub">(${esc(pc.qty)} × ${esc(c$(pc.rate))}${l.qty !== 1 && l.qty !== null ? ` × ${esc(l.qty)}` : ''})</span>` : ''}${tag(pc.guess, 'guess')}`;
      return `<div class="d-who${c ? '' : ' d-who--new'}">${hidden(g('cid'), c?.cid || '')}${hidden(g('namewas'), name)}${hidden(g('qtywas'), c?.qty ?? '')}${hidden(g('ratewas'), c?.rate ?? '')}${hidden(g('agreedwas'), agreed ? '1' : '')}
        <div class="d-who__grid"><div><label for="${g('name')}">Who</label><input id="${g('name')}" name="${g('name')}" maxlength="120" value="${esc(name)}" placeholder="${c ? '' : 'A name, or me'}" autocomplete="off"></div>
        <div><label for="${g('qty')}">How many</label><input id="${g('qty')}" name="${g('qty')}" inputmode="decimal" value="${v(c?.qty)}" placeholder="${c?.who === OWNER ? 'your hours' : '1'}"></div>
        <div><label for="${g('rate')}">Price each ($)</label><input id="${g('rate')}" name="${g('rate')}" inputmode="decimal" value="${v(c?.rate)}" placeholder="${esc(ph)}"></div>
        <label class="d-check d-who__ok"><input type="checkbox" name="${g('agreed')}" value="1"${agreed ? ' checked' : ''}> Agreed</label></div>
        ${cost ? `<p class="d-role__cost">${cost}</p>` : ''}</div>`;
    };
    // A line with nobody on it yet is a missing cost, never "$0.00".
    const total = !p.comps?.length ? '<span class="d-gold">Cost missing: nobody on this line yet</span>' : p.missing ? `<span class="d-gold">${or$(p.direct, '')} known · ${p.missing} missing</span>` : esc(c$(p.direct));
    return `<div class="d-qsvc">${hidden('lid', l.lid)}${hidden(f('cn'), rows.length)}<div class="d-role__head"><h3 class="d-qline__name">${esc(l.name)}${l.qty !== null && l.qty !== 1 ? ` <span class="d-sub">× ${esc(l.qty)}</span>` : ''}</h3><span class="d-qsvc__cost">${total}${tag(p.guess)}</span></div>
      ${rows.map(row).join('')}
      <details><summary>Actual cost after delivery</summary><label for="${f('actual')}">Actual cost ($)</label><input id="${f('actual')}" name="${f('actual')}" inputmode="decimal" value="${v(l.actual)}" placeholder="optional"></details></div>`;
  };
  return `<h2 class="d-qh">Who does what?</h2><p class="d-sub">On each line, type who does it and their price. Type <strong>me</strong> for your own hours: how many is your hours, priced at your hourly cost. Leave a row empty to drop it. A new or changed price is a guess until you tick Agreed.</p>${lines.map(card).join('')}`;
}

/* Step 3: other costs, and only the hours of yours not already on a line. */
function stepOther(q, pq) {
  const others = q.others || [];
  const other = (o, i) => `<li class="d-row${o.cut ? ' d-cut' : ''}"><div class="d-row__main">${hidden(`o_${i}_oid`, o.oid || '')}
    <div class="d-grid2"><div><label for="o-${i}-item">Item</label><input id="o-${i}-item" class="d-qline__name" name="o_${i}_item" maxlength="160" value="${esc(o.item || '')}"${o.oid ? '' : ' placeholder="Add a cost: travel, a license, a rental"'}></div><div><label for="o-${i}-vendor">Vendor</label><input id="o-${i}-vendor" name="o_${i}_vendor" maxlength="120" value="${esc(o.vendor || '')}"></div></div>
    <div class="d-grid3"><div><label for="o-${i}-cost">Cost ($)</label><input id="o-${i}-cost" name="o_${i}_cost" inputmode="decimal" value="${v(o.cost)}" placeholder="unknown"></div><div><label for="o-${i}-status">It is</label><select id="o-${i}-status" name="o_${i}_status">${opts(STATUS, o.status || 'guess')}</select></div><div><label for="o-${i}-due">Goes out</label><select id="o-${i}-due" name="o_${i}_due">${opts(DUE, o.due || 'before')}</select></div><div><label class="d-check"><input type="checkbox" name="o_${i}_pass" value="1"${o.pass ? ' checked' : ''}> Pass-through</label></div></div>
    ${o.oid ? `<div class="d-grid2"><label class="d-check"><input type="checkbox" name="o_${i}_cut" value="1"${o.cut ? ' checked' : ''}> Cut</label><span class="d-role__cost">${(() => { const p = pq.others[i]; return !p ? '' : p.loaded === null ? '<span class="d-gold">Cost missing</span>' : o.cut ? `Cut: saves ${esc(c$(p.loaded))}` : `${o.pass ? 'Billed at' : 'Loaded'} ${esc(c$(o.pass ? p.start : p.loaded))}${tag(p.guess)}`; })()}</span></div>` : ''}</div></li>`;
  const onLines = pq.lines.filter((l) => !l.cut).reduce((a, l) => a + (l.ownerHours || 0), 0);
  return `<h2 class="d-qh">Other costs and your time</h2>
    <h3>Vendor costs and travel</h3><ul class="d-list">${others.map(other).join('')}${other({}, others.length)}${other({}, others.length + 1)}</ul>${hidden('on', others.length + 2)}<p class="d-sub">A cost with no amount is flagged as missing, never counted as zero. A pass-through is billed at cost plus your handling markup.</p>
    <h3>Your time not on a line</h3><p class="d-callout">${onLines ? `<strong>${esc(+onLines.toFixed(2))} hours</strong> of yours are already on service lines and counted there.` : 'None of your hours are on a service line yet.'} Add only the hours not already on a line (calls, travel): nothing counts twice.</p>
    <div class="d-grid2"><div><label for="q-xh">Extra hours</label><input id="q-xh" name="extra_hours" inputmode="decimal" value="${v(q.extraHours)}" placeholder="none"></div><div><label for="q-xs">Those hours are</label><select id="q-xs" name="extra_status">${opts(STATUS, q.extraStatus || 'guess')}</select></div></div>${pq.extra?.loaded ? `<p class="d-sub">Priced at your hourly cost with overhead: ${esc(c$(pq.extra.loaded))}.</p>` : ''}`;
}

/* Step 4: the price. The suggestion sits beside his number, never in it; discount clearly labelled. */
function stepPrice(q, pq) {
  const d = q.discount || {};
  const sugg = pq.recommended === null ? gap(pq.start === null ? 'set your target margin in Settings' : 'needs the starting number') : `${pq.missing ? 'at least ' : ''}${esc(c$(pq.recommended))}`;
  const price = `<div class="d-pricepair"><div><label for="q-price">Your price to the client ($)</label><input id="q-price" class="d-bigin" name="price" inputmode="decimal" value="${v(q.price)}" placeholder="type your price"></div>
    <div class="d-suggest"><span>Suggested price</span><strong>${sugg}</strong><em class="d-strip__sub">from your costs and target margin, rounded up${pq.estimate ? ' · estimate' : ''}</em></div></div>
    <p class="d-sub">The price is yours: the suggestion is never filled in for you.</p>
    <fieldset class="d-discount"><legend>Discount (optional)</legend><div class="d-grid2"><div><label for="q-disc">Discount</label><input id="q-disc" name="disc" inputmode="decimal" value="${v(d.value)}" placeholder="none"></div><div><label for="q-dm">As</label><select id="q-dm" name="disc_mode">${opts({ amount: 'An amount ($)', pct: '% of the price' }, d.mode || 'amount')}</select></div></div><p class="d-sub">Comes off the price the client pays, not off your costs. The client view shows it.</p></fieldset>
    <label for="q-reason">Why this price (optional, one line, for you only)</label><input id="q-reason" name="reason" maxlength="200" value="${esc(q.reason || '')}" placeholder="Below the suggestion to win a first project">`;
  const strip = `<div class="d-strip">
    ${keyBox('Client price', pq.net === null ? gap('type your price') : esc(c$(pq.net)), pq.discount ? `<em class="d-strip__sub">after ${esc(c$(pq.discount))} off</em>` : '')}
    ${keyBox('Total cost', esc(c$(pq.totalCost)), `${pq.missing ? `<em class="d-strip__sub d-gold">${pq.missing} ${pq.missing === 1 ? 'cost' : 'costs'} missing</em>` : ''}${pq.estimate ? '<span class="d-tag">estimate</span>' : ''}`)}
    ${keyBox('Company profit', pq.profit === null ? gap('needs a price') : esc(c$(pq.profit)), pq.margin === null ? '' : `<em class="d-strip__sub">margin ${pctW(pq.margin)}</em>`, pq.profit !== null && pq.profit < 0 ? 'd-red' : '')}
    ${keyBox('Tax set-aside', pq.settings.taxPct === null ? gap('not set') : pq.tax === null ? gap('needs a price') : esc(c$(pq.tax)), '<em class="d-strip__sub">held from the price; not inside profit</em>')}
  </div>`;
  const kv = `<ul class="d-kv">
    <li><span>Total cost${pq.missing ? '<br><span class="d-sub d-gold">what is known; missing costs are not counted as zero</span>' : ''}</span><span>${esc(c$(pq.totalCost))}${tag(pq.estimate)}</span></li>
    <li><span>Your pay<br><span class="d-sub">${pq.ownerHours ? `${esc(+pq.ownerHours.toFixed(2))} hours of your time${pq.ownerRate === null ? '' : ` at ${esc(c$(pq.ownerRate))}`}; already inside total cost` : 'No hours of your time on this quote yet'}</span></span><span>${pq.pay === null ? gap('set your hourly cost') : esc(c$(pq.pay))}</span></li>
    <li><span>Company profit<br><span class="d-sub">what the business keeps on top of your pay</span></span><span>${pq.profit === null ? gap('needs a price') : esc(c$(pq.profit))}</span></li>
    <li><span>Margin <span class="d-sub">(profit ÷ price)</span></span><span>${pq.margin === null ? gap('needs a price') : `${pctW(pq.margin)}${tag(pq.estimate)}`}</span></li>
    ${pq.hasPass ? `<li><span>Service margin<br><span class="d-sub">without pass-through billing and cost</span></span><span>${pq.serviceMargin === null ? gap('needs a price') : pctW(pq.serviceMargin)}</span></li>` : ''}
    <li><span>Starting number<br><span class="d-sub">your costs at your target margin, before rounding</span></span><span>${pq.start === null ? gap('set your target margin') : `${pq.missing ? 'at least ' : ''}${esc(c$(pq.start))}`}</span></li>
    <li><span>Tax set-aside<br><span class="d-sub">cash to hold from the price; not inside profit or margin</span></span><span>${pq.settings.taxPct === null ? gap('not set') : pq.tax === null ? gap('needs a price') : esc(c$(pq.tax))}</span></li>
  </ul>`;
  const flags = pq.flags.length ? `<ul class="d-flags">${pq.flags.map((f) => `<li class="${f.id === 'missing' ? 'd-gold' : 'd-red'}">${esc(f.text)}</li>`).join('')}</ul><p class="d-sub">Flags never block: you can still save and send.</p>` : '';
  const cuts = pq.suggestCuts.length ? `<p class="d-sub">Lowest-value lines to cut: ${pq.suggestCuts.map((x) => `${esc(x.name)} (saves ${esc(c$(x.saves))})`).join(', ')}.</p>` : '';
  const notSet = pq.notSet.length ? `<p class="d-sub d-gold">Not set in <a href="/dashboard/quote-settings">Settings</a> (left out of the math): ${esc(pq.notSet.join(', '))}.</p>` : '';
  const tm = pq.timing;
  const ms = tm.milestones.length ? tm.milestones : (q.milestones || []);
  const mRow = (m, i) => `<li class="d-row"><div class="d-row__main">${hidden(`m_${i}_mid`, m.mid || '')}<div class="d-grid3"><div><label for="m-${i}-l">Payment</label><input id="m-${i}-l" name="m_${i}_label" maxlength="80" value="${esc(m.label || '')}"${m.mid ? '' : ' placeholder="Add a payment"'}></div><div><label for="m-${i}-p">% of price</label><input id="m-${i}-p" name="m_${i}_pct" inputmode="decimal" value="${v(m.pct)}"></div><div><label for="m-${i}-a">Or an amount ($)</label><input id="m-${i}-a" name="m_${i}_amount" inputmode="decimal" value="${v(m.amount)}"></div><div><label for="m-${i}-d">Expected date</label><input id="m-${i}-d" name="m_${i}_date" type="date" value="${esc(m.date || '')}"></div></div><label for="m-${i}-t">When</label><input id="m-${i}-t" name="m_${i}_trigger" maxlength="120" value="${esc(m.trigger || '')}" placeholder="Your terms, e.g. on signing">${m.value !== undefined && m.value !== null ? `<p class="d-role__cost">${esc(c$(m.value))}</p>` : ''}</div></li>`;
  const dues = pq.lines.filter((l) => !l.cut).map((l) => `<div>${hidden('lid', l.lid)}<label for="l_${l.lid}_due">${esc(l.name)}: its costs go out</label><select id="l_${l.lid}_due" name="l_${l.lid}_due">${opts(DUE, l.due)}</select></div>`).join('');
  const timing = `<details class="d-fold"><summary><span>Deposit and payment timing</span></summary><ul class="d-kv"><li><span>Goes out before the second payment<br><span class="d-sub">${tm.early.map((x) => `${esc(x.what)} ${esc(c$(x.amount))}`).join(' · ') || 'nothing priced yet'}${pq.pay ? ` · your pay ${esc(c$(pq.pay))} (when the deposit lands)` : ''}</span></span><span>${esc(c$(tm.required))}</span></li>
    <li><span>Deposit</span><span>${tm.deposit === null ? gap(pq.net === null ? 'needs a price' : 'set its % or amount') : esc(c$(tm.deposit))}</span></li>
    <li><span>Deposit against early costs</span><span>${tm.covered !== null ? `<span class="d-green">Covered by ${esc(c$(tm.covered))}</span>` : tm.short !== null ? `<span class="d-red">Short by ${esc(c$(tm.short))}</span>` : gap('needs the deposit')}</span></li>
    ${tm.unplanned !== null && Math.abs(tm.unplanned) > 0.005 ? `<li><span>Not yet in a payment</span><span class="d-gold">${esc(c$(tm.unplanned))}</span></li>` : ''}</ul>
    <p class="d-sub">For seeing timing only: it accepts any terms you set, never enforces them, and writes nothing to Money or the cash forecast.${tm.unknownPay ? ' Your pay is not counted yet: set your hourly cost in Settings.' : ''}${pq.missing ? ' Missing costs are not counted.' : ''}</p>
    <ul class="d-list">${ms.map(mRow).join('')}${mRow({}, ms.length)}</ul>${hidden('mn', ms.length + 1)}${dues ? `<div class="d-grid2">${dues}</div>` : ''}</details>`;
  return `<h2 class="d-qh">The price</h2>${price}<h3>Key numbers</h3>${strip}${flags}${cuts}${notSet}${kv}${timing}`;
}

/* Step 5: review and send. The client view as it is: services and the price only. */
function clientDoc(quote) {
  const cv = clientView(quote);
  const items = cv.services.length ? `<ul class="d-list">${cv.services.map((s) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(s.name)}${s.qty !== null && s.qty !== 1 ? ` · ${esc(s.qty)} ${esc(s.unit.replace(/^per /, ''))}` : ''}</span>${s.description ? `<span class="d-row__sub">${esc(s.description)}</span>` : ''}</div></li>`).join('')}</ul>` : '<p class="d-sub">No services on the quote yet.</p>';
  const price = cv.total === null ? '<p class="d-sub d-gold">No price yet: type your price on the quote.</p>' : `<ul class="d-kv">${cv.discount ? `<li><span>Price</span><span>${esc(c$(cv.price))}</span></li><li><span>Discount</span><span>${esc(c$(-cv.discount))}</span></li>` : ''}<li><span><strong>Total</strong></span><span><strong>${esc(c$(cv.total))}</strong></span></li></ul>`;
  return `<article class="d-client" aria-label="Client view">${cv.client || cv.project ? `<h2>${esc([cv.project, cv.client].filter(Boolean).join(' · '))}</h2>` : ''}${items}${price}</article>`;
}
function stepReview(q, ctx, est, frozen) {
  const frozenNote = frozen ? `<p class="d-flash d-flash--ok" role="status">Version ${est.version} was sent and is frozen, with the settings and rates it was priced with. Saving makes version ${est.version + 1} as a draft; version ${est.version} stays as it was sent.</p>` : '';
  const hist = (ctx.history || []).length > 1 ? `<details class="d-fold"><summary><span>Versions · ${ctx.history.length}</span></summary><ul class="d-kv">${ctx.history.map((h) => `<li><span>Version ${h.version}</span><span>${esc(QUOTE_STATUS[h.status] || h.status)} · ${esc(usTime(h.at, ctx.now))}</span></li>`).join('')}</ul></details>` : '';
  return `<h2 class="d-qh">Review and send</h2>${frozenNote}<p class="d-sub">What the client sees: the services and the price. Nothing else.</p>${clientDoc(q)}
    <div class="d-grid2"><div><label for="q-client">Client</label><input id="q-client" name="client" maxlength="160" value="${esc(q.client || '')}"></div><div><label for="q-project">Project</label><input id="q-project" name="project" maxlength="160" value="${esc(q.project || '')}"></div></div>${hist}`;
}

export function renderEstimate(j, ctx) {
  const k = encodeURIComponent(j.key);
  const step = Math.min(5, Math.max(1, Number(ctx.step) || 1));
  const title = `Quote · ${j.name}`;
  const top = `<p><a class="d-help" href="/dashboard/flow/${k}">← ${esc(j.name)}</a></p><h1>Quote</h1>`;
  const hold = moneyHold(ctx);
  if (hold) return shell(title, `${top}${ctx.flash || ''}${holdBox(hold)}`, ctx);
  const est = ctx.estimate;
  const live = ctx.pricing;
  if (est?.unreadable || live.settings?.unreadable || live.people?.unreadable) return shell(title, `${top}${errorBox('This quote or its settings could not be read back.', 'It is saved encrypted, and the key that opens it is not the one this site has now. Nothing else is affected.', `/dashboard/flow/${k}`, 'Back to the deal')}`, ctx);
  const frozen = est?.status === 'sent';
  const settings = frozen ? est.snapshot?.settings || {} : live.settings;
  const people = frozen ? est.snapshot?.people || [] : live.people;
  const q = est || { client: j.name, project: '', lines: [], others: [], milestones: ctx.newMilestones, discount: { mode: 'amount', value: null }, price: null, extraHours: null, extraStatus: 'guess', reason: '' };
  const pq = priceQuote({ settings, people, quote: q });
  const status = est ? `Version ${est.version} · ${esc(QUOTE_STATUS[est.status] || est.status)}` : 'Not saved yet';
  const inner = step === 1 ? stepWork(j, q, ctx, live) : step === 2 ? stepWho(q, pq, people) : step === 3 ? stepOther(q, pq) : step === 4 ? stepPrice(q, pq) : stepReview(q, ctx, est, frozen);
  const form = `<form class="d-form" method="post" action="/dashboard/estimate">${hidden('key', j.key)}${hidden('step', step)}${hidden('back', stepPath(j.key, step))}${inner}${stepActs(step, frozen, est)}</form>`;
  const links = step === 5 ? `<p class="d-files"><a class="d-btn" href="/dashboard/flow/${k}/quote/client">Client view on its own ›</a></p>` : step === 4 ? `<p class="d-sub">Your <a href="/dashboard/quote-settings">Settings</a>, <a href="/dashboard/rates">rate list</a> and <a href="/dashboard/services">catalog</a> stay open to change.</p>` : '';
  const body = `${top}<p class="d-sub">${esc(j.name)} · ${status} · for you only</p>${stepBar(j.key, step)}${ctx.flash || ''}${form}${links}`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ the client view */

/** Included services, their descriptions and the price. Nothing internal is in its input. */
export function renderClientView(j, ctx) {
  const k = encodeURIComponent(j.key);
  const top = `<p><a class="d-help" href="/dashboard/flow/${k}/quote">← Quote</a></p><h1>Client view</h1><p class="d-sub">What the client sees: the services, what each is, and the price. No people, rates, costs, margin, cut lines, flags or history.</p>`;
  if (!ctx.estimate || ctx.estimate.unreadable) return shell(`Client view · ${j.name}`, `${top}${empty('Save a quote first; its client view shows here.', `/dashboard/flow/${k}/quote`, 'Open the quote')}`, ctx);
  const doc = clientDoc(ctx.estimate);
  return shell(`Client view · ${j.name}`, `${top}${doc}`, ctx);
}
