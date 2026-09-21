/* West Peek Ventures — nav behaviour. Pairs with assets/ventures.css.
 *
 * The drawer (mobile) and the Resources menu are the only interactive parts
 * of the nav. Both are disclosure widgets: a button with aria-expanded and a
 * controlled region. Esc closes, clicking outside closes, following a link
 * closes, and focus never leaves the page.
 */
(function () {
  var nav = document.querySelector('.wp-nav');
  if (!nav) return;
  var toggle = nav.querySelector('.wp-nav__toggle');
  var menu = nav.querySelector('.wp-nav__menu');
  var menuBtn = menu && menu.querySelector('button');

  function setDrawer(open) {
    if (!toggle) return;
    if (open) nav.setAttribute('data-open', ''); else nav.removeAttribute('data-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) setMenu(false);
  }
  function setMenu(open) {
    if (!menu) return;
    if (open) menu.setAttribute('data-open', ''); else menu.removeAttribute('data-open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (toggle) toggle.addEventListener('click', function () {
    setDrawer(!nav.hasAttribute('data-open'));
  });
  if (menuBtn) menuBtn.addEventListener('click', function () {
    setMenu(!menu.hasAttribute('data-open'));
  });

  // Following any link closes everything, so an in-page anchor scrolls to a
  // section the drawer is no longer covering.
  nav.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (a) { setDrawer(false); setMenu(false); }
  });
  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) { setDrawer(false); setMenu(false); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var wasOpen = nav.hasAttribute('data-open') || (menu && menu.hasAttribute('data-open'));
      setDrawer(false); setMenu(false);
      if (wasOpen && toggle && getComputedStyle(toggle).display !== 'none') toggle.focus();
      else if (wasOpen && menuBtn) menuBtn.focus();
    }
  });

  // In-page anchors scroll smoothly and land below the fixed/sticky bar.
  var links = document.querySelectorAll('a[href^="#"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (e) {
      var id = this.getAttribute('href').slice(1);
      var el = id && document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    });
  }
})();
