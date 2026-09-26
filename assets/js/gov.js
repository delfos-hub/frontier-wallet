/* Governance: the chain's own proposals, and a vote on them from the wallet.

   Everything shown comes from the gov module on the node (cosmos.gov.v1):
   proposals, the live tally, the tallying rules, and this address's vote.
   A vote is one MsgVote, measured by simulation and signed with the same
   two-press rule as Send. The weight of a vote is the address's staked LUNC,
   and a vote can be changed until the voting period ends - both are said on
   screen, because both surprise people. */
import { LCD, amt, fmt, getJSON } from './chain.js?v=c4efe1cf';
import { $, buzz, go } from './shell.js?v=c4efe1cf';
import { S } from './state.js?v=c4efe1cf';
import { MEMO_MAX, dryRunVote, sendVote } from './tx.js?v=c4efe1cf';

const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = raw => fmt(amt(String(raw), 6));
const G = LCD + '/cosmos/gov/v1';
const UNKNOWN = { unknown: true };

const OPT = {
  VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No',
  VOTE_OPTION_NO_WITH_VETO: 'No with veto', VOTE_OPTION_ABSTAIN: 'Abstain'
};
const STATUS = {
  PROPOSAL_STATUS_DEPOSIT_PERIOD: 'Deposit', PROPOSAL_STATUS_VOTING_PERIOD: 'Voting',
  PROPOSAL_STATUS_PASSED: 'Passed', PROPOSAL_STATUS_REJECTED: 'Rejected',
  PROPOSAL_STATUS_FAILED: 'Failed'
};

/* ---------------- reading ---------------- */
function titleOf(p){
  const m = (p.messages || [])[0] || {};
  const c = m.content || {};
  return (p.title || c.title || '').trim() || 'Proposal #' + p.id;
}
function textOf(p){
  const m = (p.messages || [])[0] || {};
  const c = m.content || {};
  return (p.summary || c.description || '').trim();
}
// "/cosmos.distribution.v1beta1.CommunityPoolSpendProposal" -> "Community pool spend"
function kindOf(p){
  const m = (p.messages || [])[0];
  if (!m) return 'Text';
  const t = (m.content && m.content['@type']) || m['@type'] || '';
  let n = t.split('.').pop().replace(/^Msg/, '').replace(/Proposal$/, '');
  if (!n || n === 'ExecLegacyContent') n = 'Text';
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/* ---------------- who voted, and what they said ----------------
   A validator votes from its account address, which is its operator address
   with the other prefix: same 20 bytes, different bech32 wrapping. */
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(v){
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let c = 1;
  for (const x of v) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= G[i]; }
  return c;
}
const hrpx = h => [...h].map(c => c.charCodeAt(0) >> 5).concat([0], [...h].map(c => c.charCodeAt(0) & 31));
function rewrap(addr, hrp){
  const s = String(addr).toLowerCase(), k = s.lastIndexOf('1');
  if (k < 1) return null;
  const data = [...s.slice(k + 1)].map(c => B32.indexOf(c));
  if (data.some(d => d < 0) || polymod(hrpx(s.slice(0, k)).concat(data)) !== 1) return null;
  const payload = data.slice(0, -6);
  const pm = polymod(hrpx(hrp).concat(payload, [0, 0, 0, 0, 0, 0])) ^ 1;
  const sum = [0, 1, 2, 3, 4, 5].map(i => (pm >> (5 * (5 - i))) & 31);
  return hrp + '1' + payload.concat(sum).map(d => B32[d]).join('');
}
const accOf = valoper => rewrap(valoper, 'terra');

// Memos that only name the app that sent the vote are not comments.
const APP_TAG = /^\s*(vote[ds]?|voting|voted)\s+(with|via|using|from)\b[^.!?]{0,40}$/i;

