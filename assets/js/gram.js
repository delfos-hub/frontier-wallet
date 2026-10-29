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
import { fmt, getJSON, iconHTML, paintIcons } from './chain.js?v=c36e8f7f';
import { GRAM_NET } from './gram-net.js?v=c36e8f7f';
import { PIN_LEN, digitsOnly, dots, focusPin } from './onboarding.js?v=c36e8f7f';
import { $, buzz, go, libs, report as report_ } from './shell.js?v=c36e8f7f';
import { S } from './state.js?v=c36e8f7f';
import { decryptSeed } from './storage.js?v=c36e8f7f';
import { sendSwap, signArbitrary, toRaw } from './tx.js?v=c36e8f7f';
import { readLock, takeRefOf, rawOf as tonRaw } from './gram-ton.js?v=c36e8f7f';
import { buildLock, refundMessage, claimMessage } from './gram-tonlock.js?v=c36e8f7f';
import { chime, notify } from './notify.js?v=c36e8f7f';

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
  if (!r.ok) { const e = new Error(d.error || ('offers service answered ' + r.status)); e.status = r.status; throw e; }
  return d;
}

/* ---------------- state ---------------- */
let POLICY = null;
let POLICY_ERR = '';

/* The rules come from the offers Worker, but every number that keeps funds
   safe is pinned in gram-net.js (audit round 3, B3): a Worker that disagrees
   is refused, not followed, and the pinned values are the ones used. */
function pinPolicy(p){
  const pin = NET.policy;
  if (!pin || NET.ready === false) throw new Error('the swap is not open on ' + NET.name + ' in this wallet yet');
  if (!p) throw new Error('the swap rules could not be loaded');
  const bad = [];
  let tip = '';
  try { tip = tonRaw(String(p.tip_address || '')); } catch (e) {}
  if (tip !== tonRaw(pin.tip_address)) bad.push('fee address');
  ['min_tip', 'fee_bps', 'answer_window_sec', 't_terra_sec', 'terra_gap_sec', 'min_terra_left_sec', 'min_ton_left_sec', 'min_deal', 'max_deal', 'max_open_takes_per_taker']
    .forEach(k => { if (String(p[k] ?? null) !== String(pin[k] ?? null)) bad.push(k); });
  if (String(p.ton_code_hash || '').toUpperCase() !== String(NET.tonCodeHash).toUpperCase()) bad.push('lock code');
  const tax = Number(p.tax_bps);
  if (!Number.isInteger(tax) || tax < pin.min_tax_bps || tax > pin.max_tax_bps) bad.push('burn tax');
  if (bad.length) throw new Error('the offers service publishes swap rules that differ from this wallet\u2019s (' + bad.join(', ') + '). Not trading under them; update the wallet or try later.');
  return Object.assign({}, pin, { tax_bps: tax, ton_code_hash: NET.tonCodeHash });
}
// GRAM per deal, from the pinned rules: { min, max } in nanoGRAM (0n = none)
function dealLimits(){
  const p = POLICY || NET.policy || {};
  return { min: p.min_deal ? BigInt(p.min_deal) : 0n, max: p.max_deal ? BigInt(p.max_deal) : 0n };
}
// Buys of this wallet still waiting for a seller's answer. The Worker takes
// at most max_open_takes_per_taker of them per address, and it can only say
// so after the GRAM is locked: so the wallet does not pay for one more
// (review of widgets#44).
function waitingBuys(){
  return Object.values(buys()).filter(b => ['paying', 'sent', 'announced'].includes(b.stage)).length;
}
function openErr(){
  const max = Number((POLICY || NET.policy || {}).max_open_takes_per_taker) || 0;
  const n = waitingBuys();
  return max && n >= max ? 'You have ' + n + ' buys waiting for a seller\u2019s answer, the most allowed at once. Pay for the next one when one of them is answered.' : '';
}
function dealErr(gram){
  const lim = dealLimits();
  if (lim.min && gram < lim.min) return 'A deal must be worth at least ' + human(lim.min, 9) + ' GRAM.';
  if (lim.max && gram > lim.max) return 'A deal can be worth at most ' + human(lim.max, 9) + ' GRAM.';
  return '';
}
function setPolicy(p){
  try { POLICY = pinPolicy(p); POLICY_ERR = ''; }
  catch (e) { POLICY = null; POLICY_ERR = e.message; }
  return POLICY;
}

/* Offers this wallet signed, kept on the device (audit round 3, B1). When a
   buyer takes one, the lock is checked against what the seller signed, never
   against the Worker's copy of it. */
const signedKey = () => 'fw:gram:signed:' + addrOf();
function signedAll(){ try { return JSON.parse(localStorage.getItem(signedKey()) || '{}'); } catch (e) { return {}; } }
function signedOffer(id){ const s = signedAll()[id]; try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function keepSigned(id, payload){
  const all = signedAll(), t = now();
  all[id] = payload;
  // an offer is no use 2 days after it expired (its takes are long settled)
  for (const k in all) { try { if (JSON.parse(all[k]).expires < t - 2 * 86400) delete all[k]; } catch (e) { delete all[k]; } }
  try { localStorage.setItem(signedKey(), JSON.stringify(all)); } catch (e) {}
}
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
    // ?labs=1 too: inside Telegram the mini app's #hash is taken by the launch params
    if (location.hash === '#labs' || new URLSearchParams(location.search).get('labs') === '1') localStorage.setItem('fw:labs', '1');
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
    setPolicy(book.policy);
    if (POLICY_ERR) say('#gx-status', POLICY_ERR, true);
    BAL = BigInt((bal.balance && bal.balance.amount) || '0');
    $('#gx-bal').textContent = human(BAL, 6) + ' LUNC';
    const mine = (book.offers || []).filter(o => o.maker === me);
    MY_LIVE = mine.reduce((a, o) => a + BigInt(o.remaining_lunc), 0n);
    drawOffers(mine);
    BOOK = (book.offers || []).filter(o => o.maker !== me);
    drawBook();
    drawBuys();
    TAKES = takes.takes || [];
    drawTakes(TAKES, takes.stats || {});
    tgStatus();
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

let MY_OFFERS = [];
function drawOffers(list){
  MY_OFFERS = list;
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

async function terraLockRead(id){
  const q = btoa(JSON.stringify({ lock: { id: Number(id) } }));
  const d = await getJSON(NET.lcd + '/cosmwasm/wasm/v1/contract/' + NET.htlc + '/smart/' + q, 8000, 1);
  return d.data || null;
}

/* ---------------- the seller's GRAM (audit round 3, A) ----------------
   The buyer's claim of the LUNC makes the secret public on Terra. From then
   on anyone can release the GRAM to the seller with a free external message,
   but someone has to, before the TON lock's timeout (at least ~24 h later).
   The relayer does it for every swap it knows about; so that it knows, the
   wallet registers each answered deal with it (/watch). If the relayer is
   down, or the buyer claimed the LUNC without it, the seller's own wallet
   sends the claim: by itself whenever the wallet is open, and with a button.
   A claim can only pay the lock's own recipient, so sending it twice, or
   together with the relayer, is harmless: the second one is refused for
   free. */
const RELEASE = {};                    // ton_lock -> { secret, sentAt, error }
async function relayerWatch(tonLock, terraLockId){
  const url = relayerUrl();
  if (!url) return false;
  try {
    const r = await fetch(url + '/watch', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terraLockId: Number(terraLockId), tonLock: tonLock }) });
    return r.ok;
  } catch (e) { return false; }
}
const WATCH_TRIED = {};                // ton_lock -> last attempt, so a down relayer is not asked every 15 s
async function watchDeal(t, terraLockId){
  if (now() - (WATCH_TRIED[t.ton_lock] || 0) < 300) return;
  WATCH_TRIED[t.ton_lock] = now();
  if (await relayerWatch(t.ton_lock, terraLockId)) remember(t.ton_lock, { watched: true });
}
async function sendGramClaim(t, secret){
  const r = await fetch(NET.tonApi + '/sendBoc', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boc: claimMessage(tonRaw(t.ton_lock), String(secret)) }) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!j.ok) throw new Error('TON refused the claim: ' + (j.error || r.status));
}

function windowLeftOf(t){ return t.created + (POLICY ? POLICY.answer_window_sec : 900) - now(); }

