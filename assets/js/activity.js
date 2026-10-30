// activity.js - история адреса с того же LCD, которым пользуется txCandidates.
//
// Индексатор здесь не нужен: LCD принимает ?query= по событиям. Но событие
// решает, что попадёт в выборку. message.sender находит всё, что адрес
// подписывал - переводы, свапы, стейкинг. Полученное он не видит вовсе, его
// приходится спрашивать отдельно по получателю, а потом склеивать по хешу.
import { LCD, amt, clean, esc, fmt, getJSON, iconHTML, paintIcons, usd } from './chain.js?v=ccf6aabe';
import { DEC, knownAsset as marketAsset } from './market.js?v=ccf6aabe';
import { $, go } from './shell.js?v=ccf6aabe';
import { fiatOf, heldTokens } from './tokens.js?v=ccf6aabe';
import { S } from './state.js?v=ccf6aabe';

// terra.money's classic finder is gone; the community one is what answers
const FINDER = 'https://finder.terraclassic.community/columbus-5/tx/';
let LOADED = '';

const short = s => !s ? '' : s.slice(0, 9) + '\u2026' + s.slice(-4);

/* Two clocks, and they disagreed with each other.
   Rounding seconds into hours and then into days put "24h ago" directly above
   "1d ago" for two things that happened minutes apart. Inside a day the time of
   day is the useful fact; beyond it, the day is, and the day now has a heading
   of its own - so the row only has to say where in the day it sits. */
function clock(ts){
  const t = new Date(ts);
  const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  // the wallet speaks English; the phone's own locale (a Russian month name
  // under an English heading) is not asked
  return t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// midnight to midnight, in the reader's own timezone rather than the chain's
const dayKey = ts => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
};

