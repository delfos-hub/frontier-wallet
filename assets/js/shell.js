/* ------------------------------------------------------------------
   PROTOTYPE. Real BIP39, real WebCrypto, real address derivation, so
   the address can be checked against Station. Nothing is persisted:
   the encrypted blob is displayed instead of stored, because this file
   is for review. Do not fund an address created here.

   For production replace PBKDF2 with Argon2id (hash-wasm). PBKDF2 is
   what WebCrypto offers natively but it is much weaker against GPU
   cracking, which is the threat when an encrypted blob sits on a
   server.
------------------------------------------------------------------- */
let bip39, bip32, base, ripe, sha;

const $  = s => document.querySelector(s);

/* no console inside a Mini App, so failures are printed on screen */
const crash = document.createElement('div');
crash.className = 'crash';
document.body.appendChild(crash);
// Safari puts the location in the stack and the reason in the message, and
// printing only one of them describes half the problem.
function report(where, e){
  const parts = [];
  if (e && e.name) parts.push(e.name);
  if (e && e.message) parts.push(e.message);
  if (!parts.length) parts.push(String(e));
  if (e && e.stack) parts.push(String(e.stack).split('\n').slice(0, 4).join('\n'));
  crash.textContent = '[' + where + '] ' + parts.join('\n');
  crash.classList.add('on');
}
// tapping it clears it, so a stale banner cannot sit over a working screen
crash.addEventListener('click', () => crash.classList.remove('on'));
window.addEventListener('error', ev => report('error', ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => report('promise', ev.reason));
const $$ = s => Array.from(document.querySelectorAll(s));
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }
// The object exists on every client; the methods do not. Checking for the one
// and calling the other is what fills the console with WebAppMethodUnsupported.
const HAPTIC_OK = !!(tg && tg.HapticFeedback && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1'));
const tap  = () => { if (HAPTIC_OK) tg.HapticFeedback.impactOccurred('light'); };

/* Telegram floats its close button over the page instead of reserving space,
   and on this build the safe-area vars come back as zero, so a floor is the
   only thing that reliably keeps content clear of it. */
function applyInsets(){
  const a = (tg && tg.contentSafeAreaInset && tg.contentSafeAreaInset.top) || 0;
  const b = (tg && tg.safeAreaInset && tg.safeAreaInset.top) || 0;
  // Only full screen floats Telegram's buttons over the page; in a window the
  // reserve was empty space above the wallet name.
  const fs = !!(tg && tg.isFullscreen);
  const floor = fs ? 58 : 0;
  const root = document.documentElement;
  root.style.setProperty('--pad-top', Math.max(a + b, floor) + 'px');
  root.style.setProperty('--tg-sa', b + 'px');
  root.style.setProperty('--tg-csa', (a || 46) + 'px');
  root.classList.toggle('tg-fs', fs);
}
applyInsets();
if (tg && tg.onEvent) {
  ['safeAreaChanged','contentSafeAreaChanged','viewportChanged','fullscreenChanged'].forEach(ev => {
    try { tg.onEvent(ev, applyInsets); } catch (e) {}
  });
}
const buzz = k => { if (HAPTIC_OK) tg.HapticFeedback.notificationOccurred(k); };

/* the webview keeps focus after a tap outside, so drop it by hand */
function dropKeyboard(){
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
  if (tg && typeof tg.hideKeyboard === 'function') { try { tg.hideKeyboard(); } catch (e) {} }
}
document.addEventListener('pointerdown', e => {
  // .pinbox refocuses its hidden input on click, so blurring here made the
  // keyboard close and immediately reopen
  if (e.target.closest('input, textarea, .chip, .slot, .pinbox')) return;
  dropKeyboard();
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); dropKeyboard(); }
});

const WALLET_TABS = ['home','stake','gov','activity','dev','settings'];
/* On a desktop, Receive, Send and Swap open as a window over the screen they
   were opened from (a tab, a token's page, DeFi positions), which stays in
   view under it; closing returns there. They are short and come back to where
   they started, so a whole screen for each was more travel than they need.
   The phone keeps them as screens. */
