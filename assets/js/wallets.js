/* wallets.js - several wallets on one device, and watching an address.

   Tap the wallet name at the top of home: every wallet on this device, its
   last known total, a check on the active one. Tap another to switch - a
   wallet with a key asks its own PIN (keys are stored apart, each under its
   own PIN), a watched address opens at once. From the same sheet: create,
   import, watch, rename, remove.

   A watched address has no key. Balances, DeFi, NFTs and history all show;
   everything that would sign is switched off (body.is-watch), and the header
   says "Read only". Importing that address's phrase later turns it into a
   full wallet in place. */
import { $, go, tap } from './shell.js?v=6955f7e7';
import { S } from './state.js?v=6955f7e7';
import { activeId, removeWallet, renameWallet, setActive, short, wallets } from './storage.js?v=6955f7e7';
import { dots } from './onboarding.js?v=6955f7e7';
import { openWallet } from './tokens.js?v=6955f7e7';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// one colour per address, so wallets can be told apart at a glance
function hue(addr){
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}
const ava = addr => 'linear-gradient(135deg,hsl(' + hue(addr) + ' 80% 55%),hsl(' + ((hue(addr) + 70) % 360) + ' 85% 60%))';
function lastTotal(addr){
  try { const v = Number(localStorage.getItem('fw:tot:' + addr)); return isFinite(v) && v > 0 ? v : null; } catch (e) { return null; }
}
const usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Go into the active wallet: a PIN for a key, straight in for a watch.
   Whatever was unlocked before is dropped first. */
function enter(){
  const w = S.SAVED;
  S.MNEMONIC = null; S.PASS = null;
  document.dispatchEvent(new CustomEvent('frontier:locked'));
  if (!w) { go('welcome'); backLink(); return; }
  if (w.watch) { openWallet(w.addr); return; }
  const pu = $('#pu');
  if (pu) pu.value = '';
  dots('pinrowU', 0);
  const m = $('#umsg'); if (m) m.textContent = '';
  go('unlock');
  switchLink();
  setTimeout(() => { if (pu) pu.focus(); }, 60);
}

/* ---------------- header ---------------- */
function header(){
  const w = S.SAVED;
  document.body.classList.toggle('is-watch', !!(w && w.watch));
  const n = $('#wl-name');
  if (n && w) n.textContent = w.name || 'Wallet';
  const a = document.querySelector('.wtop .wava');
  if (a && w) a.style.background = ava(w.addr);
}
document.addEventListener('frontier:wallet', header);

/* ---------------- the sheet ---------------- */
function draw(){
  const list = wallets(), act = activeId();
  $('#wl-list').innerHTML = list.map(function (w) {
    const t = lastTotal(w.addr);
    return '<div class="wl-row' + (w.id === act ? ' on' : '') + '" data-id="' + w.id + '">' +
      '<span class="wl-ava" style="background:' + ava(w.addr) + '"></span>' +
      '<span class="wl-mid"><b>' + esc(w.name) + (w.watch ? '<i class="wl-tag">Watch</i>' : '') + '</b>' +
        '<span>' + short(w.addr) + '</span></span>' +
      '<span class="wl-r">' + (t !== null ? '<b>' + usd(t) + '</b>' : '') +
        (w.id === act ? '<svg class="wl-check" viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>' : '') + '</span>' +
      '<button type="button" class="wl-more" data-more="' + w.id + '" aria-label="Wallet options"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>' +
      '<div class="wl-acts" hidden><button type="button" data-rename="' + w.id + '">Rename</button>' +
        '<button type="button" class="danger" data-remove="' + w.id + '">Remove</button></div>' +
    '</div>';
  }).join('');
}
function open(){ tap(); draw(); $('#wl-sheet').hidden = false; }
function close(){ $('#wl-sheet').hidden = true; }

async function pick(id){
  close();
  if (id === activeId() && S.SAVED && (S.SAVED.watch || S.MNEMONIC)) return;
  await setActive(id);
  enter();
}

$('#wl-list').addEventListener('click', async function (e) {
  const more = e.target.closest('[data-more]');
  if (more) {
    tap();
    const acts = more.parentNode.querySelector('.wl-acts');
    acts.hidden = !acts.hidden;
    return;
  }
  const ren = e.target.closest('[data-rename]');
  if (ren) {
    const w = wallets().filter(x => x.id === ren.dataset.rename)[0];
    const name = prompt('Name for this wallet', w ? w.name : '');
    if (name !== null) { await renameWallet(ren.dataset.rename, name); header(); draw(); }
    return;
  }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const w = wallets().filter(x => x.id === rm.dataset.remove)[0];
    if (!w) return;
    const msg = w.watch ? 'Stop watching ' + w.name + '?'
      : 'Remove ' + w.name + ' from this device? Only its recovery phrase can bring it back.';
    if (!confirm(msg)) return;
    const was = activeId() === w.id;
    await removeWallet(w.id);
    if (was) { close(); enter(); } else draw();
    return;
  }
  const row = e.target.closest('.wl-row[data-id]');
  if (row) { tap(); pick(row.dataset.id); }
});

const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
on('#wl-open', 'click', open);
on('#set-wallets', 'click', open);
on('#wl-x', 'click', close);
on('#wl-sheet', 'click', function (e) { if (e.target === this) close(); });
// adding a wallet goes through the same screens as the first one
on('#wl-create', 'click', () => { close(); go('setup'); });
on('#wl-import', 'click', () => { close(); go('import'); });
on('#wl-watch', 'click', () => { close(); go('watch'); });

/* From the unlock screen: another wallet instead of this one. From the
   welcome screen, when wallets already exist: back to them. */
function switchLink(){
  const b = $('#unlock-switch');
  if (b) b.hidden = wallets().length < 2;
}
function backLink(){
  const b = $('#welcome-back');
  if (b) b.hidden = !wallets().length;
}
on('#unlock-switch', 'click', open);
on('#welcome-back', 'click', () => { tap(); enter(); });
// the welcome screen is reached from every "back" of the add-a-wallet flows
document.querySelectorAll('[data-go="welcome"]').forEach(b => b.addEventListener('click', backLink));

export { enter, header, switchLink, backLink };
