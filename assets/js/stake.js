/* Staking: LUNC delegated to validators, and the four things one can do with it.

   Stake       MsgDelegate            LUNC leaves the balance and starts earning
   Claim       MsgWithdrawDelegatorReward, one per validator with anything owed
   Unstake     MsgUndelegate          frozen for 21 days, earns nothing meanwhile
   Move        MsgBeginRedelegate     to another validator, no 21 day wait

   The screen reads four things from the chain and nothing else: delegations,
   rewards, unbonding entries, and the validator set. Every action goes through
   one sheet: pick, amount, review with the fee measured by simulation, and a
   second press to sign - the same two-press rule as Send. */
import { LCD, amt, fmt, getJSON, prices } from './chain.js?v=a0316039';
import { $, buzz } from './shell.js?v=a0316039';
import { S } from './state.js?v=a0316039';
import { luncRaw, refreshBalances } from './tokens.js?v=a0316039';
import { dryRunStake, sendStake, toRaw } from './tx.js?v=a0316039';

const UNBOND_DAYS = 21;
// Left behind by "max" so the stake itself can still pay for its gas and the
// next transaction after it. A delegation simulates at roughly nine LUNC.
const RESERVE = 20000000n;
const MAX_ENTRIES = 7;         // the chain refuses an eighth unbonding per validator

const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = raw => fmt(amt(String(raw), 6));
const shortVal = v => v.slice(0, 16) + '\u2026' + v.slice(-4);

/* Validator pictures. A validator sets a Keybase key in its description
   (identity); Keybase serves the picture for it. The same lookup every
   explorer does. Only the URL is kept, for a week, and a validator with no
   key or no picture keeps its letter. */
const LOGO_TTL = 7 * 86400000;
function logoCached(id){
  if (!id) return null;
  try { const c = JSON.parse(localStorage.getItem('vlogo:' + id) || 'null'); if (c && Date.now() - c.t < LOGO_TTL) return c; } catch (e) {}
  return null;
}
function ico(v){
  const c = logoCached(v.ident);
  if (c && c.u) return '<span class="sym stk-ico"><img src="' + esc(c.u) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>';
  return '<span class="sym stk-ico"' + (v.ident && !c ? ' data-ident="' + esc(v.ident) + '"' : '') + '>' + esc(v.name.slice(0, 1).toUpperCase()) + '</span>';
}
let LOGO_Q = Promise.resolve();
function fillLogos(root){
  const els = [...root.querySelectorAll('.stk-ico[data-ident]')];
  const ids = [...new Set(els.map(e => e.getAttribute('data-ident')))];
  // four at a time, behind whatever is already being fetched
  LOGO_Q = LOGO_Q.then(async () => {
    for (let i = 0; i < ids.length; i += 4) {
      await Promise.all(ids.slice(i, i + 4).map(async id => {
        let u = '';
        if (!logoCached(id)) {
          try {
            const r = await fetch('https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=' + encodeURIComponent(id) + '&fields=pictures');
            const j = await r.json();
            u = (j.them && j.them[0] && j.them[0].pictures && j.them[0].pictures.primary && j.them[0].pictures.primary.url) || '';
            if (!/^https:\/\//.test(u)) u = '';
            try { localStorage.setItem('vlogo:' + id, JSON.stringify({ u: u, t: Date.now() })); } catch (e) {}
          } catch (e) { return; }
        } else u = logoCached(id).u;
        if (!u) return;
        document.querySelectorAll('.stk-ico[data-ident="' + id + '"]').forEach(el => {
          el.removeAttribute('data-ident');
          el.innerHTML = '<img src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
        });
      }));
    }
  }).catch(() => {});
}

/* ---------------- reading ---------------- */
let DATA = null;       // { dels, rewards, unbonding, vals, byAddr, bondedTotal }
let VALS_AT = 0;

async function validators(){
  if (DATA && DATA.vals && Date.now() - VALS_AT < 10 * 60000) return DATA.vals;
  const r = await getJSON(LCD + '/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300', 15000);
  VALS_AT = Date.now();
  return (r.validators || []).map(v => ({
    addr: v.operator_address,
    name: (v.description && v.description.moniker || '').trim() || shortVal(v.operator_address),
    site: v.description && v.description.website || '',
    ident: (v.description && v.description.identity || '').trim(),
    tokens: BigInt(v.tokens || '0'),
    rate: Number(v.commission && v.commission.commission_rates && v.commission.commission_rates.rate || 0),
    jailed: !!v.jailed,
    bonded: true
  }));
}

async function one(addr){
  try {
    const r = await getJSON(LCD + '/cosmos/staking/v1beta1/validators/' + addr, 10000);
    const v = r.validator || {};
    return { addr: addr, name: (v.description && v.description.moniker || '').trim() || shortVal(addr),
             ident: (v.description && v.description.identity || '').trim(),
             tokens: BigInt(v.tokens || '0'), rate: Number(v.commission && v.commission.commission_rates.rate || 0),
             jailed: !!v.jailed, bonded: v.status === 'BOND_STATUS_BONDED' };
  } catch (e) {
    return { addr: addr, name: shortVal(addr), tokens: 0n, rate: 0, jailed: false, bonded: false };
  }
}

async function load(addr){
  const [dels, rew, unb, vals] = await Promise.all([
    getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + addr),
    getJSON(LCD + '/cosmos/distribution/v1beta1/delegators/' + addr + '/rewards').catch(() => ({})),
    getJSON(LCD + '/cosmos/staking/v1beta1/delegators/' + addr + '/unbonding_delegations').catch(() => ({})),
    validators()
  ]);
  const byAddr = {};
  vals.forEach(v => { byAddr[v.addr] = v; });
  const bondedTotal = vals.reduce((a, v) => a + v.tokens, 0n);
  const rewardOf = {};
  (rew.rewards || []).forEach(r => {
    const u = (r.reward || []).find(c => c.denom === 'uluna');
    // rewards come as decimal strings with 18 places; only whole uluna can move
    rewardOf[r.validator_address] = u ? BigInt(String(u.amount).split('.')[0] || '0') : 0n;
  });
  const rows = (dels.delegation_responses || []).map(d => ({
    val: d.delegation.validator_address,
    amount: BigInt(d.balance && d.balance.amount || '0'),
    reward: rewardOf[d.delegation.validator_address] || 0n
  })).filter(r => r.amount > 0n || r.reward > 0n);
  // a delegation to a validator outside the active set still needs a name
  const missing = rows.filter(r => !byAddr[r.val]).map(r => r.val);
  (await Promise.all(missing.map(one))).forEach(v => { byAddr[v.addr] = v; });
  const unbonding = [];
  (unb.unbonding_responses || []).forEach(u => (u.entries || []).forEach(e => unbonding.push({
    val: u.validator_address, amount: BigInt(e.balance || '0'), at: new Date(e.completion_time)
  })));
  unbonding.sort((a, b) => a.at - b.at);
  DATA = { dels: rows, unbonding: unbonding, vals: vals, byAddr: byAddr, bondedTotal: bondedTotal };
  return DATA;
}

