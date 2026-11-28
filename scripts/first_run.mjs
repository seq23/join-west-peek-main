#!/usr/bin/env node
/**
 * first-run: plays a visitor's first session on a deployed copy of one of the
 * three sites and fails loudly when the Google Analytics 4 setup is wrong.
 *
 *   npm run first-run -- --url https://<branch>.<project>.pages.dev [--url …]
 *   (or FIRST_RUN_URL; a value may list several URLs, separated by
 *   " · ", commas or spaces)
 *
 * For each URL it:
 *   1. reads the homepage and tells which site it is from its GA4 ID;
 *   2. loads EVERY page in that site's sitemap (plus the 404 page) from the
 *      given host and fails on a non-200, a page without exactly one gtag.js
 *      tag with that site's ID, a GTM container or another site's ID, a
 *      missing events script, or a placeholder (lorem ipsum, TODO, {{…}});
 *   3. runs the DEPLOYED wp-analytics.js and forms.js (fetched from the host)
 *      against every link and button on those pages: each CTA the site
 *      declares must be found and send exactly one event whose only parameter
 *      is page_path, and a form's own submit button must send nothing;
 *   4. submits each tracked form through the deployed forms.js against a
 *      stubbed /api/lead: success sends exactly one form event, failure none.
 *
 * Nothing here posts to the real /api/lead or sends a hit to Google.
 * Prints one line starting `FIRST_RUN OK` when every step passed; exits 1 on
 * any failure.
 */
import vm from "node:vm";

const SITES = {
  "G-17BHLS1RWJ": "productions",
  "G-X0CDKY3DXT": "community",
  "G-Y7371XLG0L": "ventures",
};
// CTAs that must exist on the deployed pages today. The community homepage's
// "Submit Update" button left with The Update section (its six tiles, 27 Nov
// 2026); The Update stays in the nav. Give and Take's "See who you can help"
// takes its place. Productions' named CTAs
// arrive with its new build (held for launch), so there they are checked
// wherever they appear rather than required.
const REQUIRED_CTAS = {
  community: ["cta_join_community", "cta_view_episodes", "cta_give_and_take", "cta_pitch_competition", "cta_workshops"],
  ventures: ["cta_submit_company", "cta_join_community"],
  productions: [],
};

// A value may carry several URLs: the West Peek OS passes one --url per job
// with every site's preview joined by " · ", others use commas or spaces.
// Every http(s) URL in the value is taken; anything else in it is ignored.
const urlsIn = (value) => String(value || "").match(/https?:\/\/[^\s,·]+/g) || [];
const urls = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--url" && process.argv[i + 1]) urls.push(...urlsIn(process.argv[++i]));
  else if (process.argv[i].startsWith("--url=")) urls.push(...urlsIn(process.argv[i].slice(6)));
}
if (!urls.length) urls.push(...urlsIn(process.env.FIRST_RUN_URL));
urls.splice(0, urls.length, ...new Set(urls));
if (!urls.length) {
  console.error("FIRST_RUN FAIL no URL: pass --url <preview> or set FIRST_RUN_URL");
  process.exit(1);
}

const failures = [];
const summary = [];

async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "west-peek-first-run" } });
  return { status: res.status, url: res.url, text: await res.text() };
}