const MODAL = ['receive','send','swap','tsend'];
const UNDER = WALLET_TABS.concat(['token','earn','epos']);
const modal = () => document.querySelector('.step.as-modal');
function closeModal(){
  const m = modal();
  if (!m) return false;
  m.classList.remove('on', 'as-modal');
  document.body.classList.remove('modal-open');
  return true;
}
function go(name){
  const dk = document.documentElement.classList.contains('dk');
  const base = [...document.querySelectorAll('.step.on')].find(s => !s.classList.contains('as-modal'));
  if (dk && MODAL.includes(name) && base && UNDER.includes(base.id.slice(3))) {
    tap();
    const m = modal();
    if (m && m.id !== 'st-' + name) m.classList.remove('on', 'as-modal');
    // as-modal before on, in one write: the room move (scene.js) leaves it alone
    $('#st-' + name).classList.add('as-modal', 'on');
    document.body.classList.add('modal-open');
    return;
  }
  closeModal();
  tap();
  const t = $('#tabs');
  if (t) {
    t.classList.toggle('on', WALLET_TABS.includes(name));
    t.querySelectorAll('.tab').forEach(b => b.classList.toggle('sel', b.dataset.tab === name));
  }
  // the intro plays once; coming back to welcome later must be instant
  $('#st-welcome').classList.remove('intro');
  $$('.step').forEach(s => s.classList.remove('on'));
  $('#st-' + name).classList.add('on');
  window.scrollTo(0,0);
}
$$('[data-go]').forEach(el => el.addEventListener('click', () => {
  // inside a window, going "home" (Back, Done, the arrow) means closing it:
  // back to whatever was under it, which need not be Home
  if (el.closest('.step.as-modal') && el.dataset.go === 'home') { tap(); closeModal(); return; }
  go(el.dataset.go);
}));
// a window closes on Escape and on a press outside it (a sheet it opened is
// part of it); pointerdown, so the click that opened it cannot close it
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !modal()) return;
  if (modal().querySelector('.sw-sheet:not([hidden])')) return;   // the sheet closes first
  closeModal();
});
document.addEventListener('pointerdown', e => {
  const m = modal();
  if (!m || m.contains(e.target) || e.target.closest('.sw-sheet, .nt-card, .sync-ask, .crash, .fav-flash')) return;
  closeModal();
});
// the window turning back into a screen when the window narrows to a phone
new MutationObserver(() => {
  const m = modal();
  if (m && !document.documentElement.classList.contains('dk')) { m.classList.remove('as-modal'); document.body.classList.remove('modal-open');
    $$('.step').forEach(s => { if (s !== m) s.classList.remove('on'); }); }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// One promise, not a flag. Two callers arriving together used to start two
// imports, and the second could run on a half-filled set of bindings - which
// is the kind of failure that only shows up on somebody else's connection.
let LIBS_ONCE = null;
function libs(){
  if (LIBS_ONCE) return LIBS_ONCE;
  LIBS_ONCE = import('../../vendor/crypto.js').then(function (m) {
    bip39 = { ...m.bip39, wordlist: m.wordlist };
    bip32 = m.bip32; base = m.base;
    ripe = { ripemd160: m.ripemd160 };
    sha  = { sha256: m.sha256 };
  }).catch(function (e) {
    LIBS_ONCE = null;          // a failed load must not poison every later try
    throw e;
  });
  return LIBS_ONCE;
}

// bip32, base, ripe and sha are filled in by libs() and read by crypto.js.
// Live bindings, so an importer sees the value libs() assigned, not the
// undefined it started as.
export { $, $$, base, bip32, bip39, buzz, dropKeyboard, go, libs, report, ripe, sha, tap, tg };

// A sheet open anywhere hides the tab bar. Most sheets live inside a screen,
// and a screen is its own layer under the bar, so the bar covered the bottom
// of the sheet - the add-token button, the transaction details. Hiding the bar
// while one is open fixes every sheet at once, the ones to come included.
(function sheetsOverTabs(){
  const sheets = [...document.querySelectorAll('.sw-sheet')];
  if (!sheets.length || typeof MutationObserver === 'undefined') return;
  const sync = () => document.body.classList.toggle('sheet-open', sheets.some(s => !s.hidden));
  const mo = new MutationObserver(sync);
  sheets.forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['hidden'] }));
  sync();
})();

/* Token pickers in a window (Swap, Send) unfold under the field that opened
   them, as a menu, instead of a second window over the first. The sheets stay
   what they are - the same list, search and handlers - only placed and shaped
   differently. On a phone they are bottom sheets, as before. */
(function pickerDrops(){
  const ids = ['sw-sheet', 'sd-sheet'];
  const sheets = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!sheets.length || typeof MutationObserver === 'undefined') return;
  let anchor = null;
  // capture: noted before the button's own handler opens the sheet
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.sw-pick, .sd-pick');
    if (a) anchor = a;
  }, true);
  const inner = s => s.querySelector('.sw-sheet-in');
  function clear(s){
    s.classList.remove('drop', 'up');
    const i = inner(s);
    if (i) ['left', 'width', 'top', 'bottom', 'maxHeight'].forEach(k => { i.style[k] = ''; });
  }
  function place(s){
    const i = inner(s);
    if (!i || !anchor || !document.documentElement.classList.contains('dk') || !anchor.closest('.step.as-modal')) { clear(s); return; }
    const r = (anchor.closest('.sw-side') || anchor).getBoundingClientRect();
    const below = innerHeight - r.bottom - 22, above = r.top - 22;
    const up = below < 280 && above > below;
    s.classList.add('drop');
    s.classList.toggle('up', up);
    i.style.left = r.left + 'px';
    i.style.width = r.width + 'px';
    i.style.top = up ? '' : (r.bottom + 6) + 'px';
    i.style.bottom = up ? (innerHeight - r.top + 6) + 'px' : '';
    i.style.maxHeight = Math.min(440, up ? above : below) + 'px';
  }
  const open = () => sheets.find(s => !s.hidden && s.classList.contains('drop'));
  sheets.forEach(s => new MutationObserver(() => {
    if (!s.hidden) {
      place(s);
      if (anchor) anchor.setAttribute('aria-expanded', 'true');
      const q = s.querySelector('.sw-find input');
      if (q && s.classList.contains('drop')) q.focus({ preventScroll: true });
    } else {
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      clear(s);
    }
  }).observe(s, { attributes: true, attributeFilter: ['hidden'] }));
  const shut = s => { const x = s.querySelector('.sw-x'); if (x) x.click(); else s.hidden = true; };
  // a press beside the menu folds it (the sheet's own backdrop, now clear)
  sheets.forEach(s => s.addEventListener('click', e => { if (e.target === s && s.classList.contains('drop')) shut(s); }));
  // Escape folds the menu and leaves the window open
  document.addEventListener('keydown', e => {
    const s = open();
    if (e.key === 'Escape' && s) { e.stopPropagation(); shut(s); if (anchor) anchor.focus({ preventScroll: true }); }
  }, true);
  addEventListener('resize', () => { const s = open(); if (s) place(s); });
  document.addEventListener('scroll', e => {
    const s = open();
    if (s && !s.contains(e.target)) place(s);
  }, true);
})();
