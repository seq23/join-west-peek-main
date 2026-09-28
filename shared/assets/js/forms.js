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
  // This default still covers productions, whose enquiries go to Scooter.
  var DEFAULT_FALLBACK_EMAIL = 'scooter@westpeek.ventures';

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

  function setSuccess(form) {
    var el = status(form);
    if (!el) return;
    clear(el);
    el.setAttribute('data-state', 'ok');
    el.appendChild(
      document.createTextNode(form.getAttribute('data-success') || DEFAULT_SUCCESS)
    );
    showSuccessPanel(form);
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
  function showSuccessPanel(form) {
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

  function wire(form) {
    if (form.getAttribute('data-westpeek-wired') === 'true') return;
    form.setAttribute('data-westpeek-wired', 'true');
    if (typeof form.querySelectorAll === 'function') wireUrlFields(form);

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

      var request;
      try {
        request = fetch(form.getAttribute('action') || DEFAULT_ACTION, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' }
        });
      } catch (err) {
        setError(form, 'We could not reach the server.');
        release();
        return;
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
                setSuccess(form);
                form.reset();
              } else {
                setError(form, 'We could not send that just now.');
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
