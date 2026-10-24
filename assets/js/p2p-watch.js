/* Tells the seller when their P2P orders are bought, while the wallet is
   open: "Order filled: sold 1,000,000 LUNC" or "Partially filled: 40% sold",
   with a chime, a vibration and a pop-up (notify.js), and a count on the P2P
   button until the market is opened.

   It reads the seller's orders from the otc-p2p contract (OrdersBySeller)
   every 20 s and compares them with the last read, kept on the device. The
   first read only takes a snapshot: fills from before are not announced.
   An order that is gone was bought, unless this wallet cancelled or
   reclaimed it (p2p.js records those) or it had expired.

   The contract is p2p.js's P2P_CONTRACT (columbus-5). Until it is deployed
   nothing runs. For a test on another network: localStorage
   fw:p2p:watch = {"lcd":"...","contract":"...","seller":"..."}. */
import { KNOWN_IBC, LCD, getJSON } from './chain.js?v=8b1082e1';
import { notify, badge } from './notify.js?v=8b1082e1';
import { P2P_CONTRACT, openMarket } from './p2p.js?v=8b1082e1';
import { $ } from './shell.js?v=8b1082e1';
import { S } from './state.js?v=8b1082e1';
import { diffOrders } from './p2p-orders.js?v=8b1082e1';

function target(){
  let o = null;
  try { o = JSON.parse(localStorage.getItem('fw:p2p:watch') || 'null'); } catch (e) {}
  const seller = (o && o.seller) || S.ADDR || (S.SAVED && S.SAVED.addr) || '';
  const contract = (o && o.contract) || P2P_CONTRACT;
  const lcd = (o && o.lcd) || LCD;
  return contract && seller ? { lcd: lcd, contract: contract, seller: seller } : null;
}
const q = (t, msg) => getJSON(t.lcd + '/cosmwasm/wasm/v1/contract/' + t.contract + '/smart/' + btoa(JSON.stringify(msg)), 10000, 2);

/* ---------- assets: symbol and decimals ---------- */
const NATIVE = { uluna: { sym: 'LUNC', dec: 6 }, uusd: { sym: 'USTC', dec: 6 } };
async function meta(t, a){
  if (a.native) return NATIVE[a.native.denom] || (KNOWN_IBC[a.native.denom] && { sym: KNOWN_IBC[a.native.denom].sym, dec: KNOWN_IBC[a.native.denom].dec }) || { sym: a.native.denom.slice(0, 10), dec: 6 };
  const addr = a.cw20 && a.cw20.address;
  const key = 'fw:cw20meta:' + addr;
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c; } catch (e) {}
  try {
    const d = (await getJSON(t.lcd + '/cosmwasm/wasm/v1/contract/' + addr + '/smart/' + btoa('{"token_info":{}}'), 8000, 1)).data;
    const m = { sym: d.symbol, dec: d.decimals };
    try { localStorage.setItem(key, JSON.stringify(m)); } catch (e) {}
    return m;
  } catch (e) { return { sym: 'tokens', dec: 6 }; }
}
function human(raw, dec){
  const s = BigInt(raw).toString().padStart(dec + 1, '0');
  const i = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, '').slice(0, 6);
  return BigInt(i).toLocaleString('en-US') + (f ? '.' + f : '');
}

/* ---------- the snapshot ---------- */
const seenKey = t => 'fw:p2p:seen:' + t.contract + ':' + t.seller;
function load(t){
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey(t)) || 'null');
    if (!raw) return null;
    const out = {};
    for (const id in raw) { const o = raw[id]; out[id] = Object.assign({}, o, { rem: BigInt(o.rem), total: BigInt(o.total), askTotal: BigInt(o.askTotal) }); }
    return out;
  } catch (e) { return null; }
}
function save(t, m){
  const raw = {};
  for (const id in m) { const o = m[id]; raw[id] = Object.assign({}, o, { rem: String(o.rem), total: String(o.total), askTotal: String(o.askTotal) }); }
  try { localStorage.setItem(seenKey(t), JSON.stringify(raw)); } catch (e) {}
}
function closedSet(){
  try { return new Set((JSON.parse(localStorage.getItem('fw:p2p:closed') || '[]')).map(String)); } catch (e) { return new Set(); }
}

let BUSY = false, UNSEEN = 0;
async function watch(){
  const t = target();
  if (!t || BUSY || document.hidden) return;
  BUSY = true;
  try {
    const orders = [];
    let after = null;
    for (let page = 0; page < 5; page++) {
      const d = (await q(t, { orders_by_seller: { seller: t.seller, start_after: after, limit: 30 } })).data;
      const list = (d && d.orders) || [];
      orders.push(...list);
      if (list.length < 30) break;
      after = list[list.length - 1].id;
    }
    const cur = {};
    for (const o of orders) cur[o.id] = { rem: BigInt(o.offer_remaining), total: BigInt(o.offer_total), askTotal: BigInt(o.ask_total),
      fee: Number(o.fee_bps || 0), exp: Number(o.expires_at), offer: o.offer, ask: o.ask };
    const prev = load(t);
    save(t, cur);
    if (!prev) return;                              // the first read is only a snapshot
    const events = diffOrders(prev, cur, closedSet(), Math.floor(Date.now() / 1000));
    for (const ev of events) {
      const [om, am] = await Promise.all([meta(t, ev.order.offer), meta(t, ev.order.ask)]);
      const pct = Math.round(Number(ev.soldTotal * 100n / ev.total));
      notify({
        key: 'p2p:' + ev.id + ':' + String(ev.order.rem ?? 0) + ':' + ev.kind,
        kind: 'success', icon: om.sym,
        label: ev.kind === 'filled' ? 'P2P \u00b7 order filled' : 'P2P \u00b7 partially filled',
        title: 'Sold ' + human(ev.sold, om.dec) + ' ' + om.sym,
        text: (ev.kind === 'filled'
          ? 'Your order #' + ev.id + ' is fully bought.'
          : 'Order #' + ev.id + ': ' + pct + '% sold, ' + human(ev.total - ev.soldTotal, om.dec) + ' ' + om.sym + ' still on offer.') +
          ' You received about ' + human(ev.received, am.dec) + ' ' + am.sym + ' (after the market fee).',
        actions: [{ label: 'Open P2P', primary: true, run: openMarket }]
      });
      UNSEEN++;
    }
    badge($('#act-p2p'), UNSEEN);
  } catch (e) { /* the next round tries again */ }
  finally { BUSY = false; }
}
$('#act-p2p').addEventListener('click', () => { UNSEEN = 0; badge($('#act-p2p'), 0); });
setInterval(watch, 20000);
setTimeout(watch, 4000);