let VALS = null, VALS_AT = 0;
async function validators(){
  if (VALS && Date.now() - VALS_AT < 10 * 60000) return VALS;
  const r = await getJSON(LCD + '/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300', 15000);
  VALS = (r.validators || []).map(v => ({
    op: v.operator_address, acc: accOf(v.operator_address),
    name: (v.description && v.description.moniker || '').trim() || v.operator_address.slice(0, 18) + '\u2026',
    tokens: BigInt(v.tokens || '0')
  })).sort((a, b) => (b.tokens > a.tokens ? 1 : b.tokens < a.tokens ? -1 : 0));
  VALS_AT = Date.now();
  return VALS;
}

const VOTERS = {};     // proposal id -> { votes: {addr: option}, memo: {addr: text}, stake: {addr: bigint} }
async function voters(id){
  if (VOTERS[id] && Date.now() - VOTERS[id].at < 3 * 60000) return VOTERS[id];
  const votes = {};
  let key = '';
  for (let i = 0; i < 10; i++) {
    const r = await getJSON(G + '/proposals/' + id + '/votes?pagination.limit=1000' + (key ? '&pagination.key=' + encodeURIComponent(key) : ''));
    (r.votes || []).forEach(v => { votes[v.voter] = v.options && v.options[0] ? v.options[0].option : ''; });
    key = r.pagination && r.pagination.next_key;
    if (!key) break;
  }
  // Newest first, so the first memo seen for a voter belongs to the vote that
  // counts. An older vote's reason is not shown under a changed vote.
  const memo = {}, seen = {};
  const q = encodeURIComponent('proposal_vote.proposal_id=' + id);
  for (let page = 1; page <= 10; page++) {
    let r;
    try { r = await getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + q + '&limit=100&page=' + page + '&order_by=ORDER_BY_DESC', 25000, 2); }
    catch (e) { break; }
    const txs = r.tx_responses || [];
    txs.forEach(t => {
      const m = ((t.tx && t.tx.body && t.tx.body.messages) || []).find(x => x.voter);
      if (!m || seen[m.voter]) return;
      seen[m.voter] = 1;
      const text = String(t.tx.body.memo || '').trim();
      if (text && !APP_TAG.test(text)) memo[m.voter] = text.slice(0, 600);
    });
    if (txs.length < 100) break;
  }
  // stake of commenters who are not validators, to rank them
  const vals = await validators();
  const valAcc = new Set(vals.map(v => v.acc));
  const others = Object.keys(memo).filter(a => !valAcc.has(a));
  const stake = {};
  await Promise.all(others.map(a => getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + a, 10000, 1)
    .then(r => { stake[a] = (r.delegation_responses || []).reduce((s, d) => s + BigInt(d.balance && d.balance.amount || '0'), 0n); })
    .catch(() => { stake[a] = 0n; })));
  VOTERS[id] = { votes: votes, memo: memo, stake: stake, at: Date.now() };
  return VOTERS[id];
}

let DATA = null;       // { live, recent, rules, bonded, power, mine }

async function load(addr){
  const [live, recent, rules, pool, dels] = await Promise.all([
    getJSON(G + '/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=50'),
    getJSON(G + '/proposals?pagination.limit=12&pagination.reverse=true').catch(() => ({ proposals: [] })),
    getJSON(G + '/params/tallying').catch(() => ({})),
    getJSON(LCD + '/cosmos/staking/v1beta1/pool').catch(() => ({})),
    addr ? getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + addr).catch(() => ({})) : Promise.resolve({})
  ]);
  const props = (live.proposals || []).sort((a, b) => new Date(a.voting_end_time) - new Date(b.voting_end_time));
  const [tallies, mine] = await Promise.all([
    Promise.all(props.map(p => getJSON(G + '/proposals/' + p.id + '/tally').then(r => r.tally).catch(() => null))),
    Promise.all(props.map(p => addr
      // only a refusal (400/404) means "no vote"; a failed read is unknown,
      // and unknown is not shown as "not voted"
      ? getJSON(G + '/proposals/' + p.id + '/votes/' + addr, 10000, 1).then(r => r.vote)
          .catch(e => (e && (e.status === 400 || e.status === 404)) ? null : UNKNOWN)
      : Promise.resolve(null)))
  ]);
  props.forEach((p, i) => { p._tally = tallies[i]; p._mine = mine[i]; });
  const liveIds = new Set(props.map(p => p.id));
  const tp = rules.tally_params || rules.params || {};
  DATA = {
    live: props,
    recent: (recent.proposals || []).filter(p => !liveIds.has(p.id)).slice(0, 10),
    rules: { quorum: Number(tp.quorum || 0.4), threshold: Number(tp.threshold || 0.5), veto: Number(tp.veto_threshold || 0.334),
             expedited: Number((rules.params && rules.params.expedited_threshold) || tp.expedited_threshold || 0.667) },
    bonded: BigInt((pool.pool && pool.pool.bonded_tokens) || '0'),
    power: (dels.delegation_responses || []).reduce((a, d) => a + BigInt(d.balance && d.balance.amount || '0'), 0n)
  };
  return DATA;
}

