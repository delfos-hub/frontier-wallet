/* P2P market: the widget in a frame, and the wallet side of its bridge.

   The widget (delfos-hub/widgets, frontierBridge.ts) never holds a key. It
   asks this page for the address and for each contract call, over
   postMessage. This file is the half that holds the keys, so it carries the
   rules from the widget's EMBEDDING.md, all four of them:

   1. Origin. Only messages from WIDGET_ORIGIN and from our own iframe are
      read, and replies go to that exact origin, never '*'.
   2. Consent. Nothing is signed without the PIN typed for that one request.
      The seed already unlocked in memory is used to estimate the fee only;
      the signature uses a copy decrypted from the PIN just typed.
   3. Plain words. The confirmation is built here, from the contract, msg and
      funds that will actually be signed - never from text the widget sends.
   4. One contract. Calls go to P2P_CONTRACT, or are a CW20 send to it from a
      token the contract itself lists. Both addresses come from this file and
      from the chain, never from the widget.

   Wire protocol (frontierBridge.ts):
     in   { channel, type:'get-address', id }
     out  { channel, type:'address', id, address } | { ..., type:'error', id, message }
     in   { channel, type:'execute', id, contract, msg, funds }
     out  { channel, type:'execute-result', id, txHash } | { ..., type:'error', id, message }
     in   { channel, type:'execute-batch', id, msgs:[{ contract, msg, funds }, ...] }
     out  same replies as execute; all messages in one transaction (widgets#7)
*/
import { KNOWN_IBC, amt, fmt, smart } from './chain.js?v=fbe47268';
import { PIN_LEN, digitsOnly, dots, focusPin } from './onboarding.js?v=fbe47268';
import { $, buzz, go, libs, report } from './shell.js?v=fbe47268';
import { S } from './state.js?v=fbe47268';
import { decryptSeed } from './storage.js?v=fbe47268';
import { dryRunSwap, sendSwap } from './tx.js?v=fbe47268';

/* ---------------- configuration ----------------
   Both values are ours. The widget cannot change either of them. */

// Where the widget is served. Its own origin, never a path under ours: a
// frame on our origin could read the wallet's storage directly and would not
// need a bridge at all. Production will be https://p2p.delfoshub.com.
const WIDGET_ORIGIN = 'https://widgets-p2p-preview.repegclub.workers.dev';

// The otc-p2p contract on columbus-5. Empty until it is deployed; while it is
// empty the widget can show the book, and every execute is refused.
const P2P_CONTRACT = '';

const CHANNEL = 'delfos-p2p-wallet';

// The widget gives up on an execute after 120 s. Approval has to fit inside
// that together with the broadcast and the wait for a block, or a trade the
// user approved late would land after the widget already reported a failure -
// and a retry from there is a second fill. 45 s to approve, up to 60 s for
// the block, the rest is margin.
const APPROVE_MS = 45000;
const MAX_PIN_TRIES = 5;

const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';

/* ---------------- the frame ---------------- */
let FRAME = null;

function openMarket(){
  go('p2p');
  if (FRAME) return;
  const box = $('#p2p-frame');
  if (!box) return;
  const src = WIDGET_ORIGIN + '/embed.html?palette=frontier&typography=frontier' +
    '&walletBridgeOrigin=' + encodeURIComponent(location.origin);
  const f = document.createElement('iframe');
  f.src = src;
  f.title = 'P2P market';
  // No allow-top-navigation: the widget cannot take the wallet page away.
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allow', 'clipboard-write');
  box.innerHTML = '';
  box.appendChild(f);
  FRAME = f;
}

const act = $('#act-p2p');
if (act) act.addEventListener('click', openMarket);

/* ---------------- replies ---------------- */
function reply(msg){
  if (!FRAME || !FRAME.contentWindow) return;
  FRAME.contentWindow.postMessage(Object.assign({ channel: CHANNEL }, msg), WIDGET_ORIGIN);
}
const refuse = (id, message) => reply({ type: 'error', id: id, message: String(message) });

