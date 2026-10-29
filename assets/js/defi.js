/* DeFi positions: what this address has working outside the wallet.

   Validator staking has its own tab. This is everything else: LP staked in
   Garuda farms, liquidity in Garuda pools, Garuda token staking, GRDX
   staking, Terraport's TERRA staking, Juris tier locks and open Garuda
   limit orders - with the rewards waiting in each and when locked tokens
   come back.

   Where the positions come from, cheapest first:
     1. the contracts every user may have a position in (FIXED);
     2. the contracts this address has called or been paid by, sorted by the
        code they were built from (one code = one kind of contract);
     3. every contract built from the codes of the farm and staking kinds,
        read for this address - the only way to find a position whose
        transactions are older than the history the LCD returns. This one
        is a few hundred light reads, so it runs in the background, at most
        every six hours, and its finds are kept.

   What each contract answers is parsed in defi-parse.js, against real
   mainnet answers (tests/defi.mjs). This screen only reads; claiming,
   unstaking and withdrawing come once the execute messages are confirmed
   from real transactions. */
import { LCD, amt, fmt, getJSON, iconHTML, paintIcons, smart, usd } from './chain.js?v=3d198aef';
import { DEC, knownAsset, mapLimit, reserves, txCandidates } from './market.js?v=3d198aef';
import { $, go, tap } from './shell.js?v=3d198aef';
import { S } from './state.js?v=3d198aef';
import { fiatOf, heldTokens, tokKey } from './tokens.js?v=3d198aef';
import * as P from './defi-parse.js?v=3d198aef';

const FINDER = 'https://finder.terraclassic.community/columbus-5/address/';
const JURIS = 'cw20:terra1vhgq25vwuhdhn9xjll0rhl2s67jzw78a4g2t78y5kz89q9lsdskq2pxcj2';

// one code id = one kind of contract (read from mainnet, 29 Oct 2026)
const KIND_OF_CODE = {
  '10913': 'farm', '10899': 'farm',          // Garuda farms, current and earlier
  '10907': 'pool',                           // Garuda pools
  '10920': 'stake',                          // Garuda token staking
  '10715': 'dynamic',                        // Terraport dynamic staking
  '11230': 'juris',                          // Juris staking
  '11408': 'orders'                          // Garuda order book
};
const PLATFORM = { farm: 'Garuda', pool: 'Garuda', stake: 'Garuda', grdx: 'Garuda', orders: 'Garuda',
                   dynamic: 'Terraport', juris: 'Juris' };
const FIXED = [
  { kind: 'grdx', contract: 'terra1dttut659lxn35m7elu794rglzjzmph3a7v8cs6866qn0csa05u7sk0jg3s' },
  { kind: 'dynamic', contract: 'terra1x44ptyv7zp9e289jxqu6x5asxazhjc8gvuj9ltfs6mzvjfuzn8lqluk4u7' },
  { kind: 'juris', contract: 'terra1rta0rnaxz9ww6hnrj9347vdn66gkgxcmcwgpm2jj6qulv8adc52s95qa5y' },
  { kind: 'orders', contract: 'terra15gk54rgdzd4xltxxzfe52y0jlhf7eh0wjvkkr877uvketw8ut90sr7ej8m' }
];
// the kinds worth reading for every contract of their code
const SWEEP_CODES = ['10913', '10920'];
const SWEEP_EVERY = 6 * 3600 * 1000;