// Where the vote stands against the chain's own rules.
// An expedited proposal passes on a higher threshold (0.667 on mainnet).
const rulesFor = (p, rules) => p && p.expedited ? Object.assign({}, rules, { threshold: rules.expedited }) : rules;
function standing(t, rules, bonded){
  const y = BigInt(t.yes_count || '0'), n = BigInt(t.no_count || '0'),
        v = BigInt(t.no_with_veto_count || '0'), a = BigInt(t.abstain_count || '0');
  const all = y + n + v + a, decisive = y + n + v;
  const pct = x => all > 0n ? Number(x * 10000n / all) / 100 : 0;
  const turnout = bonded > 0n ? Number(all * 10000n / bonded) / 100 : 0;
  let verdict;
  if (turnout < rules.quorum * 100) verdict = { ok: false, text: 'Quorum not reached (' + turnout.toFixed(1) + '% of ' + (rules.quorum * 100).toFixed(0) + '%)' };
  else if (all > 0n && Number(v * 10000n / all) / 10000 > rules.veto) verdict = { ok: false, text: 'Vetoed' };
  else if (decisive > 0n && Number(y * 10000n / decisive) / 10000 > rules.threshold) verdict = { ok: true, text: 'Passing' };
  else verdict = { ok: false, text: 'Not passing' };
  return { yes: pct(y), no: pct(n), veto: pct(v), abstain: pct(a), turnout: turnout, verdict: verdict };
}

function left(end){
  const ms = new Date(end) - Date.now();
  if (ms <= 0) return 'ending now';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000);
  return d ? d + 'd ' + h + 'h left' : h ? h + 'h left' : Math.ceil(ms / 60000) + 'm left';
}

/* ---------------- the screen ---------------- */
function bar(s){
  return '<div class="gov-bar">' +
    '<i class="y" style="width:' + s.yes + '%"></i><i class="n" style="width:' + s.no + '%"></i>' +
    '<i class="v" style="width:' + s.veto + '%"></i><i class="a" style="width:' + s.abstain + '%"></i></div>';
}