function dayName(ts){
  const d = new Date(ts), now = new Date();
  const same = dayKey(ts) === dayKey(now);
  const y = new Date(now.getTime() - 86400000);
  if (same) return 'Today';
  if (dayKey(ts) === dayKey(y)) return 'Yesterday';
  const within = (now - d) / 86400000 < 300;
  return d.toLocaleDateString('en-GB', within
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

// Only native coins can be read straight off the message. A cw20 amount is a
// number inside a contract call with no denom attached, so it is left alone
// rather than guessed at.
function coins(list){
  if (!Array.isArray(list) || !list.length) return '';
  const c = list[0];
  if (c.denom === 'uluna') return fmt(amt(c.amount, 6)) + ' LUNC';
  if (c.denom === 'uusd') return fmt(amt(c.amount, 6)) + ' USTC';
  return fmt(amt(c.amount, 6)) + ' ' + c.denom.replace(/^u/, '').toUpperCase();
}

/* What the person did, taken from the message they signed.

   The old reading walked every wasm event and kept the last `action` attribute
   it found - which is whatever the final contract in the chain of calls chose
   to log about itself. That is how "receive cw20 fee" and "record entry" ended
   up as the names of somebody's swaps: true statements about a contract's
   internals, and not descriptions of anything the owner did.

   The execute message names the intent directly: {"send":...} was a send,
   {"swap":...} was a swap. Where the chain of calls matters - a cw20 send whose
   hook is a swap - the hook is opened and it says so. */
/* What a swap actually moved.

   A row that says "Swapped" and nothing else is half a sentence: the amounts
   are in the transaction, in the wasm events the pools emit, and reading them
   is the difference between a list you can scan and a list you have to open.

   For a trade that crossed two pools the first offer and the last return are
   the two ends of what the owner did; everything between them is the middle
   token appearing and disappearing inside the same transaction. */
/* A token the market map does not name is still one the wallet may hold, and
   the wallet knows what it is called: TERRA came out as "TERRA1EX" here while
   the home list a tab away said TERRA. */
function knownAsset(k){
  const m = marketAsset(k);
  if (m) return m;
  const r = heldTokens().filter(x => (x.contract ? 'cw20:' + x.contract : 'native:' + x.denom) === k)[0];
  return r ? { sym: r.sym, dec: r.dec === undefined ? 6 : r.dec } : null;
}

const keyFor = a => !a ? '' :
  (String(a).slice(0, 6) === 'terra1' ? 'cw20:' + a : 'native:' + a);

function nameOf(a){
  const k = keyFor(a);
  const known = k && knownAsset(k);
  if (known) return { sym: known.sym, dec: known.dec === undefined ? 6 : known.dec };
  if (a === 'uluna') return { sym: 'LUNC', dec: 6 };
  if (a === 'uusd') return { sym: 'USTC', dec: 6 };
  const d = DEC[k];
  return { sym: String(a || '').replace(/^u/, '').slice(0, 8).toUpperCase(),
           dec: d === undefined ? 6 : d };
}

/* One wasm event, several contracts.

   The chain concatenates every contract's attributes into a single event of
   type "wasm", in the order they ran, separated only by a fresh
   _contract_address. Folding that into one object and reading `action` off it
   gives the FIRST action in the chain - for a swap paid in a CW20 that is the
   token's own `send`, never the pool's `swap`. The condition below could not
   match, which is why every swap row came back empty.

   Split at the boundaries and each contract speaks for itself. */
function wasmCalls(t){
  const out = [];
  for (const lg of (t.logs || [])) {
    for (const e of (lg.events || [])) {
      if (e.type !== 'wasm') continue;
      let cur = null;
      for (const at of (e.attributes || [])) {
        if (at.key === '_contract_address') { cur = { at: at.value }; out.push(cur); continue; }
        if (!cur) { cur = {}; out.push(cur); }
        if (!(at.key in cur)) cur[at.key] = at.value;
      }
    }
  }
  return out;
}

function swapMoves(t){
  let gave = null, got = null;
  for (const a of wasmCalls(t)) {
    if (a.action !== 'swap' || !a.return_amount) continue;
    // the first offer and the last return: the two ends of the trade
    if (!gave && a.offer_asset && a.offer_amount) gave = { asset: a.offer_asset, raw: a.offer_amount };
    if (a.ask_asset) got = { asset: a.ask_asset, raw: a.return_amount };
  }
  if (!got) return null;
  const g = nameOf(got.asset);
  const out = { got: fmt(amt(got.raw, g.dec)) + ' ' + g.sym };
  if (gave) {
    const p = nameOf(gave.asset);
    out.gave = fmt(amt(gave.raw, p.dec)) + ' ' + p.sym;
    out.pair = p.sym + ' \u2192 ' + g.sym;
  }
  return out;
}

const VERB = {
  swap: 'Swapped', send: 'Sent', transfer: 'Sent', burn: 'Burned', mint: 'Minted',
  provide_liquidity: 'Added liquidity', withdraw_liquidity: 'Removed liquidity',
  increase_allowance: 'Approved spending', buy: 'Bought', sell: 'Sold',
  claim: 'Claimed', claim_rewards: 'Claimed rewards', withdraw_rewards: 'Claimed rewards',
  claim_reward: 'Claimed rewards', harvest: 'Claimed rewards',
  stake: 'Staked', unstake: 'Unstaked', unbond: 'Unstaked', bond: 'Staked',
  deposit: 'Deposited', withdraw: 'Withdrew', vote: 'Voted', enter: 'Entered',
  register: 'Registered', mint_nft: 'Minted an NFT', approve: 'Approved'
};

/* Which face a contract call wears.
   Only swaps had one, so staking, unstaking and claiming all came out wearing
   the brackets that mean "some code ran" - true, and useless next to five other
   rows saying the same. */
const FACE = {
  swap: 'swap', execute_swap_operations: 'swap', swap_operations: 'swap',
  stake: 'stake', bond: 'stake', unstake: 'stake', unbond: 'stake',
  provide_liquidity: 'stake', withdraw_liquidity: 'stake', deposit: 'stake',
  claim: 'gift', claim_rewards: 'gift', claim_reward: 'gift',
  withdraw_rewards: 'gift', harvest: 'gift', mint: 'gift',
  send: 'out', transfer: 'out', burn: 'out', withdraw: 'in'
};

// "record entry" reads as a leak; "Record entry" reads as a decision
const sentence = s => !s ? '' : s.charAt(0).toUpperCase() + s.slice(1);

function hookOf(msg){
  // a cw20 send carries the real intent base64-encoded inside it
  try {
    const inner = msg && msg.send && msg.send.msg;
    if (!inner) return null;
    return Object.keys(JSON.parse(atob(inner)))[0] || null;
  } catch (e) { return null; }
}

function intentOf(m){
  const msg = m && m.msg;
  if (!msg || typeof msg !== 'object') return '';
  const top = Object.keys(msg)[0] || '';
  return (top === 'send' && hookOf(msg)) || top;
}

const ICON = {
  // an arrow falling into a bowl, and one rising out of it
  in:   '<path d="M12 3.5v9.5"/><path d="m7.8 8.8 4.2 4.2 4.2-4.2"/>' +
        '<path d="M4.5 15.5a7.5 7.5 0 0 0 15 0"/>',
  out:  '<path d="M12 13V3.5"/><path d="m7.8 7.7 4.2-4.2 4.2 4.2"/>' +
        '<path d="M4.5 15.5a7.5 7.5 0 0 0 15 0"/>',
  // two lanes passing each other
  swap: '<path d="M5 9h11"/><path d="m12.8 5.4 3.6 3.6-3.6 3.6"/>' +
        '<path d="M19 15H8"/><path d="m11.2 11.4-3.6 3.6 3.6 3.6"/>',
  stake:'<path d="m12 3 8.5 4.7-8.5 4.7-8.5-4.7Z"/><path d="m3.5 12 8.5 4.7 8.5-4.7"/>' +
        '<path d="m3.5 16.4 8.5 4.7 8.5-4.7"/>',
  gift: '<circle cx="9.2" cy="12" r="4.6"/><path d="M14 7.8a4.6 4.6 0 0 1 0 8.4"/>' +
        '<path d="M9.2 9.9v4.2"/>',
  // brackets: something ran, and it was code
  code: '<path d="M9.2 7.5 5.4 12l3.8 4.5"/><path d="M14.8 7.5 18.6 12l-3.8 4.5"/>' +
        '<path d="M12.8 6.5 11.2 17.5"/>'
};

// what the transaction was, and which face it wears
function describe(t, me){
  const msgs = ((t.tx || {}).body || {}).messages || [];
  const m = msgs[0] || {};
  const type = String(m['@type'] || '');
  const extra = msgs.length > 1 ? ' +' + (msgs.length - 1) : '';

  if (type.indexOf('MsgSend') >= 0) {
    const mine = m.from_address === me;
    return { kind: mine ? 'out' : 'in',
             title: (mine ? 'Sent' : 'Received') + extra,
             sub: mine ? 'to ' + short(m.to_address) : 'from ' + short(m.from_address),
             value: (mine ? '-' : '+') + coins(m.amount) };
  }
  if (type.indexOf('MsgExecuteContract') >= 0) {
    const intent = intentOf(m);
    /* A token transfer is a send like any other, and was drawn as one only by
       name: no amount, no ticker, and the token's own contract where the
       recipient should be. The message has all three. */
    const tr = m.msg && m.msg.transfer;
    if (intent === 'transfer' && tr && tr.amount) {
      const tk = nameOf(m.contract);
      const mine = m.sender === me;
      return { kind: mine ? 'out' : 'in',
               title: (mine ? 'Sent' : 'Received') + extra,
               sub: mine ? 'to ' + short(tr.recipient) : 'from ' + short(m.sender),
               value: (mine ? '-' : '+') + fmt(amt(tr.amount, tk.dec)) + ' ' + tk.sym };
    }
    const swap = intent === 'swap' || intent === 'execute_swap_operations' ||
                 intent === 'swap_operations';
    const verb = VERB[intent];
    // a truncated contract address tells nobody anything; the pair does
    const mv = swap ? swapMoves(t) : null;
    // A cw20 leaves the wallet inside the send that carries it, so the amount
    // is in the message even when no event mentions it - which is every
    // staking row, all of which had an empty column.
    let paid = '';
    if (!mv && m.msg && m.msg.send && m.msg.send.amount) {
      const p = nameOf(m.contract);
      paid = '-' + fmt(amt(m.msg.send.amount, p.dec)) + ' ' + p.sym;
    }
    return { kind: FACE[intent] || (swap ? 'swap' : 'code'),
             // an unknown action is named as it came rather than dressed up
             title: (verb || sentence((intent || '').replace(/_/g, ' ')) ||
                     'Contract call') + extra,
             sub: (mv && mv.pair) || short(m.contract || ''),
             value: mv ? '+' + mv.got : (paid || coins(m.funds)),
             gain: !!mv };
  }
  if (type.indexOf('MsgDelegate') >= 0)
    return { kind: 'stake', title: 'Delegated' + extra, sub: short(m.validator_address),
             value: coins([m.amount]) };
  if (type.indexOf('MsgUndelegate') >= 0)
    return { kind: 'stake', title: 'Undelegated' + extra, sub: short(m.validator_address),
             value: coins([m.amount]) };
  if (type.indexOf('WithdrawDelegatorReward') >= 0)
    return { kind: 'gift', title: 'Claimed rewards' + extra, sub: short(m.validator_address), value: '' };

  return { kind: 'code', title: type.split('.').pop() || 'Transaction', sub: '', value: '' };
}

/* Everything the chain said about one transaction.

   It was a link out of the app: tap a row, leave for a block explorer, come
   back. Almost everything worth knowing is already here - the response carries
   the messages, the events, the fee and the log - so the common questions get
   answered without going anywhere.

   The explorer stays, for the questions this does not answer. */
const TXS = {};
// cosmos fee_collector module account: sha256("fee_collector")[:20], checked
const FEE_COLLECTOR = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa';

function transfersIn(t, me){
  const out = [];
  for (const lg of (t.logs || [])) {
    for (const e of (lg.events || [])) {
      if (e.type !== 'transfer') continue;
      let to = '', from = '', what = '';
      for (const a of (e.attributes || [])) {
        if (a.key === 'recipient') to = a.value;
        if (a.key === 'sender') from = a.value;
        if (a.key === 'amount') what = a.value;
      }
      if (!what || (to !== me && from !== me)) continue;
      // the fee is paid as a transfer to the fee collector; it has its own
      // line below and is not something the transaction sent anywhere
      if (to === FEE_COLLECTOR) continue;
      // several coins arrive comma separated, and each is digits then a denom
      for (const part of what.split(',')) {
        const mm = /^(\d+)(.+)$/.exec(part.trim());
        if (!mm) continue;
        out.push({ mine: to === me, other: to === me ? from : to,
                   text: coins([{ amount: mm[1], denom: mm[2] }]) });
      }
    }
  }
  return out;
}

// Token moves are not transfer events; each token contract logs its own
// from / to / amount, and that is where a CW20 send shows up.
function tokenMoves(t, me){
  const out = [];
  for (const c of wasmCalls(t)) {
    if (!c.amount || !c.at || (c.action !== 'transfer' && c.action !== 'send')) continue;
    if (c.to !== me && c.from !== me) continue;
    const tk = nameOf(c.at);
    out.push({ mine: c.to === me, other: c.to === me ? c.from : c.to,
               text: fmt(amt(c.amount, tk.dec)) + ' ' + tk.sym });
  }
  return out;
}

function memoOf(t){
  const m = ((t.tx || {}).body || {}).memo || '';
  return m.trim();
}

function feeOf(t){
  const f = (((t.tx || {}).auth_info || {}).fee || {}).amount || [];
  return f.length ? coins(f) : '';
}

// every value here is text from the chain - a memo, a symbol, a log - and is
// escaped; a memo is whatever the sender typed, markup included
function row(k, v, cls){
  return '<div class="tx-line' + (cls ? ' ' + cls : '') + '">' +
         '<span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
}
const kindClass = k => String(k || '').replace(/[^a-z]/g, '');

function openTx(hash){
  const t = TXS[hash];
  if (!t) return;
  const me = S.ADDR || (S.SAVED && S.SAVED.addr) || '';
  const d = describe(t, me);
  const failed = Number(t.code) > 0;
  const moves = transfersIn(t, me).concat(tokenMoves(t, me));
  const l = look(t, me);
  const memo = memoOf(t);

  let html =
    '<div class="tx-head">' + face(l, failed) +
      '<div><b>' + esc(l.title) + '</b><i>' + new Date(t.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</i></div></div>';

  if (failed) {
    html += '<div class="tx-fail">The chain rejected this one. Nothing moved.' +
            (t.raw_log ? '<p>' + esc(String(t.raw_log).slice(0, 200)) + '</p>' : '') + '</div>';
  }

  if (l.flows.length && !failed) {
    html += '<div class="tx-flows">' + l.flows.slice(0, 8).map(function (f) {
      const w = worthOf(f);
      return '<div class="tx-flow ' + (f.raw > 0 ? 'in' : 'out') + '">' + iconHTML(rowOfKey(f.key)) +
        '<span>' + (f.raw > 0 ? 'Received' : 'Paid') + '</span><b>' + esc(amountText(f)) + '<i>' + (w ? usd(Math.abs(w)) : '') + '</i></b></div>';
    }).join('') + '</div>';
  }
  if (l.place) html += row('Where', l.place);
  if (moves.length && !l.flows.length) {
    html += '<div class="tx-moves">' + moves.slice(0, 8).map(function (mv) {
      return row(mv.mine ? 'Received' : 'Sent',
                 (mv.mine ? '+' : '-') + mv.text, mv.mine ? 'in' : 'out') +
             '<p class="tx-who">' + (mv.mine ? 'from ' : 'to ') + esc(short(mv.other)) + '</p>';
    }).join('') + '</div>';
  }

  html += row('Status', failed ? 'Failed' : 'Confirmed', failed ? 'out' : 'in');
  html += row('Block', String(t.height || ''));
  if (feeOf(t)) html += row('Network fee', feeOf(t));
  if (t.gas_used) html += row('Gas', t.gas_used + ' of ' + (t.gas_wanted || '?'));
  if (memo) html += row('Memo', memo);
  html += '<div class="tx-hash" id="tx-hash">' + esc(hash) + '</div>';

  $('#tx-body').innerHTML = html;
  paintIcons($('#tx-body'));
  $('#tx-sheet').hidden = false;
  CURRENT = hash;
}

let CURRENT = '';

/* ================= how a transaction looks =================
   What the list used to show was the transaction's own terms: the contract
   it called, the name of the function, a "+2" for extra messages. What a
   person wants to see is what happened to their money, where, and in which
   token. Everything below reads that from the transaction itself:

     flows    every coin and token that came in or went out of this address,
              netted per token (the network fee is not a flow; it has its
              own line in the details)
     place    which product the contract belongs to - Garuda farm, Terraport
              staking - from the same code ids the DeFi screen uses
     group    which filter it falls under: transfers, swaps, DeFi, staking

   describe() above still names the action; this only dresses it. */
const tokKeyOf = r => r.contract ? 'cw20:' + r.contract : 'native:' + r.denom;
function permGet(k){ try { const v = localStorage.getItem('fw:perm:' + k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
function permSet(k, v){ try { localStorage.setItem('fw:perm:' + k, JSON.stringify(v)); } catch (e) {} }

function flows(t, me){
  const net = {};
  const add = (k, n) => { if (k && n) net[k] = (net[k] || 0) + n; };
  for (const lg of (t.logs || [])) {
    for (const e of (lg.events || [])) {
      if (e.type !== 'transfer') continue;
      let to = '', from = '', what = '';
      for (const a of (e.attributes || [])) {
        if (a.key === 'recipient') to = a.value;
        if (a.key === 'sender') from = a.value;
        if (a.key === 'amount') what = a.value;
      }
      if (!what || to === FEE_COLLECTOR) continue;
      for (const part of what.split(',')) {
        const mm = /^(\d+)(.+)$/.exec(part.trim());
        if (!mm) continue;
        if (to === me) add('native:' + mm[2], Number(mm[1]));
        if (from === me) add('native:' + mm[2], -Number(mm[1]));
      }
    }
  }
  for (const c of wasmCalls(t)) {
    if (!c.at || !c.amount || !/^\d+$/.test(c.amount)) continue;
    const k = 'cw20:' + c.at, n = Number(c.amount);
    if (c.action === 'transfer' || c.action === 'send' || c.action === 'transfer_from' || c.action === 'send_from') {
      if (c.to === me) add(k, n);
      if ((c.from || c.owner) === me) add(k, -n);
    } else if (c.action === 'mint' && c.to === me) add(k, n);
    else if (c.action === 'burn' && c.from === me) add(k, -n);
  }
  return Object.keys(net).filter(k => net[k]).map(k => ({ key: k, raw: net[k] }))
    .sort((a, b) => Math.abs(worthOf(b)) - Math.abs(worthOf(a)) || Math.abs(b.raw) - Math.abs(a.raw));
}

// a token's row from the wallet when it holds it, otherwise what the market knows
function rowOfKey(k){
  const held = heldTokens().filter(r => tokKeyOf(r) === k)[0];
  if (held) return held;
  const n = nameOf(k.slice(k.indexOf(':') + 1));
  const r = { sym: n.sym, dec: n.dec };
  const a = marketAsset(k);
  if (a && a.logo) r.logo = a.logo;
  if (k.slice(0, 5) === 'cw20:') r.contract = k.slice(5); else r.denom = k.slice(7);
  return r;
}
function human(f){ return Math.abs(f.raw) / Math.pow(10, rowOfKey(f.key).dec === undefined ? 6 : rowOfKey(f.key).dec); }
function worthOf(f){
  const r = rowOfKey(f.key);
  const u = fiatOf(Object.assign({}, r, { v: 1 }));
  return u === null ? 0 : u * human(f) * Math.sign(f.raw);
}
const symOfKey = k => rowOfKey(k).sym;
const amountText = f => (f.raw > 0 ? '+' : '-') + fmt(human(f)) + ' ' + symOfKey(f.key);

/* Where it happened. Same code ids as the DeFi screen; a contract seen for
   the first time is looked up once in the background and the list redrawn. */
const PLACE_FIXED = {
  terra1x44ptyv7zp9e289jxqu6x5asxazhjc8gvuj9ltfs6mzvjfuzn8lqluk4u7: 'Terraport staking',
  terra1rta0rnaxz9ww6hnrj9347vdn66gkgxcmcwgpm2jj6qulv8adc52s95qa5y: 'Juris staking',
  terra15gk54rgdzd4xltxxzfe52y0jlhf7eh0wjvkkr877uvketw8ut90sr7ej8m: 'Garuda order book',
  terra1dttut659lxn35m7elu794rglzjzmph3a7v8cs6866qn0csa05u7sk0jg3s: 'GRDX staking'
};
const PLACE_CODE = { '10913': 'Garuda farm', '10899': 'Garuda farm', '10907': 'Garuda pool',
  '10920': 'Garuda staking', '10715': 'Terraport staking', '11230': 'Juris staking', '11408': 'Garuda order book' };
const UNKNOWN = {};
function placeOf(c, me){
  if (!c) return '';
  if (PLACE_FIXED[c]) return PLACE_FIXED[c];
  const code = permGet('code:' + c);
  let place = code && PLACE_CODE[code];
  if (!place) {
    const lab = permGet('label:' + c);
    if (lab) place = prettyLabel(lab);
    else if (code === undefined) UNKNOWN[c] = 1;
  }
  // a farm or pool the DeFi screen knows is named by its pair
  const pair = pairOf(c, me);
  return place ? place + (pair ? ' \u00b7 ' + pair : '') : '';
}
function prettyLabel(l){
  // a contract's label is whatever its deployer typed
  l = clean(l, 60).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/router/i.test(l)) return 'Swap router' + (/terraport/i.test(l) ? ' \u00b7 Terraport' : /garuda/i.test(l) ? ' \u00b7 Garuda' : '');
  return l.length > 28 ? l.slice(0, 27) + '\u2026' : l;
}
function pairOf(c, me){
  try {
    const pos = JSON.parse(localStorage.getItem('fw:earn:pos:' + me) || 'null');
    const p = pos && pos[c];
    if (!p || !p.holds || p.holds.length !== 2) return '';
    return p.holds.map(h => symOfKey(h.key)).join(' / ');
  } catch (e) { return ''; }
}
async function learnPlaces(){
  const list = Object.keys(UNKNOWN).slice(0, 24);
  if (!list.length) return;
  list.forEach(c => { delete UNKNOWN[c]; });
  let got = 0;
  for (const c of list) {
    try {
      const r = await getJSON(LCD + '/cosmwasm/wasm/v1/contract/' + c, 10000, 1);
      const ci = (r && r.contract_info) || {};
      permSet('code:' + c, String(ci.code_id || ''));
      if (ci.label) permSet('label:' + c, ci.label);
      got++;
    } catch (e) { /* asked again next time */ }
  }
  if (got) render();
}

const STAKING_MSG = /MsgDelegate|MsgUndelegate|MsgBeginRedelegate|WithdrawDelegatorReward/;
const DEFI_INTENT = /stake|bond|claim|reward|harvest|liquidity|withdraw|deposit|order|redeem|release/;
function look(t, me){
  const msgs = ((t.tx || {}).body || {}).messages || [];
  const m = msgs[0] || {};
  const type = String(m['@type'] || '');
  const d = describe(t, me);
  const intent = type.indexOf('MsgExecuteContract') >= 0 ? intentOf(m) : '';
  const f = flows(t, me);
  const ins = f.filter(x => x.raw > 0), outs = f.filter(x => x.raw < 0);
  const swap = d.kind === 'swap' || /swap/.test(intent);
  let title = d.title.replace(/ \+\d+$/, ''), kind = d.kind, group = 'other';
  if (swap) { title = 'Swapped'; kind = 'swap'; group = 'swaps'; }
  else if (type.indexOf('MsgSend') >= 0 || intent === 'transfer') group = 'transfers';
  else if (STAKING_MSG.test(type)) group = 'staking';
  else if (intent && (DEFI_INTENT.test(intent) || PLACE_FIXED[m.contract] || PLACE_CODE[permGet('code:' + m.contract)])) group = 'defi';
  if (intent === 'cancel_order') {
    const id = m.msg.cancel_order && m.msg.cancel_order.order_id;
    title = 'Cancelled order' + (id !== undefined ? ' #' + id : ''); kind = 'cancel';
  }
  if (intent === 'withdraw_unlocked' || intent === 'withdraw_released') { title = 'Withdrew'; kind = 'in'; }
  if (intent === 'withdraw' && ins.length && PLACE_CODE[permGet('code:' + m.contract)] === 'Garuda staking') { title = 'Claimed rewards'; kind = 'gift'; }
  if (msgs.length > 1 && !swap) title += msgs.every(x => x['@type'] === m['@type']) ? ' \u00d7' + msgs.length : '';
  // where: the product for a contract call, the other person for a transfer
  let sub = d.sub;
  const place = m.contract ? placeOf(m.contract, me) : '';
  if (swap) {
    const a = outs[0], b = ins[0];
    sub = a && b ? symOfKey(a.key) + ' \u2192 ' + symOfKey(b.key) : d.sub;
    if (place && !/router/i.test(place)) sub += ' \u00b7 ' + place.replace(/ \u00b7 .*/, '');
  } else if (place) sub = place;
  // what happened to the money
  let top = '', below = '', topIn = false, msgKey = '';
  if (swap) {
    if (ins[0]) { top = amountText(ins[0]); topIn = true; }
    if (outs[0]) below = amountText(outs[0]);
  } else if (ins.length) {
    top = amountText(ins[0]); topIn = true;
    if (ins.length > 1) top += ' +' + (ins.length - 1);
    if (outs.length) below = amountText(outs[0]);
  } else if (outs.length) {
    top = amountText(outs[0]);
    if (outs.length > 1) top += ' +' + (outs.length - 1);
  } else if (d.value) {
    top = d.value;
  } else {
    // an unstake moves nothing yet; the amount is in the message
    const body = m.msg && intent && m.msg[intent];
    if (body && body.amount && body.asset && body.asset.address) {
      const k = (body.asset.asset_type === 'cw20' ? 'cw20:' : 'native:') + body.asset.address;
      top = fmt(human({ key: k, raw: Number(body.amount) })) + ' ' + symOfKey(k);
      msgKey = k;
    }
  }
  const main = swap ? (outs[0] || ins[0]) : (ins[0] || outs[0] || (msgKey ? { key: msgKey, raw: 0 } : null));
  const second = swap ? ins[0] : null;
  const usdMain = main ? worthOf(main) : 0;
  return { title: title, kind: kind, group: group, sub: sub, top: top, topIn: topIn, below: below,
           main: main, second: second, usd: usdMain, flows: f, place: place };
}

const BADGE = {
  in: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
  out: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  gift: '<path d="M4 11h16v9H4z"/><path d="M12 11v9"/><path d="M4 7h16v4H4z"/><path d="M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>',
  stake: '<path d="m12 4 8 4.5-8 4.5-8-4.5Z"/><path d="m4 15 8 4.5 8-4.5"/>',
  cancel: '<path d="M6 6l12 12M18 6 6 18"/>',
  code: '<path d="M9 7 4.5 12 9 17"/><path d="M15 7l4.5 5-4.5 5"/>',
  wait: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  fail: '<path d="M12 7v6"/><path d="M12 17h.01"/>'
};
function face(l, failed, pending){
  if (l.kind === 'swap' && l.main && l.second) {
    return '<span class="ac-face pair">' + iconHTML(rowOfKey(l.main.key)) + iconHTML(rowOfKey(l.second.key)) + '</span>';
  }
  const b = pending ? 'wait' : failed ? 'fail' : (BADGE[l.kind] ? l.kind : 'code');
  const logo = l.main ? iconHTML(rowOfKey(l.main.key))
    : '<span class="ac-plain"><svg viewBox="0 0 24 24">' + (ICON[l.kind] || ICON.code) + '</svg></span>';
  return '<span class="ac-face">' + logo + '<i class="ac-badge ' + b + '"><svg viewBox="0 0 24 24">' + BADGE[b] + '</svg></i></span>';
}

// One row of the list. The token screen draws the same rows for one token.
function rowHTML(t, me, dated){
  TXS[t.txhash] = t;
  const l = look(t, me);
  const failed = Number(t.code) > 0;
  const when = dated && dayName(t.timestamp) !== 'Today' ? dayName(t.timestamp) : clock(t.timestamp);
  const dollars = l.usd ? usd(Math.abs(l.usd)) : '';
  return '<div class="ac-row" data-hash="' + esc(t.txhash) + '">' + face(l, failed) +
    '<div class="ac-mid"><div class="ac-t">' + esc(l.title) + '</div>' +
      '<div class="ac-s">' + (failed ? '<span class="ac-bad">failed</span> \u00b7 ' : '') + esc(l.sub || short(t.txhash)) + '</div></div>' +
    '<div class="ac-r"><div class="ac-v' + (l.topIn && !failed ? ' in' : '') + '">' + (failed ? '' : esc(l.top)) + '</div>' +
      '<div class="ac-w">' + esc(l.below && !failed ? l.below : (dollars && !failed ? dollars + ' \u00b7 ' : '') + when) + '</div></div>' +
    '</div>';
}

/* ================= the list ================= */
let ALL = [], FILTER = 'all', SHOWN = 40, PAGE_OFF = 0, PENDING = [], MORE = true;
const GROUPS = [['all', 'All'], ['transfers', 'Transfers'], ['swaps', 'Swaps'], ['defi', 'DeFi'], ['staking', 'Staking']];

async function page(query, offset){
  try {
    const r = await getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(query) +
      '&pagination.limit=25' + (offset ? '&pagination.offset=' + offset : '') + '&order_by=ORDER_BY_DESC', 20000);
    return r.tx_responses || [];
  } catch (e) { return []; }
}

async function fetchMore(me){
  const lists = await Promise.all([
    page("message.sender='" + me + "'", PAGE_OFF),
    page("transfer.recipient='" + me + "'", PAGE_OFF),
    page("wasm.to='" + me + "'", PAGE_OFF)
  ]);
  PAGE_OFF += 25;
  MORE = lists.some(l => l.length === 25);
  const seen = {};
  ALL.forEach(t => { seen[t.txhash] = 1; });
  for (const t of lists[0].concat(lists[1], lists[2])) {
    if (!t || seen[t.txhash]) continue;
    seen[t.txhash] = 1;
    ALL.push(t);
  }
  ALL.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function render(){
  const me = S.ADDR || (S.SAVED && S.SAVED.addr) || '';
  const list = $('#ac-list');
  const chips = $('#ac-chips');
  if (chips) chips.innerHTML = GROUPS.map(g =>
    '<button type="button" class="ac-chip' + (FILTER === g[0] ? ' on' : '') + '" data-f="' + g[0] + '">' + g[1] + '</button>').join('');
  const rows = ALL.map(t => ({ t: t, l: look(t, me) }))
    .filter(x => FILTER === 'all' || x.l.group === FILTER).slice(0, SHOWN);
  // sends still waiting for their block go on top, as the first thing today
  const pend = FILTER === 'all' || FILTER === 'transfers' ? PENDING : [];
  if (!rows.length && !pend.length) {
    list.innerHTML = '<div class="empty">' + (ALL.length ? 'Nothing of this kind in the history read so far.' : 'Nothing on chain for this address yet.') + '</div>';
  } else {
    // day headings, each with what that day did to the wallet in dollars
    const days = {};
    rows.forEach(x => { const k = dayKey(x.t.timestamp); (days[k] = days[k] || []).push(x); });
    let html = '';
    if (pend.length) {
      html += '<div class="ac-day"><span>On the way</span></div>' + pend.map(pendingRow).join('');
    }
    for (const k of Object.keys(days)) {
      const xs = days[k];
      let inn = 0, out = 0;
      xs.forEach(x => { if (Number(x.t.code) > 0) return; x.l.flows.forEach(f => { const w = worthOf(f); if (w > 0) inn += w; else out -= w; }); });
      const tag = inn >= 0.01 && out < 0.01 ? '+' + usd(inn) + ' in'
        : out >= 0.01 && inn < 0.01 ? '-' + usd(out) + ' out'
        : inn + out >= 0.01 ? (inn - out >= 0 ? '+' : '-') + usd(Math.abs(inn - out)) + ' net' : '';
      html += '<div class="ac-day"><span>' + dayName(xs[0].t.timestamp) + '</span><em>' + tag + '</em></div>';
      html += xs.map(x => rowHTML(x.t, me)).join('');
    }
    if (MORE || ALL.length > SHOWN) html += '<button type="button" class="ac-more" id="ac-more">Load more</button>';
    list.innerHTML = html;
    paintIcons(list);
  }
  $('#ac-note').textContent = ALL.length ? ALL.length + ' transactions read so far.' : '';
  learnPlaces();
}

function pendingRow(j){
  const l = { kind: 'out', main: { key: j.key, raw: -1 } };
  return '<div class="ac-row pending" data-hash="' + esc(j.hash) + '">' + face(l, false, true) +
    '<div class="ac-mid"><div class="ac-t">Sending</div><div class="ac-s">to ' + esc(short(j.to)) + '</div></div>' +
    '<div class="ac-r"><div class="ac-v">-' + esc(j.amount + ' ' + j.sym) + '</div>' +
    '<div class="ac-w pend">' + (j.state === 'slow' ? 'not in a block yet' : 'waiting for the block') + '</div></div></div>';
}

async function load(){
  const me = S.ADDR || (S.SAVED && S.SAVED.addr) || '';
  if (!me || LOADED === me) return;
  const list = $('#ac-list');
  if (!ALL.length || LOADED_FOR !== me) list.innerHTML = '<div class="empty">Reading the chain</div>';
  ALL = []; PAGE_OFF = 0; SHOWN = 40; MORE = true; LOADED_FOR = me;
  await fetchMore(me);
  LOADED = me;
  render();
}
let LOADED_FOR = '';

function openLink(url){
  if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openLink)
    Telegram.WebApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

$('#ac-list').addEventListener('click', async e => {
  if (e.target.closest('#ac-more')) {
    const b = e.target.closest('#ac-more');
    b.disabled = true; b.textContent = 'Reading\u2026';
    SHOWN += 40;
    const me = S.ADDR || (S.SAVED && S.SAVED.addr) || '';
    if (ALL.length < SHOWN && MORE) await fetchMore(me);
    render();
    return;
  }
  const row = e.target.closest('.ac-row');
  if (row && !row.classList.contains('pending')) openTx(row.dataset.hash);
});
const chipsEl = document.getElementById('ac-chips');
if (chipsEl) chipsEl.addEventListener('click', e => {
  const c = e.target.closest('[data-f]');
  if (!c) return;
  FILTER = c.dataset.f;
  render();
});
// sends on their way, from tx.js
document.addEventListener('frontier:pending', e => {
  PENDING = ((e.detail && e.detail.jobs) || []).filter(j => j.state === 'wait' || j.state === 'slow');
  const a = document.getElementById('st-activity');
  if (a && a.classList.contains('on') && ALL.length) render();
});

$('#tx-x').addEventListener('click', () => { $('#tx-sheet').hidden = true; });
$('#tx-close').addEventListener('click', () => { $('#tx-sheet').hidden = true; });
$('#tx-open').addEventListener('click', () => { if (CURRENT) openLink(FINDER + CURRENT); });
$('#tx-copy').addEventListener('click', async function () {
  const back = this.textContent;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
    await navigator.clipboard.writeText(CURRENT);
    this.textContent = 'Copied';
  } catch (e) { this.textContent = 'Copying was refused'; }
  setTimeout(() => { this.textContent = back; }, 1500);
});

// loaded when the tab is opened, not on boot: the home screen has enough to do
document.querySelectorAll('[data-tab="activity"]').forEach(b =>
  b.addEventListener('click', () => { load(); }));

/* A transaction from somewhere else in the wallet: a send that just landed,
   a notification's Details button. Read by hash if the list has not got it. */
async function showTx(hash){
  if (!hash) return;
  go('activity');
  load();
  if (!TXS[hash]) {
    try {
      const d = await getJSON(LCD + '/cosmos/tx/v1beta1/txs/' + hash, 10000, 2);
      if (d && d.tx_response) TXS[hash] = d.tx_response;
    } catch (e) { /* not indexed yet; the list will have it shortly */ }
  }
  openTx(hash);
}
document.addEventListener('frontier:show-tx', e => showTx(e.detail && e.detail.hash));

document.addEventListener('frontier:refresh', () => { LOADED = ''; });

// something moved: the list is stale, and if it is on screen, read it again
document.addEventListener('frontier:tx', () => {
  LOADED = '';
  const a = document.getElementById('st-activity');
  if (a && a.classList.contains('on')) load();
});

export { load, nameOf, rowHTML, short, showTx, wasmCalls };
