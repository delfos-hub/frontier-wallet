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
import { esc, fmt } from './chain.js?v=25c1ceeb';
import { $, $$, go } from './shell.js?v=25c1ceeb';
import { S } from './state.js?v=25c1ceeb';
import { DEV_URLS, dryRunDev, sendDev, toRaw } from './tx.js?v=25c1ceeb';
import { blockLine, checks } from './devcheck.js?v=25c1ceeb';

const MAINNET = 'columbus-5';

const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const short = a => a && a.length > 20 ? a.slice(0, 12) + '…' + a.slice(-6) : (a || '');
/* Network profiles: what a developer sets for each test network they use
   (Settings in this tab). The chain id is never typed: it is read from the
   node, and columbus-5 is refused (here and in tx.js). Gas price and
   adjustment are bounded again in tx.js (devGas). */
const DEFAULT_PROFILE = {
  id: 'rebel-2', name: 'rebel-2 (public)', lcd: 'https://lcd.luncblaze.com',
  gasPrice: 28.325, gasAdjust: 1.3,
  explorer: 'https://finder.terraclassic.community/{chain}/tx/{hash}',
  faucet: 'https://frontier-faucet.delfoshub-team.workers.dev'
};
const DEFAULT_LCD = DEFAULT_PROFILE.lcd;
let PROFILES = store.get('fw:dev:profiles', null) ||
  [Object.assign({}, DEFAULT_PROFILE, { lcd: store.get('fw:dev:lcd', DEFAULT_LCD) })];
let P = PROFILES.find(x => x.id === store.get('fw:dev:profile', '')) || PROFILES[0];
const NET = { chain: 'rebel-2', lcd: P.lcd, gasPrice: P.gasPrice, gasAdjust: P.gasAdjust };
function saveProfiles(){ store.set('fw:dev:profiles', PROFILES); store.set('fw:dev:profile', P.id); }
const enc = new TextEncoder();
const b64 = s => { const b = enc.encode(s); let t = ''; for (let i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t); };
const finder = (kind, id) => (P.explorer || DEFAULT_PROFILE.explorer).split('{chain}').join(encodeURIComponent(NET.chain)).split('{hash}').join(encodeURIComponent(id));

/* ---------- Developer mode ---------- */
const devOn = () => store.get('fw:dev', false) === true;
function applyMode(){
  const on = devOn();
  const t = $('#tabs .tab[data-tab="dev"]');
  if (t) t.hidden = !on;
  // test LUNC in Home's token list: with Developer mode only, never in the total
  if (on) setTimeout(() => balance(), 0); else setTimeout(testRow, 0);
  $('#dev-sw').setAttribute('aria-checked', on ? 'true' : 'false');
  $('#set-dev').classList.toggle('on', on);
  $('#dev-cur').textContent = on ? 'On \u00b7 rebel-2 test network' : 'Test network, faucet, contract tools';
  $('#dev-open').hidden = !on;
  if (!on && ($('#st-dev').classList.contains('on') || $('#st-tsend').classList.contains('on'))) go('settings');
}
/* The switch in Settings. Turning it on first says what changes, and asks;
   once on, the TEST section shows in the menu (briefly lit, so it is found)
   and a row under the switch opens it. Nothing moves you away from Settings.
   Turning it off needs no question: it only hides the section again. */
