/* One token, on its own page.

   Tapping a row on the home screen used to do nothing. Now it opens this: what
   the token is worth, how much of it is here and where the rest of it sits -
   staked with validators, in a liquidity pool, in a farm or staking contract
   on some exchange - the market it trades in, what the contract says about
   itself, and the transactions that touched it. Send, Receive and Swap start
   from here with the token already chosen.

   Positions are found, not configured. The address's own history names every
   contract it has dealt with (txCandidates, the same list the token sweep
   uses); among those:
     - an LP token is a contract whose minter is one of this token's pools,
       and its share of that pool's reserves is the position;
     - a staking or farm contract is one whose label says so and whose config
       names this token or one of those LP tokens, and the amount is read with
       the handful of query shapes the exchanges on this chain use.
   Every answer that does not change (a minter, a label) is kept for good, so
   the second open of a page asks the chain only for amounts. */
import { LCD, amt, fmt, getJSON, iconHTML, paintIcons, smart, usd } from './chain.js?v=9a9caa7c';
import { DEC, graph, graphReady, infoKey, knownAsset, mapLimit, owMarket, poolsOf, txCandidates } from './market.js?v=9a9caa7c';
import { $, go, tap } from './shell.js?v=9a9caa7c';
import { S } from './state.js?v=9a9caa7c';
import { fiatOf, heldTokens, luncUsd, tokKey, walletUsd } from './tokens.js?v=9a9caa7c';
import { rowHTML } from './activity.js?v=9a9caa7c';

const FINDER = 'https://finder.terraclassic.community/columbus-5/address/';
let SEQ = 0, CUR = null, KEY = '';

/* ---------------- small things ---------------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cut = a => !a ? '' : a.slice(0, 10) + '\u2026' + a.slice(-4);
const me = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const decOf = k => {
  const a = knownAsset(k);
  if (a && a.dec !== undefined && a.dec !== null) return a.dec;
  return DEC[k] === undefined ? 6 : DEC[k];
};
const symOf = k => {
  if (k === 'native:uluna') return 'LUNC';
  if (k === 'native:uusd') return 'USTC';
  const a = knownAsset(k);
  return (a && a.sym) || k.slice(k.indexOf(':') + 1, k.indexOf(':') + 7).toUpperCase();
};

// A price small enough to need more than two decimals gets them: $0.000023
// says something, $0.00 says nothing.
function money(v){
  if (v === null || v === undefined || !isFinite(v)) return '\u2014';
  if (v === 0) return '$0';
  if (v >= 1) return usd(v);
  const d = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(v))));
  return '$' + v.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
}
function big(v){
  if (!isFinite(v)) return '\u2014';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return fmt(v);
}

// answers that never change, kept without an expiry
function permGet(k){ try { const v = localStorage.getItem('fw:perm:' + k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
function permSet(k, v){ try { localStorage.setItem('fw:perm:' + k, JSON.stringify(v)); } catch (e) {} }

async function q(contract, msg){
  try { const r = await smart(contract, msg, 1); return r && r.data; } catch (e) { return null; }
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

function line(k, v, cls){
  return '<div class="tk-line' + (cls ? ' ' + cls : '') + '"><span>' + k + '</span><b>' + v + '</b></div>';
}
const skel = n => Array.from({ length: n }, () => '<div class="tk-skel"></div>').join('');

/* ---------------- what the token is ---------------- */
function rowFor(key){
  const held = heldTokens().filter(r => tokKey(r) === key)[0];
  if (held) return held;
  const a = knownAsset(key);
  const base = { sym: (a && a.sym) || symOf(key), dec: decOf(key), logo: a && a.logo, v: 0 };
  if (key.slice(0, 5) === 'cw20:') base.contract = key.slice(5); else base.denom = key.slice(7);
  return base;
}

// dollars per one token, from the same arithmetic the home list uses
function unitUsd(t){
  return fiatOf(Object.assign({}, t, { v: 1 }));
}
function unitLunc(t){
  if (t.denom === 'uluna') return 1;
  if (t.pool && t.pool.inLunc) return t.pool.inLunc;
  const u = unitUsd(t), l = luncUsd();
  return u !== null && l ? u / l : null;
}

