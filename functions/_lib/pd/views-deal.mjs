/**
 * Lead to delivery screens: intake on Inquiries, the record's deal sections, discovery, the pricing
 * builder, the proposal, the work side and the client portal. Phone first at 390px, plain forms,
 * no script (the CSP allows none). Money figures here are Scooter's only; the portal shows none.
 */
import { esc, isoDay, money, usDay, usTime } from './core.mjs';
import { FUNNEL_STAGES, stageOptions } from './data.mjs';
import { CASH_RULES, rulesWalk, CATALOG_STRUCTURE, DISCOVERY_PROFILE, PAY_PLANS, PROPOSAL_STATUS, SERVICE_NAMES, TERMS, discoveryQuestions, quoteMath } from './deal.mjs';
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
  const discLine = disc?.at ? `${Object.keys(disc.answers || {}).length} of ${discoveryQuestions(disc.profile).length} answered · saved ${esc(usTime(disc.at, ctx.now))}` : 'Not started';
  const hold = moneyHold(ctx);
  const qm = q && !q.unreadable ? quoteMath(q) : null;
  const quoteLine = hold ? 'Held' : !q ? 'No quote yet' : q.unreadable ? '<span class="d-red">This quote could not be read back.</span>' : `Floor ${m$(qm.floor)}${qm.unknown.length ? ` + ${qm.unknown.length} unknown` : ''} · your price ${qm.price === null ? gap('not set') : m$(qm.price)}${qm.term ? ` · ${esc(TERMS[qm.term])}` : ''}`;
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
  const files = `<p class="d-row__act d-files"><a class="d-btn" href="/dashboard/find?q=${encodeURIComponent(j.name)}">Documents</a><a class="d-btn" href="${esc(gmail)}" target="_blank" rel="noopener noreferrer">Emails in Gmail ↗</a></p>`;
  return sec('scope', 'Discovery to delivery', steps + files);
}

/* ------------------------------------------------------------------ inquiries, with a researched lead */