const ask = $('#dev-ask');
function askOpen(v){
  ask.hidden = !v;
  $('#set-dev').classList.toggle('asking', v);
  if (v) { $('#dev-sw').setAttribute('aria-checked', 'mixed'); $('#dev-yes').focus({ preventScroll: true });
    requestAnimationFrame(() => ask.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); }
  else applyMode();
}
function devToggle(){
  if (!ask.hidden) { askOpen(false); return; }
  if (devOn()) { store.set('fw:dev', false); applyMode(); return; }
  askOpen(true);
}
$('#set-dev').addEventListener('click', devToggle);
$('#dev-no').addEventListener('click', () => { askOpen(false); $('#dev-sw').focus({ preventScroll: true }); });
$('#dev-yes').addEventListener('click', () => {
  store.set('fw:dev', true);
  askOpen(false);
  const t = $('#tabs .tab[data-tab="dev"]');
  if (t) { t.classList.remove('dv-new'); void t.offsetWidth; t.classList.add('dv-new'); setTimeout(() => t.classList.remove('dv-new'), 2600); }
  const o = $('#dev-open'); o.classList.add('dv-new'); setTimeout(() => o.classList.remove('dv-new'), 2600);
  $('#dev-sw').focus({ preventScroll: true });
});
ask.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('#dev-no').click(); } });
$('#dev-open').addEventListener('click', () => go('dev'));
// leaving Settings with the question open answers it with Cancel
new MutationObserver(() => { if (!ask.hidden && !$('#st-settings').classList.contains('on')) askOpen(false); })
  .observe($('#st-settings'), { attributes: true, attributeFilter: ['class'] });
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
  if (!String(text || '').trim()) throw new Error(what + ' is empty: write the JSON to send (the grey text is only an example)');
  try { return JSON.parse(text); }
  catch (e) { throw new Error(what + ' is not valid JSON: ' + e.message); }
}
const minify = (text, what) => JSON.stringify(parseJSON(text, what));
function needKey(){
  if (!S.MNEMONIC) throw new Error('this wallet is watch-only here: unlock a wallet with its phrase to sign');
}
// the messages as a developer reads them, for "what will be signed"
function readable(m){
  const o = { '@type': DEV_URLS[m.kind] || m.kind };
  if (m.kind === 'send') { o.to_address = m.to; o.amount = m.coins; }
  if (m.kind === 'exec') { o.contract = m.contract; o.msg = JSON.parse(m.msg); o.funds = m.funds || []; }
  if (m.kind === 'store') o.wasm_byte_code = m.wasm.length + ' bytes, gzip';
  if (m.kind === 'inst') { o.admin = m.admin; o.code_id = String(m.code); o.label = m.label; o.msg = JSON.parse(m.msg); o.funds = m.funds || []; }
  if (m.kind === 'migrate') { o.contract = m.contract; o.code_id = String(m.code); o.msg = JSON.parse(m.msg); }
  if (m.kind === 'admin') { o.contract = m.contract; o.new_admin = m.admin; }
  if (m.kind === 'clearadmin') o.contract = m.contract;
  return o;
}
// a fee line, and under it everything that will be signed
function feeLine(res, msgs){
  const doc = Object.assign({}, res.signDoc || {}, { msgs: (msgs || []).map(readable) });
  return '<div class="dv-fee"><span>Network fee</span><b>' + fmt(res.gasFee / 1e6) + ' LUNC</b><small>' +
    res.gas.toLocaleString() + ' gas · test coins</small></div>' +
    '<details class="dv-signed"><summary>What will be signed</summary>' + pre(doc) + '</details>';
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
  // The example starts as real text, ready to edit or run. Cleared, the
  // editor shows it greyed out again - and what is shown is what runs, so
  // Run on a blank editor sends the example rather than failing on "".
  // Only the query editor runs its example when blank: a query reads, nothing
  // is signed. Execute, Instantiate and Migrate sign what they send, so a
  // blank one is an error there, never the example (#79 review).
  const example = ta.getAttribute('placeholder') || '';
  const runsExample = id === 'dv-q-msg';
  ta.value = (key && store.get(key, '')) || example;
  draw();
  return { set(v){ ta.value = v; draw(); }, get: () => ta.value.trim() ? ta.value : (runsExample ? example : '') };
}
const ED = {
  q: editor('dv-q-msg', 'fw:dev:q'),
  x: editor('dv-x-msg', 'fw:dev:x'),
  i: editor('dv-i-msg', 'fw:dev:i'),
  m: editor('dv-a-msg', 'fw:dev:m')
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
  dropChecks();
  NET.lcd = u; P.lcd = u; saveProfiles();
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
   it alone (it diffs only its own rows) and fav.js puts no star on it. It
   sits first; the list is redrawn often and moves its own rows to the top,
   so the row is put back first whenever it is not. A tap opens the
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
  // first in the list, where it is found at a glance
  if (li !== tokList.firstElementChild) tokList.insertBefore(li, tokList.firstElementChild);
}
if (tokList) new MutationObserver(() => {
  const li = tokList.querySelector('li.dv-trow');
  if ((!li || li !== tokList.firstElementChild) && devOn() && BigInt(TEST_LUNC || '0') > 0n) testRow();
}).observe(tokList, { childList: true });
/* Every check is bound to the wallet and the network it ran for (devcheck.js);
   a switch of either drops them all (#76 review). */
