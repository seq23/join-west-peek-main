/**
 * The one submit handler for every West Peek form.
 *
 * The rule this file exists to enforce: a visitor is told their submission was
 * received ONLY when the server said so. Not when the request was dispatched,
 * not when the button was clicked, not when a timer expired. The homepage of
 * westpeek.ventures used to turn its button green on click with no network
 * call anywhere on the page, so every founder who applied was thanked and
 * dropped; the guard below is the fix for that class of bug, and
 * scripts/validate_forms.mjs drives this file against a stubbed fetch to prove
 * the guard still holds.
 *
 * Success requires BOTH:
 *   - an HTTP-ok response, AND
 *   - a JSON body whose `ok` is exactly true.
 * /api/lead answers {"ok":true} on delivery and a non-2xx JSON error otherwise,
 * so the second half is belt-and-braces against a future handler that returns
 * 200 with an error body. Anything else - a 503 because Resend is not
 * configured, a 502 because delivery failed, a network error, unparseable JSON
 * - shows the visitor a real failure and an address they can email instead.
 *
 * Opt in with `data-westpeek-form` on the <form>. Optional attributes:
 *   action              POST target (default /api/lead)
 *   data-success        success copy (default below)
 *   data-fallback-email address shown on failure (default below)
 *   data-success-panel  present: on success, replace the form with a visible
 *                       thank-you panel instead of a one-line status. Empty or
 *                       "true" replaces the <form> itself; a selector replaces
 *                       that container (e.g. the whole multi-step wizard).
 *   data-success-title  the panel's heading (default "Thank you")
 *   data-bot-check      "turnstile": ask GET /api/lead for the public site key
 *                       and, when there is one, render an interaction-only
 *                       Cloudflare Turnstile widget whose token rides in the
 *                       form's FormData. No key, nothing loads.
 *   data-success-link / data-success-link-label
 *                       an optional button under the panel copy
 */