/* ---------------- staking return, from the chain ----------------
   Staking rewards on Terra Classic come from the oracle reward pool, which
   pays out 1/window of its balance every block, plus inflation if the mint
   module has any. Both are read from the node, the block time is measured
   from two real blocks, and the community tax comes off the top:

     APR = (pool / window * blocks per year + annual provisions)
           * (1 - community tax) / bonded LUNC

   That is before a validator's commission; a validator's own row shows it
   after. The pool's other denoms are ignored - LUNC is nearly all of it. */
let APR = null, APR_AT = 0;
async function stakingApr(){
  if (APR !== null && Date.now() - APR_AT < 30 * 60000) return APR;
  const one = (u, t) => getJSON(LCD + u, 12000, t || 2).catch(() => null);
  const [op, mod, dist, pool, mint, latest] = await Promise.all([
    one('/terra/oracle/v1beta1/params'), one('/cosmos/auth/v1beta1/module_accounts/oracle'),
    one('/cosmos/distribution/v1beta1/params'), one('/cosmos/staking/v1beta1/pool'),
    one('/cosmos/mint/v1beta1/annual_provisions', 1), one('/cosmos/base/tendermint/v1beta1/blocks/latest')
  ]);
  const win = Number(op && op.params && op.params.reward_distribution_window);
  const acc = mod && mod.account && (mod.account.base_account ? mod.account.base_account.address : mod.account.address);
  const bonded = Number(pool && pool.pool && pool.pool.bonded_tokens);
  if (!win || !acc || !bonded) return null;
  const bal = await one('/cosmos/bank/v1beta1/balances/' + acc + '/by_denom?denom=uluna');
  const inPool = Number(bal && bal.balance && bal.balance.amount || 0);
  // seconds per block, measured over the last 20,000 blocks; 6 s if that
  // block is already pruned from this node
  let spb = 6;
  try {
    const h = Number(latest.block.header.height), t1 = Date.parse(latest.block.header.time);
    const past = await one('/cosmos/base/tendermint/v1beta1/blocks/' + (h - 20000), 1);
    const t0 = Date.parse(past.block.header.time);
    if (t1 > t0) spb = (t1 - t0) / 1000 / 20000;
  } catch (e) {}
  const perYear = 31557600 / spb;
  const provisions = Number(mint && mint.annual_provisions || 0);
  const ctax = Number(dist && dist.params && dist.params.community_tax || 0);
  APR = ((inPool / win) * perYear + provisions) * (1 - ctax) / bonded;
  APR_AT = Date.now();
  return APR;
}
const pctTxt = x => (x == null || !isFinite(x)) ? '\u2014' : (x * 100).toFixed(x < 0.1 ? 2 : 1) + '%';

