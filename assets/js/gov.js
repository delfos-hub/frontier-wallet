/* Governance: the chain's own proposals, and a vote on them from the wallet.

   Everything shown comes from the gov module on the node (cosmos.gov.v1):
   proposals, the live tally, the tallying rules, and this address's vote.
   A vote is one MsgVote, measured by simulation and signed with the same
   two-press rule as Send. The weight of a vote is the address's staked LUNC,
   and a vote can be changed until the voting period ends - both are said on
   screen, because both surprise people. */
import { LCD, amt, fmt, getJSON } from './chain.js?v=0032696d';
import { $, buzz, go } from './shell.js?v=0032696d';
import { S } from './state.js?v=0032696d';
import { MEMO_MAX, dryRunVote, sendVote } from './tx.js?v=0032696d';

const addrOf = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = raw => fmt(amt(String(raw), 6));

/* Links in a proposal's own text, made tappable - safely. The text is written
   by whoever submitted the proposal, so:
     - only https:// is turned into a link (no http:, javascript:, data:);
     - the link shows the address the browser will really open: the text and
       the href are both new URL(...).href, so a look-alike host written with
       Cyrillic or Greek letters shows as its punycode (xn--...);
     - invisible and direction-control characters end a link, so they can't
       make the shown address read differently from where it goes;
     - an address with a user name or password before the host
       (https://name@host) stays plain text: the part before the @ would read
       like the host while the browser goes to what follows it;
     - the text is split on links first and every piece escaped on its own,
       so nothing in the proposal can become markup;
     - it opens outside the wallet (Telegram's own browser prompt), never
       inside the mini app;
     - a proposal still in its deposit period gets no links at all: posting
       one costs little, so it is as easy a phishing lure as a comment.
   Voter comments stay plain text: anyone can write one for the cost of a
   vote, and a tappable link there is an easy phishing lure. */
