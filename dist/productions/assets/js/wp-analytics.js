/**
 * Google Analytics 4 custom events for the three West Peek sites
 * (Scooter, 17 Nov 2026: "custom events for the main calls to action. Event
 * names and page paths only: no personal data, no form field contents").
 *
 * The base gtag.js tag is written into every page's <head> by
 * scripts/build.mjs; this file only adds the named events on top of it.
 *
 *   - A CTA event fires when a link or button whose visible label matches the
 *     site's list is clicked. A form's own submit button never fires one, so
 *     a submission is never counted as a click as well.
 *   - A form event fires only when forms.js announces a CONFIRMED success
 *     (`westpeek:form-success`, sent from the one place the server's
 *     {"ok":true} is known). The signal carries the form's lead_type and
 *     nothing else; failures send nothing.
 *
 * Every event carries exactly one parameter, page_path (the path, never the
 * query string or hash). The site comes from this script tag's data-site.
 */
(function () {
  'use strict';

  var CTAS = {
    productions: {
      'get in touch': 'cta_get_in_touch',
      'see the case studies': 'cta_see_case_studies'
    },
    community: {
      'join the community': 'cta_join_community',
      'view episodes': 'cta_view_episodes',
      'submit update': 'cta_submit_update',
      'see pitch competition': 'cta_pitch_competition',
      'see next workshops': 'cta_workshops',
      'see who you can help': 'cta_give_and_take'
    },
    ventures: {
      'submit your company': 'cta_submit_company',
      'join our community': 'cta_join_community'
    }
  };

  var FORMS = {
    productions: { productions_start_a_project: 'form_submit_inquiry' },
    community: {},
    ventures: {
      founder_apply: 'form_submit_application',
      founder_pitch: 'form_submit_application',
      newsletter_signup: 'form_submit_newsletter'
    }
  };

  /** "Get in touch →" -> "get in touch": letters, digits and single spaces only. */
  function labelOf(el) {
    var text = String((el && (el.textContent || el.value)) || '');
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
  }

  function isSubmitControl(el) {
    var tag = String(el.tagName || '').toUpperCase();
    var type = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
    if (tag === 'INPUT') return type === 'submit' || type === 'image';
    if (tag !== 'BUTTON') return false;
    // A <button> with no type inside a form submits it.
    if (type === 'submit') return true;
    return !type && !!(el.closest && el.closest('form'));
  }

  function clickable(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('a, button, [role="button"], input[type="button"], input[type="submit"]');
  }

  function ctaEventFor(site, target) {
    var el = clickable(target);
    if (!el || isSubmitControl(el)) return null;
    var map = CTAS[site] || {};
    var name = map[labelOf(el)];
    return name || null;
  }

  function formEventFor(site, leadType) {
    var map = FORMS[site] || {};
    return Object.prototype.hasOwnProperty.call(map, leadType) ? map[leadType] : null;
  }

  function pagePath() {
    try { return String(location.pathname || '/'); } catch (e) { return '/'; }
  }

  function send(name) {
    var params = { page_path: pagePath() };
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    } else {
      (window.dataLayer = window.dataLayer || []).push(['event', name, params]);
    }
  }

  function siteOf() {
    var tag = document.currentScript || document.querySelector('script[data-wp-analytics]');
    return tag ? String(tag.getAttribute('data-site') || '') : '';
  }

  var site = siteOf();

  document.addEventListener('click', function (event) {
    var name = ctaEventFor(site, event.target);
    if (name) send(name);
  }, true);

  document.addEventListener('westpeek:form-success', function (event) {
    var leadType = event && event.detail ? String(event.detail.lead_type || '') : '';
    var name = formEventFor(site, leadType);
    if (name) send(name);
  });

  // Exposed so scripts/first_run.mjs can check the mapping against real pages.
  window.WestPeekAnalytics = {
    site: site, ctas: CTAS, forms: FORMS,
    labelOf: labelOf, ctaEventFor: ctaEventFor, formEventFor: formEventFor
  };
})();