function stepper(done){
  const names = ['Buyer locked GRAM', 'You lock LUNC', 'Buyer claims', 'GRAM to you'];
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
    (t.status === 'unanswered' && mineFor(t.ton_lock).id) ||
    (t.status === 'pending' && mineFor(t.ton_lock).id)));
  if (!active.length) {
    box.innerHTML = '<div class="gx-none">No active deals. When a buyer takes your offer it shows up here, with a chime.</div>';
    return;
  }
  box.innerHTML = active.map(function (t) {
    const mine = mineFor(t.ton_lock);
    const head = '<b>' + human(t.lunc, 6) + ' LUNC</b> for ' + human(t.gram, 9) + ' GRAM';
    const pair = '<span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'GRAM' }) + iconHTML({ sym: 'LUNC' }) + '</span>';
    if (mine.id && !t.terra_lock_id && mine.timeout && now() >= mine.timeout) {
      return '<div class="gx-item gx-deal" data-ton="' + esc(t.ton_lock) + '">' + pair +
        '<div class="gx-l">' + head + '<span>Your LUNC lock #' + mine.id + ' was never taken: it can come back to you now</span></div>' +
        '<button class="btn solid gx-answer gx-terra-refund" type="button" data-id="' + mine.id + '" data-ton="' + esc(t.ton_lock) + '">Refund</button>' +
      '</div>';
    }
    if (t.status === 'pending' || !t.terra_lock_id) {
      return '<div class="gx-item gx-deal" data-ton="' + esc(t.ton_lock) + '">' + pair +
        '<div class="gx-l">' + head + '<span>' + (mine.id ? 'LUNC locked, the answer still has to be reported'
          : 'Waiting for your answer \u00b7 ' + left(windowLeftOf(t)) + ' left') + '</span>' + stepper(1) + '</div>' +
        '<button class="btn solid gx-answer" type="button" data-ton="' + esc(t.ton_lock) + '">' + (mine.id ? 'Report' : 'Answer') + '</button>' +
      '</div>';
    }
    const rel = RELEASE[t.ton_lock];
    if (rel) {
      return '<div class="gx-item gx-deal" data-ton="' + esc(t.ton_lock) + '">' + pair +
        '<div class="gx-l">' + head + '<span>' + (rel.error
          ? 'The buyer claimed the LUNC; releasing your GRAM did not go through yet (' + esc(rel.error) + ')'
          : 'The buyer claimed the LUNC \u00b7 releasing your GRAM to your TON address') + '</span>' + stepper(3) + '</div>' +
        '<button class="btn solid gx-answer gx-release" type="button" data-ton="' + esc(t.ton_lock) + '">Release GRAM</button>' +
      '</div>';
    }
    return '<div class="gx-item gx-deal" data-ton="' + esc(t.ton_lock) + '">' + pair +
      '<div class="gx-l">' + head + '<span>Your LUNC is locked \u00b7 waiting for the buyer to claim</span>' + stepper(2) + '</div>' +
      '<span class="gx-tag pending">live</span>' +
    '</div>';
  }).join('');
  paintIcons(box);
  checkFinished(active.filter(t => t.status === 'locked' && t.terra_lock_id));
}

