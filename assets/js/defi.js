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
import { LCD, amt, fmt, getJSON, iconHTML, paintIcons, smart, usd } from './chain.js?v=9a9caa7c';
import { DEC, knownAsset, mapLimit, reserves, txCandidates } from './market.js?v=9a9caa7c';
import { $, go, tap } from './shell.js?v=9a9caa7c';
import { S } from './state.js?v=9a9caa7c';
import { fiatOf, heldTokens, tokKey } from './tokens.js?v=9a9caa7c';
import * as P from './defi-parse.js?v=9a9caa7c';

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
/* Each reader returns null when the address has nothing there, or:
     kind, label    what it is
     holds          [{ key, raw }] the tokens in it that are yours
     rewards        [{ key, raw }] waiting to be claimed
     notes          short lines for the list card
     stats          [{ label, text } | { label, key, raw } | { label, list }]
                    the detail page's facts, formatted when drawn */
const pct = f => (f * 100 < 0.01 ? '<0.01' : (f * 100).toFixed(f * 100 < 1 ? 3 : 2)) + '%';
const READ = {
  async farm(c, addr){
    const st = await q(c, { stake_info: { address: addr } });
    if (!st || !Number(st.staked_amount)) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const [rw, un, tot] = await Promise.all([q(c, { reward_info: { address: addr } }),
      q(c, { pending_unstakes: { address: addr } }), q(c, { total_staked: {} })]);
    const f = P.farm(cfg, st, rw, un);
    const lp = await lpSides(f.lp, f.staked);
    const notes = [], stats = [];
    const ended = f.endsAt && f.endsAt * 1000 < Date.now();
    if (f.endsAt) notes.push((ended ? 'Ended ' : 'Runs until ') + day(f.endsAt));
    f.leaving.forEach(u => notes.push('Unstaking' + (u.at ? ', back ' + day(u.at) : '')));
    const total = Number(tot && tot.total_staked);
    if (total) stats.push({ label: 'Your share of the farm', text: pct(Number(f.staked) / total) });
    if (lp) stats.push({ label: 'Your share of the pool', text: pct(lp.share) });
    stats.push({ label: 'LP tokens staked', text: fmt(amt(f.staked, 6)) });
    if (f.claimed.length) stats.push({ label: 'Claimed so far', list: f.claimed });
    if (f.endsAt) stats.push({ label: ended ? 'Ended' : 'Runs until', text: day(f.endsAt) });
    stats.push({ label: 'Unstaking', text: f.unstakeDelay ? 'takes ' + dur(f.unstakeDelay) : 'instant' });
    return { kind: 'farm', label: 'Farm', holds: lp ? lp.sides : [], rewards: f.rewards, notes: notes, stats: stats,
             share: lp && lp.share, pair: lp && lp.pair, missing: !lp, keys: f.claimed.map(x => x.key) };
  },
  async pool(c, addr){
    const pos = await q(c, { user_position: { address: addr } });
    if (!pos || !Number(pos.lp_tokens)) return null;
    const res = await reserves(c);
    const p = P.pool(pos, res ? { asset1: keyToGd(res[0].key), asset2: keyToGd(res[1].key) } : {});
    return { kind: 'pool', label: 'Liquidity', holds: p.sides.filter(s => s.key), rewards: [], notes: [], share: p.share,
             stats: [{ label: 'Your share of the pool', text: pct(p.share) }, { label: 'LP tokens', text: fmt(amt(p.lp, 6)) }] };
  },
  async stake(c, addr){
    const st = await q(c, { stake: { staker: addr } });
    if (!st || !st.stake || !Number(st.stake.amount)) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const [rw, un, all] = await Promise.all([q(c, { reward: { staker: addr } }), q(c, { unstake: { staker: addr } }),
      q(c, { staking_stat: {} })]);
    const s = P.tokenStake(cfg, st, rw, un);
    if (!s.token) return null;
    const notes = [], stats = [];
    if (s.apr !== null) notes.push('APR ' + (s.apr * 100).toFixed(s.apr * 100 % 1 ? 1 : 0) + '%');
    s.leaving.forEach(u => notes.push('Unstaking' + (u.at ? ', back ' + day(u.at) : '')));
    if (s.apr !== null) stats.push({ label: 'APR', text: (s.apr * 100).toFixed(s.apr * 100 % 1 ? 1 : 0) + '%' });
    if (all && Number(all.total_staking)) {
      stats.push({ label: 'Your share', text: pct(Number(s.staked) / Number(all.total_staking)) });
      stats.push({ label: 'Staked by everyone', key: s.token, raw: String(all.total_staking) });
    }
    if (all && all.total_staker) stats.push({ label: 'Stakers', text: String(all.total_staker) });
    const since = Number(st.stake.staked_at);
    if (since) stats.push({ label: 'Staked since', text: day(Math.floor(since / 1e9)) });
    return { kind: 'stake', label: 'Staking', holds: [{ key: s.token, raw: s.staked }],
             rewards: s.reward !== '0' ? [{ key: s.token, raw: s.reward }] : [], notes: notes, stats: stats };
  },
  async grdx(c, addr){
    const a = await q(c, { assets: { staker: addr } });
    if (!a) return null;                       // refused = nothing staked
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const g = P.grdxStake(cfg, a);
    if (!g.token || g.staked === '0') return null;
    return { kind: 'stake', label: 'GRDX staking', holds: [{ key: g.token, raw: g.staked }], rewards: [],
             notes: ['Rewards in several tokens - shown on Garuda'], stats: [] };
  },
  async dynamic(c, addr){
    const u = await q(c, { user_info: { address: addr } });
    if (!u) return null;
    let cfg = permGet('cfg:' + c);
    if (cfg === undefined) { cfg = await q(c, { config: {} }); if (cfg) permSet('cfg:' + c, cfg); }
    const d = P.dynamicStake(cfg, u);
    if (!d.staked.length && !d.rewards.length && !d.unstakes.length) return null;
    const notes = [], stats = [];
    // tokens on their way out are still yours, and the ones past the unlock
    // time are waiting for you to withdraw them
    d.unstakes.forEach(x => notes.push((x.ready ? 'Ready to withdraw: ' : 'Unlocking until ' + day(x.at) + ': ') +
      '{' + x.key + '|' + x.raw + '}'));
    if (d.staked.length) stats.push({ label: 'Staked', list: d.staked });
    d.unstakes.forEach(x => stats.push({ label: x.ready ? 'Unstaked, ready to withdraw' : 'Unlocking until ' + day(x.at), key: x.key, raw: x.raw }));
    if (d.withdrawn.length) stats.push({ label: 'Rewards claimed so far', list: d.withdrawn });
    if (d.unlockSeconds) stats.push({ label: 'Unstaking takes', text: dur(d.unlockSeconds) });
    return { kind: 'stake', label: d.staked.length ? 'Staking' : 'Unstaked', holds: d.staked.concat(d.unstakes.map(x => ({ key: x.key, raw: x.raw }))),
             rewards: d.rewards, notes: notes, stats: stats, ready: d.unstakes.some(x => x.ready),
             keys: d.withdrawn.map(x => x.key) };
  },
  async juris(c, addr){
    const u = await q(c, { user_info: { address: addr } });
    const j = P.jurisStake(u);
    await meta(JURIS);
    if (!j.locks.length && j.bonded === '0') return null;
    const holds = [], notes = [], stats = [];
    let total = 0;
    j.locks.forEach(l => { total += Number(l.raw); });
    if (j.bonded !== '0') total += Number(j.bonded);
    holds.push({ key: JURIS, raw: String(total) });
    j.locks.forEach(l => notes.push(cap(l.tier) + ' lock \u00b7 ' + fmtRaw(JURIS, l.raw) + ' until ' + day(l.release)));
    j.locks.forEach(l => stats.push({ label: cap(l.tier) + ' lock #' + l.id + ', until ' + day(l.release), key: JURIS, raw: l.raw }));
    if (j.power !== '0') stats.push({ label: 'Voting power', text: fmt(Number(j.power)) });
    return { kind: 'lock', label: 'Tier staking', holds: holds, rewards: [], notes: notes, stats: stats };
  },
  async orders(c, addr){
    const d = await q(c, { user_orders: { address: addr } });
    const o = P.orders(d);
    if (!o.length) return null;
    await Promise.all(o.map(x => x.get.key ? meta(x.get.key) : null));
    return { kind: 'order', label: o.length === 1 ? 'Open order' : o.length + ' open orders',
             holds: o.map(x => x.give), rewards: [], notes: o.map(x => 'Order #' + x.id + (x.get.key ? ' \u2192 ' + ((META[x.get.key] || {}).sym || '') : '')),
             wants: o.map(x => x.get).filter(x => x.key),
             stats: o.map(x => ({ label: 'Order #' + x.id + ' sells', key: x.give.key, raw: x.give.raw }))
               .concat(o.filter(x => x.get.key).map(x => ({ label: 'Order #' + x.id + ' for', text: (META[x.get.key] || {}).sym || '' }))) };
  }
};
function dur(s){
  if (s >= 86400) return Math.round(s / 86400) + (Math.round(s / 86400) === 1 ? ' day' : ' days');
  if (s >= 3600) return Math.round(s / 3600) + ' h';
  return Math.round(s / 60) + ' min';
}
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
      const keys = p.holds.concat(p.rewards, p.wants || []).map(x => x.key).concat(p.keys || []);
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