/* ---------------- the page ---------------- */
// the console is a grid of equal cells; a hidden button must take its cell with it
function fitActs(){
  const box = document.querySelector('.tk-acts');
  if (!box) return;
  const n = box.querySelectorAll('.act:not([hidden])').length;
  box.style.gridTemplateColumns = 'repeat(' + Math.max(n, 1) + ',1fr)';
}

function paintHead(t){
  $('#tk-ico').innerHTML = iconHTML(t);
  paintIcons($('#tk-ico'));
  $('#tk-sym').textContent = t.sym;
  const a = KEY && knownAsset(KEY);
  $('#tk-name').textContent = t.denom === 'uluna' ? 'Terra Luna Classic'
    : t.denom === 'uusd' ? 'TerraClassicUSD'
    : (a && a.name) || (t.contract ? cut(t.contract) : (t.note || ''));
  const u = unitUsd(t), l = unitLunc(t);
  $('#tk-px').textContent = money(u);
  $('#tk-px-l').textContent = (t.denom !== 'uluna' && l) ? fmt(l) + ' LUNC' : '';
  const bal = t.v || 0, f = fiatOf(t), tot = walletUsd();
  $('#tk-bal').textContent = fmt(bal) + ' ' + t.sym;
  $('#tk-bal-usd').textContent = f === null ? 'no price' : money(f);
  $('#tk-share').textContent = (f && tot) ? (f / tot * 100).toFixed(f / tot < 0.01 ? 2 : 1) + '% of your wallet' : '';
  // nothing to send is not a Send button that fails later
  $('#tk-send').disabled = !(bal > 0);
}

async function open(key){
  if (!key) return;
  const seq = ++SEQ;
  KEY = key;
  CUR = rowFor(key);
  paintHead(CUR);
  $('#tk-pos').innerHTML = skel(2);
  $('#tk-mkt').innerHTML = skel(3);
  $('#tk-about').innerHTML = skel(2);
  $('#tk-act').innerHTML = skel(3);
  $('#tk-swap').hidden = false;
  fitActs();
  go('token');
  await owMarket().catch(() => null);
  // without the feed the pool list comes from the stored factory walk; built
  // from scratch it is a thousand reads, so only when it is already stored
  if (!poolsOf(key).length && graphReady()) await graph().catch(() => null);
  if (seq !== SEQ) return;
  paintMarket(CUR);
  // three independent readings; whichever answers first is drawn first
  about(CUR, seq).catch(() => {});
  positions(CUR, seq).catch(function () { if (seq === SEQ) $('#tk-pos').innerHTML = '<div class="tk-none">Could not read the positions just now.</div>'; });
  activity(CUR, seq).catch(() => {});
}

/* ---------------- market ---------------- */
function paintMarket(t){
  const pools = poolsOf(KEY);
  $('#tk-swap').hidden = !pools.length && t.denom !== 'uluna';
  fitActs();
  const liq = pools.reduce((a, p) => a + (p.liq || 0), 0);
  const vol = pools.reduce((a, p) => a + (p.vol || 0), 0);
  let html = line('Price', money(unitUsd(t)));
  const l = unitLunc(t);
  if (t.denom !== 'uluna' && l) html += line('In LUNC', fmt(l));
  if (pools.length) html += line('Pools', String(pools.length));
  if (liq > 0) html += line('Liquidity', '$' + big(liq));
  if (vol > 0) html += line('Volume, 24h', '$' + big(vol));
  if (t.pool && !t.pool.bond) {
    html += line('Priced from', t.pool.hops > 1 ? t.pool.hops + ' pools, narrowest ' + big(t.pool.depth) + ' LUNC'
      : 'a pool of ' + big(t.pool.depth) + ' LUNC');
  } else if (t.pool && t.pool.bond) {
    html += line('Priced from', 'bonding curve, ' + big(t.pool.depth) + ' LUNC');
  } else if (t.denom === 'uluna' || t.denom === 'uusd') {
    html += line('Priced from', 'CoinGecko');
  }
  if (pools.length) {
    html += '<div class="tk-pools">' + pools.slice(0, 5).map(function (p) {
      return '<div class="tk-pool"><span><b>' + esc(CUR.sym) + ' / ' + esc(p.otherSym) + '</b>' +
        '<i>' + esc(p.name || p.dex) + '</i></span><em>' + (p.liq ? '$' + big(p.liq) : '') + '</em></div>';
    }).join('') + (pools.length > 5 ? '<div class="tk-more">and ' + (pools.length - 5) + ' more</div>' : '') + '</div>';
  } else if (t.contract) {
    html += '<div class="tk-none">No pool lists this token right now.</div>';
  }
  $('#tk-mkt').innerHTML = html;
}