/* ---------------- reading the chain ----------------
   Token names and the whitelist come from the chain, not from the widget. */
const META = {};
const NATIVE_SYM = { uluna: 'LUNC', uusd: 'USTC' };

function assetKind(a){
  if (!a || typeof a !== 'object') return null;
  if (a.native && typeof a.native.denom === 'string' && a.native.denom) return { native: a.native.denom };
  if (a.cw20 && typeof a.cw20.address === 'string' && /^terra1[0-9a-z]{38,58}$/.test(a.cw20.address)) return { cw20: a.cw20.address };
  return null;
}

const short = s => s.length > 16 ? s.slice(0, 10) + '...' + s.slice(-5) : s;

async function metaOf(a){
  const k = assetKind(a);
  if (!k) throw new Error('unknown asset');
  if (k.native) {
    const d = k.native;
    // Full denoms only (KNOWN_IBC in chain.js): USDC.n, USDC.inj.
    if (KNOWN_IBC[d]) return { sym: KNOWN_IBC[d].sym, dec: KNOWN_IBC[d].dec, native: true };
    return { sym: NATIVE_SYM[d] || (d.indexOf('ibc/') === 0 ? 'IBC ' + d.slice(4, 10) : d), dec: 6, native: true };
  }
  if (META[k.cw20]) return META[k.cw20];
  const r = await smart(k.cw20, { token_info: {} }, 2);
  const t = r && r.data;
  if (!t || typeof t.decimals !== 'number') throw new Error('not a CW20 token: ' + k.cw20);
  // The address goes next to the symbol: any token may call itself USDC.
  const m = { sym: String(t.symbol || '?').slice(0, 12) + ' (' + short(k.cw20) + ')', dec: t.decimals, native: false };
  META[k.cw20] = m;
  return m;
}

let WL = null, WL_AT = 0;
async function whitelistedCw20(){
  if (WL && Date.now() - WL_AT < 5 * 60000) return WL;
  const r = await smart(P2P_CONTRACT, { assets: {} }, 2);
  const list = (r && r.data && r.data.assets) || [];
  WL = new Set(list.map(x => x.asset && x.asset.cw20 && x.asset.cw20.address).filter(Boolean));
  WL_AT = Date.now();
  return WL;
}

async function orderOf(id){
  const r = await smart(P2P_CONTRACT, { order: { order_id: id } }, 2);
  if (!r || !r.data) throw new Error('order ' + id + ' not found');
  return r.data;
}

const isUint = v => typeof v === 'string' && /^\d{1,39}$/.test(v);
const isId = v => Number.isSafeInteger(v) && v >= 0;
const onlyKey = o => (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 1) ? Object.keys(o)[0] : null;
const show = (raw, m) => fmt(amt(raw, m.dec)) + ' ' + m.sym;

function coinsOk(funds){
  return Array.isArray(funds) && funds.length <= 1 && funds.every(c =>
    c && typeof c.denom === 'string' && c.denom && isUint(c.amount) && c.amount !== '0');
}

/* ---------------- rule 4, and rule 3 from what passed it ----------------
   Returns { steps, lines } or throws with the reason the call is refused.
   `steps` is exactly what gets signed; `lines` describe exactly that. */