const me = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cut = a => !a ? '' : a.slice(0, 10) + '\u2026' + a.slice(-4);
const day = t => t ? new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function permGet(k){ try { const v = localStorage.getItem('fw:perm:' + k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
function permSet(k, v){ try { localStorage.setItem('fw:perm:' + k, JSON.stringify(v)); } catch (e) {} }
function keep(k, v){ try { localStorage.setItem('fw:earn:' + k, JSON.stringify(v)); } catch (e) {} }
function kept(k){ try { return JSON.parse(localStorage.getItem('fw:earn:' + k) || 'null'); } catch (e) { return null; } }

async function q(c, msg){
  try { const r = await smart(c, msg, 1); return r ? r.data : null; } catch (e) { return null; }
}

/* An answer, a refusal, or silence - and only the first two may be kept.
   A query that timed out or hit a rate limit used to be stored as "this
   contract has no minter" for good, which is why every Garuda farm said
   "Could not value the LP": its LP token's minter had been asked during a
   burst, got a 429, and was remembered as nobody. */
async function ask(c, msg){
  try { const r = await smart(c, msg, 2); return { ok: true, data: r ? r.data : null }; }
  catch (e) { return { ok: false, refused: typeof e.status === 'number' && e.status !== 429 && e.status < 502 }; }
}

/* ---------------- tokens: names, decimals, prices ---------------- */
const META = {};
async function meta(key){
  if (META[key]) return META[key];
  const held = heldTokens().filter(r => tokKey(r) === key)[0];
  const k = knownAsset(key);
  let m = null;
  if (key === 'native:uluna') m = { sym: 'LUNC', dec: 6 };
  else if (key === 'native:uusd') m = { sym: 'USTC', dec: 6 };
  else if (held) m = { sym: held.sym, dec: held.dec === undefined ? 6 : held.dec, row: held };
  else if (k && k.sym) m = { sym: k.sym, dec: k.dec === undefined ? (DEC[key] === undefined ? 6 : DEC[key]) : k.dec, logo: k.logo };
  else if (key.slice(0, 5) === 'cw20:') {
    let ti = permGet('ti0:' + key);
    if (ti === undefined) {
      const d = await q(key.slice(5), { token_info: {} });
      ti = d ? { sym: d.symbol, dec: d.decimals } : null;
      if (ti) permSet('ti0:' + key, ti);
    }
    m = ti ? { sym: ti.sym, dec: ti.dec } : { sym: key.slice(5, 13).toUpperCase(), dec: 6 };
  } else m = { sym: key.slice(7, 13).toUpperCase(), dec: 6 };
  return (META[key] = m);
}

function rowOf(key){
  const m = META[key] || {};
  if (m.row) return m.row;
  const r = { sym: m.sym || '?', dec: m.dec === undefined ? 6 : m.dec, logo: m.logo };
  if (key.slice(0, 5) === 'cw20:') r.contract = key.slice(5); else r.denom = key.slice(7);
  return r;
}
function human(x){ const m = META[x.key] || { dec: 6 }; return amt(x.raw, m.dec); }
function dollars(x){
  const u = fiatOf(Object.assign({}, rowOf(x.key), { v: 1 }));
  return u === null ? null : u * human(x);
}

/* ---------------- an LP token, worth what ---------------- */
// The pair is the LP token's minter. Its reserves times the share are the
// two sides; the share is staked LP over the LP token's supply.
async function lpSides(lp, lpRaw){
  if (!lp || !lpRaw || lpRaw === '0') return null;
  // a new key: the old one may hold a remembered failure
  let pair = permGet('minter2:' + lp);
  if (pair === undefined) {
    const a = await ask(lp, { minter: {} });
    if (!a.ok && !a.refused) return null;          // no answer: try next time
    pair = (a.ok && a.data && a.data.minter) || '';
    permSet('minter2:' + lp, pair);
  }
  if (!pair) { console.warn('[earn] LP has no minter', lp); return null; }
  const [ti, res] = await Promise.all([q(lp, { token_info: {} }), reserves(pair)]);
  const total = Number(ti && ti.total_supply);
  if (!total || !res) { console.warn('[earn] could not read', !total ? 'LP supply' : 'pool reserves', lp, pair); return null; }
  const f = Number(lpRaw) / total;
  return { pair: pair, share: f, sides: res.map(r => ({ key: r.key, raw: String(Math.floor(Number(r.raw) * f)) })) };
}

/* ---------------- reading one contract for this address ----------------
   Each returns null when the address has nothing there. */
const READ = {
  async farm(c, addr){
    const st = await q(c, { stake_info: { address: addr } });
    if (!st || !Number(st.staked_amount)) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const [rw, un] = await Promise.all([q(c, { reward_info: { address: addr } }), q(c, { pending_unstakes: { address: addr } })]);
    const f = P.farm(cfg, st, rw, un);
    const lp = await lpSides(f.lp, f.staked);
    const notes = [];
    if (f.endsAt) notes.push((f.endsAt * 1000 < Date.now() ? 'Ended ' : 'Runs until ') + day(f.endsAt));
    f.leaving.forEach(u => notes.push('Unstaking' + (u.at ? ', back ' + day(u.at) : '')));
    return { kind: 'farm', label: 'Farm', holds: lp ? lp.sides : [], rewards: f.rewards, notes: notes,
             share: lp && lp.share, pair: lp && lp.pair, missing: !lp };
  },
  async pool(c, addr){
    const pos = await q(c, { user_position: { address: addr } });
    if (!pos || !Number(pos.lp_tokens)) return null;
    const res = await reserves(c);
    const p = P.pool(pos, res ? { asset1: keyToGd(res[0].key), asset2: keyToGd(res[1].key) } : {});
    return { kind: 'pool', label: 'Liquidity', holds: p.sides.filter(s => s.key), rewards: [], notes: [], share: p.share };
  },
  async stake(c, addr){
    const st = await q(c, { stake: { staker: addr } });
    if (!st || !st.stake || !Number(st.stake.amount)) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const [rw, un] = await Promise.all([q(c, { reward: { staker: addr } }), q(c, { unstake: { staker: addr } })]);
    const s = P.tokenStake(cfg, st, rw, un);
    if (!s.token) return null;
    const notes = [];
    if (s.apr !== null) notes.push('APR ' + (s.apr * 100).toFixed(s.apr * 100 % 1 ? 1 : 0) + '%');
    s.leaving.forEach(u => notes.push('Unstaking' + (u.at ? ', back ' + day(u.at) : '')));
    return { kind: 'stake', label: 'Staking', holds: [{ key: s.token, raw: s.staked }],
             rewards: s.reward !== '0' ? [{ key: s.token, raw: s.reward }] : [], notes: notes };
  },
  async grdx(c, addr){
    const a = await q(c, { assets: { staker: addr } });
    if (!a) return null;                       // refused = nothing staked
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const g = P.grdxStake(cfg, a);
    if (!g.token || g.staked === '0') return null;
    return { kind: 'stake', label: 'GRDX staking', holds: [{ key: g.token, raw: g.staked }], rewards: [],
             notes: ['Rewards in several tokens - shown on Garuda'] };
  },
  async dynamic(c, addr){
    const u = await q(c, { user_info: { address: addr } });
    if (!u) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const d = P.dynamicStake(cfg, u);
    if (!d.staked.length && !d.rewards.length) return null;
    const notes = d.unlockSeconds ? ['Unstaking takes ' + Math.round(d.unlockSeconds / 86400) + ' days'] : [];
    return { kind: 'stake', label: 'Staking', holds: d.staked, rewards: d.rewards, notes: notes };
  },
  async juris(c, addr){
    const u = await q(c, { user_info: { address: addr } });
    const j = P.jurisStake(u);
    await meta(JURIS);
    if (!j.locks.length && j.bonded === '0') return null;
    const holds = [], notes = [];
    let total = 0;
    j.locks.forEach(l => { total += Number(l.raw); });
    if (j.bonded !== '0') total += Number(j.bonded);
    holds.push({ key: JURIS, raw: String(total) });
    j.locks.forEach(l => notes.push(cap(l.tier) + ' lock \u00b7 ' + fmtRaw(JURIS, l.raw) + ' until ' + day(l.release)));
    return { kind: 'lock', label: 'Tier staking', holds: holds, rewards: [], notes: notes };
  },
  async orders(c, addr){
    const d = await q(c, { user_orders: { address: addr } });
    const o = P.orders(d);
    if (!o.length) return null;
    await Promise.all(o.map(x => x.get.key ? meta(x.get.key) : null));
    return { kind: 'order', label: o.length === 1 ? 'Open order' : o.length + ' open orders',
             holds: o.map(x => x.give), rewards: [], notes: o.map(x => 'Order #' + x.id + (x.get.key ? ' \u2192 ' + ((META[x.get.key] || {}).sym || '') : '')),
             wants: o.map(x => x.get).filter(x => x.key) };
  }
};
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const keyToGd = k => k.slice(0, 5) === 'cw20:' ? { cw20: k.slice(5) } : { native: k.slice(7) };
function fmtRaw(key, r){ const m = META[key] || { dec: 6 }; return fmt(amt(r, m.dec)); }

/* ---------------- finding the contracts ---------------- */
async function codeOf(c){
  let code = permGet('code:' + c);
  if (code === undefined) {
    try {
      const r = await getJSON(LCD + '/cosmwasm/wasm/v1/contract/' + c, 10000, 1);
      code = String(((r && r.contract_info) || {}).code_id || '');
    } catch (e) { return ''; }
    permSet('code:' + c, code);
  }
  return code;
}

// contracts this address has called, including the target inside a cw20 send
async function called(addr){
  try {
    const r = await getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent("message.sender='" + addr + "'") +
      '&pagination.limit=100&order_by=ORDER_BY_DESC', 20000, 1);
    const out = {};
    for (const t of (r.tx_responses || [])) {
      for (const m of (((t.tx || {}).body || {}).messages || [])) {
        if (!m.contract) continue;
        out[m.contract] = 1;
        const s = m.msg && (m.msg.send || m.msg.send_nft);
        if (s && s.contract) out[s.contract] = 1;
      }
    }
    return Object.keys(out);
  } catch (e) { return []; }
}

async function codeList(code){
  const hit = kept('code:' + code);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.list;
  const list = [];
  let key = '';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await getJSON(LCD + '/cosmwasm/wasm/v1/code/' + code + '/contracts?pagination.limit=500' +
        (key ? '&pagination.key=' + encodeURIComponent(key) : ''), 15000, 1);
      list.push(...((r && r.contracts) || []));
      key = (r && r.pagination && r.pagination.next_key) || '';
      if (!key) break;
    } catch (e) { break; }
  }
  if (list.length) keep('code:' + code, { at: Date.now(), list: list });
  return list;
}

