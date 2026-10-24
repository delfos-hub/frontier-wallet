/* GRAM <-> LUNC swap, maker side (stage 2): publish and cancel offers.

   The maker sells LUNC for GRAM. An offer is not a transaction: it is a
   JSON text signed with the wallet key (ADR-36) and posted to the offers
   Worker, which checks the signature and that the LUNC is on the address.
   Takers then lock GRAM on TON first; the maker answers a take by checking
   that TON lock here, on the chain, then locking the LUNC on Terra and
   reporting it in a message signed with the same key (stage 3).

   Network: everything goes through gram-net.js (rebel-2 + TON testnet for
   now). Nothing here touches columbus-5.

   Consent: as in p2p.js, nothing is signed without the PIN typed for that
   one request, and the confirmation shows exactly the text being signed. */
import { fmt, getJSON, iconHTML, paintIcons } from './chain.js?v=6f49adf9';
import { GRAM_NET } from './gram-net.js?v=6f49adf9';
import { PIN_LEN, digitsOnly, dots, focusPin } from './onboarding.js?v=6f49adf9';
import { $, buzz, go, libs, report as report_ } from './shell.js?v=6f49adf9';
import { S } from './state.js?v=6f49adf9';
import { decryptSeed } from './storage.js?v=6f49adf9';
import { sendSwap, signArbitrary, toRaw } from './tx.js?v=6f49adf9';
import { readLock, takeRefOf, rawOf as tonRaw } from './gram-ton.js?v=6f49adf9';

const NET = GRAM_NET;
const MAX_PIN_TRIES = 5;
const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const canSign = () => !!(S.SAVED && S.SAVED.blob);
const now = () => Math.floor(Date.now() / 1000);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

// raw integer string -> "1,234.5" (BigInt, so nothing is lost on the way)
function human(raw, dec){
  const s = BigInt(raw).toString().padStart(dec + 1, '0');
  const i = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, '');
  return BigInt(i).toLocaleString('en-US') + (f ? '.' + f : '');
}
const ceilDiv = (a, b) => (a + b - 1n) / b;
// nanoGRAM a taker locks for `lunc` uluna at `price` nanoGRAM per 1M LUNC (the Worker's gramFor)
const gramFor = (lunc, price) => ceilDiv(lunc * price, 1000000000000n);
function left(sec){
  if (sec <= 0) return 'expired';
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? h + ' h ' + m + ' min' : m + ' min';
}
// a TON address as typed: user-friendly (48 base64url chars) or raw 0:<hex>
const tonOk = a => /^[A-Za-z0-9_-]{48}$/.test(a) || /^0:[0-9a-fA-F]{64}$/.test(a);
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