let PX = null;
async function luncUsd(){
  if (PX) return PX;
  try { const p = await prices(); if (p && p.LUNC) PX = p.LUNC; } catch (e) {}
  return PX;
}

/* ---------------- the screen ---------------- */
let OPEN_ROW = null;

const REWARD_MIN = 1000000n;   // 1 LUNC: below this a claim costs more gas than it brings

function donut(parts){
  // parts: [[value, color], ...]; a ring drawn with stroke dash offsets
  const total = parts.reduce((a, p) => a + p[0], 0) || 1;
  const C = 2 * Math.PI * 46;
  let off = 0, arcs = '';
  parts.forEach(p => {
    const len = C * p[0] / total;
    if (len > 0.5) arcs += '<circle cx="56" cy="56" r="46" fill="none" stroke="' + p[1] + '" stroke-width="12" stroke-dasharray="' +
      Math.max(0, len - 2).toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '" transform="rotate(-90 56 56)"/>';
    off += len;
  });
  return '<svg class="stk-donut" width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">' +
    '<circle cx="56" cy="56" r="46" fill="none" stroke="var(--border)" stroke-width="12"/>' + arcs + '</svg>';
}

function draw(){
  const body = $('#stk-body');
  const d = DATA;
  const staked = d.dels.reduce((a, r) => a + r.amount, 0n);
  const reward = d.dels.reduce((a, r) => a + r.reward, 0n);
  const claimable = d.dels.filter(r => r.reward >= REWARD_MIN).reduce((a, r) => a + r.reward, 0n);
  const leaving = d.unbonding.reduce((a, u) => a + u.amount, 0n);
  const free = BigInt(Math.floor(luncRaw() || 0));
  const usd = raw => PX ? '\u2248 $' + (amt(String(raw), 6) * PX).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
  $('#stk-count').textContent = 'LUNC \u00b7 Classic';

  if (!d.dels.length && !d.unbonding.length) {
    const top = d.vals.filter(v => !v.jailed && v.rate < 1).sort((a, b) => (b.tokens > a.tokens ? 1 : -1)).slice(0, 3);
    const total = d.bondedTotal || 1n;
    body.innerHTML =
      '<section class="stk-hero stk-hero-empty"><span class="stk-cap">Ready to stake</span>' +
      '<div class="stk-big">' + L(free) + ' <small>LUNC</small></div>' +
      '<p>Delegate to a validator to earn staking rewards and a say in governance votes. Your LUNC never leaves your wallet\'s control.</p>' +
      '<div class="stk-apr-line">Staking return now about <b id="stk-apr">' + pctTxt(APR) + '</b> a year, before commission</div>' +
      '<button class="btn solid" id="stk-new" type="button">Stake LUNC</button></section>' +
      '<div class="stk-steps">' + [['Pick', 'a validator'], ['Stake', 'any amount'], ['Claim', 'rewards anytime']].map((x, i) =>
        '<div><span>' + (i + 1) + '</span><b>' + x[0] + '</b><small>' + x[1] + '</small></div>').join('') + '</div>' +
      '<div class="head" style="margin:18px 4px 10px"><h2>Popular validators</h2><button class="dust" id="stk-all" type="button">See all</button></div>' +
      top.map(v => '<button class="row stk-val stk-pop" data-val="' + esc(v.addr) + '" type="button">' + ico(v) +
        '<div class="row-main"><div class="row-name">' + esc(v.name) + '</div><div class="row-amt">' +
        (Number(v.tokens * 10000n / total) / 100).toFixed(2) + '% of votes</div></div>' +
        '<div class="row-val"><div class="row-fiat">' + (v.rate * 100).toFixed(1) + '%</div><div class="row-sub">commission</div></div></button>').join('') +
      '<p class="tiny">Unstaking takes ' + UNBOND_DAYS + ' days. Moving stake to another validator is instant.</p>';
    fillLogos(body);
    wire();
    return;
  }

  const whole = Number(staked) + Number(free) + Number(leaving) || 1;
  const share = Math.round(Number(staked) * 100 / whole);
  let h = '<section class="stk-hero"><div class="stk-hero-top">' +
    '<div class="stk-ring">' + donut([[Number(staked), 'var(--accent)'], [Number(leaving), 'var(--accent2)']]) +
    '<div class="stk-ring-in"><b>' + share + '%</b><small>staked</small></div></div>' +
    '<div class="stk-hero-num"><span class="stk-cap">Total staked</span><div class="stk-big">' + L(staked) + '</div>' +
    '<small>LUNC ' + usd(staked) + '</small></div></div>' +
    '<div class="stk-tiles">' +
    '<div><small>Rewards</small><b class="g">' + L(reward) + '</b></div>' +
    '<div><small>Est. APR</small><b id="stk-apr">' + pctTxt(APR) + '</b></div>' +
    '<div><small>Unstaking</small><b class="c">' + L(leaving) + '</b></div></div>' +
    '<div class="stk-legend"><span><i style="background:var(--accent)"></i>Staked</span>' +
    '<span><i class="free"></i>Available ' + L(free) + '</span>' +
    '<span><i style="background:var(--accent2)"></i>Unstaking</span></div></section>';

  h += '<div class="stk-bigacts">' +
    '<button class="stk-bigact main" id="stk-new" type="button"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><b>Stake</b></button>' +
    '<button class="stk-bigact" id="stk-claim" type="button"' + (claimable > 0n ? '' : ' disabled') + '><svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><b>Claim</b><small class="g">' + L(claimable) + '</small></button>' +
    '<button class="stk-bigact" id="stk-restake" type="button"' + (claimable > 0n ? '' : ' disabled') + '><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg><b>Restake</b><small>claim + stake</small></button>' +
    '</div>';

  h += '<div class="head" style="margin:18px 4px 10px"><h2>Your validators</h2><span>' + d.dels.length + '</span></div>';
  h += d.dels.map(r => {
    const v = d.byAddr[r.val] || { name: shortVal(r.val), rate: 0 };
    const bad = v.jailed || !v.bonded;
    const open = OPEN_ROW === r.val;
    const part = staked > 0n ? Number(r.amount * 1000n / staked) / 10 : 0;
    return '<div class="stk-card' + (bad ? ' bad' : '') + (open ? ' open' : '') + '" data-val="' + esc(r.val) + '">' +
      '<div class="stk-card-top">' + ico(v) +
      '<div class="stk-card-mid"><div class="stk-card-name"><span>' + esc(v.name) + '</span>' +
      '<em class="' + (bad ? 'bad' : 'ok') + '">' + (v.jailed ? 'Jailed' : !v.bonded ? 'Inactive' : 'Active') + '</em></div>' +
      '<small>' + (v.rate * 100).toFixed(1) + '% commission' + (APR != null && !bad ? ' \u00b7 you earn ~' + pctTxt(APR * (1 - v.rate)) : '') + '</small></div>' +
      '<div class="stk-card-val"><b>' + L(r.amount) + '</b><small class="g">+' + L(r.reward) + '</small></div></div>' +
      '<div class="stk-bar"><i style="width:' + part + '%"></i></div>' +
      (bad ? '<div class="stk-card-warn">Not earning while ' + (v.jailed ? 'jailed' : 'outside the active set') + ' - move this stake to keep earning.</div>' : '') +
      (open ? '<div class="stk-row-acts">' +
        '<button class="dust" data-act="more">Stake more</button>' +
        '<button class="dust" data-act="move">Move</button>' +
        '<button class="dust" data-act="unstake">Unstake</button></div>' : '') +
      '</div>';
  }).join('');

  if (d.unbonding.length) {
    h += '<div class="head" style="margin:18px 4px 10px"><h2>Unstaking</h2><span>' + UNBOND_DAYS + ' days each</span></div>';
    h += d.unbonding.map(u => {
      const v = d.byAddr[u.val] || { name: shortVal(u.val) };
      const leftMs = Math.max(0, u.at - Date.now());
      const days = Math.ceil(leftMs / 86400000);
      const done = Math.min(UNBOND_DAYS, Math.max(0, UNBOND_DAYS - leftMs / 86400000));
      return '<div class="stk-unb"><div class="stk-unb-top"><b>' + L(u.amount) + ' LUNC</b><small>back on ' +
        u.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' \u00b7 ' + (days ? days + ' day' + (days > 1 ? 's' : '') : 'today') + '</small></div>' +
        '<div class="stk-bar c"><i style="width:' + (done * 100 / UNBOND_DAYS).toFixed(1) + '%"></i></div>' +
        '<small>from ' + esc(v.name) + ' \u00b7 ' + Math.floor(done) + ' of ' + UNBOND_DAYS + ' days</small></div>';
    }).join('');
  }
  h += '<p class="tiny">Tap a validator to stake more, move or unstake. Moving is instant; unstaking takes ' + UNBOND_DAYS + ' days, and the LUNC earns nothing meanwhile.</p>';
  body.innerHTML = h;
  fillLogos(body);
  wire();
}