// Rule 4 alone: is this one message allowed at all, and what does it spend.
// Shared by a single execute and by every message of a batch.
async function gate(req){
  if (!P2P_CONTRACT) throw new Error('P2P contract is not deployed yet');
  const contract = req.contract, msg = req.msg, funds = req.funds || [];
  if (typeof contract !== 'string' || !msg || typeof msg !== 'object') throw new Error('malformed request');
  if (!coinsOk(funds)) throw new Error('funds must be at most one positive coin');

  let action, body, pay = null;   // pay: { asset, amount } that leaves the wallet

  if (contract === P2P_CONTRACT) {
    action = onlyKey(msg);
    body = action && msg[action];
    if (['create_order', 'fill_order', 'cancel_order', 'reclaim_expired'].indexOf(action) < 0) {
      throw new Error('this call is not allowed from the P2P widget: ' + (action || 'unknown'));
    }
    if (action === 'create_order' || action === 'fill_order') {
      if (funds.length !== 1) throw new Error(action + ' needs exactly one coin attached');
      pay = { asset: { native: { denom: funds[0].denom } }, amount: funds[0].amount };
    } else if (funds.length) {
      throw new Error(action + ' must not carry funds');
    }
  } else {
    // A CW20 leg: the call goes to the token, and its Send hook to the contract.
    if (onlyKey(msg) !== 'send') throw new Error('only a CW20 send to the P2P contract is allowed');
    const s = msg.send;
    if (!s || s.contract !== P2P_CONTRACT) throw new Error('a CW20 send must go to the P2P contract');
    if (!isUint(s.amount) || s.amount === '0') throw new Error('bad CW20 amount');
    if (funds.length) throw new Error('a CW20 send must not carry native funds');
    const wl = await whitelistedCw20();
    if (!wl.has(contract)) throw new Error('this token is not listed by the P2P contract');
    let inner;
    try { inner = JSON.parse(atob(String(s.msg || ''))); } catch (e) { throw new Error('unreadable CW20 hook message'); }
    action = onlyKey(inner);
    body = action && inner[action];
    if (action !== 'create_order' && action !== 'fill_order') throw new Error('this CW20 hook is not allowed: ' + (action || 'unknown'));
    pay = { asset: { cw20: { address: contract } }, amount: s.amount };
  }
  return { contract: contract, msg: msg, funds: funds, action: action, body: body, pay: pay };
}

// What the contract does with one fill: payment buys proportionally, capped at
// what is left, the fee comes out of what the buyer receives, the rest is
// refunded. Same ceil/floor as fill_order.
function fillMath(o, payAmount){
  const P = BigInt(payAmount), OT = BigInt(o.offer_total), AT = BigInt(o.ask_total), R = BigInt(o.offer_remaining);
  let gross = AT > 0n ? P * OT / AT : 0n;
  let used = P;
  if (gross > R) { gross = R; used = (R * AT + OT - 1n) / OT; }
  const fee = gross * BigInt(o.fee_bps || 0) / 10000n;
  return { sent: P, used: used, gross: gross, net: gross - fee };
}

const sameAsset = (a, b) => !!assetKind(a) && JSON.stringify(assetKind(a)) === JSON.stringify(assetKind(b));