// Answered deals, read from both chains. The Terra side tells whether the
// buyer took the LUNC; the deal is over only when the TON side is: the GRAM
// paid to me (claimed), or nothing more to do (refunded on Terra).
let CHECKING = false;
async function checkFinished(list){
  if (CHECKING || !list.length) return;
  CHECKING = true;
  let changed = false;
  try {
    for (const t of list) {
      if (!mineFor(t.ton_lock).watched) await watchDeal(t, t.terra_lock_id);
      let tl;
      try { tl = await terraLockRead(t.terra_lock_id); } catch (e) { continue; }
      const st = tl && tl.status;
      if (st === 'open') { OPEN_SEEN.add(t.ton_lock); continue; }
      if (st === 'refunded') {
        setFinal(t.ton_lock, 'refunded');
        changed = true;
        if (OPEN_SEEN.has(t.ton_lock)) notify({ key: 'gram:back:' + t.ton_lock, kind: 'info', icon: 'LUNC', label: 'Deal ended \u00b7 GRAM',
          title: 'Your LUNC came back',
          text: 'The buyer did not claim in time, so the ' + human(t.lunc, 6) + ' LUNC locked for them is back on your address.' });
        continue;
      }
      if (st !== 'claimed') continue;
      // the LUNC is the buyer's: now the GRAM must reach me
      let n;
      try { n = await readLock(NET.tonApi, t.ton_lock, NET.tonCodeHash); } catch (e) { continue; }
      const was = RELEASE[t.ton_lock];
      if (n.status === 'claimed') {
        setFinal(t.ton_lock, 'claimed');
        delete RELEASE[t.ton_lock];
        changed = true;
        if (OPEN_SEEN.has(t.ton_lock) || was) notify({ key: 'gram:done:' + t.ton_lock, kind: 'success', icon: 'GRAM', label: 'Deal done \u00b7 GRAM',
          title: 'Sold ' + human(t.lunc, 6) + ' LUNC',
          text: 'The buyer claimed the LUNC and ' + human(t.gram, 9) + ' GRAM was paid to your TON address.' });
      } else if (n.status === 'open' && now() < n.timeout) {
        const rel = RELEASE[t.ton_lock] = Object.assign({ sentAt: 0 }, was, { secret: tl.secret || (was && was.secret) });
        if (!was) changed = true;
        if (rel.secret && now() - rel.sentAt > 90) {
          try { await sendGramClaim(t, rel.secret); rel.sentAt = now(); if (rel.error) { rel.error = ''; changed = true; } }
          catch (e) { if (rel.error !== e.message) { rel.error = e.message; changed = true; } }
        }
      } else {
        // refunded to the buyer, or past its timeout: the GRAM was not claimed in time
        setFinal(t.ton_lock, 'lost');
        delete RELEASE[t.ton_lock];
        changed = true;
        notify({ key: 'gram:lost:' + t.ton_lock, kind: 'warn', icon: 'GRAM', label: 'Deal \u00b7 GRAM',
          title: 'The GRAM was not released in time',
          text: 'The buyer claimed ' + human(t.lunc, 6) + ' LUNC, but the TON lock ' + (n.status === 'refunded' ? 'was refunded' : 'expired') +
            ' before the GRAM was claimed for you. Contact the Delfos team with this deal.' });
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
// LUNC kept out of Max for the gas of answering takes (review of #15):
// a maker who offers everything could not pay for the answer and would get a strike
const GAS_RESERVE = 50000000n;      // 50 LUNC
function available(){
  if (BAL === null) return null;
  const tax = BigInt(POLICY ? POLICY.tax_bps || 0 : 0);
  // the Worker counts takes waiting for an answer against the balance too
  const pending = TAKES.filter(t => t.status === 'pending').reduce((a, t) => a + BigInt(t.lunc), 0n);
  const a = (BAL - GAS_RESERVE) * (10000n - tax) / 10000n - MY_LIVE - pending;
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
  out.max = out.total;
  // GRAM per deal (audit round 3, E): the default smallest part is raised to
  // the minimum deal, and one take never asks more than the maximum deal
  const lim = dealLimits();
  if (out.price > 0n && (lim.min || lim.max)) {
    const luncAt = g => g * 1000000000000n / out.price;              // LUNC a deal of g nanoGRAM buys, rounded down
    if (lim.min) {
      const floor = luncAt(lim.min) + 1n;
      if (!minTxt && out.min < floor) out.min = floor;
      if (out.total < floor) out.errs.push('An offer must be worth at least ' + human(lim.min, 9) + ' GRAM here.');
      else if (out.min < floor) out.errs.push('The smallest part must be worth at least ' + human(lim.min, 9) + ' GRAM (' + human(floor, 6) + ' LUNC at your price).');
    }
    if (lim.max) {
      const ceil = luncAt(lim.max);
      if (out.max > ceil) out.max = ceil;
      if (out.min > ceil) out.errs.push('The smallest part can be worth at most ' + human(lim.max, 9) + ' GRAM (' + human(ceil, 6) + ' LUNC at your price).');
    }
  }
  if (out.min > out.total) out.errs.push('The smallest part cannot be more than the total.');
  out.hours = HOURS;
  const av = available();
  if (av !== null && out.total > av) out.errs.push('You can offer up to ' + human(av, 6) + ' LUNC (balance after the burn tax, minus your other live offers and takes waiting for you, and 50 LUNC kept for gas).');
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
  const expires = now() + f.hours * 3600 - 120;     // 2 min under the limit: a phone clock may run ahead
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
  say('#gx-msg', '');
  try {
    await consent('Publish this offer', lines, payload, async function (m, step) {
      step(0);
      const signed = await signArbitrary(m, addrOf(), payload);
      step(1);
      const r = await api('/offers', signed);
      if (r && r.id) keepSigned(r.id, payload);
    }, null, {
      steps: ['Signing the offer', 'Publishing it to buyers'],
      done: () => ({
        title: 'Offer published',
        text: 'Buyers see it now: ' + human(f.total, 6) + ' LUNC for up to ' + human(gramFor(f.total, f.price), 9) + ' GRAM. ' +
          'When one locks GRAM you hear a chime here' + (TG_LINKED ? ' and get a Telegram message.' : '.'),
        actions: (TG_INIT && !TG_LINKED) ? [{ label: 'Also alert me in Telegram', quiet: true, run: tgTurnOn }] : []
      })
    });
    $('#gx-sell').value = ''; $('#gx-get').value = ''; $('#gx-min').value = ''; MODE = 0;
    load();
  } catch (e) { /* cancelled, or explained in the sheet */ }
});

$('#gx-offers').addEventListener('click', async function(e){
  const b = e.target.closest('.gx-cancel');
  if (!b) return;
  const id = b.dataset.id;
  const o = MY_OFFERS.find(x => x.id === id);
  const payload = JSON.stringify({ type: 'htlc-offer-cancel', v: 1, id: id });
  const lines = o ? [['Offer', human(o.remaining_lunc, 6) + ' LUNC left of ' + human(o.total_lunc, 6)],
                     ['Price', '1 GRAM = ' + Math.round(1e15 / Number(o.price)).toLocaleString('en-US') + ' LUNC']]
                  : [['Offer', id.slice(0, 16) + '\u2026']];
  try {
    await consent('Cancel this offer', lines, payload, async function (m, step) {
      step(0);
      const signed = await signArbitrary(m, addrOf(), payload);
      step(1);
      await api('/offers/' + encodeURIComponent(id) + '/cancel', signed);
    }, null, {
      steps: ['Signing the cancellation', 'Taking it off the market'],
      done: () => ({ title: 'Offer cancelled', text: 'Buyers no longer see it. Deals a buyer already started still need your answer under Active deals.' })
    });
    load();
  } catch (err) { /* cancelled, or explained in the sheet */ }
});


/* ---------------- Telegram alerts ----------------
   The offers Worker messages the seller through the wallet's bot when a buyer
   announces a take, so a deal is not missed while the wallet is closed.
   Turning it on links this address to this Telegram account, once:
   Telegram's initData proves the account (the Worker checks it with the bot
   token), a signed message proves the address. The bot also needs the user's
   permission to write first (requestWriteAccess). Off needs no PIN.
   The switch has three states: off, busy (asking, signing, saving) and on. */
const TGW = window.Telegram && window.Telegram.WebApp;
const TG_INIT = (TGW && TGW.initData) || '';
const TG_USER = TGW && TGW.initDataUnsafe && TGW.initDataUnsafe.user ? TGW.initDataUnsafe.user.id : null;
let TG_LINKED = false;
let TG_BUSY = false;

function tgPaint(){
  const sw = $('#gx-tg-btn');
  sw.setAttribute('aria-checked', TG_LINKED ? 'true' : 'false');
  sw.classList.toggle('busy', TG_BUSY);
  sw.disabled = TG_BUSY;
  $('#gx-tg-line').classList.toggle('on', TG_LINKED);
  $('#gx-tg-sub').textContent = TG_LINKED
    ? 'The wallet bot messages you when a buyer locks GRAM, even with the wallet closed.'
    : 'Get a message from the wallet bot when a buyer locks GRAM, even with the wallet closed.';
}
async function tgStatus(){
  const line = $('#gx-tg-line');
  if (!line || !TG_INIT || !TG_USER || !addrOf()) return;      // outside Telegram: nothing to link
  try {
    const st = await api('/notify/status', { initData: TG_INIT, address: addrOf() });
    line.hidden = !st.enabled;
    if (!TG_BUSY) { TG_LINKED = !!st.linked; tgPaint(); }
  } catch (e) { line.hidden = true; }
}
function writeAccess(){
  return new Promise(function (resolve) {
    if (!TGW || typeof TGW.requestWriteAccess !== 'function' || !(TGW.isVersionAtLeast && TGW.isVersionAtLeast('6.9'))) { resolve(true); return; }
    try { TGW.requestWriteAccess(ok => resolve(!!ok)); } catch (e) { resolve(true); }
  });
}
async function tgTurnOn(){
  if (TG_BUSY || TG_LINKED) return;
  TG_BUSY = true; tgPaint();
  say('#gx-tg-msg', '');
  try {
    if (!(await writeAccess())) { say('#gx-tg-msg', 'Telegram did not allow the bot to message you. Turn it on again and choose Allow.', true); return; }
    const payload = JSON.stringify({ type: 'frontier-notify-link', v: 1, network: NET.name, address: addrOf(), tg_id: String(TG_USER), ts: now() });
    await consent('Turn on Telegram alerts', [
      ['Address', addrOf().slice(0, 12) + '\u2026' + addrOf().slice(-6)],
      ['Alerts go to', 'this Telegram account'],
      ['When', 'a buyer locks GRAM for your offer']
    ], payload, async function (m, step) {
      step(0);
      const signed = await signArbitrary(m, addrOf(), payload);
      step(1);
      await api('/notify/link', Object.assign({ initData: TG_INIT }, signed));
      TG_LINKED = true;
    }, null, {
      steps: ['Signing the link', 'Connecting the wallet bot'],
      done: () => ({ title: 'Telegram alerts are on', text: 'When a buyer locks GRAM for your offer, the wallet bot sends you a message with a button that opens this deal.' })
    });
  } catch (e) {
    if (e && !e.shown && e.message !== 'cancelled' && e.message !== 'watch only') say('#gx-tg-msg', e.message || String(e), true);
  } finally {
    TG_BUSY = false; tgPaint();
  }
}
async function tgTurnOff(){
  if (TG_BUSY || !TG_LINKED) return;
  TG_BUSY = true; tgPaint();
  say('#gx-tg-msg', '');
  try {
    await api('/notify/unlink', { initData: TG_INIT, address: addrOf() });
    TG_LINKED = false;
  } catch (e) {
    say('#gx-tg-msg', 'Could not turn alerts off: ' + (e.message || e), true);
  } finally {
    TG_BUSY = false; tgPaint();
  }
}
$('#gx-tg-btn').addEventListener('click', () => (TG_LINKED ? tgTurnOff() : tgTurnOn()));

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

// the Terra lock's timeout, computed from the TON lock's at the moment it is used
function terraTimeout(n){
  const p = POLICY;
  return Math.min(now() + p.t_terra_sec, (n.timeout || 0) - p.terra_gap_sec - MARGIN);
}
async function checkTake(t){
  if (!POLICY) setPolicy((await api('/offers')).policy);
  if (!POLICY) throw new Error((POLICY_ERR || 'the swap rules could not be loaded') + ' Not answering without them.');
  // what I signed, not the Worker's copy of it (audit round 3, B1)
  const offer = signedOffer(t.offer_id);
  const n = await readLock(NET.tonApi, t.ton_lock, NET.tonCodeHash);
  const p = POLICY;
  const problems = [];
  if (!offer || offer.maker !== addrOf() || offer.network !== NET.name)
    problems.push('this offer was not signed on this device; answer it from the device that published it');
  else if (BigInt(t.lunc) < BigInt(offer.min_lunc) || BigInt(t.lunc) > BigInt(offer.max_lunc))
    problems.push('the take is outside the amounts you offered');
  else if (n.state !== 'active') problems.push('the buyer\u2019s TON lock does not exist (yet)');
  else if (n.foreignCode) problems.push('the TON lock does not run the audited contract');
  else {
    if (n.status !== 'open') problems.push('the TON lock is ' + n.status);
    if (n.hash !== t.hash) problems.push('the TON lock is under another hash');
    if (n.recipient !== tonRaw(offer.maker_ton)) problems.push('the TON lock does not pay your TON address');
    if (n.takerRef !== await takeRefOf(t.taker_terra, t.offer_id, t.lunc)) problems.push('the TON lock is committed to another take');
    if (n.amount < gramFor(BigInt(t.lunc), BigInt(offer.price))) problems.push('the TON lock holds too little GRAM');
    // The status sits in the lock's initial data: the audited code can be
    // deployed "already open" with no GRAM, never going through Lock. Only a
    // lock at the address its own terms give (status 0) is the real one, and
    // it must hold what it promises (review of #16).
    const real = await buildLock(NET.tonCode, { hash: n.hash, amount: n.amount, tip: n.tip, timeout: n.timeout,
      takerRef: n.takerRef, recipient: n.recipient, refundTo: n.refundTo, relayer: n.relayer });
    if (real.raw !== tonRaw(t.ton_lock)) problems.push('the TON lock was not made through Lock (not a genuine lock)');
    else if (n.balance < n.amount + n.tip) problems.push('the TON lock does not hold the GRAM it claims');
  }
  const timeout = terraTimeout(n);
  if (!problems.length && timeout < now() + p.min_terra_left_sec + 60) problems.push('the TON lock ends too soon to answer safely');
  const tax = BigInt(p.tax_bps);
  const gross = ceilDiv(BigInt(t.lunc) * 10000n, 10000n - tax);
  return { offer: offer, n: n, problems: problems, timeout: timeout, gross: gross };
}

async function report(t, id, mnemonic){
  const payload = JSON.stringify({ type: 'htlc-take-locked', v: 1, network: NET.name, ton_lock: t.ton_lock, terra_lock_id: id });
  const signed = await signArbitrary(mnemonic, addrOf(), payload);
  await api('/takes/' + encodeURIComponent(t.ton_lock) + '/locked', signed);
  remember(t.ton_lock, { reported: true });
  // the relayer finishes the swap only if it knows about it (audit round 3, A)
  if (await relayerWatch(t.ton_lock, id)) remember(t.ton_lock, { watched: true });
}

$('#gx-takes').addEventListener('click', async function(e){
  const r = e.target.closest('.gx-terra-refund');
  if (r) {
    r.disabled = true;
    const step = { contract: NET.htlc, msg: { refund: { id: Number(r.dataset.id) } }, funds: [] };
    try {
      await consent('Refund your LUNC lock', [['Terra lock', '#' + r.dataset.id], ['Goes back to', addrOf()]],
        JSON.stringify(step.msg), async function (m, st) {
          st(0);
          const s2 = await sendSwap(addrOf(), [step], m, NET);
          st(1);
          const res = await s2.wait();
          if (!res) throw new Error('the refund was sent but is not confirmed yet (tx ' + s2.hash.slice(0, 10) + '\u2026). Refresh in a minute.');
        },
        'A transaction: it returns your locked LUNC from the swap contract, now that the lock has expired.', {
          steps: ['Sending the refund', 'Waiting for the block'],
          done: () => ({ title: 'LUNC returned', text: 'The LUNC from lock #' + r.dataset.id + ' is back on your address.' })
        });
      setFinal(r.dataset.ton, 'refunded');
      load();
    } catch (err) { if (err && !err.shown && err.message !== 'cancelled') say('#gx-status', String(err.message || err), true); r.disabled = false; }
    return;
  }
  const rl = e.target.closest('.gx-release');
  if (rl) {
    const t = TAKES.find(x => x.ton_lock === rl.dataset.ton);
    if (!t) return;
    rl.disabled = true;
    say('#gx-status', 'Releasing your GRAM');
    try {
      const tl = await terraLockRead(t.terra_lock_id);
      if (!tl || tl.status !== 'claimed' || !tl.secret) throw new Error('the buyer has not claimed the LUNC on ' + NET.chain + ' yet');
      await sendGramClaim(t, tl.secret);
      RELEASE[t.ton_lock] = Object.assign(RELEASE[t.ton_lock] || {}, { secret: tl.secret, sentAt: now(), error: '' });
      say('#gx-status', 'Claim sent. The GRAM reaches your TON address in a minute.');
    } catch (err) { say('#gx-status', String(err.message || err), true); }
    rl.disabled = false;
    return;
  }
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
      await consent('Send your answer', [['Terra lock', '#' + had.id], ['For', human(t.lunc, 6) + ' LUNC to ' + t.taker_terra.slice(0, 12) + '\u2026']],
        payload, async function (m, st) { st(0); await report(t, had.id, m); }, null, {
          steps: ['Signing and sending your answer'],
          done: () => ({ title: 'Answer sent', text: 'The buyer can claim the LUNC now. The GRAM is released to your TON address when they do.' })
        });
      load(); return;
    }
    if (had.tx) {
      // the lock was sent but its id never came back: look the tx up
      // only a real "not found" counts as not landed; a network error proves nothing
      let res = null, notFound = false;
      try {
        const r = await fetch(NET.lcd + '/cosmos/tx/v1beta1/txs/' + had.tx);
        if (r.ok) res = (await r.json()).tx_response;
        else if (r.status === 404 || r.status === 400) notFound = true;
      } catch (e) {}
      if (res && Number(res.code) === 0 && lockIdOf(res)) {
        remember(t.ton_lock, { id: lockIdOf(res) });
        if (b) b.disabled = false;
        return answerTake(t, b);                        // goes straight to Report
      }
      if (res && Number(res.code) !== 0) remember(t.ton_lock, { tx: null });   // it failed on chain: a new lock is fine
      else if (notFound && now() - (had.at || 0) > 180) remember(t.ton_lock, { tx: null });   // never landed
      else { say('#gx-status', 'Your lock for this take is still on its way (tx ' + had.tx.slice(0, 10) + '\u2026). Try again in a minute.', true); return; }
    }
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
      ['Claim until', 'about ' + new Date(c.timeout * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (set when you sign)'],
      ['If unclaimed', 'the LUNC comes back to you after that'],
      ['Network', NET.chain + ' + TON testnet']
    ];
    const NOTE_ANSWER = 'A transaction: it locks your LUNC on ' + NET.chain + ' for this buyer, then signs your answer. If the buyer never claims, the LUNC comes back to you.';
    await consent('Answer this take', lines, JSON.stringify(step.msg, null, 1) + '\n\nthen signed: htlc-take-locked for ' + t.ton_lock, async function(m, st){
      // the PIN may have taken a while: the timeout is set again now and checked
      st(0);
      step.msg.lock.timeout = terraTimeout(c.n);
      if (step.msg.lock.timeout < now() + POLICY.min_terra_left_sec + 60) throw new Error('too late to answer this take safely now. Nothing was locked.');
      const sent = await sendSwap(addrOf(), [step], m, NET);
      remember(t.ton_lock, { tx: sent.hash, at: now(), timeout: step.msg.lock.timeout });
      st(1);
      const res = await sent.wait();
      if (!res) throw new Error('the lock was sent but is not confirmed yet (tx ' + sent.hash.slice(0, 10) + '\u2026). Refresh in a minute, then press Report.');
      const id = lockIdOf(res);
      if (!id) throw new Error('the lock went through but its id was not found (tx ' + sent.hash.slice(0, 10) + '\u2026). Refresh in a minute, then press Report.');
      remember(t.ton_lock, { id: id });
      st(2);
      await report(t, id, m);
      return { id: id, timeout: step.msg.lock.timeout };
    }, NOTE_ANSWER, {
      steps: ['Locking ' + human(c.gross, 6) + ' LUNC on ' + NET.chain, 'Waiting for the block', 'Sending your answer to the buyer'],
      done: r => ({
        title: 'Answered',
        text: human(t.lunc, 6) + ' LUNC is locked for the buyer (lock #' + r.id + '). When they claim it, ' + human(t.gram, 9) +
          ' GRAM is released to your TON address. If they never do, the LUNC comes back to you after ' +
          new Date(r.timeout * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.'
      })
    });
    load();
  } catch (err) {
    if (err && !err.shown && err.message !== 'cancelled') { report_('gram', err); say('#gx-status', String(err && err.message || err), true); }
    if (err && err.shown) load();
  } finally {
    if (b) b.disabled = false;
  }
}

/* ---------------- a new buyer: tell the maker ----------------
   While the wallet is open (any screen), the maker's takes are read every
   15 s. A take not seen before that is waiting for an answer raises the
   wallet-wide card (notify.js): a chime, a vibration, Answer. The card waits
   for the PIN screen and any open sheet, and is dropped if the take was
   answered or its window closed meanwhile. The home card keeps a count.
   With the wallet closed, the Telegram bot tells the maker (offers Worker). */
const SEEN = new Set();
function badge(n){
  const el = $('#xc-gram-n');
  if (!el) return;
  el.textContent = n > 9 ? '9+' : String(n);
  el.hidden = !n;
}
function windowLeft(t){ return t.created + (POLICY ? POLICY.answer_window_sec : 900) - now(); }
const stillWaiting = t => windowLeft(t) > 0 && !mineFor(t.ton_lock).id;

function alertTake(t){
  notify({
    key: 'gram:take:' + t.ton_lock, kind: 'info', theme: 'gram', live: true, icon: 'GRAM',
    label: 'New buyer \u00b7 GRAM',
    title: human(t.lunc, 6) + ' LUNC for ' + human(t.gram, 9) + ' GRAM',
    text: () => 'Answer within ' + left(windowLeft(t)) + ', or the buyer\u2019s GRAM goes back and it counts as a miss.',
    valid: () => stillWaiting(t),
    actions: [{ label: 'Answer', primary: true, run: () => openDeal(t.ton_lock, true) }]
  });
}

// the Sell tab with this deal in view and marked; answer: open its sheet too
async function openDeal(ton, answer){
  if (!$('#st-gram').classList.contains('on')) go('gram');
  tab('sell');
  await load();
  let row = null;
  for (let k = 0; k < 20 && !row; k++) {
    row = document.querySelector('.gx-deal[data-ton="' + CSS.escape(ton) + '"]');
    if (!row) await new Promise(r => setTimeout(r, 250));
  }
  if (!row) { say('#gx-status', 'That deal is no longer waiting for you: it was answered, or its time ran out.'); return; }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  const t = TAKES.find(x => x.ton_lock === ton);
  if (answer && t && t.status === 'pending' && stillWaiting(t)) answerTake(t, row.querySelector('.gx-answer'));
}

async function watchTakes(){
  const me = addrOf();
  if (!me || !LABS || document.hidden || LOADING) return;
  let d;
  try { d = await api('/takes?maker=' + encodeURIComponent(me)); } catch (e) { return; }
  if (!POLICY) { try { setPolicy((await api('/offers')).policy); } catch (e) {} }
  const waiting = (d.takes || []).filter(t => t.status === 'pending' && stillWaiting(t));
  badge(waiting.length);
  const fresh = waiting.filter(t => !SEEN.has(t.ton_lock));
  waiting.forEach(t => SEEN.add(t.ton_lock));
  if ($('#st-gram').classList.contains('on')) { TAKES = d.takes || []; drawTakes(TAKES, d.stats || {}); }
  else {
    // off the GRAM screen, answered deals are still seen through: a GRAM
    // left to release is claimed from here (audit round 3, A)
    const fin = finals();
    const answered = (d.takes || []).filter(t => t.status === 'locked' && t.terra_lock_id && !fin[t.ton_lock]);
    if (answered.length && now() - LAST_SWEEP >= 60) { LAST_SWEEP = now(); checkFinished(answered); }
  }
  fresh.forEach(alertTake);
}
let LAST_SWEEP = 0;

/* Opened from the bot's message: the button carries ?take=<TON lock>. Once
   the wallet is unlocked, go straight to that deal. */
const DEEP_TAKE = (function () { try { return new URLSearchParams(location.search).get('take'); } catch (e) { return null; } })();
let DEEP_DONE = false;
document.addEventListener('frontier:wallet', function () {
  if (!DEEP_TAKE || DEEP_DONE || !LABS) return;
  DEEP_DONE = true;
  SEEN.add(DEEP_TAKE);                  // the card would only repeat what the bot said
  setTimeout(() => openDeal(DEEP_TAKE, false), 300);
});
setInterval(watchTakes, 15000);
setTimeout(watchTakes, 3000);

/* ================= the buyer's side (stage 4) =================
   Buy LUNC with GRAM from an offer in the book:
   1. the wallet makes a 32-byte secret and keeps it on the device first;
   2. it builds the TON lock (gram-tonlock.js) and the buyer pays it from
      their own TON wallet through TON Connect;
   3. once the lock is open on TON, the take is announced to the Worker;
   4. when the seller answers, the wallet checks the seller's Terra lock on
      the chain (open, same hash, pays me, LUNC, enough after tax, time left)
      and only then hands the secret to the relayer, which claims the LUNC
      for me (no gas of my own) and the GRAM for the seller;
   5. if the seller never answers, after the TON lock's timeout "Get my GRAM
      back" sends the lock's free refund message.
   Nothing here needs the Terra key: a watch-only wallet can buy too. */
let BOOK = [];
let TC = null, TC_LOADING = null;
const CLAIM_MARGIN = NET.name === 'testnet' ? 300 : 3600;     // what the relayer needs left on the Terra lock
const buysKey = () => 'fw:gram:buys:' + addrOf();
function buys(){ try { return JSON.parse(localStorage.getItem(buysKey()) || '{}'); } catch (e) { return {}; } }
function saveBuy(id, v){ const b = buys(); b[id] = Object.assign(b[id] || {}, v); try { localStorage.setItem(buysKey(), JSON.stringify(b)); } catch (e) {} return b[id]; }
// The relayer receives the buyer's secret. Only on testnet may a URL saved on
// this device replace the one pinned in gram-net.js; anywhere else the pinned
// one is used even if an old value is still in storage.
const relayerUrl = () => {
  const pinned = (NET.relayer || '').replace(/\/+$/, '');
  if (NET.name !== 'testnet') return pinned;
  try { return (localStorage.getItem('fw:gram:relayer') || pinned).replace(/\/+$/, ''); } catch (e) { return pinned; }
};
const tipOf = gram => { const p = POLICY || {}; const fee = gram * BigInt(p.fee_bps || 0) / 10000n; const min = BigInt(p.min_tip || 5000000); return fee > min ? fee : min; };
const RESERVE_NANO = 50000000n;

/* ---------- tabs ---------- */
function tab(name){
  document.querySelectorAll('.gx-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('#gx-pane-buy').hidden = name !== 'buy';
  $('#gx-pane-sell').hidden = name !== 'sell';
  try { localStorage.setItem('fw:gram:tab', name); } catch (e) {}
}
document.querySelectorAll('.gx-tab').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
try { tab(localStorage.getItem('fw:gram:tab') || 'buy'); } catch (e) { tab('buy'); }

/* ---------- TON Connect ---------- */
function loadTonConnect(){
  if (TC) return Promise.resolve(TC);
  if (TC_LOADING) return TC_LOADING;
  TC_LOADING = new Promise(function (resolve, reject) {
    const sc = document.createElement('script');
    sc.src = NET.tonConnectScript;
    sc.onload = function () {
      try {
        const base = location.origin + location.pathname.replace(/[^/]*$/, '');
        const opts = { manifestUrl: base + 'tonconnect-manifest.json' };
        if (NET.twaReturnUrl) opts.actionsConfiguration = { twaReturnUrl: NET.twaReturnUrl };
        TC = new window.TON_CONNECT_UI.TonConnectUI(opts);
        TC.onStatusChange(showWallet);
        TC.connectionRestored.then(() => showWallet(TC.wallet));
        resolve(TC);
      } catch (e) { reject(e); }
    };
    sc.onerror = () => reject(new Error('TON Connect could not be loaded'));
    document.head.appendChild(sc);
  });
  return TC_LOADING;
}
function tonAccount(){ return TC && TC.wallet && TC.wallet.account || null; }
function showWallet(w){
  const a = w && w.account;
  $('#gx-tc-name').textContent = a ? ((w.device && w.device.appName) || 'TON wallet') + ' connected' : 'TON wallet';
  $('#gx-tc-addr').textContent = a ? (a.address.slice(0, 8) + '\u2026' + a.address.slice(-6) +
    (a.chain !== NET.tonChain ? ' \u00b7 switch it to ' + (NET.tonChain === '-3' ? 'testnet' : 'mainnet') : '')) : 'Pays the GRAM. Not connected.';
  $('#gx-tc-btn').textContent = a ? 'Disconnect' : 'Connect';
}
$('#gx-tc-btn').addEventListener('click', async function(){
  try {
    const tc = await loadTonConnect();
    if (tc.wallet) await tc.disconnect(); else await tc.openModal();
  } catch (e) { say('#gx-status', String(e.message || e), true); }
});
// restore a connection made earlier, without loading the library for nobody
try { if (localStorage.getItem('ton-connect-storage_bridge-connection')) loadTonConnect().catch(() => {}); } catch (e) {}

/* ---------- the book ---------- */
function drawBook(){
  const box = $('#gx-book');
  const list = BOOK.slice().sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1));
  $('#gx-book-n').textContent = list.length ? list.length + ' live' : '';
  if (!list.length) { box.innerHTML = '<div class="gx-none">No offers right now. Pull to refresh in a minute, or sell LUNC yourself on the Sell tab.</div>'; return; }
  box.innerHTML = list.map(function (o) {
    // numbers only: the Worker's data never reaches the page as markup (audit round 3, B2)
    const st = o.maker_stats || {};
    const ans = Math.max(0, Math.floor(Number(st.answered) || 0)), miss = Math.max(0, Math.floor(Number(st.unanswered) || 0));
    const rec = (ans || miss) ? ans + ' of ' + (ans + miss) + ' answered' : 'new seller';
    return '<div class="gx-item gx-offer">' +
      '<span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'LUNC' }) + '</span>' +
      '<div class="gx-l"><b>1 GRAM = ' + Math.round(1e15 / Number(o.price)).toLocaleString('en-US') + ' LUNC</b>' +
        '<span>' + human(o.max_lunc, 6) + ' LUNC available \u00b7 from ' + human(o.min_lunc, 6) + ' \u00b7 ' + rec + '</span></div>' +
      '<button class="btn solid gx-answer gx-buy-btn" type="button" data-id="' + esc(o.id) + '">Buy</button>' +
    '</div>';
  }).join('');
  paintIcons(box);
}
$('#gx-book').addEventListener('click', function(e){
  const b = e.target.closest('.gx-buy-btn');
  if (!b) return;
  const o = BOOK.find(x => x.id === b.dataset.id);
  if (o) openBuy(o);
});

/* ---------- the buy box ---------- */
let BUYING = null;
function openBuy(o){
  BUYING = o;
  $('#gx-bb-rate').textContent = '1 GRAM = ' + Math.round(1e15 / Number(o.price)).toLocaleString('en-US') + ' LUNC';
  $('#gx-bb-range').textContent = 'From ' + human(o.min_lunc, 6) + ' to ' + human(o.max_lunc, 6) + ' LUNC';
  $('#gx-bb-lunc').value = human(o.min_lunc, 6).replace(/,/g, '');
  $('#gx-buybox').hidden = false;
  quote();
  $('#gx-buybox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#gx-bb-x').addEventListener('click', () => { $('#gx-buybox').hidden = true; BUYING = null; });
$('#gx-bb-max').addEventListener('click', () => { if (BUYING) { $('#gx-bb-lunc').value = human(BUYING.max_lunc, 6).replace(/,/g, ''); quote(); } });
$('#gx-bb-lunc').addEventListener('input', quote);
function buyTerms(){
  const o = BUYING;
  if (!o) return null;
  let lunc; try { lunc = BigInt(toRaw($('#gx-bb-lunc').value.trim().replace(',', '.'), 6)); } catch (e) { lunc = 0n; }
  const gram = gramFor(lunc, BigInt(o.price));
  const tip = tipOf(gram);
  const err = !(lunc > 0n) ? 'Enter how much LUNC you want.'
    : lunc < BigInt(o.min_lunc) ? 'This seller sells from ' + human(o.min_lunc, 6) + ' LUNC.'
    : lunc > BigInt(o.max_lunc) ? 'This seller has ' + human(o.max_lunc, 6) + ' LUNC available.'
    : dealErr(gram) || openErr();
  return { o: o, lunc: lunc, gram: gram, tip: tip, err: err };
}
function quote(){
  const q = buyTerms();
  if (!q) return;
  $('#gx-bb-sum').innerHTML =
    '<div><span>You pay</span><b>' + human(q.gram + q.tip + RESERVE_NANO, 9) + ' GRAM</b></div>' +
    '<div><span>Price</span><b>' + human(q.gram, 9) + ' GRAM</b></div>' +
    '<div><span>Relayer fee</span><b>' + human(q.tip, 9) + ' GRAM</b></div>' +
    '<div><span>TON network reserve</span><b>' + human(RESERVE_NANO, 9) + ' GRAM</b></div>' +
    '<div><span>You receive</span><b>' + (q.lunc > 0n ? human(q.lunc, 6) : '0') + ' LUNC, no gas needed</b></div>';
  $('#gx-bb-msg').textContent = q.err || (relayerUrl() ? '' : 'No relayer address is set (bottom of the Buy tab).');
  $('#gx-bb-msg').classList.toggle('bad', !!q.err);
  $('#gx-bb-pay').disabled = !!q.err || !relayerUrl();
}

const toHex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
async function sha256hex(u){ return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', u))); }

$('#gx-bb-pay').addEventListener('click', async function(){
  const q = buyTerms();
  if (!q || q.err) return;
  const me = addrOf();
  if (!me) { say('#gx-bb-msg', 'Open a wallet first.', true); return; }
  const btn = this; btn.disabled = true;
  let id = null;
  try {
    const tc = await loadTonConnect();
    if (!tc.wallet) { await tc.openModal(); say('#gx-bb-msg', 'Connect your TON wallet, then press Pay again.'); return; }
    const acc = tonAccount();
    if (acc.chain !== NET.tonChain) { say('#gx-bb-msg', 'Your TON wallet is on the wrong network: switch it to ' + (NET.tonChain === '-3' ? 'testnet' : 'mainnet') + '.', true); return; }
    const policy = POLICY || setPolicy((await api('/offers')).policy);
    if (!policy) { say('#gx-bb-msg', POLICY_ERR || 'The swap rules could not be loaded. Try again in a minute.', true); return; }
    // the offer as it stands now, not as the book showed it (audit round 3, D2)
    let fresh;
    try { fresh = await api('/offers/' + encodeURIComponent(q.o.id)); }
    catch (e) {
      if (e.status === 404) { say('#gx-bb-msg', 'This offer is no longer available. Pick another one.', true); load(); }
      else say('#gx-bb-msg', 'The offer could not be checked just now. Try again in a moment.', true);
      return;
    }
    if (!fresh.live) { say('#gx-bb-msg', 'This offer was cancelled or is no longer shown to buyers. Pick another one.', true); load(); return; }
    if (fresh.price !== q.o.price || fresh.maker_ton !== q.o.maker_ton) { say('#gx-bb-msg', 'The seller changed this offer. Check it again before paying.', true); load(); return; }
    if (BigInt(fresh.remaining_lunc) < q.lunc || BigInt(fresh.min_lunc) > q.lunc || Number(fresh.expires) < now() + policy.answer_window_sec) {
      say('#gx-bb-msg', 'This offer cannot take ' + human(q.lunc, 6) + ' LUNC any more (taken by someone else, or ending soon).', true); load(); return;
    }
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const hash = await sha256hex(secret);
    const terms = {
      hash: hash, amount: q.gram, tip: q.tip,
      timeout: now() + policy.min_ton_left_sec + 35 * 60,
      takerRef: await takeRefOf(me, q.o.id, q.lunc),
      recipient: tonRaw(q.o.maker_ton), refundTo: tonRaw(acc.address), relayer: tonRaw(policy.tip_address)
    };
    const lock = await buildLock(NET.tonCode, terms, { testOnly: NET.tonChain === '-3' });
    if (lock.codeHash !== String(NET.tonCodeHash).toUpperCase()) throw new Error('the lock code in this wallet does not match the audited one');
    id = lock.raw;
    // the secret is kept BEFORE any GRAM moves: without it the LUNC could not be claimed
    saveBuy(id, { offerId: q.o.id, lunc: String(q.lunc), gram: String(q.gram), tip: String(q.tip), secret: toHex(secret), hash: hash,
                  timeout: terms.timeout, address: lock.address, stage: 'paying', created: now() });
    say('#gx-bb-msg', 'Confirm the payment in your TON wallet');
    // after validUntil the payment can no longer land, so the chain gives a
    // sure answer then even if the wallet's answer is lost (audit round 3, D1)
    const validUntil = now() + 360;
    saveBuy(id, { validUntil: validUntil });
    await tc.sendTransaction({ validUntil: validUntil, network: NET.tonChain,
      messages: [{ address: lock.address, amount: String(lock.value), stateInit: lock.stateInit, payload: lock.payload }] });
    saveBuy(id, { stage: 'sent' });
    $('#gx-buybox').hidden = true; BUYING = null;
    say('#gx-status', '');
    buzz('success');
    drawBuys();
    watchBuys();
    load();
  } catch (e) {
    const m = String(e && e.message || e);
    const rejected = /reject|declin|cancel/i.test(m) || (e && /UserRejects/.test(e.name || ''));
    if (id && buys()[id] && buys()[id].stage === 'paying') {
      // refused in the TON wallet: nothing was signed. Any other failure (a
      // lost answer, the app closed meanwhile) is settled by reading the
      // chain: the buy stays 'paying' and watchBuys looks the lock up.
      if (rejected) saveBuy(id, { stage: 'cancelled' });
      else { drawBuys(); watchBuys(); }
    }
    say('#gx-bb-msg', rejected ? 'Payment cancelled in the TON wallet. Nothing was sent.'
      : 'No clear answer from the TON wallet. This wallet is checking on TON whether the payment went through.', !rejected);
  } finally { btn.disabled = false; }
});

/* ---------- my buys ----------
   The newest buy in progress gets a large card at the top of the Buy tab:
   big steps with the current one animated, what is happening now in plain
   words, and any problem (the relayer not reachable, the seller's lock not
   passing the check) with what to do. A finished buy shows a final card
   until it is closed. Other buys in progress are listed below it. */
const BUY_STEP = { paying: 0, sent: 0, announced: 1, unanswered: 1, claiming: 2, refunding: 1 };
const STEP_NAMES = ['You lock GRAM', 'Seller locks LUNC', 'You receive LUNC'];
const LIVE = ['paying', 'sent', 'announced', 'claiming', 'refunding', 'unanswered'];
function buyLine(b){
  const late = now() >= b.timeout;
  if (b.stage === 'paying') return (b.validUntil && now() > b.validUntil) ? 'Checking on TON whether your payment went through.' : 'Confirm the payment in your TON wallet. If you already did, this wallet finds it on TON by itself.';
  if (b.stage === 'sent') return 'Your GRAM is on its way into the lock on TON. Usually under a minute.';
  if (b.stage === 'announced') return 'The seller has been told. Waiting for them to lock your LUNC (up to ' + left(Math.max(0, (POLICY ? POLICY.answer_window_sec : 900))) + ').';
  if (b.stage === 'claiming') return 'The seller locked your LUNC and this wallet checked it \u2713. The relayer is claiming it for you now.';
  if (b.stage === 'unanswered') return 'The seller did not answer. Your GRAM can come back ' + (late ? 'now.' : 'in ' + left(b.timeout - now()) + '.');
  if (b.stage === 'refunding') return 'Refund sent. The GRAM comes back to your TON wallet in a minute.';
  return b.stage;
}
function stepsHtml(step, big){
  return '<div class="gx-steps' + (big ? ' big' : '') + '">' + STEP_NAMES.map((n, k) =>
    '<span class="' + (k < step ? 'ok' : k === step ? 'now' : '') + '">' + n + '</span>').join('') + '</div>';
}
function problemHtml(b){
  if (!b.problem) return '';
  const fix = b.problem.indexOf('relayer') >= 0 ? ' <button class="gx-link gx-relay-fix" type="button">change relayer</button>' : '';
  return '<div class="gx-problem">' + esc(b.problem) + fix + '</div>';
}
// the relayer is late: the buyer can claim the LUNC with this wallet's own key
// (it needs a little LUNC for gas), while there is time left
function selfClaimBtn(id, b){
  if (b.stage !== 'claiming' || !canSign() || !b.terraTimeout) return '';
  const leftSec = b.terraTimeout - now();
  const late = now() - (b.since || now()) > 180 || leftSec < 2 * CLAIM_MARGIN;
  // a claim too close to the end can land late and still publish the secret
  if (!late || leftSec < CLAIM_MARGIN / 2) return '';
  return '<button class="btn solid gx-selfclaim" type="button" data-id="' + esc(id) + '">Claim the LUNC myself</button>' +
    '<p class="gx-hint">The relayer has not claimed yet. Claiming yourself costs a little LUNC for gas' + (BAL !== null && BAL < 5000000n ? ' - you have none on ' + NET.chain + ' yet' : '') + '.</p>';
}
async function selfClaim(id){
  const b = buys()[id];
  if (!b || !b.terraLockId) return;
  const step = { contract: NET.htlc, msg: { claim: { id: b.terraLockId, secret: b.secret } }, funds: [] };
  try {
    await consent('Claim your LUNC', [['Terra lock', '#' + b.terraLockId], ['You receive', human(b.lunc, 6) + ' LUNC']],
      JSON.stringify({ claim: { id: b.terraLockId, secret: '(hidden: the secret kept on this device)' } }),
      async function (m, st) {
        st(0);
        const r = await sendSwap(addrOf(), [step], m, NET);
        st(1);
        if (!(await r.wait())) throw new Error('the claim was sent but is not confirmed yet (tx ' + r.hash.slice(0, 10) + '\u2026). It usually lands within a minute.');
      },
      'A transaction: it claims the LUNC locked for you, revealing the secret on ' + NET.chain + '. With it the GRAM is then released to the seller.', {
        steps: ['Sending the claim', 'Waiting for the block'],
        done: () => ({ title: 'LUNC claimed', text: human(b.lunc, 6) + ' LUNC is on your address. The GRAM is released to the seller next.' })
      });
    // so that the relayer releases the seller's GRAM too (audit round 3, A)
    relayerWatch(id, b.terraLockId);
  } catch (e) { /* cancelled, or explained in the sheet */ }
  watchBuys();
}

function refundBtn(id, b){
  const late = now() >= b.timeout;
  return (late && (b.stage === 'unanswered' || b.stage === 'announced' || b.stage === 'sent'))
    ? '<button class="btn solid gx-refund" type="button" data-id="' + esc(id) + '">Get my GRAM back</button>' : '';
}
function drawBuys(){
  const box = $('#gx-buys'), hero = $('#gx-hero');
  const all = Object.entries(buys());
  const live = all.filter(([, b]) => LIVE.includes(b.stage)).sort((a, b) => b[1].created - a[1].created);
  const doneNew = all.filter(([, b]) => b.stage === 'done' && !b.seen).sort((a, b) => b[1].created - a[1].created)[0];
  // the hero: a finished buy not yet closed, else the newest one in progress
  if (doneNew) {
    const [id, b] = doneNew;
    hero.className = 'gx-hero done';
    hero.innerHTML =
      '<div class="gx-hero-top"><span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'LUNC' }) + '</span><span>Purchase complete</span></div>' +
      '<b class="gx-hero-big">+' + human(b.lunc, 6) + ' LUNC</b>' +
      '<p>Received on your Frontier address for ' + human(b.gram, 9) + ' GRAM, with no gas of your own.</p>' +
      stepsHtml(3, true) +
      '<div class="gx-hero-links"><a href="' + NET.tonExplorer + esc(b.address) + '" target="_blank" rel="noopener">GRAM lock on TON</a>' +
      '<a href="' + NET.terraExplorer.replace(/tx\/$/, 'address/') + esc(addrOf()) + '" target="_blank" rel="noopener">Your LUNC on ' + NET.chain + '</a></div>' +
      '<button class="dust gx-hero-close" type="button" data-id="' + esc(id) + '">Close</button>';
    hero.hidden = false;
  } else if (live.length) {
    const [id, b] = live[0];
    hero.className = 'gx-hero';
    hero.innerHTML =
      '<div class="gx-hero-top"><span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'GRAM' }) + iconHTML({ sym: 'LUNC' }) + '</span><span>Buying</span></div>' +
      '<b class="gx-hero-big">' + human(b.lunc, 6) + ' LUNC</b>' +
      '<p class="gx-hero-sub">for ' + human(b.gram, 9) + ' GRAM</p>' +
      stepsHtml(BUY_STEP[b.stage] ?? 1, true) +
      '<p>' + buyLine(b) + '</p>' + problemHtml(b) + selfClaimBtn(id, b) + refundBtn(id, b);
    hero.hidden = false;
  } else hero.hidden = true;
  paintIcons(hero);
  // the rest of the buys in progress, small
  const rest = live.slice(doneNew ? 0 : 1);
  $('#gx-buys-head').hidden = !rest.length;
  box.innerHTML = rest.map(([id, b]) =>
    '<div class="gx-item gx-deal">' +
      '<span class="xc-ico gx-deal-ico">' + iconHTML({ sym: 'GRAM' }) + iconHTML({ sym: 'LUNC' }) + '</span>' +
      '<div class="gx-l"><b>' + human(b.lunc, 6) + ' LUNC</b> for ' + human(b.gram, 9) + ' GRAM<span>' + buyLine(b) + '</span>' +
        stepsHtml(BUY_STEP[b.stage] ?? 1) + problemHtml(b) + '</div>' + refundBtn(id, b) +
    '</div>').join('');
  paintIcons(box);
}
['#gx-buys', '#gx-hero'].forEach(function (sel) {
  $(sel).addEventListener('click', function (e) {
    const sc = e.target.closest('.gx-selfclaim');
    if (sc) { sc.disabled = true; selfClaim(sc.dataset.id).catch(err => { if (err && err.message !== 'cancelled') say('#gx-status', String(err.message || err), true); sc.disabled = false; }); return; }
    const c = e.target.closest('.gx-hero-close');
    if (c) { saveBuy(c.dataset.id, { seen: true }); drawBuys(); return; }
    if (e.target.closest('.gx-relay-fix')) $('#gx-relay-edit').click();
  });
});

async function onRefund(e){
  const b = e.target.closest('.gx-refund');
  if (!b) return;
  b.disabled = true;
  try {
    const r = await fetch(NET.tonApi + '/sendBoc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boc: refundMessage(b.dataset.id) }) });
    const j = await r.json();
    if (!j.ok) throw new Error('TON refused the refund: ' + (j.error || r.status));
    saveBuy(b.dataset.id, { stage: 'refunding' });
    say('#gx-status', 'Refund sent. The GRAM comes back to your TON wallet in a minute.');
    drawBuys();
  } catch (err) { say('#gx-status', String(err.message || err), true); b.disabled = false; }
}
$('#gx-buys').addEventListener('click', onRefund);
$('#gx-hero').addEventListener('click', onRefund);

// check the seller's Terra lock before the secret leaves the device
async function sellerLockOk(b, take){
  const q = btoa(JSON.stringify({ lock: { id: Number(take.terra_lock_id) } }));
  const l = (await getJSON(NET.lcd + '/cosmwasm/wasm/v1/contract/' + NET.htlc + '/smart/' + q, 8000, 2)).data || {};
  if (!POLICY) setPolicy((await api('/offers')).policy);
  if (!POLICY) return [POLICY_ERR || 'the swap rules could not be loaded'];
  const p = POLICY;
  const keep = 10000n - BigInt(p.tax_bps);
  const problems = [];
  if (l.status !== 'open') problems.push('the seller\u2019s lock is ' + l.status);
  if (String(l.hash).toLowerCase() !== b.hash) problems.push('another hash');
  if (l.recipient !== addrOf()) problems.push('it does not pay you');
  if (JSON.stringify(l.asset) !== JSON.stringify({ native: { denom: 'uluna' } })) problems.push('it is not LUNC');
  if (BigInt(l.amount || 0) * keep / 10000n < BigInt(b.lunc)) problems.push('too little LUNC after the burn tax');
  if (Number(l.timeout) - now() < CLAIM_MARGIN) problems.push('it ends too soon to claim safely');
  if (Number(l.timeout) + p.terra_gap_sec > b.timeout) problems.push('it ends too late');
  return problems;
}

let WATCHING_BUYS = false;
const REFUSAL_FINAL_SEC = 120;          // a take the Worker keeps refusing this long is refused
async function watchBuys(){
  if (WATCHING_BUYS || document.hidden) return;
  const all = buys();
  // a buy called off by the phone's clock stays watched for an hour: the TON
  // wallet checks validUntil against chain time, which may be behind (review of #21)
  const live = Object.entries(all).filter(([, b]) => ['paying', 'sent', 'announced', 'claiming', 'refunding', 'unanswered'].includes(b.stage)
    || (b.stage === 'cancelled' && b.validUntil && now() < b.validUntil + 3600));
  if (!live.length) return;
  WATCHING_BUYS = true;
  try {
    for (const [id, b] of live) {
      try {
        if (b.stage === 'cancelled') {
          const n = await readLock(NET.tonApi, id, NET.tonCodeHash);
          if (n.state === 'active' && n.status === 'open') saveBuy(id, { stage: 'sent', problem: null });   // it landed after all
          continue;
        }
        if (b.stage === 'paying' || b.stage === 'sent') {
          const n = await readLock(NET.tonApi, id, NET.tonCodeHash);
          if (n.state === 'active' && n.status === 'open') {
            // paid: announce the take, and say so plainly if the Worker refuses it
            let refused = null;
            try {
              await api('/takes', { offerId: b.offerId, tonLock: id, takerTerra: addrOf(), lunc: b.lunc });
            } catch (e) {
              // announced already (by us earlier, or by anyone on our behalf): fine if the record is ours
              let t = null;
              try { t = await api('/takes/' + encodeURIComponent(id)); } catch (e2) {}
              if (!t || t.taker_terra !== addrOf() || t.lunc !== b.lunc) {
                if (!e.status || e.status >= 500 || e.status === 429) throw e;     // not an answer yet: next round
                refused = e.message;
              }
            }
            // The Worker reads TON on its own and may not see the lock yet
            // ("TON lock is uninit"): a refusal counts only once it has
            // lasted REFUSAL_FINAL_SEC (review of #21).
            if (refused && (!b.refusedAt || now() - b.refusedAt < REFUSAL_FINAL_SEC)) {
              if (!b.refusedAt) saveBuy(id, { refusedAt: now() });
              refused = null;
              continue;
            }
            if (refused) {
              saveBuy(id, { stage: 'unanswered', problem: 'The offers service refused this purchase: ' + refused +
                '. Nothing reached the seller. Your GRAM comes back with "Get my GRAM back" from ' + new Date(b.timeout * 1000).toLocaleString() + '.' });
              notify({ key: 'gram:refused:' + id, kind: 'warn', icon: 'GRAM', label: 'Buy \u00b7 GRAM', title: 'Purchase not accepted',
                text: 'Your GRAM is locked until ' + new Date(b.timeout * 1000).toLocaleString() + ', then you can take it back.' });
            } else saveBuy(id, { stage: 'announced', problem: null, refusedAt: null });
          } else if (n.state === 'active' && n.status !== 'open') {
            saveBuy(id, { stage: n.status === 'refunded' ? 'refunded' : 'done' });
          } else if (now() > (b.validUntil || b.created + 360) + 300) {
            saveBuy(id, { stage: 'cancelled' });   // the payment can no longer land: nothing was locked
          }                                          // else: it may still land, read again next round
        } else if (b.stage === 'announced') {
          const t = await api('/takes/' + encodeURIComponent(id));
          if (t.status === 'locked' && t.terra_lock_id) {
            const problems = await sellerLockOk(b, t);
            if (problems.length) { saveBuy(id, { problem: 'The seller\u2019s lock did not pass the check: ' + problems.join('; ') + '. The secret stays on this device; your GRAM comes back after the timeout.' }); continue; }
            saveBuy(id, { stage: 'claiming', terraLockId: Number(t.terra_lock_id), problem: null, since: now() });
            chime(); buzz('success');
            b.stage = 'claiming'; b.terraLockId = Number(t.terra_lock_id);
          } else if (t.status === 'unanswered') saveBuy(id, { stage: 'unanswered' });
        }
        if (b.stage === 'claiming') {
          const q = btoa(JSON.stringify({ lock: { id: b.terraLockId } }));
          const l = (await getJSON(NET.lcd + '/cosmwasm/wasm/v1/contract/' + NET.htlc + '/smart/' + q, 8000, 1)).data || {};
          if (l.status === 'refunded' || (l.status === 'open' && now() >= Number(l.timeout))) {
            // the LUNC was not claimed in time: the GRAM comes back after the TON timeout
            saveBuy(id, { stage: 'unanswered', problem: 'The LUNC was not claimed before the seller\u2019s lock expired. Your GRAM comes back after the TON lock\u2019s timeout.' });
            continue;
          }
          if (l.status === 'open') b.terraTimeout = Number(l.timeout);
          if (l.status === 'claimed') {
            saveBuy(id, { stage: 'done', problem: null });
            notify({ key: 'gram:bought:' + id, kind: 'success', icon: 'LUNC', label: 'Buy done \u00b7 GRAM',
              title: 'Received ' + human(b.lunc, 6) + ' LUNC',
              text: 'It is on your Frontier address. The seller got the GRAM.' });
            load();
          } else if (l.status === 'open') {
            // the relayer finishes it; a repeated /claim with the same pair is answered, not doubled
            let problem = null;
            try {
              const r = await fetch(relayerUrl() + '/claim', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ terraLockId: b.terraLockId, tonLock: id, secret: b.secret, offerId: b.offerId, lunc: b.lunc }) });
              if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) {} if (r.status >= 500 || r.status === 429) problem = 'The relayer is busy (' + r.status + '), trying again.'; else problem = 'The relayer refused: ' + (m || r.status); }
            } catch (e) { problem = 'The relayer is not reachable at ' + relayerUrl() + '. Check its address (change relayer).'; }
            if (problem !== (b.problem || null) || b.terraTimeout !== all[id].terraTimeout) saveBuy(id, { problem: problem, terraTimeout: b.terraTimeout });
          }
        } else if (b.stage === 'refunding') {
          const n = await readLock(NET.tonApi, id, NET.tonCodeHash);
          if (n.status === 'refunded' || n.status === 'claimed') saveBuy(id, { stage: n.status === 'refunded' ? 'refunded' : 'done' });
        }
      } catch (e) { /* the next round tries again */ }
    }
  } finally { WATCHING_BUYS = false; drawBuys(); }
}
setInterval(watchBuys, 10000);
setTimeout(watchBuys, 2000);

/* ---------- relayer address (testnet tunnels change) ---------- */
function showRelayer(){ $('#gx-relay-url').textContent = relayerUrl() || 'not set'; }
showRelayer();
// on mainnet the relayer is pinned in gram-net.js: the secret goes to it
$('#gx-relay-edit').hidden = NET.name !== 'testnet';
$('#gx-relay-edit').addEventListener('click', function(){
  if (NET.name !== 'testnet') return;
  const v = prompt('Relayer address (https://...)', relayerUrl());
  if (v === null) return;
  try { localStorage.setItem('fw:gram:relayer', v.trim()); } catch (e) {}
  showRelayer(); quote();
});

/* ---------------- consent: show, PIN, sign, see it through ----------------
   One sheet carries an action from the question to its result, so nothing
   happens out of sight:
     1. what will be signed, line by line (the body scrolls; the PIN does not).
        A secret is never put on screen: where one is part of the message
        (a claim), the sheet shows it masked and says so.
     2. after the PIN, the steps of the action, each ticked as it completes
     3. the outcome in plain words and what happens next, until Done
   A failure stays on the step where it happened, with the reason.

   consent(title, lines, text, action, note, flow)
     action(mnemonic, step)  does the work; step(i) marks flow.steps[i] as the
                             one running. Without an action the text is signed
                             and { payload, pubkey, signature } is returned.
     flow  { steps: ['Locking 40 LUNC', ...],
             done: result => ({ title, text, actions: [{ label, run, quiet }] }) }
   Resolves with the action's result as soon as it is done (the result stays
   on screen until Done); rejects with Error('cancelled') on Cancel, or with
   the action's error marked .shown, already explained in the sheet. The seed
   used is the one decrypted from the PIN typed here, never the copy already
   unlocked in memory. */
let PEND = null;
const NOTE_MESSAGE = 'A signed message, not a transaction: it moves no funds. This is exactly what will be signed.';
const SHEET = () => $('#gx-sheet');

function sheetMode(mode){
  // ask: lines + PIN | run: lines + progress | done / fail: the outcome
  SHEET().dataset.mode = mode;
  $('#gx-pinbox').hidden = mode !== 'ask';
  $('#gx-prog').hidden = mode === 'ask';
  $('#gx-done').hidden = !(mode === 'done' || mode === 'fail');
  $('#gx-sheet-x').hidden = mode !== 'ask';          // later on, the outcome has its own button
}

function consent(title, lines, text, action, note, flow){
  if (!canSign()) { say('#gx-msg', 'This wallet has no key on this device (watch only).', true); return Promise.reject(new Error('watch only')); }
  return new Promise(function (resolve, reject) {
    PEND = { text: text, action: action, flow: flow || {}, resolve: resolve, reject: reject, tries: 0, busy: false, settled: false };
    $('#gx-sheet-title').textContent = title;
    $('#gx-sheet-note').textContent = note || NOTE_MESSAGE;
    $('#gx-lines').innerHTML = lines.map(l =>
      '<div class="p2p-line"><span>' + esc(l[0]) + '</span><b>' + esc(l[1]) + '</b></div>').join('');
    $('#gx-signed').textContent = text;
    $('#gx-prog').innerHTML = '';
    say('#gx-sheet-msg', '');
    $('#gx-pin').value = '';
    dots('gx-pinrow', 0);
    sheetMode('ask');
    $('#gx-sheet-body').scrollTop = 0;
    SHEET().hidden = false;
    focusPin('#gx-pin');
  });
}

// the step list: 'PIN accepted' first, then the action's own steps
function progDraw(names, at, failed){
  $('#gx-prog').innerHTML = ['PIN accepted'].concat(names).map(function (n, k) {
    const st = failed && k === at ? 'bad' : k < at ? 'ok' : k === at ? 'now' : '';
    return '<li class="' + st + '"><i aria-hidden="true"></i><span>' + esc(n) + '</span></li>';
  }).join('');
}

function showOutcome(ok, title, text, actions){
  $('#gx-done').classList.toggle('bad', !ok);
  $('#gx-done-title').textContent = title;
  $('#gx-done-text').textContent = text || '';
  const box = $('#gx-done-btns');
  box.innerHTML = '';
  (actions || []).forEach(function (a) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ' + (a.quiet ? 'quiet' : 'solid'); b.textContent = a.label;
    b.addEventListener('click', function () { closeSheet(); try { a.run(); } catch (e) {} });
    box.appendChild(b);
  });
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn ' + ((actions && actions.length) ? 'quiet' : 'solid');
  close.textContent = ok ? 'Done' : 'Close';
  close.addEventListener('click', closeSheet);
  box.appendChild(close);
  sheetMode(ok ? 'done' : 'fail');
  close.focus({ preventScroll: true });
}

