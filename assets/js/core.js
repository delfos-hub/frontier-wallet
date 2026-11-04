/* core.js - the Core assets panel, beyond the balance.

   tokens.js draws the two cells (LUNC, USTC) and keeps their balance current;
   this module adds what makes them worth a look with any balance:
     - the market: price, change over 24 hours and a one-day line, from
       CoinGecko's markets endpoint (the same source the wallet's USD prices
       already come from), one request for both coins, at most every 5 minutes;
     - LUNC: how much of it is staked and how much is free, and a nudge to the
       staking screen when a useful amount sits idle;
     - USTC: where it stands against its $1 peg;
     - a cell with nothing in it says so and offers Swap and Receive, instead
       of a dash that reads like an error.
   It only adds elements next to the ones tokens.js owns and never writes into
   those, so the two cannot fight over the same text. */
import { LCD, amt, fmt, getJSON } from './chain.js?v=735adfac';
import { $ } from './shell.js?v=735adfac';
import { S } from './state.js?v=735adfac';
import { stakingApr } from './stake.js?v=735adfac';
import { refreshBalances } from './tokens.js?v=735adfac';

const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=terra-luna,terrausd' +
  '&sparkline=true&price_change_percentage=24h';
const IDS = { 'terra-luna': 'LUNC', terrausd: 'USTC' };
const IDLE_MIN = 100;               // free LUNC worth a nudge to stake
let MK = null, MK_AT = 0;
let STK = null;                     // { addr, staked, at }
let APR = null, APR_P = null, STK_P = null;

const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';

// One request at a time; a failed or odd answer (429, an error page) keeps the
// last good data on screen instead of blanking the cells, and is not cached.
let MK_P = null;
async function market(){
  if (MK && Date.now() - MK_AT < 5 * 60000) return MK;
  if (MK_P) return MK_P;
  MK_P = (async () => {
    try {
      const r = await getJSON(MARKETS, 10000, 2);
      if (!Array.isArray(r) || !r.length) return MK || {};
      const out = {};
      r.forEach(c => {
        const sym = IDS[c.id];
        if (!sym) return;
        const pts = (c.sparkline_in_7d && c.sparkline_in_7d.price) || [];
        out[sym] = { price: Number(c.current_price), ch: Number(c.price_change_percentage_24h), line: pts.slice(-25) };
      });
      if (!Object.keys(out).length) return MK || {};
      MK = out; MK_AT = Date.now();
      return MK;
    } catch (e) { return MK || {}; }
    finally { MK_P = null; }
  })();
  return MK_P;
}

async function staked(addr){
  if (!addr) return null;
  if (STK && STK.addr === addr && Date.now() - STK.at < 2 * 60000) return STK.staked;
  const r = await getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + addr, 10000, 1);
  const s = (r.delegation_responses || []).reduce((a, d) => a + BigInt(d.balance && d.balance.amount || '0'), 0n);
  STK = { addr: addr, staked: s, at: Date.now() };
  return s;
}

// $0.00004261, $0.006512, $1.0021: four significant digits whatever the size
function price(p){
  if (!(p > 0)) return '\u2014';
  const d = p >= 1 ? 4 : Math.min(10, 3 - Math.floor(Math.log10(p)));
  return '$' + p.toFixed(d);
}