/* ---------------- about ---------------- */
async function about(t, seq){
  let html = '';
  if (t.contract) {
    let info = permGet('ti:' + t.contract);
    const [ti, mk] = await Promise.all([
      q(t.contract, { token_info: {} }),
      info && info.mkChecked ? Promise.resolve(info.mk) : q(t.contract, { marketing_info: {} })
    ]);
    info = { mk: mk || null, mkChecked: true };
    permSet('ti:' + t.contract, info);
    if (seq !== SEQ) return;
    if (ti && ti.name) {
      html += line('Name', esc(ti.name));
      // the contract's own name beats a shortened address under the ticker
      $('#tk-name').textContent = ti.name;
    }
    if (ti && ti.total_supply) html += line('Total supply', big(amt(ti.total_supply, ti.decimals === undefined ? 6 : ti.decimals)));
    html += line('Decimals', String(ti && ti.decimals !== undefined ? ti.decimals : (t.dec || 6)));
    html += '<button class="tk-addr" type="button" data-copy="' + esc(t.contract) + '">' +
      '<span>Contract</span><b>' + cut(t.contract) + '</b><i>copy</i></button>';
    if (mk && mk.project && /^https?:\/\//.test(mk.project)) {
      html += '<button class="tk-link" type="button" data-url="' + esc(mk.project) + '">' + esc(mk.project.replace(/^https?:\/\//, '').slice(0, 40)) + '</button>';
    }
    if (mk && mk.description) html += '<p class="tk-desc">' + esc(String(mk.description).slice(0, 400)) + '</p>';
    html += '<button class="tk-link" type="button" data-url="' + FINDER + esc(t.contract) + '">View in explorer</button>';
  } else {
    html += line('Type', t.denom === 'uluna' || t.denom === 'uusd' ? 'Native coin of Terra Classic' : 'IBC coin');
    html += line('Denom', esc(t.denom.length > 24 ? cut(t.denom) : t.denom));
    if (t.note && t.denom.slice(0, 4) === 'ibc/') html += line('Route', esc(t.note));
  }
  $('#tk-about').innerHTML = html;
}

/* ---------------- positions ----------------
   Each one: { kind, title, sub, amount (of this token), extra (other side,
   text), usd } */
async function positions(t, seq){
  const addr = me();
  const out = [];
  const unit = unitUsd(t);

  if (t.v > 0) out.push({ kind: 'wallet', title: 'In this wallet', sub: 'available to send and swap',
                          amount: t.v, usd: fiatOf(t) });

  if (t.denom === 'uluna') {
    const [dels, rew, unb] = await Promise.all([
      getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + addr).catch(() => ({})),
      getJSON(LCD + '/cosmos/distribution/v1beta1/delegators/' + addr + '/rewards').catch(() => ({})),
      getJSON(LCD + '/cosmos/staking/v1beta1/delegators/' + addr + '/unbonding_delegations').catch(() => ({}))
    ]);
    const staked = (dels.delegation_responses || []).reduce((a, d) => a + amt((d.balance || {}).amount || 0, 6), 0);
    const n = (dels.delegation_responses || []).length;
    const reward = ((rew.total || []).filter(c => c.denom === 'uluna')[0] || {}).amount;
    const unbond = (unb.unbonding_responses || []).reduce((a, u) =>
      a + (u.entries || []).reduce((b, e) => b + amt(e.balance || 0, 6), 0), 0);
    if (staked > 0) out.push({ kind: 'stake', title: 'Staked with validators',
      sub: n + (n === 1 ? ' validator' : ' validators'), amount: staked, usd: unit !== null ? staked * unit : null, go: 'stake' });
    if (reward && Number(reward) >= 1e6) out.push({ kind: 'gift', title: 'Staking rewards',
      sub: 'ready to claim', amount: amt(String(reward).split('.')[0], 6), usd: unit !== null ? amt(String(reward).split('.')[0], 6) * unit : null, go: 'stake' });
    if (unbond > 0) out.push({ kind: 'wait', title: 'Unstaking',
      sub: 'returns after the unbonding period', amount: unbond, usd: unit !== null ? unbond * unit : null, go: 'stake' });
  }
  if (seq === SEQ) drawPositions(t, out, true);

  // Everything below comes from the address's own history.
  const cands = await txCandidates(addr).catch(() => []);
  if (seq !== SEQ) return;
  const pools = poolsOf(KEY);
  const poolSet = {};
  pools.forEach(p => { poolSet[p.pair] = p; });

  // which of those contracts are LP tokens, and of which pool
  const minters = await mapLimit(cands, 4, async function (c) {
    let m = permGet('minter2:' + c);
    if (m === undefined) {
      const a = await ask(c, { minter: {} });
      if (!a.ok && !a.refused) return '';           // no answer: not remembered
      m = (a.ok && a.data && a.data.minter) || '';
      permSet('minter2:' + c, m);
    }
    return m;
  });
  const lps = [];
  cands.forEach((c, i) => { if (minters[i] && poolSet[minters[i]]) lps.push({ lp: c, pair: minters[i], pool: poolSet[minters[i]] }); });

  // a pool's share, valued: how much of each side one LP token is
  const shareCache = {};
  async function perLp(x){
    if (shareCache[x.pair]) return shareCache[x.pair];
    const d = await q(x.pair, { pool: {} });
    if (!d) return null;
    const total = Number(d.total_share || d.total_supply || 0);
    let sides = null;
    if (Array.isArray(d.assets) && d.assets.length === 2) sides = d.assets.map(a => ({ key: infoKey(a.info), raw: a.amount }));
    else if (d.asset1) sides = [{ key: infoKey(d.asset1), raw: d.reserve1 }, { key: infoKey(d.asset2), raw: d.reserve2 }];
    if (!total || !sides) return null;
    return (shareCache[x.pair] = { total: total, sides: sides });
  }
  function lpValue(x, lpRaw){
    const p = shareCache[x.pair];
    if (!p) return null;
    const frac = Number(lpRaw) / p.total;
    const mine = p.sides.filter(s => s.key === KEY)[0];
    const other = p.sides.filter(s => s.key !== KEY)[0];
    if (!mine || !other) return null;
    const a = amt(mine.raw, decOf(KEY)) * frac;
    const b = amt(other.raw, decOf(other.key)) * frac;
    // both sides of a pool are worth the same by construction
    const u = unit !== null ? a * unit * 2 : null;
    return { frac: frac, a: a, b: b, otherSym: symOf(other.key), usd: u };
  }

  for (const x of lps) {
    const b = await q(x.lp, { balance: { address: addr } });
    const raw = b && b.balance;
    x.raw = raw || '0';
    if (!raw || raw === '0') continue;
    await perLp(x);
    const v = lpValue(x, raw);
    if (!v) continue;
    out.push({ kind: 'pool', title: t.sym + ' / ' + v.otherSym + ' pool',
      sub: (x.pool.name || 'Liquidity') + ' \u00b7 ' + pct(v.frac) + ' of the pool',
      amount: v.a, extra: '+ ' + fmt(v.b) + ' ' + v.otherSym, usd: v.usd, tokUsd: unit !== null ? v.a * unit : null });
  }
  if (seq === SEQ) drawPositions(t, out, true);

  // Garuda pools keep the position in the pool itself, not in an LP token
  const gdPools = cands.filter(c => poolSet[c] && poolSet[c].dex === 'gd');
  for (const c of gdPools) {
    const d = (await q(c, { user_position: { user: addr } })) || (await q(c, { user_position: { address: addr } }));
    const n = d && firstNum(d, ['liquidity', 'shares', 'share', 'lp_amount', 'amount', 'balance']);
    if (!n) continue;
    await perLp({ pair: c });
    const v = lpValue({ pair: c }, n);
    if (!v) continue;
    out.push({ kind: 'pool', title: t.sym + ' / ' + v.otherSym + ' pool',
      sub: (poolSet[c].name || 'Garuda') + ' \u00b7 ' + pct(v.frac) + ' of the pool',
      amount: v.a, extra: '+ ' + fmt(v.b) + ' ' + v.otherSym, usd: v.usd, tokUsd: unit !== null ? v.a * unit : null });
  }
  if (seq === SEQ) drawPositions(t, out, true);

  // staking and farm contracts: by label first, then by what their config names
  const lpAddrs = lps.map(x => x.lp);
  const skip = {};
  lps.forEach(x => { skip[x.lp] = 1; skip[x.pair] = 1; });
  if (t.contract) skip[t.contract] = 1;
  const others = cands.filter(c => !skip[c] && !poolSet[c] && !minters[cands.indexOf(c)]);
  const labels = await mapLimit(others, 4, async function (c) {
    let l = permGet('label:' + c);
    if (l === undefined) {
      try { const r = await getJSON(LCD + '/cosmwasm/wasm/v1/contract/' + c, 10000, 1); l = ((r && r.contract_info) || {}).label || ''; }
      catch (e) { return ''; }
      permSet('label:' + c, l);
    }
    return l;
  });
  const stakers = others.filter((c, i) => /stak|farm|bond|lock|vault|reward|earn|incentive|gauge|deposit/i.test(labels[i] || ''));
  for (const c of stakers) {
    let cfg = permGet('cfg2:' + c);
    if (cfg === undefined) {
      const a = await ask(c, { config: {} });
      if (!a.ok && !a.refused) continue;            // no answer: try next open
      cfg = a.ok && a.data ? JSON.stringify(a.data) : '';
      permSet('cfg2:' + c, cfg);
    }
    const viaLp = lps.filter(x => cfg.indexOf(x.lp) >= 0)[0];
    const direct = t.contract ? cfg.indexOf(t.contract) >= 0 : cfg.indexOf('"' + t.denom + '"') >= 0;
    if (!viaLp && !direct) continue;
    const st = await stakedIn(c, addr);
    if (!st || !(Number(st.amount) > 0)) continue;
    const label = labels[others.indexOf(c)] || 'Staking contract';
    if (viaLp) {
      await perLp(viaLp);
      const v = lpValue(viaLp, st.amount);
      if (!v) continue;
      out.push({ kind: 'farm', title: t.sym + ' / ' + v.otherSym + ' farm', sub: label + ' \u00b7 ' + cut(c),
        amount: v.a, extra: '+ ' + fmt(v.b) + ' ' + v.otherSym, usd: v.usd, tokUsd: unit !== null ? v.a * unit : null, addr: c });
    } else {
      const a = amt(st.amount, t.dec || 6);
      out.push({ kind: 'stake', title: 'Staked on ' + label, sub: cut(c), amount: a,
        usd: unit !== null ? a * unit : null, addr: c,
        extra: st.reward && Number(st.reward) > 0 ? 'reward ' + fmt(amt(st.reward, 6)) : '' });
    }
  }
  if (seq === SEQ) drawPositions(t, out, false);
}

const pct = f => (f * 100 < 0.01 ? '<0.01' : (f * 100).toFixed(f * 100 < 1 ? 2 : 1)) + '%';

// The first field that looks like an amount, one level deep at most.
function firstNum(d, names){
  for (const n of names) if (d[n] !== undefined && /^\d+$/.test(String(d[n]))) return String(d[n]);
  for (const k in d) {
    const v = d[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const n of names) if (v[n] !== undefined && /^\d+$/.test(String(v[n]))) return String(v[n]);
    }
  }
  return null;
}