export function inquiriesBody(view, ctx, journeysByKey) {
  const rows = [...view.rows.inquiries].reverse().slice(0, 40);
  const list = rows.length ? `<ul class="d-list">${rows.map((r) => {
    const j = journeysByKey[orgOf(r, journeysByKey)];
    const owner = j?.deal?.owner || ctx.intake?.[j?.key]?.owner || '';
    return `<li class="d-row"><div class="d-row__main">${j ? `<a class="d-row__title" href="/dashboard/flow/${encodeURIComponent(j.key)}">${esc(r.org || r.name || 'Inquiry')} ›</a>` : `<span class="d-row__title">${esc(r.org || r.name || 'Inquiry')}</span>`}<span class="d-row__sub">${esc(r.name || '')}${r.email ? ` · ${esc(r.email)}` : ''} · ${dayOr(r.at)}${r.from_site ? ' · your site' : ''}</span>${r.initiative ? `<span class="d-row__sub">Needs: ${esc(String(r.initiative).slice(0, 140))}</span>` : ''}<span class="d-row__sub">Owner: ${owner ? esc(owner) : gap('nobody yet')} · ${j?.deal ? 'in your tracker' : 'not in your tracker yet'}</span></div></li>`;
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

export function renderDiscovery(j, ctx) {
  const saved = ctx.discovery || { profile: {}, answers: {} };
  const deal = j.deal || {};
  const guess = (part) => saved.profile?.[part] || guessFrom(part, deal);
  const profile = Object.fromEntries(Object.keys(DISCOVERY_PROFILE).map((k) => [k, guess(k)]));
  const qs = discoveryQuestions(profile);
  const back = `/dashboard/flow/${encodeURIComponent(j.key)}/discovery`;
  const pickers = `<div class="d-grid2">${Object.entries(DISCOVERY_PROFILE).map(([k, def]) => `<div><label for="dp-${k}">${esc(def.label)}</label><select id="dp-${k}" name="p_${k}"><option value="">Choose…</option>${Object.entries(def.options).map(([v, l]) => `<option value="${v}"${profile[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>`;
  const shape = `<form class="d-form" method="get" action="${back}">${pickers}<p><button type="submit">Show the questions for this</button></p></form>`;
  const answers = `<form class="d-form" method="post" action="/dashboard/discovery">${hidden('key', j.key)}${hidden('back', back)}${Object.entries(profile).map(([k, v]) => hidden(`p_${k}`, v)).join('')}
    ${qs.map((q, i) => `<label for="dq-${q.id}">${i + 1}. ${esc(q.text)}</label><textarea id="dq-${q.id}" name="a_${q.id}" maxlength="2000">${esc(saved.answers?.[q.id] || '')}</textarea>`).join('')}
    <p><button type="submit" class="d-primary">Save answers</button></p><p class="d-sub">Saved with this deal on every device; every save is kept. The quote and proposal start from these answers.</p></form>`;
  const status = ctx.discovery?.at ? `<p class="d-src">Last saved ${esc(usTime(ctx.discovery.at, ctx.now))}</p>` : '<p class="d-sub">Choose what this deal is, then answer what you know. Blank answers are fine; they show what to ask next.</p>';
  return shell(`Discovery · ${j.name}`, `${backTo(j)}<h1>Discovery</h1><p class="d-sub">${esc(j.name)}: the same discipline for every scope. The questions change with the service, the buyer, the objective and the scale.</p>${ctx.flash || ''}${sec('shape', 'What this deal is', shape)}${sec('questions', `Questions · ${qs.length}`, status + answers)}`, ctx);
}
function guessFrom(part, deal) {
  const text = String(part === 'service' ? deal.service || '' : part === 'buyer' ? deal.buyer || '' : '').toLowerCase();
  if (!text) return '';
  const map = part === 'service'
    ? [['activation', /activation|sponsor/], ['events', /event|summit|conference|gathering/], ['brand', /brand|story|identity/], ['web', /web|site|digital/], ['content', /content|video|film|media|photo/]]
    : [['foundation', /foundation|funder|philanthrop/], ['education', /school|college|universit|education/], ['association', /association|member/], ['nonprofit', /nonprofit|non-profit|charity/], ['public', /public|government|agency|city|state/], ['brand', /brand|company|corporate|business/]];
  return (map.find(([, re]) => re.test(text)) || [''])[0];
}

/* ------------------------------------------------------------------ the pricing builder */

export function renderQuote(j, ctx) {
  const back = `/dashboard/flow/${encodeURIComponent(j.key)}/quote`;
  const hold = moneyHold(ctx);
  if (hold) return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1>${ctx.flash || ''}${holdBox(hold)}`, ctx);
  if (ctx.quote?.unreadable) return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1>${errorBox('The last quote could not be read back.', 'It was saved encrypted and the key that opens it is not the one this site has now. Build it again below; nothing else is affected.', back, 'Start again')}`, ctx);
  const q = ctx.quote || { lines: [], price: null, term: 0, months: 1, plan: '', split: '', rationale: '', title: '' };
  const catalog = ctx.catalog || CATALOG_STRUCTURE;
  const wanted = ctx.discovery?.profile?.service;
  const byService = {};
  for (const l of catalog) (byService[l.service] = byService[l.service] || []).push(l);
  const order = [wanted, ...Object.keys(SERVICE_NAMES).filter((s) => s !== wanted && s !== 'team'), 'team'].filter((s, i, a) => s && byService[s] && a.indexOf(s) === i);
  const on = Object.fromEntries(q.lines.map((l) => [l.id, l]));
  const lineRow = (l) => { const x = on[l.id] || {}; return `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(l.line)}</span><span class="d-row__sub">per ${esc(l.unit)} · your rate ${l.cost === null ? gap('unknown: set it on Catalog or here') : esc(money(l.cost))}</span>
    <div class="d-grid2"><div><label for="q-${l.id}">Quantity (${esc(l.unit)}s)</label><input id="q-${l.id}" name="qty_${l.id}" inputmode="decimal" value="${esc(x.qty ?? '')}"></div><div><label for="c-${l.id}">Rate for this quote</label><input id="c-${l.id}" name="cost_${l.id}" inputmode="decimal" value="${esc(x.cost !== undefined && x.cost !== l.cost && x.cost !== null ? x.cost : '')}" placeholder="${l.cost === null ? 'unknown' : 'catalog rate'}"></div></div>
    <label for="m-${l.id}">Cost goes out in month</label><select id="m-${l.id}" name="month_${l.id}"><option value="0"${!x.month ? ' selected' : ''}>Spread over the term</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${Number(x.month) === i + 1 ? ' selected' : ''}>Month ${i + 1}</option>`).join('')}</select></div></li>`; };
  const lines = order.map((s, i) => `<details class="d-fold"${i === 0 || byService[s].some((l) => on[l.id]) ? ' open' : ''}><summary><span>${esc(SERVICE_NAMES[s])} · ${byService[s].filter((l) => on[l.id]).length} chosen</span></summary><ul class="d-list">${byService[s].map(lineRow).join('')}</ul></details>`).join('');
  const m = quoteMath(q);
  const numbers = q.lines.length ? `<ul class="d-kv">
      <li><span><strong>Cost floor</strong><br><span class="d-sub">Everything the work costs you, team time included</span></span><span>${m$(m.floor)}${m.unknown.length ? ` <span class="d-gold">+ unknown</span>` : ''}</span></li>
      ${m.team ? `<li><span>of which team time</span><span>${m$(m.team)}</span></li>` : ''}
      <li><span><strong>Your price</strong><br><span class="d-sub">You choose it. The builder never does.</span></span><span>${m.price === null ? gap('not set') : m$(m.price)}</span></li>
      <li><span><strong>Margin</strong></span><span class="${m.margin?.belowFloor ? 'd-red' : ''}">${!m.margin ? gap('set your price to see it') : `${m$(m.margin.amount)}${m.margin.pct === null ? '' : ` · ${m.margin.pct}%`}${m.margin.atMost ? ' <span class="d-gold">at most (some costs unknown)</span>' : ''}${m.margin.belowFloor ? ' · below your floor' : ''}`}</span></li>
      ${m.term ? `<li><span>${esc(TERMS[m.term])}</span><span>${m.monthly === null ? gap('set your price') : `${m$(m.monthly)} a month for ${m.term} months`}</span></li>` : ''}
    </ul>${m.unknown.length ? `<p class="d-sub d-gold">Unknown costs: ${esc(m.unknown.join(', '))}. The floor above leaves them out, so it is lower than the real floor.</p>` : ''}` : '<p class="d-sub">Choose service lines and quantities below; the floor appears when you save.</p>';
  const timeline = q.lines.length && m.price !== null ? `<ul class="d-kv">${m.timeline.map((t) => `<li><span>Month ${t.month}<br><span class="d-sub">in ${esc(money(t.cashIn)) || '$0'} · out ${esc(money(t.cashOut)) || '$0'}</span></span><span class="${t.position < 0 ? 'd-red' : ''}">${esc(money(t.position)) || '$0'}</span></li>`).join('')}</ul><p class="d-sub">${m.shortMonths.length ? `<span class="d-red">You are out of pocket in month ${m.shortMonths.join(', ')}: costs go out before the client's payments arrive.</span>` : 'Payments arrive ahead of costs in every month.'} Running position on this deal only.</p>` : '<p class="d-sub">Set your price and payment plan to see when payments arrive against when costs go out.</p>';
  const terms = `<div class="d-grid2"><div><label for="q-term">Package</label><select id="q-term" name="term">${Object.entries(TERMS).map(([v, l]) => `<option value="${v}"${String(q.term) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label for="q-months">If one project: how many months it runs</label><input id="q-months" name="months" inputmode="numeric" value="${esc(q.months || 1)}"></div></div>
    <div class="d-grid2"><div><label for="q-plan">Payment plan</label><select id="q-plan" name="plan"><option value="">Choose…</option>${Object.entries(PAY_PLANS).map(([v, l]) => `<option value="${v}"${q.plan === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label for="q-split">Your own split (percent)</label><input id="q-split" name="split" value="${esc(q.split || '')}" placeholder="30/30/20/20"></div></div>`;
  const form = `<form class="d-form" method="post" action="/dashboard/quote">${hidden('key', j.key)}${hidden('back', back)}
    ${sec('lines', 'Service lines', `<p class="d-sub">From your catalog. A line with no rate counts as unknown, never as zero. <a href="/dashboard/catalog">Edit the catalog ›</a></p>${lines}`)}
    ${sec('price', 'Term, price and payment', `${terms}<label for="q-price">Your price (total)</label><input id="q-price" name="price" inputmode="decimal" value="${esc(q.price ?? '')}" placeholder="You decide">`)}
    ${sec('why', 'Value rationale (what the client hears)', `<label for="q-title">Proposal title</label><input id="q-title" name="title" maxlength="160" value="${esc(q.title || '')}" placeholder="Proposal for ${esc(j.name)}"><label for="q-rat">Why this is worth it to them</label><textarea id="q-rat" name="rationale" maxlength="3000">${esc(q.rationale || '')}</textarea><p class="d-sub">Your words. The client sees this and your price, never your costs or margin.</p>`)}
    <p><button type="submit" class="d-primary">Save quote</button></p></form>`;
  const saved = ctx.quote ? `<p class="d-src">Saved ${esc(usTime(ctx.quote._at, ctx.now))}. Every version is kept, encrypted.</p>` : '';
  return shell(`Quote · ${j.name}`, `${backTo(j)}<h1>Quote</h1><p class="d-sub">${esc(j.name)}. Three numbers, kept apart: what it costs you, what you charge, and why it is worth it to them.</p>${ctx.flash || ''}${sec('numbers', 'The numbers', numbers + saved)}${sec('timing', 'When money moves', timeline)}${form}`, ctx);
}

/* ------------------------------------------------------------------ the catalog */

export function renderCatalog(ctx) {
  const hold = moneyHold(ctx);
  if (hold) return shell('Catalog', `<p><a class="d-help" href="/dashboard">← Pipeline</a></p><h1>Service catalog</h1>${ctx.flash || ''}${holdBox(hold)}`, ctx);
  const lines = ctx.catalog || CATALOG_STRUCTURE;
  const row = (l, i) => `<li class="d-row"><div class="d-row__main">${hidden(`id_${i}`, l.id)}<div class="d-grid2"><div><label for="cl-l${i}">Line</label><input id="cl-l${i}" name="line_${i}" maxlength="120" value="${esc(l.line)}"></div><div><label for="cl-s${i}">Service</label><select id="cl-s${i}" name="service_${i}">${Object.entries(SERVICE_NAMES).map(([v, n]) => `<option value="${v}"${l.service === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div><div class="d-grid2"><div><label for="cl-u${i}">Unit</label><input id="cl-u${i}" name="unit_${i}" maxlength="30" value="${esc(l.unit)}"></div><div><label for="cl-c${i}">Your cost rate</label><input id="cl-c${i}" name="cost_${i}" inputmode="decimal" value="${esc(l.cost ?? '')}" placeholder="unknown"></div></div></div></li>`;
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
