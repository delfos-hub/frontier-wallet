/* seed.js - showing the recovery phrase of the active wallet.

   Settings > Recovery phrase. The PIN is asked again even when the wallet is
   unlocked: whoever holds an unlocked phone should still not be one tap away
   from the phrase. The words are decrypted from the stored blob with that
   PIN, shown blurred until "Reveal" is pressed, and wiped from the page when
   the sheet closes, when the app goes to the background, or after a minute.
   There is no copy button: a phrase on the clipboard can be read by any app
   that looks. A watched address has no phrase, so the row is hidden there. */
import { $, buzz, libs, tap } from './shell.js?v=a4472e0a';
import { S } from './state.js?v=a4472e0a';
import { decryptSeed } from './storage.js?v=a4472e0a';

const PIN_LEN = 8;
let TIMER = null;

function wipe(){
  clearTimeout(TIMER);
  const w = $('#sd-words');
  if (w) { w.innerHTML = ''; w.classList.add('blur'); }
  const r = $('#sd-reveal'); if (r) r.hidden = true;
  const step = $('#sd-step-pin'); if (step) step.hidden = false;
  const shown = $('#sd-step-words'); if (shown) shown.hidden = true;
  const pin = $('#sd-pin'); if (pin) pin.value = '';
  const m = $('#sd-msg'); if (m) m.textContent = '';
}
function close(){ wipe(); $('#sd-sheet').hidden = true; }
function open(){
  if (!S.SAVED || S.SAVED.watch || !S.SAVED.blob) return;
  tap();
  wipe();
  $('#sd-sheet').hidden = false;
  setTimeout(() => $('#sd-pin').focus(), 60);
}

async function check(){
  const pin = $('#sd-pin').value.replace(/\D/g, '');
  $('#sd-pin').value = pin;
  if (pin.length < PIN_LEN) return;
  const m = $('#sd-msg');
  m.textContent = 'Checking';
  m.style.color = 'var(--muted)';
  let words;
  try {
    await libs();
    words = (await decryptSeed(S.SAVED.blob, pin)).trim().split(/\s+/);
  } catch (e) {
    buzz('error');
    m.textContent = 'Wrong PIN';
    m.style.color = 'var(--red)';
    setTimeout(() => { $('#sd-pin').value = ''; }, 500);
    return;
  }
  buzz('success');
  $('#sd-step-pin').hidden = true;
  $('#sd-step-words').hidden = false;
  const box = $('#sd-words');
  box.innerHTML = words.map((w, i) => '<span><i>' + (i + 1) + '</i>' + w.replace(/[^a-z]/g, '') + '</span>').join('');
  box.classList.add('blur');
  $('#sd-reveal').hidden = false;
  words = null;
  // a phrase left on screen is a phrase someone else can read
  TIMER = setTimeout(close, 60000);
}

const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
on('#set-seed', 'click', open);
on('#sd-x', 'click', close);
on('#sd-done', 'click', close);
on('#sd-sheet', 'click', function (e) { if (e.target === this) close(); });
on('#sd-pin', 'input', check);
on('#sd-reveal', 'click', function () {
  tap();
  $('#sd-words').classList.remove('blur');
  this.hidden = true;
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !$('#sd-sheet').hidden) close(); });
document.addEventListener('frontier:locked', () => { if (!$('#sd-sheet').hidden) close(); });