// The query shapes the staking contracts on this chain answer to. One of
// them usually works; the rest cost a refused request each, once.
const STAKE_QUERIES = [
  a => ({ staker_info: { staker: a } }),
  a => ({ staker_info: { address: a } }),
  a => ({ user_info: { address: a } }),
  a => ({ user_info: { user: a } }),
  a => ({ staker: { address: a } }),
  a => ({ stake_info: { address: a } }),
  a => ({ user_stake: { address: a } }),
  a => ({ deposit: { address: a } })
];
async function stakedIn(c, addr){
  const known = permGet('sq2:' + c);
  if (known === -1) return null;                 // refused every way once already
  const order = known !== undefined ? [STAKE_QUERIES[known]] : STAKE_QUERIES;
  let silent = false;
  for (let i = 0; i < order.length; i++) {
    const a = await ask(c, order[i](addr));
    if (!a.ok) { if (!a.refused) silent = true; continue; }
    const d = a.data || {};
    if (known === undefined) permSet('sq2:' + c, i);
    return {
      amount: firstNum(d, ['bond_amount', 'staked_amount', 'staked', 'stake', 'amount', 'balance', 'deposit', 'bonded', 'total_staked']) || '0',
      reward: firstNum(d, ['pending_reward', 'pending_rewards', 'reward', 'rewards', 'pending'])
    };
  }
  // only a contract that refused every shape is written off; silence is not a no
  if (known === undefined && !silent) permSet('sq2:' + c, -1);
  return null;
}

