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
function compRow(l, c, j, people) {
  const f = (k) => `l_${l.lid}_c${j}_${k}`;
  const ro = '';
  const cost = c.cost === null ? `<span class="d-gold">Cost missing: ${esc(c.why)}</span>` : `${esc(c$(c.cost))}${c.rate !== null && c.qty !== null ? ` <span class="d-sub">(${esc(c.qty)} × ${esc(c$(c.rate))}${l.qty !== 1 && l.qty !== null ? ` × ${esc(l.qty)}` : ''})</span>` : ''}${tag(c.guess, 'guess')}`;
  return `<div class="d-role">${hidden(f('cid'), c.cid)}${hidden(f('qtywas'), c.qty ?? '')}${hidden(f('ratewas'), c.rateOver ?? '')}${hidden(f('whowas'), c.who)}
    <div class="d-grid3"><div><label for="${f('who')}">Who</label><select id="${f('who')}" name="${f('who')}">${whoOptions(people, c.who)}</select></div>
    <div><label for="${f('qty')}">How much</label><input id="${f('qty')}" name="${f('qty')}" inputmode="decimal" value="${v(c.qty)}" placeholder="hours, days, pieces"${ro}></div>
    <div><label for="${f('qtyStatus')}">Quantity is</label><select id="${f('qtyStatus')}" name="${f('qtyStatus')}">${opts(STATUS, c.qtyStatus)}</select></div>
    <div><label for="${f('rate')}">Rate for this quote only</label><input id="${f('rate')}" name="${f('rate')}" inputmode="decimal" value="${c.rateOver ? v(c.rateOver) : ''}" placeholder="${c.rateOver ? '' : c.rate === null ? 'none on the rate list' : esc(`rate list: ${c$(c.rate)}`)}"${ro}></div></div>
    <div class="d-grid2"><div>${c.rateOver ? `<label for="${f('rateStatus')}">That rate is</label><select id="${f('rateStatus')}" name="${f('rateStatus')}">${opts(STATUS, c.rateStatus)}</select>` : ''}</div><div><label class="d-check"><input type="checkbox" name="${f('del')}" value="1"> Remove</label></div></div>
    <p class="d-role__cost">${cost}</p></div>`;
}
function lineCard(l, pq, people) {
  const f = (k) => `l_${l.lid}_${k}`;
  const p = pq.lines.find((x) => x.lid === l.lid) || l;
  const comps = (l.components || []).map((c, j) => ({ ...c, ...(p.comps?.[j] || {}), rateOver: c.rate }));
  const sums = l.cut ? `<p class="d-role__cost">Cut: counts for nothing. Cutting it saves ${or$(p.loaded, 'an unknown amount')} of cost${p.start === null ? '' : ` and ${esc(c$(p.start))} off the starting number`}.</p>`
    : `<ul class="d-kv"><li><span>Direct cost${p.missing ? ` <span class="d-gold">· ${p.missing} missing</span>` : ''}</span><span>${esc(c$(p.direct))}</span></li>${l.pass ? `<li><span>Billed at cost plus handling (pass-through)</span><span>${or$(p.start, 'not set')}</span></li>` : `<li><span>Loaded cost <span class="d-sub">(contingency on the guessed part, then overhead)</span></span><span>${esc(c$(p.loaded))}${tag(p.guess)}</span></li><li><span>Starting number</span><span>${p.start === null ? gap('set your target margin') : `${p.missing ? 'at least ' : ''}${esc(c$(p.start))}`}${tag(p.guess)}</span></li>`}${p.variance !== null && p.variance !== undefined ? `<li><span>Actual against budget</span><span class="${p.variance > 0 ? 'd-red' : ''}">${p.variance > 0 ? `${esc(c$(p.variance))} over` : `${esc(c$(-p.variance))} under`}</span></li>` : ''}</ul>`;
  return `<div class="d-qsvc${l.cut ? ' d-cut' : ''}">${hidden('lid', l.lid)}${hidden(f('cn'), comps.length)}
    <div class="d-role__head"><h3 class="d-qline__name">${esc(l.name)}${l.pass ? ' <span class="d-role__tag">pass-through</span>' : ''}${l.sid ? '' : ' <span class="d-role__tag">custom</span>'}${p.incomplete && !l.cut ? ' <span class="d-gold d-role__tag">incomplete</span>' : ''}</h3>
    <div><label class="d-check"><input type="checkbox" name="${f('cut')}" value="1"${l.cut ? ' checked' : ''}> Cut</label><label class="d-check"><input type="checkbox" name="${f('del')}" value="1"> Remove from the quote</label></div></div>
    <div class="d-grid3"><div><label for="${f('qty')}">Quantity (${esc(l.unit)})</label><input id="${f('qty')}" name="${f('qty')}" inputmode="decimal" value="${v(l.qty)}"></div><div><label for="${f('due')}">Its costs go out</label><select id="${f('due')}" name="${f('due')}">${opts(DUE, l.due)}</select></div><div><label for="${f('actual')}">Actual cost after delivery</label><input id="${f('actual')}" name="${f('actual')}" inputmode="decimal" value="${v(l.actual)}" placeholder="optional"></div></div>
    <details><summary>Name and what the client reads</summary><label for="${f('name')}">Name</label><input id="${f('name')}" name="${f('name')}" maxlength="160" value="${esc(l.name)}"><label for="${f('description')}">What the client reads</label><textarea id="${f('description')}" name="${f('description')}" maxlength="600">${esc(l.description)}</textarea></details>
    ${comps.map((c, j) => compRow(l, c, j, people)).join('') || '<p class="d-sub d-gold">No cost components: cost missing. Add who does it below, or fill the service in the catalog.</p>'}
    <details><summary>Add who does it (this quote only)</summary><div class="d-grid3"><div><label for="${f('new_who')}">Who</label><select id="${f('new_who')}" name="${f('new_who')}">${whoOptions(people, '')}</select></div><div><label for="${f('new_qty')}">How much</label><input id="${f('new_qty')}" name="${f('new_qty')}" inputmode="decimal"></div></div><p class="d-sub">Added for this quote only, as a Guess until you mark it Agreed.</p></details>
    ${sums}</div>`;
}
const keyBox = (label, val, sub = '', cls = '') => `<div><span>${label}</span><strong${cls ? ` class="${cls}"` : ''}>${val}</strong>${sub}</div>`;

