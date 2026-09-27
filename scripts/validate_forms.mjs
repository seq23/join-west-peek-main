/**
 * Form transmission validator.
 *
 * This exists because of a specific, measured failure. The apply form on
 * westpeek.ventures - the only conversion path on the fund's homepage - carried
 * `onsubmit="return false;"`, no action, no method, and not one `name`
 * attribute. Its entire submit handler set the button to a green "Submitted"
 * and reset it three seconds later. There was no fetch, no XMLHttpRequest, no
 * /api/ reference and no third-party form endpoint anywhere in the page. Every
 * founder who applied was thanked and discarded, and nothing in the repo's
 * build, its CI, or its validation matrix would ever have noticed.
 *
 * A build that only proves files were copied cannot catch that. So this asserts
 * the properties that actually matter about a form:
 *
 *   FORM-1  Every data-bearing control inside a transmitting form has a `name`.
 *           Without one the browser omits the value from the request body, so a
 *           form can POST perfectly and still deliver nothing.
 *   FORM-2  Every form either transmits or says in the markup why it does not.
 *   FORM-3  No form suppresses its own submit with onsubmit="return false".
 *   FORM-4  No <input type="file"> without a declared transport. A file input
 *           that drops the file is strictly worse than no file input, because
 *           the founder believes the deck arrived.
 *   FORM-5  Honeypot names are genuinely hidden and never labelled, and no
 *           visible field borrows a honeypot name. The names come from
 *           functions/api/lead.js so the client and server halves cannot drift.
 *   FORM-6  No inline script announces success without making a network call.
 *   FORM-7  The shared handler is driven against a stubbed fetch and must not
 *           show success for any response other than an ok status carrying
 *           {"ok":true}. This one is a behavioural test, not a pattern match.
 *   FORM-8  type="url" fields get https:// prefixed for the visitor, so native
 *           validation cannot refuse a whole submission over a bare domain.
 *   FORM-10 Every transmitting form is in shared/forms-register.json with a
 *           destination, and every registered form whose destination is the
 *           master network sheet is ACTUALLY WIRED to it - the markup posts to
 *           /api/lead, and lead.js genuinely fetches the Network OS door with
 *           the shared secret. The owner's rule (22 Sep 2026) is that adding
 *           people to the sheet is the DEFAULT; an exception is a decision
 *           somebody named on a date, not a form that quietly went nowhere.
 *           A settled exclusion ("excluded_not_ours" - the people filling the
 *           form in are a client's contacts, not West Peek's) is distinguished
 *           in the data from a genuine open item ("pending_decision"), so no
 *           later sweep reads a decision as a gap and wires it.
 *           The previous validator could not have caught that: it proved a form
 *           transmitted, never where to.
 *
 * Registered in package.json (`npm run validate`), in
 * .github/workflows/entity-validation.yml, and in REPO_VALIDATION_MATRIX.md.
 * A validator nobody wired into the gate is a validator that never runs.
 *
 * Usage: node scripts/validate_forms.mjs [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const SCAN_ROOTS = ['sites', 'dist'];
const LEAD_HANDLER = path.join(root, 'functions', 'api', 'lead.js');
const SHARED_HANDLER = path.join(root, 'shared', 'assets', 'js', 'forms.js');
const FORMS_REGISTER = path.join(root, 'shared', 'forms-register.json');

/** The env var names the sites use to reach the Network OS intake door. */
const INTAKE_URL_VAR = 'WP_NETWORK_OS_INTAKE_URL';
const INTAKE_SECRET_VAR = 'WP_NETWORK_OS_INTAKE_SECRET';

const failures = [];
const notes = [];

/**
 * How many individual assertions actually ran and held.
 *
 * A validator that prints "PASS" tells you it did not fail; it does not tell
 * you it did anything. Rule 0 in this house is that no stage may exit 0 having
 * done nothing, so this counts the checks and prints the number, and a change
 * that adds a rule has to move it up.
 */
let passes = 0;
function pass(n = 1) {
  passes += n;
}

function fail(rule, where, message) {
  failures.push({ rule, where, message });
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function htmlFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(abs, acc);
    else if (entry.name.endsWith('.html')) acc.push(abs);
  }
  return acc;
}

