/**
 * Lead to delivery screens: intake on Inquiries, the record's deal sections, discovery, the pricing
 * builder, the proposal, the work side and the client portal. Phone first at 390px, plain forms,
 * no script (the CSP allows none). Money figures here are Scooter's only; the portal shows none.
 */
import { esc, isoDay, money, usDay, usTime } from './core.mjs';
import { FUNNEL_STAGES, stageOptions } from './data.mjs';
import { CASH_RULES, rulesWalk, CALL_NOTES, CATALOG_STRUCTURE, DISCOVERY_PROFILE, PAY_PLANS, PROPOSAL_STATUS, SERVICE_NAMES, TERMS, BILLED, BOX_WORDS, OWNER_MODELS, PERSON_TYPES, RATE_PER, ROLE_KINDS, catalogTiers, discoveryQuestions, quoteMath, quoteServices, roleCost, servicesOf, templateRoles } from './deal.mjs';
import { EVENT_SERVICE, SERVICES, SERVICE_BY_ID, serviceFrom } from '../services.mjs';
import { act, dayOr, empty, errorBox, gap, page, sec, val } from './views.mjs';

const shell = (title, body, ctx) => page(title, body, { tab: 'pipeline', counts: ctx.counts, sample: ctx.sample, signedIn: true });
const backTo = (j) => `<p><a class="d-help" href="/dashboard/flow/${encodeURIComponent(j.key)}">← ${esc(j.name)}</a></p>`;
const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
const m$ = (n) => (n === null || n === undefined ? gap('unknown') : esc(money(n)) || '$0');

/** Why figures cannot be entered yet, or ''. Pricing and rates are financial data. */
export function moneyHold(ctx) {
  if (ctx.sample) return '';
  if (ctx.choices?.money?.value === 'off') return 'Keep money out is on, so no rates, quotes or prices are kept. Turn it off under Who can see what to use the pricing builder.';
  if (ctx.googleWide) return 'Google still holds the wider access from before. Rates and prices are not kept until it is narrowed: the next sync withdraws it, or press Narrow on Who can see what.';
  return '';
}
const holdBox = (why) => errorBox(why, 'Nothing about money was saved.', '/dashboard/access#limit', 'Who can see what');

/* ------------------------------------------------------------------ the record's deal sections */