const KIND_ICON = {
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="3"/><path d="M16 12.5h2"/><path d="M6 6l9-3 1.5 3"/>',
  stake: '<path d="m12 3 8.5 4.7-8.5 4.7-8.5-4.7Z"/><path d="m3.5 12 8.5 4.7 8.5-4.7"/><path d="m3.5 16.4 8.5 4.7 8.5-4.7"/>',
  pool: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
  farm: '<path d="M12 21V11"/><path d="M12 11c0-4 3-6 7-6 0 4-3 6-7 6Z"/><path d="M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z"/>',
  gift: '<circle cx="9.2" cy="12" r="4.6"/><path d="M14 7.8a4.6 4.6 0 0 1 0 8.4"/><path d="M9.2 9.9v4.2"/>',
  wait: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
};

function drawPositions(t, list, still){
  const box = $('#tk-pos');
  // rewards are not more of the token you hold until they are claimed
  const counted = list.filter(p => p.kind !== 'gift');
  const total = counted.reduce((a, p) => a + (p.amount || 0), 0);
  // only this token's part: half a pool position is the other asset
  const part = p => p.tokUsd !== undefined ? p.tokUsd : p.usd;
  const totalUsd = counted.every(p => part(p) !== null && part(p) !== undefined)
    ? counted.reduce((a, p) => a + part(p), 0) : null;
  let html = '';
  if (list.length > 1 || (list.length && list[0].kind !== 'wallet')) {
    html += '<div class="tk-sum"><span>All of your ' + esc(t.sym) + '</span><b>' + fmt(total) + '</b>' +
      '<i>' + (totalUsd !== null ? money(totalUsd) : '') + '</i></div>';
  }
  html += list.map(function (p) {
    return '<div class="tk-pos' + (p.go ? ' tap' : '') + '"' + (p.go ? ' data-go-to="' + p.go + '"' : '') +
      (p.addr ? ' data-addr="' + p.addr + '"' : '') + '>' +
      '<div class="tk-pos-i ' + p.kind + '"><svg viewBox="0 0 24 24">' + (KIND_ICON[p.kind] || KIND_ICON.wallet) + '</svg></div>' +
      '<div class="tk-pos-m"><b>' + esc(p.title) + '</b><span>' + esc(p.sub) + '</span></div>' +
      '<div class="tk-pos-r"><b>' + fmt(p.amount || 0) + ' ' + esc(t.sym) + '</b>' +
      '<span>' + (p.extra ? esc(p.extra) : (p.usd !== null && p.usd !== undefined ? money(p.usd) : '')) + '</span></div>' +
      '</div>';
  }).join('');
  if (!list.length && !still) html = '<div class="tk-none">None of this token is in the wallet, a pool or a staking contract this address has used.</div>';
  if (still) html += '<div class="tk-looking"><i></i>Looking in pools and staking contracts</div>';
  else html += '<p class="tk-note">Found from the contracts this address has dealt with. A position missing here can be added by its contract address - send it to the team.</p>';
  box.innerHTML = html;
}

