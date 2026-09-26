/* Staking: LUNC delegated to validators, and the four things one can do with it.

   Stake       MsgDelegate            LUNC leaves the balance and starts earning
   Claim       MsgWithdrawDelegatorReward, one per validator with anything owed
   Unstake     MsgUndelegate          frozen for 21 days, earns nothing meanwhile
   Move        MsgBeginRedelegate     to another validator, no 21 day wait

   The screen reads four things from the chain and nothing else: delegations,
   rewards, unbonding entries, and the validator set. Every action goes through
   one sheet: pick, amount, review with the fee measured by simulation, and a
   second press to sign - the same two-press rule as Send. */
import { LCD, amt, fmt, getJSON } from './chain.js?v=25f512bb';
import { $, buzz } from './shell.js?v=25f512bb';
import { S } from './state.js?v=25f512bb';
import { luncRaw, refreshBalances } from './tokens.js?v=25f512bb';
import { dryRunStake, sendStake, toRaw } from './tx.js?v=25f512bb';

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

/* ---------------- the screen ---------------- */
let OPEN_ROW = null;

function draw(){
  const body = $('#stk-body');
  const d = DATA;
  const staked = d.dels.reduce((a, r) => a + r.amount, 0n);
  const reward = d.dels.reduce((a, r) => a + r.reward, 0n);
  const leaving = d.unbonding.reduce((a, u) => a + u.amount, 0n);
  $('#stk-count').textContent = d.dels.length ? d.dels.length + ' validator' + (d.dels.length > 1 ? 's' : '') : '';

  if (!d.dels.length && !d.unbonding.length) {
    body.innerHTML = '<div class="empty">Nothing staked yet. Delegating LUNC earns rewards and gives your address weight in governance votes.</div>' +
      '<button class="btn solid" id="stk-new" type="button">Stake LUNC</button>' +
      '<p class="tiny">Staked LUNC can be moved to another validator at any time. Unstaking takes ' + UNBOND_DAYS + ' days.</p>';
    wire();
    return;
  }

  let h = '<div class="bal" style="margin-bottom:12px"><div class="bal-label">Staked</div>' +
    '<div class="bal-value" style="font-size:32px">' + L(staked) + ' <span style="font-size:18px;color:var(--muted)">LUNC</span></div>' +
    '<div class="row-sub" style="margin-top:8px">Rewards ' + L(reward) + ' LUNC' +
    (leaving > 0n ? ' \u00b7 Unstaking ' + L(leaving) + ' LUNC' : '') + '</div></div>' +
    '<div class="stk-acts"><button class="btn solid" id="stk-new" type="button">Stake LUNC</button>' +
    '<button class="btn quiet" id="stk-claim" type="button"' + (reward >= 1000000n ? '' : ' disabled') + '>Claim rewards</button></div>';

  h += d.dels.map(r => {
    const v = d.byAddr[r.val] || { name: shortVal(r.val), rate: 0 };
    const flag = v.jailed ? ' <span class="stk-flag bad">jailed</span>' : (!v.bonded ? ' <span class="stk-flag">inactive</span>' : '');
    const open = OPEN_ROW === r.val;
    return '<div class="row stk-row' + (open ? ' open' : '') + '" data-val="' + esc(r.val) + '">' +
      '<span class="sym stk-ico">' + esc(v.name.slice(0, 1).toUpperCase()) + '</span>' +
      '<div class="row-main"><div class="row-name">' + esc(v.name) + flag + '</div>' +
      '<div class="row-amt">' + (v.rate * 100).toFixed(1) + '% commission \u00b7 reward ' + L(r.reward) + '</div></div>' +
      '<div class="row-val"><div class="row-fiat">' + L(r.amount) + '</div><div class="row-sub">LUNC</div></div>' +
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
      const days = Math.max(0, Math.ceil((u.at - Date.now()) / 86400000));
      return '<div class="row"><div class="row-main"><div class="row-name">' + L(u.amount) + ' LUNC</div>' +
        '<div class="row-amt">from ' + esc(v.name) + '</div></div>' +
        '<div class="row-val"><div class="row-sub">back on ' + u.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
        '</div><div class="row-sub">' + (days ? 'in ' + days + ' day' + (days > 1 ? 's' : '') : 'today') + '</div></div></div>';
    }).join('');
  }
  h += '<p class="tiny">Tap a validator to stake more, move or unstake. Moving is instant; unstaking takes ' + UNBOND_DAYS + ' days, and the LUNC earns nothing meanwhile.</p>';
  body.innerHTML = h;
  wire();
}

function wire(){
  const n = $('#stk-new'); if (n) n.addEventListener('click', () => startPick('delegate'));
  const c = $('#stk-claim'); if (c) c.addEventListener('click', startClaim);
  document.querySelectorAll('#stk-body .stk-row').forEach(el => el.addEventListener('click', function (ev) {
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
  try { await load(addr || addrOf()); draw(); }
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

// Validators to choose from: active, not jailed, with a search box. Sorted
// smallest voting power first by default - the largest few already decide too
// much, and a wallet that lists them on top keeps it that way.
function startPick(kind, from){
  FLOW = { kind: kind, from: from || null };
  sheet(true, kind === 'redelegate' ? 'Move to which validator?' : 'Stake with which validator?');
  view('<input type="search" id="stk-q" placeholder="Search validators" autocomplete="off">' +
    '<div class="stk-sort"><button class="dust on" data-sort="small">Smaller first</button>' +
    '<button class="dust" data-sort="big">Largest first</button><button class="dust" data-sort="fee">Lowest commission</button></div>' +
    '<div id="stk-vals" class="stk-vals"><div class="empty"><span class="spin"></span>Loading validators</div></div>');
  let sort = 'small';
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
        '<span class="sym stk-ico">' + esc(v.name.slice(0, 1).toUpperCase()) + '</span>' +
        '<div class="row-main"><div class="row-name">' + esc(v.name) + (top ? ' <span class="stk-flag">top 10</span>' : '') + '</div>' +
        '<div class="row-amt">' + share.toFixed(2) + '% of votes</div></div>' +
        '<div class="row-val"><div class="row-fiat">' + (v.rate * 100).toFixed(1) + '%</div><div class="row-sub">commission</div></div></button>';
    }).join('') || '<div class="empty">No validator matches.</div>';
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

function startClaim(){
  const owed = DATA.dels.filter(r => r.reward >= 1n);
  FLOW = { kind: 'claim', validators: owed.map(r => r.val), amount: owed.reduce((a, r) => a + r.reward, 0n).toString() };
  sheet(true, 'Claim rewards');
  review();
}

function msgsOf(f){
  if (f.kind === 'claim') return f.validators.map(v => ({ kind: 'claim', validator: v }));
  if (f.kind === 'redelegate') return [{ kind: 'redelegate', from: f.from, to: f.to, amount: f.amount }];
  return [{ kind: f.kind, validator: f.validator, amount: f.amount }];
}

function reviewLines(f){
  const a = L(f.amount) + ' LUNC';
  if (f.kind === 'claim') return [['Action', 'Claim rewards'], ['Amount', 'about ' + a],
    ['From', f.validators.length + ' validator' + (f.validators.length > 1 ? 's' : '')]];
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
    const go_ = $('#stk-go');
    go_.disabled = false;
    go_.textContent = f.kind === 'claim' ? 'Claim' : f.kind === 'delegate' ? 'Stake' : f.kind === 'undelegate' ? 'Unstake' : 'Move';
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

export { loadStaking, plain };
