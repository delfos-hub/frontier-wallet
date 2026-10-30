/* seed.js - showing the recovery phrase of the active wallet.

   Settings > Recovery phrase. The PIN is asked again even when the wallet is
   unlocked: whoever holds an unlocked phone should still not be one tap away
   from the phrase. The words are decrypted from the stored blob with that
   PIN, shown blurred until "Reveal" is pressed, and wiped from the page when
   the sheet closes, when the app goes to the background, or after a minute.
   Its element ids start with rp-: the Send screen's token picker already
   owns sd-sheet and sd-x, and sharing them opened that hidden picker instead.
   There is no copy button: a phrase on the clipboard can be read by any app
   that looks. A watched address has no phrase, so the row is hidden there. */
import { $, buzz, libs, tap } from './shell.js?v=fe408064';
import { S } from './state.js?v=fe408064';
import { decryptSeed } from './storage.js?v=fe408064';

const PIN_LEN = 8;
let TIMER = null;

function wipe(){
  clearTimeout(TIMER);
  const w = $('#rp-words');
  if (w) { w.innerHTML = ''; w.classList.add('blur'); }
  const r = $('#rp-reveal'); if (r) r.hidden = true;
  const step = $('#rp-step-pin'); if (step) step.hidden = false;
  const shown = $('#rp-step-words'); if (shown) shown.hidden = true;
  const pin = $('#rp-pin'); if (pin) pin.value = '';
  const m = $('#rp-msg'); if (m) m.textContent = '';
}
function close(){ wipe(); $('#rp-sheet').hidden = true; }
function open(){
  if (!S.SAVED || S.SAVED.watch || !S.SAVED.blob) return;
  tap();
  wipe();
  $('#rp-sheet').hidden = false;
  setTimeout(() => $('#rp-pin').focus(), 60);
}

async function check(){
  const pin = $('#rp-pin').value.replace(/\D/g, '');
  $('#rp-pin').value = pin;
  if (pin.length < PIN_LEN) return;
  const m = $('#rp-msg');
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
    setTimeout(() => { $('#rp-pin').value = ''; }, 500);
    return;
  }
  buzz('success');
  $('#rp-step-pin').hidden = true;
  $('#rp-step-words').hidden = false;
  const box = $('#rp-words');
  box.innerHTML = words.map((w, i) => '<span><i>' + (i + 1) + '</i>' + w.replace(/[^a-z]/g, '') + '</span>').join('');
  box.classList.add('blur');
  $('#rp-reveal').hidden = false;
  words = null;
  // a phrase left on screen is a phrase someone else can read
  TIMER = setTimeout(close, 60000);
}

const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
on('#set-seed', 'click', open);
on('#rp-x', 'click', close);
on('#rp-done', 'click', close);
on('#rp-sheet', 'click', function (e) { if (e.target === this) close(); });
on('#rp-pin', 'input', check);
on('#rp-reveal', 'click', function () {
  tap();
  $('#rp-words').classList.remove('blur');
  this.hidden = true;
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !$('#rp-sheet').hidden) close(); });
document.addEventListener('frontier:locked', () => { if (!$('#rp-sheet').hidden) close(); });