/* ---------------- activity ---------------- */
async function page(query){
  try {
    const r = await getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(query) +
      '&pagination.limit=15&order_by=ORDER_BY_DESC', 20000, 1);
    return r.tx_responses || [];
  } catch (e) { return []; }
}

async function activity(t, seq){
  const addr = me();
  let lists;
  if (t.contract) {
    lists = await Promise.all([
      page("message.sender='" + addr + "' AND wasm._contract_address='" + t.contract + "'"),
      page("wasm.to='" + addr + "' AND wasm._contract_address='" + t.contract + "'")
    ]);
  } else {
    lists = await Promise.all([
      page("message.sender='" + addr + "'"),
      page("transfer.recipient='" + addr + "'")
    ]);
  }
  if (seq !== SEQ) return;
  const seen = {}, all = [];
  for (const x of lists[0].concat(lists[1])) {
    if (!x || seen[x.txhash]) continue;
    // a native coin has no contract to filter by, so the transaction is kept
    // only if it names the denom somewhere
    if (!t.contract && JSON.stringify(x.tx || {}).indexOf(t.denom) < 0 &&
        JSON.stringify(x.logs || []).indexOf(t.denom) < 0) continue;
    seen[x.txhash] = 1;
    all.push(x);
  }
  all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  $('#tk-act').innerHTML = all.length
    ? all.slice(0, 8).map(x => rowHTML(x, addr, true)).join('')
    : '<div class="tk-none">No transactions with ' + esc(t.sym) + ' yet.</div>';
}

