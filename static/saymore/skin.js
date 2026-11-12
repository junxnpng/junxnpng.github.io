// Applies the chosen Say More skin before the page paints, then adds the Theme button to the header.
// Loaded as a plain script from <head> on both the study pages and the cards app.
(function () {
  var SKINS = [
    { id: 'mono', name: '흑백 미니멀', scheme: 'light' },
    { id: 'dracula', name: '드라큘라', scheme: 'dark' },
    { id: 'pop', name: '팝', scheme: 'light' }
  ];
  var KEY = 'saymore.skin';
  var root = document.documentElement;
  function find(id) { for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i]; return null; }
  function saved() { try { return find(localStorage.getItem(KEY)); } catch (e) { return null; } }
  // With nothing chosen yet, a device in dark mode starts on the dark skin.
  function fallback() { return find(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dracula' : 'mono'); }
  function apply(skin) {
    root.dataset.skin = skin.id;
    root.dataset.theme = skin.scheme; // the study pages key their dark rules on this
  }
  var current = saved() || fallback();
  apply(current);

  function build() {
    var host = document.querySelector('.header-nav') || document.querySelector('.site-header');
    if (!host || host.querySelector('.skin-picker')) return;
    var picker = document.createElement('div'); picker.className = 'skin-picker';
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'skin-button'; button.textContent = 'Theme';
    button.setAttribute('aria-haspopup', 'true'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'skin-menu');
    var menu = document.createElement('div');
    menu.id = 'skin-menu'; menu.className = 'skin-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '테마 고르기');
    SKINS.forEach(function (skin) {
      var item = document.createElement('button');
      item.type = 'button'; item.dataset.skinChoice = skin.id; item.setAttribute('role', 'menuitemradio');
      var swatch = document.createElement('span'); swatch.className = 'skin-swatch'; swatch.dataset.swatch = skin.id; swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, skin.name);
      menu.append(item);
    });
    picker.append(button, menu); host.append(picker);

    function mark() {
      menu.querySelectorAll('button').forEach(function (item) { item.setAttribute('aria-checked', String(item.dataset.skinChoice === current.id)); });
    }
    function open(show) {
      menu.hidden = !show; button.setAttribute('aria-expanded', String(show));
      if (show) { var on = menu.querySelector('[aria-checked="true"]'); if (on) on.focus(); }
    }
    mark();
    button.addEventListener('click', function () { open(menu.hidden); });
    menu.addEventListener('click', function (event) {
      var item = event.target.closest('button'); if (!item) return;
      current = find(item.dataset.skinChoice) || current;
      apply(current); mark();
      try { localStorage.setItem(KEY, current.id); } catch (e) { /* The skin still applies for this visit. */ }
      open(false); button.focus();
    });
    menu.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      var items = Array.prototype.slice.call(menu.querySelectorAll('button'));
      var next = items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
      items[(next + items.length) % items.length].focus(); event.preventDefault();
    });
    document.addEventListener('click', function (event) { if (!menu.hidden && !picker.contains(event.target)) open(false); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !menu.hidden) { open(false); button.focus(); } });
    // Another tab changed the skin: follow it.
    window.addEventListener('storage', function (event) {
      if (event.key !== KEY) return;
      current = saved() || fallback(); apply(current); mark();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
