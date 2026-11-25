/* Favorites: up to 6 tokens pinned under Core assets (Nans's idea).

   A star on a token row pins it (on a phone, a long press on the row); a
   card opens that token's page; on a desktop the cards reorder by dragging.
   Kept per wallet: fw:fav:<address> holds the keys with the symbol and logo
   seen last, so a token sold off still shows its card. The list follows the
   wallet to its other devices through sync.js (encrypted; a watched address
   and a wallet with sync turned off keep it on this device only).

   Prices come from the home list (the same arithmetic as everywhere). There
   is no price history for these tokens anywhere we read, so each price seen
   is kept here (fw:favpx, one point per 10 min, 26 h) for every priced token
   in the list, so a token starred later already has its line: the change and
   the line are this device's own record, labelled with how far back it
   reaches. The line shows from 15 min of record, the % change from an hour. LUNC and USTC are Core assets already. */
import { $ } from './shell.js?v=bc7ca4f7';
import { S } from './state.js?v=bc7ca4f7';
import { esc, iconHTML, paintIcons } from './chain.js?v=bc7ca4f7';
import { fiatOf, heldTokens, tokKey } from './tokens.js?v=bc7ca4f7';
import { changed as synced, section as syncSection, syncOn, offer as offerSync } from './sync.js?v=bc7ca4f7';

