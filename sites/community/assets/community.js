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

        btn.addEventListener('click', function () {
          var open = item.hasAttribute('data-open');
          if (open) { item.removeAttribute('data-open'); btn.setAttribute('aria-expanded', 'false'); }
          else { item.setAttribute('data-open', ''); btn.setAttribute('aria-expanded', 'true'); }
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

        item.appendChild(btn);
        item.appendChild(body);
        historyList.appendChild(item);
      });
    });
  }
})();
