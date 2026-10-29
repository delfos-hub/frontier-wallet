/* home-tools.js - the token list's search, and refreshing the wallet.

   Refresh: a button on the balance card for the desktop, and a pull down from
   the top of the home screen on a phone. Telegram swipes a mini app closed
   with the same downward gesture, so its vertical swipe is turned off here
   (where the client supports it); the app can still be closed from its header.

   One refresh reads everything the home screen shows: balances (forced),
   then tells every other part through 'frontier:refresh' - DeFi positions,
   NFTs, Activity - to read again. */
import { $, tap, tg } from './shell.js?v=cec2b74f';
import { refreshBalances } from './tokens.js?v=cec2b74f';

/* ---------------- search ---------------- */
const box = $('#tok-search-box'), input = $('#tok-search'), btn = $('#tok-search-btn'), list = $('#tok-list');
function filter(){
  const q = (input && input.value || '').trim().toLowerCase();
  if (!list) return;
  let shown = 0;
  list.querySelectorAll('li.row').forEach(function (li) {
    const hit = !q || li.textContent.toLowerCase().indexOf(q) >= 0 || (li.getAttribute('data-k') || '').toLowerCase().indexOf(q) >= 0;
    li.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  let none = list.querySelector('.tok-none');
  if (q && !shown) {
    if (!none) { none = document.createElement('li'); none.className = 'empty tok-none'; list.appendChild(none); }
    none.textContent = 'No token matches "' + q + '".';
  } else if (none) none.remove();
}
if (btn && box) btn.addEventListener('click', function () {
  tap();
  box.hidden = !box.hidden;
  btn.classList.toggle('on', !box.hidden);
  if (!box.hidden) input.focus(); else { input.value = ''; filter(); }
});
if (input) input.addEventListener('input', filter);
// the list redraws itself as balances land; the filter has to survive that
if (list && typeof MutationObserver === 'function') {
  let pending = false;
  new MutationObserver(function () {
    if (pending || !input || !input.value) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; filter(); });
  }).observe(list, { childList: true });
}

/* ---------------- refresh ---------------- */
let BUSY = false;
const rbtn = $('#bal-refresh');
async function refresh(){
  if (BUSY) return;
  BUSY = true;
  if (rbtn) rbtn.classList.add('spin');
  const t0 = Date.now();
  document.dispatchEvent(new CustomEvent('frontier:refresh'));
  try { await refreshBalances(true); } catch (e) { /* the banner reports it */ }
  // a spinner that flashes for 80 ms reads as "nothing happened"
  const left = 700 - (Date.now() - t0);
  if (left > 0) await new Promise(r => setTimeout(r, left));
  if (rbtn) rbtn.classList.remove('spin');
  BUSY = false;
}
if (rbtn) rbtn.addEventListener('click', function () { tap(); refresh(); });

// pull to refresh, on the home screen, from the very top
const home = document.getElementById('st-home');
const ptr = document.getElementById('ptr');
const PULL = 70;
let y0 = null, dy = 0;
try { if (tg && tg.disableVerticalSwipes && tg.isVersionAtLeast && tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes(); } catch (e) {}
if (home && ptr) {
  home.addEventListener('touchstart', function (e) {
    if (BUSY || window.scrollY > 0 || document.querySelector('.sw-sheet:not([hidden])')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  home.addEventListener('touchmove', function (e) {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (window.scrollY > 0) { y0 = null; dy = 0; }
    const h = Math.min(dy * 0.5, 90);
    ptr.style.height = h + 'px';
    ptr.classList.toggle('ready', dy * 0.5 >= PULL);
    ptr.style.setProperty('--turn', Math.min(dy * 2, 360) + 'deg');
  }, { passive: true });
  home.addEventListener('touchend', async function () {
    if (y0 === null) return;
    const go = dy * 0.5 >= PULL;
    y0 = null;
    if (!go) { ptr.style.height = '0px'; ptr.classList.remove('ready'); return; }
    tap();
    ptr.style.height = '56px';
    ptr.classList.add('busy');
    await refresh();
    ptr.classList.remove('busy', 'ready');
    ptr.style.height = '0px';
  });
}