const MAX = 6;
const CORE = ['native:uluna', 'native:uusd'];
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3 1.1-6.4L2.8 9.5l6.4-.9z"/></svg>';
const now = () => Math.floor(Date.now() / 1000);
const addr = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
// the home list's tokens, only when they are this wallet's: right after a
// switch the list can still hold the previous wallet's rows (CodeRabbit)
function mine(){
  const list = heldTokens();
  return list && list.__addr && list.__addr !== addr() ? [] : list;
}
// a finger long-presses a row; a mouse uses the star (hover shows it)
const TOUCH = !(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

// Stored values are checked for shape, not only parsed: an older or
// hand-edited value must not leave the section blank (CodeRabbit).
// The same check stands between this device and a list another one sent.
function shape(v){
  if (!Array.isArray(v)) return [];
  const seen = {};
  return v.filter(f => f && typeof f.k === 'string' && /^(cw20:|native:)/.test(f.k) && !seen[f.k] && (seen[f.k] = 1))
    .map(f => ({ k: f.k, sym: typeof f.sym === 'string' ? f.sym : '', logo: typeof f.logo === 'string' ? f.logo : undefined }))
    .slice(0, MAX);
}
function loadOf(a){
  try { return shape(JSON.parse(localStorage.getItem('fw:fav:' + a) || '[]')); } catch (e) { return []; }
}
function saveOf(a, list){ try { localStorage.setItem('fw:fav:' + a, JSON.stringify(list.slice(0, MAX))); } catch (e) {} }
const load = () => loadOf(addr());
const save = list => saveOf(addr(), list);
const has = k => load().some(f => f.k === k);

// this device's own price record for the favorites
function pxBook(){
  try {
    const v = JSON.parse(localStorage.getItem('fw:favpx') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const k in v) if (Array.isArray(v[k])) out[k] = v[k].filter(p => Array.isArray(p) && isFinite(p[0]) && p[1] > 0);
    return out;
  } catch (e) { return {}; }
}
// one write for many prices; tokens no longer seen for 26 h drop out. The
// list repaints often, so the latest point following the price is written at
// most every 2 min; a new 10-minute point is always written.
const PX_KEYS = 80;
let PX_AT = 0;
function recordAll(prices){
  const book = pxBook(), t = now();
  let dirty = false, fresh = false;
  for (const k in prices) {
    const px = prices[k];
    if (!(px > 0)) continue;
    const pts = (book[k] || []).filter(p => t - p[0] < 26 * 3600);
    if (!pts.length || t - pts[pts.length - 1][0] >= 600) { pts.push([t, px]); fresh = true; }
    else if (pts[pts.length - 1][1] !== px) { pts[pts.length - 1][1] = px; dirty = true; }
    book[k] = pts;
  }
  if (dirty && !fresh && t - PX_AT < 120) dirty = false;
  if (fresh) dirty = true;
  for (const k in book) {
    const pts = book[k].filter(p => t - p[0] < 26 * 3600);
    if (pts.length) book[k] = pts; else { delete book[k]; dirty = true; }
  }
  // bounded: the keys seen most recently are kept
  const keys = Object.keys(book);
  if (keys.length > PX_KEYS) {
    keys.sort((a, b) => book[b][book[b].length - 1][0] - book[a][book[a].length - 1][0])
      .slice(PX_KEYS).forEach(k => { delete book[k]; });
    dirty = true;
  }
  if (dirty) { PX_AT = t; try { localStorage.setItem('fw:favpx', JSON.stringify(book)); } catch (e) {} }
  return book;
}

// change over what the record covers (up to 24 h): the line from 15 min,
// the % only once it covers an hour (pct null before that)
// book: the record already read for this repaint (it can hold 80 tokens x
// 26 h, so it is parsed once per render, not once per card)
function change(k, book){
  const pts = ((book || pxBook())[k] || []).filter(p => now() - p[0] <= 24 * 3600 + 600);
  if (pts.length < 2) return null;
  const span = pts[pts.length - 1][0] - pts[0][0];
  if (span < 900) return null;
  return { pct: span >= 3600 ? (pts[pts.length - 1][1] / pts[0][1] - 1) * 100 : null,
    hours: Math.min(24, Math.round(span / 3600)), span: span, pts: pts };
}
const spanLabel = ch => ch.span >= 3600 ? ch.hours + 'h' : Math.round(ch.span / 60) + 'm';

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
  const held = {}; mine().forEach(t => { held[tokKey(t)] = t; });
  const favs = load();
  let changed = false;
  favs.forEach(f => { const t = held[f.k]; if (t && (f.sym !== t.sym || f.logo !== t.logo)) { f.sym = t.sym; f.logo = t.logo; changed = true; } });
  if (changed) save(favs);
  const head = '<div class="fav-head"><h3>' + STAR + '<span>Favorites</span></h3>' +
    (favs.length ? '<span class="fav-n">' + favs.length + '/' + MAX + '<span class="fav-drag"> \u00b7 <span>drag to reorder</span></span></span>' : '') + '</div>';
  // every priced token in the list, not only the favorites (one write), and
  // before the empty state: the first token starred then already has its line
  const px = {};
  mine().forEach(t => { const u = fiatOf(Object.assign({}, t, { v: 1 })); if (u > 0) px[tokKey(t)] = u; });
  const book = recordAll(px);
  if (!favs.length) {
    sec.innerHTML = head + '<div class="fav-empty">' + STAR + '<div><b>Pin the tokens you watch</b><br>' +
      '<span>' + (TOUCH ? 'Long-press a token in the list to keep it here, under LUNC and USTC.' : 'Tap the star on a token to keep it here, under LUNC and USTC.') +
      ' ' + (syncOn() ? 'Up to 6, synced between your devices (encrypted).' : 'Up to 6, kept on this device.') + '</span></div></div>';
    return;
  }
  let html = '<div class="fav-grid">';
  favs.forEach((f, i) => {
    const t = held[f.k] || { sym: f.sym || '?', logo: f.logo, v: 0, contract: f.k.slice(0, 5) === 'cw20:' ? f.k.slice(5) : undefined, denom: f.k.slice(0, 7) === 'native:' ? f.k.slice(7) : undefined };
    const unit = held[f.k] ? fiatOf(Object.assign({}, t, { v: 1 })) : null;
    const ch = change(f.k, book), up = !ch || ch.pct === null || ch.pct >= 0;
    html += '<div class="fav-card" draggable="true" data-k="' + esc(f.k) + '" data-i="' + i + '" role="button" tabindex="0">' +
      '<div class="fav-top">' + iconHTML(t) + '<b>' + esc(t.sym || '?') + '</b>' +
      '<button class="fav-off" type="button" title="Remove from favorites" data-k="' + esc(f.k) + '">' + STAR + '</button></div>' +
      // the change sits beside the price and the span under it, so the chart
      // keeps the bottom of the card to itself (nothing drawn over the line)
      '<div class="fav-row"><div class="fav-v">' + money(unit) + '</div>' +
        (ch && ch.pct !== null ? '<b class="fav-ch ' + (up ? 'up' : 'dn') + '">' + (ch.pct >= 0 ? '+' : '') + ch.pct.toFixed(1) + '%</b>' : '') + '</div>' +
      '<div class="fav-q"><span>' + qty(t.v) + ' ' + esc(t.sym || '') + (t.v > 0 && fiatOf(t) != null ? ' \u00b7 ' + money(fiatOf(t)) : '') + '</span>' +
        (ch ? '<em>' + spanLabel(ch) + '</em>' : '') + '</div>' +
      (ch ? line(ch.pts, up) : '<div class="fav-nol"></div>') + '</div>';
  });
  if (favs.length < MAX) html += '<button class="fav-add" type="button"><i>+</i><span>Add a token</span><small>' + (TOUCH ? 'long-press it in the list' : 'star it in the list') + '</small></button>';
  sec.innerHTML = head + html + '</div>';
  paintIcons(sec);
}