async function understand(req){
  const g = await gate(req);
  const contract = g.contract, msg = g.msg, funds = g.funds, action = g.action, body = g.body, pay = g.pay;

  const lines = [];
  if (action === 'create_order') {
    if (!body || !assetKind(body.ask) || !isUint(body.ask_total) || body.ask_total === '0') throw new Error('bad order terms');
    if (body.ttl != null && !isId(body.ttl)) throw new Error('bad ttl');
    const [om, am] = await Promise.all([metaOf(pay.asset), metaOf(body.ask)]);
    lines.push(['Action', 'Sell ' + show(pay.amount, om)]);
    lines.push(['For', show(body.ask_total, am)]);
    lines.push(['Price', fmt(amt(body.ask_total, am.dec) / amt(pay.amount, om.dec)) + ' ' + am.sym + ' per ' + om.sym]);
    lines.push(['Expires', body.ttl ? 'in ' + Math.max(1, Math.round(body.ttl / 86400)) + ' days' : 'contract default (30 days)']);
    lines.push(['Locked', 'Your ' + om.sym + ' stay in the contract until sold, cancelled or expired']);
  } else if (action === 'fill_order') {
    if (!body || !isId(body.order_id)) throw new Error('bad order id');
    if (body.min_offer_out != null && !isUint(body.min_offer_out)) throw new Error('bad minimum');
    const o = await orderOf(body.order_id);
    if (!sameAsset(o.ask, pay.asset)) {
      throw new Error('order ' + body.order_id + ' asks for a different payment asset');
    }
    const [om, am] = await Promise.all([metaOf(o.offer), metaOf(o.ask)]);
    const f = fillMath(o, pay.amount);
    const P = f.sent, used = f.used, net = f.net;
    lines.push(['Action', 'Buy from order #' + body.order_id]);
    lines.push(['You pay', show(used.toString(), am) + (used < P ? ' (the rest of ' + show(pay.amount, am) + ' comes back)' : '')]);
    lines.push(['You get', 'about ' + show(net.toString(), om) + (om.native ? ', before the chain burn tax' : '')]);
    if (body.min_offer_out) lines.push(['Minimum', show(body.min_offer_out, om) + ' or the trade is cancelled']);
    lines.push(['Price', fmt(amt(o.ask_total, am.dec) / amt(o.offer_total, om.dec)) + ' ' + am.sym + ' per ' + om.sym]);
    lines.push(['Seller', short(String(o.seller || ''))]);
  } else if (action === 'cancel_order') {
    if (!body || !isId(body.order_id)) throw new Error('bad order id');
    const o = await orderOf(body.order_id);
    if (o.seller !== addrOf()) throw new Error('order ' + body.order_id + ' is not yours');
    const om = await metaOf(o.offer);
    lines.push(['Action', 'Cancel order #' + body.order_id]);
    lines.push(['Returned to you', show(o.offer_remaining, om) + (om.native ? ', before the chain burn tax' : '')]);
  } else {
    if (!body || !isId(body.order_id)) throw new Error('bad order id');
    const o = await orderOf(body.order_id);
    const om = await metaOf(o.offer);
    lines.push(['Action', 'Return expired order #' + body.order_id]);
    lines.push(['Goes to', o.seller === addrOf() ? 'you' : short(String(o.seller || '')) + ' (its seller)']);
    lines.push(['Amount', show(o.offer_remaining, om)]);
  }
  lines.push(['Contract', short(P2P_CONTRACT)]);
  return { steps: [{ contract: contract, msg: msg, funds: funds }], lines: lines };
}

/* ---------------- a market sweep: several fills, one signature ----------------
   Issue delfos-hub/widgets#7. Only fill_order, 2 to 10 of them, all on one
   pair, each with its own min_offer_out, so the contract itself enforces the
   worst price of every leg. One transaction: all of it lands or none of it.
   The sheet shows the sweep as one trade, built from the orders on chain. */
const BATCH_MAX = 10;

async function understandBatch(msgs){
  if (!Array.isArray(msgs) || msgs.length < 2 || msgs.length > BATCH_MAX) {
    throw new Error('a batch holds 2 to ' + BATCH_MAX + ' fills');
  }
  const gs = [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') throw new Error('malformed request');
    gs.push(await gate({ contract: m.contract, msg: m.msg, funds: m.funds }));
  }
  const ids = new Set();
  for (const g of gs) {
    if (g.action !== 'fill_order') throw new Error('a batch may only fill orders, not ' + g.action);
    if (!g.body || !isId(g.body.order_id)) throw new Error('bad order id');
    if (ids.has(g.body.order_id)) throw new Error('order ' + g.body.order_id + ' appears twice');
    ids.add(g.body.order_id);
    if (!isUint(g.body.min_offer_out) || g.body.min_offer_out === '0') {
      throw new Error('every fill in a batch needs min_offer_out');
    }
  }
  const orders = await Promise.all(gs.map(g => orderOf(g.body.order_id)));
  const o0 = orders[0];
  orders.forEach(function (o, i) {
    if (!sameAsset(o.offer, o0.offer) || !sameAsset(o.ask, o0.ask)) throw new Error('all fills in a batch must be on one pair');
    if (!sameAsset(o.ask, gs[i].pay.asset)) throw new Error('order ' + gs[i].body.order_id + ' asks for a different payment asset');
  });
  const [om, am] = await Promise.all([metaOf(o0.offer), metaOf(o0.ask)]);

  let sent = 0n, used = 0n, net = 0n, floor = 0n, worst = 0;
  orders.forEach(function (o, i) {
    const f = fillMath(o, gs[i].pay.amount);
    sent += f.sent; used += f.used; net += f.net;
    floor += BigInt(gs[i].body.min_offer_out);
    const px = amt(o.ask_total, am.dec) / amt(o.offer_total, om.dec);
    if (px > worst) worst = px;
  });
  const avg = net > 0n ? amt(used.toString(), am.dec) / amt(net.toString(), om.dec) : 0;
  const list = orders.map(o => '#' + o.id).join(', ');

  const lines = [];
  lines.push(['Action', 'Buy from ' + orders.length + ' orders (' + list + ')']);
  lines.push(['You pay', show(used.toString(), am) + (used < sent ? ' (the rest of ' + show(sent.toString(), am) + ' comes back)' : '')]);
  lines.push(['You get', 'about ' + show(net.toString(), om) + (om.native ? ', before the chain burn tax' : '')]);
  lines.push(['Minimum', show(floor.toString(), om) + ' in total, or the whole sweep is cancelled']);
  lines.push(['Average price', fmt(avg) + ' ' + am.sym + ' per ' + om.sym + ', fee included']);
  lines.push(['Worst price', fmt(worst) + ' ' + am.sym + ' per ' + om.sym]);
  lines.push(['Contract', short(P2P_CONTRACT)]);
  return { steps: gs.map(g => ({ contract: g.contract, msg: g.msg, funds: g.funds })), lines: lines };
}