function draw(){
  const body = $('#gov-body');
  const d = DATA;
  let h = '';
  if (d.power === 0n) {
    h += '<div class="warn" style="margin-bottom:12px"><svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>' +
      '<p>A vote weighs as much as the LUNC this address has staked. With nothing staked it counts for nothing. <a href="#" id="gov-to-stake">Stake LUNC</a></p></div>';
  }
  h += '<div class="head" style="margin:0 4px 10px"><h2>Voting now</h2><span>' + d.live.length + '</span></div>';
  if (!d.live.length) h += '<div class="empty">No proposal is in its voting period right now.</div>';
  h += d.live.map(p => {
    const s = p._tally ? standing(p._tally, rulesFor(p, d.rules), d.bonded) : null;
    const mine = p._mine && p._mine.options && p._mine.options[0] ? OPT[p._mine.options[0].option] : null;
    const unknown = p._mine === UNKNOWN;
    return '<button class="row gov-row" data-id="' + esc(p.id) + '" type="button"><div class="row-main">' +
      '<div class="row-name">#' + esc(p.id) + ' ' + esc(titleOf(p)) + '</div>' +
      '<div class="row-amt">' + esc(kindOf(p)) + ' \u00b7 ' + left(p.voting_end_time) +
      (mine ? ' \u00b7 <b class="gov-mine">you: ' + esc(mine) + '</b>' : unknown ? '' : ' \u00b7 <b class="gov-todo">not voted</b>') + '</div>' +
      (s ? bar(s) + '<div class="row-sub ' + (s.verdict.ok ? 'gov-ok' : 'gov-bad') + '">' + esc(s.verdict.text) +
        ' \u00b7 Yes ' + s.yes.toFixed(1) + '% \u00b7 No ' + s.no.toFixed(1) + '% \u00b7 Veto ' + s.veto.toFixed(1) + '%</div>' : '') +
      '</div></button>';
  }).join('');
  if (d.recent.length) {
    h += '<div class="head" style="margin:18px 4px 10px"><h2>Recent</h2></div>';
    h += d.recent.map(p => '<button class="row gov-row" data-id="' + esc(p.id) + '" data-old="1" type="button"><div class="row-main">' +
      '<div class="row-name">#' + esc(p.id) + ' ' + esc(titleOf(p)) + '</div>' +
      '<div class="row-amt">' + esc(kindOf(p)) + ' \u00b7 <b class="gov-st-' + esc((STATUS[p.status] || '').toLowerCase()) + '">' +
      esc(STATUS[p.status] || p.status) + '</b></div></div></button>').join('');
  }
  h += '<p class="tiny">Proposals come straight from the chain\'s governance module. Your vote weight is your staked LUNC' +
    (d.power > 0n ? ' - ' + L(d.power) + ' LUNC now' : '') + '. A vote can be changed until voting ends; the last one counts. If you do not vote, your validator\'s vote counts for your stake.</p>';
  body.innerHTML = h;
  document.querySelectorAll('#gov-body .gov-row').forEach(b => b.addEventListener('click', () => open(b.getAttribute('data-id'))));
  const st = $('#gov-to-stake');
  if (st) st.addEventListener('click', e => { e.preventDefault(); go('stake'); });
}

let LOADING = false;
async function loadGov(){
  if (LOADING) return;
  LOADING = true;
  const body = $('#gov-body');
  if (!DATA) body.innerHTML = '<div class="empty"><span class="spin"></span>Reading proposals</div>';
  try { await load(addrOf()); draw(); badgeFromData(); }
  catch (e) { body.innerHTML = '<div class="empty">Could not read proposals: ' + esc(e.message || e) + '</div>'; }
  finally { LOADING = false; }
}

/* ---------------- one proposal ---------------- */
let FLOW = null;

function sheet(on){ $('#gov-sheet').hidden = !on; }
$('#gov-sheet-x').addEventListener('click', () => { FLOW = null; sheet(false); });
$('#gov-sheet').addEventListener('click', e => { if (e.target.id === 'gov-sheet') { FLOW = null; sheet(false); } });

