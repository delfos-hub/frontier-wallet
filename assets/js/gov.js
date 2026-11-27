/* Governance: the chain's own proposals, and a vote on them from the wallet.

   Everything shown comes from the gov module on the node (cosmos.gov.v1):
   proposals, the live tally, the tallying rules, and this address's vote.
   A vote is one MsgVote, measured by simulation and signed with the same
   two-press rule as Send. The weight of a vote is the address's staked LUNC,
   and a vote can be changed until the voting period ends - both are said on
   screen, because both surprise people. */
import { LCD, amt, fmt, getJSON } from './chain.js';
import { $, buzz, go } from './shell.js';
import { S } from './state.js';
import { MEMO_MAX, dryRunVote, sendVote } from './tx.js';

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
/* Kept on this device (fw:gov:vals, names and stakes only, public data) so
   the voters show at once on the next visit; read again in the background
   when older than 10 min, and never used when older than a day. */
function keepVals(list){
  try { localStorage.setItem('fw:gov:vals', JSON.stringify({ at: Date.now(), list: list.map(v => [v.op, v.name, String(v.tokens), v.ident || '']) })); } catch (e) {}
}
function keptVals(){
  try {
    const k = JSON.parse(localStorage.getItem('fw:gov:vals') || 'null');
    if (!k || !Array.isArray(k.list) || !(Date.now() - k.at < 86400000)) return null;
    const list = k.list.filter(x => Array.isArray(x) && /^terravaloper1[0-9a-z]{38,}$/.test(x[0]) && /^\d+$/.test(x[2]))
      .map(x => ({ op: x[0], acc: accOf(x[0]), name: String(x[1] || '').slice(0, 70) || x[0].slice(0, 18) + '\u2026', tokens: BigInt(x[2]),
        ident: /^[0-9A-Fa-f]{16}$/.test(String(x[3] || '')) ? String(x[3]) : '' }))
      .filter(v => v.acc);
    return list.length ? { at: k.at, list: list } : null;
  } catch (e) { return null; }
}
let VALS_RUN = null;
function readVals(){
  if (VALS_RUN) return VALS_RUN;
  VALS_RUN = getJSON(LCD + '/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300', 15000).then(r => {
    VALS = (r.validators || []).map(v => ({
      op: v.operator_address, acc: accOf(v.operator_address),
      name: (v.description && v.description.moniker || '').trim() || v.operator_address.slice(0, 18) + '\u2026',
      tokens: BigInt(v.tokens || '0'),
      // a Keybase key is 16 hex characters; anything else gets no lookup
      ident: /^[0-9A-Fa-f]{16}$/.test(String(v.description && v.description.identity || '').trim()) ? v.description.identity.trim() : ''
    })).sort((a, b) => (b.tokens > a.tokens ? 1 : b.tokens < a.tokens ? -1 : 0));
    VALS_AT = Date.now();
    keepVals(VALS);
    return VALS;
  }).finally(() => { VALS_RUN = null; });
  return VALS_RUN;
}
async function validators(){
  if (VALS && Date.now() - VALS_AT < 10 * 60000) return VALS;
  if (!VALS) {
    const k = keptVals();
    if (k) { VALS = k.list; VALS_AT = k.at; }
  }
  if (VALS) {
    if (Date.now() - VALS_AT >= 10 * 60000) readVals().catch(() => {});
    return VALS;
  }
  return readVals();
}

const NUM_OPT = { 1: 'VOTE_OPTION_YES', 2: 'VOTE_OPTION_ABSTAIN', 3: 'VOTE_OPTION_NO', 4: 'VOTE_OPTION_NO_WITH_VETO' };
// A weighted vote splits one voter's stake across options. Kept whole, as
// [[option, weight in millionths], ...]; a single option is [[o, 1e6]].
const W1 = 1000000n;
function splitOf(options){
  const out = [];
  for (const x of (Array.isArray(options) ? options : [])) {
    const o = String(NUM_OPT[x && x.option] || (x && x.option) || '');
    if (!/^VOTE_OPTION_/.test(o)) continue;
    const w = x.weight === undefined ? 1 : Number(x.weight);
    if (!(w > 0)) continue;
    out.push([o, BigInt(Math.round(Math.min(1, w) * 1e6))]);
  }
  return out;
}
// this wallet's own vote on an open proposal, as the chain returns it:
// one option, or a split
function myVote(m){
  if (!m || m === UNKNOWN || !m.options) return null;
  const sp = splitOf(m.options);
  if (!sp.length) return null;
  return sp.length > 1 ? { o: sp[0][0], text: splitText(sp), split: true } : { o: sp[0][0], text: OPT[sp[0][0]] || sp[0][0], split: false };
}
const splitText = sp => sp.map(x => (OPT_SHORT[x[0]] || x[0]) + ' ' + (Number(x[1]) / 1e4).toFixed(Number(x[1]) % 10000 ? 2 : 0) + '%').join(' \u00b7 ');
// how much of a voter's weight went to option o, in millionths. split and
// votes are the maps already built for the view: nothing is copied per
// lookup (a copy per voter made a 1,500-voter table take seconds)
// The delegators' side of the breakdown, from the stakes that were read.
// A stake that could not be read is not counted as zero: known says how many
// of the delegators' amounts are in, and the shares are of that known stake.
function delegatorSums(dl, votes, split, stake){
  const has = a => Object.prototype.hasOwnProperty.call(stake, a);
  const known = dl.filter(has);
  const st = a => has(a) ? stake[a] : 0n;
  const total = known.reduce((t, a) => t + st(a), 0n);
  const by = o => dl.filter(a => shareOf(split, votes, a, o) > 0n);
  const stOf = o => known.reduce((t, a) => t + st(a) * shareOf(split, votes, a, o) / W1, 0n);
  return { known: known.length, all: dl.length, total: total, by: by, st: stOf };
}
const shareOf = (split, votes, a, o) => {
  const sp = split && split[a];
  if (sp) { const x = sp.find(y => y[0] === o); return x ? x[1] : 0n; }
  return votes[a] === o ? W1 : 0n;
};
/* Who voted, in three steps that each show as soon as they land, so the list
   never waits for the slowest read:
     1. the chain's own record of votes (open proposals; a few fast pages);
     2. the vote transactions, for the comments (memos) and, once voting has
        ended and the chain has cleared its record, for who chose what. The
        first page tells how many there are; the rest are read together;
     3. the stake of commenters who are not validators, to rank them.
   VOTERS[id] = { votes, memo, stake, txv, tx, at, step } with step 1..3;
   tx[voter] = { hash, time } of the vote that counts. */