function wire(){
  const n = $('#stk-new'); if (n) n.addEventListener('click', () => startPick('delegate'));
  const c = $('#stk-claim'); if (c) c.addEventListener('click', () => startClaim('claim'));
  const rs = $('#stk-restake'); if (rs) rs.addEventListener('click', () => startClaim('restake'));
  const all = $('#stk-all'); if (all) all.addEventListener('click', () => startPick('delegate'));
  document.querySelectorAll('#stk-body .stk-pop').forEach(b => b.addEventListener('click', () =>
    startAmount({ kind: 'delegate', validator: b.getAttribute('data-val') })));
  document.querySelectorAll('#stk-body .stk-card').forEach(el => el.addEventListener('click', function (ev) {
    const val = el.getAttribute('data-val');
    const btn = ev.target.closest('[data-act]');
    if (btn) {
      ev.stopPropagation();
      const act = btn.getAttribute('data-act');
      if (act === 'more') startAmount({ kind: 'delegate', validator: val });
      if (act === 'unstake') startAmount({ kind: 'undelegate', validator: val });
      if (act === 'move') startPick('redelegate', val);
      return;
    }
    OPEN_ROW = OPEN_ROW === val ? null : val;
    draw();
  }));
}

async function loadStaking(addr){
  const body = $('#stk-body');
  if (!DATA) body.innerHTML = '<div class="empty">Loading</div>';
  try {
    await load(addr || addrOf()); draw();
    // the return and the price arrive on their own and redraw what they touch
    Promise.all([stakingApr().catch(() => null), luncUsd()]).then(() => { if (DATA) draw(); });
  }
  catch (e) { body.innerHTML = '<div class="empty">Could not load staking: ' + esc(e.message || e) + '</div>'; }
}