/** Links and buttons on a page, as { tag, type, text, inForm }. */
function controls(html) {
  const out = [];
  const forms = [];
  for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) forms.push([m.index, m.index + m[0].length]);
  const inForm = (i) => forms.some(([a, b]) => i > a && i < b);
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const type = (m[2].match(/\btype=["']([^"']+)["']/i) || [, ""])[1];
    const text = m[3].replace(/<[^>]+>/g, " ").replace(/&rarr;|&nbsp;|&amp;|&[a-z]+;/gi, " ");
    out.push({ tag: m[1].toUpperCase(), type, text, inForm: inForm(m.index) });
  }
  for (const m of html.matchAll(/<input\b([^>]*\btype=["'](?:submit|button)["'][^>]*)>/gi)) {
    const type = (m[1].match(/\btype=["']([^"']+)["']/i) || [, ""])[1];
    const value = (m[1].match(/\bvalue=["']([^"']*)["']/i) || [, ""])[1];
    out.push({ tag: "INPUT", type, text: value, inForm: inForm(m.index) });
  }
  return out;
}

/** A small DOM stand-in, enough for the deployed wp-analytics.js and forms.js. */
function makeWorld(site, pathname) {
  const listeners = {};
  const dataLayer = [];
  const scriptTag = { getAttribute: (n) => (n === "data-site" ? site : null) };
  const document = {
    readyState: "complete",
    currentScript: scriptTag,
    head: { appendChild() {} },
    querySelector: (sel) => (sel.includes("data-wp-analytics") ? scriptTag : null),
    querySelectorAll: () => [],
    createElement: () => fakeEl("DIV"),
    createTextNode: (t) => ({ textContent: String(t) }),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: (ev) => { for (const fn of listeners[ev.type] || []) fn(ev); return true; },
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  class FormData { constructor() {} }
  const ctx = {
    document, CustomEvent, FormData, dataLayer, URLSearchParams, URL, Promise, console,
    location: { pathname, hostname: "first-run.invalid", search: "?email=a%40b.c", hash: "#x" },
    gtag: function () { dataLayer.push(Array.from(arguments)); },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return { ctx: vm.createContext(ctx), dataLayer, listeners };
}

function fakeEl(tag, attrs = {}, extra = {}) {
  const a = { ...attrs };
  const handlers = {};
  return {
    tagName: tag, textContent: "", value: "", hidden: false, disabled: false, children: [],
    parentNode: { insertBefore() {} },
    getAttribute: (n) => (n in a ? a[n] : null),
    setAttribute: (n, v) => { a[n] = String(v); },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    get firstChild() { return null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    reset() {},
    focus() {},
    _fire: (t, ev) => handlers[t] && handlers[t](ev),
    ...extra,
  };
}

async function checkSite(base) {
  const origin = new URL(base).origin;
  const home = await get(`${origin}/`);
  if (home.status !== 200) { failures.push(`${origin}/ answered ${home.status}`); return; }
  const id = Object.keys(SITES).find((k) => home.text.includes(`gtag/js?id=${k}`));
  if (!id) { failures.push(`${origin}/ carries none of the three GA4 tags`); return; }
  const site = SITES[id];

  const sitemap = await get(`${origin}/sitemap.xml`);
  const paths = new Set(["/"]);
  for (const m of sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)) paths.add(new URL(m[1]).pathname);
  if (paths.size < 2) failures.push(`${site}: sitemap.xml lists no pages`);

  const pages = [];
  const loaded = new Set();
  const load = async (p, linkedFrom) => {
    if (loaded.has(p)) return;
    loaded.add(p);
    const page = p === "/" ? home : await get(origin + p);
    if (page.status !== 200) { failures.push(`${site} ${p}: HTTP ${page.status}${linkedFrom ? ` (linked from ${linkedFrom})` : ""}`); return; }
    pages.push({ path: p, html: page.text });
  };
  for (const p of paths) await load(p);
  // Pages kept out of the sitemap (noindex) are still pages: follow every
  // same-site page link once. Function-served private screens are skipped.
  for (const { path: from, html } of [...pages]) {
    for (const m of html.matchAll(/href=["'](\/[^"'#?]*)/g)) {
      const p = m[1];
      if (/^\/(assets|api|dashboard|portal|cdn-cgi)(\/|$)|\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith(".html")) continue;
      await load(p, from);
    }
  }
  const nf = await get(`${origin}/first-run-no-such-page-${Date.now()}`);
  if (nf.status !== 404) failures.push(`${site}: a missing page answered ${nf.status}, not 404`);
  pages.push({ path: "/404", html: nf.text });

  const otherIds = Object.keys(SITES).filter((k) => k !== id);
  for (const { path: p, html } of pages) {
    const loaders = (html.match(/googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)/g) || []);
    if (loaders.length !== 1 || !loaders[0].endsWith(id)) failures.push(`${site} ${p}: ${loaders.length} gtag.js tag(s), expected exactly one with ${id}`);
    if ((html.match(/gtag\(\s*["']config["']/g) || []).length !== 1) failures.push(`${site} ${p}: not exactly one gtag config call`);
    if (/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html)) failures.push(`${site} ${p}: a GTM container is present`);
    for (const o of otherIds) if (html.includes(o)) failures.push(`${site} ${p}: carries another site's ID ${o}`);
    if (!/data-wp-analytics[^>]*data-site="/.test(html)) failures.push(`${site} ${p}: the events script is not loaded`);
    // Google Analytics only (Scooter, 19 Nov 2026: "Remove Microsoft Clarity and leave other tracking off").
    if (/clarity\.ms|data-clarity-loader/.test(html)) failures.push(`${site} ${p}: Microsoft Clarity is present`);
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "");
    if (/lorem ipsum|\bTODO\b|\{\{[A-Z_]+\}\}/i.test(visible)) failures.push(`${site} ${p}: placeholder text`);
  }

  const analyticsJs = await get(`${origin}/assets/js/wp-analytics.js`);
  const formsJs = await get(`${origin}/assets/js/forms.js`);
  if (analyticsJs.status !== 200) { failures.push(`${site}: /assets/js/wp-analytics.js answered ${analyticsJs.status}`); return; }
  if (formsJs.status !== 200) { failures.push(`${site}: /assets/js/forms.js answered ${formsJs.status}`); return; }

  // 3. Every link and button on every page, through the deployed script.
  const seen = new Set();
  let clicks = 0;
  for (const { path: p, html } of pages) {
    const world = makeWorld(site, p);
    vm.runInContext(analyticsJs.text, world.ctx);
    for (const c of controls(html)) {
      const el = fakeEl(c.tag, c.type ? { type: c.type } : {}, { textContent: c.text, value: c.text });
      el.closest = (sel) => (sel === "form" ? (c.inForm ? {} : null) : el);
      const before = world.dataLayer.length;
      world.ctx.document.dispatchEvent({ type: "click", target: el });
      const sent = world.dataLayer.slice(before);
      const isSubmit = c.inForm && (c.tag === "INPUT" ? c.type === "submit" : c.tag === "BUTTON" && (c.type === "submit" || !c.type));
      if (isSubmit && sent.length) failures.push(`${site} ${p}: the submit button "${c.text.trim()}" sent ${sent[0][1]}`);
      if (sent.length > 1) failures.push(`${site} ${p}: one click on "${c.text.trim()}" sent ${sent.length} events`);
      for (const ev of sent) {
        clicks += 1;
        seen.add(ev[1]);
        const keys = Object.keys(ev[2] || {});
        if (ev[0] !== "event" || keys.length !== 1 || keys[0] !== "page_path" || ev[2].page_path !== p) {
          failures.push(`${site} ${p}: ${ev[1]} carried ${JSON.stringify(ev[2])}, expected only page_path "${p}"`);
        }
      }
    }
  }
  for (const name of REQUIRED_CTAS[site]) if (!seen.has(name)) failures.push(`${site}: no link or button on the site sends ${name}`);

  // 4. Form events: success only, through the deployed forms.js.
  const world = makeWorld(site, "/");
  vm.runInContext(analyticsJs.text, world.ctx);
  const forms = vm.runInContext("WestPeekAnalytics.forms", world.ctx)[site] || {};
  let formChecks = 0;
  for (const [leadType, eventName] of Object.entries(forms)) {
    for (const ok of [true, false]) {
      world.ctx.fetch = () => Promise.resolve({ ok, status: ok ? 200 : 502, json: () => Promise.resolve(ok ? { ok: true } : { ok: false, error: "delivery_failed" }) });
      vm.runInContext(formsJs.text, world.ctx);
      const hidden = { value: leadType };
      const form = fakeEl("FORM", { "data-westpeek-form": "" }, {
        querySelector: (sel) => (sel.includes('name="lead_type"') ? hidden : sel.includes("data-form-status") ? fakeEl("P") : null),
      });
      world.ctx.WestPeekForms.wire(form);
      const before = world.dataLayer.length;
      form._fire("submit", { preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
      const sent = world.dataLayer.slice(before).filter((e) => e[0] === "event");
      const want = ok ? 1 : 0;
      if (sent.length !== want || (ok && sent[0][1] !== eventName)) {
        failures.push(`${site}: ${leadType} ${ok ? "success" : "failure"} sent ${JSON.stringify(sent.map((e) => e[1]))}, expected ${ok ? eventName : "nothing"}`);
      } else if (ok && Object.keys(sent[0][2]).join() !== "page_path") {
        failures.push(`${site}: ${eventName} carried ${JSON.stringify(sent[0][2])}`);
      }
      formChecks += 1;
    }
  }
  summary.push(`${site} ${id} pages=${pages.length} cta_events=${[...seen].sort().join("|") || "none"} clicks=${clicks} form_checks=${formChecks}`);
}

for (const u of urls) {
  try { await checkSite(u); } catch (e) { failures.push(`${u}: ${e.message}`); }
}
if (failures.length) {
  console.error(`FIRST_RUN FAIL ${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`FIRST_RUN OK ${summary.join(" ; ")}`);