/* ---------------- the scan ---------------- */
let FOUND = {}, BUSY = false, SEQ = 0;

async function readJob(j, addr){
  try {
    const p = await READ[j.kind](j.contract, addr);
    if (p) { p.contract = j.contract; p.platform = PLATFORM[j.kind] || 'Other'; }
    return p;
  } catch (e) { return null; }
}

async function scan(full){
  const addr = me();
  if (!addr || BUSY) return;
  BUSY = true;
  const seq = ++SEQ;
  const was = kept('found:' + addr) || { at: 0, list: [], swept: 0 };
  status('Reading your positions\u2026');
  const jobs = {}, add = (kind, c) => { if (READ[kind] && !jobs[c]) jobs[c] = { kind: kind, contract: c }; };
  FIXED.forEach(j => add(j.kind, j.contract));
  (was.list || []).forEach(j => add(j.kind, j.contract));

  try {
    // the fast part: fixed contracts and what was found before
    FOUND = {};
    await readAll(Object.values(jobs), addr, seq);
    draw();

    // then the history
    status('Checking your history\u2026');
    const cands = Array.from(new Set((await called(addr)).concat(await txCandidates(addr).catch(() => []))));
    const codes = await mapLimit(cands, 4, codeOf);
    const fresh = [];
    cands.forEach((c, i) => { const k = KIND_OF_CODE[codes[i]]; if (k && !jobs[c]) { add(k, c); fresh.push(jobs[c]); } });
    await readAll(fresh, addr, seq);
    draw();

    // then every farm and staking contract there is, now and then
    if (full || Date.now() - (was.swept || 0) > SWEEP_EVERY) {
      const all = [];
      for (const code of SWEEP_CODES) {
        for (const c of await codeList(code)) if (!jobs[c]) { add(KIND_OF_CODE[code], c); all.push(jobs[c]); }
      }
      await readAll(all, addr, seq, true);
      was.swept = Date.now();
    }
    if (seq !== SEQ) return;
    keep('found:' + addr, { at: Date.now(), swept: was.swept || 0,
      list: Object.values(FOUND).map(p => ({ kind: kindOfPos(p), contract: p.contract })) });
    draw();
    status('');
  } finally {
    BUSY = false;
  }
}