/* ---------------- the Worker ---------------- */
async function api(path, body){
  const r = await fetch(NET.worker + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(d.error || ('offers service answered ' + r.status));
  return d;
}

/* ---------------- state ---------------- */
let POLICY = null;
let BAL = null;            // maker's uluna on NET.chain
let LOADING = false;
let TAKES = [];            // my takes as last loaded
const tonKey = () => 'fw:gram:ton:' + addrOf();

/* ---------------- home card ---------------- */
function paintPills(){
  [['#gx-tok-lunc', 'LUNC'], ['#gx-tok-gram', 'GRAM']].forEach(function (x) {
    const el = $(x[0]);
    if (el && !el.dataset.done) { el.dataset.done = '1'; el.innerHTML = iconHTML({ sym: x[1] }) + x[1]; paintIcons(el); }
  });
}
paintPills();

function paintCard(){
  const ico = $('#xc-gram-ico');
  if (ico && !ico.dataset.done) {
    ico.dataset.done = '1';
    ico.innerHTML = iconHTML({ sym: 'GRAM' }) + iconHTML({ sym: 'LUNC' });
    paintIcons(ico);
  }
}
// While the swap runs on test networks the card is shown only to testers,
// so nobody mistakes it for a live market: open the wallet once with #labs
// at the end of its address (or set localStorage fw:labs = 1). On mainnet it
// is shown to everyone.
const LABS = (function () {
  try {
    if (location.hash === '#labs') localStorage.setItem('fw:labs', '1');
    if (location.hash === '#nolabs') localStorage.removeItem('fw:labs');
    return NET.name !== 'testnet' || localStorage.getItem('fw:labs') === '1';
  } catch (e) { return false; }
})();
const card = $('#xc-gram');
if (card && LABS) { card.hidden = false; paintCard(); }
if (card) card.addEventListener('click', () => { go('gram'); load(); });

/* ---------------- loading ---------------- */
function say(id, text, bad){
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

async function load(){
  if (LOADING) return;
  LOADING = true;
  const me = addrOf();
  $('#gx-me').textContent = me ? me.slice(0, 12) + '\u2026' + me.slice(-6) : '';
  const t = $('#gx-ton');
  if (t && !t.value) { try { t.value = localStorage.getItem(tonKey()) || ''; } catch (e) {} }
  showTon();
  say('#gx-status', 'Loading');
  loadMarket();
  try {
    const [book, takes, bal] = await Promise.all([
      api('/offers'),
      me ? api('/takes?maker=' + encodeURIComponent(me)) : Promise.resolve({ takes: [], stats: {} }),
      me ? getJSON(NET.lcd + '/cosmos/bank/v1beta1/balances/' + me + '/by_denom?denom=uluna', 10000, 2)
         : Promise.resolve({})
    ]);
    POLICY = book.policy || null;
    BAL = BigInt((bal.balance && bal.balance.amount) || '0');
    $('#gx-bal').textContent = human(BAL, 6) + ' LUNC';
    const mine = (book.offers || []).filter(o => o.maker === me);
    MY_LIVE = mine.reduce((a, o) => a + BigInt(o.remaining_lunc), 0n);
    drawOffers(mine);
    TAKES = takes.takes || [];
    drawTakes(TAKES, takes.stats || {});
    say('#gx-status', '');
    preview();
  } catch (e) {
    report_('gram', e);
    say('#gx-status', 'Could not load: ' + (e && e.message || e), true);
  } finally {
    LOADING = false;
  }
}
$('#gx-refresh').addEventListener('click', load);

function drawOffers(list){
  const box = $('#gx-offers');
  if (!list.length) { box.innerHTML = '<div class="gx-none">No live offers. Create one below.</div>'; return; }
  box.innerHTML = list.map(o =>
    '<div class="gx-item">' +
      '<div class="gx-l"><b>1 GRAM = ' + Math.round(1e15 / Number(o.price)).toLocaleString('en-US') + ' LUNC</b>' +
        '<span>' + human(o.remaining_lunc, 6) + ' of ' + human(o.total_lunc, 6) + ' LUNC left \u00b7 ' +
        human(o.min_lunc, 6) + ' to ' + human(o.max_lunc, 6) + ' per take \u00b7 ends in ' + left(o.expires - now()) + '</span></div>' +
      '<button class="dust gx-cancel" type="button" data-id="' + esc(o.id) + '">cancel</button>' +
    '</div>').join('');
}

/* ---------------- active deals ----------------
   Only what is still in progress: a buyer waiting for my answer, or my
   LUNC locked and the buyer yet to claim it. A finished deal (claimed or
   refunded on Terra, read from the chain) leaves the list for good, with a
   short note when it finishes while the screen is open; a take nobody
   answered in time leaves too. My record stays as one line. */
const finalKey = () => 'fw:gram:final:' + addrOf();
function finals(){ try { return JSON.parse(localStorage.getItem(finalKey()) || '{}'); } catch (e) { return {}; } }
function setFinal(ton, v){ const f = finals(); f[ton] = v; try { localStorage.setItem(finalKey(), JSON.stringify(f)); } catch (e) {} }
const OPEN_SEEN = new Set();          // locked deals seen still open in this session

async function terraLockStatus(id){
  const q = btoa(JSON.stringify({ lock: { id: Number(id) } }));
  const d = await getJSON(NET.lcd + '/cosmwasm/wasm/v1/contract/' + NET.htlc + '/smart/' + q, 8000, 1);
  return d.data && d.data.status;
}

function windowLeftOf(t){ return t.created + (POLICY ? POLICY.answer_window_sec : 900) - now(); }

function stepper(done){
  const names = ['Buyer locked GRAM', 'You lock LUNC', 'Buyer claims'];
  return '<div class="gx-steps">' + names.map((n, k) =>
    '<span class="' + (k < done ? 'ok' : k === done ? 'now' : '') + '">' + n + '</span>').join('') + '</div>';
}

let DRAWN = [];
function drawTakes(list, stats){
  DRAWN = list;
  const fin = finals();
  const box = $('#gx-takes');
  const rec = $('#gx-record');
  if (rec && stats.answered !== null) rec.textContent = (stats.answered || stats.unanswered)
    ? 'Record: ' + (stats.answered || 0) + ' answered \u00b7 ' + (stats.unanswered || 0) + ' missed' : '';
  const active = list.filter(t => !fin[t.ton_lock] && (
    (t.status === 'pending' && windowLeftOf(t) > 0) ||
    t.status === 'locked' ||
    (t.status === 'unanswered' && mineFor(t.ton_lock).id)));
  if (!active.length) {
    box.innerHTML = '<div class="gx-none">No active deals. When a buyer takes your offer it shows up here, with a chime.</div>';
    return;
  }
  box.innerHTML = active.map(function (t) {
    const mine = mineFor(t.ton_lock);
    const head = '<b>' + human(t.lunc, 6) + ' LUNC</b> for ' + human(t.gram, 9) + ' GRAM';
    const pair = '<span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'GRAM' }) + iconHTML({ sym: 'LUNC' }) + '</span>';
    if (t.status === 'pending' || !t.terra_lock_id) {
      return '<div class="gx-item gx-deal">' + pair +
        '<div class="gx-l">' + head + '<span>' + (mine.id ? 'LUNC locked, the answer still has to be reported'
          : 'Waiting for your answer \u00b7 ' + left(windowLeftOf(t)) + ' left') + '</span>' + stepper(1) + '</div>' +
        '<button class="btn solid gx-answer" type="button" data-ton="' + esc(t.ton_lock) + '">' + (mine.id ? 'Report' : 'Answer') + '</button>' +
      '</div>';
    }
    return '<div class="gx-item gx-deal">' + pair +
      '<div class="gx-l">' + head + '<span>Your LUNC is locked \u00b7 waiting for the buyer to claim</span>' + stepper(2) + '</div>' +
      '<span class="gx-tag pending">live</span>' +
    '</div>';
  }).join('');
  paintIcons(box);
  checkFinished(active.filter(t => t.status === 'locked' && t.terra_lock_id));
}

// read the Terra side of answered deals; a finished one leaves the list
let CHECKING = false;
async function checkFinished(list){
  if (CHECKING || !list.length) return;
  CHECKING = true;
  let changed = false;
  try {
    for (const t of list) {
      let st;
      try { st = await terraLockStatus(t.terra_lock_id); } catch (e) { continue; }
      if (st === 'open') { OPEN_SEEN.add(t.ton_lock); continue; }
      if (st === 'claimed' || st === 'refunded') {
        setFinal(t.ton_lock, st);
        changed = true;
        if (OPEN_SEEN.has(t.ton_lock)) {
          say('#gx-status', st === 'claimed'
            ? 'Deal done: ' + human(t.lunc, 6) + ' LUNC sold for ' + human(t.gram, 9) + ' GRAM. The GRAM is on its way to your TON address.'
            : 'A deal ended unclaimed: your ' + human(t.lunc, 6) + ' LUNC came back.');
          if (st === 'claimed') buzz('success');
        }
      }
    }
  } finally { CHECKING = false; }
  if (changed) drawTakes(DRAWN, { answered: null });
}

/* ---------------- the form ----------------
   Two numbers, the way people think about a sale: "I sell X LUNC for Y
   GRAM". The per-million price the Worker stores is derived from them. A
   market hint (CoinGecko, as the rest of the wallet) fills Y at market or a
   little above. Everything else has a sensible default under More options. */
let MARKET = null;           // GRAM per 1 LUNC, a JS number, or null
let USD = { lunc: null, gram: null };
let MARKET_AT = null;        // when the prices were read
let MODE = 0;                // % above market the GRAM field follows, or null once typed by hand
let HOURS = 24;
let MY_LIVE = 0n;            // uluna still offered in my live offers

async function loadMarket(){
  try {
    const d = await getJSON('https://api.coingecko.com/api/v3/simple/price?ids=terra-luna,the-open-network&vs_currencies=usd', 8000, 2);
    USD.lunc = d['terra-luna'] && d['terra-luna'].usd || null;
    USD.gram = d['the-open-network'] && d['the-open-network'].usd || null;
    MARKET = USD.lunc && USD.gram ? USD.lunc / USD.gram : null;
    MARKET_AT = new Date();
  } catch (e) { MARKET = null; }
  rates();
  follow();
}

// The market in the words people use: how many LUNC one GRAM buys, and
// what each is worth in dollars. Small prices keep their significant digits.
const usdP = n => '$' + (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  : n.toPrecision(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
const lunc0 = n => Math.round(n).toLocaleString('en-US');
function rates(){
  const box = $('#gx-rates');
  if (!MARKET) { box.innerHTML = '<span>Market prices are not available right now. You can still set the GRAM amount yourself.</span>'; return; }
  box.innerHTML =
    '<b>1 GRAM \u2248 ' + lunc0(1 / MARKET) + ' LUNC</b>' +
    '<span>GRAM ' + usdP(USD.gram) + ' \u00b7 LUNC ' + usdP(USD.lunc) + ' \u00b7 ' +
    MARKET_AT.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>';
}
// fresh prices once a minute while the screen is open
setInterval(function () {
  const st = $('#st-gram');
  if (st && st.classList.contains('on') && !document.hidden) loadMarket();
}, 60000);

const val = id => $('#gx-' + id).value.trim().replace(',', '.');
const rawOf = (id, dec) => { try { return BigInt(toRaw(val(id), dec)); } catch (e) { return 0n; } };
const usdTxt = (n, price) => price ? ' \u2248 $' + (n * price).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
// a decimal for an input field: no exponent, at most `d` decimals, trailing zeros off
const dec = (n, d) => n.toFixed(d).replace(/\.?0+$/, '');

// what can still be offered: the balance after the burn tax, less my other live offers
function available(){
  if (BAL === null) return null;
  const tax = BigInt(POLICY ? POLICY.tax_bps || 0 : 0);
  const a = BAL * (10000n - tax) / 10000n - MY_LIVE;
  return a > 0n ? a : 0n;
}

// the GRAM field follows the market while a market button is on
function follow(){
  const sell = Number(val('sell')) || 0;
  $('#gx-mkt').textContent = MARKET && sell
    ? 'Market \u2248 ' + dec(sell * MARKET, 4) + ' GRAM' : (MARKET ? 'Market price loaded' : 'No market price right now');
  document.querySelectorAll('.gx-chip[data-pct]').forEach(b => {
    b.disabled = !MARKET;
    b.classList.toggle('on', MODE !== null && Number(b.dataset.pct) === MODE);
  });
  if (MODE !== null && MARKET && sell) $('#gx-get').value = dec(sell * MARKET * (1 + MODE / 100), 6);
  summary();
}

function readForm(){
  const out = { errs: [] };
  out.ton = TON_ADDR();
  if (!out.ton) out.errs.push('Add the TON address that receives the GRAM.');
  else if (!tonOk(out.ton)) out.errs.push('That TON address does not look right.');
  out.total = rawOf('sell', 6);
  out.gram = rawOf('get', 9);
  if (!(out.total > 0n)) out.errs.push('Enter how much LUNC you sell.');
  if (!(out.gram > 0n)) out.errs.push('Enter how much GRAM you want for it.');
  // nanoGRAM per 1M LUNC, rounded up: selling everything brings at least what was asked
  out.price = out.total > 0n ? ceilDiv(out.gram * 1000000000000n, out.total) : 0n;
  const minTxt = val('min');
  out.min = minTxt ? rawOf('min', 6) : out.total / 20n;
  if (out.min < 1000000n) out.min = out.total < 1000000n ? out.total : 1000000n;   // at least 1 LUNC
  if (out.min > out.total) out.errs.push('The smallest part cannot be more than the total.');
  out.max = out.total;
  out.hours = HOURS;
  const av = available();
  if (av !== null && out.total > av) out.errs.push('You can offer up to ' + human(av, 6) + ' LUNC (balance after the burn tax, minus your other live offers).');
  return out;
}

function summary(){
  const f = readForm();
  const box = $('#gx-sum');
  if (f.total > 0n && f.gram > 0n) {
    const sell = Number(human(f.total, 6).replace(/,/g, ''));
    const get = Number(human(f.gram, 9).replace(/,/g, ''));
    let vs = '';
    if (MARKET) {
      const d = (get / (sell * MARKET) - 1) * 100;
      vs = Math.abs(d) < 0.5 ? ' (at market)' : ' (' + (d > 0 ? '+' : '') + d.toFixed(1) + '% vs market)';
    }
    box.innerHTML =
      '<div><span>You receive</span><b>' + human(f.gram, 9) + ' GRAM' + esc(usdTxt(get, USD.gram)) + '</b></div>' +
      '<div><span>Your rate</span><b>1 GRAM = ' + lunc0(sell / get) + ' LUNC' + esc(vs) + '</b></div>' +
      '<div><span>Buyers take</span><b>any part from ' + human(f.min, 6) + ' LUNC</b></div>' +
      '<div><span>Live for</span><b>' + f.hours + ' h</b></div>';
    box.hidden = false;
  } else box.hidden = true;
  const warn = f.errs.find(e => !/^Enter /.test(e) && !/^Add the TON/.test(e));
  say('#gx-msg', warn || '', !!warn);
  $('#gx-post').disabled = !canSign() || f.errs.length > 0;
}

// TON address: remembered per wallet, shown as one line once known
const TON_ADDR = () => ($('#gx-ton').value || '').trim();
function showTon(){
  const a = TON_ADDR();
  const known = tonOk(a);
  $('#gx-ton-line').hidden = !known;
  $('#gx-ton-edit').hidden = known;
  if (known) $('#gx-ton-short').textContent = a.slice(0, 6) + '\u2026' + a.slice(-6);
}
$('#gx-ton-change').addEventListener('click', () => { $('#gx-ton-line').hidden = true; $('#gx-ton-edit').hidden = false; $('#gx-ton').focus(); });
$('#gx-ton').addEventListener('change', () => { if (tonOk(TON_ADDR())) { try { localStorage.setItem(tonKey(), TON_ADDR()); } catch (e) {} showTon(); } summary(); });
$('#gx-ton').addEventListener('input', summary);

$('#gx-sell').addEventListener('input', follow);
$('#gx-get').addEventListener('input', () => { MODE = null; follow(); });
$('#gx-min').addEventListener('input', summary);
$('#gx-max-btn').addEventListener('click', () => {
  const av = available();
  if (av === null) return;
  $('#gx-sell').value = human(av, 6).replace(/,/g, '');
  follow();
});
document.querySelectorAll('.gx-chip[data-pct]').forEach(b => b.addEventListener('click', () => { MODE = Number(b.dataset.pct); follow(); }));
document.querySelectorAll('.gx-chip[data-h]').forEach(b => b.addEventListener('click', () => {
  HOURS = Number(b.dataset.h);
  document.querySelectorAll('.gx-chip[data-h]').forEach(x => x.classList.toggle('on', x === b));
  summary();
}));

function preview(){ showTon(); follow(); }

$('#gx-post').addEventListener('click', async function(){
  const f = readForm();
  if (f.errs.length) { say('#gx-msg', f.errs[0], true); buzz('error'); return; }
  try { localStorage.setItem(tonKey(), f.ton); } catch (e) {}
  const expires = now() + f.hours * 3600;
  const payload = JSON.stringify({
    type: 'htlc-offer', v: 1, network: NET.name, maker: addrOf(), maker_ton: f.ton,
    min_lunc: String(f.min), max_lunc: String(f.max), total_lunc: String(f.total),
    price: String(f.price), expires: expires, nonce: hex(16)
  });
  const lines = [
    ['You sell', human(f.total, 6) + ' LUNC'],
    ['You receive', 'up to ' + human(gramFor(f.total, f.price), 9) + ' GRAM'],
    ['Buyers take', 'from ' + human(f.min, 6) + ' LUNC'],
    ['GRAM goes to', f.ton],
    ['Ends', new Date(expires * 1000).toLocaleString()],
    ['Network', NET.chain + ' + TON testnet']
  ];
  let signed;
  try { signed = await consent('Publish this offer', lines, payload); } catch (e) { return; }
  say('#gx-msg', 'Publishing');
  try {
    await api('/offers', signed);
    buzz('success');
    say('#gx-msg', 'Published. Buyers can see it now.');
    $('#gx-sell').value = ''; $('#gx-get').value = ''; $('#gx-min').value = ''; MODE = 0;
    load();
  } catch (e) {
    say('#gx-msg', e.message, true);
  }
});

$('#gx-offers').addEventListener('click', async function(e){
  const b = e.target.closest('.gx-cancel');
  if (!b) return;
  const id = b.dataset.id;
  const payload = JSON.stringify({ type: 'htlc-offer-cancel', v: 1, id: id });
  let signed;
  try { signed = await consent('Cancel this offer', [['Offer', id.slice(0, 16) + '\u2026']], payload); } catch (err) { return; }
  try { await api('/offers/' + encodeURIComponent(id) + '/cancel', signed); buzz('success'); load(); }
  catch (err) { say('#gx-status', err.message, true); }
});


/* ---------------- answering a take (stage 3) ----------------
   1. Read the buyer's TON lock on the chain (not the Worker's word): the
      audited code, open, under the take's hash, paying my TON address,
      committed to this very take (taker, offer, amount), enough GRAM, and
      lasting long enough for a Terra lock that leaves the buyer time.
   2. One PIN: lock the LUNC on Terra for the buyer, then sign the answer
      (htlc-take-locked) and report it. A Terra lock is kept per TON lock on
      this device, so a lock is never made twice for one take and never
      reused for another (audit #34, A2). */
const MARGIN = 600;                      // spec: the Terra lock ends this much before the gap
const lockKey = () => 'fw:gram:locks:' + addrOf();
function mineAll(){ try { return JSON.parse(localStorage.getItem(lockKey()) || '{}'); } catch (e) { return {}; } }
function mineFor(ton){ return mineAll()[ton] || {}; }
function remember(ton, v){
  const m = mineAll(); m[ton] = Object.assign(m[ton] || {}, v);
  try { localStorage.setItem(lockKey(), JSON.stringify(m)); } catch (e) {}
}

// the lock id from a confirmed tx: the htlc contract's wasm event, key "id"
function lockIdOf(res){
  const plain = s => { if (!s) return ''; if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) { try { const d = atob(s); if (/^[\x20-\x7e]*$/.test(d)) return d; } catch (e) {} } return s; };
  const evs = (res.events || []).concat(...(res.logs || []).map(l => l.events || []));
  for (const e of evs) {
    if (e.type !== 'wasm') continue;
    const at = (e.attributes || []).map(a => [plain(a.key), plain(a.value)]);
    if (!at.some(([k, v]) => k === '_contract_address' && v === NET.htlc)) continue;
    const id = at.find(([k]) => k === 'id');
    if (id) return Number(id[1]);
  }
  return null;
}

async function checkTake(t){
  const offer = await api('/offers/' + encodeURIComponent(t.offer_id));
  const n = await readLock(NET.tonApi, t.ton_lock, NET.tonCodeHash);
  const p = POLICY || {};
  const problems = [];
  if (n.state !== 'active') problems.push('the buyer\u2019s TON lock does not exist (yet)');
  else if (n.foreignCode) problems.push('the TON lock does not run the audited contract');
  else {
    if (n.status !== 'open') problems.push('the TON lock is ' + n.status);
    if (n.hash !== t.hash) problems.push('the TON lock is under another hash');
    if (n.recipient !== tonRaw(offer.maker_ton)) problems.push('the TON lock does not pay your TON address');
    if (n.takerRef !== await takeRefOf(t.taker_terra, t.offer_id, t.lunc)) problems.push('the TON lock is committed to another take');
    if (n.amount < gramFor(BigInt(t.lunc), BigInt(offer.price))) problems.push('the TON lock holds too little GRAM');
  }
  const timeout = Math.min(now() + (p.t_terra_sec || 1200), (n.timeout || 0) - (p.terra_gap_sec || 900) - MARGIN);
  if (!problems.length && timeout < now() + (p.min_terra_left_sec || 900) + 60) problems.push('the TON lock ends too soon to answer safely');
  const tax = BigInt(p.tax_bps || 0);
  const gross = ceilDiv(BigInt(t.lunc) * 10000n, 10000n - tax);
  return { offer: offer, n: n, problems: problems, timeout: timeout, gross: gross };
}

async function report(t, id, mnemonic){
  const payload = JSON.stringify({ type: 'htlc-take-locked', v: 1, network: NET.name, ton_lock: t.ton_lock, terra_lock_id: id });
  const signed = await signArbitrary(mnemonic, addrOf(), payload);
  await api('/takes/' + encodeURIComponent(t.ton_lock) + '/locked', signed);
  remember(t.ton_lock, { reported: true });
}

$('#gx-takes').addEventListener('click', function(e){
  const b = e.target.closest('.gx-answer');
  if (!b || b.disabled) return;
  const t = TAKES.find(x => x.ton_lock === b.dataset.ton);
  if (t) answerTake(t, b);
});

async function answerTake(t, b){
  const had = mineFor(t.ton_lock);
  if (b) b.disabled = true;
  try {
    // a lock already made on this device for this take: only the report is left
    if (had.id) {
      const payload = JSON.stringify({ type: 'htlc-take-locked', v: 1, network: NET.name, ton_lock: t.ton_lock, terra_lock_id: had.id });
      await consent('Report your answer', [['Terra lock', '#' + had.id], ['For', human(t.lunc, 6) + ' LUNC to ' + t.taker_terra.slice(0, 12) + '\u2026']],
        payload, m => report(t, had.id, m));
      say('#gx-status', 'Reported. The buyer can now claim the LUNC.');
      buzz('success'); load(); return;
    }
    if (had.tx) { say('#gx-status', 'A lock for this take was already sent (tx ' + had.tx.slice(0, 10) + '\u2026). Refresh in a minute.', true); return; }
    say('#gx-status', 'Checking the buyer\u2019s GRAM lock on TON\u2026');
    const c = await checkTake(t);
    if (c.problems.length) { say('#gx-status', 'Not answering: ' + c.problems.join('; ') + '.', true); buzz('error'); return; }
    if (BAL !== null && BAL < c.gross) { say('#gx-status', 'You need ' + human(c.gross, 6) + ' LUNC on ' + NET.chain + ' for this lock.', true); return; }
    say('#gx-status', '');
    const step = { contract: NET.htlc, msg: { lock: { hash: t.hash, recipient: t.taker_terra, refund_to: null, timeout: c.timeout } },
                   funds: [{ denom: 'uluna', amount: String(c.gross) }] };
    const lines = [
      ['Buyer locked', human(c.n.amount, 9) + ' GRAM \u2713 checked on TON'],
      ['You lock', human(c.gross, 6) + ' LUNC (incl. burn tax)'],
      ['Buyer receives', human(t.lunc, 6) + ' LUNC'],
      ['Buyer', t.taker_terra],
      ['Claim until', new Date(c.timeout * 1000).toLocaleString()],
      ['If unclaimed', 'the LUNC comes back to you after that'],
      ['Network', NET.chain + ' + TON testnet']
    ];
    const NOTE_ANSWER = 'A transaction: it locks your LUNC on ' + NET.chain + ' for this buyer, then signs your answer. If the buyer never claims, the LUNC comes back to you.';
    await consent('Answer this take', lines, JSON.stringify(step.msg, null, 1) + '\n\nthen signed: htlc-take-locked for ' + t.ton_lock, async function(m){
      const sent = await sendSwap(addrOf(), [step], m, NET);
      remember(t.ton_lock, { tx: sent.hash, at: now() });
      say('#gx-sheet-msg', 'Lock sent, waiting for the block');
      const res = await sent.wait();
      if (!res) throw new Error('the lock was sent but is not confirmed yet (tx ' + sent.hash + '). Refresh in a minute, then press Report.');
      const id = lockIdOf(res);
      if (!id) throw new Error('the lock went through but its id was not found (tx ' + sent.hash + ')');
      remember(t.ton_lock, { id: id });
      say('#gx-sheet-msg', 'Locked as #' + id + ', reporting');
      await report(t, id, m);
      return id;
    }, NOTE_ANSWER);
    say('#gx-status', 'Answered. The buyer can now claim the LUNC; the GRAM comes to you when they do.');
    buzz('success');
    load();
  } catch (err) {
    if (err && err.message !== 'cancelled') { report_('gram', err); say('#gx-status', String(err && err.message || err), true); }
  } finally {
    if (b) b.disabled = false;
  }
}

/* ---------------- a new buyer: tell the maker ----------------
   While the wallet is open (any screen), the maker's takes are read every
   15 s. A take not seen before that is waiting for an answer brings a sound,
   a vibration in Telegram, a pop-up with Answer, and a count on the home
   card. With the wallet closed, the Telegram bot is what will tell the maker
   (next stage). */
const SEEN = new Set();
let ALERTING = null;
let AUDIO = null;
// a browser plays sound only after the user has touched the page once
document.addEventListener('pointerdown', function () {
  if (!AUDIO) { try { AUDIO = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
}, { once: true });
function chime(){
  if (!AUDIO) return;
  try {
    const t0 = AUDIO.currentTime;
    [[880, 0], [1320, 0.16]].forEach(function (n) {
      const o = AUDIO.createOscillator(), g = AUDIO.createGain();
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t0 + n[1]);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + n[1] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.35);
      o.connect(g).connect(AUDIO.destination);
      o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.4);
    });
  } catch (e) {}
}
function badge(n){
  const el = $('#xc-gram-n');
  if (!el) return;
  el.textContent = n > 9 ? '9+' : String(n);
  el.hidden = !n;
}
function windowLeft(t){ return t.created + (POLICY ? POLICY.answer_window_sec : 900) - now(); }
function showAlert(t){
  ALERTING = t;
  const ico = $('#gx-alert-ico');
  if (ico && !ico.dataset.done) { ico.dataset.done = '1'; ico.innerHTML = iconHTML({ sym: 'GRAM' }); paintIcons(ico); }
  $('#gx-alert-what').textContent = human(t.lunc, 6) + ' LUNC for ' + human(t.gram, 9) + ' GRAM';
  $('#gx-alert-left').textContent = 'Answer within ' + left(windowLeft(t)) + ', or the buyer\u2019s GRAM goes back and it counts as a miss.';
  $('#gx-alert').hidden = false;
  chime();
  buzz('warning');
}
$('#gx-alert-later').addEventListener('click', () => { $('#gx-alert').hidden = true; ALERTING = null; });
$('#gx-alert-go').addEventListener('click', function () {
  const t = ALERTING;
  $('#gx-alert').hidden = true; ALERTING = null;
  if (!t) return;
  if (!$('#st-gram').classList.contains('on')) { go('gram'); load(); }
  answerTake(t, null);
});

async function watchTakes(){
  const me = addrOf();
  if (!me || !LABS || document.hidden || LOADING) return;
  let d;
  try { d = await api('/takes?maker=' + encodeURIComponent(me)); } catch (e) { return; }
  const waiting = (d.takes || []).filter(t => t.status === 'pending' && windowLeft(t) > 0 && !mineFor(t.ton_lock).id);
  badge(waiting.length);
  const fresh = waiting.filter(t => !SEEN.has(t.ton_lock));
  waiting.forEach(t => SEEN.add(t.ton_lock));
  if ($('#st-gram').classList.contains('on')) { TAKES = d.takes || []; drawTakes(TAKES, d.stats || {}); }
  if (fresh.length && !ALERTING && $('#gx-sheet').hidden) {
    if (!POLICY) { try { POLICY = (await api('/offers')).policy || null; } catch (e) {} }
    showAlert(fresh[0]);
  }
}
setInterval(watchTakes, 15000);
setTimeout(watchTakes, 3000);

/* ---------------- consent: show, PIN, sign ----------------
   Resolves with { payload, pubkey, signature }, rejects on Cancel. The seed
   used to sign is the one decrypted from the PIN typed here, never the copy
   already unlocked in memory. */
let PEND = null;
const NOTE_MESSAGE = 'A signed message, not a transaction: it moves no funds. This is exactly what will be signed.';
function consent(title, lines, text, action, note){
  if (!canSign()) { say('#gx-msg', 'This wallet has no key on this device (watch only).', true); return Promise.reject(); }
  return new Promise(function (resolve, reject) {
    PEND = { text: text, action: action, resolve: resolve, reject: reject, tries: 0, busy: false };
    $('#gx-sheet-title').textContent = title;
    $('#gx-sheet-note').textContent = note || NOTE_MESSAGE;
    $('#gx-lines').innerHTML = lines.map(l =>
      '<div class="p2p-line"><span>' + esc(l[0]) + '</span><b>' + esc(l[1]) + '</b></div>').join('');
    $('#gx-signed').textContent = text;
    say('#gx-sheet-msg', '');
    $('#gx-pin').value = '';
    dots('gx-pinrow', 0);
    $('#gx-sheet').hidden = false;
    focusPin('#gx-pin');
  });
}
function closeSheet(){
  $('#gx-sheet').hidden = true;
  $('#gx-pin').value = '';
  PEND = null;
}
$('#gx-sheet-x').addEventListener('click', function(){
  if (!PEND || PEND.busy) return;
  const p = PEND; closeSheet(); p.reject(new Error('cancelled'));
});
$('#gx-pinbox').addEventListener('click', () => focusPin('#gx-pin'));
$('#gx-pin').addEventListener('input', async function(){
  if (!PEND || PEND.busy) return;
  const v = digitsOnly($('#gx-pin'));
  dots('gx-pinrow', v.length);
  if (v.length < PIN_LEN) return;
  PEND.busy = true;
  say('#gx-sheet-msg', 'Checking');
  let mnemonic;
  try {
    await libs();
    mnemonic = await decryptSeed(S.SAVED.blob, v);
  } catch (e) {
    PEND.busy = false; PEND.tries++;
    buzz('error');
    dots('gx-pinrow', PIN_LEN, true);
    setTimeout(() => { $('#gx-pin').value = ''; dots('gx-pinrow', 0); }, 550);
    if (PEND.tries >= MAX_PIN_TRIES) { const p = PEND; closeSheet(); p.reject(new Error('wrong PIN')); say('#gx-msg', 'Wrong PIN too many times.', true); return; }
    say('#gx-sheet-msg', 'Wrong PIN', true);
    return;
  }
  try {
    say('#gx-sheet-msg', PEND.action ? 'Working, keep this open' : 'Signing');
    const out = PEND.action ? await PEND.action(mnemonic) : await signArbitrary(mnemonic, addrOf(), PEND.text);
    mnemonic = null;
    const p = PEND; closeSheet(); p.resolve(out);
  } catch (e) {
    mnemonic = null;
    report_('gram', e);
    const p = PEND; closeSheet(); p.reject(e);
    // an action reports its own failure where it was started
    if (!p.action) say('#gx-msg', 'Could not sign: ' + (e && e.message || e), true);
  }
});
