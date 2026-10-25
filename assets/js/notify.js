/* Wallet-wide notifications: one pop-up card at a time, a chime, a
   vibration in Telegram. Any module can raise one (the P2P watcher, the
   GRAM swap, later anything else); the card shows over every screen.

     notify({ key, kind, icon, label, title, text, actions })
       kind     'info' | 'success' | 'warn'      (colours the card)
       icon     a token symbol for the icon, optional
       label    small caps line above the title
       actions  [{ label, primary, run }]         (a Close is always added)
     chime(kind)   'alert' two tones up, 'done' three
   A card with a key already shown is not shown twice in this session. */
import { iconHTML, paintIcons } from './chain.js?v=42cc1f90';
import { $, buzz } from './shell.js?v=42cc1f90';

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

function notify(n){
  if (n.key && SHOWN.has(n.key)) return;
  if (n.key) SHOWN.add(n.key);
  QUEUE.push(n);
  if (!CURRENT) next();
}

function next(){
  const n = QUEUE.shift();
  CURRENT = n || null;
  const box = $('#nt-card');
  if (!n) { box.hidden = true; return; }
  const card = $('#nt-in');
  card.className = 'nt-in ' + (n.kind || 'info');
  $('#nt-ico').innerHTML = n.icon ? iconHTML({ sym: n.icon }) : '';
  paintIcons($('#nt-ico'));
  $('#nt-label').textContent = n.label || '';
  $('#nt-title').textContent = n.title || '';
  $('#nt-text').textContent = n.text || '';
  const btns = $('#nt-btns');
  btns.innerHTML = '';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'dust'; close.textContent = (n.actions && n.actions.length) ? 'Later' : 'OK';
  close.addEventListener('click', next);
  btns.appendChild(close);
  (n.actions || []).forEach(function (a) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn solid'; b.textContent = a.label;
    b.addEventListener('click', function () { next(); try { a.run(); } catch (e) {} });
    btns.appendChild(b);
  });
  box.hidden = false;
  chime(n.kind === 'success' ? 'done' : 'alert');
  buzz(n.kind === 'warn' ? 'warning' : 'success');
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