function spark(line, up, id){
  if (!line || line.length < 2) return '';
  const lo = Math.min.apply(null, line), hi = Math.max.apply(null, line), span = (hi - lo) || 1;
  const pts = line.map((v, i) => [(i / (line.length - 1)) * 100, 26 - ((v - lo) / span) * 22]);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  const c = up ? '#3ecf8e' : '#f06a6a';
  return '<svg class="cx-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".28"/>' +
    '<stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + path + ' L100 28 L0 28 Z" fill="url(#' + id + ')"/>' +
    '<path d="' + path + '" fill="none" stroke="' + c + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
}

// the element of a cell this module owns, made once
function slot(cell, cls, where){
  let el = cell.querySelector('.' + cls);
  if (!el) {
    el = document.createElement('div');
    el.className = cls;
    if (where === 'top') cell.querySelector('.core-top').appendChild(el);
    else cell.appendChild(el);
  }
  return el;
}
// Compared with what this module last wrote, not with innerHTML read back:
// the browser serializes SVG and translated text differently from the string
// written, so that comparison never matched and the panel was rewritten
// several times a second for as long as Home was open (Pablo, review of #38).
const LAST = new WeakMap();
const put = (el, html) => { if (LAST.get(el) !== html) { LAST.set(el, html); el.innerHTML = html; } };

function qtyOf(cell){
  const t = (cell.querySelector('.core-qty') || {}).textContent || '';
  return Number(t.replace(/[^\d.]/g, '')) || 0;
}

// a cell holding nothing: say so, offer the two ways to get some
function paintEmpty(){
  document.querySelectorAll('#core .core-cell').forEach(cell => {
    // LUNC that is all staked is not "none": the cell is empty only when the
    // stake is known to be zero too
    const lunc = cell.getAttribute('data-sym') === 'LUNC';
    const zero = qtyOf(cell) === 0 && (!lunc || (STK && STK.addr === addrOf() && STK.staked === 0n));
    cell.classList.toggle('cx-zero', zero);
    const box = slot(cell, 'cx-empty');
    const sym = cell.getAttribute('data-sym');
    put(box, zero ? '<span>No ' + sym + ' yet</span><span class="cx-acts">' +
      '<button type="button" data-go="swap">Swap</button><button type="button" data-go="recv">Receive</button></span>' : '');
  });
}

async function update(){
  const core = $('#core');
  if (!core || !core.querySelector('.core-cell')) return;
  paintEmpty();
  let mk = {};
  try { mk = await market(); } catch (e) { /* the panel works without it */ }
  // The stake and the APR take several reads each; the market is painted
  // without waiting for them, and they paint again when they arrive.
  const addr = addrOf();
  const st = STK && STK.addr === addr ? STK.staked : null;
  if (addr && (!STK || STK.addr !== addr || Date.now() - STK.at > 2 * 60000) && !STK_P) {
    STK_P = staked(addr).then(() => { STK_P = null; update(); }, () => { STK_P = null; });
  }
  if (APR === null && !APR_P) APR_P = stakingApr().then(a => { APR = a || 0; update(); }, () => { APR = 0; });

  document.querySelectorAll('#core .core-cell').forEach(cell => {
    const sym = cell.getAttribute('data-sym');
    const m = mk[sym];
    // change over 24 hours, next to the ticker
    const ch = slot(cell, 'cx-ch', 'top');
    if (m && isFinite(m.ch)) {
      ch.className = 'cx-ch ' + (m.ch >= 0 ? 'up' : 'down');
      put(ch, (m.ch >= 0 ? '+' : '') + m.ch.toFixed(2) + '%');
    } else put(ch, '');

    if (sym === 'LUNC') {
      const free = qtyOf(cell);
      const s = st === null ? null : Number(amt(String(st), 6));
      const box = slot(cell, 'cx-split');
      if (s !== null && (s > 0 || free > 0)) {
        const pct = s + free > 0 ? (s / (s + free)) * 100 : 0;
        const nudge = free >= IDLE_MIN && APR > 0;
        put(box, '<div class="cx-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
          '<div class="cx-split-l"><span><i class="st"></i>Staked ' + fmt(s) + '</span><span><i></i>Free ' + fmt(free) + '</span></div>' +
          (nudge ? '<button class="cx-cta" type="button" data-go="stake">Stake \u00b7 ' + (APR * 100).toFixed(1) + '% APR</button>' : ''));
      } else put(box, '');
    }
    if (sym === 'USTC') {
      const box = slot(cell, 'cx-peg');
      if (m && m.price > 0) {
        const of = m.price * 100;                       // above the peg too
        put(box, '<div class="cx-bar peg"><i style="width:' + Math.max(Math.min(of, 100), 1.5).toFixed(2) + '%"></i><b></b></div>' +
          '<div class="cx-split-l"><span>Peg $1</span><span>' + of.toFixed(2) + '% of peg</span></div>');
      } else put(box, '');
    }
    const mkBox = slot(cell, 'cx-mk');
    put(mkBox, m ? spark(m.line, !(m.ch < 0), 'cx-g-' + sym) +
      '<div class="cx-px"><span>' + price(m.price) + '</span><em>24h</em></div>' : '');
  });
}

const core = $('#core');
if (core) {
  core.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    e.stopPropagation();                      // not the cell's own tap (the token page)
    const go = b.getAttribute('data-go');
    const id = go === 'swap' ? '#act-swap' : go === 'recv' ? '#act-recv' : null;
    if (id && $(id)) $(id).click();
    else if (go === 'stake') { const t = document.querySelector('.tab[data-tab="stake"]'); if (t) t.click(); }
  }, true);
  // tokens.js builds the cells and rewrites the balance: follow it
  // (its own writes come back here too; they change nothing the second time,
  // and the market and the stake are cached, so the loop ends at once)
  let soon = 0;
  new MutationObserver(() => {
    clearTimeout(soon);
    soon = setTimeout(update, 250);
  }).observe(core, { childList: true, subtree: true, characterData: true });
  document.addEventListener('frontier:wallet', () => { STK = null; update(); });
  // Coming back to Home is when the balances are looked at: read them then
  // (tokens.js skips it if it read less than 15 s ago). They used to wait for
  // the 45 s tick, which after a swap made Home show the old amounts.
  const home = document.getElementById('st-home');
  if (home) {
    let was = home.classList.contains('on');
    new MutationObserver(() => {
      const on = home.classList.contains('on');
      if (on && !was) { STK = null; refreshBalances(false); }
      was = on;
    }).observe(home, { attributes: true, attributeFilter: ['class'] });
  }
  // after a send or any other transaction, once more when the block is surely in
  document.addEventListener('frontier:tx', () => { STK = null; setTimeout(() => refreshBalances(true), 8000); });
  setInterval(update, 5 * 60000);
  update();
}
