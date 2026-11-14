/**
 * Every screen of the Productions dashboard v1.0. Phone first at 390px; server-rendered, no
 * script (the CSP allows none), every action a plain form so it works on any phone.
 * Words are outcome words: never "store", "Agent Log", "Phase 2" or "firm email".
 */
import { ageWords, daysSince, esc, httpsOnly, isoDay, money, num, todayLabel, toTime, usDay, usTime } from './core.mjs';
import { CHOICES, COLD_EMAIL_SENDING, COLD_EMAIL_WEEKLY_CAP, FUNNEL_STAGES, GROUPS, KINDS, STALE_MS, projectName, sheetUrl } from './data.mjs';
import { PROVIDERS } from './providers.mjs';
import { MIN_PASSWORD, SAMPLE_EMAIL, SAMPLE_PASSWORD } from './auth.mjs';

const HELP = '/dashboard/help';
const providerName = (p) => ({ google: 'Google', dropbox: 'Dropbox', docusign: 'DocuSign', quickbooks: 'QuickBooks', xero: 'Xero' }[p] || p);

/* ------------------------------------------------------------------ building blocks */

function link(href, label, cls = '') {
  const h = httpsOnly(href);
  return h ? `<a class="${cls}" href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '';
}
/** Why it is empty + one action + Help. */
export function empty(why, href, label, helpAnchor = '') {
  return `<div class="d-emptybox"><p>${esc(why)}</p>${href ? `<a class="d-btn d-primary" href="${esc(href)}">${esc(label)}</a>` : ''}<a class="d-help" href="${HELP}${helpAnchor ? `#${helpAnchor}` : ''}">What goes here? ›</a></div>`;
}
/** What happened, what is safe, one action. */
export function errorBox(what, safe, href, label) {
  return `<div class="d-errbox" role="alert"><p><strong>${esc(what)}</strong></p><p>${esc(safe)}</p>${href ? `<a class="d-btn" href="${esc(href)}">${esc(label)}</a>` : ''}<a class="d-help" href="${HELP}#states">Help ›</a></div>`;
}
/** "From: Work sheet · Projects, synced 9:40 AM" (+ gold "may be out of date" past 2 hours). */
function source(view, kinds, now) {
  const states = kinds.map((k) => view.sync[k]).filter(Boolean);
  if (!states.length) return '<p class="d-src">Not synced yet.</p>';
  const from = [...new Set(states.map((s) => s.origins).filter(Boolean))].join(' + ') || kinds.map((k) => KINDS[k].tabs?.[0] || k).join(', ');
  const times = states.map((s) => Number(s.synced_at) || 0);
  const oldest = Math.min(...times);
  const failed = states.some((s) => s.status === 'failed');
  const stale = !oldest || now - oldest > STALE_MS;
  return `<p class="d-src">From: ${esc(from)}${oldest ? `, synced ${esc(usTime(oldest, now))}` : ''}${stale ? ' <span class="d-gold">· may be out of date</span>' : ''}${failed ? ' <span class="d-red">· the last sync failed</span>' : ''}</p>`;
}
function sec(id, title, inner, sub = '') {
  return `<section class="d-sec" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(title)}</h2>${sub}${inner}</section>`;
}
function act(action, row, label, back, { primary = false, kind = '' } = {}) {
  return `<form method="post" action="/dashboard/act" class="d-inline"><input type="hidden" name="action" value="${esc(action)}"><input type="hidden" name="row" value="${esc(row)}">${kind ? `<input type="hidden" name="kind" value="${esc(kind)}">` : ''}<input type="hidden" name="back" value="${esc(back)}"><button type="submit" class="${primary ? 'd-primary' : ''}">${esc(label)}</button></form>`;
}
const gap = (t = 'not entered yet') => `<span class="d-gap">${esc(t)}</span>`;
const val = (v) => (v === null || v === undefined || v === '' ? gap() : esc(v));
const dayOr = (v) => (toTime(v) === null ? gap('date not set') : esc(usDay(v)));

function notConnected(ctx, what) {
  if (ctx.sample || ctx.googleConnected) return '';
  return empty(`${what} appear here once Google is connected and your sheets are named. Nothing here is a guess.`, '/dashboard/connections', 'Go to Connections', 'connecting');
}
function noSource(ctx, group, what) {
  if (ctx.sample || !ctx.googleConnected || ctx.sources[group]) return '';
  return empty(`${what} come from your ${GROUPS[group].label.toLowerCase()}. Name it, or let the dashboard create it for you.`, '/dashboard/connections#sheets', 'Name your sheet', 'sheets');
}

/* ------------------------------------------------------------------ page shell */

const CSS = `
@font-face{font-family:'Maax';src:url('/assets/fonts/Maax-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Maax';src:url('/assets/fonts/Maax-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
:root{--ink:#0b0b0c;--ink-2:#141518;--ink-3:#1d1f23;--line:#2c2e33;--copy:#d0d1d4;--muted:#a3a5aa;--white:#fff;--orange:#ff8500;--orange-ink:#1a0d00;--green:#5fd18b;--gold:#f3c94b;--red:#ff7b7b;--red-wash:#3a1616;--gold-wash:#3a3014;--font:'Maax','Helvetica Neue',Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--white);font-family:var(--font);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;padding-bottom:calc(76px + env(safe-area-inset-bottom))}
main{max-width:720px;margin:0 auto;padding:0 16px 24px}
h1{font-size:22px;font-weight:700;margin:0;line-height:1.25}
h2{font-size:18px;font-weight:700;margin:0 0 6px}
h3{font-size:16px;font-weight:700;margin:18px 0 6px}
a{color:var(--orange)}
:focus-visible{outline:3px solid var(--orange);outline-offset:2px;border-radius:6px}
.d-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 0 6px}
.d-brand{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.d-headlinks{display:flex;gap:4px}
.d-headlinks a{color:var(--copy);text-decoration:none;font-size:14px;padding:10px 10px;min-height:44px;display:inline-flex;align-items:center;border-radius:10px}
.d-headlinks a[aria-current]{color:var(--white);background:var(--ink-3)}
.d-sample{background:var(--gold-wash);color:var(--gold);border-radius:10px;padding:8px 12px;margin:6px 0;font-size:14px}
.d-flash{border-radius:10px;padding:10px 12px;margin:10px 0;font-size:15px}
.d-flash--ok{background:#123222;color:var(--green)}
.d-flash--bad{background:var(--red-wash);color:var(--red)}
.d-sub,.d-src{color:var(--muted);font-size:14px;margin:4px 0 8px}
.d-gap{color:var(--gold);font-size:14px}
.d-gold{color:var(--gold)}.d-red{color:var(--red)}
.d-sec{padding:18px 0;border-bottom:1px solid var(--line)}
.d-list{list-style:none;margin:0;padding:0}
.d-row{display:flex;gap:10px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--ink-3)}
.d-row:last-child{border-bottom:0}
.d-row__main{flex:1;min-width:0}
.d-row__title{display:block;overflow-wrap:anywhere}
.d-row__title a{color:var(--white);text-decoration:none}
.d-row__sub{display:block;color:var(--muted);font-size:14px}
.d-row__sub.gold{color:var(--gold)}.d-row__sub.red{color:var(--red)}
.d-row__act{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.d-dot{width:10px;height:10px;border-radius:50%;margin-top:7px;flex:none;background:var(--line)}
.d-dot.gold{background:var(--gold)}.d-dot.red{background:var(--red)}
.d-tick{width:44px;height:44px;min-height:44px;padding:0;border-radius:50%;flex:none;font-size:18px;line-height:1}
.d-inline{display:inline}
button,.d-btn{font:inherit;font-size:15px;min-height:44px;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:var(--ink-2);color:var(--white);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button:disabled{opacity:.55;cursor:not-allowed}
.d-primary{background:var(--orange);border-color:var(--orange);color:var(--orange-ink);font-weight:700}
.d-link{background:none;border:0;color:var(--orange);padding:10px 0;text-decoration:underline}
details.d-fold{border-bottom:1px solid var(--ink-3)}
details.d-fold summary{cursor:pointer;padding:14px 0;min-height:44px;list-style:none;display:flex;justify-content:space-between;gap:8px}
details.d-fold summary::after{content:'›';color:var(--muted)}
details.d-fold[open] summary::after{content:'⌄'}
.d-emptybox,.d-errbox{background:var(--ink-2);border-radius:14px;padding:14px;margin:8px 0;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.d-emptybox p,.d-errbox p{margin:0;color:var(--copy)}
.d-errbox{background:var(--red-wash)}
.d-help{font-size:14px;color:var(--muted);padding:8px 0;min-height:44px;display:inline-flex;align-items:center}
.d-seg{display:flex;gap:6px;margin:8px 0 4px;overflow-x:auto}
.d-seg a{padding:8px 14px;border-radius:999px;border:1px solid var(--line);color:var(--copy);text-decoration:none;min-height:44px;display:inline-flex;align-items:center;white-space:nowrap}
.d-seg a[aria-current]{background:var(--white);color:var(--ink);border-color:var(--white)}
.d-find{display:flex;gap:8px;margin:10px 0}
.d-find input,.d-form input,.d-form select{flex:1;width:100%;font:inherit;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--ink-2);color:var(--white);min-height:44px}
.d-form label{display:block;margin:14px 0 6px}
.d-kv{list-style:none;margin:0;padding:0}
.d-kv li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--ink-3)}
.d-kv li span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.d-big{font-size:30px;font-weight:700;margin:2px 0;font-variant-numeric:tabular-nums}
.d-funnel{list-style:none;margin:6px 0 10px;padding:0;display:grid;gap:4px}
.d-funnel li{display:grid;grid-template-columns:2.2rem 1fr;padding:7px 10px;background:var(--ink-2);border-radius:10px;font-size:15px}
.d-funnel b{font-variant-numeric:tabular-nums}
.d-meter{height:8px;background:var(--ink-3);border-radius:999px;margin:4px 0 12px;overflow:hidden}
.d-meter span{display:block;height:100%;background:var(--orange)}
.d-switch{display:inline-flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.d-switch i{width:36px;height:20px;border-radius:999px;background:var(--ink-3);position:relative;display:inline-block}
.d-switch i::after{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:var(--muted)}
.d-conn{padding:14px 0;border-bottom:1px solid var(--ink-3)}
.d-conn__top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.d-pill{font-size:13px;padding:2px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.d-pill.ok{color:var(--green);border-color:#245c3c}.d-pill.bad{color:var(--red);border-color:#6b2a2a}.d-pill.wait{color:var(--gold);border-color:#6b5a22}
.d-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.d-tabs{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;background:rgba(11,11,12,.97);border-top:1px solid var(--line);padding:6px 6px calc(6px + env(safe-area-inset-bottom))}
.d-tabs a{flex:1;max-width:150px;text-align:center;color:var(--copy);text-decoration:none;padding:8px 4px;border-radius:12px;min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:14px}
.d-tabs a[aria-current]{color:var(--white);background:var(--ink-3)}
.d-tabs b{font-size:12px;min-width:20px;padding:0 6px;border-radius:999px;background:var(--orange);color:var(--orange-ink);margin-top:2px}
.d-tabs b.zero{background:transparent;color:var(--muted)}
.d-login{max-width:420px;margin:8vh auto 0}
.d-login label{display:block;margin:16px 0 6px}
.d-login input[type=email],.d-login input[type=password],.d-login input[type=text]{width:100%;font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--ink-2);color:var(--white);min-height:44px}
.d-login .d-primary,.d-login .d-full{width:100%;margin-top:14px}
.d-check{display:flex;gap:10px;align-items:center;margin:14px 0 0;min-height:44px}
.d-check input{width:22px;height:22px}
.d-or{display:flex;align-items:center;gap:10px;color:var(--muted);margin:22px 0 6px;font-size:14px}
.d-or::before,.d-or::after{content:'';flex:1;height:1px;background:var(--line)}
.d-helpdoc h2{margin-top:26px}
.d-helpdoc li{margin:6px 0}
code{overflow-wrap:anywhere}
.d-helpdoc code{background:var(--ink-3);padding:1px 6px;border-radius:6px;overflow-wrap:anywhere}
@media (max-width:620px){.d-row{flex-wrap:wrap}.d-row__main{flex:1 1 70%}.d-row__act{flex:1 1 100%;justify-content:flex-start;padding-left:20px}.d-row--today{flex-wrap:nowrap;align-items:center}.d-row--today .d-row__main{flex:1 1 auto}.d-row--today .d-row__act{flex:none;flex-wrap:nowrap;justify-content:flex-end;align-items:center;padding-left:0}.d-row--today .d-row__act button,.d-row--today .d-row__act .d-btn{padding:9px 12px;white-space:nowrap}}
@media (min-width:760px){body{font-size:16px}main{padding:0 24px 24px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

export function page(title, body, { tab = null, counts = null, sample = false, signedIn = false, head = '' } = {}) {
  const tabs = signedIn ? `<nav class="d-tabs" aria-label="Dashboard">${[['today', '/dashboard', 'Today'], ['work', '/dashboard/work', 'Work'], ['money', '/dashboard/money', 'Money'], ['agents', '/dashboard/agents', 'Agents']].map(([k, h, l]) => {
    const n = counts?.[k] ?? 0;
    return `<a href="${h}"${tab === k ? ' aria-current="page"' : ''}>${l}<b class="${n ? '' : 'zero'}" aria-label="${n} to look at">${n}</b></a>`;
  }).join('')}</nav>` : '';
  const top = signedIn ? `<header class="d-head"><p class="d-brand">West Peek Productions</p><nav class="d-headlinks" aria-label="Settings"><a href="/dashboard/connections"${tab === 'connections' ? ' aria-current="page"' : ''}>Connections</a><a href="${HELP}"${tab === 'help' ? ' aria-current="page"' : ''}>Help</a></nav></header>${sample ? '<p class="d-sample">Sample mode (preview only): every row here is made up. Nothing is real and nothing reaches a client.</p>' : ''}` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0b0b0c"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="WPP Dashboard"><meta name="apple-mobile-web-app-status-bar-style" content="black"><link rel="manifest" href="/dashboard/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/img/dashboard-icon-180.png"><title>${esc(title)} · West Peek Productions</title><style>${CSS}</style>${head}</head><body><main>${top}${body}</main>${tabs}</body></html>`;
}

export function flashBox(a) {
  if (!a) return '';
  const words = {
    needs_reconnect: 'Google needs reconnecting before this can be saved.',
    row_not_found: 'That row is no longer in your sheet. Refresh to see the latest.',
    row_not_in_sheet: 'That row is no longer in your sheet. Refresh to see the latest.',
    nothing_to_change: 'There was nothing to change on that row.',
    no_status_column: 'Your sheet has no Status column on that tab, so nothing was changed.',
    no_stage_column: 'Your sheet has no Stage column, so nothing was changed.',
    not_confirmed: 'The change was sent but your sheet did not show it when read back. Open the sheet to check.',
    write_failed: 'Your sheet did not accept the change. Nothing was changed.',
    draft_failed: 'Gmail did not create the draft. Nothing was sent.',
    unknown_action: 'That action is not one the dashboard knows.'
  };
  if (a.outcome === 'saved') {
    if (a.action === 'remind') return `<p class="d-flash d-flash--ok" role="status">${a.detail === 'sample_draft' ? 'Sample: a draft would be waiting in Gmail now. Nothing was sent.' : `Draft saved in Gmail, not sent. ${link(a.link, 'Open it in Gmail')}`}</p>`;
    if (String(a.action).startsWith('choice:')) return '<p class="d-flash d-flash--ok" role="status">Saved. You can change it any time.</p>';
    const [value, where] = String(a.detail || '').split('|');
    return `<p class="d-flash d-flash--ok" role="status">Saved and checked: ${esc(value)}${where ? ` in ${esc(where)}` : ''}.</p>`;
  }
  return `<p class="d-flash d-flash--bad" role="alert">${esc(words[a.detail] || 'That did not save. Nothing was changed.')}${a.detail === 'needs_reconnect' ? ' <a href="/dashboard/connections">Reconnect ›</a>' : ''}</p>`;
}

/* ------------------------------------------------------------------ sign-in screens */

export function renderSignIn({ googleReady, message = '', email = '', preview = false, configured = true } = {}) {
  if (!configured) {
    return page('Dashboard', `<div class="d-login"><p class="d-brand">West Peek Productions</p><h1>The dashboard is being switched on</h1><p class="d-sub">It opens as soon as its own database is connected to this site. Nothing is shown until then.</p><a class="d-help" href="${HELP}">Help ›</a></div>`);
  }
  const google = googleReady
    ? `<form method="post" action="/dashboard/google"><label class="d-check"><input type="checkbox" name="remember" value="1" checked> Remember this phone for 30 days</label><button type="submit" class="d-primary">Sign in with Google</button></form>`
    : `<div class="d-emptybox"><p><strong>Google sign-in is not set up yet.</strong> It needs a small Google app in your Productions Workspace; the steps take about ten minutes.</p><a class="d-btn" href="${HELP}#google-app">Show me the steps</a></div><p class="d-sub">Until then, sign in with your email below. A one-time code reaches your work email from "Forgot it?".</p>`;
  return page('Sign in', `<div class="d-login">
    <p class="d-brand">West Peek Productions</p><h1>Your dashboard</h1>
    <p class="d-sub">Today's priorities, your projects, money and agents, from your own Google files.</p>
    ${message ? `<p class="d-flash d-flash--bad" role="alert">${esc(message)}</p>` : ''}
    ${google}
    <p class="d-or">or with your email</p>
    <form method="post" action="/dashboard/login">
      <label for="em">Your email</label><input id="em" name="email" type="email" autocomplete="username" value="${esc(email)}" required>
      <label for="pw">Password or one-time code</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      <label class="d-check"><input type="checkbox" name="remember" value="1" checked> Remember this phone for 30 days</label>
      <button type="submit" class="d-full">Open the dashboard</button>
    </form>
    <p><a class="d-help" href="/dashboard/forgot">Forgot it? Email me a one-time code ›</a></p>
    ${preview ? `<div class="d-sample"><strong>Preview only:</strong> sign in as <code>${esc(SAMPLE_EMAIL)}</code> with <code>${esc(SAMPLE_PASSWORD)}</code> to try the dashboard with made-up rows. This does not exist on the live site.</div>` : ''}
    <p><a class="d-help" href="${HELP}#locked-out">Locked out? ›</a></p></div>`);
}

export function renderChoose({ stage, message = '' }) {
  const first = stage === 'choose';
  return page('Choose your password', `<form class="d-login" method="post" action="/dashboard/password">
    <p class="d-brand">West Peek Productions</p><h1>${first ? 'Choose your own password' : 'Change your password'}</h1>
    <p class="d-sub">${first ? 'The one-time code has been used and will not work again. Choose the password you will use from now on.' : 'This signs you out on every other device.'}</p>
    ${message ? `<p class="d-flash d-flash--bad" role="alert">${esc(message)}</p>` : ''}
    ${first ? '' : '<label for="cur">Your current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>'}
    <label for="np">New password</label><input id="np" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
    <p class="d-sub">At least ${MIN_PASSWORD} characters.</p>
    <label for="np2">The same password again</label><input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
    <button type="submit" class="d-primary">${first ? 'Save it and open the dashboard' : 'Save the new password'}</button>
    ${first ? '' : '<p><a class="d-help" href="/dashboard/connections">← Back</a></p>'}</form>`);
}

export function renderForgot({ sent = false, message = '' } = {}) {
  if (sent) {
    return page('Forgot it?', `<div class="d-login"><p class="d-brand">West Peek Productions</p><h1>Check your work email</h1>
      <p class="d-sub">If that address is the dashboard owner's, a one-time code is on its way to it. It works once; then you choose your own password.</p>
      <p><a class="d-help" href="/dashboard">← Back to sign in</a></p></div>`);
  }
  return page('Forgot it?', `<form class="d-login" method="post" action="/dashboard/forgot">
    <p class="d-brand">West Peek Productions</p><h1>Get a one-time code</h1>
    <p class="d-sub">It goes to the dashboard owner's own work email only, at most once every 5 minutes.</p>
    ${message ? `<p class="d-flash d-flash--bad" role="alert">${esc(message)}</p>` : ''}
    <label for="em">Your work email</label><input id="em" name="email" type="email" autocomplete="username" required>
    <button type="submit" class="d-primary">Email me a one-time code</button>
    <p><a class="d-help" href="/dashboard">← Back to sign in</a></p></form>`);
}

/* ------------------------------------------------------------------ Today */

export function renderToday(view, ctx) {
  const { now, items } = ctx;
  const n = items.length;
  const line1 = `${todayLabel(now)} · ${n ? `${n} need${n === 1 ? 's' : ''} you` : 'nothing needs you'}`;
  const list = items.length
    ? `<ul class="d-list">${items.map((i) => `<li class="d-row d-row--today"><span class="d-dot ${i.tone}" aria-hidden="true"></span><div class="d-row__main"><span class="d-row__title">${esc(i.title)}</span><span class="d-row__sub ${i.tone === 'plain' ? '' : i.tone}">${esc(i.sub)}</span></div><div class="d-row__act">${todayAction(i)}<form method="post" action="/dashboard/tick" class="d-inline"><input type="hidden" name="item" value="${esc(i.key)}"><button type="submit" class="d-tick" aria-label="Done: hide ${esc(i.title)}" title="Done">✓</button></form></div></li>`).join('')}</ul>`
    : (ctx.sample || ctx.googleConnected ? empty('Nothing is overdue or waiting on you. New items show here as soon as your sheets say so.', '/dashboard/work', 'See your projects') : notConnected(ctx, 'Overdue invoices, waiting items, proposals and drafts'));

  const week = view.rows.projects.filter((p) => { const d = daysSince(p.milestone_date, now); return d !== null && d <= 0 && d > -8; });
  const fourWeeks = view.rows.invoices.filter((i) => !/paid/i.test(i.status || '') && (daysSince(i.due, now) ?? -99) > -8);
  const drafts = view.rows.drafts.filter((a) => /^(|waiting|new|to approve)$/i.test(String(a.status || '').trim()));
  // Before Google is connected the folds say so and lead to Connections, never a zero that reads as real.
  const offLine = (what) => `<details class="d-fold"><summary><span>${what} · not connected yet</span></summary><p class="d-sub">This fills in once your Google account is connected.</p><a class="d-help" href="/dashboard/connections">Connect Google ›</a> · <a class="d-help" href="/dashboard/help">What this shows</a></details>`;
  const folds = !ctx.sample && !ctx.googleConnected ? `
    ${offLine('This week')}
    ${offLine('Money')}
    ${offLine('Agents')}` : `
    <details class="d-fold"><summary><span>This week · ${week.length} milestone${week.length === 1 ? '' : 's'}</span></summary>${week.length ? `<ul class="d-list">${week.map((p) => `<li class="d-row"><div class="d-row__main"><a class="d-row__title" href="/dashboard/work/${encodeURIComponent(p._id)}">${esc(p.milestone || 'Milestone')} · ${esc(p.name || p.client || '')}</a><span class="d-row__sub">${dayOr(p.milestone_date)}</span></div></li>`).join('')}</ul>` : '<p class="d-sub">No milestones in the next seven days.</p>'}</details>
    <details class="d-fold"><summary><span>Money · ${fourWeeks.length} invoice${fourWeeks.length === 1 ? '' : 's'} due or late this week</span></summary><p class="d-sub">${fourWeeks.length ? fourWeeks.map((i) => `${esc(i.client || '')} ${esc(money(num(i.amount)))} · ${esc(usDay(i.due))}`).join('<br>') : 'Nothing due this week.'}</p><a class="d-help" href="/dashboard/money">Friday money review ›</a></details>
    <details class="d-fold"><summary><span>Agents · ${drafts.length} draft${drafts.length === 1 ? '' : 's'} to approve · cold email off</span></summary><a class="d-help" href="/dashboard/agents">Open Agents ›</a></details>`;
  const body = `<h1>${esc(line1)}</h1>${source(view, ['invoices', 'waiting', 'deals', 'drafts'], now)}${ctx.flash || ''}
    ${findBox()}
    ${sec('needs', 'Needs you', list)}
    <section class="d-sec" aria-label="This week, money and agents">${folds}</section>
    ${refreshButton(ctx)}`;
  return page('Today', body, { tab: 'today', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}
function todayAction(i) {
  if (i.action === 'reconnect') return `<a class="d-btn d-primary" href="/dashboard/connections">${String(i.key).startsWith('off:') ? 'Connect' : 'Reconnect'}</a>`;
  if (i.action === 'chase') return act('remind', i.rowId, 'Chase', '/dashboard', { primary: true, kind: i.kind });
  if (i.action === 'received') return act('received', i.rowId, 'Mark received', '/dashboard', { primary: true });
  if (i.action === 'approve') return `${i.link ? link(i.link, 'Open', 'd-btn') : ''}${act('approve', i.rowId, 'Approve', '/dashboard', { primary: true })}`;
  return '';
}
function findBox(value = '') {
  return `<form class="d-find" method="get" action="/dashboard/find" role="search"><label class="d-vh" for="fq" style="position:absolute;left:-9999px">Find a document</label><input id="fq" name="q" type="search" placeholder="Find a document" value="${esc(value)}"><button type="submit">Find</button></form>`;
}
function refreshButton(ctx) {
  if (ctx.sample) return '';
  return `<form method="post" action="/dashboard/refresh" class="d-sec"><input type="hidden" name="back" value="/dashboard"><button type="submit">Refresh now</button><p class="d-sub">Syncs on its own every 15 minutes.</p></form>`;
}

/* ------------------------------------------------------------------ Work, client page, deals */

function seg(active) {
  return `<nav class="d-seg" aria-label="Work">${[['projects', '/dashboard/work', 'Projects'], ['deals', '/dashboard/deals', 'Deals'], ['inquiries', '/dashboard/inquiries', 'Inquiries']].map(([k, h, l]) => `<a href="${h}"${active === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}
export function renderWork(view, ctx) {
  const { now } = ctx;
  const projects = view.rows.projects.filter((p) => !/closed|done|complete/i.test(p.status || ''));
  const list = projects.length
    ? `<ul class="d-list">${projects.map((p) => `<li class="d-row"><div class="d-row__main"><a class="d-row__title" href="/dashboard/work/${encodeURIComponent(p._id)}">${esc(p.client || p.name || 'Project')}${p.name && p.client ? ` · ${esc(p.name)}` : ''} ›</a><span class="d-row__sub">${p.milestone ? `${esc(p.milestone)} · ${dayOr(p.milestone_date)}` : 'No next milestone entered'}</span></div></li>`).join('')}</ul>`
    : notConnected(ctx, 'Your projects') || noSource(ctx, 'work', 'Your projects') || empty('No active projects in the Projects tab yet. Add a row with an ID and it shows here on the next sync.', ctx.sources.work ? sheetUrl(ctx.sources.work.spreadsheet_id) : '/dashboard/connections', 'Open the Work sheet', 'projects');
  return page('Work', `<h1>Work</h1>${seg('projects')}${ctx.flash || ''}${findBox()}${sec('projects', `Projects · ${projects.length}`, list, source(view, ['projects'], now))}`, { tab: 'work', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

export function renderClient(view, p, ctx) {
  const { now } = ctx;
  const back = `/dashboard/work/${encodeURIComponent(p._id)}`;
  const waiting = view.rows.waiting.filter((w) => (w.project === p.id || w.project === p._id || w.project === p.name) && !/received|done/i.test(w.status || ''));
  const env = p.sow_envelope ? ctx.settings.envelopes?.[p.sow_envelope] : null;
  const sow = !p.sow_envelope ? gap('no SOW envelope named in the Projects tab') : env ? esc({ completed: 'Signed', sent: 'Sent, not signed yet', delivered: 'Opened, not signed yet', declined: 'Declined', voided: 'Voided', created: 'Not sent yet' }[env.status] || env.status) : ctx.connected.docusign ? gap('not synced yet') : `${gap('connect DocuSign to see it')} <a class="d-help" href="/dashboard/connections">Connect ›</a>`;
  const meeting = ctx.meeting;
  const meetingText = !ctx.googleConnected && !ctx.sample ? gap('connect Google to see it') : !meeting || meeting.none ? 'No meeting with them on your calendar.' : meeting.failed ? '<span class="d-red">Your calendar did not answer just now.</span>' : `${esc(meeting.title)} · ${esc(usTime(meeting.at, now))} ${link(meeting.link, 'Open')}`;
  const deliverables = String(p.deliverables || '').split(/[\s,]+/).map(httpsOnly).filter(Boolean);
  const body = `<p><a class="d-help" href="/dashboard/work">← Work</a></p><h1>${esc(p.client || p.name)}</h1><p class="d-sub">${esc(p.name || '')}${p.status ? ` · ${esc(p.status)}` : ''}</p>${ctx.flash || ''}
  ${sec('docs', 'Documents', `<ul class="d-kv"><li><span>Binder</span><span>${link(p.binder, 'Open') || gap()}</span></li><li><span>Drive folder</span><span>${link(p.folder, 'Open') || gap()}</span></li><li><span>SOW signature</span><span>${sow}</span></li></ul>${deliverables.length ? `<h3>Deliverables</h3><ul class="d-list">${deliverables.map((d, i) => `<li class="d-row">${link(d, `Deliverable ${i + 1}`)}</li>`).join('')}</ul>` : ''}`)}
  ${sec('people', 'People', `<ul class="d-kv"><li><span>Contacts</span><span>${val(p.contacts)}</span></li><li><span>Approval owners</span><span>${val(p.approvers)}</span></li><li><span>Next meeting</span><span>${meetingText}</span></li><li><span>Next milestone</span><span>${val(p.milestone)} · ${dayOr(p.milestone_date)}</span></li></ul>`)}
  ${sec('waiting', `Waiting on them · ${waiting.length}`, waiting.length ? `<ul class="d-list">${waiting.map((w) => { const d = daysSince(w.since, now); const tone = d >= 14 ? 'red' : d >= 7 ? 'gold' : ''; return `<li class="d-row"><span class="d-dot ${tone}" aria-hidden="true"></span><div class="d-row__main"><span class="d-row__title">${esc(w.item)}</span><span class="d-row__sub ${tone}">${d === null ? 'No date entered' : `Waiting ${esc(ageWords(d))}`}</span></div><div class="d-row__act">${act('received', w._id, 'Mark received', back, { primary: true })}${act('remind', w._id, 'Email a reminder (draft)', back, { kind: 'waiting' })}</div></li>`; }).join('')}</ul>` : '<p class="d-sub">Nothing is waiting on them.</p>', source(view, ['projects', 'waiting'], now))}`;
  return page(p.client || 'Client', body, { tab: 'work', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

export function renderDeals(view, ctx) {
  const { now } = ctx;
  const deals = view.rows.deals;
  const funnel = `<ol class="d-funnel">${FUNNEL_STAGES.map((s) => { const n = deals.filter((d) => String(d.stage).toLowerCase() === s.toLowerCase()).length; return `<li><b>${n}</b><span>${esc(s)}</span></li>`; }).join('')}</ol>`;
  const list = deals.length
    ? `<ul class="d-list">${deals.map((d) => { const last = String(d.stage).toLowerCase() === FUNNEL_STAGES.at(-1).toLowerCase(); return `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(d.org || 'Deal')}</span><span class="d-row__sub">${val(d.stage)} · ${val(d.owner)}</span><span class="d-row__sub">${d.next_action ? `${esc(d.next_action)} · ${dayOr(d.next_date)}` : 'No next action entered'}</span></div><div class="d-row__act">${last ? '' : act('stage', d._id, 'Move to next stage', '/dashboard/deals')}</div></li>`; }).join('')}</ul>`
    : notConnected(ctx, 'Your deals') || noSource(ctx, 'work', 'Your deals') || empty('No deals in the Deals tab yet. Add one row per opportunity with its stage.', ctx.sources.work ? sheetUrl(ctx.sources.work.spreadsheet_id) : '/dashboard/connections', 'Open the Work sheet', 'deals');
  const out = deals.filter((d) => d.proposal_sent && !/signed|deposit|handoff/i.test(d.stage || ''));
  const proposals = out.length ? `<ul class="d-list">${out.map((d) => { const late = daysSince(d.follow_up, now) > 0; return `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(d.org)}</span><span class="d-row__sub ${late ? 'red' : ''}">Sent ${esc(usDay(d.proposal_sent))} · follow up ${dayOr(d.follow_up)}</span></div><div class="d-row__act">${late ? act('remind', d._id, 'Chase (draft)', '/dashboard/deals', { kind: 'deals' }) : ''}</div></li>`; }).join('')}</ul>` : '<p class="d-sub">No proposals out.</p>';
  return page('Deals', `<h1>Deals</h1>${seg('deals')}${ctx.flash || ''}${sec('funnel', 'The ten stages', funnel, source(view, ['deals'], now))}${sec('deals', `Deals · ${deals.length}`, list)}${sec('proposals', `Proposals out · ${out.length}`, proposals)}`, { tab: 'work', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

export function renderInquiries(view, ctx) {
  const rows = [...view.rows.inquiries].reverse().slice(0, 30);
  const list = rows.length ? `<ul class="d-list">${rows.map((r) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(r.org || r.name || 'Inquiry')}</span><span class="d-row__sub">${esc(r.name || '')}${r.initiative ? ` · ${esc(r.initiative)}` : ''} · ${dayOr(r.at)}</span></div></li>`).join('')}</ul>`
    : notConnected(ctx, 'Inquiries') || (ctx.sample || ctx.sources.inquiries ? '<p class="d-sub">No inquiries yet.</p>' : empty('Inquiries from your form show here once you name its response sheet. It is read only and never goes into any West Peek network sheet.', '/dashboard/connections#sheets', 'Name the response sheet', 'sheets'));
  return page('Inquiries', `<h1>Inquiries</h1>${seg('inquiries')}${sec('inq', `Newest first · ${view.rows.inquiries.length}`, list, source(view, ['inquiries'], ctx.now))}`, { tab: 'work', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

export function renderFind(found, term, ctx) {
  const list = !term ? '<p class="d-sub">Type part of a file name, for example a project ID.</p>'
    : found.results.length ? `<ul class="d-list">${found.results.map((r) => `<li class="d-row"><div class="d-row__main">${link(r.link, r.name, 'd-row__title')}<span class="d-row__sub">${esc(r.from)}</span></div></li>`).join('')}</ul>`
      : found.searched.length ? `<p class="d-sub">Nothing called "${esc(term)}" in ${esc(found.searched.join(' or '))}.</p>` : empty('Finding documents needs Google (and Dropbox for media) connected.', '/dashboard/connections', 'Go to Connections', 'connecting');
  const failed = found.failed?.length ? errorBox(`${found.failed.join(' and ')} did not answer.`, 'Nothing was changed. The other results are still shown.', '/dashboard/connections', 'Check Connections') : '';
  return page('Find', `<h1>Find a document</h1>${findBox(term)}${failed}${list}`, { tab: 'work', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

/* ------------------------------------------------------------------ Money (Scooter only) */

export function renderMoney(view, ctx) {
  const { now } = ctx;
  const r = view.rows;
  const gate = notConnected(ctx, 'Your money figures') || noSource(ctx, 'money', 'Your money figures');
  if (gate) return page('Money', `<h1>Money</h1><p class="d-sub">Scooter only. Never shown to clients or agents.</p>${gate}`, { tab: 'money', counts: ctx.counts, sample: ctx.sample, signedIn: true });
  const back = '/dashboard/money';
  // 1. Cash now and the 4-week line.
  const acct = view.settings.acct_cash;
  const useAcct = ctx.choices.bank_cash?.value === 'accounting' && acct && acct.amount !== null;
  const weeks = r.cash.filter((c) => toTime(c.week) !== null).sort((a, b) => toTime(a.week) - toTime(b.week)).filter((c) => toTime(c.week) > now - 7 * 86400000).slice(0, 4);
  const cashNow = useAcct ? acct.amount : num(weeks[0]?.opening);
  const cash = `${cashNow === null ? `<p>${gap('Cash now is not entered yet: add an Opening cash figure to the Cash tab, or connect your accounting tool.')}</p>` : `<p class="d-big">${esc(money(cashNow))}</p>`}
    ${weeks.length ? `<ul class="d-kv">${weeks.map((w) => `<li><span>Week of ${esc(usDay(w.week))}</span><span class="${num(w.closing) < 0 ? 'd-red' : ''}">${num(w.closing) === null ? gap() : esc(money(num(w.closing)))}</span></li>`).join('')}</ul>` : `<p class="d-sub">No weeks in the Cash tab yet.</p>`}
    <p class="d-src">${useAcct ? `Cash now from: ${esc(providerName(acct.tool))}, synced ${esc(usTime(acct.at, now))}${now - acct.at > STALE_MS ? ' <span class="d-gold">· may be out of date</span>' : ''}` : ''}</p>${source(view, ['cash'], now)}`;
  // 2. Invoices due.
  const open = r.invoices.filter((i) => !/paid/i.test(i.status || ''));
  const inv = open.length ? `<ul class="d-list">${open.sort((a, b) => (toTime(a.due) ?? 9e15) - (toTime(b.due) ?? 9e15)).map((i) => { const late = daysSince(i.due, now); const tone = late >= 14 ? 'red' : late > 0 ? 'gold' : ''; return `<li class="d-row"><span class="d-dot ${tone}" aria-hidden="true"></span><div class="d-row__main"><span class="d-row__title">${esc(i.client || '')} · ${num(i.amount) === null ? gap('amount not entered') : esc(money(num(i.amount)))}</span><span class="d-row__sub ${tone}">${i.id ? `${esc(i.id)} · ` : ''}due ${dayOr(i.due)}${late > 0 ? ` · ${late} day${late === 1 ? '' : 's'} late` : ''}</span></div><div class="d-row__act">${act('paid', i._id, 'Mark paid', back, { primary: true })}${late > 0 ? act('remind', i._id, 'Send reminder (draft)', back, { kind: 'invoices' }) : ''}</div></li>`; }).join('')}</ul>` : '<p class="d-sub">No open invoices.</p>';
  // 3. Aged receivables.
  const bucket = (test) => open.filter((i) => test(daysSince(i.due, now))).reduce((a, i) => a + (num(i.amount) || 0), 0);
  const aged = `<ul class="d-kv">${[['Not yet due', (d) => d === null || d <= 0], ['1–30 days', (d) => d > 0 && d <= 30], ['31–60 days', (d) => d > 30 && d <= 60], ['Over 60 days', (d) => d > 60]].map(([l, t]) => `<li><span>${l}</span><span>${esc(money(bucket(t)))}</span></li>`).join('')}</ul>`;
  // 4. Expected receipts.
  const receipts = r.receipts.length ? `<ul class="d-kv">${[...r.receipts].sort((a, b) => (toTime(a.date) ?? 9e15) - (toTime(b.date) ?? 9e15)).map((x) => `<li><span>${dayOr(x.date)} · ${esc(x.client || '')}${x.confidence ? ` <span class="d-sub">(${esc(x.confidence)})</span>` : ''}</span><span>${esc(money(num(x.amount)))}</span></li>`).join('')}</ul>` : '<p class="d-sub">No receipts expected.</p>';
  // 5. Vendor obligations, next 4 weeks.
  const vend = r.vendors.filter((v) => { const t = toTime(v.date); return t === null || t <= now + 28 * 86400000; });
  const vendors = vend.length ? `<ul class="d-kv">${vend.map((v) => `<li><span>${dayOr(v.date)} · ${esc(v.vendor || '')}${v.project ? ` <span class="d-sub">${esc(projectName(view, v.project))}</span>` : ''}</span><span>${esc(money(num(v.amount)))}</span></li>`).join('')}</ul>` : '<p class="d-sub">Nothing due to vendors in the next four weeks.</p>';
  // 6. Project margin.
  const margin = r.margin.length ? `<ul class="d-kv">${r.margin.map((m) => { const c = num(m.contract); const k = num(m.costs); const complete = /^(yes|y|true|done|all)$/i.test(String(m.complete || '').trim()); return `<li><span>${esc(projectName(view, m.project))}</span><span>${!complete || c === null || k === null || !c ? gap('incomplete: costs not all entered') : `${Math.round(((c - k) / c) * 100)}%`}</span></li>`; }).join('')}</ul>` : '<p class="d-sub">No projects in the Project margin tab yet.</p>';
  // 7. Tracker vs targets.
  const tracker = r.tracker.length ? r.tracker.map((t) => { const a = num(t.actual); const g = num(t.target); const pct = a !== null && g ? Math.max(0, Math.min(100, Math.round((a / g) * 100))) : 0; return `<p class="d-row__title">${esc(t.measure)} · ${a === null ? gap() : esc(money(a))}${g ? ` of ${esc(money(g))}` : ''}</p><div class="d-meter" role="img" aria-label="${pct}% of target"><span style="width:${pct}%"></span></div>`; }).join('') : '<p class="d-sub">No measures in the Tracker tab yet.</p>';
  const body = `<h1>Money</h1><p class="d-sub">Your Friday review, top to bottom. Scooter only; never shown to clients or agents.</p>${ctx.flash || ''}
    ${sec('cash', 'Cash now and the next 4 weeks', cash)}
    ${sec('invoices', `Invoices due · ${open.length}`, inv, source(view, ['invoices'], now))}
    ${sec('aged', 'Aged receivables', aged, source(view, ['invoices'], now))}
    ${sec('receipts', 'Expected receipts', `${receipts}<p class="d-sub">A promised payment is not collected cash.</p>`, source(view, ['receipts'], now))}
    ${sec('vendors', 'Vendor obligations, next 4 weeks', vendors, source(view, ['vendors'], now))}
    ${sec('margin', 'Project margin', margin, source(view, ['margin'], now))}
    ${sec('tracker', 'Tracker against targets', tracker, source(view, ['tracker'], now))}`;
  return page('Money', body, { tab: 'money', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

/* ------------------------------------------------------------------ Agents */

export function renderAgents(view, ctx) {
  const { now } = ctx;
  const back = '/dashboard/agents';
  const waiting = view.rows.drafts.filter((a) => /^(|waiting|new|to approve)$/i.test(String(a.status || '').trim()));
  const gate = notConnected(ctx, 'Agent drafts and activity') || noSource(ctx, 'work', 'Agent drafts and activity');
  const drafts = gate || (waiting.length ? `<ul class="d-list">${waiting.map((a) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(a.document || 'Draft')}</span><span class="d-row__sub">${esc(a.agent || '')}${a.project ? ` · ${esc(projectName(view, a.project))}` : ''} · ${dayOr(a.drafted)}</span></div><div class="d-row__act">${link(a.link, 'Open', 'd-btn')}${act('approve', a._id, 'Approve', back, { primary: true })}${act('changes', a._id, 'Changes', back)}${act('skip', a._id, 'Skip', back)}</div></li>`).join('')}</ul>` : empty('No drafts are waiting. Agents put drafts in the Agent drafts tab; nothing reaches a client until you approve it.', '', '', 'agents'));
  const activity = [...view.rows.activity].sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0)).slice(0, 30);
  const feed = gate ? '' : activity.length ? `<ul class="d-list">${activity.map((x) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(x.agent || 'An agent')} ${esc(String(x.action || '').toLowerCase())} ${esc(x.document || '')}</span><span class="d-row__sub">${esc(usTime(x.at, now))}${x.project ? ` · ${esc(projectName(view, x.project))}` : ''}${x.approver ? ` · approved by ${esc(x.approver)}` : ''}</span></div></li>`).join('')}</ul>` : '<p class="d-sub">No agent has read or written anything yet.</p>';
  const weekAgo = now - 7 * 86400000;
  const sent = view.rows.cold.filter((c) => (toTime(c.date) ?? 0) >= weekAgo).length;
  const cold = `<p><span class="d-switch" role="switch" aria-checked="${COLD_EMAIL_SENDING}" aria-disabled="true"><i aria-hidden="true"></i> Sending ${COLD_EMAIL_SENDING ? 'on' : 'off'}</span></p><p class="d-sub">${sent} of ${COLD_EMAIL_WEEKLY_CAP} this week. Sending stays off until you give the sending inbox, the target clients, the offer and your go; then it stops at ${COLD_EMAIL_WEEKLY_CAP} a week.</p>${view.rows.cold.length ? `<ul class="d-list">${view.rows.cold.slice(-20).reverse().map((c) => `<li class="d-row"><div class="d-row__main"><span class="d-row__title">${esc(c.org || '')} · ${esc(c.subject || '')}</span><span class="d-row__sub">${dayOr(c.date)} · ${esc(c.status || '')} · ${esc(c.replies || 0)} repl${String(c.replies) === '1' ? 'y' : 'ies'}</span></div></li>`).join('')}</ul>` : '<p class="d-sub">No cold emails have been sent.</p>'}`;
  return page('Agents', `<h1>Agents</h1><p class="d-sub">Agents draft and recommend. Nothing goes to a client without your yes.</p>${ctx.flash || ''}${sec('drafts', `Drafts waiting · ${waiting.length}`, drafts, gate ? '' : source(view, ['drafts'], now))}${sec('activity', 'What agents read and wrote', feed, gate ? '' : source(view, ['activity'], now))}${sec('cold', 'Cold email', cold, gate ? '' : source(view, ['cold'], now))}`, { tab: 'agents', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

/* ------------------------------------------------------------------ Connections */

export function renderConnections(ctx) {
  const { now, connections, ready, choices, sources, sample, origin } = ctx;
  const byP = Object.fromEntries(connections.map((c) => [c.provider, c]));
  const acctChoice = choices.accounting?.value;
  const providers = ['google', 'dropbox', 'docusign', ...(acctChoice === 'quickbooks' || acctChoice === 'xero' ? [acctChoice] : [])];
  const rows = providers.map((p) => {
    const c = byP[p];
    const P = PROVIDERS[p];
    let status; let actions;
    if (sample) { status = '<span class="d-pill">sample: not connected</span>'; actions = '<p class="d-sub">Connections are off in sample mode.</p>'; }
    else if (!ready[p]) { status = '<span class="d-pill wait">not set up yet</span>'; actions = `<p class="d-sub">${esc(providerName(p))} needs a small app of your own first.</p><a class="d-btn" href="${HELP}#app-${p}">Show me the steps</a>`; }
    else if (!c) { status = '<span class="d-pill">not connected</span>'; actions = `<form method="post" action="/dashboard/connect"><input type="hidden" name="provider" value="${p}"><button type="submit" class="d-primary">Connect ${esc(providerName(p))}</button></form>`; }
    else {
      status = c.status === 'ok' ? '<span class="d-pill ok">connected</span>' : '<span class="d-pill bad">needs reconnecting</span>';
      actions = `<div class="d-acts"><form method="post" action="/dashboard/connect"><input type="hidden" name="provider" value="${p}"><button type="submit" class="${c.status === 'ok' ? '' : 'd-primary'}">Reconnect</button></form><form method="post" action="/dashboard/disconnect"><input type="hidden" name="provider" value="${p}"><button type="submit">Disconnect</button></form></div>`;
    }
    const meta = c ? `<p class="d-sub">${c.account ? `${esc(c.account)} · ` : ''}${c.last_sync ? `synced ${esc(usTime(c.last_sync, now))}${now - c.last_sync > STALE_MS ? ' <span class="d-gold">· may be out of date</span>' : ''}` : 'not synced yet'}</p>` : '';
    return `<div class="d-conn"><div class="d-conn__top"><strong>${esc(P.label)}</strong>${status}</div>${meta}<p class="d-sub">Unlocks: ${esc(P.unlocks)}</p>${actions}</div>`;
  }).join('');
  const acctRow = acctChoice === 'sheets' ? '<div class="d-conn"><div class="d-conn__top"><strong>Accounting tool</strong><span class="d-pill">staying in Sheets</span></div><p class="d-sub">Money reads your Money sheet only.</p></div>'
    : !acctChoice ? '<div class="d-conn"><div class="d-conn__top"><strong>Accounting tool</strong><span class="d-pill">choose one first</span></div><p class="d-sub">Pick QuickBooks, Xero or Sheets under Your choices below.</p></div>' : '';

  const sheetRows = Object.entries(GROUPS).map(([g, G]) => {
    const s = sources[g];
    const can = !sample && byP.google?.status === 'ok';
    return `<div class="d-conn"><div class="d-conn__top"><strong>${esc(G.label)}</strong>${s ? '<span class="d-pill ok">named</span>' : '<span class="d-pill">not named yet</span>'}</div>
      ${s ? `<p class="d-sub">${esc(s.title || 'Your sheet')} ${link(sheetUrl(s.spreadsheet_id), 'Open')}</p>` : `<p class="d-sub">${g === 'inquiries' ? 'Your inquiry form\'s response sheet. Read only; it never feeds any West Peek network sheet.' : g === 'money' ? 'Invoices, receipts, vendors, margin, cash and the tracker. Only you see it.' : 'Projects, waiting items, deals, agent drafts and activity.'}</p>`}
      ${can ? `<form class="d-form" method="post" action="/dashboard/source"><input type="hidden" name="group" value="${g}"><label for="src-${g}">${s ? 'Use a different sheet' : 'Paste the sheet\'s link'}</label><div class="d-find"><input id="src-${g}" name="link" type="url" inputmode="url" placeholder="https://docs.google.com/spreadsheets/d/…"><button type="submit">Save</button></div></form>${!s && G.makeTitle ? `<form method="post" action="/dashboard/source/create"><input type="hidden" name="group" value="${g}"><button type="submit" class="d-primary">Create it for me</button></form>` : ''}` : sample ? '' : '<p class="d-sub">Connect Google first.</p>'}</div>`;
  }).join('');

  const choiceRows = Object.entries(CHOICES).map(([k, C]) => {
    const made = choices[k];
    const after = made ? choiceNote(k, made.value) : '';
    return `<div class="d-conn"><div class="d-conn__top"><strong>${esc(C.label)}</strong>${made ? `<span class="d-pill ok">${esc(C.options[made.value])}</span>` : '<span class="d-pill">not chosen yet</span>'}</div>${after ? `<p class="d-sub">${after}</p>` : `<p class="d-sub">${esc(choiceWhy(k))}</p>`}<form method="post" action="/dashboard/choice" class="d-acts"><input type="hidden" name="key" value="${k}">${Object.entries(C.options).map(([v, l]) => `<button type="submit" name="value" value="${v}" ${made?.value === v ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</form></div>`;
  }).join('');

  const body = `<h1>Connections</h1><p class="d-sub">Each account is connected through its own sign-in screen. The dashboard never sees or keeps your passwords, and never a bank login.</p>${ctx.flash || ''}${ctx.tokenKeyMissing ? errorBox('Connections cannot be saved safely right now.', 'Nothing is connected or stored until the site\'s encryption key is in place. Your sheets are untouched.', `${HELP}#help-email`, 'Get help') : ''}
    ${sec('accounts', 'Accounts', rows + acctRow)}
    ${sec('sheets', 'Your sheets', sheetRows, '<p class="d-sub">Your sheets are the source of truth. The dashboard reads them and writes quick actions back to the row.</p>')}
    ${sample ? '' : `<form method="post" action="/dashboard/refresh" class="d-sec"><input type="hidden" name="back" value="/dashboard/connections"><button type="submit">Refresh now</button> <a class="d-help" href="/dashboard/check">Check my numbers ›</a></form>`}
    ${sec('choices', 'Your choices', choiceRows, '<p class="d-sub">Open decisions that are yours. Each one changes only when you press a button.</p>')}
    ${sec('account', 'You', `<div class="d-acts"><a class="d-btn" href="/dashboard/password">Change password</a><form method="post" action="/dashboard/logout"><button type="submit">Sign out</button></form></div><p class="d-sub">Sign out ends this session for good. Your redirect address for app setup is <code>${esc(origin)}/dashboard/oauth/callback</code>.</p>`)}`;
  return page('Connections', body, { tab: 'connections', counts: ctx.counts, sample, signedIn: true });
}
function choiceWhy(k) {
  return {
    accounting: 'Decides which accounting tool, if any, the dashboard reads.',
    bank_cash: 'Cash now comes from one place only. Never your bank login.',
    crm: 'The Deals tab in your Work sheet is a light CRM; a named tool can come later.',
    shared_drive: 'One Google Shared Drive called "West Peek OS" for working documents.',
    agent_seat: 'Agents work from their own Workspace account. It is a paid seat: your yes and your money.',
    developer_view: 'Today the dashboard is yours alone.',
    link: 'Today the dashboard is reached by its link only.'
  }[k];
}
function choiceNote(k, v) {
  const notes = {
    'accounting:quickbooks': 'Connect QuickBooks under Accounts above.', 'accounting:xero': 'Connect Xero under Accounts above.', 'accounting:sheets': 'Money reads your Money sheet only.',
    'bank_cash:accounting': 'Cash now comes from your accounting tool once it is connected.', 'bank_cash:sheet': 'Cash now comes from the Opening cash column of the Cash tab.',
    'crm:sheets': 'Deals are read from, and moved in, the Deals tab.', 'crm:tool': 'Email os@joinwestpeek.com with the tool\'s name; until then the Deals tab stays in use.',
    'shared_drive:yes': 'In Google Drive: Shared drives → New → "West Peek OS". Give each client its own folder inside it, and keep money files in a folder only you can open.', 'shared_drive:not_now': 'Recorded. Documents stay where they are.',
    'agent_seat:yes': 'Recorded. You buy the seat in Google Admin yourself; nothing is bought for you.', 'agent_seat:no': 'Recorded. Agents stay off until there is an account for them.',
    'developer_view:yes': 'Recorded. The view is added as a change on request, and never shows Money.', 'developer_view:no': 'Recorded. The dashboard stays yours alone.',
    'link:hidden': 'Recorded. Reach it at /dashboard and from the home-screen icon.', 'link:footer': 'Recorded. A quiet footer link is added with the next site change.'
  };
  return esc(notes[`${k}:${v}`] || '');
}

/* ------------------------------------------------------------------ check my numbers */

export function renderCheck(result, ctx) {
  const words = { projects: 'Projects', waiting: 'Waiting items', invoices: 'Invoices', cash: 'Cash weeks', cash_line: 'Cash line readable' };
  const body = `<p><a class="d-help" href="/dashboard/connections">← Connections</a></p><h1>Check my numbers</h1><p class="d-sub">What the dashboard shows, against a fresh read of your sheet right now. Counts only.</p>
    <ul class="d-kv">${result.lines.map((l) => `<li><span>${esc(words[l.kind] || l.kind)}${l.min ? ` <span class="d-sub">(at least ${l.min})</span>` : ''}</span><span class="${l.pass ? '' : 'd-gold'}">${l.live === null && l.kind !== 'cash_line' ? 'sheet not read' : l.kind === 'cash_line' ? (l.pass ? 'matches' : 'not yet') : `${l.shown} shown · ${l.live} in sheet`} ${l.pass ? '✓' : ''}</span></li>`).join('')}</ul>
    <p>${result.ok ? '<strong>Everything matches.</strong>' : 'Not everything is in yet. Rows appear after the next sync; press Refresh now on Connections.'}</p>`;
  return page('Check', body, { tab: 'connections', counts: ctx.counts, sample: ctx.sample, signedIn: true });
}

/* ------------------------------------------------------------------ Help */

export function renderHelp({ origin, signedIn = false, counts = null, sample = false }) {
  const cb = `${origin}/dashboard/oauth/callback`;
  const PROD_CB = 'https://westpeekproductions.com/dashboard/oauth/callback';
  const uris = cb === PROD_CB ? `<code>${PROD_CB}</code>` : `<code>${PROD_CB}</code> and <code>${esc(cb)}</code> (add both, so an app set up from the preview keeps working on the live site)`;
  const app = (id, name, steps, secrets) => `<h3 id="app-${id}">${esc(name)}</h3><ol>${steps.map((s) => `<li>${s}</li>`).join('')}<li>Email <a href="mailto:os@joinwestpeek.com">os@joinwestpeek.com</a> two lines, exactly: ${secrets.map((s) => `<code>SECRET ${s}=…</code>`).join(' and ')}. The row on Connections turns to Connect as soon as they are in.</li></ol>`;
  const body = `<div class="d-helpdoc">${signedIn ? '' : '<p class="d-brand" style="margin-top:16px">West Peek Productions</p>'}<h1>Help</h1>
  <p class="d-sub">Everything on one page. Jump to: <a href="#sections">sections</a> · <a href="#change">changing a number</a> · <a href="#connecting">connecting</a> · <a href="#google-app">Google sign-in app</a> · <a href="#agents">agents</a> · <a href="#phone">new phone</a> · <a href="#states">words</a> · <a href="#privacy">privacy</a> · <a href="#help-email">help email</a></p>

  <h2 id="sections">What each section shows, and where it comes from</h2>
  <ul>
   <li><strong>Today</strong>: overdue invoices, client items waiting too long (gold at 7 days, red at 14), proposals past their follow-up date, drafts to approve and any account that stopped syncing. Tick ✓ hides an item; it comes back if it changes.</li>
   <li id="projects"><strong>Work → Projects</strong>: the Projects tab of your Work sheet. Tap a project for its binder, Drive folder, contacts, approval owners, next meeting (your Google Calendar), what the client owes you (the Waiting on client tab), deliverables and SOW signature (DocuSign).</li>
   <li id="deals"><strong>Work → Deals</strong>: the Deals tab, in the ten stages from Relationship identified to Delivery handoff. Proposals out are deals with a Proposal sent date.</li>
   <li><strong>Work → Inquiries</strong>: your inquiry form's response sheet, read only.</li>
   <li><strong>Money</strong>: the Money sheet's tabs (Invoices, Expected receipts, Vendor obligations, Project margin, Cash, Tracker) plus the same-named Finance tabs of each project binder linked in the Projects tab. Cash now can come from QuickBooks or Xero instead (Your choices).</li>
   <li id="agents-src"><strong>Agents</strong>: the Agent drafts, Agent activity and Cold email log tabs of your Work sheet.</li>
   <li>Everything syncs every 15 minutes and when you press <strong>Refresh now</strong>. Each block says when it last synced.</li>
  </ul>

  <h2 id="sheets">Your sheets</h2>
  <p>On Connections, paste each sheet's link, or press <strong>Create it for me</strong> and the dashboard makes the Work or Money sheet in your Google Drive with every tab and column ready. Each row needs a value in its <code>ID</code> column (any short code, like <code>P12</code>); that is how a quick action finds the same row again. Extra columns are fine; the dashboard reads columns by their header.</p>

  <h2 id="change">How to change a number</h2>
  <ul><li>Open the source sheet (every block names it, and Connections links it), change the cell, then press Refresh now.</li><li>Or use the quick action on the row: <strong>Mark received</strong>, <strong>Move to next stage</strong>, <strong>Mark paid</strong>, <strong>Approve</strong>. The dashboard writes it to that row of your sheet, reads it back, and only says "Saved and checked" when the sheet shows it. If it could not, it says so and nothing is assumed.</li><li><strong>Chase</strong> and <strong>Send reminder</strong> put a draft in your Gmail. Nothing is ever sent for you.</li></ul>

  <h2 id="connecting">Connecting, reconnecting and disconnecting</h2>
  <ul>${Object.entries(PROVIDERS).map(([, p]) => `<li><strong>${esc(p.label)}</strong>: ${esc(p.gives)} ${esc(p.never)}</li>`).join('')}</ul>
  <p>Connect opens that service's own sign-in screen; you approve there. <strong>Reconnect</strong> does the same again when a row says "needs reconnecting". <strong>Disconnect</strong> withdraws the access at the service (Google, Dropbox, QuickBooks and Xero) and deletes the dashboard's key for it. For DocuSign, also remove the app under your DocuSign profile → Connected apps. Google's own screen describes its permissions broadly (for example "edit spreadsheets"); the dashboard writes only to the sheets you named, plus the Finance tab of a client binder your Projects tab links when you mark an invoice from that binder paid, and it only creates drafts.</p>

  <h2 id="google-app">Setting up the Google sign-in app (about 10 minutes, once)</h2>
  <ol>
   <li>On a computer, sign in to <a href="https://console.cloud.google.com/" rel="noopener noreferrer" target="_blank">console.cloud.google.com</a> with your Productions Google Workspace account.</li>
   <li>Create a project called <code>West Peek Productions dashboard</code>.</li>
   <li>Open <strong>APIs &amp; Services → OAuth consent screen</strong>. Choose <strong>Internal</strong> (only people in your Workspace can use it). App name <code>West Peek Productions dashboard</code>; support email is yours.</li>
   <li>Open <strong>APIs &amp; Services → Library</strong> and enable: Google Sheets API, Google Drive API, Gmail API, Google Calendar API.</li>
   <li>Open <strong>Credentials → Create credentials → OAuth client ID</strong>. Type: <strong>Web application</strong>. Under Authorized redirect URIs add <code>https://westpeekproductions.com/dashboard/oauth/callback</code>${cb.startsWith('https://westpeekproductions.com') ? '' : ` and <code>${esc(cb)}</code>`}.</li>
   <li>Google shows a Client ID and a Client secret. Email <a href="mailto:os@joinwestpeek.com">os@joinwestpeek.com</a> two lines, exactly: <code>SECRET GOOGLE_OAUTH_CLIENT_ID=…</code> and <code>SECRET GOOGLE_OAUTH_CLIENT_SECRET=…</code></li>
   <li>Then the sign-in screen shows <strong>Sign in with Google</strong>, and Connections shows <strong>Connect Google</strong>. Until then, the emailed one-time code works.</li>
  </ol>
  <h3>The other accounts</h3>
  ${app('dropbox', 'Dropbox', ['Go to <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer">dropbox.com/developers/apps</a> → Create app → Scoped access → Full Dropbox.', 'Permissions tab: tick <code>account_info.read</code> and <code>files.metadata.read</code> only.', `Settings tab: add the redirect URIs ${uris}.`], ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET'])}
  ${app('docusign', 'DocuSign', ['In DocuSign: Settings → Apps and Keys → Add app and integration key.', `Add a secret key, and the redirect URIs ${uris}.`, 'DocuSign reviews new apps before they work on a paid account ("Go-Live"); start it from the same page.'], ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY'])}
  ${app('quickbooks', 'QuickBooks', ['Go to <a href="https://developer.intuit.com/app/developer/dashboard" target="_blank" rel="noopener noreferrer">developer.intuit.com</a> → Create an app → QuickBooks Online and Payments → Accounting.', `Keys &amp; credentials (Production): add the redirect URIs ${uris}.`], ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'])}
  ${app('xero', 'Xero', ['Go to <a href="https://developer.xero.com/app/manage" target="_blank" rel="noopener noreferrer">developer.xero.com/app/manage</a> → New app → Web app.', `Redirect URIs ${uris}.`, 'Generate a secret.'], ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'])}

  <h2 id="agents">What agents may and may not do</h2>
  <ul><li>Agents draft and recommend: meeting notes, client updates, reminders and proposals go into Agent drafts for your Approve, Changes or Skip.</li><li>They never promise a delivery date, change scope, approve spending, send sensitive client data or start a collection step without your approval.</li><li>They never see Money or its sheet.</li><li>Cold email stays off until you give the sending inbox, the targets, the offer and your go; then it stops at 25 a week.</li></ul>

  <h2 id="phone">New phone, home-screen icon, locked out</h2>
  <ul><li><strong>Add to home screen</strong>: open the dashboard in Safari, tap Share → Add to Home Screen. The icon opens it full screen.</li><li><strong>Remember this phone</strong> keeps you signed in on that phone for 30 days. Sign out ends it at once.</li><li><strong>New phone</strong>: open westpeekproductions.com/dashboard and sign in again. Signing out on the old phone, or changing your password, ends its session.</li><li id="locked-out"><strong>Locked out</strong>: after 5 wrong tries the email sign-in rests for 15 minutes. Use "Forgot it?" for a one-time code sent to your own work email (at most one every 5 minutes), or Sign in with Google.</li></ul>

  <h2 id="states">What the words mean</h2>
  <ul><li><strong>may be out of date</strong>: the last good sync was more than 2 hours ago. Press Refresh now; if it stays, reconnect on Connections.</li><li><strong>not entered yet</strong>: the cell is empty in your sheet. Nothing is guessed.</li><li><strong>incomplete: costs not all entered</strong>: a project's Costs complete column is not Yes, so no margin is shown.</li><li><strong>needs reconnecting</strong>: the service stopped accepting the dashboard's access. Reconnect it.</li><li><strong>Sample mode</strong>: preview only, every row made up.</li></ul>

  <h2 id="privacy">Privacy</h2>
  <p>The dashboard is yours alone: no team password, no team view. Money is never shown to clients or agents. Your figures and client names live in your Google files and this site's private database, never in the website's code. Sign-in sessions are kept on the server and end when you sign out. Access keys for your accounts are stored encrypted, and a nightly backup is kept for 30 days in a private place.</p>

  <h2 id="help-email">Help by email</h2>
  <p>Email <a href="mailto:os@joinwestpeek.com">os@joinwestpeek.com</a>. Say which screen, what you pressed, what you expected and what you saw. A screenshot helps. Never include a password.</p>
  ${signedIn ? '' : '<p><a class="d-btn" href="/dashboard">← Sign in</a></p>'}</div>`;
  return page('Help', body, { tab: 'help', counts, sample, signedIn });
}

export function manifest() {
  return JSON.stringify({
    name: 'West Peek Productions dashboard', short_name: 'WPP Dashboard', start_url: '/dashboard', scope: '/dashboard', display: 'standalone',
    background_color: '#0b0b0c', theme_color: '#0b0b0c',
    icons: [{ src: '/assets/img/dashboard-icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/img/dashboard-icon-512.png', sizes: '512x512', type: 'image/png' }]
  });
}

export { isoDay };