(function () {
  'use strict';

  var DEFAULT_ACTION = '/api/lead';
  var DEFAULT_SUCCESS = 'Received. We’ll reply soon.';
  // Ventures forms override this with data-fallback-email="info@westpeek.ventures"
  // (Scooter, 22 Sep 2026: no personal address as the public backup line), and
  // community forms with data-fallback-email="os@joinwestpeek.com" (the West
  // Peek OS inbox, 28 Sep 2026 - scripts/validate_community_site.mjs pins it).
  // The default is the firm inbox too (Scooter, 18 Nov 2026: no personal address public).
  var DEFAULT_FALLBACK_EMAIL = 'info@westpeek.ventures';

  function status(form) {
    return form.querySelector('[data-form-status]');
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setPending(form, text) {
    var el = status(form);
    if (!el) return;
    clear(el);
    el.setAttribute('data-state', 'pending');
    el.appendChild(document.createTextNode(text));
  }

  /**
   * The server delivered the message but not the file (it could not confirm a person sent it, so
   * it never opened the upload). Say so, and give the address to send the deck to.
   */
  function deckNote(form, tagName) {
    var address = form.getAttribute('data-fallback-email') || DEFAULT_FALLBACK_EMAIL;
    var note = document.createElement(tagName);
    note.setAttribute('data-deck-note', '');
    note.appendChild(document.createTextNode(' Your deck did not come through with it, so please email it to '));
    var link = document.createElement('a');
    link.setAttribute('href', 'mailto:' + address);
    link.appendChild(document.createTextNode(address));
    note.appendChild(link);
    note.appendChild(document.createTextNode('.'));
    return note;
  }

  function setSuccess(form, deckMissing) {
    var el = status(form);
    if (!el) return;
    clear(el);
    el.setAttribute('data-state', 'ok');
    el.appendChild(
      document.createTextNode(form.getAttribute('data-success') || DEFAULT_SUCCESS)
    );
    if (deckMissing) el.appendChild(deckNote(form, 'span'));
    showSuccessPanel(form, deckMissing);
  }

  /**
   * The Update on joinwestpeek.com answered a submission with one small grey
   * line under the Submit button (28 Sep 2026). A form that took three minutes
   * to fill in deserves a panel the visitor cannot miss: the form (or the
   * whole wizard around it) goes away and a heading, the success copy and an
   * optional button take its place. Only runs when the server confirmed the
   * submission - this is called from setSuccess and nowhere else - and only
   * for forms that opt in with data-success-panel. DOM nodes, never innerHTML.
   */
  function showSuccessPanel(form, deckMissing) {
    var target = form.getAttribute('data-success-panel');
    if (target === null) return;
    var container = form;
    if (target && target !== 'true' && typeof document.querySelector === 'function') {
      container = document.querySelector(target) || form;
    }
    var parent = container.parentNode;
    if (!parent || typeof parent.insertBefore !== 'function') return;

    var panel = document.createElement('div');
    panel.className = 'wp-form-thanks';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('tabindex', '-1');
    var tag = document.createElement('p');
    tag.className = 'wp-form-thanks__tag';
    tag.appendChild(document.createTextNode('Received'));
    var heading = document.createElement('h2');
    heading.appendChild(document.createTextNode(form.getAttribute('data-success-title') || 'Thank you'));
    var copy = document.createElement('p');
    copy.appendChild(document.createTextNode(form.getAttribute('data-success') || DEFAULT_SUCCESS));
    panel.appendChild(tag);
    panel.appendChild(heading);
    panel.appendChild(copy);
    if (deckMissing) panel.appendChild(deckNote(form, 'p'));
    var href = form.getAttribute('data-success-link');
    if (href) {
      var link = document.createElement('a');
      link.className = 'wpc-btn';
      link.setAttribute('href', href);
      link.appendChild(document.createTextNode(form.getAttribute('data-success-link-label') || 'Back to West Peek'));
      panel.appendChild(link);
    }
    parent.insertBefore(panel, container);
    container.hidden = true;
    container.setAttribute('hidden', '');
    if (typeof panel.focus === 'function') panel.focus();
  }

  /**
   * Tells the page a submission was CONFIRMED, for the GA4 form events in
   * wp-analytics.js (17 Nov 2026). Called only from the success guard below.
   * The signal carries the form's lead_type and nothing else - never a field
   * value - and a failure never sends it.
   */
  function announceSuccess(form) {
    try {
      if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
      if (typeof CustomEvent !== 'function') return;
      var input = form.querySelector('input[name="lead_type"], input[name="lead_source"]');
      var leadType = input ? String(input.value || '') : '';
      document.dispatchEvent(new CustomEvent('westpeek:form-success', { detail: { lead_type: leadType } }));
    } catch (e) { /* analytics must never break a confirmed submission */ }
  }

  /**
   * A failure has to be legible and actionable, so it names a real address and
   * makes it clickable. Built from DOM nodes rather than innerHTML so nothing
   * on the page can inject markup through the status line.
   */
  function setError(form, lead) {
    var el = status(form);
    if (!el) return;
    var address = form.getAttribute('data-fallback-email') || DEFAULT_FALLBACK_EMAIL;
    clear(el);
    el.setAttribute('data-state', 'error');
    el.appendChild(
      document.createTextNode(lead + ' Please try again — if you’re still having trouble, email ')
    );
    var link = document.createElement('a');
    link.setAttribute('href', 'mailto:' + address);
    link.appendChild(document.createTextNode(address));
    el.appendChild(link);
    el.appendChild(document.createTextNode(' and we will pick it up from there.'));
  }

  /**
   * `type="url"` gives us real validation on the deck-link and website fields,
   * but on its own it refuses "acme.com" and blocks the entire submit over a
   * missing scheme - on fields that are optional. That would trade real deal
   * flow for a prefix, which is the wrong side of the low-friction constraint.
   *
   * So we put the scheme on for them, before the browser gets to judge: on
   * blur, and on Enter, because native constraint validation runs before any
   * submit event and a founder who types the domain and hits Enter never
   * reaches our handler at all.
   */
  function normalizeUrlField(input) {
    var value = String(input.value || '').trim();
    if (!value) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return; // already has a scheme
    if (value.indexOf('.') === -1) return; // not domain-shaped; leave it alone
    input.value = 'https://' + value.replace(/^\/+/, '');
  }

  function wireUrlFields(form) {
    var inputs = form.querySelectorAll('input[type="url"]');
    for (var i = 0; i < inputs.length; i += 1) {
      (function (input) {
        input.addEventListener('blur', function () {
          normalizeUrlField(input);
        });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') normalizeUrlField(input);
        });
      })(inputs[i]);
    }
  }

  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var turnstileLoad = null;

  function loadTurnstile() {
    if (turnstileLoad) return turnstileLoad;
    turnstileLoad = new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || !document.createElement) return reject(new Error('no document'));
      var tag = document.createElement('script');
      tag.src = TURNSTILE_SRC;
      tag.async = true;
      tag.onload = function () { resolve(globalThis.turnstile); };
      tag.onerror = function () { reject(new Error('turnstile failed to load')); };
      document.head.appendChild(tag);
    });
    return turnstileLoad;
  }

  /**
   * Returns state that holds the widget once it is up; stays empty when there is no key.
   * The widget is rendered with execution 'execute': it mints a token only when the form is
   * submitted (tokenFor below), not on every page view. A token minted on load is never checked
   * by anyone who does not submit, which Cloudflare reports as "siteverify isn't being called"
   * (23 Nov 2026: 784 tokens solved in a week against 4 verified), and it can expire before a
   * long form is sent.
   */
  function wireBotCheck(form) {
    var state = { widget: null, api: null, waiting: null, interactive: null };
    if (form.getAttribute('data-bot-check') !== 'turnstile' || typeof fetch !== 'function') return state;
    var action = form.getAttribute('action') || DEFAULT_ACTION;
    fetch(action, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!body || !body.turnstile_site_key) return null;
        return loadTurnstile().then(function (api) {
          var holder = document.createElement('div');
          holder.setAttribute('data-turnstile-holder', '');
          form.appendChild(holder);
          state.api = api;
          state.widget = api.render(holder, {
            sitekey: body.turnstile_site_key,
            appearance: 'interaction-only',
            execution: 'execute',
            callback: function (token) { if (state.waiting) state.waiting(token || ''); },
            'error-callback': function () { if (state.waiting) state.waiting(''); },
            'timeout-callback': function () { if (state.waiting) state.waiting(''); },
            // A person is being shown the checkbox: give them time to answer it.
            'before-interactive-callback': function () { if (state.interactive) state.interactive(); }
          });
        });
      })
      .catch(function () { /* no widget: the server decides, the form shows its email fallback */ });
    return state;
  }

  /**
   * Resolves with a fresh token, or '' when there is no widget or it gives none in time (blocked,
   * erroring, or a challenge left unanswered). '' still sends: the server delivers it on its capped
   * unchecked lane, without the attachment.
   */
  var TOKEN_WAIT_MS = 15000;
  var CHALLENGE_WAIT_MS = 120000;
  function tokenFor(botCheck) {
    if (!botCheck.api || botCheck.widget === null) return Promise.resolve('');
    return new Promise(function (resolve) {
      var done = false;
      function finish(token) {
        if (done) return;
        done = true;
        botCheck.waiting = null;
        botCheck.interactive = null;
        clearTimeout(timer);
        resolve(token || '');
      }
      botCheck.waiting = finish;
      var timer = setTimeout(function () { finish(''); }, TOKEN_WAIT_MS);
      botCheck.interactive = function () {
        clearTimeout(timer);
        timer = setTimeout(function () { finish(''); }, CHALLENGE_WAIT_MS);
      };
      try {
        botCheck.api.reset(botCheck.widget);
        botCheck.api.execute(botCheck.widget);
      } catch (e) { finish(''); }
    });
  }

  /** The visitor's next step for each refusal the server can give. */
  function errorLead(body) {
    var code = body && body.error;
    if (code === 'deck_file_invalid') return 'That file is not a PDF, so nothing was sent. Attach the deck as a PDF, or leave it off.';
    if (code === 'deck_file_too_large') return 'That file is over 10 MB, so nothing was sent. Attach a smaller PDF, or leave it off.';
    if (code === 'invalid_email') return 'That email address does not look right, so nothing was sent.';
    if (code === 'rate_limited') return 'We have had too many messages from this connection today, so nothing was sent.';
    return 'We could not send that just now.';
  }

  function wire(form) {
    if (form.getAttribute('data-westpeek-wired') === 'true') return;
    form.setAttribute('data-westpeek-wired', 'true');
    if (typeof form.querySelectorAll === 'function') wireUrlFields(form);

    var botCheck = wireBotCheck(form);
    var button = form.querySelector('button[type="submit"], input[type="submit"]');
    var busy = false;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      busy = true;

      var restore = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }
      setPending(form, 'Sending…');

      function release() {
        busy = false;
        if (button) {
          button.disabled = false;
          button.textContent = restore;
        }
      }

      function send(token) {
        var data = new FormData(form);
        if (token) data.set('cf-turnstile-response', token);
        return fetch(form.getAttribute('action') || DEFAULT_ACTION, {
          method: 'POST',
          body: data,
          headers: { Accept: 'application/json' }
        });
      }

      // With a widget, wait for its token first; without one, send at once.
      var request;
      if (botCheck.api && botCheck.widget !== null) request = tokenFor(botCheck).then(send);
      else {
        try { request = send(''); } catch (err) { request = Promise.reject(err); }
      }

      request
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              // The single guard. Everything above this line is presentation.
              if (response.ok && body && body.ok === true) {
                setSuccess(form, body.deck === 'not_attached');
                announceSuccess(form);
                form.reset();
              } else {
                setError(form, errorLead(body));
              }
            });
        })
        .catch(function () {
          setError(form, 'We could not reach the server.');
        })
        .then(release, release);
    });
  }

  function wireAll(root) {
    var forms = (root || document).querySelectorAll('form[data-westpeek-form]');
    for (var i = 0; i < forms.length; i += 1) wire(forms[i]);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        wireAll(document);
      });
    } else {
      wireAll(document);
    }
  }

  // Exposed so scripts/validate_forms.mjs can drive a real submit against a
  // stubbed fetch and assert the success guard, rather than pattern-matching
  // the source and hoping.
  if (typeof globalThis !== 'undefined') {
    globalThis.WestPeekForms = { wire: wire, wireAll: wireAll };
  }
})();
