/* The DEV tab: developer tools on a test network.

   Shown when Developer mode is on in Settings (localStorage fw:dev). Same
   address, same key, another chain: rebel-2 by default, or any node the
   developer adds whose chain id is not columbus-5 (a local node works). The
   chain id signed is the one that node reports, and tx.js refuses columbus-5
   on its own as well, so nothing typed here can be signed for mainnet.

   What it does: the test balance (bank coins and tracked CW20s) and a send;
   the faucet (faucet-worker/); the node, its block height and endpoints; a
   transaction by hash; contract query, execute, code upload and instantiate;
   and the contracts made from this wallet. Every signed action is simulated
   first, the fee is shown, and signing checks it again (tx.js checkFee). */
import { esc, fmt } from './chain.js?v=cb59fe64';
import { $, $$, go } from './shell.js?v=cb59fe64';
import { S } from './state.js?v=cb59fe64';
import { dryRunDev, sendDev, toRaw } from './tx.js?v=cb59fe64';

const FAUCET = 'https://frontier-faucet.delfoshub-team.workers.dev';
const DEFAULT_LCD = 'https://lcd.luncblaze.com';
const FINDER = 'https://finder.terraclassic.community/';
const MAINNET = 'columbus-5';

const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const short = a => a && a.length > 20 ? a.slice(0, 12) + '…' + a.slice(-6) : (a || '');
const NET = { chain: 'rebel-2', lcd: store.get('fw:dev:lcd', DEFAULT_LCD) };
const enc = new TextEncoder();
const b64 = s => { const b = enc.encode(s); let t = ''; for (let i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t); };
const finder = (kind, id) => FINDER + encodeURIComponent(NET.chain) + '/' + kind + '/' + encodeURIComponent(id);

/* ---------- Developer mode ---------- */
const devOn = () => store.get('fw:dev', false) === true;
function applyMode(){
  const on = devOn();
  const t = $('#tabs .tab[data-tab="dev"]');
  if (t) t.hidden = !on;
  // test LUNC in Home's token list: with Developer mode only, never in the total
  if (on) setTimeout(() => balance(), 0); else setTimeout(testRow, 0);
  const v = $('#dev-cur');
  if (v) v.textContent = on ? 'On' : 'Off';
  if (!on && ($('#st-dev').classList.contains('on') || $('#st-tsend').classList.contains('on'))) go('settings');
}
$('#set-dev').addEventListener('click', () => { store.set('fw:dev', !devOn()); applyMode(); if (devOn()) go('dev'); });
applyMode();

/* ---------- talking to the node ----------
   Its own small fetch: a refused query has to show the node's reason (a
   contract's error text), which getJSON drops. */
async function api(path, opt){
  const t0 = performance.now();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), (opt && opt.ms) || 15000);
  try {
    const r = await fetch((opt && opt.base || NET.lcd) + path, { signal: c.signal });
    const j = await r.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) { const e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; e.ms = ms; throw e; }
    return { j: j, ms: ms };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('the node did not answer in time');
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------- small renderers ---------- */
function jsonHTML(v){
  const s = esc(JSON.stringify(v, null, 2));
  return s.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b(true|false|null)\b/g,
    (m, str, colon, num, lit) => str ? (colon ? '<span class="k">' + str + '</span>' + colon : '<span class="s">' + str + '</span>')
      : num ? '<span class="n">' + num + '</span>' : '<span class="l">' + lit + '</span>');
}
const pre = v => '<pre class="dv-json">' + jsonHTML(v) + '</pre>';
function bad(box, e){
  const text = e && e.message ? e.message : String(e);
  box.innerHTML = '<div class="dv-err">' + esc(text) + '</div>';
}
const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('busy', on); };
function copy(text, el){
  try { navigator.clipboard.writeText(text); } catch (e) {}
  if (el) { el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 1200); }
}
function denomName(d){
  if (d === 'uluna') return 'LUNC';
  if (d === 'uusd') return 'USTC';
  if (/^u[a-z]{3}$/.test(d)) return d.slice(1).toUpperCase() + 'TC';
  if (/^ibc\//.test(d)) return 'IBC ' + d.slice(4, 10) + '…';
  return d.length > 24 ? d.slice(0, 20) + '…' : d;
}
// "1000000uluna, 5uusd" -> [{ denom, amount }]
function coinsOf(text){
  const t = String(text || '').trim();
  if (!t) return [];
  return t.split(/[,\s]+/).filter(Boolean).map(part => {
    const m = /^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]{2,127})$/.exec(part);
    if (!m) throw new Error('"' + part + '" is not a coin: write it as 1000000uluna');
    if (m[1] === '0') return null;
    return { denom: m[2], amount: m[1] };
  }).filter(Boolean);
}
function parseJSON(text, what){
  try { return JSON.parse(text); }
  catch (e) { throw new Error(what + ' is not valid JSON: ' + e.message); }
}
const minify = (text, what) => JSON.stringify(parseJSON(text, what));
function needKey(){
  if (!S.MNEMONIC) throw new Error('this wallet is watch-only here: unlock a wallet with its phrase to sign');
}
// a fee line, and the button that signs at that fee
function feeLine(res){
  return '<div class="dv-fee"><span>Network fee</span><b>' + fmt(res.gasFee / 1e6) + ' LUNC</b><small>' +
    res.gas.toLocaleString() + ' gas · test coins</small></div>';
}
function txLink(hash){
  return '<a class="dv-link" href="' + esc(finder('tx', hash)) + '" target="_blank" rel="noopener">' + esc(hash.slice(0, 10) + '…' + hash.slice(-8)) + '</a>';
}
// an event's attribute, from the tx_response (events at the top level, or the
// older per-message logs)
function attr(res, type, key){
  const evs = (res.events || []).concat(...(res.logs || []).map(l => l.events || []));
  for (const e of evs) {
    if (e.type !== type) continue;
    for (const a of e.attributes || []) if (a.key === key) return a.value;
  }
  return null;
}

