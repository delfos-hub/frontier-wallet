/* Favorites: up to 6 tokens pinned under Core assets (Nans's idea).

   A star on a token row pins it (on a phone, a long press on the row); a
   card opens that token's page; on a desktop the cards reorder by dragging.
   Kept on this device, per wallet: fw:fav:<address> holds the keys with the
   symbol and logo seen last, so a token sold off still shows its card.

   Prices come from the home list (the same arithmetic as everywhere). There
   is no price history for these tokens anywhere we read, so each price seen
   is kept here (fw:favpx, one point per 10 min, 26 h): the change and the
   line are this device's own record, labelled with how far back it reaches,
   and appear once it covers an hour. LUNC and USTC are Core assets already. */
import { $ } from './shell.js?v=50a47d51';
import { S } from './state.js?v=50a47d51';
import { esc, iconHTML, paintIcons } from './chain.js?v=50a47d51';
import { fiatOf, heldTokens, tokKey } from './tokens.js?v=50a47d51';

const MAX = 6;
const CORE = ['native:uluna', 'native:uusd'];
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3 1.1-6.4L2.8 9.5l6.4-.9z"/></svg>';
const now = () => Math.floor(Date.now() / 1000);
const addr = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';

function load(){
  try { const v = JSON.parse(localStorage.getItem('fw:fav:' + addr()) || '[]'); return Array.isArray(v) ? v.filter(f => f && f.k).slice(0, MAX) : []; }
  catch (e) { return []; }
}
function save(list){ try { localStorage.setItem('fw:fav:' + addr(), JSON.stringify(list.slice(0, MAX))); } catch (e) {} }
const has = k => load().some(f => f.k === k);

// this device's own price record for the favorites
function pxBook(){ try { return JSON.parse(localStorage.getItem('fw:favpx') || '{}') || {}; } catch (e) { return {}; } }
function record(k, px){
  if (!(px > 0)) return;
  const book = pxBook(), t = now();
  const pts = (book[k] || []).filter(p => t - p[0] < 26 * 3600);
  if (!pts.length || t - pts[pts.length - 1][0] >= 600) pts.push([t, px]);
  else pts[pts.length - 1][1] = px;           // the latest point follows the price
  book[k] = pts;
  try { localStorage.setItem('fw:favpx', JSON.stringify(book)); } catch (e) {}
}
// change over what the record covers (up to 24 h); null under an hour
function change(k){
  const pts = (pxBook()[k] || []).filter(p => now() - p[0] <= 24 * 3600 + 600);
  if (pts.length < 2) return null;
  const span = pts[pts.length - 1][0] - pts[0][0];
  if (span < 3600) return null;
  return { pct: (pts[pts.length - 1][1] / pts[0][1] - 1) * 100, hours: Math.min(24, Math.round(span / 3600)), pts: pts };
}

function money(v){
  if (v == null || !isFinite(v)) return '\u2014';
  if (v >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (v === 0) return '$0.00';
  // three significant digits, never in exponent form ($2.52e-7 read badly)
  const d = Math.min(18, Math.max(2, 2 - Math.floor(Math.log10(v))));
  return '$' + (d > 2 ? v.toFixed(d).replace(/(\.\d*?[1-9])0+$/, '$1') : v.toFixed(2));
}
function qty(v){
  if (!(v > 0)) return '0';
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : 6 });
}
function line(pts, up){
  if (!pts || pts.length < 3) return '';
  const vals = pts.map(p => p[1]), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const xs = pts.map(p => (p[0] - pts[0][0]) / Math.max(1, pts[pts.length - 1][0] - pts[0][0]) * 100);
  const ys = vals.map(v => 28 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * 24);
  const d = 'M' + xs.map((x, i) => x.toFixed(1) + ',' + ys[i].toFixed(1)).join(' L');
  const col = up ? '#34D399' : '#F87171', id = 'fvg' + Math.random().toString(36).slice(2, 8);
  return '<svg class="fav-ln" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + d + ' L100,30 L0,30 Z" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
}

let SEC = null;
function section(){
  if (!SEC) {
    SEC = document.createElement('section');
    SEC.className = 'fav'; SEC.id = 'fav';
  }
  // right under Core assets, wherever the layout has put them
  const core = $('#core');
  if (core && SEC.previousElementSibling !== core) core.after(SEC);
  return SEC;
}