function open(id){
  const p = DATA.live.find(x => String(x.id) === String(id)) || DATA.recent.find(x => String(x.id) === String(id));
  if (!p) return;
  const live = DATA.live.indexOf(p) >= 0;
  FLOW = { id: String(p.id), live: live };
  $('#gov-sheet-title').textContent = 'Proposal #' + p.id;
  const s = live && p._tally ? standing(p._tally, rulesFor(p, DATA.rules), DATA.bonded) : null;
  const mine = p._mine && p._mine.options && p._mine.options[0] ? OPT[p._mine.options[0].option] : null;
  const text = textOf(p);
  let h = '<h3 class="gov-title">' + esc(titleOf(p)) + '</h3>' +
    '<div class="p2p-lines">' +
    '<div class="p2p-line"><span>Type</span><b>' + esc(kindOf(p)) + (p.expedited ? ' \u00b7 expedited, passes at ' + (DATA.rules.expedited * 100).toFixed(1) + '%' : '') + '</b></div>' +
    '<div class="p2p-line"><span>Status</span><b>' + esc(STATUS[p.status] || p.status) + (live ? ' \u00b7 ' + left(p.voting_end_time) : '') + '</b></div>' +
    (live ? '<div class="p2p-line"><span>Ends</span><b>' + new Date(p.voting_end_time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</b></div>' : '') +
    (s ? '<div class="p2p-line"><span>Turnout</span><b>' + s.turnout.toFixed(1) + '% (quorum ' + (DATA.rules.quorum * 100).toFixed(0) + '%)</b></div>' : '') +
    (mine ? '<div class="p2p-line"><span>Your vote</span><b>' + esc(mine) + '</b></div>' : '') +
    '</div>';
  if (s) h += bar(s) + '<div class="gov-legend"><span class="y">Yes ' + s.yes.toFixed(1) + '%</span><span class="n">No ' + s.no.toFixed(1) +
    '%</span><span class="v">Veto ' + s.veto.toFixed(1) + '%</span><span class="a">Abstain ' + s.abstain.toFixed(1) + '%</span></div>' +
    '<div class="row-sub ' + (s.verdict.ok ? 'gov-ok' : 'gov-bad') + '" style="margin:6px 0 10px">' + esc(s.verdict.text) + '</div>';
  if (text) {
    const long = text.length > 700;
    h += '<div class="gov-text' + (long ? ' clip' : '') + '" id="gov-text">' + esc(text) + '</div>' +
      (long ? '<button class="dust" id="gov-more" type="button">Show all</button>' : '');
  }
  if (live) {
    h += '<div class="gov-opts">' +
      ['yes', 'no', 'veto', 'abstain'].map(o => '<button class="dust gov-opt" data-opt="' + o + '" type="button">' +
        ({ yes: 'Yes', no: 'No', veto: 'No with veto', abstain: 'Abstain' })[o] + '</button>').join('') + '</div>' +
      '<div id="gov-review"></div>';
  }
  h += '<div id="gov-voters"><div class="empty"><span class="spin"></span>Reading votes and comments</div></div>';
  $('#gov-sheet-body').innerHTML = h;
  sheet(true);
  showVoters(String(p.id));
  const more = $('#gov-more');
  if (more) more.addEventListener('click', () => { $('#gov-text').classList.remove('clip'); more.remove(); });
  document.querySelectorAll('#gov-sheet-body .gov-opt').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#gov-sheet-body .gov-opt').forEach(x => x.classList.toggle('on', x === b));
    review(b.getAttribute('data-opt'));
  }));
}

const LABEL = { yes: 'Yes', no: 'No', veto: 'No with veto', abstain: 'Abstain' };
const OPT_CLASS = { VOTE_OPTION_YES: 'y', VOTE_OPTION_NO: 'n', VOTE_OPTION_NO_WITH_VETO: 'v', VOTE_OPTION_ABSTAIN: 'a' };
const shortAcc = a => a.slice(0, 12) + '\u2026' + a.slice(-5);