// one or two token logos, the second tucked under the first like a pair badge
function logos(p, big){
  let keys = p.holds.map(x => x.key);
  if (p.kind === 'order') keys = [p.holds[0] && p.holds[0].key, p.wants && p.wants[0] && p.wants[0].key];
  keys = keys.filter(Boolean).filter((k, i, a) => a.indexOf(k) === i).slice(0, 2);
  return '<span class="ea-logos' + (keys.length > 1 ? ' two' : '') + (big ? ' big' : '') + '">' +
    keys.map(k => iconHTML(rowOf(k))).join('') + '</span>';
}

function titleOf(p){
  const syms = p.holds.map(x => (META[x.key] || {}).sym).filter(Boolean)
    .filter((k, i, a) => a.indexOf(k) === i);
  if ((p.kind === 'farm' || p.kind === 'pool') && syms.length === 2) return syms.join(' / ');
  if (p.kind === 'order' && p.wants && p.wants[0]) return syms[0] + ' \u2192 ' + ((META[p.wants[0].key] || {}).sym || '');
  return syms[0] || p.label;
}

// "{cw20:terra1...|123}" inside a note is an amount, drawn with its ticker
function noteHTML(n){
  return esc(n).replace(/\{([a-z0-9:\/]+)\|(\d+)\}/gi, function (m, key, r) {
    return '<b>' + fmt(human({ key: key, raw: r })) + ' ' + esc((META[key] || {}).sym || '') + '</b>';
  });
}

