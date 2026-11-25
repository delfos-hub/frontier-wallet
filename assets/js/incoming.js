/* Money arriving, announced.

   A transfer into this address changed a number on the home screen and said
   nothing - and only after the next 45 second refresh. This asks the same two
   indexes the Activity tab reads (coins by transfer.recipient, tokens by the
   token contract's own wasm.to) and raises the wallet's notification card for
   anything new: what arrived, how much, and from whom.

   Announced: plain transfers, and anything a contract pays out to this
   address (a claim on Terra Oracle, a reward, a distribution), also when the
   claim was signed in another wallet or on a site. Quiet: what this wallet
   sent itself (its own screen says so; tx.js keeps those hashes), a trade
   (something also left this address in the same transaction), and the P2P
   and GRAM swap contracts, which announce their own deals.

   The newest height seen is kept per address, so what arrived while the
   wallet was closed is announced on the next open, and nothing twice. */
import { amt, fmt, getJSON, LCD, smart } from './chain.js?v=a030bc00';
import { nameOf, short, wasmCalls } from './activity.js?v=a030bc00';
import { notify } from './notify.js?v=a030bc00';
import { S } from './state.js?v=a030bc00';
import { heldTokens, refreshBalances } from './tokens.js?v=a030bc00';
import { NETS } from './gram-net.js?v=a030bc00';

const EVERY = 30000;          // two light reads every half minute, while open
const AT_ONCE = 3;            // more than this in one go becomes one summary card
let OPEN = false, BUSY = false, TIMER = null;

const me = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const markKey = a => 'fw:recv:' + a;
function getMark(a){ try { const v = localStorage.getItem(markKey(a)); return v === null ? null : Number(v); } catch (e) { return null; } }
function setMark(a, h){ try { localStorage.setItem(markKey(a), String(h)); } catch (e) {} }

async function page(query){
  try {
    const r = await getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(query) +
      '&pagination.limit=10&order_by=ORDER_BY_DESC', 15000, 1);
    return r.tx_responses || [];
  } catch (e) { return []; }
}

function signer(m){
  return (m && (m.from_address || m.sender || m.delegator_address)) || '';
}

// the network's fee collector: a fee is not money leaving in a trade
const FEE_COLLECTOR = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa';
// contracts whose deals have their own cards: the P2P market (p2p.js) and the
// GRAM swap's Terra lock on both networks (gram-net.js)
const QUIET = new Set(['terra1k65g4hy99sy6h7f2khrt5rz97ydlemtn4459gj9qhrt79tp83hcsdsq5uj']
  .concat(Object.keys(NETS || {}).map(k => NETS[k] && NETS[k].htlc).filter(Boolean)));
const CW20_MOVES = { transfer: 1, send: 1, mint: 1, transfer_from: 1, send_from: 1 };

// transactions this wallet broadcast itself (tx.js)
function sentHere(hash){
  try { return JSON.parse(localStorage.getItem('fw:mine') || '[]').indexOf(hash) >= 0; } catch (e) { return false; }
}

// What reached this address in one transaction, as rows the card can show:
// coins and tokens in, from whom. Nothing when the transaction touches a
// contract with its own cards, or when something also left this address
// (a trade, a deposit), so only money that simply arrived is announced.
function arrivals(t, addr){
  const msgs = ((t.tx || {}).body || {}).messages || [];
  for (const m of msgs) {
    if (QUIET.has(m.contract)) return [];
    const inner = m.msg && typeof m.msg === 'object' ? m.msg : {};
    if (inner.send && QUIET.has(inner.send.contract)) return [];
  }
  const out = [];
  let left = false;
  for (const lg of (t.logs || [])) {
    for (const e of (lg.events || [])) {
      if (e.type !== 'transfer') continue;
      let to = '', from = '', what = '';
      for (const a of (e.attributes || [])) {
        if (a.key === 'recipient') to = a.value;
        if (a.key === 'sender') from = a.value;
        if (a.key === 'amount') what = a.value;
      }
      if (from === addr && to !== FEE_COLLECTOR && to !== addr) left = true;
      if (to !== addr || from === addr || !what) continue;
      for (const part of what.split(',')) {
        const mm = /^(\d+)(.+)$/.exec(part.trim());
        if (!mm) continue;
        const tk = nameOf(mm[2]);
        out.push({ key: 'native:' + mm[2], sym: tk.sym, text: fmt(amt(mm[1], tk.dec)), from: from });
      }
    }
  }
  for (const c of wasmCalls(t)) {
    if (!CW20_MOVES[c.action] || !c.amount) continue;
    const src = c.from || c.owner || '';
    if (src === addr && c.to !== addr) left = true;
    if (c.to !== addr || src === addr) continue;
    const tk = nameOf(c.at);
    out.push({ key: 'cw20:' + c.at, sym: tk.sym, text: fmt(amt(c.amount, tk.dec)), from: src || c.at, raw: c.amount });
  }
  return left ? [] : out;
}