async function showVoters(id){
  const box = $('#gov-voters');
  let v, vals;
  try { [v, vals] = await Promise.all([voters(id), validators()]); }
  catch (e) { if (box) box.innerHTML = '<div class="tiny">Could not read the votes: ' + esc(e.message || e) + '</div>'; return; }
  if (!FLOW || FLOW.id !== id || !$('#gov-voters')) return;
  const total = vals.reduce((a, x) => a + x.tokens, 0n) || 1n;
  const tag = o => o ? '<b class="gov-v ' + (OPT_CLASS[o] || '') + '">' + esc(OPT[o] || o) + '</b>' : '<b class="gov-v none">not voted</b>';
  const valRows = vals.map((x, i) => {
    const o = v.votes[x.acc], c = v.memo[x.acc];
    return '<div class="gov-voter' + (i >= 20 ? ' more' : '') + '"><div class="gov-voter-top"><span class="gov-rank">' + (i + 1) + '</span>' +
      '<span class="gov-who">' + esc(x.name) + '</span><span class="gov-vp">' + (Number(x.tokens * 10000n / total) / 100).toFixed(2) + '%</span>' + tag(o) + '</div>' +
      (c ? '<div class="gov-memo">' + esc(c) + '</div>' : '') + '</div>';
  }).join('');
  const voted = vals.filter(x => v.votes[x.acc]).length;
  const valAcc = new Set(vals.map(x => x.acc));
  const people = Object.keys(v.memo).filter(a => !valAcc.has(a))
    .sort((a, b) => (v.stake[b] > v.stake[a] ? 1 : v.stake[b] < v.stake[a] ? -1 : 0));
  let h = '<div class="head" style="margin:16px 2px 8px"><h2>Validators</h2><span>' + voted + ' of ' + vals.length + ' voted</span></div>' +
    '<div class="gov-voters" id="gov-vals">' + valRows + '</div>' +
    (vals.length > 20 ? '<button class="dust" id="gov-vals-all" type="button">Show all ' + vals.length + '</button>' : '');
  h += '<div class="head" style="margin:16px 2px 8px"><h2>Comments</h2><span>' + people.length + '</span></div>';
  h += people.length ? '<div class="gov-voters">' + people.map(a =>
    '<div class="gov-voter"><div class="gov-voter-top"><span class="gov-who">' + esc(shortAcc(a)) + '</span>' +
    '<span class="gov-vp">' + (v.stake[a] > 0n ? L(v.stake[a]) + ' LUNC' : 'no stake') + '</span>' + tag(v.votes[a]) + '</div>' +
    '<div class="gov-memo">' + esc(v.memo[a]) + '</div></div>').join('') + '</div>'
    : '<div class="tiny">No voter has left a comment yet. Comments are read from the memo of each vote.</div>';
  box.innerHTML = h;
  const all = $('#gov-vals-all');
  if (all) all.addEventListener('click', () => { $('#gov-vals').classList.add('all'); all.remove(); });
}


async function review(opt){
  const f = FLOW;
  f.opt = opt; f.armed = false; f.sent = false;
  const out = $('#gov-review');
  out.innerHTML = '<div class="p2p-lines"><div class="p2p-line"><span>Vote</span><b>' + esc(LABEL[opt]) + ' on #' + esc(f.id) + '</b></div>' +
    '<div class="p2p-line"><span>Weight</span><b>' + (DATA.power > 0n ? L(DATA.power) + ' LUNC staked' : 'none - nothing staked') + '</b></div></div>' +
    (opt === 'veto' ? '<p class="tiny" style="text-align:left">No with veto also counts as No. If vetoes pass ' + (DATA.rules.veto * 100).toFixed(1) +
      '% the proposal fails and its deposit is burned.</p>' : '') +
    '<div class="field" style="margin-top:10px"><label>Comment <span class="tiny">optional, public, in the vote memo</span></label>' +
    '<textarea id="gov-memo" rows="3" placeholder="Why you vote this way"></textarea>' +
    '<div class="tiny" id="gov-memo-n" style="text-align:right">0 / ' + MEMO_MAX + '</div></div>' +
    '<div class="tiny" id="gov-fee" style="text-align:left">Checking with the chain\u2026</div>' +
    '<div id="gov-out"></div><button class="btn solid" id="gov-go" type="button" disabled>Vote ' + esc(LABEL[opt]) + '</button>';
  // The limit is in bytes (the chain's max_memo_characters counts bytes), so
  // accents and emoji use more than one each. Over it, the button waits.
  const memoBox = $('#gov-memo');
  const memoOver = () => new TextEncoder().encode(memoBox.value.trim()).length > MEMO_MAX;
  memoBox.addEventListener('input', () => {
    const n = new TextEncoder().encode(memoBox.value.trim()).length;
    $('#gov-memo-n').textContent = n + ' / ' + MEMO_MAX + (n > MEMO_MAX ? ' - too long' : '');
    $('#gov-memo-n').style.color = n > MEMO_MAX ? 'var(--red)' : '';
    const b = $('#gov-go');
    if (b && f.ready && !f.sent) b.disabled = n > MEMO_MAX;
  });
  try {
    const est = await dryRunVote(addrOf(), f.id, opt, S.MNEMONIC);
    if (FLOW !== f || f.opt !== opt) return;
    $('#gov-fee').textContent = 'Network fee about ' + fmt(est.gasFee / 1e6) + ' LUNC';
    const btn = $('#gov-go');
    f.ready = true;
    btn.disabled = memoOver();
    btn.addEventListener('click', () => confirm(btn, f, opt));
  } catch (e) {
    if (FLOW !== f || f.opt !== opt) return;
    $('#gov-fee').textContent = '';
    $('#gov-out').innerHTML = '<div class="sbad">' + esc(e.message || e) + '</div>';
  }
}