/* ---------------- the sheet ---------------- */
let FLOW = null;       // { kind, validator | from, to, amount, armed }

function sheet(on, title){
  $('#stk-sheet').hidden = !on;
  if (title) $('#stk-sheet-title').textContent = title;
}
const view = html => { $('#stk-sheet-body').innerHTML = html; };

$('#stk-sheet-x').addEventListener('click', () => { FLOW = null; sheet(false); });
$('#stk-sheet').addEventListener('click', e => { if (e.target.id === 'stk-sheet') { FLOW = null; sheet(false); } });

// Validators to choose from: active, not jailed, with a search box. Sorted
// Largest first by default, the order people expect; "smaller first" is one
// tap away, and the top ten stay marked either way.
function startPick(kind, from){
  FLOW = { kind: kind, from: from || null };
  sheet(true, kind === 'redelegate' ? 'Move to which validator?' : 'Stake with which validator?');
  view('<input type="search" id="stk-q" placeholder="Search validators" autocomplete="off">' +
    '<div class="stk-sort"><button class="dust on" data-sort="big">Largest first</button>' +
    '<button class="dust" data-sort="small">Smaller first</button><button class="dust" data-sort="fee">Lowest commission</button></div>' +
    '<div id="stk-vals" class="stk-vals"><div class="empty"><span class="spin"></span>Loading validators</div></div>');
  let sort = 'big';
  const paint = () => {
    const q = ($('#stk-q').value || '').trim().toLowerCase();
    const total = DATA.bondedTotal || 1n;
    let list = DATA.vals.filter(v => !v.jailed && v.addr !== FLOW.from && v.rate < 1 &&
      (!q || v.name.toLowerCase().indexOf(q) >= 0 || v.addr.indexOf(q) >= 0));
    list.sort(sort === 'big' ? (a, b) => (b.tokens > a.tokens ? 1 : -1)
            : sort === 'fee' ? (a, b) => a.rate - b.rate || (a.tokens > b.tokens ? 1 : -1)
            : (a, b) => (a.tokens > b.tokens ? 1 : -1));
    const ranked = DATA.vals.slice().sort((a, b) => (b.tokens > a.tokens ? 1 : -1)).map(v => v.addr);
    $('#stk-vals').innerHTML = list.slice(0, 150).map(v => {
      const share = Number(v.tokens * 10000n / total) / 100;
      const top = ranked.indexOf(v.addr) < 10;
      return '<button class="row stk-val" data-val="' + esc(v.addr) + '" type="button">' +
        ico(v) +
        '<div class="row-main"><div class="row-name">' + esc(v.name) + (top ? ' <span class="stk-flag">top 10</span>' : '') + '</div>' +
        '<div class="row-amt">' + share.toFixed(2) + '% of votes</div></div>' +
        '<div class="row-val"><div class="row-fiat">' + (v.rate * 100).toFixed(1) + '%</div><div class="row-sub">commission</div></div></button>';
    }).join('') || '<div class="empty">No validator matches.</div>';
    fillLogos($('#stk-vals'));
    document.querySelectorAll('#stk-vals .stk-val').forEach(b => b.addEventListener('click', () => {
      const val = b.getAttribute('data-val');
      if (FLOW.kind === 'redelegate') startAmount({ kind: 'redelegate', from: FLOW.from, to: val });
      else startAmount({ kind: 'delegate', validator: val });
    }));
  };
  $('#stk-q').addEventListener('input', paint);
  document.querySelectorAll('#stk-sheet-body [data-sort]').forEach(b => b.addEventListener('click', () => {
    sort = b.getAttribute('data-sort');
    document.querySelectorAll('#stk-sheet-body [data-sort]').forEach(x => x.classList.toggle('on', x === b));
    paint();
  }));
  (DATA ? Promise.resolve() : load(addrOf())).then(paint).catch(e => {
    $('#stk-vals').innerHTML = '<div class="sbad">' + esc(e.message || e) + '</div>';
  });
}