// which READ produced a position, so the next open reads it first
function kindOfPos(p){
  if (p.kind === 'farm') return 'farm';
  if (p.kind === 'pool') return 'pool';
  if (p.kind === 'lock') return 'juris';
  if (p.kind === 'order') return 'orders';
  if (p.platform === 'Terraport') return 'dynamic';
  if (p.label === 'GRDX staking') return 'grdx';
  return 'stake';
}

async function readAll(list, addr, seq, counted){
  let n = 0;
  await mapLimit(list, 4, async function (j) {
    const p = await readJob(j, addr);
    n++;
    if (counted && n % 10 === 0) status('Checking every Garuda farm and staking pool \u00b7 ' + n + ' of ' + list.length);
    if (p && seq === SEQ) {
      const keys = p.holds.concat(p.rewards, p.wants || []).map(x => x.key);
      await Promise.all(keys.map(meta));
      FOUND[p.contract] = p;
      draw();
    }
  });
}

/* ---------------- drawing ---------------- */
const ICON = {
  farm: '<path d="M12 21V11"/><path d="M12 11c0-4 3-6 7-6 0 4-3 6-7 6Z"/><path d="M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z"/>',
  pool: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
  stake: '<path d="m12 3 8.5 4.7-8.5 4.7-8.5-4.7Z"/><path d="m3.5 12 8.5 4.7 8.5-4.7"/><path d="m3.5 16.4 8.5 4.7 8.5-4.7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  order: '<path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h6"/>'
};