export function dealSections(j, ctx) {
  const k = encodeURIComponent(j.key);
  const disc = ctx.discovery;
  const q = ctx.quote;
  const p = ctx.proposal;
  const del = ctx.delivery;
  const picked = servicesOf(disc?.profile || {}).map((id) => SERVICE_BY_ID[id].name);
  const discLine = disc?.at ? `${picked.length ? `${esc(picked.join(', '))} · ` : ''}saved ${esc(usTime(disc.at, ctx.now))}` : 'Not started';
  const hold = moneyHold(ctx);
  const qm = q && !q.unreadable ? quoteMath(q, ctx.directory || []) : null;
  const quoteLine = hold ? 'Held' : !q ? 'No quote yet' : q.unreadable ? '<span class="d-red">This quote could not be read back.</span>' : `Costs ${m$(qm.cost)}${qm.unpriced.length ? ` + ${qm.unpriced.length} not priced` : ''} · client price ${qm.net === null ? gap('not set') : m$(qm.net)}${qm.margin?.provisional.length ? ' · margin provisional' : ''}${qm.term ? ` · ${esc(TERMS[qm.term])}` : ''}`;
  const propLine = !p ? 'No proposal yet' : `${esc(PROPOSAL_STATUS[p.status] || p.status)} · version ${p.versions} · ${esc(usTime(p.at, ctx.now))}`;
  const delLine = del ? `${del.tasks.filter((t) => !t.done).length} open tasks · portal ${del.portalSince ? 'on' : 'off'}` : 'Starts once accepted';
  const gmail = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent((j.deal?.email || j.inquiries.at(-1)?.email) ? `"${j.deal?.email || j.inquiries.at(-1)?.email}"` : `"${j.name}"`)}`;
  const rows = [
    ['Discovery', `/dashboard/flow/${k}/discovery`, discLine],
    ['Quote', `/dashboard/flow/${k}/quote`, quoteLine],
    ['Proposal', `/dashboard/flow/${k}/proposal`, propLine],
    ['Delivery and client portal', `/dashboard/flow/${k}/delivery`, delLine]
  ];
  const steps = `<ul class="d-list">${rows.map(([t, h, sub]) => `<li class="d-row"><div class="d-row__main"><a class="d-row__title" href="${h}">${esc(t)} ›</a><span class="d-row__sub">${sub}</span></div></li>`).join('')}</ul>`;
  // The deal's own documents and emails stay on the deal (Scooter, 14 Nov 2026: "Each deal carries its
  // notes, documents, and related emails in one place"); two buttons, no explanation.
  const files = `<p class="d-files"><a class="d-btn" href="/dashboard/find?q=${encodeURIComponent(j.name)}">Documents</a><a class="d-btn" href="${esc(gmail)}" target="_blank" rel="noopener noreferrer">Emails in Gmail ↗</a></p>`;
  return sec('scope', 'Discovery to delivery', steps + files);
}

/* ------------------------------------------------------------------ inquiries, with a researched lead */

export function inquiriesBody(view, ctx, journeysByKey) {
  const rows = [...view.rows.inquiries].reverse().slice(0, 40);
  const list = rows.length ? `<ul class="d-list">${rows.map((r) => {
    const j = journeysByKey[orgOf(r, journeysByKey)];
    const owner = j?.deal?.owner || ctx.intake?.[j?.key]?.owner || '';
    return `<li class="d-row"><div class="d-row__main">${j ? `<a class="d-row__title" href="/dashboard/flow/${encodeURIComponent(j.key)}">${esc(r.org || r.name || 'Inquiry')} ›</a>` : `<span class="d-row__title">${esc(r.org || r.name || 'Inquiry')}</span>`}<span class="d-row__sub">${esc(r.name || '')}${r.email ? ` · ${esc(r.email)}` : ''} · ${dayOr(r.at)}${r.from_site ? ' · your site' : ''}</span>${r.service ? `<span class="d-row__sub">Service: ${esc(SERVICE_BY_ID[r.service]?.name || r.service)}${eventWords({ start: r.event_start, end: r.event_end }) ? ` · event ${esc(eventWords({ start: r.event_start, end: r.event_end }))}` : ''}</span>` : ''}${r.initiative ? `<span class="d-row__sub">Needs: ${esc(String(r.initiative).slice(0, 140))}</span>` : ''}<span class="d-row__sub">Owner: ${owner ? esc(owner) : gap('nobody yet')} · ${j?.deal ? 'in your tracker' : 'not in your tracker yet'}</span></div></li>`;
  }).join('')}</ul>` : '';
  const add = `<details class="d-fold"${rows.length ? '' : ' open'}><summary><span>Add a researched lead</span></summary>
    <form class="d-form" method="post" action="/dashboard/lead/add">${hidden('back', '/dashboard/inquiries')}
      <div class="d-grid2"><div><label for="rl-org">Organization</label><input id="rl-org" name="org" required maxlength="160"></div><div><label for="rl-name">Person</label><input id="rl-name" name="name" maxlength="160"></div></div>
      <div class="d-grid2"><div><label for="rl-email">Their email</label><input id="rl-email" name="email" type="email" maxlength="200"></div><div><label for="rl-owner">Owner</label><input id="rl-owner" name="owner" maxlength="120"></div></div>
      <label for="rl-need">What they may need, and why now</label><textarea id="rl-need" name="need" maxlength="1000"></textarea>
      <p><button type="submit" class="d-primary">Add to my tracker</button></p>
      <p class="d-sub">You pick each one: nothing is added unless you press this. It adds one row at the bottom of your tracker, with Source "Researched".</p></form></details>`;
  return { list, add };
}
function orgOf(r, map) {
  const k = String(r.org || r.name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '').replace(/ (inc|llc|ltd|co|corp|corporation|company|pbc)$/, '').trim().replace(/ /g, '-').slice(0, 100);
  if (map[k]) return k;
  return Object.values(map).find((j) => j.inquiries.includes(r))?.key || k;
}

/* ------------------------------------------------------------------ discovery */

/** Event dates on a deal: what he saved on Discovery, else what the person typed on the site's form. */
export function eventOf(j, disc) {
  if (disc?.event?.start || disc?.event?.end) return disc.event;
  const inq = [...(j.inquiries || [])].reverse().find((i) => i.event_start || i.event_end);
  return inq ? { start: inq.event_start || '', end: inq.event_end || '' } : { start: '', end: '' };
}
export function eventWords(ev) {
  if (!ev?.start && !ev?.end) return '';
  return ev.start && ev.end && ev.start !== ev.end ? `${usDay(ev.start)} to ${usDay(ev.end)}` : usDay(ev.start || ev.end);
}

/**
 * Discovery (Scooter, 15 Nov 2026): services first, picked by the site's own icons (several at once);
 * then Organization type, what it is for and the scale; then his sales-call notes; then the guided
 * questions for what he picked. One form, one Save; the questions follow the services he saved.
 */
export function renderDiscovery(j, ctx) {
  const saved = ctx.discovery || { profile: {}, answers: {} };
  const deal = j.deal || {};
  const inq = j.inquiries?.at(-1) || {};
  // Before his first save, start from the deal's own Service cell or the site form's service.
  const services = saved.at ? servicesOf(saved.profile) : [serviceFrom(deal.service), serviceFrom(inq.service)].filter(Boolean);
  const guess = (part) => saved.profile?.[part] || guessFrom(part, deal);
  const profile = { services, ...Object.fromEntries(Object.keys(DISCOVERY_PROFILE).map((k) => [k, guess(k)])) };
  const qs = discoveryQuestions(profile);
  const back = `/dashboard/flow/${encodeURIComponent(j.key)}/discovery`;
  const answer = (q) => esc(saved.answers?.[q.id] || '');
  const tiles = `<div class="d-svcs">${SERVICES.map((x) => `<label class="d-svc">${x.icon}<span>${esc(x.name)}</span><input type="checkbox" name="p_services" value="${x.id}"${services.includes(x.id) ? ' checked' : ''}></label>`).join('')}</div>`;
  const ev = eventOf(j, saved);
  const event = `<div class="d-event"><div class="d-grid2"><div><label for="ev-start">Event start date</label><input id="ev-start" name="event_start" type="date" value="${esc(ev.start)}"></div><div><label for="ev-end">Event end date</label><input id="ev-end" name="event_end" type="date" value="${esc(ev.end)}"></div></div><p class="d-sub">For ${esc(EVENT_SERVICE.name)}.${!saved.event?.start && ev.start ? ' From their form on your site.' : ''}</p></div>`;
  const pickers = `<div class="d-grid2">${Object.entries(DISCOVERY_PROFILE).map(([k, def]) => `<div><label for="dp-${k}">${esc(def.label)}</label><select id="dp-${k}" name="p_${k}"><option value="">Choose…</option>${Object.entries(def.options).map(([v, l]) => `<option value="${v}"${profile[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>`;
  const call = CALL_NOTES.map((q) => `<label for="dq-${q.id}">${esc(q.text)}</label><textarea id="dq-${q.id}" name="a_${q.id}" maxlength="2000">${answer(q)}</textarea>`).join('');
  const guided = qs.map((q, i) => `<label for="dq-${q.id}">${i + 1}. ${esc(q.text)}</label><textarea id="dq-${q.id}" name="a_${q.id}" maxlength="2000">${answer(q)}</textarea>`).join('');
  const status = ctx.discovery?.at ? `<p class="d-src">Last saved ${esc(usTime(ctx.discovery.at, ctx.now))}</p>` : '';
  const save = (label) => `<p><button type="submit" class="d-primary">${label}</button></p>`;
  const form = `<form class="d-form" method="post" action="/dashboard/discovery">${hidden('key', j.key)}${hidden('back', back)}
    ${sec('services', 'Services', `<p class="d-sub">Pick every service they need. Each one carries into the quote.</p>${tiles}${event}`)}
    ${sec('shape', 'About them', pickers)}
    ${sec('call', 'Sales call notes', call)}
    ${sec('questions', `Questions · ${qs.length}`, `${services.length ? '' : '<p class="d-sub">Pick their services above and save; the questions for those services appear here.</p>'}${guided}`)}
    ${save('Save')}<p class="d-sub">Saved with this deal on every device; every save is kept.</p></form>`;
  return shell(`Discovery · ${j.name}`, `${backTo(j)}<h1>Discovery</h1><p class="d-sub">${esc(j.name)}</p>${status}${ctx.flash || ''}${form}`, ctx);
}
function guessFrom(part, deal) {
  const text = String(part === 'buyer' ? deal.buyer || '' : '').toLowerCase();
  if (!text) return '';
  const map = [['foundation', /foundation|funder|philanthrop/], ['education', /school|college|universit|education/], ['association', /association|member/], ['nonprofit', /nonprofit|non-profit|charity/], ['public', /public|government|agency|city|state/], ['brand', /brand|company|corporate|business/]];
  return (map.find(([, re]) => re.test(text)) || [''])[0];
}

/* ------------------------------------------------------------------ the pricing builder */

const val$ = (n) => (n === null || n === undefined ? '' : esc(n));
const pct = (n) => (n === null || n === undefined ? '' : `${Math.round(n)}%`);
const opts = (map, cur) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${String(cur) === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
/** "Assigned to": the directory by type, then "Add a new person…" (the new-person boxes below the row). */
function whoSelect(id, name, cur, dir, { ownersOnly = false } = {}) {
  const people = ownersOnly ? dir.filter((p) => p.type === 'owner') : dir;
  const groups = Object.entries(PERSON_TYPES).map(([t, label]) => {
    const list = people.filter((p) => p.type === t);
    return list.length ? `<optgroup label="${esc(label)}">${list.map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const gone = cur && !dir.some((p) => p.id === cur) ? '<option value="" selected>Not chosen (that person was removed)</option>' : '';
  return `<select id="${id}" name="${name}">${gone}<option value=""${!cur ? ' selected' : ''}>Not chosen</option>${groups}${ownersOnly ? '' : '<option value="__new">+ Add a new person (below)</option>'}</select>`;
}
const rateWords = (r) => (r === null || r === undefined ? '' : esc(money(r)));

/** One row on a service: a role (someone does it) or another cost. Phone first: a stacked card. */
function roleRow(svcId, r, i, dir) {
  const f = (k) => `rl_${svcId}_${i}_${k}`;
  const idf = (k) => `rl-${svcId}-${i}-${k}`;
  const b = BILLED[r.billed] || BILLED.job;
  const c = roleCost(r, dir);
  const keep = ['rid', 'kind', 'std', 'stdper', 'card'].map((k) => hidden(f(k), { rid: r.rid, kind: r.kind, std: r.std ?? '', stdper: r.stdPer || '', card: r.card || '' }[k])).join('') + (r.custom ? hidden(f('custom'), '1') : '');
  const name = r.custom
    ? `<label for="${idf('name')}">Role name <span class="d-role__tag">clear it to remove this row</span></label><input id="${idf('name')}" name="${f('name')}" maxlength="120" value="${esc(r.name)}">`
    : `${hidden(f('name'), r.name)}<span class="d-role__name">${esc(r.name)}</span>`;
  const tag = r.kind === 'cost' ? '<span class="d-role__tag">Other cost</span>' : '';
  const card = r.card ? `<span class="d-role__tag">From the rate card · ${esc(r.card)}</span>` : '';
  const std = c.from === 'directory' ? `${rateWords(c.rate)} ${RATE_PER[b.per]} (standard)` : c.from === 'card' ? `${rateWords(c.rate)} (rate card)` : 'not set';
  // Every box is on the page; the shell's CSS shows only the ones the chosen "Billed as" needs, so
  // changing it on the row swaps the boxes at once, before any save (the CSP allows no script).
  const boxes = ['rate', 'qty', 'hours', 'months'];
  const only = (words) => Object.entries(words).map(([v, w]) => `<span data-only="${esc(v)}">${esc(w)}</span>`).join('');
  const box = (k) => {
    const label = k === 'rate' ? `Rate ${only(Object.fromEntries(Object.entries(BILLED).map(([v, x]) => [v, RATE_PER[x.per]])))}` : k === 'hours' ? only(BOX_WORDS.hours) : esc(BOX_WORDS[k]);
    const ph = k === 'rate' ? std : k === 'months' ? 'months' : k === 'qty' ? 'how many' : 'hours';
    return `<div class="d-box" data-box="${k}"><label for="${idf(k)}">${label}</label><input id="${idf(k)}" name="${f(k)}" inputmode="decimal" value="${val$(r[k])}" placeholder="${esc(ph)}"></div>`;
  };
  const costLine = r.out ? 'Left out of this quote.'
    : c.cost === null ? `<span class="d-gold">Not priced: ${esc(c.missing.map((k) => (k === 'rate' ? 'rate' : k === 'qty' ? 'how many' : k)).join(', '))} needed${c.mismatch ? ` (${esc(c.person.name)}'s standard rate is ${esc(RATE_PER[c.person.per])}; this role is billed ${esc(RATE_PER[b.per])})` : ''}</span>`
      : `Cost ${esc(money(c.cost))}${c.from === 'quote' ? ' · rate set for this quote only' : ''}`;
  const unassigned = r.kind !== 'cost' && !r.out && !c.person ? ' <span class="d-gold">· nobody assigned</span>' : '';
  return `<div class="d-role${r.out ? ' d-role--out' : ''}">${keep}
    <div class="d-role__head"><div>${name}${tag}${card}</div><label class="d-check"><input type="checkbox" name="${f('out')}" value="1"${r.out ? ' checked' : ''}> Leave out</label></div>
    <div class="d-grid2"><div><label for="${idf('who')}">Assigned to</label>${whoSelect(idf('who'), f('who'), r.who, dir)}</div><div><label for="${idf('billed')}">Billed as</label><select class="d-billed" id="${idf('billed')}" name="${f('billed')}">${Object.entries(BILLED).map(([v, x]) => `<option value="${v}"${r.billed === v ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div></div>
    <div class="d-grid3">${boxes.map(box).join('')}</div>
    <p class="d-role__cost">${costLine}${unassigned}</p>
    <details><summary>Add someone new to the team directory</summary><div class="d-grid2"><div><label for="${idf('newname')}">Name</label><input id="${idf('newname')}" name="${f('newname')}" maxlength="120"></div><div><label for="${idf('newtype')}">Type</label><select id="${idf('newtype')}" name="${f('newtype')}">${opts(PERSON_TYPES, 'contractor')}</select></div></div><div class="d-grid2"><div><label for="${idf('newrate')}">Standard rate (optional)</label><input id="${idf('newrate')}" name="${f('newrate')}" inputmode="decimal" placeholder="only if known"></div><div><label for="${idf('newper')}">Per</label><select id="${idf('newper')}" name="${f('newper')}">${opts(RATE_PER, b.per)}</select></div></div><p class="d-sub">Saved to the directory and assigned to this role when the quote is saved.</p></details>
  </div>`;
}

/**
 * The quote builder (Scooter, 15 Nov 2026; quote-builder-format.pdf): pick a service, its roles load,
 * assign a person from the team directory, choose how each role is billed, see cost and margin. Client
 * price is typed, never built from costs; a discount lowers price, not cost; an empty box is left out of
 * the math and named, never counted as zero; margin is provisional until every role is priced and has
 * someone assigned. Costs, pay and margin stay on this page: the proposal and portal never carry them.
 */
export function renderQuote(j, ctx) {
  const k = encodeURIComponent(j.key);
  const back = `/dashboard/flow/${k}/quote`;
  const hold = moneyHold(ctx);
  if (hold) return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1>${ctx.flash || ''}${holdBox(hold)}`, ctx);
  if (ctx.quote?.unreadable) return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1>${errorBox('The last quote could not be read back.', 'It was saved encrypted and the key that opens it is not the one this site has now. Build it again below; nothing else is affected.', back, 'Start again')}`, ctx);
  const dir = ctx.directory || [];
  const q = ctx.quote || { services: [], term: 0, months: 1, plan: '', split: '', rationale: '', title: '' };
  const had = Object.fromEntries((Array.isArray(q.services) ? q.services : []).map((x) => [x.id, x]));
  // The services carried from Discovery, plus any already on this quote, in the site's order.
  const ids = SERVICES.map((x) => x.id).filter((id) => servicesOf(ctx.discovery?.profile || {}).includes(id) || had[id]);
  if (!ids.length) {
    return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1>${ctx.flash || ''}${empty('Pick their services on Discovery first. Each service you pick loads its roles here.', `/dashboard/flow/${k}/discovery`, '← Pick services on Discovery', 'flow')}`, ctx);
  }
  // A service saved before the roles existed (one specialist and cost) opens with its roles loaded.
  const services = ids.map((id) => ({ id, name: SERVICE_BY_ID[id].name, price: had[id]?.price ?? null, month: had[id]?.month || 0, roles: Array.isArray(had[id]?.roles) ? had[id].roles : templateRoles(id) }));
  const m = quoteMath({ ...q, services }, dir);
  const saved = Boolean(ctx.quote);

  const svc = (x) => {
    const s = SERVICE_BY_ID[x.id];
    const item = m.items.find((y) => y.id === x.id) || {};
    const tiers = catalogTiers(ctx.catalog, x.id);
    const tierPick = s.events && tiers.length ? `<div><label for="tier-${x.id}">Load lines from the event rate card</label><select id="tier-${x.id}" name="tier_${x.id}"><option value="__none" selected>Don't load</option>${tiers.map((t) => `<option value="${esc(t)}">${esc(t || 'All lines (no tiers)')}</option>`).join('')}</select><p class="d-sub">Adds that tier's lines with their quantities and standard rates. <a href="/dashboard/catalog">The rate card ›</a></p></div>` : '';
    return `<div class="d-qsvc">${hidden('svc', x.id)}${hidden(`rn_${x.id}`, x.roles.length)}<h3>${s.icon}${esc(s.name)}</h3>
      <p class="d-sub">${x.roles.filter((r) => !r.out).length} rows · cost so far ${item.cost === null || item.cost === undefined ? gap('unknown') : esc(money(item.cost)) || '$0'}${item.unknown ? ` <span class="d-gold">· ${item.unknown} not priced</span>` : ''}</p>
      ${x.roles.map((r, i) => roleRow(x.id, r, i, dir)).join('')}
      <div class="d-role"><div class="d-grid2"><div><label for="nr-${x.id}">Add a role</label><input id="nr-${x.id}" name="nr_${x.id}_name" maxlength="120" placeholder="Role or cost name"></div><div><label for="nrk-${x.id}">It is</label><select id="nrk-${x.id}" name="nr_${x.id}_kind">${opts(ROLE_KINDS, 'role')}</select></div></div>${tierPick}</div>
      <label for="price-${x.id}">Client price for ${esc(s.name)}</label><input id="price-${x.id}" name="price_${x.id}" inputmode="decimal" value="${val$(x.price)}" placeholder="Set by the value of the work">
    </div>`;
  };

  const mg = m.margin;
  const strip = `<div class="d-strip">
      <div><span>Client price</span><strong>${m.price === null ? gap('blank') : esc(money(m.price))}</strong></div>
      <div><span>Discount</span><strong>${m.discount === null ? gap('blank') : esc(money(m.discount))}</strong></div>
      <div><span>Costs so far</span><strong>${m.rows.length || m.cost ? esc(money(m.cost)) || '$0' : gap('blank')}</strong></div>
      <div><span>Margin</span><strong class="${mg?.belowCost ? 'd-red' : ''}">${!mg ? gap('needs a price') : `${esc(money(mg.amount)) || '$0'}${mg.pct === null ? '' : ` · ${pct(mg.pct)}`}`}</strong>${mg?.provisional.length ? '<span class="d-gold">provisional</span>' : ''}</div>
    </div>`;
  const line = (label, v, note = '') => `<li><span>${label}${note ? `<br><span class="d-sub">${note}</span>` : ''}</span><span>${v}</span></li>`;
  const notSet = (v, words = 'not set') => (v === null || v === undefined ? gap(words) : esc(money(v)) || '$0');
  const over = m.overDiscount ? `<p class="d-red">The discount is bigger than the client price, so the price after discount is below zero. Lower the discount or raise the price.</p>` : '';
  const breakdown = `${over}<ul class="d-kv">
      ${line('Roles: team and contractors', esc(money(m.groups.people)) || '$0')}
      ${line('Roles assigned to an owner', esc(money(m.groups.ownerRoles)) || '$0')}
      ${line('Other costs', esc(money(m.groups.other)) || '$0', 'Bookings, licences, tools, pass-through')}
      ${line('Owner time (planned)', notSet(m.ownerTime), m.include.owner ? 'In the margin' : 'Not in the margin')}
      ${line('Overhead', notSet(m.overhead), m.include.overhead ? 'In the margin' : 'Not in the margin')}
      ${line('Tax reserve', m.taxPct === null ? gap('not set') : m.tax === null ? gap('needs a price') : esc(money(m.tax)) || '$0', m.include.tax ? `In the margin${m.taxPct === null ? '' : ` · ${esc(m.taxPct)}% of what is left before tax`}` : 'Not in the margin')}
      ${line('Client price after discount', m.net === null ? gap('blank') : esc(money(m.net)))}
    </ul>
    <p class="d-sub">The margin is the price after discount minus ${esc(mg ? mg.includes.join(', ') : 'roles, other costs, owner time, overhead and tax reserve')}${mg?.leftOut.length ? `. Not included: ${esc(mg.leftOut.join(', '))}` : ''}. An empty box is left out of the math and never counted as zero.</p>
    ${mg?.provisional.length ? `<p class="d-sub d-gold">Provisional: ${esc(mg.provisional.join(' · '))}.</p>` : ''}
    ${m.unpriced.length ? `<p class="d-sub d-gold">Not priced yet: ${esc(m.unpriced.join(', '))}.</p>` : ''}
    ${m.unassigned.length ? `<p class="d-sub d-gold">Nobody assigned: ${esc(m.unassigned.join(', '))}.</p>` : ''}
    ${saved ? `<p class="d-src">Saved ${esc(usTime(ctx.quote._at, ctx.now))}. Every version is kept, encrypted. Internal only: none of these costs, rates, names or margins reach the proposal or the client portal.</p>` : '<p class="d-src">Not saved yet.</p>'}`;
  const timeline = saved && m.net !== null ? `<details class="d-fold"><summary><span>When money moves</span></summary><ul class="d-kv">${m.timeline.map((t) => `<li><span>Month ${t.month}<br><span class="d-sub">in ${esc(money(t.cashIn)) || '$0'} · out ${esc(money(t.cashOut)) || '$0'}</span></span><span class="${t.position < 0 ? 'd-red' : ''}">${esc(money(t.position)) || '$0'}</span></li>`).join('')}</ul><p class="d-sub">Out is the priced roles and other costs (in the month set on the service, else spread), plus ${esc(['owner time','overhead'].filter((x, i) => (i ? m.include.overhead && m.overhead !== null : m.include.owner && m.ownerTime !== null)).concat(m.include.tax && m.tax ? ['the tax reserve, set aside from each payment as it arrives'] : []).join(', ') || 'nothing else yet')}${m.include.owner || m.include.overhead ? ' (in the month set on each, else spread over the engagement)' : ''}: the same costs the margin includes. ${m.shortMonths.length ? `<span class="d-red">Out of pocket in month ${m.shortMonths.join(', ')}: costs go out before the client's payments arrive.</span>` : 'Payments arrive ahead of costs in every month.'}</p></details>` : '';

  const o = q.ownerPlan || {};
  const inc = { owner: q.include?.owner !== false, overhead: q.include?.overhead !== false, tax: q.include?.tax !== false };
  const owner = `<p class="d-sub">Owner time is a cost like any other. Plan only time that is not already on a role above. Only the boxes for the way you choose are used.</p>
    <label for="own-model">How owner time is planned</label><select id="own-model" name="own_model"><option value="">Not planned yet</option>${opts(OWNER_MODELS, o.model || '')}</select>
    <div class="d-grid2"><div><label for="own-who">Which owner</label>${whoSelect('own-who', 'own_who', o.who || '', dir, { ownersOnly: true })}</div><div><label for="own-hours">Hours</label><input id="own-hours" name="own_hours" inputmode="decimal" value="${val$(o.hours)}"></div></div>
    <div class="d-grid3"><div><label for="own-rate">Hourly rate</label><input id="own-rate" name="own_rate" inputmode="decimal" value="${val$(o.rate)}" placeholder="the owner's standard"></div><div><label for="own-monthly">Each month</label><input id="own-monthly" name="own_monthly" inputmode="decimal" value="${val$(o.monthly)}"></div><div><label for="own-share">Share of price (%)</label><input id="own-share" name="own_share" inputmode="decimal" value="${val$(o.share)}"></div></div>
    <label for="own-month">Owner time goes out in month</label><input id="own-month" name="own_month" inputmode="numeric" value="${o.month ? esc(o.month) : ''}" placeholder="blank: spread over the engagement">`;
  const ov = q.overhead || {};
  const costsBelow = `<div class="d-grid2"><div><label for="ov-val">Overhead</label><input id="ov-val" name="ov_value" inputmode="decimal" value="${val$(ov.value)}"></div><div><label for="ov-mode">As</label><select id="ov-mode" name="ov_mode">${opts({ pct: '% of the client price', amount: 'An amount for this job' }, ov.mode || 'pct')}</select></div></div>
    <label for="ov-month">Overhead goes out in month</label><input id="ov-month" name="ov_month" inputmode="numeric" value="${ov.month ? esc(ov.month) : ''}" placeholder="blank: spread over the engagement">
    <label for="tax">Tax reserve (% of what is left before tax)</label><input id="tax" name="tax" inputmode="decimal" value="${val$(q.taxReserve)}">
    <fieldset class="d-fieldset"><legend>The margin includes</legend><p class="d-sub">Roles and other costs, always. And:</p>
    <label class="d-check"><input type="checkbox" name="inc_owner" value="1"${inc.owner ? ' checked' : ''}> Owner time</label>
    <label class="d-check"><input type="checkbox" name="inc_overhead" value="1"${inc.overhead ? ' checked' : ''}> Overhead</label>
    <label class="d-check"><input type="checkbox" name="inc_tax" value="1"${inc.tax ? ' checked' : ''}> Tax reserve</label></fieldset>`;
  const d = q.discount || {};
  const price = `<div class="d-grid2"><div><label for="disc">Discount</label><input id="disc" name="disc" inputmode="decimal" value="${val$(d.value)}"></div><div><label for="disc-mode">As</label><select id="disc-mode" name="disc_mode">${opts({ amount: 'An amount', pct: '% of the client price' }, d.mode || 'amount')}</select></div></div><p class="d-sub">A discount lowers the price, not the costs, so it comes out of the margin.</p>`;
  const terms = `<div class="d-grid2"><div><label for="q-term">Package</label><select id="q-term" name="term">${Object.entries(TERMS).map(([v, l]) => `<option value="${v}"${String(q.term) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label for="q-months">If one project: how many months it runs</label><input id="q-months" name="months" inputmode="numeric" value="${esc(q.months || 1)}"></div></div>
    <div class="d-grid2"><div><label for="q-plan">Payment plan</label><select id="q-plan" name="plan"><option value="">Choose…</option>${Object.entries(PAY_PLANS).map(([v, l]) => `<option value="${v}"${q.plan === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label for="q-split">Custom split (percent)</label><input id="q-split" name="split" value="${esc(q.split || '')}" placeholder="30/30/20/20"></div></div>
    ${m.term ? `<p class="d-sub">${esc(TERMS[m.term])}: ${m.monthly === null ? 'set the client price to see the monthly figure' : `${esc(money(m.monthly))} a month for ${m.term} months`}. Each role keeps its own months.</p>` : '<p class="d-sub">Each role keeps its own hours, quantities and months, apart from the engagement length.</p>'}`;
  const dirNote = dir.length ? `<p class="d-sub">${dir.length} ${dir.length === 1 ? 'person' : 'people'} in the <a href="/dashboard/team?back=${encodeURIComponent(back)}">team directory ›</a></p>` : `<p class="d-sub d-gold">The team directory is empty. Add people here on any role, or <a href="/dashboard/team?back=${encodeURIComponent(back)}">set up the directory ›</a></p>`;

  const form = `<form class="d-form" method="post" action="/dashboard/quote">${hidden('key', j.key)}${hidden('back', back)}
    ${sec('services', `Services · ${ids.length}`, `<p class="d-sub">From Discovery. <a href="/dashboard/flow/${k}/discovery">Change the services ›</a></p>${dirNote}${services.map(svc).join('')}`)}
    ${sec('price', 'Discount', price)}
    ${sec('owner', 'Owner time', owner)}
    ${sec('costs', 'Overhead and tax reserve', costsBelow)}
    ${sec('terms', 'Term and payment', terms)}
    ${sec('why', 'What the client reads', `<label for="q-title">Proposal title</label><input id="q-title" name="title" maxlength="160" value="${esc(q.title || '')}" placeholder="Proposal for ${esc(j.name)}"><label for="q-rat">Why this is worth it to them</label><textarea id="q-rat" name="rationale" maxlength="3000">${esc(q.rationale || '')}</textarea><p class="d-sub">The client sees these words, the services, the prices and any discount. Never a role, a person, a rate, a cost or the margin.</p>`)}
    <p><button type="submit" class="d-primary">Save quote</button></p></form>`;
  return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1><p class="d-sub">${esc(j.name)} · internal only</p>${ctx.flash || ''}${sec('numbers', 'The numbers', strip + `<details class="d-fold"><summary><span>What the costs and margin are made of</span></summary>${breakdown}</details>` + timeline)}${form}`, ctx);
}

/* ------------------------------------------------------------------ the team directory */

/**
 * People who do the work, kept apart from roles (Scooter, 15 Nov 2026): owner, team member or
 * contractor, with a standard rate per hour, month or job only when it is known. Nobody is pre-filled
 * and nobody is "You". A rate typed on a quote overrides this for that quote only.
 */
export function renderTeam(ctx) {
  const back = ctx.back || '/dashboard';
  const hold = moneyHold(ctx);
  const head = `<p><a class="d-help" href="${esc(back)}">← Back</a></p><h1>Team directory</h1>`;
  if (hold) return shell('Team directory', `${head}${ctx.flash || ''}${holdBox(hold)}`, ctx);
  const dir = ctx.directory || [];
  const row = (p, i) => `<li class="d-row"><div class="d-row__main">${hidden(`pid_${i}`, p.id || '')}<div class="d-grid2"><div><label for="tp-n${i}">Name</label><input id="tp-n${i}" name="pname_${i}" maxlength="120" value="${esc(p.name || '')}"${p.id ? '' : ' placeholder="Add a person"'}></div><div><label for="tp-t${i}">Type</label><select id="tp-t${i}" name="ptype_${i}">${opts(PERSON_TYPES, p.type || 'contractor')}</select></div></div><div class="d-grid2"><div><label for="tp-r${i}">Standard rate (optional)</label><input id="tp-r${i}" name="prate_${i}" inputmode="decimal" value="${val$(p.rate)}" placeholder="only if known"></div><div><label for="tp-p${i}">Per</label><select id="tp-p${i}" name="pper_${i}">${opts(RATE_PER, p.per || 'hour')}</select></div></div></div></li>`;
  const n = dir.length;
  const intro = n ? '' : '<div class="d-emptybox"><p>Nobody is in the directory yet. Add the owners, team members and contractors who do the work; each one can then be assigned to a role on any quote.</p></div>';
  const body = `${head}<p class="d-sub">The people who do the work, kept apart from the roles they fill. Internal only, kept encrypted; a client never sees a name or a rate from here.</p>${ctx.flash || ''}${intro}
    <form class="d-form" method="post" action="/dashboard/team">${hidden('back', back)}${hidden('n', n + 2)}
    ${sec('people', `People · ${n}`, `<ul class="d-list">${dir.map(row).join('')}${row({}, n)}${row({}, n + 1)}</ul><p class="d-sub">The last two rows add people. Clear a name to remove that person. A rate is only filled in when it is known; a blank rate is unknown, never zero.</p>`)}
    <p><button type="submit" class="d-primary">Save the directory</button></p></form>`;
  return shell('Team directory', body, ctx);
}

/* ------------------------------------------------------------------ the catalog */

export function renderCatalog(ctx) {
  const hold = moneyHold(ctx);
  if (hold) return shell('Catalog', `<p><a class="d-help" href="/dashboard">← Pipeline</a></p><h1>Service catalog</h1>${ctx.flash || ''}${holdBox(hold)}`, ctx);
  const lines = ctx.catalog || CATALOG_STRUCTURE;
  const row = (l, i) => `<li class="d-row"><div class="d-row__main">${hidden(`id_${i}`, l.id)}<div class="d-grid2"><div><label for="cl-l${i}">Line</label><input id="cl-l${i}" name="line_${i}" maxlength="120" value="${esc(l.line)}"></div><div><label for="cl-s${i}">Service</label><select id="cl-s${i}" name="service_${i}">${Object.entries(SERVICE_NAMES).map(([v, n]) => `<option value="${v}"${l.service === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div><div class="d-grid2"><div><label for="cl-u${i}">Unit</label><input id="cl-u${i}" name="unit_${i}" maxlength="30" value="${esc(l.unit)}"></div><div><label for="cl-c${i}">Your cost rate</label><input id="cl-c${i}" name="cost_${i}" inputmode="decimal" value="${esc(l.cost ?? '')}" placeholder="unknown"></div></div><div class="d-grid2"><div><label for="cl-t${i}">Tier (from the rate card)</label><input id="cl-t${i}" name="tier_${i}" maxlength="60" value="${esc(l.tier ?? '')}" placeholder="none"></div><div><label for="cl-q${i}">Quantity in that tier</label><input id="cl-q${i}" name="qty_${i}" inputmode="decimal" value="${esc(l.qty ?? '')}" placeholder="none"></div></div></div></li>`;
  const n = lines.length;
  const body = `<p><a class="d-help" href="/dashboard">← Pipeline</a></p><h1>Service catalog</h1><p class="d-sub">Your service lines, their units and what each costs you. These are private: only you see them, they are kept encrypted, and a client never sees a rate.</p>${ctx.flash || ''}
    ${sec('import', 'Read it from your rate card', `<form class="d-form" method="post" action="/dashboard/catalog/import">${hidden('back', '/dashboard/catalog')}<label for="rc-link">Link to your rate card sheet</label><input id="rc-link" name="link" inputmode="url" placeholder="https://docs.google.com/spreadsheets/d/…"><p><button type="submit">Read its lines</button></p><p class="d-sub">Reads columns like Service, Item, Unit and Rate (or Cost), once. Your sheet is not changed and is not kept as a source.</p></form>`)}
    <form class="d-form" method="post" action="/dashboard/catalog">${hidden('back', '/dashboard/catalog')}${hidden('n', n + 1)}
    ${sec('lines', `Lines · ${n}`, `<ul class="d-list">${lines.map(row).join('')}${row({ id: '', line: '', service: 'team', unit: '', cost: null }, n)}</ul><p class="d-sub">The last row adds a line. Clear a line's name to remove it. A blank rate is unknown, never zero.</p>`)}
    <p><button type="submit" class="d-primary">Save catalog</button></p></form>`;
  return shell('Catalog', body, ctx);
}

/* ------------------------------------------------------------------ proposal */

export function renderProposal(j, ctx) {
  const back = `/dashboard/flow/${encodeURIComponent(j.key)}/proposal`;
  const p = ctx.proposal;
  const hold = moneyHold(ctx);
  const draftBtn = ctx.quote && !ctx.quote.unreadable && !hold ? `<form method="post" action="/dashboard/proposal" class="d-inline">${hidden('key', j.key)}${hidden('back', back)}${hidden('do', 'draft')}<button type="submit"${p ? '' : ' class="d-primary"'}>${p ? 'Start again from the latest quote' : 'Write it from the quote'}</button></form>` : '';
  if (!p) {
    const why = hold ? holdBox(hold) : !ctx.quote ? empty('A proposal starts from a saved quote. Build the quote first.', `/dashboard/flow/${encodeURIComponent(j.key)}/quote`, 'Build the quote', 'flow') : `<p class="d-sub">Writes a first draft from your quote and discovery answers: scope, term, your price, the payment plan and your rationale. Never your costs or margin. You edit every word.</p>${draftBtn}`;
    return shell(`Proposal · ${j.name}`, `${backTo(j)}<h1>Proposal</h1>${ctx.flash || ''}${why}`, ctx);
  }
  if (p.text === null) return shell(`Proposal · ${j.name}`, `${backTo(j)}<h1>Proposal</h1>${errorBox('This proposal could not be read back.', 'Write it again from the quote; nothing else is affected.', back, 'Back')}${draftBtn}`, ctx);
  const stages = stageOptions(ctx.view.rows.deals, ctx.settings?.['layout:deals']?.stages).stages;
  const signedStage = stages.find((s) => /signed/i.test(s)) || (stages.length ? '' : FUNNEL_STAGES[7]);
  const accepted = p.status === 'accepted';
  const statusBtns = `<div class="d-acts">${['draft', 'sent'].map((s) => `<button type="submit" name="status" value="${s}"${p.status === s ? ' class="d-primary"' : ''}>Save as ${esc(PROPOSAL_STATUS[s].toLowerCase())}</button>`).join('')}</div>`;
  const editor = `<form class="d-form" method="post" action="/dashboard/proposal">${hidden('key', j.key)}${hidden('back', back)}${hidden('do', 'save')}<label for="pr-text">Proposal (you can edit every word)</label><textarea id="pr-text" name="text" rows="22" maxlength="20000"${accepted ? ' readonly' : ''}>${esc(p.text)}</textarea>${accepted ? '<p class="d-sub">Accepted: this version is kept as it was agreed.</p>' : statusBtns}</form>`;
  const accept = accepted ? `<p>Accepted ${esc(usTime(p.at, ctx.now))}. <a href="/dashboard/flow/${encodeURIComponent(j.key)}/delivery">Open delivery ›</a></p>`
    : !j.deal ? `<p class="d-sub">Add ${esc(j.name)} to your tracker first (on their record), so acceptance moves the deal there.</p>`
      : `<form class="d-form" method="post" action="/dashboard/proposal">${hidden('key', j.key)}${hidden('back', back)}${hidden('do', 'accept')}<label for="pr-team">Account team (one per line: name and role)</label><textarea id="pr-team" name="team" maxlength="1000">${esc(j.deal.owner ? `${j.deal.owner}: account lead` : '')}</textarea><p><button type="submit" class="d-primary">They accepted: start delivery</button></p><p class="d-sub">${signedStage ? `Moves the deal to "${esc(signedStage)}" in your tracker (checked on read-back), ` : 'Your tracker has no signed stage, so its stage is left as it is; '}keeps this version as agreed, sets up the account team, a task for each scope line, and a private portal for ${esc(j.name)} only. No invoice is created.</p></form>`;
  const stageNow = j.deal ? `<p class="d-sub">Deal stage in your tracker: ${val(j.deal.stage)}. The proposal stays attached as the deal moves through your stages.</p>` : '';
  return shell(`Proposal · ${j.name}`, `${backTo(j)}<h1>Proposal</h1><p class="d-sub">${esc(PROPOSAL_STATUS[p.status])} · version ${p.versions} · saved ${esc(usTime(p.at, ctx.now))}</p>${ctx.flash || ''}${stageNow}${sec('text', 'The proposal', editor + (accepted ? '' : draftBtn))}${sec('accept', 'Accepted?', accept)}`, ctx);
}

/* ------------------------------------------------------------------ delivery and the portal */

export function renderDelivery(j, ctx, { origin, token = '' }) {
  const d = ctx.delivery;
  const back = `/dashboard/flow/${encodeURIComponent(j.key)}/delivery`;
  if (!d) return shell(`Delivery · ${j.name}`, `${backTo(j)}<h1>Delivery</h1>${ctx.flash || ''}${empty('Delivery starts when the proposal is accepted: the account team, tasks and a private client portal are set up then.', `/dashboard/flow/${encodeURIComponent(j.key)}/proposal`, 'Open the proposal', 'flow')}`, ctx);
  const team = `<form class="d-form" method="post" action="/dashboard/delivery/team">${hidden('key', j.key)}${hidden('back', back)}<label for="dv-team">One per line: name and role</label><textarea id="dv-team" name="team" maxlength="1000">${esc(d.team)}</textarea><p><button type="submit">Save team</button></p></form>`;
  const flag = (on) => (on ? '<span class="d-pill">client sees</span>' : '<span class="d-sub">internal</span>');
  const tasks = `${d.tasks.length ? `<ul class="d-list">${d.tasks.map((t) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${t.done ? '<s>' : ''}${esc(t.title)}${t.done ? '</s>' : ''}</span><span class="d-row__sub">${t.owner ? esc(t.owner) : gap('no owner')} · ${t.due ? esc(usDay(t.due)) : gap('no date')} · ${flag(t.client)}</span></div><div class="d-row__act"><form method="post" action="/dashboard/delivery/task/set" class="d-inline">${hidden('key', j.key)}${hidden('back', back)}${hidden('id', t.id)}${hidden('field', 'done')}${hidden('value', t.done ? '0' : '1')}<button type="submit"${t.done ? '' : ' class="d-primary"'}>${t.done ? 'Reopen' : 'Done'}</button></form><form method="post" action="/dashboard/delivery/task/set" class="d-inline">${hidden('key', j.key)}${hidden('back', back)}${hidden('id', t.id)}${hidden('field', 'client')}${hidden('value', t.client ? '0' : '1')}<button type="submit">${t.client ? 'Hide from client' : 'Show to client'}</button></form></div></li>`).join('')}</ul>` : '<p class="d-sub">No tasks yet.</p>'}
    <details class="d-fold"><summary><span>Add a task</span></summary><form class="d-form" method="post" action="/dashboard/delivery/task">${hidden('key', j.key)}${hidden('back', back)}<label for="tk-t">Task</label><input id="tk-t" name="title" required maxlength="200"><div class="d-grid2"><div><label for="tk-o">Owner</label><input id="tk-o" name="owner" maxlength="120"></div><div><label for="tk-d">Due</label><input id="tk-d" name="due" type="date"></div></div><label class="d-check"><input type="checkbox" name="client" value="1"> The client sees this task in their portal</label><p><button type="submit" class="d-primary">Add task</button></p></form></details>`;
  const assets = `${d.assets.length ? `<ul class="d-list">${d.assets.map((a) => `<li class="d-row"><div class="d-row__main"><a class="d-row__title" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.label)} ↗</a><span class="d-row__sub">${flag(a.client)}</span></div></li>`).join('')}</ul>` : '<p class="d-sub">No assets yet: add links to the folder, files or a brief.</p>'}
    <details class="d-fold"><summary><span>Add an asset link</span></summary><form class="d-form" method="post" action="/dashboard/delivery/asset">${hidden('key', j.key)}${hidden('back', back)}<label for="as-l">Name</label><input id="as-l" name="label" required maxlength="160"><label for="as-u">Link (https)</label><input id="as-u" name="url" required inputmode="url" placeholder="https://drive.google.com/…"><label class="d-check"><input type="checkbox" name="client" value="1"> The client sees this in their portal</label><p><button type="submit" class="d-primary">Add asset</button></p></form></details>`;
  const shown = token ? `<div class="d-flash d-flash--ok" role="status"><p><strong>The portal link for ${esc(j.name)}, shown this once:</strong></p><p><code style="overflow-wrap:anywhere">${esc(`${origin}/portal/${token}`)}</code></p><p class="d-sub">Copy it now and send it to them yourself. Only a hash is kept, so it cannot be shown again; press New link to make another (the old one then stops working).</p></div>` : '';
  const portal = `${shown}<p>${d.portalSince ? `On since ${esc(usTime(d.portalSince, ctx.now))}.` : 'Off: no link opens it.'} It shows ${esc(j.name)} only the tasks and assets marked "client sees". It never shows another client, your notes, quotes, rates, prices or money.</p>
    <div class="d-acts"><form method="post" action="/dashboard/delivery/portal" class="d-inline">${hidden('key', j.key)}${hidden('back', back)}${hidden('do', 'new')}<button type="submit" class="d-primary">${d.portalSince ? 'New link' : 'Turn on, with a new link'}</button></form>${d.portalSince ? `<form method="post" action="/dashboard/delivery/portal" class="d-inline">${hidden('key', j.key)}${hidden('back', back)}${hidden('do', 'off')}<button type="submit">Turn the portal off</button></form>` : ''}</div>`;
  return shell(`Delivery · ${j.name}`, `${backTo(j)}<h1>Delivery</h1><p class="d-sub">${esc(j.name)} · started ${esc(usTime(d.at, ctx.now))}</p>${ctx.flash || ''}${sec('team', 'Account team', team)}${sec('tasks', `Tasks · ${d.tasks.filter((t) => !t.done).length} open`, tasks)}${sec('assets', 'Assets', assets)}${sec('portal', 'Client portal', portal)}`, ctx);
}

/** The client's own page. No sign-in, no money, nothing of any other client. */
export function renderPortal(pv, name) {
  const css = 'body{margin:0;background:#0b0b0c;color:#f4f1ea;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:720px;margin:0 auto;padding:24px 18px 48px}h1{font-size:26px;margin:8px 0 4px}h2{font-size:18px;margin:28px 0 8px;color:#ff8500}ul{list-style:none;padding:0;margin:0}li{padding:12px 0;border-bottom:1px solid #2a2a2e}a{color:#ffb15c}.s{color:#b9b4aa;font-size:14px}s{color:#8d887f}';
  const tasks = pv.tasks.length ? `<ul>${pv.tasks.map((t) => `<li>${t.done ? `<s>${esc(t.title)}</s> <span class="s">done</span>` : esc(t.title)}${t.due && !t.done ? ` <span class="s">· ${esc(usDay(t.due))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="s">Nothing listed yet. Your West Peek Productions team adds the work here as it is planned.</p>';
  const assets = pv.assets.length ? `<ul>${pv.assets.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.label)} ↗</a></li>`).join('')}</ul>` : '<p class="s">No files shared here yet.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(name)} · West Peek Productions</title><style>${css}</style></head><body><main><p class="s">West Peek Productions · your project page</p><h1>${esc(name)}</h1><p class="s">This page is private to your organization. Keep the link to yourselves; ask your West Peek Productions lead for a new one at any time.</p><h2>The work</h2>${tasks}<h2>Files and links</h2>${assets}${pv.sample ? '<p class="s">Sample page on a preview: nothing here is real.</p>' : ''}</main></body></html>`;
}
export function portalGone() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>West Peek Productions</title></head><body style="margin:0;background:#0b0b0c;color:#f4f1ea;font:16px/1.5 system-ui,sans-serif"><main style="max-width:640px;margin:0 auto;padding:32px 18px"><h1 style="font-size:24px">This link does not open a project page</h1><p>It may have been replaced with a newer one. Ask your West Peek Productions lead for the current link.</p></main></body></html>';
}

/* ------------------------------------------------------------------ cash, counted correctly */

/**
 * The walk itself: every cash rule in plain words with a worked example, and how many of his own rows
 * it touches (counts only; no figure shows until the walk is done). He marks each right, or writes how
 * it should work. Returns the section, and whether every rule is marked right.
 */
export function rulesWalkSection(pic, ctx) {
  const w = rulesWalk(ctx.view?.settings || ctx.settings || {});
  const touches = { settled: pic.markedOnly.length, apart: pic.forecast.length, once: pic.alreadyInBalance, terms: pic.forecast.length + pic.held.length, late: pic.forecast.filter((f) => f.overdue).length };
  const rows = w.rules.map((r, i) => {
    const pill = r.state === 'right' ? `<span class="d-pill ok">right · ${esc(usDay(isoDay(r.at)))}</span>` : r.state === 'change' ? (r.sent === 'ok' ? '<span class="d-pill wait">sent to Porter</span>' : '<span class="d-pill wait">sending</span>') : '<span class="d-pill">not walked yet</span>';
    const yours = touches[r.id] ? `<p class="d-sub">On your sheet now: ${touches[r.id]} row${touches[r.id] === 1 ? '' : 's'} this rule decides.</p>` : '';
    const where = r.sent === 'ok'
      ? `Sent to Porter${r.sentAt ? ` on ${esc(usDay(isoDay(r.sentAt)))}` : ''}, waiting on the new wording. It comes back here for you to mark right; nothing else to send.`
      : 'Change kept here and still being sent to Porter. The dashboard tries again on its own every 15 minutes; nothing for you to do.';
    const said = r.state === 'change' ? `<p class="d-sub d-gold">You said: ${esc(r.note)}</p><p class="d-sub">${where}</p>` : '';
    const form = ctx.sample ? '<p class="d-sub">Sample mode: the walk is recorded only on your real dashboard.</p>' : `<form class="d-form" method="post" action="/dashboard/cash-rule">${hidden('id', r.id)}
      <div class="d-acts"><button type="submit" name="answer" value="right" class="${r.state === 'right' ? '' : 'd-primary'}" ${r.state === 'right' ? 'disabled' : ''}>That's right</button></div>
      <label for="rule-note-${r.id}">Not right? Say how it should work</label><textarea id="rule-note-${r.id}" name="note" maxlength="1000">${esc(r.state === 'change' ? r.note : '')}</textarea>
      <p><button type="submit" name="answer" value="change">Save how it should work</button></p></form>`;
    return `<li class="d-conn" id="rule-${r.id}"><div class="d-conn__top"><strong>Rule ${i + 1} of ${w.rules.length}</strong>${pill}</div><p>${esc(r.rule)}</p><p class="d-sub">Example: ${esc(r.example)}</p>${yours}${said}${form}</li>`;
  }).join('');
  const head = ctx.sample
    ? '<p class="d-sub">Sample mode: on your real dashboard your figures stay hidden until every rule below is marked right. Here the made-up figures show so you can see the whole page.</p>'
    : w.all
    ?`<p class="d-sub">You walked every rule and marked it right${w.lastAt ? ` (last on ${esc(usDay(isoDay(w.lastAt)))})` : ''}. The figures below follow them.</p>`
    : `<p class="d-sub">${w.right} of ${w.rules.length} marked right. Before any of your money figures show, we walk these together: read each rule and its example, then press That's right, or say how it should work. Your figures stay hidden here until every rule is marked right.</p>`;
  const list = `<ol class="d-list">${rows}</ol>`;
  // Once every rule is marked right, the walk folds shut so the Friday review stays short on a phone.
  const html = w.all && !ctx.sample
    ? sec('walk', 'The cash rules', `<details class="d-fold"><summary><span>Cash rules · all ${w.rules.length} marked right${w.lastAt ? ` on ${esc(usDay(isoDay(w.lastAt)))}` : ''}</span></summary>${head}${list}</details>`)
    : sec('walk', 'The cash rules, walked first', `${head}${list}`);
  return { html, all: w.all || Boolean(ctx.sample) };
}

export function cashRulesSection(pic, ctx) {
  const when = (t) => esc(usDay(isoDay(t)));
  const actual = pic.actual ? `<p class="d-big">${m$(pic.actual.amount)}</p><p class="d-src">Actual: the balance as of ${when(pic.actual.asOf)} (${pic.actual.from === 'cash_tab' ? 'the Opening cash on your Cash tab' : `your ${esc(pic.actual.from)} bank accounts`}).</p>` : `<p>${gap('No actual balance yet: add an Opening cash figure to the Cash tab, or connect your accounting tool.')}</p>`;
  const list = (xs, f) => (xs.length ? `<ul class="d-kv">${xs.map(f).join('')}</ul>` : '');
  const body = `${actual}
    <h3>Forecast, kept apart · next 4 weeks ${m$(pic.forecastNext4)}</h3>${list(pic.forecast.slice(0, 12), (x) => `<li><span>${when(x.at)} · ${esc(x.client || '')} <span class="d-sub">${esc(x.what)}, by ${esc(x.how)}</span></span><span>${m$(x.amount)}</span></li>`) || '<p class="d-sub">Nothing dated to come in.</p>'}
    ${pic.held.length ? `<h3>Waiting on a condition (not in the forecast)</h3>${list(pic.held, (x) => `<li><span>${esc(x.client || '')} · ${esc(x.what)} <span class="d-sub">waits: ${esc(x.waits)}</span></span><span>${m$(x.amount)}</span></li>`)}` : ''}
    ${pic.markedOnly.length ? `<h3>Marked paid, not yet seen in the bank</h3>${list(pic.markedOnly, (x) => `<li><span>${esc(x.client || '')} · ${esc(x.what)}</span><span>${m$(x.amount)}</span></li>`)}<p class="d-sub">Neither cash nor forecast until a Settled on date is entered for it.</p>` : ''}
    ${pic.alreadyInBalance ? `<p class="d-sub">${pic.alreadyInBalance} expected payment${pic.alreadyInBalance === 1 ? ' is' : 's are'} dated on or before the balance date, or ${pic.alreadyInBalance === 1 ? 'is' : 'are'} the same as an open invoice, so ${pic.alreadyInBalance === 1 ? 'it is' : 'they are'} not counted again.</p>` : ''}
    <details class="d-fold"><summary><span>The rules these numbers follow</span></summary><ol class="d-sub">
      <li>"Paid" on a sheet is not cash. An invoice counts as settled only when it has a Settled on (or Cleared, In bank on) date.</li>
      <li>Actual and forecast are two numbers and are never added together.</li>
      <li>A payment dated on or before the balance date is already in the balance, and is not counted again. An expected receipt that matches an open invoice is that invoice, counted once.</li>
      <li>An invoice's expected date follows its payment terms: Net 30 from its issue date, or a condition such as "on delivery" that keeps it out of the dated forecast until it is met.</li>
    </ol><p class="d-sub">You walked and confirmed these at the top of this page. Nothing on this page is live until you say yes.</p></details>`;
  return sec('cashrules', 'Cash: actual and forecast', body);
}