const nameOf = a => (DATA.byAddr[a] || { name: shortVal(a) }).name;
const delegatedTo = a => (DATA.dels.find(r => r.val === a) || { amount: 0n }).amount;

function limits(f){
  if (f.kind === 'delegate') {
    const bal = BigInt(Math.floor(luncRaw() || 0));
    return { max: bal > RESERVE ? bal - RESERVE : 0n, label: 'Available', note: 'Keeps 20 LUNC for fees.' };
  }
  const had = delegatedTo(f.kind === 'redelegate' ? f.from : f.validator);
  return { max: had, label: 'Staked there', note: '' };
}

function startAmount(f){
  FLOW = Object.assign({}, f);
  const lim = limits(FLOW);
  const title = FLOW.kind === 'delegate' ? 'Stake LUNC' : FLOW.kind === 'undelegate' ? 'Unstake LUNC' : 'Move stake';
  sheet(true, title);
  const who = FLOW.kind === 'redelegate'
    ? esc(nameOf(FLOW.from)) + ' \u2192 ' + esc(nameOf(FLOW.to))
    : esc(nameOf(FLOW.validator));
  view('<div class="p2p-lines"><div class="p2p-line"><span>Validator</span><b>' + who + '</b></div></div>' +
    '<div class="field"><label>Amount <span class="tiny">' + lim.label + ' ' + L(lim.max) + ' LUNC</span></label>' +
    '<div style="display:flex;gap:8px;align-items:center"><input id="stk-amt" type="text" inputmode="decimal" placeholder="0.000000" autocomplete="off" style="flex:1">' +
    '<button class="dust" id="stk-max" type="button">max</button></div>' +
    (lim.note ? '<div class="tiny" style="text-align:left">' + lim.note + '</div>' : '') + '</div>' +
    '<div class="sbad" id="stk-err" hidden></div>' +
    '<button class="btn solid" id="stk-next" type="button">Review</button>');
  $('#stk-max').addEventListener('click', () => { $('#stk-amt').value = amt(String(lim.max), 6).toFixed(6).replace(/\.?0+$/, ''); });
  $('#stk-next').addEventListener('click', () => {
    const err = $('#stk-err');
    err.hidden = true;
    let raw;
    try { raw = BigInt(toRaw($('#stk-amt').value, 6)); }
    catch (e) { err.textContent = e.message; err.hidden = false; return; }
    if (raw <= 0n) { err.textContent = 'Enter an amount.'; err.hidden = false; return; }
    if (raw > lim.max) { err.textContent = 'That is more than ' + L(lim.max) + ' LUNC.'; err.hidden = false; return; }
    FLOW.amount = raw.toString();
    review();
  });
}