function worth(p){
  let sum = 0, all = true;
  for (const x of p.holds) { const d = dollars(x); if (d === null) all = false; else sum += d; }
  return { usd: sum, complete: all && p.holds.length > 0 };
}
function rewardWorth(p){
  let sum = 0;
  for (const x of p.rewards) { const d = dollars(x); if (d !== null) sum += d; }
  return sum;
}

function draw(){
  const list = Object.values(FOUND);
  const box = $('#earn-list');
  if (!box) return;
  const total = list.reduce((a, p) => a + worth(p).usd, 0);
  const rewards = list.reduce((a, p) => a + rewardWorth(p), 0);
  $('#earn-total').textContent = usd(total);
  $('#earn-count').textContent = list.length ? list.length + (list.length === 1 ? ' position' : ' positions') +
    (rewards >= 0.01 ? ' \u00b7 ' + usd(rewards) + ' in rewards waiting' : '') : '';
  homeLine(list.length, total);

  if (!list.length) {
    box.innerHTML = BUSY ? skel() : '<div class="tk-none">No staking, farm or pool positions found on Garuda, Terraport or Juris for this address.</div>';
    return;
  }
  const by = {};
  list.forEach(p => { (by[p.platform] = by[p.platform] || []).push(p); });
  box.innerHTML = Object.keys(by).sort().map(function (plat) {
    const ps = by[plat].sort((a, b) => worth(b).usd - worth(a).usd);
    const sub = ps.reduce((a, p) => a + worth(p).usd, 0);
    return '<div class="head"><h2>' + esc(plat) + '</h2><span class="ea-sum">' + (sub > 0 ? usd(sub) : '') + '</span></div>' +
      '<div class="tk-card ea-card">' + ps.map(card).join('') + '</div>';
  }).join('');
  paintIcons(box);
}