function closeSheet(){
  SHEET().hidden = true;
  $('#gx-pin').value = '';
  PEND = null;
}
$('#gx-sheet-x').addEventListener('click', function(){
  if (!PEND) { closeSheet(); return; }
  if (PEND.busy) return;
  const p = PEND; closeSheet();
  if (!p.settled) p.reject(new Error('cancelled'));
});
$('#gx-pinbox').addEventListener('click', () => focusPin('#gx-pin'));
$('#gx-pin').addEventListener('input', async function(){
  if (!PEND || PEND.busy || SHEET().dataset.mode !== 'ask') return;
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
  const p = PEND;
  const names = p.flow.steps || (p.action ? ['Working'] : ['Signing']);
  let at = 1;
  const step = function (i) { at = Math.min(i + 1, names.length); if (PEND === p) progDraw(names, at); };
  say('#gx-sheet-msg', 'Keep this open until it finishes');
  sheetMode('run');
  progDraw(names, 1);
  try {
    const out = p.action ? await p.action(mnemonic, step) : await signArbitrary(mnemonic, addrOf(), p.text);
    mnemonic = null;
    p.settled = true; p.busy = false;
    if (PEND !== p) { p.resolve(out); return; }
    if (p.flow.done) {
      progDraw(names, names.length + 1);
      say('#gx-sheet-msg', '');
      const d = p.flow.done(out) || {};
      buzz('success');
      showOutcome(true, d.title || 'Done', d.text, d.actions);
      p.resolve(out);
    } else {
      // a plain signature: nothing to see through, the caller goes on
      closeSheet(); p.resolve(out);
    }
  } catch (e) {
    mnemonic = null;
    p.settled = true; p.busy = false;
    report_('gram', e);
    buzz('error');
    if (PEND === p) {
      progDraw(names, at, true);
      say('#gx-sheet-msg', '');
      // the red step above says where; this says why, and what to do
      showOutcome(false, 'Not completed', String(e && e.message || e).replace(/^./, c => c.toUpperCase()));
    }
    if (e && typeof e === 'object') e.shown = true;
    p.reject(e);
  }
});