const URL_RE = /https:\/\/[^\s<>"'`\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g;
const count = (s, c) => s.split(c).length - 1;
// Sentence punctuation right after a link is not part of it. A closing
// bracket stays when the link opened one itself (Wikipedia style).
function trimUrl(m){
  let u = m;
  for (;;) {
    const c = u.slice(-1);
    if (/[.,;:!?]/.test(c)) u = u.slice(0, -1);
    else if (c === ')' && count(u, '(') < count(u, ')')) u = u.slice(0, -1);
    else if (c === ']' && count(u, '[') < count(u, ']')) u = u.slice(0, -1);
    else return u;
  }
}
function linkify(text, links = true){
  text = String(text);
  if (!links) return esc(text);
  let out = '', last = 0;
  text.replace(URL_RE, (m, at) => {
    const url = trimUrl(m);
    let href = '';
    try {
      const u = new URL(url);
      href = (u.username || u.password) ? '' : u.href;
    } catch (e) { href = ''; }
    if (!/^https:\/\//.test(href)) return m;   // stays in the plain text
    out += esc(text.slice(last, at)) +
      '<a class="gov-link" href="' + esc(href) + '" rel="noopener noreferrer" target="_blank">' + esc(href) + '</a>';
    last = at + url.length;
    return m;
  });
  return out + esc(text.slice(last));
}
function openOutside(url){
  if (!/^https:\/\//.test(url)) return;
  if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openLink) Telegram.WebApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
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

const NUM_OPT = { 1: 'VOTE_OPTION_YES', 2: 'VOTE_OPTION_ABSTAIN', 3: 'VOTE_OPTION_NO', 4: 'VOTE_OPTION_NO_WITH_VETO' };
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
  const memo = {}, seen = {}, txv = {};
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
      const o = m.option || (m.options && m.options[0] && m.options[0].option);
      if (o) txv[m.voter] = String(NUM_OPT[o] || o);
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
  VOTERS[id] = { votes: votes, memo: memo, stake: stake, txv: txv, at: Date.now() };
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
// the share of each option in a finished proposal's final tally
function finalSplit(p){
  const t = p.final_tally_result;
  if (!t) return null;
  const y = BigInt(t.yes_count || '0'), n = BigInt(t.no_count || '0'),
        v = BigInt(t.no_with_veto_count || '0'), a = BigInt(t.abstain_count || '0');
  const all = y + n + v + a;
  if (all === 0n) return null;
  const pct = x => Number(x * 10000n / all) / 100;
  return { yes: pct(y), no: pct(n), veto: pct(v), abstain: pct(a) };
}
// turnout against the quorum: a thin track with the quorum marked on it
function turnout(s, rules){
  const q = rules.quorum * 100;
  return '<div class="gv-turn"><div class="gv-track"><i style="width:' + Math.min(100, s.turnout) + '%"></i>' +
    '<b style="left:' + q + '%"></b></div><span>Turnout ' + s.turnout.toFixed(1) + '% of ' + q.toFixed(0) + '%</span></div>';
}
// a stake as a share of all bonded LUNC, in percent, readable at any size
function share(x, total){
  if (!x || x <= 0n) return '0';
  const p = total > 0n ? Number(x * 10n ** 12n / total) / 1e10 : 0;
  if (p >= 0.01) return p.toFixed(2);
  if (p < 1e-8) return '< 0.00000001';
  return p.toFixed(Math.min(8, 1 - Math.floor(Math.log10(p)))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const ST_ICON = {
  passed: '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>',
  rejected: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  failed: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  voting: CLOCK,
  deposit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>'
};

function draw(){
  const body = $('#gov-body');
  const d = DATA;
  let h = '';
  // Voting power is a share of all LUNC bonded on the network, not an amount:
  // that share is what the tally counts.
  const vpTxt = share(d.power, d.bonded);
  h += '<div class="gv-power' + (d.power > 0n ? '' : ' warn') + '"><div class="gv-power-t"><span>Your voting power</span>' +
    '<b>' + vpTxt + '<i>%</i></b>' +
    '<small>' + (d.power > 0n ? L(d.power) + ' LUNC staked' : 'A vote weighs as much as the LUNC you have staked.') + '</small>' +
    '<small class="gv-power-of">Share of all LUNC staked on the network</small></div>' +
    '<button class="gv-power-go" id="gov-to-stake" type="button">' + (d.power > 0n ? 'Stake more' : 'Stake LUNC') + '</button></div>';

  h += '<div class="head" style="margin:0 4px 10px"><h2>Voting now</h2><span>' + d.live.length + '</span></div>';
  if (!d.live.length) h += '<div class="empty">No proposal is in its voting period right now.</div>';
  h += d.live.map(p => {
    const s = p._tally ? standing(p._tally, rulesFor(p, d.rules), d.bonded) : null;
    const mine = p._mine && p._mine.options && p._mine.options[0] ? p._mine.options[0].option : null;
    const unknown = p._mine === UNKNOWN;
    return '<button class="gv-card gov-row" data-id="' + esc(p.id) + '" type="button">' +
      '<span class="gv-meta"><span class="gv-id">#' + esc(p.id) + '</span><span class="gv-kind">' + esc(kindOf(p)) + '</span>' +
        '<span class="gv-time">' + CLOCK + '<span>' + left(p.voting_end_time) + '</span></span></span>' +
      '<span class="gv-title">' + esc(titleOf(p)) + '</span>' +
      (s ? bar(s) + turnout(s, rulesFor(p, d.rules)) : '') +
      '<span class="gv-foot">' +
        (s ? '<span class="gv-verdict ' + (s.verdict.ok ? 'ok' : 'bad') + '">' + esc(s.verdict.text) + '</span>' : '<span></span>') +
        (mine ? '<span class="gv-you done ' + (OPT_CLASS[mine] || '') + '">You voted ' + esc(OPT[mine] || mine) + '</span>'
          : unknown ? '' : '<span class="gv-you todo">Vote now</span>') +
      '</span></button>';
  }).join('');

  if (d.recent.length) {
    h += '<div class="head" style="margin:22px 4px 10px"><h2>Recent</h2></div><div class="gv-recent">';
    h += d.recent.map(p => {
      const st = (STATUS[p.status] || '').toLowerCase();
      const f = finalSplit(p);
      return '<button class="gv-row gov-row" data-id="' + esc(p.id) + '" data-old="1" type="button">' +
        '<span class="gv-st ' + esc(st) + '">' + (ST_ICON[st] || '') + '</span>' +
        '<span class="gv-row-main"><span class="gv-title sm">' + esc(titleOf(p)) + '</span>' +
          '<span class="gv-sub">#' + esc(p.id) + ' \u00b7 ' + esc(kindOf(p)) + '</span>' +
          (f ? '<span class="gv-mini">' + bar(f) + '</span>' : '') + '</span>' +
        '<span class="gv-pill ' + esc(st) + '">' + esc(STATUS[p.status] || p.status) + '</span></button>';
    }).join('');
    h += '</div>';
  }
  h += '<p class="tiny gv-note">Proposals come straight from the chain. A vote can be changed until voting ends; the last one counts. If you do not vote, your validator votes for your stake.</p>';
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
// the press has to start on the backdrop too (see the staking sheet)
let DOWN_ON = null;
$('#gov-sheet').addEventListener('pointerdown', e => { DOWN_ON = e.target; });
$('#gov-sheet').addEventListener('click', e => {
  if (e.target.id === 'gov-sheet' && DOWN_ON && DOWN_ON.id === 'gov-sheet') { FLOW = null; sheet(false); }
});

function open(id){
  const p = DATA.live.find(x => String(x.id) === String(id)) || DATA.recent.find(x => String(x.id) === String(id));
  if (!p) return;
  const live = DATA.live.indexOf(p) >= 0;
  FLOW = { id: String(p.id), live: live };
  $('#gov-sheet-title').textContent = 'Proposal #' + p.id;
  const rules = rulesFor(p, DATA.rules);
  const s = live && p._tally ? standing(p._tally, rules, DATA.bonded) : null;
  const f = !live ? finalSplit(p) : null;
  const mine = p._mine && p._mine.options && p._mine.options[0] ? p._mine.options[0].option : null;
  const st = (STATUS[p.status] || '').toLowerCase();
  const text = textOf(p);
  let h = '<div class="gv-sh-meta"><span class="gv-pill ' + esc(st) + '">' + esc(STATUS[p.status] || p.status) + '</span>' +
    '<span class="gv-kind">' + esc(kindOf(p)) + '</span>' +
    (p.expedited ? '<span class="gv-kind">expedited</span>' : '') +
    (live ? '<span class="gv-time">' + CLOCK + '<span>' + left(p.voting_end_time) + '</span></span>' : '') + '</div>' +
    '<h3 class="gov-title">' + esc(titleOf(p)) + '</h3>';
  const split = s || f;
  if (split) {
    h += '<div class="gv-tally">' + bar(split) +
      '<div class="gv-legend">' +
        [['y', 'Yes', split.yes], ['n', 'No', split.no], ['v', 'No with veto', split.veto], ['a', 'Abstain', split.abstain]]
          .map(x => '<span class="' + x[0] + '"><i></i><em>' + x[1] + '</em><b>' + x[2].toFixed(1) + '%</b></span>').join('') +
      '</div>' +
      (s ? turnout(s, rules) + '<div class="gv-verdict ' + (s.verdict.ok ? 'ok' : 'bad') + '">' + esc(s.verdict.text) + '</div>' : '') +
      '</div>';
  }
  if (live) h += '<div class="gv-ends">Ends ' + new Date(p.voting_end_time).toLocaleString(document.documentElement.lang || 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</div>';
  if (text) {
    const long = text.length > 700;
    h += '<div class="gov-text' + (long ? ' clip' : '') + '" id="gov-text">' + linkify(text, p.status !== 'PROPOSAL_STATUS_DEPOSIT_PERIOD') + '</div>' +
      (long ? '<button class="dust" id="gov-more" type="button">Show all</button>' : '');
  }
  if (live) {
    h += '<div class="gv-vote">' +
      '<div class="gv-vote-h"><b>Your vote</b><span>' + (mine ? esc(OPT[mine] || mine) + ' \u00b7 you can change it' : 'Not voted yet') + '</span></div>' +
      '<div class="gov-opts">' + ['yes', 'no', 'veto', 'abstain'].map(o =>
        '<button class="gov-opt gv-o ' + ({ yes: 'y', no: 'n', veto: 'v', abstain: 'a' })[o] + (mine && OPT_KEY[mine] === o ? ' was' : '') +
        '" data-opt="' + o + '" type="button">' + OPT_ICON[o] + '<span>' + LABEL[o] + '</span></button>').join('') + '</div>' +
      '<div class="gv-compose"><textarea id="gov-memo" rows="2" maxlength="600" placeholder="Add a comment to your vote (optional)"></textarea>' +
        '<div class="gv-compose-f"><span>Public, saved on chain with the vote</span><b id="gov-memo-n">0 / ' + MEMO_MAX + '</b></div></div>' +
      '<div id="gov-review"><p class="gv-pick">Pick an option to see the fee and vote.</p></div></div>';
  }
  h += '<div id="gov-voters"><div class="empty"><span class="spin"></span>Reading votes and comments</div></div>';
  const bodyEl = $('#gov-sheet-body');
  bodyEl.innerHTML = h;
  sheet(true);
  showVoters(String(p.id), live);
  const more = $('#gov-more');
  if (more) more.addEventListener('click', () => { $('#gov-text').classList.remove('clip'); more.remove(); });
  const gt = $('#gov-text');
  if (gt) gt.addEventListener('click', e => {
    const a = e.target.closest('a.gov-link');
    if (!a) return;
    e.preventDefault();
    openOutside(a.getAttribute('href'));
  });
  // The limit is in bytes (the chain's max_memo_characters counts bytes), so
  // accents and emoji use more than one each. Over it, the button waits.
  const memoBox = $('#gov-memo');
  if (memoBox) memoBox.addEventListener('input', () => {
    const n = new TextEncoder().encode(memoBox.value.trim()).length;
    const c = $('#gov-memo-n');
    c.textContent = n + ' / ' + MEMO_MAX;
    c.classList.toggle('over', n > MEMO_MAX);
    const b = $('#gov-go');
    if (b && FLOW && FLOW.ready && !FLOW.sent) b.disabled = n > MEMO_MAX;
  });
  document.querySelectorAll('#gov-sheet-body .gov-opt').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#gov-sheet-body .gov-opt').forEach(x => x.classList.toggle('on', x === b));
    review(b.getAttribute('data-opt'));
  }));
}

const LABEL = { yes: 'Yes', no: 'No', veto: 'No with veto', abstain: 'Abstain' };
const OPT_KEY = { VOTE_OPTION_YES: 'yes', VOTE_OPTION_NO: 'no', VOTE_OPTION_NO_WITH_VETO: 'veto', VOTE_OPTION_ABSTAIN: 'abstain' };
const OPT_CLASS = { VOTE_OPTION_YES: 'y', VOTE_OPTION_NO: 'n', VOTE_OPTION_NO_WITH_VETO: 'v', VOTE_OPTION_ABSTAIN: 'a' };
const OPT_ICON = {
  yes: '<svg viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9.5"/></svg>',
  no: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  veto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/></svg>',
  abstain: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>'
};
const shortAcc = a => a.slice(0, 12) + '\u2026' + a.slice(-5);
// Validator logos: Cosmostation's public set, by operator address; a letter
// on the validator's own colour when there is none.
const LOGO = op => 'https://raw.githubusercontent.com/cosmostation/chainlist/main/chain/terra-classic/moniker/' + op + '.png';
const hue = s => { s = String(s || ''); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const face = (name, key, op) => '<span class="gv-ava" style="--h:' + hue(key) + '"><em>' + esc((name || '?').trim().slice(0, 1).toUpperCase()) + '</em>' +
  (op ? '<img src="' + esc(LOGO(op)) + '" alt="" loading="lazy">' : '') + '</span>';

async function showVoters(id, live){
  const box = $('#gov-voters');
  let v, vals;
  try { [v, vals] = await Promise.all([voters(id), validators()]); }
  catch (e) { if (box) box.innerHTML = '<div class="tiny">Could not read the votes: ' + esc(e.message || e) + '</div>'; return; }
  if (!FLOW || FLOW.id !== id || !$('#gov-voters')) return;
  const total = vals.reduce((a, x) => a + x.tokens, 0n) || 1n;
  const tag = o => o ? '<b class="gov-v ' + (OPT_CLASS[o] || '') + '">' + esc(OPT[o] || o) + '</b>' : '<b class="gov-v none">Not voted</b>';
  const byAcc = {};
  vals.forEach(x => { byAcc[x.acc] = x; });
  // Who chose what: the chain's own record while voting is open; once it
  // ends the chain clears that record, and each voter's last vote transaction
  // is what remains.
  const votes = Object.assign({}, v.txv || {}, live ? v.votes : {});
  // One list: every validator, and every other address that left a comment,
  // ranked by voting power (a validator weighs what is bonded to it, anyone
  // else what they have staked). Each row carries its vote and its comment.
  const weight = a => byAcc[a] ? byAcc[a].tokens : (v.stake[a] || 0n);
  const accs = vals.filter(x => x.acc).map(x => x.acc).concat(Object.keys(v.memo).filter(a => !byAcc[a]));
  accs.sort((a, b) => (weight(b) > weight(a) ? 1 : weight(b) < weight(a) ? -1 : 0));
  const voted = accs.filter(a => votes[a]).length;
  const said = accs.filter(a => v.memo[a]).length;
  let h = '<div class="head" style="margin:20px 2px 8px"><h2>Voters</h2><span>' + voted + ' of ' + accs.length + ' voted</span></div>' +
    '<div class="gv-filter" id="gov-filter"><button class="on" data-f="all" type="button">All</button>' +
    '<button data-f="yes" type="button">Voted</button><button data-f="no" type="button">Not voted</button>' +
    (said ? '<button data-f="memo" type="button">With comments</button>' : '') + '</div>' +
    '<div class="gov-voters gv-comments" id="gov-vals">' + accs.map((a, i) => {
      const val = byAcc[a], w = weight(a), o = votes[a], c = v.memo[a];
      return '<div class="gov-voter' + (i >= 20 ? ' more' : '') + '" data-v="' + (o ? 'yes' : 'no') + '"' + (c ? ' data-m="1"' : '') + '>' +
        '<div class="gov-voter-top"><span class="gov-rank">' + (i + 1) + '</span>' + face(val ? val.name : a.slice(6), a, val && val.op) +
        '<span class="gov-who">' + esc(val ? val.name : shortAcc(a)) + '<small>' +
        (w > 0n ? 'VP ' + share(w, total) + '% \u00b7 ' + L(w) + ' LUNC' : 'no stake') + '</small></span>' + tag(o) + '</div>' +
        (c ? '<div class="gov-memo">' + esc(c) + '</div>' : '') + '</div>';
    }).join('') + '</div>' +
    (accs.length > 20 ? '<button class="dust" id="gov-vals-all" type="button">Show all ' + accs.length + '</button>' : '') +
    (live ? '' : '<p class="tiny gv-note">Read from the vote transactions: the chain clears its own record when voting ends.</p>');
  box.innerHTML = h;
  // a missing logo falls back to the letter under it
  box.querySelectorAll('.gv-ava img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
  const all = $('#gov-vals-all');
  if (all) all.addEventListener('click', () => { $('#gov-vals').classList.add('all'); all.remove(); });
  const fl = $('#gov-filter');
  if (fl) fl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    fl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const w = $('#gov-vals');
    w.setAttribute('data-f', b.getAttribute('data-f'));
    if (b.getAttribute('data-f') !== 'all') { w.classList.add('all'); if (all) all.remove(); }
  });
}


async function review(opt){
  const f = FLOW;
  f.opt = opt; f.armed = false; f.sent = false; f.ready = false;
  const out = $('#gov-review');
  out.innerHTML = '<div class="p2p-lines"><div class="p2p-line"><span>Vote</span><b>' + esc(LABEL[opt]) + ' on #' + esc(f.id) + '</b></div>' +
    '<div class="p2p-line"><span>Weight</span><b>' + (DATA.power > 0n ? L(DATA.power) + ' LUNC staked' : 'none - nothing staked') + '</b></div></div>' +
    (opt === 'veto' ? '<p class="tiny" style="text-align:left">No with veto also counts as No. If vetoes pass ' + (DATA.rules.veto * 100).toFixed(1) +
      '% the proposal fails and its deposit is burned.</p>' : '') +
    '<div class="tiny" id="gov-fee" style="text-align:left">Checking with the chain\u2026</div>' +
    '<div id="gov-out"></div><button class="btn solid" id="gov-go" type="button" disabled>Vote ' + esc(LABEL[opt]) + '</button>';
  const memoBox = $('#gov-memo');
  const memoOver = () => !!memoBox && new TextEncoder().encode(memoBox.value.trim()).length > MEMO_MAX;
  try {
    const est = await dryRunVote(addrOf(), f.id, opt, S.MNEMONIC);
    if (FLOW !== f || f.opt !== opt) return;
    f.fee = est.gasFee;                     // the fee reviewed; signing refuses more (audit F04)
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

export { loadGov, standing, kindOf, rewrap, APP_TAG, linkify };