const VOTERS = {};
const RUNS = {};
function voters(id, onStep){
  const v = VOTERS[id];
  if (v && v.step === 3 && Date.now() - v.at < 3 * 60000) { if (onStep) onStep(v); return Promise.resolve(v); }
  if (v && onStep) onStep(v);                 // what is known already, at once
  if (RUNS[id]) { if (onStep) RUNS[id].subs.push(onStep); return RUNS[id].p; }
  const run = RUNS[id] = { subs: onStep ? [onStep] : [] };
  const tell = x => { run.subs.forEach(f => { try { f(x); } catch (e) {} }); };
  run.p = (async () => {
    const out = { votes: {}, memo: {}, stake: {}, stakeMiss: {}, txv: {}, tx: {}, split: {}, txok: false, at: Date.now(), step: 0 };
    let key = '';
    for (let i = 0; i < 10; i++) {
      const r = await getJSON(G + '/proposals/' + id + '/votes?pagination.limit=1000' + (key ? '&pagination.key=' + encodeURIComponent(key) : ''));
      (r.votes || []).forEach(x => {
        const sp = splitOf(x.options);
        out.votes[x.voter] = sp[0] ? sp[0][0] : (x.option ? String(NUM_OPT[x.option] || x.option) : '');
        if (sp.length > 1) out.split[x.voter] = sp;
      });
      key = r.pagination && r.pagination.next_key;
      if (!key) break;
    }
    out.step = 1; VOTERS[id] = Object.assign({}, out); tell(VOTERS[id]);

    // Newest first, so the first memo seen for a voter belongs to the vote
    // that counts. An older vote's reason is not shown under a changed vote.
    const seen = {};
    const q = encodeURIComponent('proposal_vote.proposal_id=' + id);
    const page = n => getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + q + '&limit=100&page=' + n + '&order_by=ORDER_BY_DESC', 25000, 2);
    const take = r => (r && r.tx_responses || []).forEach(t => {
      // one transaction can hold several votes, on this proposal and others:
      // the later message is the later choice, so they are read last to
      // first and the first one met per voter is the one kept (#67 review)
      const ms = ((t.tx && t.tx.body && t.tx.body.messages) || []).filter(x => x && x.voter && String(x.proposal_id) === String(id));
      for (let k = ms.length - 1; k >= 0; k--) {
        const m = ms[k];
        if (seen[m.voter]) continue;
        seen[m.voter] = 1;
        const sp = m.options ? splitOf(m.options) : [];
        const o = m.option || (sp[0] && sp[0][0]);
        if (o) out.txv[m.voter] = String(NUM_OPT[o] || o);
        // the chain's current record (step 1) is the vote that counts: an older
        // vote transaction never replaces its option or its weights (#67 review)
        if (sp.length > 1 && !(m.voter in out.votes) && !out.split[m.voter]) out.split[m.voter] = sp;
        if (/^[0-9A-F]{64}$/i.test(String(t.txhash || ''))) out.tx[m.voter] = { hash: String(t.txhash).toUpperCase(), time: String(t.timestamp || '') };
        const text = String(t.tx.body.memo || '').trim();
        if (text && !APP_TAG.test(text)) out.memo[m.voter] = text.slice(0, 600);
      }
    });
    let first = null;
    try { first = await page(1); } catch (e) { first = null; }
    if (first) {
      const total = Number(first.total || (first.pagination && first.pagination.total) || 0);
      const more = (first.tx_responses || []).length < 100 ? 0 : Math.min(9, Math.max(0, Math.ceil(total / 100) - 1));
      // the pages after the first, together; kept in page order (newest first)
      const rest = more ? await Promise.all(Array.from({ length: more }, (_, i) => page(i + 2).catch(() => null))) : [];
      take(first); rest.forEach(take);
      // every page read, and no more pages than the ten read: only then does
      // "not in the history" mean "did not vote"
      out.txok = rest.every(Boolean) && Math.ceil(total / 100) <= 1 + more;
    }
    out.step = 2; VOTERS[id] = Object.assign({}, out); tell(VOTERS[id]);

    // the stake of every voter who is not a validator (commenters first), to
    // weigh and rank them; shown as it arrives, a batch at a time
    // every page of a voter's delegations, summed here in micro-LUNC; the
    // amount is known only once the last page is read. A failed page or a
    // cursor seen twice leaves it missing; no delegations at all is a known 0
    const stakeOf = async a => {
      let sum = 0n, key = '';
      const keys = new Set();
      for (let n = 0; n < 50; n++) {
        const r = await getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + a + (key ? '?pagination.key=' + encodeURIComponent(key) : ''), 10000, 1);
        if (!r || typeof r !== 'object') throw new Error('no answer');
        (r.delegation_responses || []).forEach(d => { sum += BigInt(d.balance && d.balance.amount || '0'); });
        const next = r.pagination && r.pagination.next_key;
        if (!next) return sum;
        if (keys.has(next)) throw new Error('the same page again');
        keys.add(next); key = next;
      }
      throw new Error('too many pages');
    };
    const vals = await validators();
    const valAcc = new Set(vals.map(x => x.acc));
    const who = Object.keys(Object.assign({}, out.votes, out.txv, out.memo)).filter(a => !valAcc.has(a));
    who.sort((a, b) => (out.memo[b] ? 1 : 0) - (out.memo[a] ? 1 : 0));
    const ask = who.slice(0, 300);
    for (let i = 0; i < ask.length; i += 24) {
      await Promise.all(ask.slice(i, i + 24).map(a => stakeOf(a)
        .then(sum => { out.stake[a] = sum; })
        // not read is not zero: left out of stake, and named as missing
        .catch(() => { out.stakeMiss[a] = true; })));
      if (i + 24 < ask.length) { VOTERS[id] = Object.assign({}, out); tell(VOTERS[id]); }
    }
    out.step = 3; out.at = Date.now(); VOTERS[id] = out; tell(out);
    return out;
  })().finally(() => { delete RUNS[id]; });
  return run.p;
}

let DATA = null;       // { live, recent, rules, bonded, power, mine }

/* The reads behind the screen, kept raw: built into DATA by build(), and kept
   on this device per address (fw:gov:raw:<addr>, a day at most) so the next
   visit draws at once while the chain is read again. A proposal's messages
   are kept only while small; its text is capped. */
async function fetchRaw(addr){
  const [live, recent, rules, pool, dels] = await Promise.all([
    getJSON(G + '/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=50'),
    getJSON(G + '/proposals?pagination.limit=12&pagination.reverse=true').catch(() => ({ proposals: [] })),
    getJSON(G + '/params/tallying').catch(() => ({})),
    getJSON(LCD + '/cosmos/staking/v1beta1/pool').catch(() => ({})),
    addr ? getJSON(LCD + '/cosmos/staking/v1beta1/delegations/' + addr).catch(() => ({})) : Promise.resolve({})
  ]);
  const props = live.proposals || [];
  const [tallies, mine] = await Promise.all([
    Promise.all(props.map(p => getJSON(G + '/proposals/' + p.id + '/tally').then(r => r.tally).catch(() => null))),
    Promise.all(props.map(p => addr
      // only a refusal (400/404) means "no vote"; a failed read is unknown,
      // and unknown is not shown as "not voted"
      ? getJSON(G + '/proposals/' + p.id + '/votes/' + addr, 10000, 1).then(r => r.vote)
          .catch(e => (e && (e.status === 400 || e.status === 404)) ? null : UNKNOWN)
      : Promise.resolve(null)))
  ]);
  return { addr: addr, at: Date.now(), live: props, recent: recent.proposals || [], rules: rules, pool: pool,
    dels: (dels.delegation_responses || []).map(d => ({ op: d.delegation && d.delegation.validator_address, amount: d.balance && d.balance.amount })),
    tallies: tallies, mine: mine };
}
function build(raw){
  // a kept "unknown" comes back as a plain object: the same marker again
  const props = raw.live.map((p, i) => Object.assign({}, p, { _tally: raw.tallies[i],
    _mine: raw.mine[i] && raw.mine[i].unknown ? UNKNOWN : raw.mine[i] }))
    .sort((a, b) => new Date(a.voting_end_time) - new Date(b.voting_end_time));
  const liveIds = new Set(props.map(p => p.id));
  const rules = raw.rules || {};
  const tp = rules.tally_params || rules.params || {};
  const dels = (raw.dels || []).filter(d => d && d.op && /^\d+$/.test(String(d.amount || '')));
  return {
    live: props,
    recent: (raw.recent || []).filter(p => !liveIds.has(p.id)).slice(0, 10),
    rules: { quorum: Number(tp.quorum || 0.4), threshold: Number(tp.threshold || 0.5), veto: Number(tp.veto_threshold || 0.334),
             expedited: Number((rules.params && rules.params.expedited_threshold) || tp.expedited_threshold || 0.667) },
    bonded: BigInt((raw.pool && raw.pool.pool && raw.pool.pool.bonded_tokens) || '0'),
    power: dels.reduce((a, d) => a + BigInt(d.amount), 0n),
    dels: dels.map(d => ({ op: d.op, amount: BigInt(d.amount) })),
    at: raw.at
  };
}
const RAW_KEY = addr => 'fw:gov:raw:' + (addr || '-');
function slim(p){
  const o = Object.assign({}, p);
  if (typeof o.summary === 'string' && o.summary.length > 20000) o.summary = o.summary.slice(0, 20000);
  try {
    if (JSON.stringify(o.messages || []).length > 24000) {
      // too big to keep whole: the actions keep their type only, and the
      // proposal says so, so the screen reads them again from the chain
      o._slim = true;
      o.messages = (o.messages || []).map(m => {
        const c = m && m.content;
        const keep = { '@type': m && m['@type'] };
        if (c) keep.content = { '@type': c['@type'], title: c.title, description: String(c.description || '').slice(0, 20000) };
        return keep;
      });
    }
  } catch (e) { o.messages = []; }
  return o;
}
function keepRaw(raw){
  try { localStorage.setItem(RAW_KEY(raw.addr), JSON.stringify(Object.assign({}, raw, { live: raw.live.map(slim), recent: raw.recent.map(slim) }))); }
  catch (e) { try { localStorage.removeItem(RAW_KEY(raw.addr)); } catch (x) {} }
}
function keptRaw(addr){
  try {
    const r = JSON.parse(localStorage.getItem(RAW_KEY(addr)) || 'null');
    if (!r || r.addr !== addr || !(Date.now() - r.at < 86400000) || !Array.isArray(r.live) || !Array.isArray(r.recent) ||
        !Array.isArray(r.tallies) || !Array.isArray(r.mine) || r.tallies.length !== r.live.length) return null;
    return r;
  } catch (e) { return null; }
}

