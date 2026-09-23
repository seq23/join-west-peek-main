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

  var episodeGrid = document.getElementById('episode-grid');
  if (episodeGrid) {
    fetch('assets/data/episodes.json').then(function (r) { return r.json(); }).then(function (episodes) {
      wireCardGrid(episodeGrid, episodes, {
        summary: function (ep) {
          return '<p class="wpc-card__number">Episode ' + ep.number + '</p><h3 class="wpc-card__name">' + ep.guest + '</h3>';
        },
        expand: function (detail, ep) {
          var p = document.createElement('p');
          p.textContent = ep.synopsis;
          if (ep.youtube) {
            detail.appendChild(youtubeEmbed(ep.youtube));
          } else {
            var soon = document.createElement('div');
            soon.className = 'wpc-card__soon';
            soon.textContent = 'Episode coming soon';
            detail.appendChild(soon);
          }
          detail.appendChild(p);
        }
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
        btn.innerHTML =
          '<img class="wpc-history-item__thumb" src="' + ev.flyer + '" alt="" loading="lazy">' +
          '<span><span class="wpc-history-item__name">' + ev.name + '</span>' +
          '<span class="wpc-history-item__dates">' + ev.dateRange + '</span></span>' +
          '<span class="wpc-history-item__chevron" aria-hidden="true"></span>';
        btn.addEventListener('click', function () {
          var open = item.hasAttribute('data-open');
          if (open) { item.removeAttribute('data-open'); btn.setAttribute('aria-expanded', 'false'); }
          else { item.setAttribute('data-open', ''); btn.setAttribute('aria-expanded', 'true'); }
        });

        var body = document.createElement('div');
        body.className = 'wpc-history-item__body';
        body.id = bodyId;
        var img = document.createElement('img');
        img.src = ev.flyer;
        img.alt = ev.name + ' flyer';
        img.loading = 'lazy';
        var p = document.createElement('p');
        p.textContent = ev.description;
        body.appendChild(img);
        body.appendChild(p);

        item.appendChild(btn);
        item.appendChild(body);
        historyList.appendChild(item);
      });
    });
  }
})();