function card(p){
  const w = worth(p);
  const holds = p.holds.map(x =>
    '<span class="ea-amt"><b>' + fmt(human(x)) + '</b> ' + esc((META[x.key] || {}).sym) + '</span>').join('<i class="ea-plus">+</i>');
  const rew = p.rewards.length ? '<div class="ea-rew">Rewards ' + p.rewards.map(x =>
    '<b>' + fmt(human(x)) + ' ' + esc((META[x.key] || {}).sym) + '</b>').join(' + ') + '</div>' : '';
  const tag = p.ready ? '<span class="ea-tag">ready to withdraw</span>' : '';
  return '<div class="ea-pos" data-pos="' + p.contract + '">' +
    '<div class="ea-top">' + logos(p) +
      '<div class="ea-mid"><b>' + esc(titleOf(p)) + '</b><span>' + esc(p.label) +
        (p.share ? ' \u00b7 ' + pct(p.share) + ' of pool' : '') + tag + '</span></div>' +
      '<div class="ea-usd">' + (w.usd > 0 ? (w.complete ? '' : '\u2265 ') + usd(w.usd) : '') + '</div>' +
      '<svg class="ea-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div>' +
    (p.missing ? '<div class="ea-note">Could not value the LP right now</div>' : '<div class="ea-holds">' + holds + '</div>') +
    rew +
    (p.notes.length ? '<div class="ea-note">' + p.notes.map(noteHTML).join('<br>') + '</div>' : '') +
    '</div>';
}