// Where the vote stands against the chain's own rules.
// An expedited proposal passes on a higher threshold (0.667 on mainnet).
const rulesFor = (p, rules) => p && p.expedited ? Object.assign({}, rules, { threshold: rules.expedited }) : rules;
function standing(t, rules, bonded){
  const y = BigInt(t.yes_count || '0'), n = BigInt(t.no_count || '0'),
        v = BigInt(t.no_with_veto_count || '0'), a = BigInt(t.abstain_count || '0');
  const all = y + n + v + a, decisive = y + n + v;
  const pct = x => all > 0n ? Number((x * 20000n / all + 1n) / 2n) / 100 : 0;
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
  const pct = x => Number((x * 20000n / all + 1n) / 2n) / 100;
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

function drawPhone(){
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
    const my = myVote(p._mine), mine = my && my.o;
    const unknown = p._mine === UNKNOWN;
    return '<button class="gv-card gov-row" data-id="' + esc(p.id) + '" type="button">' +
      '<span class="gv-meta"><span class="gv-id">#' + esc(p.id) + '</span><span class="gv-kind">' + esc(kindOf(p)) + '</span>' +
        '<span class="gv-time">' + CLOCK + '<span>' + left(p.voting_end_time) + '</span></span></span>' +
      '<span class="gv-title">' + esc(titleOf(p)) + '</span>' +
      (s ? bar(s) + turnout(s, rulesFor(p, d.rules)) : '') +
      '<span class="gv-foot">' +
        (s ? '<span class="gv-verdict ' + (s.verdict.ok ? 'ok' : 'bad') + '">' + esc(s.verdict.text) + '</span>' : '<span></span>') +
        (mine ? '<span class="gv-you done ' + (my.split ? 'split' : (OPT_CLASS[mine] || '')) + '">You voted ' + esc(my.text) + '</span>'
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

/* ---------------- Frontier Web on a wide screen ----------------
   The list on the left, the open proposal beside it (no sheet): its dates,
   the tally against the rules, the vote, what it changes on chain, its text,
   the validators by vote, and everyone who voted. The phone layout above is
   untouched; html.dk (desktop.js) decides which one draws. */
const isDesk = () => document.documentElement.classList.contains('dk');
let SEL = '', FILTER = '';
const VOTE_C = { VOTE_OPTION_YES: 'y', VOTE_OPTION_NO: 'n', VOTE_OPTION_NO_WITH_VETO: 'v', VOTE_OPTION_ABSTAIN: 'a' };
const when = t => { const d = new Date(t); return isNaN(d) || d.getFullYear() < 2000 ? '' : d.toLocaleString(document.documentElement.lang || 'en-GB',
  { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const valByOp = op => (VALS || []).find(v => v.op === op);
const pct1 = x => (Math.round(x * 10) / 10).toFixed(1);

/* What a proposal does on chain, read from its messages, in plain words.
   Everything shown is the proposal's own data, escaped where it is drawn. */
function changesOf(p){
  const out = [];
  const coinTxt = cs => (Array.isArray(cs) ? cs : []).map(c => c && /^\d+$/.test(String(c.amount)) ?
    (c.denom === 'uluna' ? L(c.amount) + ' LUNC' : c.denom === 'uusd' ? L(c.amount) + ' USTC' : String(c.amount) + ' ' + String(c.denom).slice(0, 40)) : '').filter(Boolean).join(', ');
  const short = a => { a = String(a || ''); return a.length > 24 ? a.slice(0, 14) + '\u2026' + a.slice(-6) : a; };
  const one = (m, depth) => {
    if (!m) return;
    const t = String(m['@type'] || '');
    const name = t.split('.').pop();
    if (name === 'MsgExecLegacyContent' && m.content && depth < 2) return one(m.content, depth + 1);
    if (/^(MsgCancelUpgrade|CancelSoftwareUpgradeProposal)$/.test(name)) { out.push(['Action', 'Cancel the planned upgrade']); return; }
    if (/SoftwareUpgrade/.test(name)) {
      const plan = m.plan || {};
      out.push(['Action', 'Upgrade the chain software']);
      if (plan.name) out.push(['Plan', String(plan.name).slice(0, 60)]);
      if (plan.height && plan.height !== '0') out.push(['At block', String(plan.height)]);
      return;
    }
    if (name === 'MsgUpdateParams') {
      const mod = (t.split('.')[1] || '').replace(/^\//, '');
      const keys = Object.keys(m.params || {}).slice(0, 8);
      out.push(['Action', 'Set the ' + (mod || 'module') + ' parameters']);
      if (keys.length) out.push(['Parameters', keys.join(', ') + (Object.keys(m.params || {}).length > 8 ? ', \u2026' : '')]);
      return;
    }
    if (/CommunityPoolSpend/.test(name)) {
      out.push(['Action', 'Pay from the community pool']);
      if (m.recipient) out.push(['To', short(m.recipient)]);
      const a = coinTxt(m.amount);
      if (a) out.push(['Amount', a]);
      return;
    }
    if (name === 'MsgExecuteContract') {
      let act = '';
      try { act = Object.keys(typeof m.msg === 'string' ? JSON.parse(m.msg) : (m.msg || {}))[0] || ''; } catch (e) { act = ''; }
      out.push(['Action', 'Run a contract' + (act ? ': ' + act.slice(0, 40) : '')]);
      if (m.contract) out.push(['Contract', short(m.contract)]);
      return;
    }
    if (name === 'MsgStoreCode') { out.push(['Action', 'Upload contract code']); return; }
    if (name === 'MsgInstantiateContract' || name === 'MsgInstantiateContract2') {
      out.push(['Action', 'Create a contract' + (m.code_id ? ' from code ' + String(m.code_id) : '')]); return;
    }
    if (name === 'MsgMigrateContract') {
      out.push(['Action', 'Migrate a contract' + (m.code_id ? ' to code ' + String(m.code_id) : '')]);
      if (m.contract) out.push(['Contract', short(m.contract)]);
      return;
    }
    if (/TextProposal/.test(name)) { out.push(['Action', 'None on chain: a signal vote']); return; }
    if (name) out.push(['Action', name.replace(/^Msg/, '').replace(/Proposal$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')]);
  };
  const msgs = p.messages || [];
  if (!msgs.length) out.push(['Action', 'None on chain: a signal vote']);
  // all of them: a fifth action (a pool spend after four others) is as much
  // what the proposal does as the first. Past MAX_ACTIONS the count of the
  // rest is said, and where to read them.
  msgs.slice(0, MAX_ACTIONS).forEach((m, i) => {
    const at = out.length;
    one(m, 0);
    // numbered when there are several, so none reads as part of another
    if (msgs.length > 1 && out[at] && out[at][0] === 'Action') out[at][0] = 'Action ' + (i + 1);
  });
  if (msgs.length > MAX_ACTIONS) out.push(['Not shown', (msgs.length - MAX_ACTIONS) + ' more action' + (msgs.length - MAX_ACTIONS === 1 ? '' : 's') +
    ', listed in full below']);
  return out;
}

const MAX_ACTIONS = 20;
const ACTION_CAP = 200000;          // characters of one action shown at once

// "What it changes": the summary, then every action as the chain has it, one
// at a time on demand. A proposal kept on the device with its actions trimmed
// says so and is read again from the chain (fullActions).
function changesHTML(p){
  const ch = changesOf(p), msgs = p.messages || [];
  const typeOf = m => String((m && m['@type']) || '').split('.').pop() + (m && m.content && m.content['@type'] ? ': ' + String(m.content['@type']).split('.').pop() : '');
  return '<h3>What it changes</h3>' +
    (p._slim ? '<p class="tiny gvd-todo" id="gov-ch-note">The details of these actions were not kept on this device. Reading them from the chain\u2026</p>' : '') +
    '<div class="gvd-ch">' + ch.map(x => '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('') + '</div>' +
    (msgs.length && !p._slim ? '<details class="gvd-raw"><summary>Every action as data (' + msgs.length + ')</summary>' +
      msgs.map((m, i) => '<details class="gvd-act" data-i="' + i + '"><summary>Action ' + (i + 1) + ' \u00b7 ' + esc(typeOf(m)) + '</summary><pre class="gov-text"></pre></details>').join('') +
      '</details>' : '') +
    '<p class="tiny gvd-src">Read from the proposal\u2019s messages.</p>';
}
// one action's text, filled when it is opened; past the cap it says it is cut
function actionText(m){
  const t = JSON.stringify(m, null, 2) || '';
  return t.length > ACTION_CAP ? t.slice(0, ACTION_CAP) + '\n\n[cut: this action is ' + t.length + ' characters, the first ' + ACTION_CAP + ' are shown]' : t;
}
function wireChanges(p){
  const box = $('#gov-changes');
  if (!box) return;
  box.querySelectorAll('.gvd-act').forEach(d => d.addEventListener('toggle', () => {
    const pre = d.querySelector('pre');
    if (d.open && pre && !pre.textContent) pre.textContent = actionText((p.messages || [])[Number(d.getAttribute('data-i'))]);
  }));
  if (p._slim) fullActions(p).then(ok => {
    const b = $('#gov-changes');
    if (!b || String(SEL) !== String(p.id)) return;
    if (ok) { b.innerHTML = changesHTML(p); wireChanges(p); }
    else { const n = $('#gov-ch-note'); if (n) n.textContent = 'The details of these actions could not be read from the chain. Open the proposal again to retry.'; }
  });
}
// the proposal's actions read again in full
async function fullActions(p){
  try {
    const r = await getJSON(G + '/proposals/' + p.id, 20000, 1);
    const m = r && r.proposal && r.proposal.messages;
    if (!Array.isArray(m)) return false;
    p.messages = m; p._slim = false;
    return true;
  } catch (e) { return false; }
}

function drawDesk(){
  const body = $('#gov-body');
  const d = DATA;
  const all = d.live.concat(d.recent);
  if (!FILTER) FILTER = d.live.length ? 'voting' : 'all';
  const st = p => (STATUS[p.status] || '').toLowerCase();
  const count = f => all.filter(p => f === 'all' || st(p) === f).length;
  const F = [['voting', 'Voting'], ['deposit', 'Deposit'], ['passed', 'Passed'], ['rejected', 'Rejected'], ['all', 'All']]
    .filter(([k]) => k === 'all' || k === 'voting' || count(k));
  const list = all.filter(p => FILTER === 'all' || st(p) === FILTER);
  if (!SEL || !all.some(p => String(p.id) === SEL)) SEL = String((list[0] || all[0] || {}).id || '');

  let h = '<div class="gvd"><div class="gvd-stats" id="gvd-stats"></div><div class="gvd-cols"><aside class="gvd-side">' +
    '<div class="gvd-filter" role="tablist" aria-label="Filter proposals">' + F.map(([k, l]) =>
      '<button type="button" role="tab" data-f="' + k + '" aria-selected="' + (FILTER === k) + '" class="' + (FILTER === k ? 'on' : '') + '">' +
      l + (k === 'all' ? '' : ' \u00b7 ' + count(k)) + '</button>').join('') + '</div>' +
    '<div class="gvd-items">' + (list.length ? list.map(p => {
      const live = d.live.indexOf(p) >= 0;
      const s = live && p._tally ? standing(p._tally, rulesFor(p, d.rules), d.bonded) : finalSplit(p);
      const my = myVote(p._mine), mine = my && my.o;
      return '<button type="button" class="gvd-item' + (String(p.id) === SEL ? ' on' : '') + '" data-id="' + esc(p.id) + '">' +
        '<span class="gvd-meta"><span class="gv-id">#' + esc(p.id) + '</span><span class="gv-kind">' + esc(kindOf(p)) + '</span>' +
        (live ? '<span class="gv-time">' + CLOCK + '<span>' + left(p.voting_end_time) + '</span></span>'
              : '<span class="gv-pill ' + esc(st(p)) + '">' + esc(STATUS[p.status] || p.status) + '</span>') + '</span>' +
        '<span class="gv-title">' + esc(titleOf(p)) + '</span>' + (s ? bar(s) : '') +
        '<span class="gvd-foot"><span>' + (live && s ? 'Turnout ' + s.turnout.toFixed(1) + '% of ' + (rulesFor(p, d.rules).quorum * 100).toFixed(0) + '%'
          : st(p) === 'deposit' ? 'Waiting for its deposit' : esc(when(p.voting_end_time).split(',')[0] || '')) + '</span>' +
        (live ? (mine ? '<b class="gvd-you ' + (my.split ? 'split' : (VOTE_C[mine] || '')) + '">You voted ' + esc(my.text) + '</b>'
          : p._mine === UNKNOWN ? '' : '<b class="gvd-you todo">Not voted</b>') : '') + '</span></button>';
    }).join('') : '<div class="empty">Nothing here.</div>') + '</div>' +
    '<p class="tiny gv-note">Proposals come straight from the chain. A vote can be changed until voting ends; the last one counts.</p>' +
    '</aside><div class="gvd-pane" id="gov-pane"></div></div></div>';

  // a vote being chosen or written is never redrawn under the person - as
  // long as it is still this wallet's, on a proposal still open
  if (FLOW && !flowValid(FLOW)) FLOW = null;
  const busy = FLOW && FLOW.desk && FLOW.id === SEL && (FLOW.opt || ($('#gov-memo') && $('#gov-memo').value.trim()));
  const pane = busy ? $('#gov-pane') : null;
  body.innerHTML = h;
  if (pane) $('#gov-pane').replaceWith(pane);
  paintStats();
  body.querySelectorAll('.gvd-filter button').forEach(b => b.addEventListener('click', () => { FILTER = b.getAttribute('data-f'); SEL = ''; draw(); }));
  body.querySelectorAll('.gvd-item').forEach(b => b.addEventListener('click', () => {
    SEL = b.getAttribute('data-id');
    body.querySelectorAll('.gvd-item').forEach(x => x.classList.toggle('on', x === b));
    open(SEL);
  }));
  if (!pane && SEL) open(SEL);
}

function paintStats(){
  const box = $('#gvd-stats');
  if (!box || !DATA) return;
  const d = DATA, a = addrOf();
  const todo = d.live.filter(p => p._mine === null).length;
  const unread = d.live.filter(p => p._mine === UNKNOWN).length;
  const mineVals = d.dels.slice().sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : 0));
  const tile = (k, v, s, extra) => '<div class="gvd-tile"><span>' + k + '</span><b>' + v + '</b><small>' + s + '</small>' + (extra || '') + '</div>';
  box.innerHTML =
    tile('Voting now', d.live.length + (d.live.length === 1 ? ' proposal' : ' proposals'),
      !a ? 'Open a wallet to vote' : todo ? '<span class="gvd-todo">You have not voted on ' + todo + '</span>'
        // a vote that could not be read is not a vote cast
        : unread ? 'Could not read your vote on ' + unread + (unread === 1 ? '' : ' of them')
        : d.live.length ? 'You voted on all of them' : 'Nothing to vote on') +
    tile('Your voting power', d.power > 0n ? L(d.power) + ' LUNC' : 'None staked',
      d.power > 0n ? share(d.power, d.bonded) + '% of all staked' : 'A vote weighs the LUNC you stake',
      '<button class="gvd-tile-go" id="gov-to-stake" type="button">' + (d.power > 0n ? 'Stake more' : 'Stake LUNC') + '</button>') +
    tile('Your validators', '<span class="gvd-faces">' + mineVals.slice(0, 4).map(x => { const v = valByOp(x.op); return face(v ? v.name : x.op.slice(12), x.op, x.op, v && v.ident); }).join('') +
      '</span>' + mineVals.length, mineVals.length ? 'They vote for you when you do not' : 'Stake to have one') +
    tile('Rules', 'Quorum ' + (d.rules.quorum * 100).toFixed(0) + '%',
      'Pass over ' + (d.rules.threshold * 100).toFixed(0) + '% Yes \u00b7 veto at ' + pct1(d.rules.veto * 100) + '%');
  fillLogos(box);
  const sb = $('#gov-to-stake');
  if (sb) sb.addEventListener('click', e => { e.preventDefault(); go('stake'); });
  if (!VALS && mineVals.length) validators().then(() => paintStats()).catch(() => {});
}

function draw(){ return isDesk() ? drawDesk() : drawPhone(); }

// One read at a time, and each for one wallet: an answer that comes back
// after the wallet changed is kept for that wallet but never drawn, and the
// wallet now open gets its own read as soon as the old one ends.
let LOADING = '', LOAD_AGAIN = false;
async function loadGov(){
  const a = addrOf();
  if (LOADING) { LOAD_AGAIN = true; return; }
  LOADING = a || '-';
  const body = $('#gov-body');
  validators().catch(() => {});          // the voters list needs them; start now
  // what this device kept from the last visit, drawn at once; the chain is
  // read meanwhile and the screen redrawn when it answers
  if (!DATA || DATA.addr !== a) {
    const k = keptRaw(a);
    if (k) { DATA = build(k); DATA.addr = a; draw(); }
    else body.innerHTML = '<div class="empty"><span class="spin"></span>Reading proposals</div>';
  }
  try {
    const raw = await fetchRaw(a);
    keepRaw(raw);
    if (addrOf() === a) { DATA = build(raw); DATA.addr = a; draw(); badgeFromData(); }
  } catch (e) {
    if (addrOf() === a && (!DATA || DATA.addr !== a)) body.innerHTML = '<div class="empty">Could not read proposals: ' + esc(e.message || e) + '</div>';
  } finally {
    LOADING = '';
    const again = LOAD_AGAIN || addrOf() !== a;
    LOAD_AGAIN = false;
    if (again) loadGov();
  }
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
  // open for votes only while its voting period runs, by the clock too
  const live = DATA.live.indexOf(p) >= 0 && votingOpen(p);
  const desk = isDesk();
  FLOW = { id: String(p.id), live: live, desk: desk, addr: addrOf() };
  $('#gov-sheet-title').textContent = 'Proposal #' + p.id;
  const rules = rulesFor(p, DATA.rules);
  const s = live && p._tally ? standing(p._tally, rules, DATA.bonded) : null;
  const f = !live ? finalSplit(p) : null;
  const my = myVote(p._mine), mine = my && my.o;
  const st = (STATUS[p.status] || '').toLowerCase();
  const text = textOf(p);
  const meta = '<div class="gv-sh-meta"><span class="gv-pill ' + esc(st) + '">' + esc(STATUS[p.status] || p.status) + '</span>' +
    '<span class="gv-kind">' + esc(kindOf(p)) + '</span>' +
    (p.expedited ? '<span class="gv-kind">expedited</span>' : '') +
    (live ? '<span class="gv-time">' + CLOCK + '<span>' + left(p.voting_end_time) + '</span></span>' : '') + '</div>';
  const split = s || f;
  const tally = !split ? '' : '<div class="gv-tally">' + bar(split) +
      '<div class="gv-legend">' +
        [['y', 'Yes', split.yes], ['n', 'No', split.no], ['v', 'No with veto', split.veto], ['a', 'Abstain', split.abstain]]
          .map(x => '<span class="' + x[0] + '"><i></i><em>' + x[1] + '</em><b>' + x[2].toFixed(1) + '%</b></span>').join('') +
      '</div>' +
      (s ? turnout(s, rules) + (desk ? '<div class="gvd-if">If voting ended now</div>' : '') +
        '<div class="gv-verdict ' + (s.verdict.ok ? 'ok' : 'bad') + '">' + esc(s.verdict.text) + '</div>' : '') +
      '</div>';
  let txt = '';
  if (text) {
    const long = text.length > (desk ? 1200 : 700);
    txt = '<div class="gov-text' + (long ? ' clip' : '') + '" id="gov-text">' + linkify(text, p.status !== 'PROPOSAL_STATUS_DEPOSIT_PERIOD') + '</div>' +
      (long ? '<button class="dust" id="gov-more" type="button">Show all</button>' : '');
  }
  let vote = '';
  if (live) {
    vote = '<div class="gv-vote">' +
      '<div class="gv-vote-h"><b>Your vote</b><span>' + (mine ? esc(my.text) + ' \u00b7 you can change it'
        : p._mine === UNKNOWN ? 'Could not read your vote' : 'Not voted yet') + '</span></div>' +
      '<div class="gov-opts">' + ['yes', 'no', 'veto', 'abstain'].map(o =>
        '<button class="gov-opt gv-o ' + ({ yes: 'y', no: 'n', veto: 'v', abstain: 'a' })[o] + (mine && OPT_KEY[mine] === o ? ' was' : '') +
        '" data-opt="' + o + '" type="button">' + OPT_ICON[o] + '<span>' + LABEL[o] + '</span></button>').join('') + '</div>' +
      '<div class="gv-compose"><textarea id="gov-memo" rows="2" maxlength="600" placeholder="Add a comment to your vote (optional)"></textarea>' +
        '<div class="gv-compose-f"><span>Public, saved on chain with the vote</span><b id="gov-memo-n">0 / ' + MEMO_MAX + '</b></div></div>' +
      '<div id="gov-review"><p class="gv-pick">Pick an option to see the fee and vote.</p></div></div>';
  }
  const votersBox = '<div id="gov-voters"><div class="empty"><span class="spin"></span>Reading votes and comments</div></div>';
  let host;
  if (desk) {
    host = $('#gov-pane');
    if (!host) return;
    // the phone's sheet holds nothing while the wide layout is in use (one set of ids)
    $('#gov-sheet-body').innerHTML = ''; sheet(false);
    const dates = [['Submitted', p.submit_time],
      st === 'deposit' ? ['Deposit ends', p.deposit_end_time] : ['Voting started', p.voting_start_time],
      [live || st === 'deposit' ? 'Voting ends' : 'Voting ended', p.voting_end_time]].filter(x => when(x[1]));
    const ch = changesOf(p);
    const at = ch.find(x => x[0] === 'At block');
    host.innerHTML = '<section class="gvd-head ' + esc(st) + '">' + meta + '<h2>' + esc(titleOf(p)) + '</h2>' +
        '<div class="gvd-dates">' + dates.concat(at ? [['Upgrade at block', at[1]]] : []).map(x =>
          '<div><span>' + x[0] + '</span><b>' + esc(x[0] === 'Upgrade at block' ? x[1] : when(x[1])) + '</b></div>').join('') + '</div>' +
        (!live && addrOf() && st !== 'deposit' ? '<div class="gvd-me" id="gov-me-ended"></div>' : '') + '</section>' +
      '<div class="gvd-row">' +
        (tally ? '<section class="gvd-card gvd-t"><h3>' + (live ? 'Tally' : 'Final tally') + '</h3>' + tally + '</section>' : '') +
        (live ? '<section class="gvd-card gvd-v">' + vote + '<div id="gov-myvals"></div></section>'
          : DATA.dels.length && st !== 'deposit' ? '<section class="gvd-card gvd-v"><div id="gov-myvals"></div></section>' : '') +
      '</div>' +
      (ch.length ? '<section class="gvd-card" id="gov-changes">' + changesHTML(p) + '</section>' : '') +
      (txt ? '<section class="gvd-card"><h3>Proposal text</h3>' + txt + '</section>' : '') +
      (st !== 'deposit' ? '<section class="gvd-card" id="gov-sum"><div class="empty"><span class="spin"></span>Reading votes</div></section>' +
        '<section class="gvd-card gvd-tcard"><div id="gov-voters"><div class="empty"><span class="spin"></span>Reading votes and comments</div></div></section>' : '');
  } else {
    host = $('#gov-sheet-body');
    host.innerHTML = meta + '<h3 class="gov-title">' + esc(titleOf(p)) + '</h3>' + tally +
      (live ? '<div class="gv-ends">Ends ' + new Date(p.voting_end_time).toLocaleString(document.documentElement.lang || 'en-GB',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</div>' : '') +
      txt + vote + votersBox;
    sheet(true);
  }
  if (!desk || st !== 'deposit') showVoters(String(p.id), live);
  if (desk) wireChanges(p);
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
    // a comment changed after the fee was shown: estimate again with it
    clearTimeout(memoBox._t);
    if (FLOW && FLOW.opt && !FLOW.sent && FLOW.memo !== memoBox.value.trim()) {
      // the fee shown was for the old comment: no signing until it is estimated again
      FLOW.ready = false; FLOW.armed = false;
      if (b) b.disabled = true;
      if (n <= MEMO_MAX) {
        const f = FLOW;
        memoBox._t = setTimeout(() => { if (FLOW === f && !f.sent) review(f.opt); }, 700);
      }
    }
  });
  host.querySelectorAll('.gov-opt').forEach(b => b.addEventListener('click', () => {
    host.querySelectorAll('.gov-opt').forEach(x => x.classList.toggle('on', x === b));
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
// Validator logos. A validator sets a Keybase key (identity) in its
// description and Keybase serves its picture: the lookup every explorer does,
// kept for a week under the same keys as Stake (vlogo2:<key>), "no picture"
// for a day. Until it is known, Cosmostation's public set by operator address;
// with neither, a letter on the validator's own colour.
const LOGO = op => 'https://raw.githubusercontent.com/cosmostation/chainlist/main/chain/terra-classic/moniker/' + op + '.png';
const hue = s => { s = String(s || ''); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
function kbCached(id){
  if (!id) return null;
  try { const c = JSON.parse(localStorage.getItem('vlogo2:' + id) || 'null'); if (c && Date.now() - c.t < (c.u ? 7 * 86400000 : 86400000)) return c; } catch (e) {}
  return null;
}
// pictures that failed once in this session: the table repaints as the stakes
// come in, and asking for a missing picture again on every repaint made the
// letter under it flicker
const NOPIC = new Set();
// and the ones already shown: drawn again at once, not lazily, so they do not blink either
const OKPIC = new Set();
const face = (name, key, op, ident) => {
  const c = kbCached(ident);
  let src = c && c.u && /^https:\/\//.test(c.u) ? c.u : op ? LOGO(op) : '';
  if (NOPIC.has(src)) src = '';
  return '<span class="gv-ava" style="--h:' + hue(key) + '"' + (ident && !c ? ' data-ident="' + esc(ident) + '"' : '') +
    '><em>' + esc((name || '?').trim().slice(0, 1).toUpperCase()) + '</em>' +
    (src ? '<img src="' + esc(src) + '" alt=""' + (OKPIC.has(src) ? '' : ' loading="lazy"') + ' referrerpolicy="no-referrer">' : '') + '</span>';
};
let KB_Q = Promise.resolve(), KB_PAUSE = 0;
function fillLogos(root){
  if (!root) return;
  // a picture that does not load leaves the letter under it
  root.querySelectorAll('.gv-ava img').forEach(img => { if (!img._w) { img._w = 1; img.addEventListener('load', () => OKPIC.add(img.getAttribute('src')), { once: true }); img.addEventListener('error', () => { NOPIC.add(img.getAttribute('src')); img.remove(); }, { once: true }); } });
  const ids = [...new Set([...root.querySelectorAll('.gv-ava[data-ident]')].map(e => e.getAttribute('data-ident')))];
  if (!ids.length) return;
  // four at a time, behind any lookup already running; after a refusal or an
  // error Keybase is left alone for 5 minutes
  KB_Q = KB_Q.then(async () => {
    for (let i = 0; i < ids.length; i += 4) {
      await Promise.all(ids.slice(i, i + 4).map(async id => {
        let c = kbCached(id);
        if (!c) {
          if (Date.now() < KB_PAUSE) return;
          try {
            const r = await fetch('https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=' + encodeURIComponent(id) + '&fields=pictures');
            if (!r.ok) { KB_PAUSE = Date.now() + 300000; return; }
            const j = await r.json();
            if (!j || !j.status || j.status.code !== 0 || !Array.isArray(j.them)) { KB_PAUSE = Date.now() + 300000; return; }
            let u = (j.them[0] && j.them[0].pictures && j.them[0].pictures.primary && j.them[0].pictures.primary.url) || '';
            if (!/^https:\/\//.test(u)) u = '';
            c = { u: u, t: Date.now() };
            try { localStorage.setItem('vlogo2:' + id, JSON.stringify(c)); } catch (e) {}
          } catch (e) { KB_PAUSE = Date.now() + 300000; return; }
        }
        const sel = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
        document.querySelectorAll('.gv-ava[data-ident="' + sel + '"]').forEach(el => {
          el.removeAttribute('data-ident');
          if (!c.u) return;
          const old = el.querySelector('img');
          if (old) old.remove();
          const img = document.createElement('img');
          img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = c.u; img._w = 1;
          img.addEventListener('load', () => OKPIC.add(c.u), { once: true });
          img.addEventListener('error', () => { NOPIC.add(c.u); img.remove(); }, { once: true });
          el.appendChild(img);
        });
      }));
    }
  }).catch(() => {});
}

/* The phone's list of voters. known: the record behind it is whole (the
   chain's own while voting is open, or a vote history read in full); when it
   is not, an address with no vote found is Unknown, the count says it is
   incomplete, and only confirmed non-voters are under "Not voted". */
function voterState(o, known){ return o ? 'yes' : known ? 'no' : 'unknown'; }
function voterListHTML(accs, votes, v, byAcc, known, filt, opened, total, weight){
  const tag = o => o ? '<b class="gov-v ' + (OPT_CLASS[o] || '') + '">' + esc(OPT[o] || o) + '</b>'
    : known ? '<b class="gov-v none">Not voted</b>' : '<b class="gov-v none unknown">Unknown</b>';
  const voted = accs.filter(a => votes[a]).length;
  const said = accs.filter(a => v.memo[a]).length;
  return '<div class="head" style="margin:20px 2px 8px"><h2>Voters</h2><span>' + voted + ' of ' + accs.length + ' voted' +
      (known ? '' : ' · history incomplete') + (v.step < 2 ? ' · reading comments…' : '') + '</span></div>' +
      '<div class="gv-filter" id="gov-filter">' + [['all', 'All'], ['yes', 'Voted'], ['no', 'Not voted']].concat(said ? [['memo', 'With comments']] : [])
        .map(([k, l]) => '<button class="' + (filt === k ? 'on' : '') + '" data-f="' + k + '" type="button">' + l + '</button>').join('') + '</div>' +
      '<div class="gov-voters gv-comments' + (opened ? ' all' : '') + '" id="gov-vals" data-f="' + filt + '">' + accs.map((a, i) => {
        const val = byAcc[a], w = weight(a), o = votes[a], c = v.memo[a];
        // a delegator's amount is known only once read (0 included); until then
        // "..." while the read can finish, then "stake not read" (#67 review)
        const has = val || Object.prototype.hasOwnProperty.call(v.stake, a);
        const stakeText = w > 0n ? 'VP ' + share(w, total) + '% · ' + L(w) + ' LUNC' : has ? 'no stake'
          : (v.stakeMiss && v.stakeMiss[a]) || v.step === 3 ? 'stake not read' : '\u2026';
        return '<div class="gov-voter' + (i >= 20 ? ' more' : '') + '" data-v="' + voterState(o, known) + '"' + (c ? ' data-m="1"' : '') + '>' +
          '<div class="gov-voter-top"><span class="gov-rank">' + (i + 1) + '</span>' + face(val ? val.name : a.slice(6), a, val && val.op, val && val.ident) +
          '<span class="gov-who">' + esc(val ? val.name : shortAcc(a)) + '<small>' + stakeText + '</small></span>' +
            (v.split && v.split[a] ? '<b class="gov-v split">' + esc(splitText(v.split[a])) + '</b>' : tag(o)) + '</div>' +
          (c ? '<div class="gov-memo">' + esc(c) + '</div>' : '') + '</div>';
      }).join('') + '</div>' +
      (accs.length > 20 && !opened ? '<button class="dust" id="gov-vals-all" type="button">Show all ' + accs.length + '</button>' : '');
}
async function showVoters(id, live){
  let vals;
  try { vals = await validators(); }
  catch (e) { const box = $('#gov-voters'); if (box) box.innerHTML = '<div class="tiny">Could not read the validators: ' + esc(e.message || e) + '</div>'; return; }
  // the wide table's choices, kept while this proposal stays open
  const T = { tab: 'all', opt: 'all', memo: false, quiet: false, q: '', limit: 40, open: {} };
  let filt = 'all', opened = false, last = null;
  const paint = v => {
    last = v;
    if (!FLOW || FLOW.id !== id || !$('#gov-voters')) return;
    if (FLOW.desk) return paintTable(id, live, v, vals, T, () => paint(last));
    const box = $('#gov-voters');
    const total = vals.reduce((a, x) => a + x.tokens, 0n) || 1n;
    const byAcc = {};
    vals.forEach(x => { byAcc[x.acc] = x; });
    // Who chose what: the chain's own record while voting is open; once it
    // ends the chain clears that record, and each voter's last vote transaction
    // is what remains.
    const votes = Object.assign({}, v.txv || {}, live ? v.votes : {});
    if (!live && v.step < 2) { box.innerHTML = '<div class="empty"><span class="spin"></span>Reading the vote transactions</div>'; return; }
    // One list: every validator, and every other address that left a comment,
    // ranked by voting power (a validator weighs what is bonded to it, anyone
    // else what they have staked). Each row carries its vote and its comment.
    const weight = a => byAcc[a] ? byAcc[a].tokens : (v.stake[a] || 0n);
    const accs = vals.filter(x => x.acc).map(x => x.acc).concat(Object.keys(v.memo).filter(a => !byAcc[a]));
    accs.sort((a, b) => (weight(b) > weight(a) ? 1 : weight(b) < weight(a) ? -1 : 0));
    box.innerHTML = voterListHTML(accs, votes, v, byAcc, live || v.txok, filt, opened, total, weight) +
      (live ? '' : '<p class="tiny gv-note">Read from the vote transactions: the chain clears its own record when voting ends.</p>');
    fillLogos(box);
    const all = $('#gov-vals-all');
    if (all) all.addEventListener('click', () => { opened = true; $('#gov-vals').classList.add('all'); all.remove(); });
    const fl = $('#gov-filter');
    if (fl) fl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      filt = b.getAttribute('data-f');
      fl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      const w = $('#gov-vals');
      w.setAttribute('data-f', filt);
      if (filt !== 'all') { opened = true; w.classList.add('all'); if (all) all.remove(); }
    });
  };
  try { await voters(id, paint); }
  catch (e) {
    const box = $('#gov-voters');
    if (box && FLOW && FLOW.id === id && !VOTERS[id]) box.innerHTML = '<div class="tiny">Could not read the votes: ' + esc(e.message || e) + '</div>';
  }
}

/* ---------------- who voted, on a wide screen ----------------
   Two summaries (validators and everyone else), then one table of the votes:
   voter, stake, share of all staked LUNC, the vote and when (linked to its
   transaction); a comment
   opens under its row. Validators that did not vote are hidden unless asked. */
const big = raw => {                                   // uluna -> 12.3B / 450M / 9.1K LUNC
  const n = Number(raw) / 1e6;
  if (!(n > 0)) return '0';
  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(n >= 10 ? 0 : 2);
};
const ago = t => {
  const ms = Date.now() - new Date(t);
  if (!(ms >= 0)) return '';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? d + (d === 1 ? ' day ago' : ' days ago') : h ? h + (h === 1 ? ' hour ago' : ' hours ago') : m ? m + ' min ago' : 'just now';
};
const FINDER_TX = 'https://finder.terraclassic.community/columbus-5/tx/';
const OPT_SHORT = { VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No', VOTE_OPTION_NO_WITH_VETO: 'No with veto', VOTE_OPTION_ABSTAIN: 'Abstain' };
const C_OF = { y: '#3ecf8e', n: '#f06a6a', v: '#c77dff', a: '#8a93a6', none: 'rgba(107,130,168,.28)' };
const MEMO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4z"/></svg>';

function donut(title, center, sub, parts, rows){
  // parts: [{k, w}] by weight, w in micro-LUNC (or a count) as given, never
  // cut to whole LUNC; each boundary is the running total over the sum,
  // rounded to 0.01% like the legend's pctOf, so 1.5 / 1 LUNC turns at 60%
  const ws = parts.map(p => ({ k: p.k, w: BigInt(p.w || 0) }));
  const sum = ws.reduce((a, p) => a + p.w, 0n) || 1n;
  const pos = x => Number((x * 20000n / sum + 1n) / 2n) / 100;
  let run = 0n;
  const stops = ws.filter(p => p.w > 0n).map(p => { const a = pos(run); run += p.w; return C_OF[p.k] + ' ' + a.toFixed(2) + '% ' + pos(run).toFixed(2) + '%'; });
  return '<div class="gvd-sum"><h3>' + title + '</h3><div class="gvd-sum-b">' +
    '<div class="gvd-ring" style="background:conic-gradient(' + (stops.length ? stops.join(',') : C_OF.none + ' 0 100%') + ')"><span><b>' + center + '</b><small>' + sub + '</small></span></div>' +
    '<div class="gvd-sum-l">' + rows.map(r => '<div class="' + r.k + '"><span><i></i>' + r.label + '<em>' + r.n + '</em></span><small>' + r.stake + '</small><b>' + r.pct + '</b></div>').join('') + '</div></div></div>';
}

function paintTable(id, live, v, vals, T, again){
  const box = $('#gov-voters'), sum = $('#gov-sum');
  if (!box) return;
  const votes = Object.assign({}, v.txv || {}, live ? v.votes : {});
  // an ended proposal's votes come only from the vote history: with a page of
  // it missing, "no vote found" is not "did not vote"
  const known = live || !!v.txok;
  const NONE = known ? 'Did not vote' : 'Unknown';
  const waiting = !live && v.step < 2;
  const byAcc = {};
  vals.forEach(x => { byAcc[x.acc] = x; });
  const K = o => OPT_CLASS[o] || 'none';
  const bonded = DATA && DATA.bonded > 0n ? DATA.bonded : (vals.reduce((a, x) => a + x.tokens, 0n) || 1n);
  // rounded to 0.01%, not cut (9.61%, not 9.60%)
  const pctOf = (x, t) => t > 0n ? Number((x * 20000n / t + 1n) / 2n) / 100 : 0;

  const tag = o => o ? '<b class="gov-v ' + (OPT_CLASS[o] || '') + '">' + esc(OPT[o] || o) + '</b>' : '<b class="gov-v none">' + (known ? 'Not voted' : 'Unknown') + '</b>';
  // voting power: "<0.01%" decided on the amounts, before any rounding, and
  // the bar on the same 0-100% scale as the label (#67 review)
  const vpLabel = (x, t, p) => !(x > 0n) || !(t > 0n) ? '\u2014' : x * 10000n < t ? '&lt;0.01%' : p.toFixed(2) + '%';
  const vpBar = (x, t) => x > 0n && t > 0n ? Math.min(100, Number(x * 1000000n / t) / 10000).toFixed(2) : '0';
  // ---- this wallet's validators and their votes (they vote for its stake when it does not)
  const mv = $('#gov-myvals');
  if (mv && DATA) {
    const mine = DATA.dels.slice().sort((x, y) => (y.amount > x.amount ? 1 : y.amount < x.amount ? -1 : 0)).slice(0, 6);
    mv.innerHTML = !mine.length ? '' :
      '<div class="gvd-mv-h">' + (live ? 'If you do not vote, your validators vote for you' : 'Your validators') + '</div>' + mine.map(x => {
        const val = vals.find(y => y.op === x.op), acc = val ? val.acc : accOf(x.op);
        return '<div class="gvd-mv">' + face(val ? val.name : x.op.slice(12), acc, x.op, val && val.ident) +
          '<span><b>' + esc(val ? val.name : shortAcc(x.op)) + '</b><small>' + L(x.amount) + ' LUNC of yours</small></span>' +
          (waiting ? '<b class="gov-v none">\u2026</b>' : v.split && v.split[acc] ? '<b class="gov-v split">' + esc(splitText(v.split[acc])) + '</b>' : tag(votes[acc])) + '</div>';
      }).join('');
    fillLogos(mv);
  }
  // ---- an ended proposal: this wallet's own vote, read from its vote transaction
  const me = $('#gov-me-ended'), my = addrOf();
  if (me && my) me.innerHTML = waiting ? '<span class="tiny">Reading your vote\u2026</span>' :
    votes[my] ? 'You voted ' + (v.split && v.split[my] ? '<b class="gov-v split">' + esc(splitText(v.split[my])) + '</b>' : tag(votes[my])) +
      (v.tx[my] && v.tx[my].time ? ' <span class="gvd-dim">' + esc(ago(v.tx[my].time)) + '</span>' : '')
    // absent from a history read in full means no vote; from a partial one, unknown
    : v.txok ? 'You did not vote on this one.' : '<span class="gvd-dim">Your vote could not be read: the vote history did not come back whole.</span>';

  // ---- the two summaries
  if (sum) {
    if (waiting) sum.innerHTML = '<div class="empty"><span class="spin"></span>Reading the vote transactions</div>';
    else {
      const opts = ['VOTE_OPTION_YES', 'VOTE_OPTION_NO', 'VOTE_OPTION_NO_WITH_VETO', 'VOTE_OPTION_ABSTAIN'];
      const vv = vals.filter(x => x.acc);
      const vTot = vv.reduce((a, x) => a + x.tokens, 0n) || 1n;
      // a split vote counts for each of its options, by its weight
      const part = (a, o) => shareOf(v.split, votes, a, o);
      const vBy = o => vv.filter(x => part(x.acc, o) > 0n);
      const vStake = o => vv.reduce((a, x) => a + x.tokens * part(x.acc, o) / W1, 0n);
      const vVoted = vv.filter(x => votes[x.acc]);
      const vNone = vTot - vVoted.reduce((a, x) => a + x.tokens, 0n);
      const dl = Object.keys(votes).filter(a => !byAcc[a]);
      const D = delegatorSums(dl, votes, v.split, v.stake);
      const dKnown = D.known, dTot = D.total, dBy = D.by, dSt = D.st;
      const useStake = dTot > 0n;
      sum.innerHTML = '<div class="gvd-sums">' +
        donut('Validators', vVoted.length + ' / ' + vv.length, known ? 'voted' : 'vote found \u00b7 history incomplete',
          opts.map(o => ({ k: K(o), w: vStake(o) })).concat([{ k: 'none', w: vNone > 0n ? vNone : 0n }]),
          opts.map(o => ({ k: K(o), label: OPT_SHORT[o], n: vBy(o).length, stake: big(vStake(o)), pct: pctOf(vStake(o), vTot).toFixed(2) + '%' }))) +
        donut('Delegators', String(dl.length), dKnown < dl.length ? 'voted \u00b7 stake read for ' + dKnown + ' of ' + dl.length : 'voted',
          opts.map(o => ({ k: K(o), w: useStake ? dSt(o) : BigInt(dBy(o).length) })),
          opts.map(o => ({ k: K(o), label: OPT_SHORT[o], n: dBy(o).length, stake: useStake ? big(dSt(o)) : '\u2014',
            pct: useStake ? pctOf(dSt(o), dTot).toFixed(2) + '%' : '' }))) +
        '</div><p class="tiny gvd-src">Validators weigh what is bonded to them; a delegator who votes overrides their validator for their own stake.' +
        (live ? '' : ' Read from the vote transactions: the chain clears its own record when voting ends.') +
        (dKnown < dl.length && useStake ? ' Delegator percentages are shares of the stake that could be read (' + dKnown + ' of ' + dl.length + ' amounts).' : '') +
        (known ? '' : ' <b class="gvd-todo">Part of that history did not come back, so these totals may be short and a voter shown as Unknown may have voted.</b>') + '</p>';
    }
  }
  if (waiting) { box.innerHTML = ''; return; }

  // ---- the rows
  const rows = [];
  vals.filter(x => x.acc).forEach((x, i) => rows.push({ a: x.acc, val: x, rank: i + 1, stake: x.tokens, o: votes[x.acc] }));
  Object.keys(votes).filter(a => !byAcc[a]).forEach(a => rows.push({ a: a, val: null, rank: 0, stake: v.stake[a], o: votes[a] }));
  const nVal = rows.filter(r => r.val && r.o).length, nDel = rows.filter(r => !r.val).length;
  const q = T.q.trim().toLowerCase();
  let list = rows.filter(r =>
    (T.tab === 'all' || (T.tab === 'val') === !!r.val) &&
    (r.o || (r.val && T.quiet)) &&
    (T.opt === 'all' || (v.split && v.split[r.a] ? v.split[r.a].some(x => K(x[0]) === T.opt) : K(r.o) === T.opt)) &&
    (!T.memo || v.memo[r.a]) &&
    (!q || r.a.toLowerCase().includes(q) || (r.val && (r.val.name.toLowerCase().includes(q) || r.val.op.toLowerCase().includes(q)))));
  const w = r => r.stake === undefined ? -1n : r.stake;
  list.sort((x, y) => (w(y) > w(x) ? 1 : w(y) < w(x) ? -1 : 0));
  const shown = list.slice(0, T.limit);
  const said = rows.filter(r => v.memo[r.a]).length;

  const optSel = [['all', 'All votes'], ['y', 'Yes'], ['n', 'No'], ['v', 'No with veto'], ['a', 'Abstain']];
  box.innerHTML =
    '<div class="gvd-tb-head"><h3>Votes</h3><span>' + (v.step < 2 ? 'reading comments\u2026' : v.step < 3 ? 'reading delegators\u2019 stake\u2026' : '') + '</span></div>' +
    '<div class="gvd-tools">' +
      '<div class="gvd-seg" role="tablist" aria-label="Voters">' +
        [['all', 'All', nVal + nDel], ['val', 'Validators', nVal], ['del', 'Delegators', nDel]].map(([k, l, n]) =>
          '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (T.tab === k) + '" class="' + (T.tab === k ? 'on' : '') + '">' + l + '<em>' + n + '</em></button>').join('') + '</div>' +
      '<label class="gvd-sel"><span class="gvd-sr">Vote type</span><select id="gvd-opt">' +
        optSel.map(([k, l]) => '<option value="' + k + '"' + (T.opt === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="gvd-sw"><input type="checkbox" id="gvd-memo"' + (T.memo ? ' checked' : '') + '><i></i>Comments only<em>' + said + '</em></label>' +
      '<label class="gvd-sw"><input type="checkbox" id="gvd-quiet"' + (T.quiet ? ' checked' : '') + '><i></i>' + (known ? 'Validators that did not vote' : 'Validators with no vote found') + '</label>' +
      '<label class="gvd-find"><span class="gvd-sr">Find a voter</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input type="search" id="gvd-q" placeholder="Name or address" value="' + esc(T.q) + '"></label>' +
    '</div>' +
    (shown.length ? '<div class="gvd-tbl-wrap"><table class="gvd-tbl"><thead><tr><th>Voter</th><th class="r c-stake">Voting stake</th><th>Voting power</th><th>Vote</th></tr></thead><tbody>' +
      shown.map(r => {
        const c = v.memo[r.a], tx = v.tx[r.a], k = K(r.o), p = r.stake ? pctOf(r.stake, bonded) : 0, isOpen = !!T.open[r.a];
        // the stake's state, once per row: the Voting stake column and, where
        // a narrow card folds that column away, the line under the power bar.
        // A known amount (zero as a dash); "..." only while its read can still
        // finish; "stake not read" once it failed or the reading phase ended
        const stk = r.stake !== undefined ? (r.stake > 0n ? big(r.stake) : '\u2014')
          : (v.stakeMiss && v.stakeMiss[r.a]) || v.step === 3 ? 'stake not read' : '\u2026';
        const stkHTML = r.stake > 0n ? stk : '<span class="gvd-dim">' + stk + '</span>';
        return '<tr class="gvd-tr' + (c ? ' has' : '') + (isOpen ? ' open' : '') + '" data-a="' + esc(r.a) + '">' +
          '<td><span class="gvd-voter">' + (r.val ? '<span class="gvd-rank">' + r.rank + '</span>' + face(r.val.name, r.a, r.val.op, r.val.ident)
            : '<span class="gvd-rank d">D</span><span class="gv-ava gvd-del" style="--h:' + hue(r.a) + '"><em>' + esc(r.a.slice(6, 7).toUpperCase()) + '</em></span>') +
            '<span class="gvd-vn"><b>' + esc(r.val ? r.val.name : shortAcc(r.a)) + '</b><small>' + (r.val ? 'Validator' : 'Delegator') + '</small></span></span></td>' +
          '<td class="r c-stake">' + stkHTML + '</td>' +
          // the stake again under the bar, shown only when its column is folded away
          '<td><span class="gvd-vp"' + (r.stake > 0n ? ' title="' + esc(big(r.stake)) + ' LUNC"' : '') + '><i style="width:' + vpBar(r.stake, bonded) + '%"></i><b>' + vpLabel(r.stake, bonded, p) + '</b></span>' +
            '<small class="gvd-vp-st">' + stkHTML + (r.stake > 0n ? ' LUNC' : '') + '</small></td>' +
          '<td><span class="gvd-vcell">' + (v.split && v.split[r.a]
              // a split vote, said as one: every option with its share
              ? '<span class="gvd-vote split" title="Split vote">' + esc(splitText(v.split[r.a])) + '</span>'
              : r.o ? '<span class="gvd-vote ' + k + '">' + esc(OPT_SHORT[r.o] || r.o) + '</span>' : '<span class="gvd-vote none">' + NONE + '</span>') +
            (c ? '<button type="button" class="gvd-mbtn" aria-expanded="' + isOpen + '" aria-label="Show the comment">' + MEMO_ICON + '</button>' : '') + '</span>' +
            // when, linked to the vote transaction on the explorer
            '<small class="gvd-when">' + (tx ? '<a class="gvd-hash" href="' + FINDER_TX + esc(tx.hash) + '" target="_blank" rel="noopener noreferrer" title="Transaction ' + esc(tx.hash) + '">' +
              esc(tx.time ? ago(tx.time) : tx.hash.slice(0, 8) + '\u2026') + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>'
              : r.o && v.step < 2 ? '\u2026' : '') + '</small></td></tr>' +
          (c ? '<tr class="gvd-memo-r"' + (isOpen ? '' : ' hidden') + '><td colspan="4"><div class="gvd-memo">' + esc(c) + '</div></td></tr>' : '');
      }).join('') + '</tbody></table></div>' : '<div class="empty">No votes match.</div>') +
    (list.length > shown.length ? '<button class="dust gvd-more" id="gvd-more" type="button">Show ' + Math.min(40, list.length - shown.length) + ' more' + (list.length - shown.length > 40 ? ' of ' + (list.length - shown.length) : '') + '</button>' : '');

  fillLogos(box);
  box.querySelectorAll('.gvd-seg button').forEach(b => b.addEventListener('click', () => { T.tab = b.getAttribute('data-tab'); T.limit = 40; again(); }));
  const sel = $('#gvd-opt'); if (sel) sel.addEventListener('change', () => { T.opt = sel.value; T.limit = 40; again(); });
  const m = $('#gvd-memo'); if (m) m.addEventListener('change', () => { T.memo = m.checked; again(); });
  const qu = $('#gvd-quiet'); if (qu) qu.addEventListener('change', () => { T.quiet = qu.checked; again(); });
  const fi = $('#gvd-q');
  if (fi) fi.addEventListener('input', () => {
    clearTimeout(fi._t);
    fi._t = setTimeout(() => { T.q = fi.value; T.limit = 40; again(); const n = $('#gvd-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250);
  });
  const more = $('#gvd-more'); if (more) more.addEventListener('click', () => { T.limit += 40; again(); });
  // a comment opens under its row: the row with one, or its button
  box.querySelectorAll('.gvd-tr.has').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const a = tr.getAttribute('data-a'), memo = tr.nextElementSibling;
    T.open[a] = !T.open[a];
    tr.classList.toggle('open', T.open[a]);
    const b = tr.querySelector('.gvd-mbtn'); if (b) b.setAttribute('aria-expanded', String(T.open[a]));
    if (memo && memo.classList.contains('gvd-memo-r')) memo.hidden = !T.open[a];
  }));
}

// a vote flow holds while the wallet it was opened for is the active one and
// its proposal is still in voting
function flowValid(f, now){
  if (!f || f.addr !== addrOf() || !DATA) return false;
  const p = DATA.live.find(x => String(x.id) === String(f.id));
  return !!p && votingOpen(p, now);
}
// still in its voting period by its own clock: a list kept on the device can
// hold a proposal whose voting has ended since
function votingOpen(p, now){
  const end = new Date(p && p.voting_end_time).getTime();
  return Number.isFinite(end) && end > (now === undefined ? Date.now() : now);
}
async function review(opt){
  const f = FLOW;
  if (!flowValid(f)) { FLOW = null; if (SEL) open(SEL); return; }
  f.opt = opt; f.armed = false; f.sent = false; f.ready = false;
  // each review is numbered: one that answers after a newer one started (the
  // comment changed meanwhile) is dropped, so its fee and its button never land
  const seq = f.seq = (f.seq || 0) + 1;
  const stale = () => FLOW !== f || f.opt !== opt || f.seq !== seq;
  const out = $('#gov-review');
  out.innerHTML = '<div class="p2p-lines"><div class="p2p-line"><span>Vote</span><b>' + esc(LABEL[opt]) + ' on #' + esc(f.id) + '</b></div>' +
    '<div class="p2p-line"><span>Weight</span><b>' + (DATA.power > 0n ? L(DATA.power) + ' LUNC staked' : 'none - nothing staked') + '</b></div></div>' +
    (opt === 'veto' ? '<p class="tiny" style="text-align:left">No with veto also counts as No. If vetoes pass ' + (DATA.rules.veto * 100).toFixed(1) +
      '% the proposal fails and its deposit is burned.</p>' : '') +
    '<div class="tiny" id="gov-fee" style="text-align:left">Checking with the chain\u2026</div>' +
    '<div id="gov-out"></div><button class="btn solid" id="gov-go" type="button" disabled>Vote ' + esc(LABEL[opt]) + '</button>';
  const memoBox = $('#gov-memo');
  const memoOver = () => !!memoBox && new TextEncoder().encode(memoBox.value.trim()).length > MEMO_MAX;
  // the estimate carries the comment, as the signed vote will: the memo adds
  // bytes and so gas, and the fee reviewed here is the cap on the fee signed
  const memo = memoBox ? memoBox.value.trim() : '';
  f.memo = memo;
  try {
    const est = await dryRunVote(addrOf(), f.id, opt, S.MNEMONIC, memoOver() ? '' : memo);
    if (stale()) return;
    f.fee = est.gasFee;                     // the fee reviewed; signing refuses more (audit F04)
    $('#gov-fee').textContent = 'Network fee about ' + fmt(est.gasFee / 1e6) + ' LUNC';
    const btn = $('#gov-go');
    f.ready = true;
    btn.disabled = memoOver();
    // one handler, whatever happens: two would sign on the first tap and skip
    // the "press again" step
    btn.onclick = () => confirm(btn, f, opt);
  } catch (e) {
    if (stale()) return;
    $('#gov-fee').textContent = '';
    $('#gov-out').innerHTML = '<div class="sbad">' + esc(e.message || e) + '</div>';
  }
}

async function confirm(btn, f, opt){
  if (f.sent || f.opt !== opt) return;
  // reviewed for another wallet, or the proposal closed since: nothing is
  // signed, and the pane is drawn again for what is true now
  if (!flowValid(f)) {
    f.armed = false;
    btn.disabled = true;
    $('#gov-out').innerHTML = '<div class="sbad">' + (f.addr !== addrOf() ? 'The wallet changed. Review the vote again for this one.' : 'Voting on this proposal has ended.') + '</div>';
    FLOW = null;
    setTimeout(() => { if (!FLOW && SEL) open(SEL); }, 1500);
    return;
  }
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
  document.querySelectorAll('#gov-sheet-body .gov-opt, #gov-pane .gov-opt').forEach(x => { x.disabled = true; });
  const out = $('#gov-out');
  try {
    const memo = ($('#gov-memo') && $('#gov-memo').value || '').trim();
    $('#gov-memo').disabled = true;
    const res = await sendVote(f.addr, f.id, opt, S.MNEMONIC, memo, f.fee);
    buzz('success');
    btn.textContent = 'Waiting for the block\u2026';
    const done = await res.wait();
    out.innerHTML = '<div class="sline strong"><span>' + (done ? 'Voted ' + esc(LABEL[opt]) + ', block ' + done.height : 'Sent, not seen in a block yet') +
      '</span><b>' + res.hash.slice(0, 10) + '\u2026</b></div>';
    btn.textContent = 'Done';
    btn.disabled = false;
    btn.onclick = () => { if (f.desk) { FLOW = null; open(f.id); } else { FLOW = null; sheet(false); } };
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

// Work a screen starts when it comes on waits for the move onto it to finish
// (0.24 s on a desktop, 0.42 s on a phone): run in the same frame as the
// switch, a repaint of a long list held the first frame of the move back.
const later = fn => setTimeout(fn, document.documentElement.classList.contains('dk') ? 280 : 460);
// Read whenever the tab comes on screen, so the tally is never stale.
(function () {
  const st = document.getElementById('st-gov');
  if (!st || typeof MutationObserver === 'undefined') return;
  let was = st.classList.contains('on');
  new MutationObserver(() => {
    const on = st.classList.contains('on');
    if (on && !was) later(loadGov);
    was = on;
  }).observe(st, { attributes: true, attributeFilter: ['class'] });
})();

// the wide layout comes and goes with the window (desktop.js sets html.dk)
(function () {
  if (typeof MutationObserver === 'undefined') return;
  let was = isDesk();
  new MutationObserver(() => {
    const now = isDesk();
    if (now === was) return;
    was = now;
    FLOW = null; sheet(false);
    if (DATA) draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();

export { loadGov, standing, kindOf, rewrap, APP_TAG, linkify };