/* ---------------- rule 2: the confirmation sheet ---------------- */
let PENDING = null;   // { id, steps, deadline, timer, tries, busy }

function sheet(on){
  const s = $('#p2p-sheet');
  if (s) s.hidden = !on;
}

function paintLines(lines){
  const box = $('#p2p-lines');
  box.innerHTML = '';
  lines.forEach(function (l) {
    const row = document.createElement('div');
    row.className = 'p2p-line';
    const k = document.createElement('span'); k.textContent = l[0];
    const v = document.createElement('b'); v.textContent = l[1];
    row.appendChild(k); row.appendChild(v);
    box.appendChild(row);
  });
}

function say(text, bad){
  const m = $('#p2p-msg');
  m.textContent = text || '';
  m.style.color = bad ? 'var(--red)' : 'var(--muted)';
}

function finish(result){
  if (!PENDING) return;
  clearInterval(PENDING.timer);
  const id = PENDING.id;
  PENDING = null;
  $('#p2p-pin').value = '';
  dots('p2p-pinrow', 0);
  sheet(false);
  if (result.txHash) reply({ type: 'execute-result', id: id, txHash: result.txHash });
  else refuse(id, result.error || 'rejected');
}

function tick(){
  if (!PENDING || PENDING.busy) return;
  const left = Math.ceil((PENDING.deadline - Date.now()) / 1000);
  if (left <= 0) { finish({ error: 'not approved in time' }); return; }
  $('#p2p-left').textContent = 'expires in ' + left + ' s';
}

async function ask(id, build){
  PENDING = { id: id, steps: null, deadline: Date.now() + APPROVE_MS, timer: null, tries: 0, busy: false };
  PENDING.timer = setInterval(tick, 1000);
  $('#p2p-lines').innerHTML = '<div class="empty"><span class="spin"></span>Reading the order</div>';
  $('#p2p-fee').textContent = '';
  $('#p2p-pinbox').hidden = true;
  say('');
  tick();
  sheet(true);
  buzz('warning');

  let plan;
  try { plan = await build(); }
  catch (e) { finish({ error: e && e.message || e }); return; }
  if (!PENDING || PENDING.id !== id) return;
  PENDING.steps = plan.steps;
  paintLines(plan.lines);

  // The fee, and the contract's own verdict, before anyone types a PIN. The
  // simulation needs the public key only; nothing is signed here.
  $('#p2p-fee').textContent = 'Checking with the chain...';
  try {
    const est = await dryRunSwap(addrOf(), plan.steps, S.MNEMONIC);
    if (!PENDING || PENDING.id !== id) return;
    $('#p2p-fee').textContent = 'Network fee about ' + fmt(est.gasFee / 1e6) + ' LUNC';
  } catch (e) {
    if (!PENDING || PENDING.id !== id) return;
    $('#p2p-fee').textContent = '';
    say('The chain would refuse this: ' + (e && e.message || e), true);
    PENDING.refusal = String(e && e.message || e);
    return;   // only Reject is possible now
  }
  $('#p2p-pinbox').hidden = false;
  dots('p2p-pinrow', 0);
  focusPin('#p2p-pin');
}

