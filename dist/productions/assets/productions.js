/* West Peek Productions — small site script (Nov 2026 rebuild).
 *
 * 1. Source tracking for the Start a project form. The brief: "track which
 *    source each inquiry came from, without exposing client data". The first
 *    page a visitor lands on, its utm_* tags and the referring site's HOST
 *    (never the full referring URL) are kept in sessionStorage for this tab
 *    only - no cookie, no pixel, no third party - and copied into the form's
 *    hidden fields, so they travel in Scooter's email and nowhere else.
 * 2. A gentle reveal on scroll, off under prefers-reduced-motion and for
 *    anyone without IntersectionObserver.
 * 3. The moving "We make people …" line, the capability icons, the form's
 *    "Something else" box (14 Nov 2026 edits).
 * 4. The footer year.
 */
(function () {
  'use strict';
  var KEY = 'wpp_first_touch';

  function referrerHost() {
    try {
      if (!document.referrer) return '';
      var host = new URL(document.referrer).hostname;
      return host === location.hostname ? '' : host;
    } catch (e) { return ''; }
  }

  function firstTouch() {
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { stored = null; }
    if (stored) return stored;
    var params = new URLSearchParams(location.search);
    var touch = {
      landing_page: location.pathname,
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      referrer_host: referrerHost()
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(touch)); } catch (e) { /* private mode: this page only */ }
    return touch;
  }

  var touch = firstTouch();

  /** The page on this site the visitor came to the form from (path only). */
  function sourcePage() {
    try {
      if (!document.referrer) return '';
      var ref = new URL(document.referrer);
      return ref.hostname === location.hostname ? ref.pathname : '';
    } catch (e) { return ''; }
  }

  var form = document.querySelector('form[data-source-tracking]');
  if (form) {
    var params = new URLSearchParams(location.search);
    // A tag on the form page itself wins (a link straight to /start from a campaign).
    var values = {
      source_page: sourcePage(),
      landing_page: touch.landing_page,
      utm_source: params.get('utm_source') || touch.utm_source,
      utm_medium: params.get('utm_medium') || touch.utm_medium,
      utm_campaign: params.get('utm_campaign') || touch.utm_campaign,
      referrer_host: touch.referrer_host
    };
    Object.keys(values).forEach(function (name) {
      var input = form.querySelector('input[type="hidden"][name="' + name + '"]');
      if (input) input.value = String(values[name] || '').slice(0, 200);
    });
  }

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('wpp-js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('wpp-in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  }

  document.documentElement.classList.add('wpp-ui');

  // The moving line (Scooter, 14 Nov 2026: "We make people care" in orange, moving, in the hero and
  // the footer). The element's own text ("care.") is what ships, what screen readers hear and what a
  // reduced-motion visitor sees; the typed copy beside it is aria-hidden decoration.
  Array.prototype.forEach.call(document.querySelectorAll('[data-rotate]'), function (el) {
    if (reduce) return;
    var words;
    try { words = JSON.parse(el.getAttribute('data-rotate') || '[]'); } catch (e) { words = []; }
    words = words.filter(function (w) { return typeof w === 'string' && w.length; });
    if (words.length < 2) return;
    var real = el.textContent;
    el.textContent = '';
    var sr = document.createElement('span'); sr.className = 'wpp-sr'; sr.textContent = real;
    var live = document.createElement('span'); live.className = 'wpp-rotate__live'; live.setAttribute('aria-hidden', 'true'); live.textContent = words[0];
    el.appendChild(sr); el.appendChild(live);
    var i = 0, pos = words[0].length, erasing = true;
    function tick() {
      if (document.hidden) { setTimeout(tick, 500); return; }
      var w = words[i];
      if (erasing) {
        pos -= 1; live.textContent = w.slice(0, pos);
        if (pos <= 0) { erasing = false; i = (i + 1) % words.length; setTimeout(tick, 300); return; }
        setTimeout(tick, 32);
      } else {
        pos += 1; live.textContent = words[i].slice(0, pos);
        if (pos >= words[i].length) { erasing = true; setTimeout(tick, 2200); return; }
        setTimeout(tick, 70);
      }
    }
    setTimeout(tick, 2600);
  });

  // Capabilities: a tap opens what each one is (hover does the same on a laptop).
  Array.prototype.forEach.call(document.querySelectorAll('.wpp-capgrid__btn'), function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.parentNode.classList.toggle('is-open', open);
    });
  });

  // Start a project: "Something else" asks for a few words, and only then.
  if (form) {
    var other = form.querySelector('[data-other-field]');
    var otherInput = other && other.querySelector('input');
    var sync = function () {
      var picked = form.querySelector('input[name="need_type"]:checked');
      var on = Boolean(picked && picked.hasAttribute('data-other'));
      if (other) other.classList.toggle('is-on', on);
      if (otherInput) otherInput.required = on;
    };
    Array.prototype.forEach.call(form.querySelectorAll('input[name="need_type"]'), function (r) { r.addEventListener('change', sync); });
    sync();
  }

  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());
})();