function toggle(k, meta){
  if (!k || CORE.indexOf(k) >= 0) return;
  const favs = load(), i = favs.findIndex(f => f.k === k);
  if (i >= 0) favs.splice(i, 1);
  else if (favs.length >= MAX) { flash('Up to 6 favorites. Remove one first.'); return false; }
  else favs.push(Object.assign({ k: k }, meta || {}));
  save(favs); synced('fav');
  try { const h = window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback; if (h) h.impactOccurred('light'); } catch (e) {}
  stars(); render(); if (PAGE) paintPage();
  if (i < 0) offerSync();                 // the first favorite asks about sync, once
  return true;
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
  const t = mine().filter(x => (x.contract || x.denom || ('sym:' + x.sym)) === k)[0];
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
  // some touch browsers send no click after a long press: the flag clears
  // itself, or the next ordinary tap would be swallowed (CodeRabbit)
  const cancel = () => { clearTimeout(PRESS); if (PRESSED) setTimeout(() => { PRESSED = false; }, 700); };
  list.addEventListener('pointerup', cancel, { passive: true });
  list.addEventListener('pointercancel', cancel, { passive: true });
  list.addEventListener('pointermove', e => {
    // a drift only stops a press still counting; once it has toggled, the
    // flag waits for the release (Pablo, #47)
    if (START && Math.hypot(e.clientX - START[0], e.clientY - START[1]) > 8) clearTimeout(PRESS);
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
    flash(TOUCH ? 'Long-press a token in the list.' : 'Tap the star on a token in the list.');
    return;
  }
  const card = e.target.closest('.fav-card');
  if (card) document.dispatchEvent(new CustomEvent('frontier:token', { detail: { key: card.getAttribute('data-k') } }));
});
// the card itself (role=button) opens on Enter and Space; its own buttons keep
// their native keys, so nothing fires twice
document.addEventListener('keydown', e => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList || !e.target.classList.contains('fav-card')) return;
  e.preventDefault(); e.target.click();
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
  if (to !== DRAG && favs[DRAG]) { const [m] = favs.splice(DRAG, 1); favs.splice(to, 0, m); save(favs); synced('fav'); }
  DRAG = -1; render();
});
document.addEventListener('dragend', () => { DRAG = -1; document.querySelectorAll('.fav-card.drag').forEach(c => c.classList.remove('drag')); });

/* the star on a token's own page, in its top bar */
let PAGE = '';
function pageStar(){
  const bar = document.querySelector('#st-token .bar');
  if (!bar) return null;
  let b = bar.querySelector('.tk-fav');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button'; b.className = 'tk-fav'; b.innerHTML = STAR + '<span></span>';
    b.addEventListener('click', () => {
      const sym = (document.getElementById('tk-sym') || {}).textContent || '';
      const ok = toggle(PAGE, { sym: sym });
      paintPage();
      // the limit said where it is seen: on this button, not on Home
      if (ok === false) { b.querySelector('span').textContent = 'Up to 6 favorites'; b.classList.add('full'); setTimeout(() => { b.classList.remove('full'); paintPage(); }, 2600); }
    });
    bar.appendChild(b);
  }
  return b;
}
function paintPage(){
  const b = pageStar(); if (!b) return;
  b.hidden = !PAGE || CORE.indexOf(PAGE) >= 0;
  const on = has(PAGE);
  b.classList.toggle('on', on);
  b.querySelector('span').textContent = on ? 'In favorites' : 'Add to favorites';
}
document.addEventListener('frontier:token', e => { PAGE = (e.detail && e.detail.key) || ''; paintPage(); });

document.addEventListener('frontier:wallet', () => { stars(); render(); paintPage(); });
document.addEventListener('frontier:sync', () => render());

/* The list as the other devices of this wallet get it (sync.js). What is
   sent: the keys with symbol and logo address, never an embedded image. A
   list that arrives is drawn at once when it is the open wallet's. */
const lean = list => list.map(f => {
  const o = { k: f.k, sym: (f.sym || '').slice(0, 40) };
  if (f.logo && /^(https:\/\/|assets\/)/.test(f.logo) && f.logo.length <= 300) o.logo = f.logo;
  return o;
});
syncSection('fav', {
  read: a => lean(loadOf(a)),
  write: (a, v) => { saveOf(a, shape(v)); if (a === addr()) { stars(); render(); if (PAGE) paintPage(); } },
  clean: v => lean(shape(v)),
  empty: v => !v.length,
  // first meeting of two lists: theirs first, then what only this device has
  merge: (mine, theirs) => shape(theirs.concat(mine))
});
window.addEventListener('resize', () => { if (SEC) section(); });
render();

export { toggle as toggleFavorite };