// the held row if the wallet has one, so the card shows the token's own logo
function tokenRow(key, sym){
  const r = heldTokens().filter(function (x) {
    return (x.contract ? 'cw20:' + x.contract : 'native:' + x.denom) === key;
  })[0];
  return r || { sym: sym };
}

// Any contract can emit a wasm event that reads like a token transfer to this
// address without moving anything (Pablo, #62). A token row stands only if
// that contract answers as a CW20 and this address holds at least the amount;
// coins come from the bank's own transfer events and need no check.
async function realRows(rows, addr){
  const out = [];
  for (const r of rows) {
    if (r.key.indexOf('cw20:') !== 0) { out.push(r); continue; }
    try {
      const d = await smart(r.key.slice(5), { balance: { address: addr } }, 1);
      const have = BigInt(((d && d.data) || {}).balance || 0), got = BigInt(r.raw || 0);
      if (got > 0n && have >= got) out.push(r);
    } catch (e) { /* not a token contract: a made-up event */ }
  }
  return out;
}

const show = hash => document.dispatchEvent(new CustomEvent('frontier:show-tx', { detail: { hash: hash } }));

async function poll(){
  const addr = me();
  if (!OPEN || BUSY || !addr || document.hidden) return;
  BUSY = true;
  try {
    const [coins, tokens] = await Promise.all([
      page("transfer.recipient='" + addr + "'"),
      page("wasm.to='" + addr + "'")
    ]);
    const seen = {}, all = [];
    for (const t of coins.concat(tokens)) {
      if (!t || seen[t.txhash] || Number(t.code) > 0) continue;
      seen[t.txhash] = 1;
      all.push(t);
    }
    if (!all.length) return;
    const top = Math.max.apply(null, all.map(t => Number(t.height) || 0));
    const mark = getMark(addr);
    // the first time this address is watched, everything so far is history
    if (mark === null) { setMark(addr, top); return; }
    if (top <= mark) return;

    const fresh = all
      .filter(t => Number(t.height) > mark)
      // what this wallet sent is announced by its own screen; anything else
      // this address signed (a claim on a site, another wallet) is not
      .filter(t => !sentHere(t.txhash))
      .map(t => ({ t: t, rows: arrivals(t, addr), mine: signer((((t.tx || {}).body || {}).messages || [])[0]) === addr }))
      .filter(x => x.rows.length)
      .sort((a, b) => Number(a.t.height) - Number(b.t.height));
    setMark(addr, top);
    for (const x of fresh) x.rows = await realRows(x.rows, addr);
    for (let i = fresh.length - 1; i >= 0; i--) if (!fresh[i].rows.length) fresh.splice(i, 1);
    if (!fresh.length) return;

    if (fresh.length > AT_ONCE) {
      notify({ key: 'recv:many:' + top, kind: 'success', icon: 'LUNC', label: 'Received',
        title: fresh.length + ' transfers arrived',
        text: 'Open Activity to see what came in and from whom.',
        actions: [{ label: 'Activity', run: () => show(fresh[fresh.length - 1].t.txhash) }] });
    } else {
      for (const x of fresh) {
        const first = x.rows[0];
        const more = x.rows.length > 1 ? ' and ' + (x.rows.length - 1) + ' more' : '';
        // a payout this address asked for (a claim) reads as one
        notify({ key: 'recv:' + x.t.txhash, kind: 'success', icon: tokenRow(first.key, first.sym),
          label: (x.mine ? 'Claimed \u00b7 ' : 'Received \u00b7 ') + first.sym,
          title: '+' + first.text + ' ' + first.sym + more,
          text: 'From ' + short(first.from) + ' \u00b7 block ' + x.t.height,
          actions: [{ label: 'Details', run: () => show(x.t.txhash) }] });
      }
    }
    refreshBalances(true);
    document.dispatchEvent(new CustomEvent('frontier:tx', { detail: { hash: fresh[0].t.txhash } }));
  } catch (e) {
    /* a missed poll is retried in half a minute; it is never worth a banner */
  } finally {
    BUSY = false;
  }
}

function start(){
  OPEN = true;
  if (!TIMER) TIMER = setInterval(poll, EVERY);
  setTimeout(poll, 4000);       // after the first balance read, not on top of it
}
function stop(){
  OPEN = false;
  if (TIMER) { clearInterval(TIMER); TIMER = null; }
}

document.addEventListener('frontier:wallet', start);
document.addEventListener('frontier:locked', stop);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

export { arrivals, poll, realRows, sentHere };