function card(p){
  const w = worth(p);
  const pair = p.holds.map(x => (META[x.key] || {}).sym).filter(Boolean);
  const title = (p.kind === 'farm' || p.kind === 'pool') && pair.length === 2 ? pair.join(' / ') + ' \u00b7 ' + p.label
    : pair.length ? pair[0] + ' \u00b7 ' + p.label : p.label;
  const holds = p.holds.map(x =>
    '<span class="ea-amt">' + iconHTML(rowOf(x.key)) + '<b>' + fmt(human(x)) + '</b> ' + esc((META[x.key] || {}).sym) + '</span>').join('');
  const rew = p.rewards.length ? '<div class="ea-rew">Rewards ' + p.rewards.map(x =>
    '<b>' + fmt(human(x)) + ' ' + esc((META[x.key] || {}).sym) + '</b>').join(' + ') + '</div>' : '';
  const share = p.share ? '<span class="ea-share">' + (p.share * 100 < 0.01 ? '<0.01' : (p.share * 100).toFixed(2)) + '% of pool</span>' : '';
  return '<div class="ea-pos" data-addr="' + p.contract + '">' +
    '<div class="ea-top"><div class="tk-pos-i ' + (p.kind === 'lock' || p.kind === 'order' ? 'stake' : p.kind === 'farm' ? 'farm' : p.kind) + '">' +
      '<svg viewBox="0 0 24 24">' + (ICON[p.kind] || ICON.stake) + '</svg></div>' +
      '<div class="ea-mid"><b>' + esc(title) + '</b><span>' + cut(p.contract) + share + '</span></div>' +
      '<div class="ea-usd">' + (w.usd > 0 ? (w.complete ? '' : '\u2265 ') + usd(w.usd) : '') + '</div></div>' +
    (p.missing ? '<div class="ea-note">Could not value the LP right now</div>' : '<div class="ea-holds">' + holds + '</div>') +
    rew +
    (p.notes.length ? '<div class="ea-note">' + p.notes.map(esc).join('<br>') + '</div>' : '') +
    '</div>';
}

const skel = () => '<div class="tk-card">' + '<div class="tk-skel"></div>'.repeat(4) + '</div>';
function status(t){ const s = $('#earn-status'); if (s) { s.textContent = t; s.hidden = !t; } }

function homeLine(n, total){
  const sub = $('#earn-sub'), r = $('#earn-home-total');
  if (sub) sub.textContent = n ? n + (n === 1 ? ' position' : ' positions') + ' on Garuda, Terraport, Juris' : 'Staking, farms and pools on DEXes';
  if (r) r.textContent = n && total > 0 ? usd(total) : '';
  const addr = me();
  if (addr) keep('home:' + addr, { n: n, total: total });
}

/* ---------------- wiring ---------------- */
function open(){
  tap();
  go('earn');
  if (!Object.keys(FOUND).length) $('#earn-list').innerHTML = skel();
  draw();
  scan(false);
}
const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
on('#earn-open', 'click', open);
on('#earn-rescan', 'click', function () { tap(); scan(true); });
on('#earn-list', 'click', function (e) {
  const p = e.target.closest('[data-addr]');
  if (!p) return;
  const url = FINDER + p.dataset.addr;
  if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openLink) Telegram.WebApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
});
document.addEventListener('frontier:wallet', function () {
  FOUND = {};
  const h = kept('home:' + me());
  homeLine(h ? h.n : 0, h ? h.total : 0);
});
document.addEventListener('frontier:locked', function () { FOUND = {}; SEQ++; });

export { scan, FOUND };
