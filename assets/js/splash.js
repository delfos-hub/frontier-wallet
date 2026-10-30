// Заставка уходит, когда приложение готово, но не раньше MIN - иначе на быстром
// соединении она успевает только моргнуть. CAP страхует от вечной заставки:
// если модуль упал, пользователь всё равно увидит экран, а не пустоту.
(function () {
  var el = document.getElementById('fw-splash'), t0 = Date.now(), done = false;
  var MIN = 1500, CAP = 4000;
  function hide() {
    if (done) return; done = true;
    setTimeout(function () {
      el.classList.add('gone');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, Math.max(0, MIN - (Date.now() - t0)));
  }
  window.addEventListener('fw:ready', hide);
  if (document.readyState === 'complete') hide();
  else window.addEventListener('load', hide);
  setTimeout(hide, CAP);
})();