function render(){
  const core = $('#core');
  if (!core || !addr()) { if (SEC) SEC.hidden = true; return; }
  const sec = section(); sec.hidden = false;
  const held = {}; heldTokens().forEach(t => { held[tokKey(t)] = t; });
  const favs = load();
  let changed = false;
  favs.forEach(f => { const t = held[f.k]; if (t && (f.sym !== t.sym || f.logo !== t.logo)) { f.sym = t.sym; f.logo = t.logo; changed = true; } });
  if (changed) save(favs);
  const head = '<div class="fav-head"><h3>' + STAR + '<span>Favorites</span></h3>' +
    (favs.length ? '<span class="fav-n">' + favs.length + '/' + MAX + '<span class="fav-drag"> \u00b7 <span>drag to reorder</span></span></span>' : '') + '</div>';
  if (!favs.length) {
    sec.innerHTML = head + '<div class="fav-empty">' + STAR + '<div><b>Pin the tokens you watch</b><br>' +
      '<span>Tap the star on a token to keep it here, under LUNC and USTC. Up to 6, kept on this device.</span></div></div>';
    return;
  }
  let html = '<div class="fav-grid">';
  favs.forEach((f, i) => {
    const t = held[f.k] || { sym: f.sym, logo: f.logo, v: 0, contract: f.k.slice(0, 5) === 'cw20:' ? f.k.slice(5) : undefined, denom: f.k.slice(0, 7) === 'native:' ? f.k.slice(7) : undefined };
    const unit = held[f.k] ? fiatOf(Object.assign({}, t, { v: 1 })) : null;
    if (unit) record(f.k, unit);
    const ch = change(f.k), up = !ch || ch.pct >= 0;
    html += '<div class="fav-card" draggable="true" data-k="' + esc(f.k) + '" data-i="' + i + '" role="button" tabindex="0">' +
      '<div class="fav-top">' + iconHTML(t) + '<b>' + esc(t.sym || '?') + '</b>' +
      '<button class="fav-off" type="button" title="Remove from favorites" data-k="' + esc(f.k) + '">' + STAR + '</button></div>' +
      '<div class="fav-v">' + money(unit) + '</div>' +
      '<div class="fav-q">' + qty(t.v) + ' ' + esc(t.sym || '') + (t.v > 0 && fiatOf(t) != null ? ' \u00b7 ' + money(fiatOf(t)) : '') + '</div>' +
      // the change and how far back the record reaches, over the line: the
      // ticker and the price keep their own full lines
      (ch ? line(ch.pts, up) + '<span class="fav-span"><b class="fav-ch ' + (up ? 'up' : 'dn') + '">' + (ch.pct >= 0 ? '+' : '') + ch.pct.toFixed(1) + '%</b>' + ch.hours + 'h</span>' : '<div class="fav-nol"></div>') + '</div>';
  });
  if (favs.length < MAX) html += '<button class="fav-add" type="button"><i>+</i><span>Add a token</span><small>star it in the list</small></button>';
  sec.innerHTML = head + html + '</div>';
  paintIcons(sec);
}

function toggle(k, meta){
  if (!k || CORE.indexOf(k) >= 0) return;
  const favs = load(), i = favs.findIndex(f => f.k === k);
  if (i >= 0) favs.splice(i, 1);
  else if (favs.length >= MAX) { flash('Up to 6 favorites. Remove one first.'); return; }
  else favs.push(Object.assign({ k: k }, meta || {}));
  save(favs);
  try { const h = window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback; if (h) h.impactOccurred('light'); } catch (e) {}
  stars(); render();
}
function flash(msg){
  const sec = section(), n = document.createElement('div');
  n.className = 'fav-flash'; n.textContent = msg;
  sec.prepend(n); setTimeout(() => n.remove(), 2600);
}

