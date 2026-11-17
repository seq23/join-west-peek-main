/* West Peek Productions — small site script (Nov 2026 rebuild).
 *
 * 1. Source tracking for the Get in touch form. The brief: "track which
 *    source each inquiry came from, without exposing client data". The first
 *    page a visitor lands on, its utm_* tags and the referring site's HOST
 *    (never the full referring URL) are kept in sessionStorage for this tab
 *    only - no cookie, no pixel, no third party - and copied into the form's
 *    hidden fields, so they travel in Scooter's email and nowhere else.
 * 2. A gentle reveal on scroll, off under prefers-reduced-motion and for
 *    anyone without IntersectionObserver.
 * 3. The moving "We make people …" line (typed like the community site's
 *    hero), the service icons, and the Get in touch form's event dates
 *    (15 Nov 2026 edits).
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

  // The moving line, "We make people care." (hero and footer). It works exactly like the community
  // site's live hero (joinwestpeek.com, community.js heroTyping; Scooter, 15 Nov 2026: "make the 'We
  // make people care' animation work like the community site's"): "We make people" stays fixed, each
  // word types out, holds, backspaces and the next one types in, at the same speeds, with a caret. The
  // element's own text ("care.") ships in the HTML and is what screen readers, no-JS and reduced-motion
  // visitors get; the typed copy is aria-hidden decoration. The slot is as wide as the longest word, so
  // nothing around it moves while it types.
  Array.prototype.forEach.call(document.querySelectorAll('[data-rotate]'), function (el) {
    if (reduce) return;
    var words;
    try { words = JSON.parse(el.getAttribute('data-rotate') || '[]'); } catch (e) { words = []; }
    words = words.filter(function (w) { return typeof w === 'string' && w.length; });
    if (!words.length) return;
    var TYPE_MS = 55, ERASE_MS = 26, HOLD_MS = 2000, GAP_MS = 350; // community.js heroTyping
    var real = el.textContent;
    el.textContent = '';
    var sr = document.createElement('span'); sr.className = 'wpp-sr'; sr.textContent = real;
    var live = document.createElement('span'); live.className = 'wpp-rotate__live'; live.setAttribute('aria-hidden', 'true');
    el.appendChild(sr); el.appendChild(live);
    el.setAttribute('data-typing', '');
    var i = 0, pos = 0, erasing = false;
    function tick() {
      if (document.hidden) { setTimeout(tick, 500); return; } // idle in a background tab
      var w = words[i];
      if (!erasing) {
        pos += 1; live.textContent = w.slice(0, pos);
        if (pos >= w.length) { erasing = true; setTimeout(tick, HOLD_MS); return; }
        setTimeout(tick, TYPE_MS);
      } else {
        pos -= 1; live.textContent = w.slice(0, pos);
        if (pos <= 0) { erasing = false; i = (i + 1) % words.length; setTimeout(tick, GAP_MS); return; }
        setTimeout(tick, ERASE_MS);
      }
    }
    tick();
  });

  // The logo strip, "Who we work with" (Scooter, 15 Nov 2026: "Touch-hold pauses the strip, dragging
  // scrolls it, hover pauses on desktop, static layout for reduced-motion"). With JS the track becomes a
  // real horizontal scroller that drifts on its own: hover, keyboard focus or a finger held on it pauses
  // it; a finger or trackpad scrolls it natively; a mouse drags it. It picks up again a moment after the
  // hand leaves. Reduced motion keeps the static, wrapped layout (CSS); no JS keeps the CSS slide.
  Array.prototype.forEach.call(document.querySelectorAll('[data-logo-strip]'), function (track) {
    if (reduce) return;
    var row = track.querySelector('.wpp-logos__row');
    if (!row || !window.requestAnimationFrame) return;
    track.classList.add('is-live');
    var SPEED = 32; // px a second, close to the CSS slide
    var hover = false, held = false, focused = false, resumeAt = 0, pos = 0, last = 0, ours = false;
    function loopWidth() { return row.getBoundingClientRect().width; }
    // Our own writes are marked only when they really move the strip: a write that changes nothing
    // fires no scroll event, and a mark left set would swallow the next real scroll by a person.
    function setScroll(v) { var before = track.scrollLeft; track.scrollLeft = v; if (track.scrollLeft !== before) ours = true; }
    function wrap() {
      var w = loopWidth();
      if (w <= 0) return;
      if (track.scrollLeft >= w) setScroll(track.scrollLeft - w);
      else if (track.scrollLeft <= 0) setScroll(track.scrollLeft + w);
      pos = track.scrollLeft;
    }
    function frame(t) {
      var dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      if (!hover && !held && !focused && !document.hidden && Date.now() >= resumeAt) {
        pos += SPEED * dt;
        setScroll(pos);
        if (track.scrollLeft >= loopWidth()) wrap();
      }
      requestAnimationFrame(frame);
    }
    track.addEventListener('scroll', function () {
      if (ours) { ours = false; return; }
      // A person moved it: follow them, keep the loop seamless, wait a moment before drifting on.
      resumeAt = Date.now() + 1500;
      wrap();
    }, { passive: true });
    track.addEventListener('mouseenter', function () { hover = true; });
    track.addEventListener('mouseleave', function () { hover = false; resumeAt = Date.now() + 600; });
    track.addEventListener('focus', function () { focused = true; });
    track.addEventListener('blur', function () { focused = false; });
    track.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      track.scrollBy({ left: e.key === 'ArrowRight' ? 160 : -160, behavior: 'smooth' });
    });
    var dragX = null, dragStart = 0;
    track.addEventListener('pointerdown', function (e) {
      held = true;
      if (e.pointerType === 'mouse' && e.button === 0) {
        dragX = e.clientX; dragStart = track.scrollLeft;
        track.classList.add('is-dragging');
        if (track.setPointerCapture) track.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    track.addEventListener('pointermove', function (e) {
      if (dragX === null) return;
      track.scrollLeft = dragStart - (e.clientX - dragX);
    });
    function release() {
      held = false; dragX = null;
      track.classList.remove('is-dragging');
      resumeAt = Date.now() + 1500;
    }
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', function () {
      // The browser took the touch over to scroll: the finger is still down until touchend.
      dragX = null; track.classList.remove('is-dragging');
    });
    track.addEventListener('touchend', release, { passive: true });
    track.addEventListener('lostpointercapture', function () { if (dragX !== null) release(); });
    // Start one loop in, so a drag to the left has logos to show straight away.
    requestAnimationFrame(function () { setScroll(loopWidth()); pos = track.scrollLeft; requestAnimationFrame(frame); });
  });

  // Capabilities: a tap opens what each one is (hover does the same on a laptop).
  Array.prototype.forEach.call(document.querySelectorAll('.wpp-capgrid__btn'), function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.parentNode.classList.toggle('is-open', open);
    });
  });

  // Get in touch: choosing Virtual / hybrid event production asks for the event dates, and only then
  // (Scooter, 15 Nov 2026). Without JS the date fields simply show, optional.
  if (form) {
    var dates = form.querySelector('[data-event-dates]');
    var service = form.querySelector('select[name="service"]');
    var syncDates = function () {
      var opt = service && service.options[service.selectedIndex];
      var on = Boolean(opt && opt.hasAttribute('data-events'));
      if (dates) dates.classList.toggle('is-on', on);
      Array.prototype.forEach.call(dates ? dates.querySelectorAll('input') : [], function (i) { i.required = on; });
    };
    if (service) service.addEventListener('change', syncDates);
    syncDates();
  }

  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());
})();