// Claim takes rewards to the balance; Restake takes them and stakes each one
// straight back with the validator that paid it, in the same transaction
// (withdraw runs first, so the delegate has the funds). Validators owing less
// than 1 LUNC are left out: each message adds gas, and a wallet spread thin
// could otherwise pay more in fee than it claims.
function startClaim(kind){
  const owed = DATA.dels.filter(r => r.reward >= REWARD_MIN);
  if (!owed.length) return;
  FLOW = { kind: kind, owed: owed.map(r => ({ val: r.val, amount: r.reward.toString() })),
           amount: owed.reduce((a, r) => a + r.reward, 0n).toString() };
  sheet(true, kind === 'restake' ? 'Restake rewards' : 'Claim rewards');
  review();
}

function msgsOf(f){
  if (f.kind === 'claim') return f.owed.map(o => ({ kind: 'claim', validator: o.val }));
  if (f.kind === 'restake') {
    const m = [];
    f.owed.forEach(o => { m.push({ kind: 'claim', validator: o.val }); m.push({ kind: 'delegate', validator: o.val, amount: o.amount }); });
    return m;
  }
  if (f.kind === 'redelegate') return [{ kind: 'redelegate', from: f.from, to: f.to, amount: f.amount }];
  return [{ kind: f.kind, validator: f.validator, amount: f.amount }];
}

function reviewLines(f){
  const a = L(f.amount) + ' LUNC';
  const n = f.owed ? f.owed.length + ' validator' + (f.owed.length > 1 ? 's' : '') : '';
  if (f.kind === 'claim') return [['Action', 'Claim rewards'], ['Amount', 'about ' + a], ['From', n]];
  if (f.kind === 'restake') return [['Action', 'Restake rewards'], ['Amount', a + ' back into stake'], ['With', n + ', each its own']];
  if (f.kind === 'delegate') return [['Action', 'Stake ' + a], ['Validator', nameOf(f.validator)],
    ['Commission', ((DATA.byAddr[f.validator] || {}).rate * 100 || 0).toFixed(1) + '% of rewards']];
  if (f.kind === 'undelegate') return [['Action', 'Unstake ' + a], ['Validator', nameOf(f.validator)],
    ['Back on', new Date(Date.now() + UNBOND_DAYS * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })]];
  return [['Action', 'Move ' + a], ['From', nameOf(f.from)], ['To', nameOf(f.to)]];
}

function warningOf(f){
  if (f.kind === 'undelegate') {
    const n = DATA.unbonding.filter(u => u.val === f.validator).length;
    return 'For ' + UNBOND_DAYS + ' days this LUNC earns nothing and cannot be sent or moved. It returns to your balance on its own.' +
      (n >= MAX_ENTRIES - 1 ? ' The chain allows ' + MAX_ENTRIES + ' unstakings in progress per validator; you have ' + n + '.' : '');
  }
  if (f.kind === 'redelegate') return 'The move is instant and keeps earning. For ' + UNBOND_DAYS +
    ' days this stake cannot be moved again from the new validator.';
  if (f.kind === 'delegate') return 'Staked LUNC earns rewards and can be moved at any time. Taking it back out takes ' + UNBOND_DAYS + ' days.';
  if (f.kind === 'restake') return 'Rewards go straight back into stake with the validator that paid them, and start earning too. Rewards under 1 LUNC per validator are left for later.';
  return '';
}

// Chain refusals that someone can act on, in words.
function plain(msg){
  const s = String(msg || '');
  if (/too many unbonding|max entries/i.test(s)) return 'This validator already has ' + MAX_ENTRIES + ' unstakings in progress. Wait for one to finish.';
  if (/redelegation.*in progress|transitive redelegation/i.test(s)) return 'This stake was moved in the last ' + UNBOND_DAYS + ' days and cannot be moved again yet.';
  if (/insufficient funds|insufficient fee|spendable balance/i.test(s)) return 'Not enough LUNC to cover this and its fee.';
  if (/no delegation|not found/i.test(s)) return 'There is no stake with this validator any more.';
  return s || 'unknown reason';
}