async function onPin(){
  if (!PENDING || PENDING.busy || !PENDING.steps) return;
  const v = digitsOnly($('#p2p-pin'));
  dots('p2p-pinrow', v.length);
  if (v.length < PIN_LEN) return;
  PENDING.busy = true;
  say('Checking');
  let mnemonic;
  try {
    await libs();
    mnemonic = await decryptSeed(S.SAVED.blob, v);
  } catch (e) {
    PENDING.busy = false;
    PENDING.tries++;
    buzz('error');
    dots('p2p-pinrow', PIN_LEN, true);
    setTimeout(() => { $('#p2p-pin').value = ''; dots('p2p-pinrow', 0); }, 550);
    if (PENDING.tries >= MAX_PIN_TRIES) { finish({ error: 'wrong PIN too many times' }); return; }
    say('Wrong PIN', true);
    return;
  }
  // The PIN is accepted: from here on the deadline no longer applies, only the
  // chain's own time.
  clearInterval(PENDING.timer);
  $('#p2p-left').textContent = '';
  $('#p2p-pinbox').hidden = true;
  say('Signing and sending');
  try {
    const res = await sendSwap(addrOf(), PENDING.steps, mnemonic);
    mnemonic = null;
    say('Waiting for a block');
    const done = await res.wait();
    if (!done) { finish({ error: 'sent but not confirmed yet, check Activity: ' + res.hash }); return; }
    buzz('success');
    finish({ txHash: res.hash });
  } catch (e) {
    mnemonic = null;
    report('p2p', e);
    finish({ error: e && e.message || e });
  }
}

$('#p2p-pin').addEventListener('input', onPin);
$('#p2p-pinbox').addEventListener('click', () => focusPin('#p2p-pin'));
$('#p2p-reject').addEventListener('click', function () {
  if (!PENDING || PENDING.busy) return;
  finish({ error: PENDING.refusal ? 'refused by the chain: ' + PENDING.refusal : 'rejected by the user' });
});

/* ---------------- rule 1: who may talk to us ---------------- */
window.addEventListener('message', function (ev) {
  if (!FRAME || ev.source !== FRAME.contentWindow || ev.origin !== WIDGET_ORIGIN) return;
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.channel !== CHANNEL) return;
  if (typeof d.id !== 'string' || !d.id || d.id.length > 100) return;

  if (d.type === 'get-address') {
    const a = addrOf();
    if (a && S.MNEMONIC) reply({ type: 'address', id: d.id, address: a });
    else refuse(d.id, 'wallet is locked');
    return;
  }
  if (d.type === 'execute') {
    if (!S.MNEMONIC || !S.SAVED || !S.SAVED.blob) { refuse(d.id, 'wallet is locked'); return; }
    if (!$('#st-p2p').classList.contains('on')) { refuse(d.id, 'the P2P screen is not open'); return; }
    if (PENDING) { refuse(d.id, 'another request is waiting for approval'); return; }
    ask(d.id, () => understand({ contract: d.contract, msg: d.msg, funds: d.funds }));
    return;
  }
  if (d.type === 'execute-batch') {
    if (!S.MNEMONIC || !S.SAVED || !S.SAVED.blob) { refuse(d.id, 'wallet is locked'); return; }
    if (!$('#st-p2p').classList.contains('on')) { refuse(d.id, 'the P2P screen is not open'); return; }
    if (PENDING) { refuse(d.id, 'another request is waiting for approval'); return; }
    ask(d.id, () => understandBatch(d.msgs));
    return;
  }
});

dots('p2p-pinrow', 0);

export { openMarket, understand, understandBatch };
