/* Wallet-wide notifications: one pop-up card at a time, a chime, a
   vibration in Telegram. Any module can raise one (the P2P watcher, the
   GRAM swap, later anything else); the card shows over every screen.

     notify({ key, kind, theme, live, icon, label, title, text, valid, actions })
       kind     'info' | 'success' | 'warn'      (colours the card)
       theme    an extra look, e.g. 'gram'       (optional)
       live     true: a pulsing dot, for something waiting on the user
       icon     a token symbol for the icon, optional
       label    small line above the title
       text     a string, or a function called when the card is shown, so a
                countdown is right even if the card waited in the queue
       valid    optional () => bool, checked when the card's turn comes: a
                card that no longer applies (the deal was answered, the
                window closed) is dropped instead of shown late
       actions  [{ label, primary, run }]         (a Later/OK is always added)
     chime(kind)   'alert' two tones up, 'done' three

   Cards wait while the wallet is locked (nothing is shown over the PIN
   screen) and while a sheet is open (a confirmation is never covered); they
   come up, in order, as soon as both are clear. A card with a key already
   queued or shown is not shown twice in this session. */
import { iconHTML, paintIcons } from './chain.js?v=73915718';
import { $, buzz } from './shell.js?v=73915718';

let AUDIO = null;
document.addEventListener('pointerdown', function () {
  if (!AUDIO) { try { AUDIO = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
}, { once: true });

function chime(kind){
  if (!AUDIO) return;
  const notes = kind === 'done' ? [[784, 0], [988, 0.13], [1319, 0.26]] : [[880, 0], [1320, 0.16]];
  try {
    const t0 = AUDIO.currentTime;
    notes.forEach(function (n) {
      const o = AUDIO.createOscillator(), g = AUDIO.createGain();
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t0 + n[1]);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + n[1] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.35);
      o.connect(g).connect(AUDIO.destination);
      o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.4);
    });
  } catch (e) {}
}

const QUEUE = [], SHOWN = new Set();
let CURRENT = null;
let READY = false;          // the wallet is open (past the PIN screen)
let WAIT = null;

// openWallet (tokens.js) announces an open wallet; boot.js announces a lock
document.addEventListener('frontier:wallet', function () { READY = true; pump(); });
document.addEventListener('frontier:locked', function () {
  READY = false;
  if (CURRENT) { QUEUE.unshift(CURRENT); CURRENT = null; $('#nt-card').hidden = true; }
});

const sheetOpen = () => !!document.querySelector('.sw-sheet:not([hidden])');
const canShow = () => READY && !sheetOpen();

function notify(n){
  if (n.key && SHOWN.has(n.key)) return;
  if (n.key) SHOWN.add(n.key);
  QUEUE.push(n);
  pump();
}

function pump(){
  if (CURRENT || !QUEUE.length) return;
  if (!canShow()) {
    if (!WAIT) WAIT = setInterval(function () {
      if (!QUEUE.length) { clearInterval(WAIT); WAIT = null; return; }
      if (canShow()) { clearInterval(WAIT); WAIT = null; pump(); }
    }, 700);
    return;
  }
  next();
}

function next(){
  let n = null;
  while (QUEUE.length) {
    const c = QUEUE.shift();
    let ok = true;
    if (typeof c.valid === 'function') { try { ok = !!c.valid(); } catch (e) { ok = false; } }
    if (ok) { n = c; break; }
  }
  CURRENT = n;
  const box = $('#nt-card');
  if (!n) { box.hidden = true; return; }
  $('#nt-in').className = 'nt-in ' + (n.kind || 'info') + (n.theme ? ' ' + n.theme : '');
  $('#nt-ico').innerHTML = n.icon ? iconHTML({ sym: n.icon }) : '';
  paintIcons($('#nt-ico'));
  const dot = $('#nt-dot');
  if (dot) dot.hidden = !n.live;
  $('#nt-label').textContent = n.label || '';
  $('#nt-title').textContent = n.title || '';
  let text = n.text;
  if (typeof text === 'function') { try { text = text(); } catch (e) { text = ''; } }
  $('#nt-text').textContent = text || '';
  const btns = $('#nt-btns');
  btns.innerHTML = '';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'dust'; close.textContent = (n.actions && n.actions.length) ? 'Later' : 'OK';
  close.addEventListener('click', done);
  btns.appendChild(close);
  (n.actions || []).forEach(function (a) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn solid'; b.textContent = a.label;
    b.addEventListener('click', function () { done(); try { a.run(); } catch (e) {} });
    btns.appendChild(b);
  });
  box.hidden = false;
  chime(n.kind === 'success' ? 'done' : 'alert');
  buzz(n.kind === 'warn' ? 'warning' : 'success');
}

// the card is closed: the next one comes when nothing is in its way
function done(){
  CURRENT = null;
  $('#nt-card').hidden = true;
  pump();
}

// a small red count on any element (an action button, a card)
function badge(el, n){
  if (!el) return;
  let b = el.querySelector('.nt-badge');
  if (!b) { b = document.createElement('span'); b.className = 'nt-badge'; el.appendChild(b); }
  b.textContent = n > 9 ? '9+' : String(n);
  b.hidden = !n;
}

export { notify, chime, badge };
