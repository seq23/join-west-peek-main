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
 * 3. The footer year.
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

  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());
})();