export function renderEstimate(j, ctx) {
  const k = encodeURIComponent(j.key);
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
  const back = `/dashboard/flow/${k}/quote`;
  const status = est ? `Version ${est.version} · ${esc(QUOTE_STATUS[est.status] || est.status)} · saved ${esc(usTime(est._at, ctx.now))}` : 'Not saved yet';
  const frozenNote = frozen ? `<p class="d-flash d-flash--ok" role="status">Version ${est.version} was sent and is frozen, with the settings and rates it was priced with. Saving makes version ${est.version + 1} as a draft; version ${est.version} stays as it was sent.</p>` : '';

  // The key numbers: starting number, recommended, price, cost, your pay, company profit, margin.
  const startWords = pq.start === null ? gap('set your target margin') : `${pq.missing ? 'at least ' : ''}${esc(c$(pq.start))}`;
  const strip = `<div class="d-strip">
    ${keyBox('Starting number', startWords, `${pq.missing ? `<em class="d-strip__sub d-gold">${pq.missing} ${pq.missing === 1 ? 'cost' : 'costs'} missing</em>` : ''}${pq.estimate ? '<span class="d-tag">estimate</span>' : ''}`)}
    ${keyBox('Recommended', pq.recommended === null ? gap('needs the starting number') : esc(c$(pq.recommended)), '<em class="d-strip__sub">rounded up</em>')}
    ${keyBox('Client price', pq.net === null ? gap('type your price') : esc(c$(pq.net)), pq.discount ? `<em class="d-strip__sub">after ${esc(c$(pq.discount))} off</em>` : '')}
    ${keyBox('Company profit', pq.profit === null ? gap('needs a price') : esc(c$(pq.profit)), pq.margin === null ? '' : `<em class="d-strip__sub">margin ${pctW(pq.margin)}</em>${pq.estimate ? '<span class="d-tag">estimate</span>' : ''}`, pq.profit !== null && pq.profit < 0 ? 'd-red' : '')}
  </div>`;
  const kv = `<ul class="d-kv">
    <li><span>Total cost${pq.missing ? '<br><span class="d-sub d-gold">what is known; missing costs are not counted as zero</span>' : ''}</span><span>${esc(c$(pq.totalCost))}${tag(pq.estimate)}</span></li>
    <li><span>Your pay<br><span class="d-sub">${pq.ownerHours ? `${esc(+pq.ownerHours.toFixed(2))} hours of your time${pq.ownerRate === null ? '' : ` at ${esc(c$(pq.ownerRate))}`}; already inside total cost` : 'No hours of your time on this quote yet'}</span></span><span>${pq.pay === null ? gap('set your hourly cost') : esc(c$(pq.pay))}</span></li>
    <li><span>Company profit<br><span class="d-sub">what the business keeps on top of your pay</span></span><span>${pq.profit === null ? gap('needs a price') : esc(c$(pq.profit))}</span></li>
    <li><span>Margin <span class="d-sub">(profit ÷ price)</span></span><span>${pq.margin === null ? gap('needs a price') : `${pctW(pq.margin)}${tag(pq.estimate)}`}</span></li>
    ${pq.hasPass ? `<li><span>Service margin<br><span class="d-sub">without pass-through billing and cost</span></span><span>${pq.serviceMargin === null ? gap('needs a price') : pctW(pq.serviceMargin)}</span></li>` : ''}
    <li><span>Tax set-aside<br><span class="d-sub">cash to hold from the price; not inside margin</span></span><span>${pq.settings.taxPct === null ? gap('not set') : pq.tax === null ? gap('needs a price') : esc(c$(pq.tax))}</span></li>
  </ul>`;
  const flags = pq.flags.length ? `<ul class="d-flags">${pq.flags.map((f) => `<li class="${f.id === 'missing' ? 'd-gold' : 'd-red'}">${esc(f.text)}</li>`).join('')}</ul><p class="d-sub">Flags never block: you can still save and send.</p>` : '';
  const cuts = pq.suggestCuts.length ? `<p class="d-sub">Lowest-value lines to cut: ${pq.suggestCuts.map((x) => `${esc(x.name)} (saves ${esc(c$(x.saves))})`).join(', ')}.</p>` : '';
  const notSet = pq.notSet.length ? `<p class="d-sub d-gold">Not set in <a href="/dashboard/quote-settings">Settings</a> (left out of the math): ${esc(pq.notSet.join(', '))}.</p>` : '';

  const addSvc = serviceSelect('add_sid', live.services || []);
  const tpls = (live.templates || []).filter((t) => t.items.length);
  const adder = `<div class="d-qsvc"><h3>Add to this quote</h3>
    ${tpls.length ? `<label for="add_tid">Start from a template</label><select id="add_tid" name="add_tid"><option value="">Choose a template</option>${tpls.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${t.items.length} services)</option>`).join('')}</select>` : '<p class="d-sub">No template has services yet. <a href="/dashboard/templates">Set one up ›</a></p>'}
    <div class="d-grid2"><div><label for="add_sid">A service from your catalog</label>${addSvc}</div><div><label for="add-qty">Quantity</label><input id="add-qty" name="add_qty" inputmode="decimal" placeholder="1"></div></div>
    <label for="add-custom">Or a custom line (its name)</label><input id="add-custom" name="add_custom" maxlength="160" placeholder="Something not in the catalog">
    <p><button type="submit" name="do" value="add">Add and save</button></p></div>`;

  const lines = q.lines || [];
  const emptyLines = lines.length ? '' : '<div class="d-emptybox"><p>Add a line to start: a template, a service from your catalog, or a custom line. You can leave any line unfinished; missing costs are flagged, never a block.</p></div>';
  const other = (o, i) => `<li class="d-row${o.cut ? ' d-cut' : ''}"><div class="d-row__main">${hidden(`o_${i}_oid`, o.oid || '')}${hidden(`o_${i}_costwas`, o.cost ?? '')}
    <div class="d-grid2"><div><label for="o-${i}-item">Item</label><input id="o-${i}-item" class="d-qline__name" name="o_${i}_item" maxlength="160" value="${esc(o.item || '')}"${o.oid ? '' : ' placeholder="Add a cost: travel, a license, a rental"'}></div><div><label for="o-${i}-vendor">Vendor</label><input id="o-${i}-vendor" name="o_${i}_vendor" maxlength="120" value="${esc(o.vendor || '')}"></div></div>
    <div class="d-grid3"><div><label for="o-${i}-cost">Cost ($)</label><input id="o-${i}-cost" name="o_${i}_cost" inputmode="decimal" value="${v(o.cost)}" placeholder="unknown"></div><div><label for="o-${i}-status">It is</label><select id="o-${i}-status" name="o_${i}_status">${opts(STATUS, o.status || 'guess')}</select></div><div><label for="o-${i}-due">Goes out</label><select id="o-${i}-due" name="o_${i}_due">${opts(DUE, o.due || 'before')}</select></div><div><label class="d-check"><input type="checkbox" name="o_${i}_pass" value="1"${o.pass ? ' checked' : ''}> Pass-through</label></div></div>
    ${o.oid ? `<div class="d-grid2"><label class="d-check"><input type="checkbox" name="o_${i}_cut" value="1"${o.cut ? ' checked' : ''}> Cut</label><span class="d-role__cost">${(() => { const p = pq.others[i]; return !p ? '' : p.loaded === null ? '<span class="d-gold">Cost missing</span>' : o.cut ? `Cut: saves ${esc(c$(p.loaded))}` : `${o.pass ? 'Billed at' : 'Loaded'} ${esc(c$(o.pass ? p.start : p.loaded))}${!o.pass && p.start !== null ? ` · starting number ${esc(c$(p.start))}` : ''}${tag(p.guess)}`; })()}</span></div>` : ''}</div></li>`;
  const others = q.others || [];
  const ms = pq.timing.milestones.length ? pq.timing.milestones : (q.milestones || []);
  const mRow = (m, i) => `<li class="d-row"><div class="d-row__main">${hidden(`m_${i}_mid`, m.mid || '')}<div class="d-grid3"><div><label for="m-${i}-l">Payment</label><input id="m-${i}-l" name="m_${i}_label" maxlength="80" value="${esc(m.label || '')}"${m.mid ? '' : ' placeholder="Add a payment"'}></div><div><label for="m-${i}-p">% of price</label><input id="m-${i}-p" name="m_${i}_pct" inputmode="decimal" value="${v(m.pct)}"></div><div><label for="m-${i}-a">Or an amount ($)</label><input id="m-${i}-a" name="m_${i}_amount" inputmode="decimal" value="${v(m.amount)}"></div><div><label for="m-${i}-d">Expected date</label><input id="m-${i}-d" name="m_${i}_date" type="date" value="${esc(m.date || '')}"></div></div><label for="m-${i}-t">When</label><input id="m-${i}-t" name="m_${i}_trigger" maxlength="120" value="${esc(m.trigger || '')}" placeholder="Your terms, e.g. on signing">${m.value !== undefined && m.value !== null ? `<p class="d-role__cost">${esc(c$(m.value))}</p>` : ''}</div></li>`;
  const tm = pq.timing;
  const timingOut = `<ul class="d-kv"><li><span>Goes out before the second payment<br><span class="d-sub">${tm.early.map((x) => `${esc(x.what)} ${esc(c$(x.amount))}`).join(' · ') || 'nothing priced yet'}${pq.pay ? ` · your pay ${esc(c$(pq.pay))} (when the deposit lands)` : ''}</span></span><span>${esc(c$(tm.required))}</span></li>
    <li><span>Deposit</span><span>${tm.deposit === null ? gap(pq.net === null ? 'needs a price' : 'set its % or amount') : esc(c$(tm.deposit))}</span></li>
    <li><span>Deposit against early costs</span><span>${tm.covered !== null ? `<span class="d-green">Covered by ${esc(c$(tm.covered))}</span>` : tm.short !== null ? `<span class="d-red">Short by ${esc(c$(tm.short))}</span>` : gap('needs the deposit')}</span></li>
    ${tm.unplanned !== null && Math.abs(tm.unplanned) > 0.005 ? `<li><span>Not yet in a payment</span><span class="d-gold">${esc(c$(tm.unplanned))}</span></li>` : ''}</ul>
    <p class="d-sub">For seeing timing only: it accepts any terms you set, never enforces them, and writes nothing to Money or the cash forecast.${tm.unknownPay ? ' Your pay is not counted yet: set your hourly cost in Settings.' : ''}${pq.missing ? ' Missing costs are not counted.' : ''}</p>`;
  const d = q.discount || {};
  const pricing = `<div class="d-grid2"><div><label for="q-price">Your price to the client ($)</label><input id="q-price" name="price" inputmode="decimal" value="${v(q.price)}" placeholder="${pq.recommended === null ? 'your call' : esc(`recommended ${c$(pq.recommended)}`)}"></div><div><label for="q-disc">Discount</label><input id="q-disc" name="disc" inputmode="decimal" value="${v(d.value)}"></div></div>
    <div class="d-grid2"><div><label for="q-dm">Discount as</label><select id="q-dm" name="disc_mode">${opts({ amount: 'An amount', pct: '% of the price' }, d.mode || 'amount')}</select></div><div><label for="q-reason">Why this price (optional, one line, internal)</label><input id="q-reason" name="reason" maxlength="200" value="${esc(q.reason || '')}" placeholder="Below the starting number to win a first project"></div></div>
    <p class="d-sub">The price is yours to set. The starting number and recommended price are shown, never filled in. A discount lowers the price, not the cost.</p>`;
  const hist = (ctx.history || []).length > 1 ? `<details class="d-fold"><summary><span>Versions · ${ctx.history.length}</span></summary><ul class="d-kv">${ctx.history.map((h) => `<li><span>Version ${h.version}</span><span>${esc(QUOTE_STATUS[h.status] || h.status)} · ${esc(usTime(h.at, ctx.now))}</span></li>`).join('')}</ul></details>` : '';

  const form = `<form class="d-form" method="post" action="/dashboard/estimate">${hidden('key', j.key)}${hidden('back', back)}${hidden('base', est?._id || '')}
    ${sec('lines', `Lines · ${lines.filter((l) => !l.cut).length}${lines.some((l) => l.cut) ? ` (+${lines.filter((l) => l.cut).length} cut)` : ''}`, `${emptyLines}${lines.map((l) => lineCard(l, pq, people)).join('')}${adder}`)}
    ${sec('others', `Other costs · ${others.length}`, `<ul class="d-list">${others.map(other).join('')}${other({}, others.length)}</ul>${hidden('on', others.length + 1)}<p class="d-sub">A cost with no amount is flagged as missing, never zero. A pass-through is billed at cost plus your handling markup.</p>`)}
    ${sec('extra', 'Your time not on a line', `<div class="d-grid2"><div><label for="q-xh">Extra hours (calls, travel)</label><input id="q-xh" name="extra_hours" inputmode="decimal" value="${v(q.extraHours)}" placeholder="none"></div><div><label for="q-xs">Those hours are</label><select id="q-xs" name="extra_status">${opts(STATUS, q.extraStatus || 'guess')}</select></div></div><p class="d-sub">Priced at your hourly cost with overhead${pq.extra?.loaded ? `: ${esc(c$(pq.extra.loaded))}` : ''}.</p>`)}
    ${sec('price', 'Price', pricing)}
    ${sec('timing', 'Payment timing', `${timingOut}<ul class="d-list">${ms.map(mRow).join('')}${mRow({}, ms.length)}</ul>${hidden('mn', ms.length + 1)}`)}
    ${sec('who', 'Client and project', `<div class="d-grid2"><div><label for="q-client">Client</label><input id="q-client" name="client" maxlength="160" value="${esc(q.client || '')}"></div><div><label for="q-project">Project</label><input id="q-project" name="project" maxlength="160" value="${esc(q.project || '')}"></div></div>`)}
    <div class="d-acts"><button type="submit" name="do" value="save" class="d-primary">${frozen ? `Save as version ${est.version + 1} (draft)` : 'Save draft'}</button><button type="submit" name="do" value="send">Save and mark as sent</button></div>
    <p class="d-sub">Marking as sent freezes this version with today's settings and rates. Nothing is sent to anyone from here.</p></form>`;
  const body = `${top}<p class="d-sub">${esc(j.name)} · ${status} · internal only</p>${toolNav('')}
    <p class="d-files"><a class="d-btn" href="/dashboard/flow/${k}/quote/client">Client view ›</a></p>${ctx.flash || ''}${frozenNote}
    ${sec('numbers', 'Key numbers', `${strip}${flags}${cuts}${notSet}${kv}`)}${form}${hist}`;
  return shell(title, body, ctx);
}