/* the stars on the home list: one per row, lit on a favorite */
const list = $('#tok-list');
function keyOfRow(li){
  const k = li.getAttribute('data-k');
  const t = heldTokens().filter(x => (x.contract || x.denom || ('sym:' + x.sym)) === k)[0];
  return t ? { key: tokKey(t), t: t } : null;
}
function stars(){
  if (!list) return;
  list.querySelectorAll('li.row[data-k]').forEach(li => {
    const r = keyOfRow(li);
    let s = li.querySelector('.row-star');
    if (!r || CORE.indexOf(r.key) >= 0) { if (s) s.remove(); return; }
    if (!s) {
      s = document.createElement('button');
      s.type = 'button'; s.className = 'row-star'; s.innerHTML = STAR;
      li.appendChild(s);
    }
    const on = has(r.key);
    s.classList.toggle('on', on);
    s.title = on ? 'Remove from favorites' : 'Add to favorites';
  });
}
let T = 0;
const soon = () => { clearTimeout(T); T = setTimeout(() => { stars(); render(); }, 250); };

if (list) {
  // a star: toggle, and the row underneath does not open
  list.addEventListener('click', e => {
    const s = e.target.closest('.row-star');
    if (s) {
      e.preventDefault(); e.stopPropagation();
      const r = keyOfRow(s.closest('li.row')); if (r) toggle(r.key, { sym: r.t.sym, logo: r.t.logo });
      return;
    }
    if (PRESSED) { e.preventDefault(); e.stopPropagation(); PRESSED = false; }
  }, true);
  new MutationObserver(soon).observe(list, { childList: true, subtree: true, characterData: true });
}

// a long press on a row (touch screens, where the star only shows when lit)
let PRESS = 0, PRESSED = false, START = null;
if (list) {
  list.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const li = e.target.closest('li.row[data-k]');
    if (!li || e.target.closest('.row-star')) return;
    START = [e.clientX, e.clientY];
    clearTimeout(PRESS);
    PRESS = setTimeout(() => {
      const r = keyOfRow(li);
      if (r && CORE.indexOf(r.key) < 0) { PRESSED = true; toggle(r.key, { sym: r.t.sym, logo: r.t.logo }); }
    }, 550);
  }, { passive: true });
  const cancel = () => clearTimeout(PRESS);
  list.addEventListener('pointerup', cancel, { passive: true });
  list.addEventListener('pointercancel', cancel, { passive: true });
  list.addEventListener('pointermove', e => {
    if (START && Math.hypot(e.clientX - START[0], e.clientY - START[1]) > 8) cancel();
  }, { passive: true });
  list.addEventListener('contextmenu', e => { if (PRESSED) e.preventDefault(); });
}

/* the cards: open, remove, add, reorder */
document.addEventListener('click', e => {
  const sec = SEC; if (!sec || !sec.contains(e.target)) return;
  const off = e.target.closest('.fav-off');
  if (off) { e.stopPropagation(); toggle(off.getAttribute('data-k')); return; }
  if (e.target.closest('.fav-add')) {
    const box = $('#tok-list'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash('Tap the star on a token in the list.');
    return;
  }
  const card = e.target.closest('.fav-card');
  if (card) document.dispatchEvent(new CustomEvent('frontier:token', { detail: { key: card.getAttribute('data-k') } }));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.closest || !e.target.closest('.fav-card')) return;
  e.target.click();
});
let DRAG = -1;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('.fav-card'); if (!c) return;
  DRAG = Number(c.dataset.i); c.classList.add('drag');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.k); } catch (x) {}
});
document.addEventListener('dragover', e => { if (DRAG >= 0 && e.target.closest && e.target.closest('.fav-card')) e.preventDefault(); });
document.addEventListener('drop', e => {
  const c = e.target.closest && e.target.closest('.fav-card');
  if (DRAG < 0 || !c) return;
  e.preventDefault();
  const to = Number(c.dataset.i), favs = load();
  if (to !== DRAG && favs[DRAG]) { const [m] = favs.splice(DRAG, 1); favs.splice(to, 0, m); save(favs); }
  DRAG = -1; render();
});
document.addEventListener('dragend', () => { DRAG = -1; document.querySelectorAll('.fav-card.drag').forEach(c => c.classList.remove('drag')); });

document.addEventListener('frontier:wallet', () => { stars(); render(); });
window.addEventListener('resize', () => { if (SEC) section(); });
render();

export { toggle as toggleFavorite };