async function review(){
  const f = FLOW;
  const lines = reviewLines(f);
  const warn = warningOf(f);
  view('<div class="p2p-lines">' + lines.map(l => '<div class="p2p-line"><span>' + esc(l[0]) + '</span><b>' + esc(l[1]) + '</b></div>').join('') + '</div>' +
    '<div class="tiny" id="stk-fee" style="text-align:left">Checking with the chain\u2026</div>' +
    (warn ? '<div class="warn" style="margin:10px 0"><svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg><p>' + esc(warn) + '</p></div>' : '') +
    '<div id="stk-out"></div>' +
    '<button class="btn solid" id="stk-go" type="button" disabled>Confirm</button>');
  try {
    const est = await dryRunStake(addrOf(), msgsOf(f), S.MNEMONIC);
    if (FLOW !== f) return;
    const need = (f.kind === 'delegate' ? BigInt(f.amount) : 0n) + BigInt(est.gasFee);
    if (need > BigInt(Math.floor(luncRaw() || 0))) throw new Error('Not enough LUNC to cover this and its fee.');
    $('#stk-fee').textContent = 'Network fee about ' + fmt(est.gasFee / 1e6) + ' LUNC';
    if ((f.kind === 'claim' || f.kind === 'restake') && BigInt(est.gasFee) >= BigInt(f.amount)) {
      $('#stk-out').innerHTML = '<div class="sbad">The fee is more than the rewards. Waiting until they grow is cheaper.</div>';
    }
    const go_ = $('#stk-go');
    go_.disabled = false;
    go_.textContent = ({ claim: 'Claim', restake: 'Restake', delegate: 'Stake', undelegate: 'Unstake' })[f.kind] || 'Move';
    go_.addEventListener('click', () => confirm(go_, f));
  } catch (e) {
    if (FLOW !== f) return;
    $('#stk-fee').textContent = '';
    $('#stk-out').innerHTML = '<div class="sbad">' + esc(plain(e.message || e)) + '</div>';
  }
}

async function confirm(btn, f){
  if (f.sent) return;   // the same button becomes "Done" afterwards
  if (!f.armed) {
    f.armed = true;
    const label = btn.textContent;
    btn.textContent = 'Press again to sign';
    btn.classList.add('danger');
    setTimeout(() => {
      if (FLOW === f && f.armed && !f.sent) { f.armed = false; btn.textContent = label; btn.classList.remove('danger'); }
    }, 8000);
    return;
  }
  f.sent = true;
  btn.disabled = true;
  btn.classList.remove('danger');
  btn.textContent = 'Signing and sending\u2026';
  const out = $('#stk-out');
  try {
    const res = await sendStake(addrOf(), msgsOf(f), S.MNEMONIC);
    buzz('success');
    out.innerHTML = '<div class="sline strong"><span>Accepted by the node</span><b>' + res.hash.slice(0, 10) + '\u2026</b></div>';
    btn.textContent = 'Waiting for the block\u2026';
    const done = await res.wait();
    out.innerHTML = '<div class="sline strong"><span>' + (done ? 'Included in block ' + done.height : 'Sent, not seen in a block yet') +
      '</span><b>' + res.hash.slice(0, 10) + '\u2026' + res.hash.slice(-6) + '</b></div>';
    btn.textContent = 'Done';
    btn.disabled = false;
    btn.onclick = () => { FLOW = null; sheet(false); };
    OPEN_ROW = null;
    refreshBalances(true);
    setTimeout(() => { loadStaking(); refreshBalances(true); }, 6000);
    loadStaking();
  } catch (e) {
    buzz('error');
    out.innerHTML = '<div class="sbad">' + esc(plain(e.message || e)) + '</div>';
    btn.textContent = 'Failed';
  }
}

// Opened before this module loaded, or reopened: read now.
if (addrOf() && S.MNEMONIC) loadStaking();
// And again whenever the Stake tab comes on screen, so it is never stale.
(function () {
  const st = document.getElementById('st-stake');
  if (!st || typeof MutationObserver === 'undefined') return;
  let was = st.classList.contains('on');
  new MutationObserver(() => {
    const on = st.classList.contains('on');
    if (on && !was && addrOf()) loadStaking();
    was = on;
  }).observe(st, { attributes: true, attributeFilter: ['class'] });
})();
// The wallet opening is the signal to read; tokens.js fires it.
document.addEventListener('frontier:wallet', e => { DATA = null; loadStaking(e.detail && e.detail.addr); });

export { loadStaking, plain, stakingApr };
