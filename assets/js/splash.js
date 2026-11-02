// Заставка уходит, когда приложение готово, но не раньше MIN - иначе на быстром
// соединении она успевает только моргнуть. CAP страхует от вечной заставки:
// если модуль упал, пользователь всё равно увидит экран, а не пустоту.
// MIN covers the opening: the rift, the letters, the sheen (about 1.9 s).
// Leaving, the doors open along the rift and the screen behind slides in
// (body.fw-enter, for as long as that takes).
(function () {
  var el = document.getElementById('fw-splash'), t0 = Date.now(), done = false;
  var MIN = 1900, CAP = 4500;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function hide() {
    if (done) return; done = true;
    setTimeout(function () {
      // the welcome logo would replay its own entrance right after this one
      var w = document.getElementById('st-welcome');
      if (w) w.classList.remove('intro');
      document.body.classList.add('fw-enter');
      el.classList.add('gone');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, still ? 50 : 1000);
      setTimeout(function () { document.body.classList.remove('fw-enter'); }, 1500);
    }, Math.max(0, (still ? 300 : MIN) - (Date.now() - t0)));
  }
  window.addEventListener('fw:ready', hide);
  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide);
  setTimeout(hide, CAP);
})();