/** Attributes of a single tag, lowercased keys, unquoted values. */
function attrsOf(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  let first = true;
  while ((m = re.exec(tag))) {
    if (first) { first = false; continue; } // skip the element name itself
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function lineOf(html, index) {
  return html.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------------------
// The honeypot names, read from the handler that enforces them.
// ---------------------------------------------------------------------------

function honeypotNames() {
  if (!fs.existsSync(LEAD_HANDLER)) {
    fail('FORM-5', rel(LEAD_HANDLER), 'lead handler is missing; cannot read HONEYPOT_FIELDS');
    return [];
  }
  const src = fs.readFileSync(LEAD_HANDLER, 'utf8');
  const m = src.match(/const\s+HONEYPOT_FIELDS\s*=\s*\[([^\]]*)\]/);
  if (!m) {
    fail(
      'FORM-5',
      rel(LEAD_HANDLER),
      'no `const HONEYPOT_FIELDS = [...]` declaration found. The server must state its ' +
        'honeypot names in one place so the forms can be checked against them.'
    );
    return [];
  }
  const names = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  if (!names.length) fail('FORM-5', rel(LEAD_HANDLER), 'HONEYPOT_FIELDS is empty');
  else pass();
  return names;
}

// ---------------------------------------------------------------------------
// HTML rules
// ---------------------------------------------------------------------------

const NON_DATA_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);
const SUCCESS_PHRASE =
  /(submitted|thank you|thanks for|we(?:'|’)?ll be in touch|message sent|received\b|success)/i;

function isHidden(attrs) {
  if ((attrs.type || '').toLowerCase() === 'hidden') return true;
  if ('hidden' in attrs) return true;
  const style = (attrs.style || '').replace(/\s+/g, '').toLowerCase();
  return style.includes('display:none') || style.includes('visibility:hidden');
}

/**
 * A form's identity for register purposes: the site it lives on plus the value
 * of its hidden lead_type / lead_source field. Keyed this way so a form and its
 * built copy in dist/ resolve to the same register row - the alternative,
 * keying on the file path, would need every row listed twice and would drift.
 */
function formIdentity(file, formHtml) {
  const rp = rel(file);
  const site = (rp.match(/^(?:sites|dist)\/([^/]+)\//) || [])[1] || '';
  const named =
    (formHtml.match(/name\s*=\s*["'](?:lead_type|lead_source)["'][^>]*value\s*=\s*["']([^"']+)["']/i) || [])[1] ||
    (formHtml.match(/value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["'](?:lead_type|lead_source)["']/i) || [])[1] ||
    '';
  return { site, form: named };
}

const observedForms = [];

function checkForm(file, html, formHtml, formIndex, hp) {
  const where = `${rel(file)}:${lineOf(html, formIndex)}`;
  const openTag = formHtml.match(/<form[^>]*>/i)[0];
  const formAttrs = attrsOf(openTag);

  // FORM-3 - a form that cancels its own submit and does nothing else.
  if (/return\s*(?:false|!1)/i.test(formAttrs.onsubmit || '')) {
    fail(
      'FORM-3',
      where,
      'form suppresses its own submit with onsubmit="' +
        formAttrs.onsubmit +
        '". Remove it and submit through a real handler.'
    );
  }

  const optedOut = 'data-no-transmit' in formAttrs;
  if (optedOut && !String(formAttrs['data-no-transmit']).trim()) {
    fail('FORM-2', where, 'data-no-transmit must carry a reason, not be empty.');
  }

  const action = (formAttrs.action || '').trim();
  const hasAction = action && action !== '#' && !/^javascript:/i.test(action);
  const sharedHandler = 'data-westpeek-form' in formAttrs;

  // FORM-2 - it transmits, or it says why not.
  if (!optedOut && !sharedHandler && !hasAction) {
    fail(
      'FORM-2',
      where,
      'form has no transmitting path: no data-westpeek-form, no usable action. ' +
        'Wire it to an endpoint, or mark it data-no-transmit="<reason>" if it is ' +
        'genuinely client-side only.'
    );
  }
  if (sharedHandler && !hasAction) {
    fail('FORM-2', where, 'data-westpeek-form is present but action is missing or unusable.');
  }
  if (sharedHandler && !/data-form-status/.test(formHtml)) {
    fail(
      'FORM-2',
      where,
      'data-westpeek-form with no [data-form-status] element: the visitor would get ' +
        'no success and no failure, which is how a silent drop looks.'
    );
  }

  // Which ids carry a visible <label for="...">?
  const labelled = new Set(
    [...formHtml.matchAll(/<label[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  );

  const controls = [...formHtml.matchAll(/<(input|textarea|select)\b[^>]*>/gi)];
  for (const c of controls) {
    const tag = c[1].toLowerCase();
    const a = attrsOf(c[0]);
    const type = (a.type || 'text').toLowerCase();
    const shown = c[0].replace(/\s+/g, ' ').slice(0, 110);

    // FORM-4 - a file input has to say where the bytes go.
    if (tag === 'input' && type === 'file') {
      const transport = a['data-file-transport'] || formAttrs['data-file-transport'] || '';
      if (!String(transport).trim()) {
        fail(
          'FORM-4',
          where,
          '<input type="file"> with no data-file-transport. This repo has no storage ' +
            'binding (no wrangler.toml, no wrangler.jsonc, no R2/KV/D1 anywhere) and ' +
            '/api/lead is a JSON/form-field email relay that cannot carry a file. ' +
            'Either declare the transport, or ask for a link instead. ' + shown
        );
      }
    }

    pass(); // FORM-4 held for this control
    if (tag === 'input' && NON_DATA_INPUT_TYPES.has(type)) continue;

    // FORM-1 - no name, no value in the request body.
    if (!('name' in a) || !String(a.name).trim()) {
      if (!optedOut) {
        fail(
          'FORM-1',
          where,
          `<${tag}> has no name attribute, so the browser will omit it from the ` +
            `submission entirely. ${shown}`
        );
      }
      continue;
    }

    pass(); // FORM-1 held for this control
    // FORM-5 - honeypots hidden, real fields not named like honeypots.
    if (hp.includes(a.name)) {
      if (!isHidden(a)) {
        fail(
          'FORM-5',
          where,
          `field "${a.name}" is one of the server's honeypot names ` +
            `(${hp.join(', ')}) but is visible. Anything a human is asked to fill in ` +
            `must never be a name the server discards. ${shown}`
        );
      }
      if (a.id && labelled.has(a.id)) {
        fail(
          'FORM-5',
          where,
          `honeypot "${a.name}" has a <label for="${a.id}">. A labelled trap is a trap ` +
            'for humans and assistive technology, not for bots.'
        );
      }
      pass(); // FORM-5 held for this honeypot
      if (String(a.tabindex) !== '-1') {
        fail(
          'FORM-5',
          where,
          `honeypot "${a.name}" is missing tabindex="-1", so a keyboard user can still ` +
            'tab into it and have their submission silently dropped.'
        );
      }
    }
  }

  if (!optedOut) {
    const identity = formIdentity(file, formHtml);
    observedForms.push({ ...identity, where, action, sharedHandler });

    // FORM-11 - the ventures deck forms (Scooter, 27 Sep 2026) ask for the deck
    // last, right before Submit, so a founder fills in everything else first.
    if (identity.site === 'ventures' && (identity.form === 'founder_apply' || identity.form === 'founder_pitch')) {
      const dataControls = controls
        .map((c) => attrsOf(c[0]))
        .filter((a) => (a.type || 'text').toLowerCase() !== 'hidden')
        .filter((a) => !hp.includes(a.name));
      const last = dataControls[dataControls.length - 1];
      pass();
      if (!last || (last.name !== 'deck_file' && last.name !== 'deck')) {
        fail(
          'FORM-11',
          where,
          `ventures form "${identity.form}" must end with the deck field (link or PDF) right before ` +
            `Submit; last data-bearing field was "${last && last.name}".`
        );
      }
    }
  }

  pass(); // FORM-2/FORM-3 held for this form
  return { optedOut, sharedHandler, hasAction };
}

/** FORM-6 - an inline script that celebrates without calling anything. */
function checkInlineScripts(file, html, anyTransmittingForm) {
  if (!anyTransmittingForm) return;
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    const attrs = attrsOf('<script' + b[1] + '>');
    const type = (attrs.type || '').toLowerCase();
    if (type.includes('json')) continue;
    if (attrs.src) continue;
    const body = b[2];
    const transmits = /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|\.submit\s*\(\s*\))/.test(body);
    pass(); // FORM-6 examined this inline script
    if (transmits) continue;

    // Only literals that are actually written into the page count, so a comment
    // explaining the old bug does not trip the rule that replaced it.
    const written = [
      ...body.matchAll(
        /\.(?:textContent|innerText|innerHTML|value)\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g
      )
    ].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const literal of written) {
      if (SUCCESS_PHRASE.test(literal)) {
        fail(
          'FORM-6',
          `${rel(file)}:${lineOf(html, b.index)}`,
          `inline script writes "${literal}" but makes no network call. A success ` +
            'message the server never confirmed is the exact bug this validator exists for.'
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FORM-7 - drive the real shared handler against a stubbed fetch.
// ---------------------------------------------------------------------------

function makeEl(tag) {
  return {
    tag,
    attrs: {},
    children: [],
    disabled: false,
    textContent: '',
    get firstChild() {
      return this.children.length ? this.children[0] : null;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attrs ? this.attrs[k] : null;
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    querySelector() {
      return null;
    },
    text() {
      return this.children
        .map((c) => (c.nodeText !== undefined ? c.nodeText : c.text()))
        .join('');
    }
  };
}

function loadSharedHandler(fetchStub) {
  const src = fs.readFileSync(SHARED_HANDLER, 'utf8');
  const documentStub = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeText: String(t) })
  };
  const shim = {};
  class FormDataStub {
    constructor(form) {
      this.form = form;
    }
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'document',
    'fetch',
    'FormData',
    'globalThis',
    `${src}\nreturn globalThis.WestPeekForms;`
  );
  const api = factory(documentStub, fetchStub, FormDataStub, shim);
  if (!api || typeof api.wire !== 'function') {
    fail(
      'FORM-7',
      rel(SHARED_HANDLER),
      'shared handler does not expose globalThis.WestPeekForms.wire, so its success ' +
        'guard cannot be proven. Restore the export.'
    );
    return null;
  }
  return api;
}

function makeUrlInputStub() {
  const input = makeEl('input');
  input.type = 'url';
  input.value = '';
  input.listeners = {};
  input.addEventListener = (type, fn) => {
    (input.listeners[type] = input.listeners[type] || []).push(fn);
  };
  input.fire = (type, event) => {
    for (const fn of input.listeners[type] || []) fn(event || {});
  };
  return input;
}

function makeFormStub(successCopy) {
  const status = makeEl('p');
  const button = makeEl('button');
  button.textContent = 'Submit →';
  const urlInput = makeUrlInputStub();
  const form = makeEl('form');
  form.attrs = { action: '/api/lead' };
  if (successCopy) form.attrs['data-success'] = successCopy;
  form.listeners = {};
  form.wasReset = false;
  form.urlInput = urlInput;
  form.addEventListener = (type, fn) => {
    (form.listeners[type] = form.listeners[type] || []).push(fn);
  };
  form.querySelectorAll = (sel) => (sel.includes('type="url"') ? [urlInput] : []);
  form.querySelector = (sel) => {
    if (sel.includes('data-form-status')) return status;
    if (sel.includes('submit')) return button;
    return null;
  };
  form.reset = () => {
    form.wasReset = true;
  };
  form.status = status;
  form.button = button;
  form.submit = () => {
    for (const fn of form.listeners.submit || []) fn({ preventDefault() {} });
  };
  return form;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function checkSharedHandlerBehaviour() {
  if (!fs.existsSync(SHARED_HANDLER)) {
    fail('FORM-7', rel(SHARED_HANDLER), 'shared submit handler is missing');
    return;
  }
  const SUCCESS_COPY = 'Received. Validator success copy.';
  const where = rel(SHARED_HANDLER);

  const cases = [
    {
      name: 'ok status with {"ok":true}',
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
      expect: 'ok'
    },
    {
      name: '200 carrying {"ok":false}',
      fetch: () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'x' }) }),
      expect: 'error'
    },
    {
      name: '503 delivery_not_configured',
      fetch: () =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ ok: false, error: 'delivery_not_configured' })
        }),
      expect: 'error'
    },
    {
      name: '502 delivery_failed',
      fetch: () =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ ok: false, error: 'delivery_failed' })
        }),
      expect: 'error'
    },
    {
      name: 'ok status with unparseable body',
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }),
      expect: 'error'
    },
    {
      name: 'network error',
      fetch: () => Promise.reject(new Error('offline')),
      expect: 'error'
    }
  ];

  for (const c of cases) {
    let calls = 0;
    const api = loadSharedHandler(() => {
      calls += 1;
      return c.fetch();
    });
    if (!api) return;
    const form = makeFormStub(SUCCESS_COPY);
    api.wire(form);
    form.submit();

    // Before the response lands, nothing may look like success.
    if (form.status.getAttribute('data-state') !== 'pending') {
      fail('FORM-7', where, `[${c.name}] status is not "pending" while the request is in flight`);
    }
    if (!form.button.disabled) {
      fail('FORM-7', where, `[${c.name}] submit button is not disabled while sending`);
    }
    if (SUCCESS_PHRASE.test(form.status.text())) {
      fail(
        'FORM-7',
        where,
        `[${c.name}] a success phrase was shown before the server answered: "${form.status.text()}"`
      );
    }
    // A double-click must not fire a second request.
    form.submit();
    if (calls !== 1) {
      fail('FORM-7', where, `[${c.name}] re-entrant submit fired ${calls} requests, expected 1`);
    }

    await tick();
    await tick();

    const state = form.status.getAttribute('data-state');
    const text = form.status.text();

    if (state !== c.expect) {
      fail('FORM-7', where, `[${c.name}] expected data-state "${c.expect}", got "${state}" (${text})`);
    }
    if (c.expect === 'ok') {
      if (text !== SUCCESS_COPY) {
        fail('FORM-7', where, `[${c.name}] expected the form's data-success copy, got "${text}"`);
      }
      if (!form.wasReset) fail('FORM-7', where, `[${c.name}] form was not reset after success`);
    } else {
      if (SUCCESS_PHRASE.test(text)) {
        fail(
          'FORM-7',
          where,
          `[${c.name}] failure was reported with success wording: "${text}". The server ` +
            'did not confirm receipt.'
        );
      }
      if (!/@/.test(text)) {
        fail('FORM-7', where, `[${c.name}] failure message gives no fallback address: "${text}"`);
      }
      if (form.wasReset) {
        fail(
          'FORM-7',
          where,
          `[${c.name}] form was reset on a failure, discarding what the visitor typed`
        );
      }
    }
    if (form.button.disabled) {
      fail('FORM-7', where, `[${c.name}] submit button left disabled after the request settled`);
    }
    if (form.button.textContent !== 'Submit →') {
      fail(
        'FORM-7',
        where,
        `[${c.name}] submit button label not restored: "${form.button.textContent}"`
      );
    }
  }

  pass(cases.length);
  notes.push(`FORM-7: shared handler driven through ${cases.length} stubbed responses`);
}

/**
 * FORM-8 - type="url" must not cost a submission.
 *
 * The deck-link and website fields are type="url" so the browser validates
 * them, but native validation runs BEFORE any submit event, so a founder who
 * types "acme.com" would have the whole form refused over a missing scheme -
 * on an optional field. The shared handler prefixes https:// for them. If that
 * ever stops working, type="url" quietly becomes a conversion tax, which is a
 * subtler version of the bug this file exists for.
 */
async function checkUrlNormalisation() {
  const where = rel(SHARED_HANDLER);
  const expectations = [
    { typed: 'acme.com', want: 'https://acme.com' },
    { typed: '  acme.com/deck  ', want: 'https://acme.com/deck' },
    { typed: 'https://acme.com', want: 'https://acme.com' },
    { typed: 'HTTP://acme.com', want: 'HTTP://acme.com' },
    { typed: 'mailto:a@b.com', want: 'mailto:a@b.com' },
    { typed: '', want: '' },
    { typed: 'not a url', want: 'not a url' }
  ];

  for (const trigger of ['blur', 'enter']) {
    for (const e of expectations) {
      const api = loadSharedHandler(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
      );
      if (!api) return;
      const form = makeFormStub('ok');
      api.wire(form);
      form.urlInput.value = e.typed;
      if (trigger === 'blur') form.urlInput.fire('blur');
      else form.urlInput.fire('keydown', { key: 'Enter' });
      if (form.urlInput.value !== e.want) {
        fail(
          'FORM-8',
          where,
          `[${trigger}] typed ${JSON.stringify(e.typed)} -> expected ` +
            `${JSON.stringify(e.want)}, got ${JSON.stringify(form.urlInput.value)}`
        );
      }
    }
  }

  pass(expectations.length * 2);
  notes.push(
    `FORM-8: url normalisation checked over ${expectations.length} inputs x 2 triggers`
  );
}

// ---------------------------------------------------------------------------
// FORM-10 - the register, and the wiring it claims.
// ---------------------------------------------------------------------------

async function checkFormsRegister() {
  const where = rel(FORMS_REGISTER);
  let leadGate = null;
  try {
    const imported = await import(pathToFileURL(LEAD_HANDLER).href);
    if (typeof imported.writesToSheet === 'function' && typeof imported.siteForHost === 'function') leadGate = imported;
    else fail('FORM-10', rel(LEAD_HANDLER), 'lead.js does not export siteForHost and writesToSheet, so which properties reach the sheet cannot be proven by execution.');
  } catch (err) {
    fail('FORM-10', rel(LEAD_HANDLER), `lead.js could not be imported to prove its sheet gate: ${err.message}`);
  }
  if (!fs.existsSync(FORMS_REGISTER)) {
    fail('FORM-10', where, 'shared/forms-register.json is missing. Every transmitting form must declare where its people go.');
    return;
  }

  let register;
  try {
    register = JSON.parse(fs.readFileSync(FORMS_REGISTER, 'utf8'));
  } catch (err) {
    fail('FORM-10', where, `forms register is not valid JSON: ${err.message}`);
    return;
  }

  const rows = Array.isArray(register.forms) ? register.forms : [];

  // HARD FAIL ON ZERO. A register that lists nothing would pass every other
  // assertion below by vacuous truth, which is exactly the "runs but inert"
  // defect this rule exists to make impossible.
  if (!rows.length) {
    fail('FORM-10', where, 'the forms register lists zero forms. A register with nothing in it proves nothing.');
    return;
  }
  pass();

  if (!observedForms.length) {
    fail('FORM-10', where, 'no transmitting form was found in sites/ or dist/. Either the sites lost their forms or the scan is broken; both are emergencies.');
    return;
  }
  pass();

  const local = rows.filter((row) => row.repo === 'join-west-peek-main');
  const registered = new Map(local.map((row) => [`${row.site}\u0000${row.form}`, row]));

  // (a) Every transmitting form in this repo is in the register.
  const seen = new Set();
  for (const observed of observedForms) {
    if (!observed.form) {
      fail(
        'FORM-10',
        observed.where,
        'transmitting form carries no hidden lead_type or lead_source field, so it cannot be ' +
          'identified in the register. Give it one - an unnameable form is an untrackable ' +
          'destination.'
      );
      continue;
    }
    const key = `${observed.site}\u0000${observed.form}`;
    seen.add(key);
    const row = registered.get(key);
    if (!row) {
      fail(
        'FORM-10',
        observed.where,
        `form "${observed.form}" on the ${observed.site} site is not in ${rel(FORMS_REGISTER)}. ` +
          'Every transmitting form declares its destination: "sheet" (the default) or an ' +
          'exception with a reason, a namer and a date.'
      );
      continue;
    }
    pass();

    // (b) A row that claims the sheet must actually post through lead.js.
    if (row.destination === 'sheet') {
      if (observed.action !== '/api/lead') {
        fail(
          'FORM-10',
          observed.where,
          `form "${observed.form}" is registered as reaching the master network sheet, but its ` +
            `action is "${observed.action}" rather than /api/lead, which is the only handler ` +
            'wired to the intake door. The register would be describing something untrue.'
        );
      } else {
        pass();
      }
    }
  }

  // (c) Every registered local row corresponds to a form that exists.
  for (const row of local) {
    if (!seen.has(`${row.site}\u0000${row.form}`)) {
      fail(
        'FORM-10',
        where,
        `register lists "${row.form}" on the ${row.site} site, but no transmitting form with that ` +
          'lead_type/lead_source was found in sites/ or dist/. A register that names forms which ' +
          'no longer exist rots into fiction.'
      );
    } else {
      pass();
    }
  }

  // (d) Every non-sheet row carries a real reason, not a shrug.
  for (const row of rows) {
    if (row.destination === 'sheet' || row.destination === 'intake_queue') continue;
    if (!['excluded_not_ours', 'pending_decision', 'named_stop', 'own_store', 'no_form'].includes(row.destination)) {
      fail('FORM-10', where, `row "${row.repo}/${row.form}" has unknown destination "${row.destination}".`);
      continue;
    }
    if (!String(row.reason || '').trim()) {
      fail('FORM-10', where, `row "${row.repo}/${row.form}" is a ${row.destination} with no reason. An exception nobody justified is a gap nobody noticed.`);
      continue;
    }
    if (['excluded_not_ours', 'pending_decision', 'named_stop'].includes(row.destination) && (!String(row.named_by || '').trim() || !String(row.date || '').trim())) {
      fail(
        'FORM-10',
        where,
        `row "${row.repo}/${row.form}" is a ${row.destination} without named_by and date. The owner's rule is that ` +
          'an exception is recorded at the time of the ask, by a named person, on a date.'
      );
      continue;
    }

    // An `excluded_not_ours` row is SETTLED. It is marked so explicitly, so no
    // future sweep can read it as work left undone. The owner's rule: a form
    // belongs in the master network sheet only when the people filling it in
    // are West Peek's own contacts; a client-service property's submissions
    // belong to the client. That is a decision, not a gap.
    if (row.destination === 'excluded_not_ours' && row.settled !== true) {
      fail(
        'FORM-10',
        where,
        `row "${row.repo}/${row.form}" is excluded_not_ours but is not marked "settled": true. A ` +
          'principled exclusion must say so in the data, or the next sweep will read it as an ' +
          'unwired form and try to close it.'
      );
      continue;
    }
    pass();
  }

  // The register must carry the rule that decides scope, or the reasoning
  // leaves with whoever wrote the rows.
  if (!/client-service/i.test(String(register.scope_rule || ''))) {
    fail('FORM-10', where, 'the register has no scope_rule explaining WHEN a form belongs in the sheet. Without it, the next person has only a list of verdicts and no way to judge a new property.');
  } else {
    pass();
  }

  // (d2) THE GATE, EXECUTED, IN BOTH DIRECTIONS.
  //
  // Reading lead.js for a hostname list would prove only that the letters are
  // present. This imports the real decision and runs it against every row's
  // host: a row registered as reaching the sheet must be a host that writes,
  // and - the direction that actually protects client data - a row registered
  // as excluded must be a host that does NOT.
  if (leadGate) {
    for (const row of local) {
      if (!row.host) continue;
      const writes = leadGate.writesToSheet(row.host);
      const shouldWrite = row.destination === 'sheet';
      if (writes !== shouldWrite) {
        fail(
          'FORM-10',
          where,
          shouldWrite
            ? `"${row.form}" is registered as reaching the master network sheet, but lead.js does not ` +
              `write for host ${row.host}. The register would be promising something the code refuses.`
            : `"${row.form}" on ${row.host} is registered as ${row.destination}, but lead.js WOULD write ` +
              'it to the sheet. These are a client-service property\'s people; sending them to West ' +
              "Peek's network sheet is the exact harm this category exists to prevent."
        );
      } else {
        pass();
      }
      if (leadGate.siteForHost(row.host) !== row.site) {
        fail('FORM-10', where, `register row "${row.form}" says site "${row.site}" but lead.js resolves host ${row.host} to "${leadGate.siteForHost(row.host)}".`);
      } else {
        pass();
      }
    }

    // An unrecognised host must never write. Fail closed.
    if (leadGate.writesToSheet('some-host-nobody-registered.example')) {
      fail('FORM-10', rel(LEAD_HANDLER), 'an unrecognised host writes to the sheet. The default must be no write: wrongly storing a client is worse than a missing row a log will show.');
    } else {
      pass();
    }
  }

  // (e) THE WIRING, not the prose. lead.js must genuinely reach the door.
  if (!fs.existsSync(LEAD_HANDLER)) {
    fail('FORM-10', rel(LEAD_HANDLER), 'lead handler is missing; the sheet default cannot be wired.');
    return;
  }
  const handler = fs.readFileSync(LEAD_HANDLER, 'utf8');
  const wiring = [
    [new RegExp(`env\\.${INTAKE_URL_VAR}`), `lead.js never reads env.${INTAKE_URL_VAR}, so it cannot know where the intake door is.`],
    [new RegExp(`env\\.${INTAKE_SECRET_VAR}`), `lead.js never reads env.${INTAKE_SECRET_VAR}, so the door would refuse every call.`],
    [/x-wp-network-os-intake-secret/i, 'lead.js does not send the shared secret header the door requires.'],
    [/submission_id/, 'lead.js sends no submission_id, so a retry could write the person twice.'],
    [/fetch\s*\(/, 'lead.js makes no fetch call at all.']
  ];
  for (const [pattern, message] of wiring) {
    if (!pattern.test(handler)) fail('FORM-10', rel(LEAD_HANDLER), message);
    else pass();
  }

  // The sheet result has to be legible to a test and to a human reading logs.
  if (!/sheet/.test(handler)) {
    fail('FORM-10', rel(LEAD_HANDLER), 'lead.js reports no `sheet` outcome. A sheet write that fails silently is the bug this whole change exists to prevent.');
  } else {
    pass();
  }

  const sheetRows = rows.filter((row) => row.destination === 'sheet').length;
  const excluded = rows.filter((row) => row.destination === 'excluded_not_ours').length;
  const pending = rows.filter((row) => row.destination === 'pending_decision').length;
  const namedStops = rows.filter((row) => row.destination === 'named_stop').length;
  notes.push(
    `FORM-10: ${rows.length} register row(s) - ${sheetRows} to the sheet, ${excluded} settled exclusion(s), ` +
      `${pending} pending decision(s), ${namedStops} named stop(s); ${observedForms.length} ` +
      'transmitting form occurrence(s) in sites//dist/'
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const hp = honeypotNames();
  notes.push(`honeypot names read from ${rel(LEAD_HANDLER)}: ${hp.join(', ') || '(none)'}`);

  let fileCount = 0;
  let formCount = 0;

  for (const dir of SCAN_ROOTS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) {
      notes.push(`${dir}/ not present, skipped`);
      continue;
    }
    for (const file of htmlFiles(abs)) {
      const html = fs.readFileSync(file, 'utf8');
      fileCount += 1;
      let anyTransmitting = false;
      for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
        formCount += 1;
        const r = checkForm(file, html, m[0], m.index, hp);
        if (!r.optedOut) anyTransmitting = true;
      }
      checkInlineScripts(file, html, anyTransmitting);
    }
  }

  notes.push(`scanned ${formCount} form(s) across ${fileCount} HTML file(s) in ${SCAN_ROOTS.join('/, ')}/`);

  await checkSharedHandlerBehaviour();
  await checkUrlNormalisation();
  await checkFormsRegister();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: failures.length === 0, failures, notes, checks_passed: passes }, null, 2));
  } else {
    for (const n of notes) console.log(`  ${n}`);
    if (failures.length) {
      console.error(`\nFORM VALIDATION FAILED - ${failures.length} problem(s):\n`);
      for (const f of failures) console.error(`  [${f.rule}] ${f.where}\n      ${f.message}\n`);
    } else {
      console.log(`\nForm validation PASS - ${passes} checks passed. Every form transmits, ` +
        'every field is named, no success message can appear without a confirmed ' +
        'server response.');
    }
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('validate_forms crashed:', err);
  process.exit(1);
});