/* ---------------- one position, on its own page ---------------- */
const ACTIONS = {
  farm: ['Claim rewards', 'Unstake', 'Stake more'],
  pool: ['Withdraw liquidity', 'Add liquidity'],
  stake: ['Claim rewards', 'Unstake', 'Stake more'],
  lock: ['Claim rewards'],
  order: ['Cancel order']
};
let OPEN_POS = '';

function amountRow(x, cls){
  const d = dollars(x);
  return '<div class="ep-row' + (cls ? ' ' + cls : '') + '">' + iconHTML(rowOf(x.key)) +
    '<span class="ep-sym">' + esc((META[x.key] || {}).sym || '') + '</span>' +
    '<span class="ep-amt"><b>' + fmt(human(x)) + '</b><i>' + (d !== null ? usd(d) : '') + '</i></span></div>';
}

function statRow(st){
  let v;
  if (st.list) v = st.list.map(x => fmt(human(x)) + ' ' + esc((META[x.key] || {}).sym || '')).join(' + ');
  else if (st.key) v = fmt(human(st)) + ' ' + esc((META[st.key] || {}).sym || '');
  else v = esc(st.text);
  return '<div class="tk-line"><span>' + esc(st.label) + '</span><b>' + v + '</b></div>';
}

function detail(c){
  const p = FOUND[c];
  if (!p) return;
  OPEN_POS = c;
  const w = worth(p);
  $('#ep-logos').outerHTML = logos(p, true).replace('<span class="ea-logos', '<span id="ep-logos" class="ea-logos');
  $('#ep-title').textContent = titleOf(p);
  $('#ep-sub').textContent = p.platform + ' \u00b7 ' + p.label;
  $('#ep-usd').textContent = w.usd > 0 ? (w.complete ? '' : '\u2265 ') + usd(w.usd) : '\u2014';
  $('#ep-share').textContent = p.share ? pct(p.share) + ' of the pool' : (p.ready ? 'Ready to withdraw' : '');
  $('#ep-holds').innerHTML = p.missing ? '<div class="tk-none">Could not value the LP right now.</div>'
    : p.holds.map(x => amountRow(x)).join('');
  $('#ep-rew-wrap').hidden = !p.rewards.length;
  $('#ep-rew').innerHTML = p.rewards.map(x => amountRow(x, 'gain')).join('');
  const stats = (p.stats || []);
  $('#ep-stats-wrap').hidden = !stats.length;
  $('#ep-stats').innerHTML = stats.map(statRow).join('');
  $('#ep-actions').innerHTML = (ACTIONS[p.kind] || []).map(a =>
    '<button class="ep-act" type="button" disabled>' + a + '</button>').join('') +
    '<p class="tk-note">Managing positions from the wallet comes in the next update; for now it is done on ' + esc(p.platform) + '.</p>';
  paintIcons($('#st-epos'));
  go('epos');
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
  const p = e.target.closest('[data-pos]');
  if (p) { tap(); detail(p.dataset.pos); }
});
on('#ep-finder', 'click', function () {
  if (!OPEN_POS) return;
  const url = FINDER + OPEN_POS;
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