/* ---------------- wiring ---------------- */
function openLink(url){
  if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openLink) Telegram.WebApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

document.addEventListener('frontier:token', e => open(e.detail && e.detail.key));

const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
on('#tk-send', 'click', function () {
  tap();
  document.dispatchEvent(new CustomEvent('frontier:send-token', { detail: { key: KEY } }));
});
on('#tk-recv', 'click', function () { tap(); const r = $('#act-recv'); if (r) r.click(); });
on('#tk-swap', 'click', function () {
  tap();
  document.dispatchEvent(new CustomEvent('frontier:swap-from', { detail: { key: KEY } }));
});
on('#tk-act', 'click', function (e) {
  const r = e.target.closest('.ac-row');
  if (r) document.dispatchEvent(new CustomEvent('frontier:show-tx', { detail: { hash: r.dataset.hash } }));
});
on('#tk-pos', 'click', function (e) {
  const r = e.target.closest('[data-go-to]');
  if (r) { tap(); go(r.dataset.goTo); return; }
  const a = e.target.closest('[data-addr]');
  if (a) openLink(FINDER + a.dataset.addr);
});
on('#tk-about', 'click', async function (e) {
  const l = e.target.closest('[data-url]');
  if (l) { openLink(l.dataset.url); return; }
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  const i = c.querySelector('i');
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
    await navigator.clipboard.writeText(c.dataset.copy);
    if (i) i.textContent = 'copied';
  } catch (err) { if (i) i.textContent = 'copy refused'; }
  setTimeout(() => { if (i) i.textContent = 'copy'; }, 1500);
});

// a transfer while the page is open: the balance at the top follows it
document.addEventListener('frontier:tx', function () {
  const p = $('#st-token');
  if (!p || !p.classList.contains('on') || !KEY) return;
  [4000, 12000].forEach(ms => setTimeout(function () {
    if (!p.classList.contains('on')) return;
    CUR = rowFor(KEY);
    paintHead(CUR);
  }, ms));
});

export { open };
