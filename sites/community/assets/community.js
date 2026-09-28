/* West Peek Community — nav toggle, episode/winner card expansion, and the
 * history accordion. All three are disclosure widgets: a button with
 * aria-expanded and a controlled region, so keyboard and screen-reader users
 * get the same interaction as a mouse click.
 */
(function () {
  var nav = document.querySelector('.wpc-nav');
  if (nav) {
    var toggle = nav.querySelector('.wpc-nav__toggle');
    function setOpen(open) {
      if (!toggle) return;
      if (open) nav.setAttribute('data-open', ''); else nav.removeAttribute('data-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (toggle) toggle.addEventListener('click', function () {
      setOpen(!nav.hasAttribute('data-open'));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.hasAttribute('data-open')) { setOpen(false); toggle.focus(); }
    });
  }

  // ---------------------------------------------------------------- Scroll cue
  // Scooter, 27 Sep 2026: "I don't know if people know they can scroll on the
  // flyers to kinda make that thing." Every sideways scroller - the event-history
  // flyer carousels, the More Episodes / workshops rows - gets a hint line,
  // previous/next arrows, and a fade on whichever edge still has more behind it.
  // The cue removes itself (data-fits) when everything already fits, so it never
  // nags on a wide screen. Returns the refresh function so a disclosure that
  // reveals the track later (the history accordion) can re-measure it.
  function scrollCue(track, hint) {
    if (!track || !track.parentNode) return null;
    if (track.parentNode.classList && track.parentNode.classList.contains('wpc-scroller__track')) return null;

    var wrap = document.createElement('div');
    wrap.className = 'wpc-scroller';
    var bar = document.createElement('div');
    bar.className = 'wpc-scroller__bar';
    var hintEl = document.createElement('p');
    hintEl.className = 'wpc-scroller__hint';
    hintEl.textContent = hint;
    var arrows = document.createElement('div');
    arrows.className = 'wpc-scroller__arrows';
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'wpc-scroller__btn';
    prev.setAttribute('data-dir', '-1');
    prev.setAttribute('aria-label', 'Scroll back');
    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'wpc-scroller__btn';
    next.setAttribute('data-dir', '1');
    next.setAttribute('aria-label', 'Scroll forward');
    var trackWrap = document.createElement('div');
    trackWrap.className = 'wpc-scroller__track';
    var edgeStart = document.createElement('span');
    edgeStart.className = 'wpc-scroller__edge wpc-scroller__edge--start';
    edgeStart.setAttribute('aria-hidden', 'true');
    var edgeEnd = document.createElement('span');
    edgeEnd.className = 'wpc-scroller__edge wpc-scroller__edge--end';
    edgeEnd.setAttribute('aria-hidden', 'true');

    track.parentNode.insertBefore(wrap, track);
    arrows.appendChild(prev);
    arrows.appendChild(next);
    bar.appendChild(hintEl);
    bar.appendChild(arrows);
    wrap.appendChild(bar);
    trackWrap.appendChild(track);
    trackWrap.appendChild(edgeStart);
    trackWrap.appendChild(edgeEnd);
    wrap.appendChild(trackWrap);
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', hint);

    function update() {
      var max = track.scrollWidth - track.clientWidth;
      var atStart = track.scrollLeft <= 2;
      var atEnd = track.scrollLeft >= max - 2;
      if (max <= 4) wrap.setAttribute('data-fits', ''); else wrap.removeAttribute('data-fits');
      if (atStart) wrap.setAttribute('data-at-start', ''); else wrap.removeAttribute('data-at-start');
      if (atEnd) wrap.setAttribute('data-at-end', ''); else wrap.removeAttribute('data-at-end');
      prev.disabled = atStart;
      next.disabled = atEnd;
    }
    function step(dir) {
      var by = Math.max(160, Math.round(track.clientWidth * 0.8)) * dir;
      if (track.scrollBy) track.scrollBy({ left: by, behavior: 'smooth' }); else track.scrollLeft += by;
    }
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    if (window.ResizeObserver) new ResizeObserver(update).observe(track);
    Array.prototype.forEach.call(track.querySelectorAll('img'), function (img) {
      if (!img.complete) img.addEventListener('load', update);
    });
    update();
    return update;
  }

  // The More Episodes / More Workshops rows are static HTML, so they are cued now.
  Array.prototype.forEach.call(document.querySelectorAll('.wpc-episode__row'), function (row) {
    scrollCue(row, 'Scroll sideways for more, or use the arrows');
  });

  // ---------------------------------------------------------------- Live hero
  // Scooter, 28 Sep 2026: keep "West Peek" fixed while the rest types out,
  // backspaces and rotates through the phrases the h1 carries in
  // data-phrases. The brief's exact line is the h1's real text and stays in
  // the DOM (moved off-screen with .wpc-visually-hidden) so screen readers,
  // no-JS visitors and prefers-reduced-motion visitors all get the full
  // sentence; the typed copy is aria-hidden decoration.
  (function heroTyping() {
    var title = document.getElementById('hero-title');
    var line = document.getElementById('hero-line');
    var live = document.getElementById('hero-live');
    var rotor = document.getElementById('hero-rotor');
    if (!title || !line || !live || !rotor) return;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; // static line, no typing
    var phrases;
    try { phrases = JSON.parse(title.getAttribute('data-phrases') || '[]'); } catch (e) { phrases = []; }
    phrases = phrases.filter(function (s) { return typeof s === 'string' && s.length; });
    if (!phrases.length) return;

    var TYPE_MS = 55, ERASE_MS = 26, HOLD_MS = 2000, GAP_MS = 350;
    var i = 0, pos = 0, erasing = false;
    title.setAttribute('data-typing', '');
    line.classList.add('wpc-visually-hidden');
    live.hidden = false;

    function tick() {
      if (document.hidden) { setTimeout(tick, 500); return; } // idle in a background tab
      var phrase = phrases[i];
      if (!erasing) {
        pos += 1;
        rotor.textContent = phrase.slice(0, pos);
        if (pos >= phrase.length) { erasing = true; setTimeout(tick, HOLD_MS); return; }
        setTimeout(tick, TYPE_MS);
      } else {
        pos -= 1;
        rotor.textContent = phrase.slice(0, pos);
        if (pos <= 0) { erasing = false; i = (i + 1) % phrases.length; setTimeout(tick, GAP_MS); return; }
        setTimeout(tick, ERASE_MS);
      }
    }
    tick();
  })();

  // ---------------------------------------------------------------- Parallax
  // Transform-only layered scroll motion on any [data-parallax-speed]
  // element, desktop and mobile alike (the scroll event fires on touch
  // scrolling too). Off entirely when the visitor asked for reduced motion.
  (function parallax() {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    var layers = Array.prototype.slice.call(document.querySelectorAll('[data-parallax-speed]'));
    if (!layers.length) return;
    var ticking = false;
    function apply() {
      var vh = window.innerHeight;
      layers.forEach(function (el) {
        var speed = parseFloat(el.getAttribute('data-parallax-speed')) || 0;
        var rect = el.getBoundingClientRect();
        var progress = (vh - rect.top) / (vh + rect.height); // 0 entering, 1 leaving
        var offset = (progress - 0.5) * speed * vh;
        el.style.transform = 'translateY(' + offset.toFixed(1) + 'px)';
      });
      ticking = false;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    apply();
  })();

  function youtubeEmbed(id) {
    var wrap = document.createElement('div');
    wrap.className = 'wpc-card__player';
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id;
    iframe.title = 'Episode video';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
    return wrap;
  }

  /** Wires a grid of grayscale-to-color expand cards (episodes and winners share this pattern). */
  function wireCardGrid(grid, records, renderDetail) {
    if (!grid) return;
    records.forEach(function (record, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'wpc-card';
      card.setAttribute('aria-expanded', 'false');
      var detailId = grid.id + '-detail-' + i;
      card.setAttribute('aria-controls', detailId);

      var photo = document.createElement('img');
      photo.className = 'wpc-card__photo';
      photo.src = record.headshot || record.logo;
      photo.alt = record.headshotAlt || record.name || '';
      photo.loading = 'lazy';
      card.appendChild(photo);

      var body = document.createElement('div');
      body.className = 'wpc-card__body';
      body.innerHTML = renderDetail.summary(record);
      card.appendChild(body);

      var detail = document.createElement('div');
      detail.className = 'wpc-card__detail';
      detail.id = detailId;
      renderDetail.expand(detail, record);
      card.appendChild(detail);

      card.addEventListener('click', function () {
        var open = card.getAttribute('aria-expanded') === 'true';
        card.setAttribute('aria-expanded', open ? 'false' : 'true');
      });

      grid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------- The Update:
  // countdown + gated multi-step wizard. Same window functions/update.js
  // enforces server-side; this is what actually shows/hides on a page that
  // did arrive with the form in it (window open, or a *.pages.dev preview),
  // renders the countdown copy, and drives the step/progress-bar UI.
  (function updateWindow() {
    var countdownEl = document.getElementById('update-countdown');
    var formWrap = document.getElementById('update-form-wrap');
    if (!countdownEl || !formWrap) return;

    var OPENS_AT = Date.parse('2026-10-01T04:00:00Z');   // Oct 1 2026 00:00 ET (EDT)
    var CLOSES_AT = Date.parse('2026-11-01T03:59:59Z');  // Oct 31 2026 23:59:59 ET (EDT)
    var NEXT_OPENS_AT = Date.parse('2027-01-01T05:00:00Z'); // Jan 1 2027 00:00 ET (EST)

    var isPreview = /\.pages\.dev$/.test(window.location.hostname);
    var now = Date.now();
    var isOpen = now >= OPENS_AT && now <= CLOSES_AT;

    if (isPreview || isOpen) {
      countdownEl.hidden = true;
      formWrap.hidden = false;
      wireUpdateSteps(formWrap);
    } else {
      formWrap.hidden = true;
      countdownEl.hidden = false;
      var target = now < OPENS_AT ? OPENS_AT : NEXT_OPENS_AT;
      var days = Math.max(0, Math.ceil((target - now) / 86400000));
      var textEl = document.getElementById('update-countdown-text');
      if (textEl) {
        textEl.textContent = days <= 0
          ? 'The Q4 Update opens today.'
          : 'The Q4 Update opens in ' + days + ' day' + (days === 1 ? '' : 's') + ' (October 1) and stays open through the end of the month.';
      }
    }
  })();

  function wireUpdateSteps(formWrap) {
    var steps = Array.prototype.slice.call(formWrap.querySelectorAll('.wpc-steps__step'));
    if (!steps.length) return;
    var back = document.getElementById('update-back');
    var next = document.getElementById('update-next');
    var submit = document.getElementById('update-submit');
    var bar = document.getElementById('update-progress');
    var label = document.getElementById('update-step-label');
    var current = 0;

    function show(i) {
      steps.forEach(function (s, idx) { s.hidden = idx !== i; });
      back.hidden = i === 0;
      var last = i === steps.length - 1;
      next.hidden = last;
      submit.hidden = !last;
      if (bar) bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
      if (label) label.textContent = 'Step ' + (i + 1) + ' of ' + steps.length + ' · Takes 3 minutes';
    }

    next.addEventListener('click', function () {
      if (current < steps.length - 1) { current += 1; show(current); }
    });
    back.addEventListener('click', function () {
      if (current > 0) { current -= 1; show(current); }
    });
    show(current);
  }

  // Upcoming workshops: hidden unless /api/workshops reports a real future
  // Luma event. Fails closed - any error leaves it hidden.
  var upcomingSection = document.getElementById('workshops-upcoming');
  if (upcomingSection) {
    var emptyMsg = document.getElementById('workshops-empty');
    fetch('/api/workshops').then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.hasUpcoming) {
        upcomingSection.hidden = false;
        if (emptyMsg) emptyMsg.hidden = true;
      }
    }).catch(function () {});
  }

  // Past workshops link out to their own generated /workshops/<slug> page,
  // same pattern as the episode grid below - flyer left, recording right,
  // the rest of the workshops in a row underneath (Scooter: "list the
  // workshops the same way as the podcast episodes").
  var workshopGrid = document.getElementById('workshop-grid');
  if (workshopGrid) {
    fetch('assets/data/workshops.json').then(function (r) { return r.json(); }).then(function (workshops) {
      workshops.forEach(function (w) {
        var card = document.createElement('a');
        card.className = 'wpc-card';
        card.href = '/workshops/' + w.slug + '/';

        var photo = document.createElement('img');
        photo.className = 'wpc-card__photo';
        photo.src = w.flyer;
        photo.alt = w.flyerAlt || w.title;
        photo.loading = 'lazy';
        card.appendChild(photo);

        var body = document.createElement('div');
        body.className = 'wpc-card__body';
        var name = document.createElement('h3');
        name.className = 'wpc-card__name';
        name.textContent = w.title;
        body.appendChild(name);
        card.appendChild(body);

        workshopGrid.appendChild(card);
      });
    });
  }

  var heroPhoto = document.getElementById('hero-photo');
  if (heroPhoto) {
    fetch('assets/data/hero.json').then(function (r) { return r.json(); }).then(function (hero) {
      if (!hero || !hero.photo) return; // stays hidden - no empty placeholder ships
      heroPhoto.src = hero.photo;
      heroPhoto.alt = hero.alt || '';
      heroPhoto.setAttribute('data-loaded', '');
    }).catch(function () {});
  }

  // The episode grid on /episodes links out to each guest's own page
  // (/episodes/<slug>, generated at build time) rather than expanding in
  // place - the winner grid below still uses the shared expand-in-place
  // pattern, since winners have no page of their own.
  var episodeGrid = document.getElementById('episode-grid');
  if (episodeGrid) {
    fetch('assets/data/episodes.json').then(function (r) { return r.json(); }).then(function (episodes) {
      episodes.forEach(function (ep) {
        var card = document.createElement('a');
        card.className = 'wpc-card';
        card.href = '/episodes/' + ep.slug + '/';

        var photo = document.createElement('img');
        photo.className = 'wpc-card__photo';
        photo.src = ep.headshot;
        photo.alt = ep.headshotAlt || ep.guest;
        photo.loading = 'lazy';
        card.appendChild(photo);

        var body = document.createElement('div');
        body.className = 'wpc-card__body';
        var num = document.createElement('p');
        num.className = 'wpc-card__number';
        num.textContent = 'Episode ' + ep.number + (ep.youtube ? '' : ' · coming soon');
        var name = document.createElement('h3');
        name.className = 'wpc-card__name';
        name.textContent = ep.guest;
        body.appendChild(num);
        body.appendChild(name);
        card.appendChild(body);

        episodeGrid.appendChild(card);
      });
    });
  }

  var winnerGrid = document.getElementById('winner-grid');
  if (winnerGrid) {
    fetch('assets/data/winners.json').then(function (r) { return r.json(); }).then(function (winners) {
      if (!winners.length) {
        var empty = document.createElement('div');
        empty.className = 'wpc-placeholder--empty';
        empty.textContent = 'Past winners will appear here once the first pitch competition records a result.';
        winnerGrid.replaceWith(empty);
        return;
      }
      wireCardGrid(winnerGrid, winners, {
        summary: function (w) {
          return '<p class="wpc-card__number">' + w.winDate + '</p><h3 class="wpc-card__name">' + w.company + '</h3>';
        },
        expand: function (detail, w) {
          var p = document.createElement('p');
          p.textContent = w.description;
          detail.appendChild(p);
        }
      });
    });
  }

  var historyList = document.getElementById('history-list');
  if (historyList) {
    fetch('assets/data/history-events.json').then(function (r) { return r.json(); }).then(function (events) {
      events.forEach(function (ev, i) {
        var item = document.createElement('div');
        item.className = 'wpc-history-item';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wpc-history-item__toggle';
        btn.setAttribute('aria-expanded', 'false');
        var bodyId = 'history-body-' + i;
        btn.setAttribute('aria-controls', bodyId);

        var thumb = document.createElement('img');
        thumb.className = 'wpc-history-item__thumb';
        thumb.src = ev.flyer;
        thumb.alt = '';
        thumb.loading = 'lazy';
        var label = document.createElement('span');
        var nameEl = document.createElement('span');
        nameEl.className = 'wpc-history-item__name';
        nameEl.textContent = ev.name;
        var datesEl = document.createElement('span');
        datesEl.className = 'wpc-history-item__dates';
        datesEl.textContent = ev.dateRange;
        label.appendChild(nameEl);
        label.appendChild(datesEl);
        var chevron = document.createElement('span');
        chevron.className = 'wpc-history-item__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        btn.appendChild(thumb);
        btn.appendChild(label);
        btn.appendChild(chevron);

        var cue = null;
        btn.addEventListener('click', function () {
          var open = item.hasAttribute('data-open');
          if (open) { item.removeAttribute('data-open'); btn.setAttribute('aria-expanded', 'false'); }
          else {
            item.setAttribute('data-open', '');
            btn.setAttribute('aria-expanded', 'true');
            // The carousel was display:none until now; measure it once it is visible.
            if (cue) cue();
          }
        });

        var body = document.createElement('div');
        body.className = 'wpc-history-item__body';
        body.id = bodyId;

        var p = document.createElement('p');
        p.textContent = ev.description;
        body.appendChild(p);

        var carousel = document.createElement('div');
        carousel.className = 'wpc-flyer-carousel';
        (ev.photos || [{ src: ev.flyer, name: null }]).forEach(function (photo) {
          var fig = document.createElement('figure');
          fig.className = 'wpc-flyer-carousel__item';
          var img = document.createElement('img');
          img.src = photo.src;
          img.alt = photo.name ? (photo.name + ', ' + ev.name) : (ev.name + ' flyer');
          img.loading = 'lazy';
          fig.appendChild(img);
          if (photo.name) {
            var cap = document.createElement('figcaption');
            cap.textContent = photo.name;
            fig.appendChild(cap);
          }
          carousel.appendChild(fig);
        });
        body.appendChild(carousel);
        var flyerCount = (ev.photos || [ev.flyer]).length;
        cue = scrollCue(carousel, flyerCount === 1 ? '1 flyer' : flyerCount + ' flyers - scroll sideways or use the arrows');

        item.appendChild(btn);
        item.appendChild(body);
        historyList.appendChild(item);
      });
    });
  }
})();