const CHK = checks(() => ({ addr: addrOf(), net: NET }));
const bound = CHK.bound, fresh = CHK.fresh;
const simulate = (msgs, memo) => CHK.simulate((from, net) => dryRunDev(from, msgs, S.MNEMONIC, net, memo));
const GO = ['#dv-send-go', '#dv-x-go', '#dv-s1-go', '#dv-i-go', '#dv-a-go'];
const OUTS = ['#dv-send-out', '#dv-x-out', '#dv-u-out', '#dv-a-out'];
function dropChecks(){
  const had = SEND || EXEC || STORE || INST || ADM;
  SEND = null; EXEC = null; STORE = null; INST = null; ADM = null;
  GO.forEach(sel => { const b = $(sel); if (b) b.disabled = true; });
  if (had) OUTS.forEach(sel => { const o = $(sel); if (o && o.querySelector('.dv-fee')) o.innerHTML = '<div class="dv-note">The wallet or the network changed: check again before signing.</div>'; });
  const t = $('#dv-s1-txt'); if (t && /^Fee /.test(t.textContent)) t.textContent = 'Check the fee again: the wallet or the network changed';
}
document.addEventListener('frontier:wallet', dropChecks);
document.addEventListener('frontier:locked', dropChecks);
// A sent transaction that the node has not shown in a block yet: the hash
// stays, and the screen says it is still pending rather than "in block".
function pending(out, hash){
  out.insertAdjacentHTML('beforeend', '<div class="dv-note">' + blockLine(null, txLink(hash)).html + '</div>');
}
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
    const memo = $('#dv-memo').value;
    const res = await simulate([m], memo);
    SEND = bound({ m: m, fee: res.gasFee, memo: memo });
    out.innerHTML = feeLine(res, [m]);
    $('#dv-send-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-send-go').addEventListener('click', async e => {
  if (!SEND) return;
  const out = $('#dv-send-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const P0 = fresh(SEND);
    SEND = null; $('#dv-send-go').disabled = true;
    const r = await sendDev(P0.from, [P0.m], S.MNEMONIC, P0.net, P0.fee, P0.memo);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    const res = await r.wait();
    const line = blockLine(res, txLink(r.hash));
    out.insertAdjacentHTML('beforeend', '<div class="' + (line.ok ? 'dv-okl' : 'dv-note') + '">' + line.html + '</div>');
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
    if (!P.faucet) { go_.disabled = true; next.textContent = 'No faucet is set for this network (Settings).'; hold.textContent = ''; return; }
    const r = await fetch(P.faucet + '/status?address=' + encodeURIComponent(a));
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
    const r = await fetch(P.faucet + '/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addrOf() }) });
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
  ['q', 'x', 'u', 'a'].forEach(k => { $('#dv-p-' + k).hidden = k !== b.dataset.dv; });
}));
const contractOk = c => /^terra1[0-9a-z]{38,58}$/.test(c);
function setContract(c){
  $('#dv-q-addr').value = c; $('#dv-x-addr').value = c; $('#dv-a-addr').value = c;
  store.set('fw:dev:contract', c);
}
setContract(store.get('fw:dev:contract', ''));
['#dv-q-addr', '#dv-x-addr', '#dv-a-addr'].forEach(s => $(s).addEventListener('change', e => { setContract(e.target.value.trim()); drawTools(); }));

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
    const res = await simulate([m], memo);
    EXEC = bound({ m: m, fee: res.gasFee, memo: memo });
    out.innerHTML = feeLine(res, [m]);
    $('#dv-x-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-x-go').addEventListener('click', async e => {
  if (!EXEC) return;
  const out = $('#dv-x-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const P0 = fresh(EXEC);
    EXEC = null; $('#dv-x-go').disabled = true;
    const r = await sendDev(P0.from, [P0.m], S.MNEMONIC, P0.net, P0.fee, P0.memo);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    const res = await r.wait();
    if (!res) pending(out, r.hash);
    else {
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
    const res = await simulate([{ kind: 'store', wasm: WASM.bytes }]);
    STORE = bound({ fee: res.gasFee, wasm: WASM });
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
    const P0 = fresh(STORE);
    if (P0.wasm !== WASM) throw new Error('another file was chosen since the check: check again');
    STORE = null; $('#dv-s1-go').disabled = true;
    const r = await sendDev(P0.from, [{ kind: 'store', wasm: P0.wasm.bytes }], S.MNEMONIC, P0.net, P0.fee);
    $('#dv-s1-txt').innerHTML = 'Uploading · ' + txLink(r.hash);
    const res = await r.wait();
    if (!res) { $('#dv-s1-txt').innerHTML = 'Confirmation pending · ' + txLink(r.hash); pending(out, r.hash); busy(btn, false); return; }
    const code = attr(res, 'store_code', 'code_id');
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
           msg: minify(ED.i.get(), 'the init message'), funds: coinsOf($('#dv-i-funds').value) };
}
$('#dv-i-sim').addEventListener('click', async e => {
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    const m = instMsg();
    const res = await simulate([m]);
    INST = bound({ m: m, fee: res.gasFee });
    out.innerHTML = feeLine(res, [m]);
    $('#dv-i-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-i-go').addEventListener('click', async e => {
  if (!INST) return;
  const out = $('#dv-u-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const P0 = fresh(INST), m = P0.m;
    INST = null; $('#dv-i-go').disabled = true;
    const r = await sendDev(P0.from, [m], S.MNEMONIC, P0.net, P0.fee);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    const res = await r.wait();
    if (!res) { pending(out, r.hash); busy(btn, false); return; }
    const c = attr(res, 'instantiate', '_contract_address');
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

/* ---------- templates, saved messages, format ----------
   Above every JSON editor. Templates are the usual CW20 / CW721 messages with
   this wallet's address filled in; saved messages are the developer's own,
   named, per editor and per contract (or for any contract), kept here and in
   the settings export. */
const ME = () => addrOf() || 'terra1…';
const TEMPLATES = {
  q: [
    ['CW20 · balance', () => ({ balance: { address: ME() } })],
    ['CW20 · token_info', () => ({ token_info: {} })],
    ['CW20 · allowance', () => ({ allowance: { owner: ME(), spender: 'terra1…' } })],
    ['CW20 · all_accounts', () => ({ all_accounts: { limit: 30 } })],
    ['CW20 · minter', () => ({ minter: {} })],
    ['CW721 · num_tokens', () => ({ num_tokens: {} })],
    ['CW721 · tokens of mine', () => ({ tokens: { owner: ME(), limit: 30 } })],
    ['CW721 · owner_of', () => ({ owner_of: { token_id: '1' } })],
    ['CW721 · nft_info', () => ({ nft_info: { token_id: '1' } })],
    ['config', () => ({ config: {} })],
    ['state', () => ({ state: {} })]
  ],
  x: [
    ['CW20 · transfer', () => ({ transfer: { recipient: ME(), amount: '1000000' } })],
    ['CW20 · send to a contract', () => ({ send: { contract: 'terra1…', amount: '1000000', msg: '' } })],
    ['CW20 · increase_allowance', () => ({ increase_allowance: { spender: 'terra1…', amount: '1000000' } })],
    ['CW20 · mint', () => ({ mint: { recipient: ME(), amount: '1000000' } })],
    ['CW20 · burn', () => ({ burn: { amount: '1000000' } })],
    ['CW721 · mint', () => ({ mint: { token_id: '1', owner: ME(), token_uri: null, extension: {} } })],
    ['CW721 · transfer_nft', () => ({ transfer_nft: { recipient: ME(), token_id: '1' } })],
    ['CW721 · approve', () => ({ approve: { spender: 'terra1…', token_id: '1' } })]
  ],
  i: [
    ['CW20 base', () => ({ name: 'Test Token', symbol: 'TEST', decimals: 6,
      initial_balances: [{ address: ME(), amount: '1000000000000' }], mint: { minter: ME() } })],
    ['CW721 base', () => ({ name: 'Test NFT', symbol: 'TNFT', minter: ME() })],
    ['empty', () => ({})]
  ],
  m: [['empty', () => ({})]]
};
const EDIT_OF = { q: 'q', x: 'x', i: 'i', m: 'm' };
const contractFor = ed => ed === 'q' ? $('#dv-q-addr').value.trim() : ed === 'x' ? $('#dv-x-addr').value.trim() : ed === 'm' ? $('#dv-a-addr').value.trim() : '';
const SAVED = () => store.get('fw:dev:saved', []);
// Built once; after that only the saved list is redrawn. Rebuilding the whole
// bar when the contract field changed (its change fires on blur) replaced the
// button under a click that had already started, and the click was lost.
function savedOptions(ed, c){
  const mine = SAVED().map((x, i) => Object.assign({ i: i }, x)).filter(x => x.ed === ed && (!x.contract || x.contract === c));
  return '<option value="">' + (mine.length ? 'Saved · ' + mine.length : 'Saved: none yet') + '</option>' +
    mine.map(x => '<option value="' + x.i + '">' + esc(x.name) + (x.contract ? '' : ' · any contract') + '</option>').join('');
}
function drawTools(){
  $$('.dv-tools').forEach(bar => {
    const ed = bar.dataset.ed, c = contractFor(ed);
    if (bar.firstChild) {
      bar.querySelector('.dv-sv').innerHTML = savedOptions(ed, c);
      bar.querySelector('[data-del]').hidden = true;
      const only = bar.querySelector('.dv-savebox input[type=checkbox]');
      only.disabled = !c; if (!c) only.checked = false;
      return;
    }
    bar.innerHTML =
      '<select class="dv-tpl" aria-label="Templates"><option value="">Templates</option>' +
        TEMPLATES[ed].map((t, i) => '<option value="' + i + '">' + esc(t[0]) + '</option>').join('') + '</select>' +
      '<select class="dv-sv" aria-label="Saved">' + savedOptions(ed, c) + '</select>' +
      '<button class="dv-mini-b" type="button" data-fmt>Format</button>' +
      '<button class="dv-mini-b" type="button" data-save>Save</button>' +
      '<button class="dv-mini-b" type="button" data-del hidden>Delete</button>' +
      '<span class="dv-savebox" hidden><input placeholder="Name" maxlength="40"><label><input type="checkbox"' + (c ? '' : ' disabled') + '> this contract only</label><button class="dv-mini-b" type="button" data-ok>Save</button></span>';
  });
}
document.addEventListener('change', e => {
  const bar = e.target.closest('.dv-tools');
  if (!bar) return;
  const ed = bar.dataset.ed;
  if (e.target.classList.contains('dv-tpl') && e.target.value !== '') {
    ED[EDIT_OF[ed]].set(JSON.stringify(TEMPLATES[ed][Number(e.target.value)][1](), null, 2));
    e.target.value = '';
  }
  if (e.target.classList.contains('dv-sv')) {
    const x = SAVED()[Number(e.target.value)];
    bar.querySelector('[data-del]').hidden = !x;
    if (x) ED[EDIT_OF[ed]].set(x.msg);
  }
});
document.addEventListener('click', e => {
  const bar = e.target.closest('.dv-tools');
  if (!bar) return;
  const ed = bar.dataset.ed, E = ED[EDIT_OF[ed]];
  if (e.target.matches('[data-fmt]')) {
    try { E.set(JSON.stringify(JSON.parse(E.get()), null, 2)); } catch (err) { bar.classList.add('bad'); setTimeout(() => bar.classList.remove('bad'), 900); }
  }
  if (e.target.matches('[data-save]')) { const box = bar.querySelector('.dv-savebox'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input').focus(); }
  if (e.target.matches('[data-ok]')) {
    const box = bar.querySelector('.dv-savebox'), name = box.querySelector('input').value.trim();
    try { JSON.parse(E.get()); } catch (err) { box.querySelector('input').placeholder = 'Not valid JSON'; return; }
    if (!name) { box.querySelector('input').focus(); return; }
    const only = box.querySelector('input[type=checkbox]').checked;
    const list = SAVED();
    list.push({ ed: ed, name: name, msg: E.get(), contract: only ? contractFor(ed) : '' });
    store.set('fw:dev:saved', list.slice(-200));
    box.hidden = true; box.querySelector('input').value = '';
    drawTools();
  }
  if (e.target.matches('[data-del]')) {
    const i = Number(bar.querySelector('.dv-sv').value);
    const list = SAVED(); list.splice(i, 1); store.set('fw:dev:saved', list);
    drawTools();
  }
});
drawTools();

/* ---------- contract history and raw state ---------- */
const hexOf = b64s => { try { return Array.from(atob(b64s), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); } catch (e) { return b64s; } };
function textOrHex(b64s){
  try {
    const t = decodeURIComponent(escape(atob(b64s)));
    if (/^[\x20-\x7e]*$/.test(t)) return t;
  } catch (e) {}
  return '0x' + hexOf(b64s);
}
function valueOf(b64s){
  try { const t = decodeURIComponent(escape(atob(b64s))); try { return JSON.parse(t); } catch (e) { return t; } }
  catch (e) { return '0x' + hexOf(b64s); }
}
$('#dv-q-hist').addEventListener('click', async e => {
  const out = $('#dv-q-out'), btn = e.currentTarget, c = $('#dv-q-addr').value.trim();
  busy(btn, true);
  try {
    if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
    const { j } = await api('/cosmwasm/wasm/v1/contract/' + c + '/history');
    const rows = (j.entries || []).map(x => ({ operation: String(x.operation || '').replace('CONTRACT_CODE_HISTORY_OPERATION_TYPE_', '').toLowerCase(),
      code_id: x.code_id, height: x.updated && x.updated.block_height, msg: x.msg }));
    out.innerHTML = '<div class="dv-sub2">Code history · ' + rows.length + '</div>' + pre(rows);
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-q-state').addEventListener('click', async e => {
  const out = $('#dv-q-out'), btn = e.currentTarget, c = $('#dv-q-addr').value.trim();
  busy(btn, true);
  try {
    if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
    const { j } = await api('/cosmwasm/wasm/v1/contract/' + c + '/state?pagination.limit=50');
    const rows = (j.models || []).map(x => ({ key: textOrHex(x.key), value: valueOf(x.value) }));
    const more = j.pagination && j.pagination.next_key ? ' · first 50' : '';
    out.innerHTML = '<div class="dv-sub2">Raw state · ' + rows.length + more + '</div>' + pre(rows);
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- is this file the code on chain? ----------
   The chain keeps the sha256 of the uncompressed wasm (code_info.data_hash). */
$('#dv-v-go').addEventListener('click', async e => {
  const out = $('#dv-v-out'), btn = e.currentTarget, id = $('#dv-v-code').value.trim();
  busy(btn, true);
  try {
    if (!WASM) throw new Error('choose a .wasm file first');
    if (!/^[1-9]\d*$/.test(id)) throw new Error('the code id must be a whole number');
    const { j } = await api('/cosmwasm/wasm/v1/code/' + id);
    const ci = j.code_info || {};
    let h = String(ci.data_hash || '');
    if (!/^[0-9a-fA-F]{64}$/.test(h)) h = hexOf(h);
    const same = h.toLowerCase() === WASM.sum;
    out.innerHTML = same
      ? '<div class="dv-okl">Same code: code ' + esc(id) + ' was built from this file (sha256 ' + esc(WASM.sum.slice(0, 12)) + '…).</div>'
      : '<div class="dv-err">Different code. On chain: ' + esc(h.toLowerCase().slice(0, 16)) + '…, this file: ' + esc(WASM.sum.slice(0, 16)) + '…</div>';
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- Admin: migrate, change admin, remove admin ---------- */
let ADM = null, ACT = 'migrate';
$$('.dv-seg button').forEach(b => b.addEventListener('click', () => {
  ACT = b.dataset.act;
  $$('.dv-seg button').forEach(x => x.classList.toggle('on', x === b));
  $$('.dv-a-f').forEach(f => { f.hidden = f.dataset.for !== ACT; });
  ADM = null; $('#dv-a-go').disabled = true; $('#dv-a-out').innerHTML = '';
}));
['#dv-a-addr', '#dv-a-code', '#dv-a-msg', '#dv-a-new'].forEach(s => $(s).addEventListener('input', () => { ADM = null; $('#dv-a-go').disabled = true; }));
function admMsg(){
  const c = $('#dv-a-addr').value.trim();
  if (!contractOk(c)) throw new Error('the contract is not a terra1 address');
  if (ACT === 'migrate') return { kind: 'migrate', contract: c, code: $('#dv-a-code').value.trim(), msg: minify(ED.m.get(), 'the migrate message') };
  if (ACT === 'admin') return { kind: 'admin', contract: c, admin: $('#dv-a-new').value.trim() };
  return { kind: 'clearadmin', contract: c };
}
$('#dv-a-sim').addEventListener('click', async e => {
  const out = $('#dv-a-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    needKey();
    const m = admMsg();
    const res = await simulate([m]);
    ADM = bound({ m: m, fee: res.gasFee });
    out.innerHTML = feeLine(res, [m]);
    $('#dv-a-go').disabled = false;
  } catch (err) { bad(out, err); }
  busy(btn, false);
});
$('#dv-a-go').addEventListener('click', async e => {
  if (!ADM) return;
  const out = $('#dv-a-out'), btn = e.currentTarget;
  busy(btn, true);
  try {
    const P0 = fresh(ADM), m = P0.m;
    ADM = null; $('#dv-a-go').disabled = true;
    const r = await sendDev(P0.from, [m], S.MNEMONIC, P0.net, P0.fee);
    out.innerHTML = '<div class="dv-okl">Sent · ' + txLink(r.hash) + '</div>';
    const res = await r.wait();
    if (!res) pending(out, r.hash);
    else {
      out.insertAdjacentHTML('beforeend', '<div class="dv-okl">In block ' + esc(Number(res.height).toLocaleString()) + '. ' +
        (m.kind === 'migrate' ? 'The contract now runs code ' + esc(m.code) + '.' : m.kind === 'admin' ? 'The admin is now ' + esc(short(m.admin)) + '.' : 'The contract has no admin now.') + '</div>');
      // the list of contracts shows the new admin
      const key = 'fw:dev:mine:' + NET.chain + ':' + addrOf(), list = store.get(key, []);
      list.forEach(x => { if (x.addr === m.contract) { if (m.kind === 'migrate') x.code = m.code; if (m.kind === 'admin') x.admin = m.admin; if (m.kind === 'clearadmin') x.admin = ''; } });
      store.set(key, list); mine();
    }
    balance();
  } catch (err) { bad(out, err); }
  busy(btn, false);
});

/* ---------- Settings: network profiles, gas, explorer, faucet ---------- */
const FIELDS = { name: '#dv-s-name', lcd: '#dv-s-lcd', gasPrice: '#dv-s-gp', gasAdjust: '#dv-s-ga', explorer: '#dv-s-exp', faucet: '#dv-s-fc' };
function drawSettings(){
  $('#dv-prof').innerHTML = PROFILES.map(x => '<option value="' + esc(x.id) + '"' + (x.id === P.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
  for (const k in FIELDS) $(FIELDS[k]).value = P[k] == null ? '' : String(P[k]);
  $('#dv-prof-del').disabled = PROFILES.length < 2;
}
const urlOk = u => /^https?:\/\/[^\s/?#]+[^\s]*$/.test(u);
// a profile as it may be kept: every field checked, nothing else carried
function cleanProfile(x, id){
  const name = String(x.name || '').trim().slice(0, 40);
  const lcd = String(x.lcd || '').trim().replace(/\/+$/, '');
  const gp = Number(x.gasPrice), ga = Number(x.gasAdjust);
  const exp = String(x.explorer || '').trim(), fc = String(x.faucet || '').trim().replace(/\/+$/, '');
  if (!name) throw new Error('give the profile a name');
  if (!urlOk(lcd)) throw new Error('the LCD must be an http(s) address');
  if (!(gp > 0 && gp <= 1000)) throw new Error('the gas price must be above 0 and at most 1000 uluna');
  if (!(ga >= 1 && ga <= 3)) throw new Error('the gas adjustment must be between 1 and 3');
  if (exp && (!urlOk(exp) || exp.indexOf('{hash}') < 0)) throw new Error('the explorer must be an http(s) address with {hash} in it');
  if (fc && !urlOk(fc)) throw new Error('the faucet must be an http(s) address, or empty');
  return { id: String(id || x.id || ('p' + Date.now())).slice(0, 40), name: name, lcd: lcd, gasPrice: gp, gasAdjust: ga, explorer: exp, faucet: fc };
}
async function applyProfile(){
  dropChecks();
  NET.lcd = P.lcd; NET.gasPrice = P.gasPrice; NET.gasAdjust = P.gasAdjust;
  saveProfiles();
  $('#dv-host').textContent = P.lcd.replace(/^https?:\/\//, '');
  LAST = null; opened = addrOf() + '|' + NET.lcd;
  await readNode();
  ping(); firstBlockTime(); balance(); faucetStatus(); mine();
}
$('#dv-gear').addEventListener('click', () => {
  const box = $('#dv-set'), open = box.hidden;
  box.hidden = !open;
  $('#dv-gear').setAttribute('aria-expanded', String(open));
  $('#dv-gear').classList.toggle('on', open);
  if (open) { drawSettings(); $('#dv-s-out').innerHTML = ''; }
});
$('#dv-prof').addEventListener('change', e => {
  P = PROFILES.find(x => x.id === e.target.value) || P;
  drawSettings(); applyProfile();
});
$('#dv-prof-new').addEventListener('click', () => {
  const x = Object.assign({}, P, { id: 'p' + Date.now(), name: P.name + ' copy' });
  PROFILES.push(x); P = x; saveProfiles(); drawSettings();
  $('#dv-s-name').focus(); $('#dv-s-name').select();
});
$('#dv-prof-del').addEventListener('click', () => {
  if (PROFILES.length < 2) return;
  PROFILES = PROFILES.filter(x => x !== P); P = PROFILES[0];
  drawSettings(); applyProfile();
});
$('#dv-s-save').addEventListener('click', async () => {
  const out = $('#dv-s-out');
  try {
    const x = {};
    for (const k in FIELDS) x[k] = $(FIELDS[k]).value;
    const clean = cleanProfile(x, P.id);
    // the node must answer, and must not be mainnet, before it is kept
    const { j } = await api('/cosmos/base/tendermint/v1beta1/node_info', { base: clean.lcd, ms: 8000 });
    const net = (j.default_node_info || {}).network;
    if (!net) throw new Error('that LCD did not say which chain it is');
    if (net === MAINNET) throw new Error('that LCD is mainnet (columbus-5): developer tools stay on test networks');
    Object.assign(P, clean);
    out.innerHTML = '<div class="dv-okl">Saved. Using ' + esc(P.name) + ' on ' + esc(net) + '.</div>';
    drawSettings(); await applyProfile();
  } catch (err) { bad(out, err); }
});
// one file with everything set here: profiles, saved messages, tracked CW20s
$('#dv-s-export').addEventListener('click', () => {
  const data = { app: 'frontier-dev', version: 1, profiles: PROFILES, profile: P.id, saved: SAVED(), cw20: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/^fw:dev:cw20:/.test(k)) data.cw20[k.slice(12)] = store.get(k, []);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'frontier-dev-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#dv-s-import').addEventListener('click', () => $('#dv-s-file').click());
$('#dv-s-file').addEventListener('change', async e => {
  const out = $('#dv-s-out'), f = e.target.files[0];
  e.target.value = '';
  try {
    if (!f) return;
    if (f.size > 512 * 1024) throw new Error('that file is too large for settings');
    const d = JSON.parse(await f.text());
    if (!d || d.app !== 'frontier-dev') throw new Error('that is not a Frontier developer settings file');
    const profs = (d.profiles || []).slice(0, 20).map(x => cleanProfile(x));
    if (!profs.length) throw new Error('the file has no network profiles');
    const saved = (d.saved || []).filter(x => x && TEMPLATES[x.ed] && typeof x.msg === 'string' && x.msg.length < 20000)
      .slice(0, 200).map(x => ({ ed: x.ed, name: String(x.name || 'saved').slice(0, 40), msg: x.msg, contract: contractOk(x.contract || '') ? x.contract : '' }));
    PROFILES = profs; P = PROFILES.find(x => x.id === d.profile) || PROFILES[0];
    store.set('fw:dev:saved', saved);
    for (const chain in (d.cw20 || {})) {
      if (!/^[a-z0-9-]{1,40}$/.test(chain)) continue;
      const list = (d.cw20[chain] || []).filter(x => contractOk(x.addr || '')).slice(0, 100)
        .map(x => ({ addr: x.addr, sym: String(x.sym || 'CW20').slice(0, 16), dec: Math.min(Math.max(Number(x.dec) || 0, 0), 18) }));
      store.set('fw:dev:cw20:' + chain, list);
    }
    out.innerHTML = '<div class="dv-okl">Imported ' + profs.length + ' profile(s) and ' + saved.length + ' saved message(s).</div>';
    drawSettings(); drawTools(); await applyProfile();
  } catch (err) { bad(out, err); }
});
$('#dv-s-reset').addEventListener('click', e => {
  const b = e.currentTarget;
  // a second press within a few seconds: no browser dialog
  if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Press again to reset'; setTimeout(() => { b.classList.remove('arm'); b.textContent = 'Reset'; }, 4000); return; }
  b.classList.remove('arm'); b.textContent = 'Reset';
  PROFILES = [Object.assign({}, DEFAULT_PROFILE)]; P = PROFILES[0];
  store.set('fw:dev:saved', []);
  drawSettings(); drawTools(); applyProfile();
  $('#dv-s-out').innerHTML = '<div class="dv-okl">Back to the defaults.</div>';
});
