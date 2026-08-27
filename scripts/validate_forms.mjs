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
 *
 * Registered in package.json (`npm run validate`), in
 * .github/workflows/entity-validation.yml, and in REPO_VALIDATION_MATRIX.md.
 * A validator nobody wired into the gate is a validator that never runs.
 *
 * Usage: node scripts/validate_forms.mjs [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SCAN_ROOTS = ['sites', 'dist'];
const LEAD_HANDLER = path.join(root, 'functions', 'api', 'lead.js');
const SHARED_HANDLER = path.join(root, 'shared', 'assets', 'js', 'forms.js');

const failures = [];
const notes = [];

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

function makeFormStub(successCopy) {
  const status = makeEl('p');
  const button = makeEl('button');
  button.textContent = 'Submit →';
  const form = makeEl('form');
  form.attrs = { action: '/api/lead' };
  if (successCopy) form.attrs['data-success'] = successCopy;
  form.listeners = {};
  form.wasReset = false;
  form.addEventListener = (type, fn) => {
    (form.listeners[type] = form.listeners[type] || []).push(fn);
  };
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

  notes.push(`FORM-7: shared handler driven through ${cases.length} stubbed responses`);
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

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: failures.length === 0, failures, notes }, null, 2));
  } else {
    for (const n of notes) console.log(`  ${n}`);
    if (failures.length) {
      console.error(`\nFORM VALIDATION FAILED - ${failures.length} problem(s):\n`);
      for (const f of failures) console.error(`  [${f.rule}] ${f.where}\n      ${f.message}\n`);
    } else {
      console.log('\nForm validation PASS - every form transmits, every field is named, ' +
        'no success message can appear without a confirmed server response.');
    }
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('validate_forms crashed:', err);
  process.exit(1);
});