/* ---------- JSON editors: line numbers, a mark on bad JSON ---------- */
function editor(id, key){
  const ta = $('#' + id);
  const ln = ta.parentElement.querySelector('.dv-ln');
  const draw = () => {
    const n = Math.max(ta.value.split('\n').length, Number(ta.getAttribute('rows')) || 1);
    ln.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    let okj = true;
    if (ta.value.trim()) { try { JSON.parse(ta.value); } catch (e) { okj = false; } }
    ta.parentElement.classList.toggle('bad', !okj);
  };
  ta.addEventListener('input', () => { draw(); if (key) store.set(key, ta.value); });
  ta.addEventListener('scroll', () => { ln.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); draw(); }
  });
  if (key) ta.value = store.get(key, '');
  draw();
  return { set(v){ ta.value = v; draw(); }, get: () => ta.value };
}
const ED = {
  q: editor('dv-q-msg', 'fw:dev:q'),
  x: editor('dv-x-msg', 'fw:dev:x'),
  i: editor('dv-i-msg', 'fw:dev:i')
};

/* ---------- the node: chain id, height, block time, endpoints ---------- */
let LIVE = null, LAST = null;
async function readNode(){
  const kv = $('#dv-kv');
  try {
    const { j } = await api('/cosmos/base/tendermint/v1beta1/node_info');
    const net = (j.default_node_info || {}).network;
    if (!net) throw new Error('the node did not say which chain it is');
    NET.chain = net;
    $('#dv-chain').textContent = net;
    $$('.dv-chain-n').forEach(el => { el.textContent = net; });
    const ver = (j.application_version || {}).version || '?';
    const sdk = (j.application_version || {}).cosmos_sdk_version || '';
    const rows = [['Chain id', net], ['Node', ver + (sdk ? ' · SDK ' + sdk : '')], ['Gas price', '28.325 uluna']];
    if (net === MAINNET) rows.push(['Signing', 'off: this node is mainnet']);
    kv.innerHTML = rows.map(r => '<span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b>').join('');
    api('/terra/tax/v1beta1/burn_tax_rate').then(r => {
      const n = Number(r.j.tax_rate);
      if (n >= 0) kv.insertAdjacentHTML('beforeend', '<span>Burn tax</span><b>' + esc((n * 100).toFixed(2)) + '%</b>');
    }).catch(() => {});
  } catch (e) { kv.innerHTML = '<span>Node</span><b class="dv-bad">' + esc(e.message) + '</b>'; }
}
async function tick(){
  try {
    const { j } = await api('/cosmos/base/tendermint/v1beta1/blocks/latest', { ms: 8000 });
    const h = Number(((j.block || {}).header || {}).height || ((j.sdk_block || {}).header || {}).height);
    const t = Date.parse(((j.block || {}).header || {}).time || ((j.sdk_block || {}).header || {}).time);
    if (LAST && h > LAST.h) $('#dv-btime').textContent = ((t - LAST.t) / (h - LAST.h) / 1000).toFixed(1) + ' s';
    if (!LAST || h > LAST.h) LAST = { h: h, t: t };
    $('#dv-height').textContent = h.toLocaleString();
    $('#dv-dot').className = 'dv-dot';
  } catch (e) { $('#dv-dot').className = 'dv-dot off'; }
}
async function firstBlockTime(){
  try {
    const { j } = await api('/cosmos/base/tendermint/v1beta1/blocks/latest');
    const hd = (j.block || j.sdk_block || {}).header || {};
    const h = Number(hd.height), t = Date.parse(hd.time);
    const old = await api('/cosmos/base/tendermint/v1beta1/blocks/' + (h - 20));
    const ot = Date.parse(((old.j.block || old.j.sdk_block || {}).header || {}).time);
    if (h && t && ot) $('#dv-btime').textContent = ((t - ot) / 20 / 1000).toFixed(1) + ' s';
    LAST = { h: h, t: t };
    $('#dv-height').textContent = h.toLocaleString();
  } catch (e) {}
}
const EPS = () => [DEFAULT_LCD].concat(store.get('fw:dev:eps', [])).filter((v, i, a) => a.indexOf(v) === i);
async function ping(){
  const box = $('#dv-eps');
  box.innerHTML = EPS().map((u, i) => '<div class="dv-ep" data-i="' + i + '"><i></i><span>' + esc(u.replace(/^https?:\/\//, '')) +
    '</span><span class="dv-tg">' + (u === NET.lcd ? 'IN USE' : '<button type="button" class="dv-use" data-u="' + esc(u) + '">use</button>') +
    '</span><span class="dv-ms">…</span></div>').join('');
  await Promise.all(EPS().map(async (u, i) => {
    const row = box.querySelector('[data-i="' + i + '"]');
    try {
      const { j, ms } = await api('/cosmos/base/tendermint/v1beta1/node_info', { base: u, ms: 8000 });
      const net = (j.default_node_info || {}).network || '?';
      row.querySelector('.dv-ms').textContent = ms + ' ms · ' + net;
      row.classList.add(net === MAINNET ? 'main' : ms < 600 ? 'fast' : 'slow');
    } catch (e) { row.querySelector('.dv-ms').textContent = 'no answer'; row.classList.add('down'); }
  }));
}
$('#dv-eps').addEventListener('click', e => {
  const b = e.target.closest('.dv-use');
  if (!b) return;
  useLcd(b.dataset.u);
});
async function useLcd(u){
  NET.lcd = u; store.set('fw:dev:lcd', u);
  $('#dv-host').textContent = u.replace(/^https?:\/\//, '');
  LAST = null;
  await readNode(); ping(); firstBlockTime(); balance(); faucetStatus(); mine();
}
$('#dv-ping').addEventListener('click', ping);
$('#dv-ep-add').addEventListener('click', async () => {
  const inp = $('#dv-ep-in');
  const u = inp.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(u)) { inp.classList.add('bad'); return; }
  inp.classList.remove('bad');
  try {
    const { j } = await api('/cosmos/base/tendermint/v1beta1/node_info', { base: u, ms: 8000 });
    const net = (j.default_node_info || {}).network;
    if (net === MAINNET) throw new Error('that node is mainnet (columbus-5): developer tools stay on test networks');
    store.set('fw:dev:eps', store.get('fw:dev:eps', []).concat([u]));
    inp.value = '';
    useLcd(u);
  } catch (e) { inp.classList.add('bad'); inp.title = e.message; ping(); }
});

/* ---------- balance, tracked CW20s, send ---------- */
let HELD = [];   // [{ id, name, raw, dec, cw20 }]
async function balance(){
  const a = addrOf();
  $('#dv-addr').innerHTML = esc(short(a)) + '<i></i>';
  if (!a) return;
  const box = $('#dv-coins');
  const held = [];
  try {
    const { j } = await api('/cosmos/bank/v1beta1/balances/' + a + '?pagination.limit=200');
    for (const c of j.balances || []) held.push({ id: c.denom, name: denomName(c.denom), raw: c.amount, dec: 6 });
  } catch (e) { box.innerHTML = '<div class="dv-err">' + esc(e.message) + '</div>'; }
  const cws = store.get('fw:dev:cw20:' + NET.chain, []);
  await Promise.all(cws.map(async c => {
    try {
      const { j } = await api('/cosmwasm/wasm/v1/contract/' + c.addr + '/smart/' + b64(JSON.stringify({ balance: { address: a } })));
      held.push({ id: c.addr, name: c.sym, raw: (j.data || {}).balance || '0', dec: c.dec, cw20: true });
    } catch (e) { held.push({ id: c.addr, name: c.sym, raw: null, dec: c.dec, cw20: true }); }
  }));
  HELD = held;
  const lunc = held.find(h => h.id === 'uluna');
  $('#dv-lunc').textContent = fmt(lunc ? Number(lunc.raw) / 1e6 : 0);
  TEST_LUNC = lunc ? lunc.raw : '0';
  testRow();
  box.innerHTML = held.length ? held.map(h => '<div><span>' + esc(h.name) + (h.cw20 ? ' <em>CW20</em>' : '') + '</span><span>' +
    (h.raw === null ? '?' : esc(fmt(Number(h.raw) / 10 ** h.dec))) + '</span></div>').join('')
    : '<div><span>No test coins yet: the faucet below sends some.</span><span></span></div>';
  const sel = $('#dv-denom'), keep = sel.value;
  sel.innerHTML = held.filter(h => h.raw !== '0' && h.raw !== null).map(h => '<option value="' + esc(h.id) + '">' + esc(h.name) + '</option>').join('') || '<option value="uluna">LUNC</option>';
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  avail();
}
function avail(){
  const h = HELD.find(x => x.id === $('#dv-denom').value);
  $('#dv-avail').textContent = h && h.raw !== null ? 'Available ' + fmt(Number(h.raw) / 10 ** h.dec) + ' ' + h.name : '';
}
$('#dv-denom').addEventListener('change', avail);
$('#dv-addr').addEventListener('click', e => copy(addrOf(), e.currentTarget));
$('#dv-copy').addEventListener('click', e => copy(addrOf(), e.currentTarget));
$('#dv-cw-add').addEventListener('click', async () => {
  const inp = $('#dv-cw-in');
  const c = inp.value.trim();
  try {
    if (!/^terra1[0-9a-z]{38,58}$/.test(c)) throw new Error('not a contract address');
    const { j } = await api('/cosmwasm/wasm/v1/contract/' + c + '/smart/' + b64('{"token_info":{}}'));
    const d = j.data || {};
    if (d.decimals == null) throw new Error('that contract did not answer token_info like a CW20');
    const list = store.get('fw:dev:cw20:' + NET.chain, []).filter(x => x.addr !== c);
    list.push({ addr: c, sym: String(d.symbol || 'CW20').slice(0, 16), dec: Number(d.decimals) });
    store.set('fw:dev:cw20:' + NET.chain, list);
    inp.value = ''; inp.classList.remove('bad');
    balance();
  } catch (e) { inp.classList.add('bad'); inp.title = e.message; }
});

// one send form for test coins, opened from the DEV tab and from Home's card
$('#dv-send-open').addEventListener('click', () => go('tsend'));

/* Test LUNC in Home's token list, when Developer mode is on and the address
   holds some on the test network. The row has no data-k, so tokens.js leaves
   it alone (it diffs only its own rows) and fav.js puts no star on it; the
   list is redrawn often, so it is put back whenever it goes. A tap opens the
   test send. */
let TEST_LUNC = '0';
const tokList = $('#tok-list');
function testRow(){
  if (!tokList) return;
  let li = tokList.querySelector('li.dv-trow');
  const show = devOn() && BigInt(TEST_LUNC || '0') > 0n;
  if (!show) { if (li) li.remove(); return; }
  if (!li) {
    li = document.createElement('li');
    li.className = 'row dv-trow';
    li.title = 'Send test coins';
    // the LUNC logo with a TEST mark on its corner
    li.innerHTML = '<span class="sym dv-tsym"><img src="assets/tokens/LUNC.png" alt=""><i>TEST</i></span><div class="row-main"><div class="row-name">LUNC</div>' +
      '<div class="row-amt"></div></div><div class="row-val"><div class="row-fiat">No value</div><div class="row-sub"></div></div>';
    li.addEventListener('click', e => { e.stopPropagation(); go('tsend'); });
  }
  li.querySelector('.row-amt').textContent = fmt(Number(TEST_LUNC) / 1e6) + ' · Test coins';
  li.querySelector('.row-sub').textContent = NET.chain;
  if (li.parentNode !== tokList || li !== tokList.lastElementChild) tokList.appendChild(li);
}
if (tokList) new MutationObserver(() => {
  const li = tokList.querySelector('li.dv-trow');
  if ((!li || li !== tokList.lastElementChild) && devOn() && BigInt(TEST_LUNC || '0') > 0n) testRow();
}).observe(tokList, { childList: true });
let SEND = null;
function sendMsg(){
  const to = $('#dv-to').value.trim();
  if (!/^terra1[0-9a-z]{38,58}$/.test(to)) throw new Error('the recipient is not a terra1 address');
  const h = HELD.find(x => x.id === $('#dv-denom').value) || { id: 'uluna', dec: 6 };
  const raw = toRaw($('#dv-amt').value, h.dec);
  if (!(BigInt(raw) > 0n)) throw new Error('the amount must be more than zero');
  if (h.cw20) return { kind: 'exec', contract: h.id, msg: JSON.stringify({ transfer: { recipient: to, amount: raw } }), funds: [] };
  return { kind: 'send', to: to, coins: [{ denom: h.id, amount: raw }] };
}
['#dv-to', '#dv-amt', '#dv-denom', '#dv-memo'].forEach(s => $(s).addEventListener('input', () => { SEND = null; $('#dv-send-go').disabled = true; }));
$('#dv-send-sim').addEventListener('click', async e => {
  const out = $('#dv-send-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    const m = sendMsg();
    const res = await dryRunDev(addrOf(), [m], S.MNEMONIC, NET, $('#dv-memo').value);
    SEND = { m: m, fee: res.gasFee, memo: $('#dv-memo').value };
    out.innerHTML = feeLine(res);
    $('#dv-send-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-send-go').addEventListener('click', async e => {
  if (!SEND) return;
  const out = $('#dv-send-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const r = await sendDev(addrOf(), [SEND.m], S.MNEMONIC, NET, SEND.fee, SEND.memo);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    SEND = null;
    await r.wait();
    out.insertAdjacentHTML('beforeend', '<div class="dv-okl">In block.</div>');
    balance();
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- faucet ---------- */
let FC = null;
async function faucetStatus(){
  const a = addrOf();
  const go_ = $('#dv-fc-go'), next = $('#dv-fc-next'), hold = $('#dv-fc-hold');
  try {
    const r = await fetch(FAUCET + '/status?address=' + encodeURIComponent(a));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    FC = j;
    if (j.chain && j.chain !== NET.chain) {
      go_.disabled = true;
      next.textContent = 'The faucet pays on ' + j.chain + '; this tab is on ' + NET.chain + '.';
      return;
    }
    const amt = fmt(Number(j.amount) / 1e6);
    go_.textContent = 'Get ' + amt + ' test LUNC';
    $('#dv-fc-txt').textContent = amt + ' test LUNC to this address, once every ' + Math.round(j.cooldown_h || 24) +
      ' hours. For building and testing; test coins have no value.';
    hold.textContent = 'Faucet holds ' + fmt(Number(j.balance) / 1e6) + ' LUNC';
    const wait = Number(j.next || 0) - Date.now();
    go_.disabled = wait > 0 || !j.open;
    next.textContent = !j.open ? (j.why || 'The faucet is resting.') : wait > 0 ? 'Next claim in ' + dur(wait) : 'Ready';
  } catch (e) {
    go_.disabled = true;
    next.textContent = 'The faucet is not reachable right now.';
    hold.textContent = '';
  }
}
function dur(ms){
  const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
  return (h ? h + ' h ' : '') + (m % 60) + ' m';
}
$('#dv-fc-go').addEventListener('click', async e => {
  const out = $('#dv-fc-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const r = await fetch(FAUCET + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addrOf() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    out.innerHTML = '<div class="dv-okl">On its way · ' + txLink(j.hash) + '</div>';
    setTimeout(() => { balance(); faucetStatus(); }, 7000);
  } catch (err) { bad(out, err); }
  busy(btn, false);
  faucetStatus();
});

/* ---------- a transaction by hash ---------- */
function msgView(m){
  const t = String(m['@type'] || '?');
  const name = t.split('.').pop();
  const body = Object.assign({}, m);
  delete body['@type'];
  // wasm messages arrive as objects already on recent nodes, as base64 on older ones
  for (const k of ['msg', 'init_msg', 'execute_msg']) {
    if (typeof body[k] === 'string') { try { body[k] = JSON.parse(atob(body[k])); } catch (e) {} }
  }
  if (body.wasm_byte_code) body.wasm_byte_code = '(' + Math.round(body.wasm_byte_code.length * 0.75 / 1024) + ' KB of wasm)';
  return '<details class="dv-msg" open><summary>' + esc(name) + '</summary>' + pre(body) + '</details>';
}
function evView(evs){
  if (!evs.length) return '';
  const rows = evs.map(e => '<details class="dv-ev"><summary>' + esc(e.type) + ' <small>' + (e.attributes || []).length + '</small></summary><div class="dv-attrs">' +
    (e.attributes || []).map(a => '<span>' + esc(a.key) + '</span><b>' + esc(a.value) + '</b>').join('') + '</div></details>').join('');
  return '<div class="dv-sub2">Events · ' + evs.length + '</div>' + rows;
}
async function lookup(hash){
  const out = $('#dv-tx-out');
  hash = String(hash || '').trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hash)) { bad(out, 'a transaction hash is 64 hex characters'); return; }
  out.innerHTML = '<div class="dv-wait">Reading…</div>';
  try {
    const { j } = await api('/cosmos/tx/v1beta1/txs/' + hash);
    const r = j.tx_response || {}, tx = j.tx || {};
    const fee = ((tx.auth_info || {}).fee || {}).amount || [];
    const head = '<div class="dv-txh"><span class="' + (r.code ? 'dv-bad' : 'dv-good') + '">● ' + (r.code ? 'Failed · code ' + esc(r.code) : 'Success') + '</span><span>height ' +
      esc(Number(r.height).toLocaleString()) + ' · ' + esc(new Date(r.timestamp).toLocaleString()) + '</span></div>' +
      '<div class="dv-kv"><span>Gas used / wanted</span><b>' + esc(Number(r.gas_used).toLocaleString() + ' / ' + Number(r.gas_wanted).toLocaleString()) + '</b>' +
      '<span>Fee</span><b>' + esc(fee.map(c => fmt(Number(c.amount) / 1e6) + ' ' + denomName(c.denom)).join(', ') || '0') + '</b>' +
      (((tx.body || {}).memo) ? '<span>Memo</span><b>' + esc(tx.body.memo) + '</b>' : '') + '</div>';
    const fail = r.code ? '<div class="dv-err">' + esc(r.raw_log || '') + '</div>' : '';
    const msgs = ((tx.body || {}).messages || []).map(msgView).join('');
    const evs = r.events || [];
    out.innerHTML = head + fail + msgs + evView(evs) + '<a class="dv-link" href="' + esc(finder('tx', hash)) + '" target="_blank" rel="noopener">Open in Finder</a>';
  } catch (e) { bad(out, e.status === 404 ? 'not found on ' + NET.chain + ' (yet: a new transaction takes a block)' : e); }
}
$('#dv-tx-go').addEventListener('click', () => lookup($('#dv-tx-in').value));
$('#dv-tx-in').addEventListener('keydown', e => { if (e.key === 'Enter') lookup($('#dv-tx-in').value); });

/* ---------- contracts ---------- */
$$('.dv-tabs button').forEach(b => b.addEventListener('click', () => {
  $$('.dv-tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['q', 'x', 'u'].forEach(k => { $('#dv-p-' + k).hidden = k !== b.dataset.dv; });
}));
const contractOk = c => /^terra1[0-9a-z]{38,58}$/.test(c);
function setContract(c){
  $('#dv-q-addr').value = c; $('#dv-x-addr').value = c;
  store.set('fw:dev:contract', c);
}
setContract(store.get('fw:dev:contract', ''));
['#dv-q-addr', '#dv-x-addr'].forEach(s => $(s).addEventListener('change', e => setContract(e.target.value.trim())));

$('#dv-q-go').addEventListener('click', async e => {
  const out = $('#dv-q-out'), btn = e.currentTarget;
  const c = $('#dv-q-addr').value.trim();
  busy(btn, true);
  try {
    if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
    const q = minify(ED.q.get(), 'the query');
    const { j, ms } = await api('/cosmwasm/wasm/v1/contract/' + c + '/smart/' + encodeURIComponent(b64(q)));
    out.innerHTML = '<div class="dv-sub2">Result · ' + ms + ' ms <button class="dv-mini-b" type="button" data-copy>copy</button></div>' + pre(j.data);
    out.querySelector('[data-copy]').onclick = ev => copy(JSON.stringify(j.data, null, 2), ev.currentTarget);
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-q-info').addEventListener('click', async e => {
  const out = $('#dv-q-out'), btn = e.currentTarget;
  const c = $('#dv-q-addr').value.trim();
  busy(btn, true);
  try {
    if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
    const { j } = await api('/cosmwasm/wasm/v1/contract/' + c);
    out.innerHTML = '<div class="dv-sub2">Contract info</div>' + pre(j.contract_info || j);
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

let EXEC = null;
['#dv-x-addr', '#dv-x-msg', '#dv-x-funds', '#dv-x-memo'].forEach(s => $(s).addEventListener('input', () => { EXEC = null; $('#dv-x-go').disabled = true; }));
$('#dv-x-sim').addEventListener('click', async e => {
  const out = $('#dv-x-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    const c = $('#dv-x-addr').value.trim();
    if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
    const m = { kind: 'exec', contract: c, msg: minify(ED.x.get(), 'the message'), funds: coinsOf($('#dv-x-funds').value) };
    const memo = $('#dv-x-memo').value;
    const res = await dryRunDev(addrOf(), [m], S.MNEMONIC, NET, memo);
    EXEC = { m: m, fee: res.gasFee, memo: memo };
    out.innerHTML = feeLine(res);
    $('#dv-x-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-x-go').addEventListener('click', async e => {
  if (!EXEC) return;
  const out = $('#dv-x-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const r = await sendDev(addrOf(), [EXEC.m], S.MNEMONIC, NET, EXEC.fee, EXEC.memo);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    EXEC = null; $('#dv-x-go').disabled = true;
    const res = await r.wait();
    if (res) {
      const wasm = (res.events || []).filter(ev => ev.type === 'wasm' || /^wasm-/.test(ev.type));
      out.insertAdjacentHTML('beforeend', '<div class="dv-okl">In block ' + esc(Number(res.height).toLocaleString()) + ' · ' +
        esc(Number(res.gas_used).toLocaleString()) + ' gas used</div>' + evView(wasm));
    }
    balance();
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- upload and instantiate ---------- */
let WASM = null, STORE = null, INST = null;
async function gzip(bytes){
  if (typeof CompressionStream === 'undefined') return bytes;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const size = n => n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
async function takeWasm(file){
  const meta = $('#dv-wasm-meta'), name = $('#dv-wasm-name');
  STORE = null; $('#dv-s1-go').disabled = true;
  try {
    if (!file) return;
    const raw = new Uint8Array(await file.arrayBuffer());
    if (!(raw[0] === 0 && raw[1] === 0x61 && raw[2] === 0x73 && raw[3] === 0x6d)) throw new Error('that file is not WebAssembly');
    const sum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), x => x.toString(16).padStart(2, '0')).join('');
    const gz = await gzip(raw);
    WASM = { bytes: gz, size: raw.length, sum: sum };
    name.textContent = file.name;
    meta.textContent = size(raw.length) + ' · sends ' + size(gz.length) + ' compressed · sha256 ' + sum.slice(0, 8) + '…' + sum.slice(-6);
    $('#dv-s1-sim').disabled = false;
    $('#dv-s1-nb').className = 'dv-nb';
    $('#dv-s1-txt').textContent = 'Ready to upload. Check the fee first.';
  } catch (e) { WASM = null; meta.textContent = e.message; $('#dv-s1-sim').disabled = true; }
}
$('#dv-wasm').addEventListener('change', e => takeWasm(e.target.files[0]));
const zone = $('#dv-zone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('over'));
zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); takeWasm(e.dataTransfer.files[0]); });

$('#dv-s1-sim').addEventListener('click', async e => {
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    if (!WASM) throw new Error('choose a .wasm file first');
    const res = await dryRunDev(addrOf(), [{ kind: 'store', wasm: WASM.bytes }], S.MNEMONIC, NET);
    STORE = { fee: res.gasFee };
    $('#dv-s1-txt').textContent = 'Fee ' + fmt(res.gasFee / 1e6) + ' test LUNC · ' + res.gas.toLocaleString() + ' gas';
    $('#dv-s1-go').disabled = false;
    out.innerHTML = '';
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-s1-go').addEventListener('click', async e => {
  if (!STORE || !WASM) return;
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const r = await sendDev(addrOf(), [{ kind: 'store', wasm: WASM.bytes }], S.MNEMONIC, NET, STORE.fee);
    STORE = null;
    $('#dv-s1-txt').innerHTML = 'Uploading · ' + txLink(r.hash);
    const res = await r.wait();
    const code = res && attr(res, 'store_code', 'code_id');
    if (!code) throw new Error('stored, but the code id was not in the events: look the transaction up below');
    $('#dv-s1-nb').className = 'dv-nb ok';
    $('#dv-s1-txt').innerHTML = 'Code id <b>' + esc(code) + '</b> · ' + txLink(r.hash);
    $('#dv-i-code').value = code;
    const codes = store.get('fw:dev:codes:' + NET.chain + ':' + addrOf(), []);
    codes.unshift({ code: code, sum: WASM.sum, at: Date.now(), tx: r.hash });
    store.set('fw:dev:codes:' + NET.chain + ':' + addrOf(), codes.slice(0, 50));
    balance();
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

const adminBox = $('#dv-i-admin'), noAdmin = $('#dv-i-noadmin');
noAdmin.addEventListener('change', () => { adminBox.disabled = noAdmin.checked; INST = null; $('#dv-i-go').disabled = true; });
['#dv-i-code', '#dv-i-label', '#dv-i-msg', '#dv-i-admin', '#dv-i-funds'].forEach(s => $(s).addEventListener('input', () => { INST = null; $('#dv-i-go').disabled = true; }));
function instMsg(){
  const code = $('#dv-i-code').value.trim();
  const admin = noAdmin.checked ? '' : (adminBox.value.trim() || addrOf());
  if (admin && !/^terra1[0-9a-z]{38,58}$/.test(admin)) throw new Error('the admin is not a terra1 address');
  return { kind: 'inst', code: code, label: $('#dv-i-label').value.trim(), admin: admin,
           msg: minify(ED.i.get() || '{}', 'the init message'), funds: coinsOf($('#dv-i-funds').value) };
}
$('#dv-i-sim').addEventListener('click', async e => {
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    const m = instMsg();
    const res = await dryRunDev(addrOf(), [m], S.MNEMONIC, NET);
    INST = { m: m, fee: res.gasFee };
    out.innerHTML = feeLine(res);
    $('#dv-i-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-i-go').addEventListener('click', async e => {
  if (!INST) return;
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const m = INST.m;
    const r = await sendDev(addrOf(), [m], S.MNEMONIC, NET, INST.fee);
    INST = null; $('#dv-i-go').disabled = true;
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    const res = await r.wait();
    const c = res && attr(res, 'instantiate', '_contract_address');
    if (!c) throw new Error('made, but the address was not in the events: look the transaction up');
    $('#dv-s2-nb').className = 'dv-nb ok';
    $('#dv-s2-txt').innerHTML = 'Contract <b>' + esc(short(c)) + '</b>';
    out.innerHTML = '<div class="dv-okl">Contract made · ' + txLink(r.hash) + '</div><div class="dv-made"><b>' + esc(c) + '</b><button class="dv-mini-b" type="button" data-c>copy</button><button class="dv-mini-b" type="button" data-use>query it</button></div>';
    out.querySelector('[data-c]').onclick = ev => copy(c, ev.currentTarget);
    out.querySelector('[data-use]').onclick = () => { setContract(c); $('.dv-tabs button[data-dv="q"]').click(); };
    const list = store.get('fw:dev:mine:' + NET.chain + ':' + addrOf(), []);
    list.unshift({ addr: c, code: m.code, label: m.label, admin: m.admin, at: Date.now(), tx: r.hash });
    store.set('fw:dev:mine:' + NET.chain + ':' + addrOf(), list.slice(0, 100));
    setContract(c);
    mine();
    balance();
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- the contracts made from this wallet ----------
   Kept in this browser as they are made, and filled in from the node where it
   can list contracts by creator (wasmd 0.40 and later). */
async function mine(){
  const a = addrOf();
  const box = $('#dv-mine');
  const list = store.get('fw:dev:mine:' + NET.chain + ':' + a, []);
  try {
    const { j } = await api('/cosmwasm/wasm/v1/contracts/creator/' + a + '?pagination.limit=100', { ms: 8000 });
    for (const c of j.contract_addresses || []) if (!list.some(x => x.addr === c)) list.push({ addr: c });
  } catch (e) { /* older wasmd: only what this browser saw */ }
  $('#dv-mine-n').textContent = list.length || '';
  $('#dv-mine-list').innerHTML = list.map(c => '<option value="' + esc(c.addr) + '">' + esc(c.label || '') + '</option>').join('');
  box.innerHTML = list.length ? list.map(c => '<div class="dv-crow"><span class="dv-id">' + (c.code ? '#' + esc(c.code) : '') + '</span><span><b>' +
    esc(c.label || short(c.addr)) + '</b><small>' + esc(short(c.addr)) + (c.admin === '' ? ' · no admin' : c.admin ? ' · admin ' + esc(short(c.admin)) : '') +
    (c.at ? ' · ' + esc(new Date(c.at).toLocaleDateString()) : '') + '</small></span><button class="dv-hx sm" type="button" data-use="' + esc(c.addr) + '">Use</button></div>').join('')
    : '<p class="dv-note pad">Contracts you make here show up in this list.</p>';
}
$('#dv-mine').addEventListener('click', e => {
  const b = e.target.closest('[data-use]');
  if (!b) return;
  setContract(b.dataset.use);
  $('.dv-tabs button[data-dv="q"]').click();
  $('#dv-q-addr').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ---------- on screen ----------
   Read when the tab comes on (after the move onto it), the block height every
   six seconds while it stays on and the page is visible. */
let opened = '';
function onShow(){
  $('#dv-host').textContent = NET.lcd.replace(/^https?:\/\//, '');
  const key = addrOf() + '|' + NET.lcd;
  if (opened !== key) { opened = key; readNode().then(() => { ping(); firstBlockTime(); balance(); faucetStatus(); mine(); }); }
  else { balance(); faucetStatus(); }
  clearInterval(LIVE);
  LIVE = setInterval(() => { if (!document.hidden && $('#st-dev').classList.contains('on')) tick(); else clearInterval(LIVE); }, 6000);
}
function whenOn(el, fn){
  new MutationObserver(() => {
    const on = el.classList.contains('on');
    if (on && !el._was) setTimeout(fn, 300);
    el._was = on;
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
}
whenOn($('#st-dev'), onShow);
// Home's card and the send form read the test balance as they come on
whenOn($('#st-home'), () => { if (devOn()) balance(); });
whenOn($('#st-tsend'), () => { $('#dv-send-out').innerHTML = ''; balance(); });