async function confirm(btn, f, opt){
  if (f.sent || f.opt !== opt) return;
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
  document.querySelectorAll('#gov-sheet-body .gov-opt').forEach(x => { x.disabled = true; });
  const out = $('#gov-out');
  try {
    const memo = ($('#gov-memo') && $('#gov-memo').value || '').trim();
    $('#gov-memo').disabled = true;
    const res = await sendVote(addrOf(), f.id, opt, S.MNEMONIC, memo);
    buzz('success');
    btn.textContent = 'Waiting for the block\u2026';
    const done = await res.wait();
    out.innerHTML = '<div class="sline strong"><span>' + (done ? 'Voted ' + esc(LABEL[opt]) + ', block ' + done.height : 'Sent, not seen in a block yet') +
      '</span><b>' + res.hash.slice(0, 10) + '\u2026</b></div>';
    btn.textContent = 'Done';
    btn.disabled = false;
    btn.onclick = () => { FLOW = null; sheet(false); };
    delete VOTERS[f.id];
    loadGov();
  } catch (e) {
    buzz('error');
    out.innerHTML = '<div class="sbad">' + esc(e.message || e) + '</div>';
    btn.textContent = 'Failed';
  }
}

/* ---------------- the number on the Vote tab ----------------
   How many proposals are in their voting period right now, read on its own
   (one light request) so it shows before anyone opens the tab. Accent when at
   least one of them still has no vote from this address. */
async function badge(){
  const b = document.getElementById('gov-badge');
  if (!b) return;
  try {
    const r = await getJSON(G + '/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=50', 15000, 2);
    const live = r.proposals || [];
    b.textContent = live.length > 9 ? '9+' : String(live.length);
    b.hidden = !live.length;
    const a = addrOf();
    if (!a || !live.length) return;
    const mine = await Promise.all(live.map(p => getJSON(G + '/proposals/' + p.id + '/votes/' + a, 10000, 1).then(() => 1)
      .catch(e => (e && (e.status === 400 || e.status === 404)) ? 0 : 1)));
    b.classList.toggle('todo', mine.some(x => !x));
  } catch (e) { /* the tab works without it */ }
}
function badgeFromData(){
  const b = document.getElementById('gov-badge');
  if (!b || !DATA) return;
  b.textContent = DATA.live.length > 9 ? '9+' : String(DATA.live.length);
  b.hidden = !DATA.live.length;
  b.classList.toggle('todo', DATA.live.some(p => !p._mine));   // UNKNOWN is truthy: not counted
}
setTimeout(badge, 3000);
setInterval(badge, 10 * 60000);

// Read whenever the tab comes on screen, so the tally is never stale.
(function () {
  const st = document.getElementById('st-gov');
  if (!st || typeof MutationObserver === 'undefined') return;
  let was = st.classList.contains('on');
  new MutationObserver(() => {
    const on = st.classList.contains('on');
    if (on && !was) loadGov();
    was = on;
  }).observe(st, { attributes: true, attributeFilter: ['class'] });
})();

export { loadGov, standing, kindOf, rewrap, APP_TAG };
