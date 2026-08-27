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
 */
(function () {
  'use strict';

  var DEFAULT_ACTION = '/api/lead';
  var DEFAULT_SUCCESS = 'Received. We’ll reply soon.';
  // The address already published as the fallback on the community and pitch
  // pages. Where founder deal flow should actually land is an owner decision,
  // not this file's to invent.
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
    el.appendChild(document.createTextNode(lead + ' Nothing was sent. Please email '));
    var link = document.createElement('a');
    link.setAttribute('href', 'mailto:' + address);
    link.appendChild(document.createTextNode(address));
    el.appendChild(link);
    el.appendChild(document.createTextNode(' and we will pick it up from there.'));
  }

  function wire(form) {
    if (form.getAttribute('data-westpeek-wired') === 'true') return;
    form.setAttribute('data-westpeek-wired', 'true');

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