/* ------------------------------------------------------------------ the client view */

/** Included services, their descriptions and the price. Nothing internal is in its input. */
export function renderClientView(j, ctx) {
  const k = encodeURIComponent(j.key);
  const top = `<p><a class="d-help" href="/dashboard/flow/${k}/quote">← Quote</a></p><h1>Client view</h1><p class="d-sub">What the client sees: the services, what each is, and the price. No people, rates, costs, margin, cut lines, flags or history.</p>`;
  if (!ctx.estimate || ctx.estimate.unreadable) return shell(`Client view · ${j.name}`, `${top}${empty('Save a quote first; its client view shows here.', `/dashboard/flow/${k}/quote`, 'Open the quote')}`, ctx);
  const cv = clientView(ctx.estimate);
  const items = cv.services.length ? `<ul class="d-list">${cv.services.map((s) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(s.name)}${s.qty !== null && s.qty !== 1 ? ` · ${esc(s.qty)} ${esc(s.unit.replace(/^per /, ''))}` : ''}</span>${s.description ? `<span class="d-row__sub">${esc(s.description)}</span>` : ''}</div></li>`).join('')}</ul>` : '<p class="d-sub">No services on the quote yet.</p>';
  const price = cv.total === null ? '<p class="d-sub d-gold">No price yet: type your price on the quote.</p>' : `<ul class="d-kv">${cv.discount ? `<li><span>Price</span><span>${esc(c$(cv.price))}</span></li><li><span>Discount</span><span>${esc(c$(-cv.discount))}</span></li>` : ''}<li><span><strong>Total</strong></span><span><strong>${esc(c$(cv.total))}</strong></span></li></ul>`;
  const doc = `<article class="d-client" aria-label="Client view">${cv.client || cv.project ? `<h2>${esc([cv.project, cv.client].filter(Boolean).join(' · '))}</h2>` : ''}${items}${price}</article>`;
  return shell(`Client view · ${j.name}`, `${top}${doc}`, ctx);
}
