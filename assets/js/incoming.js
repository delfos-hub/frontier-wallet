/* Money arriving, announced.

   A transfer into this address changed a number on the home screen and said
   nothing - and only after the next 45 second refresh. This asks the same two
   indexes the Activity tab reads (coins by transfer.recipient, tokens by the
   token contract's own wasm.to) and raises the wallet's notification card for
   anything new: what arrived, how much, and from whom.

   Only plain transfers are announced. A P2P fill or a GRAM swap also pays this
   address, but those modules announce their own deals, and a second card for
   the same money would be noise. Anything this address signed itself is
   skipped too: a send is announced by tx.js, a swap by its own screen.

   The newest height seen is kept per address, so what arrived while the
   wallet was closed is announced on the next open, and nothing twice. */
import { LCD, amt, fmt, getJSON } from './chain.js?v=cf89e770';
import { nameOf, short, wasmCalls } from './activity.js?v=cf89e770';
import { notify } from './notify.js?v=cf89e770';
import { S } from './state.js?v=cf89e770';
import { heldTokens, refreshBalances } from './tokens.js?v=cf89e770';

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

// What reached this address in one transaction, as rows the card can show.
function arrivals(t, addr){
  const msgs = ((t.tx || {}).body || {}).messages || [];
  const m = msgs[0] || {};
  const type = String(m['@type'] || '');
  const out = [];

  if (type.indexOf('MsgSend') >= 0 || type.indexOf('MsgMultiSend') >= 0) {
    for (const lg of (t.logs || [])) {
      for (const e of (lg.events || [])) {
        if (e.type !== 'transfer') continue;
        let to = '', what = '';
        for (const a of (e.attributes || [])) {
          if (a.key === 'recipient') to = a.value;
          if (a.key === 'amount') what = a.value;
        }
        if (to !== addr || !what) continue;
        for (const part of what.split(',')) {
          const mm = /^(\d+)(.+)$/.exec(part.trim());
          if (!mm) continue;
          const tk = nameOf(mm[2]);
          out.push({ key: 'native:' + mm[2], sym: tk.sym, text: fmt(amt(mm[1], tk.dec)) });
        }
      }
    }
  } else if (type.indexOf('MsgExecuteContract') >= 0) {
    // a token sent by hand: the message is the token contract's own transfer
    // (or send), not some other contract paying out
    const top = Object.keys((m.msg && typeof m.msg === 'object') ? m.msg : {})[0];
    if (top !== 'transfer' && top !== 'send') return out;
    for (const c of wasmCalls(t)) {
      if (c.at !== m.contract || c.to !== addr || !c.amount) continue;
      if (c.action !== 'transfer' && c.action !== 'send') continue;
      const tk = nameOf(c.at);
      out.push({ key: 'cw20:' + c.at, sym: tk.sym, text: fmt(amt(c.amount, tk.dec)) });
    }
  }
  return out;
}

// the held row if the wallet has one, so the card shows the token's own logo
function tokenRow(key, sym){
  const r = heldTokens().filter(function (x) {
    return (x.contract ? 'cw20:' + x.contract : 'native:' + x.denom) === key;
  })[0];
  return r || { sym: sym };
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
      .filter(t => signer((((t.tx || {}).body || {}).messages || [])[0]) !== addr)
      .map(t => ({ t: t, rows: arrivals(t, addr) }))
      .filter(x => x.rows.length)
      .sort((a, b) => Number(a.t.height) - Number(b.t.height));
    setMark(addr, top);
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
        const msg = (((x.t.tx || {}).body || {}).messages || [])[0];
        notify({ key: 'recv:' + x.t.txhash, kind: 'success', icon: tokenRow(first.key, first.sym),
          label: 'Received \u00b7 ' + first.sym,
          title: '+' + first.text + ' ' + first.sym + more,
          text: 'From ' + short(signer(msg)) + ' \u00b7 block ' + x.t.height,
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

export { arrivals, poll };
