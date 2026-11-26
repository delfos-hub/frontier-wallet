/* Governance vote, byte for byte.

   MsgVote (cosmos.gov.v1) is hand-encoded in tx.js like every other message;
   the expected bytes were generated once with cosmjs-types 0.9.0 and pasted in.

       node tests/gov.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const D = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const EXPECTED = {
  "yes": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123308c25f122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1801",
  "abstain": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123308c25f122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1802",
  "no": "0a162f636f736d6f732e676f762e76312e4d7367566f746512320807122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1803",
  "veto": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123408e0a712122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1804"
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-'));
const stubs = {
  'chain.js': `export const LCD=''; export const amt=()=>0; export const fmt=String; export const getJSON=async()=>({});
export const iconHTML=()=>''; export const paintIcons=()=>{};`,
  'shell.js': `export const $=()=>null; export const buzz=()=>{}; export const go=()=>{}; export const tap=()=>{}; export const sha={};`,
  'state.js': `export const S={};`,
  'tokens.js': `export const heldTokens=()=>[]; export const refreshBalances=()=>{}; export const sortHeld=a=>a;`,
  'notify.js': `export const notify=()=>{}; export const chime=()=>{};`,
};
for (const [f, src] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), src);
fs.writeFileSync(path.join(dir, 'tx.js'), fs.readFileSync(path.resolve('assets/js/tx.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
fs.writeFileSync(path.join(dir, 'amount.js'), fs.readFileSync(path.resolve('assets/js/amount.js'), 'utf8'));
globalThis.document = { getElementById: () => null, querySelector: () => null, addEventListener(){} };
const tx = await import(pathToFileURL(path.join(dir, 'tx.js')).href);

const hex = b => Buffer.from(b).toString('hex');
let pass = 0, fail = 0;
function check(name, got, want){
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want); }
}
function throws(name, fn, re){
  try { fn(); fail++; console.log('  FAIL ' + name + ' (was allowed)'); }
  catch (e) { if (re.test(e.message)) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + ': ' + e.message); } }
}

console.log('MsgVote vs cosmjs-types');
check('yes on 12226', hex(tx.voteAny(D, '12226', 'yes')), EXPECTED.yes);
check('abstain on 12226', hex(tx.voteAny(D, '12226', 'abstain')), EXPECTED.abstain);
check('no on 7', hex(tx.voteAny(D, '7', 'no')), EXPECTED.no);
check('veto on 300000', hex(tx.voteAny(D, '300000', 'veto')), EXPECTED.veto);
throws('unknown option refused', () => tx.voteAny(D, '1', 'maybe'), /unknown vote option/);
throws('proposal 0 refused', () => tx.voteAny(D, '0', 'yes'), /bad proposal id/);


// gov.js touches the page when it loads, so its two pure helpers are lifted out
// of the shipped source text and run on their own.
const gsrc = fs.readFileSync(path.resolve('assets/js/gov.js'), 'utf8');
const rewrap = new Function(gsrc.slice(gsrc.indexOf('const B32'), gsrc.indexOf('const accOf')) + '; return rewrap;')();
const APP_TAG = new Function(gsrc.slice(gsrc.indexOf('const APP_TAG'), gsrc.indexOf('let VALS')) + '; return APP_TAG;')();
console.log('\nvalidator account addresses (checked against the bech32 package)');
check('terravaloper1jhtmkma... -> account', rewrap('terravaloper1jhtmkmakjvvtwur05klc7fd72e5n39m4x3c96v', 'terra'), 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l');
check('terra1jhtmkmak... -> operator', rewrap('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l', 'terravaloper'), 'terravaloper1jhtmkmakjvvtwur05klc7fd72e5n39m4x3c96v');
check('terravaloper1csj849g... -> account', rewrap('terravaloper1csj849g63q7dkgx02djsjjq8ph3ce60mg5tu53', 'terra'), 'terra1csj849g63q7dkgx02djsjjq8ph3ce60mgm8pyz');
check('terra1csj849g6... -> operator', rewrap('terra1csj849g63q7dkgx02djsjjq8ph3ce60mgm8pyz', 'terravaloper'), 'terravaloper1csj849g63q7dkgx02djsjjq8ph3ce60mg5tu53');
check('bad checksum refused', String(rewrap('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2m', 'terravaloper')), 'null');
console.log('\napp tags are not comments');
check('"Vote with BiNodes Finder" skipped', APP_TAG.test('Vote with BiNodes Finder'), true);
check('"Voted via Station" skipped', APP_TAG.test('Voted via Station'), true);
check('a real reason kept', APP_TAG.test('Voting YES to fund the security audit. Much needed.'), false);
check('"Scammer proposal..." kept', APP_TAG.test('Scammer proposal to take 21 percent of lunc from CP'), false);

// linkify: lifted with its escaper, run on hostile and ordinary text
const escSrc = gsrc.slice(gsrc.indexOf('const esc ='), gsrc.indexOf('const L ='));
const linkSrc = gsrc.slice(gsrc.indexOf('const URL_RE'), gsrc.indexOf('function openOutside'));
const linkify = new Function(escSrc + '\n' + linkSrc + '; return linkify;')();
console.log('\nlinks in proposal text');
check('https link becomes a link showing its own address',
  linkify('Details: https://discourse.luncgoblins.com/t/x/536'),
  'Details: <a class="gov-link" href="https://discourse.luncgoblins.com/t/x/536" rel="noopener noreferrer" target="_blank">https://discourse.luncgoblins.com/t/x/536</a>');
check('trailing full stop stays outside the link',
  linkify('see https://a.io/p.').endsWith('</a>.'), true);
check('http:// is not linked', linkify('http://a.io/x').includes('<a'), false);
check('javascript: is not linked', linkify('javascript:alert(1)').includes('<a'), false);
check('a quote ends the link and is escaped, no attribute injection',
  linkify('https://a.io/"onmouseover="x').includes('href="https://a.io/"') && linkify('https://a.io/"onmouseover="x').includes('&quot;onmouseover'), true);
check('markup in the text is escaped', linkify('<img src=x onerror=1> https://a.io').startsWith('&lt;img'), true);
check('& in a link is escaped in the href', linkify('https://a.io/?a=1&b=2').includes('href="https://a.io/?a=1&amp;b=2"'), true);
check('look-alike host (Cyrillic e) is shown and opened as punycode',
  linkify('claim at https://t\u0435rra-classic.io/claim now'),
  'claim at <a class="gov-link" href="https://xn--trra-classic-sck.io/claim" rel="noopener noreferrer" target="_blank">https://xn--trra-classic-sck.io/claim</a> now');
check('a right-to-left override ends the link',
  linkify('https://evil.com/\u202emoc.elgoog').includes('href="https://evil.com/"'), true);
check('a zero-width space ends the link',
  linkify('https://evil.com\u200b.google.com').includes('href="https://evil.com/"'), true);
check('a closing bracket opened inside the link stays in it',
  linkify('https://en.wikipedia.org/wiki/Terra_(blockchain)').includes('href="https://en.wikipedia.org/wiki/Terra_(blockchain)"'), true);
check('a closing bracket around the link stays outside',
  linkify('(see https://a.io/x)').endsWith('</a>)'), true);
check('no links while in the deposit period',
  linkify('https://a.io/x <b>', false), 'https://a.io/x &lt;b&gt;');
check('an address the URL parser rejects stays plain text',
  linkify('https://[bad').includes('<a'), false);
check('an address with a user name before the host stays plain text',
  linkify('https://terra-classic.io@evil.com/claim').includes('<a'), false);
check('an address with a user name and password stays plain text',
  linkify('https://user:pass@evil.com/x').includes('<a'), false);

// what a proposal changes on chain, read from its messages (Vote on a wide screen)
const changesOf = new Function('L', gsrc.slice(gsrc.indexOf('function changesOf('), gsrc.indexOf('function drawDesk(')) + '; return changesOf;')(x => String(Number(x) / 1e6));
console.log('\nwhat a proposal changes');
const row = (ch, k) => (ch.find(x => x[0] === k) || [])[1];
const up = changesOf({ messages: [{ '@type': '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade', plan: { name: 'v4.2.0', height: '27450000' } }] });
check('an upgrade names its plan and block', row(up, 'Plan') + ' @ ' + row(up, 'At block'), 'v4.2.0 @ 27450000');
const legacy = changesOf({ messages: [{ '@type': '/cosmos.gov.v1.MsgExecLegacyContent', content: { '@type': '/cosmos.upgrade.v1beta1.SoftwareUpgradeProposal', plan: { name: 'v3', height: '1' } } }] });
check('a legacy proposal is read through its content', row(legacy, 'Plan'), 'v3');
const spend = changesOf({ messages: [{ '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend', recipient: 'terra1recipientaddressxxxxxxxxxxxxxxxxxxxxxx', amount: [{ denom: 'uluna', amount: '5000000' }] }] });
check('a pool spend names the amount', row(spend, 'Amount'), '5 LUNC');
check('a long address is shortened', row(spend, 'To').length < 30, true);
const params = changesOf({ messages: [{ '@type': '/cosmwasm.wasm.v1.MsgUpdateParams', params: { code_upload_access: {}, instantiate_default_permission: 'x' } }] });
check('a params change names the module and keys', row(params, 'Action') + ' / ' + row(params, 'Parameters'), 'Set the wasm parameters / code_upload_access, instantiate_default_permission');
check('no messages is a signal vote', row(changesOf({ messages: [] }), 'Action'), 'None on chain: a signal vote');
const bad = changesOf({ messages: [{ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1c', msg: '{not json' }] });
check('a contract message that does not parse still reads', row(bad, 'Action'), 'Run a contract');

// a cancelled upgrade, every action, and what was left out
{
  const cancel = changesOf({ messages: [{ '@type': '/cosmos.gov.v1.MsgExecLegacyContent', content: { '@type': '/cosmos.upgrade.v1beta1.CancelSoftwareUpgradeProposal', title: 't' } }] });
  check('a legacy CancelSoftwareUpgradeProposal reads as a cancellation', row(cancel, 'Action'), 'Cancel the planned upgrade');
  const cancel2 = changesOf({ messages: [{ '@type': '/cosmos.upgrade.v1beta1.MsgCancelUpgrade' }] });
  check('so does MsgCancelUpgrade', row(cancel2, 'Action'), 'Cancel the planned upgrade');
  check('and an upgrade is still an upgrade', row(up, 'Action'), 'Upgrade the chain software');
  const four = Array.from({ length: 4 }, () => ({ '@type': '/cosmwasm.wasm.v1.MsgUpdateParams', params: { a: 1 } }));
  const fifth = changesOf({ messages: four.concat([{ '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend', recipient: 'terra1r', amount: [{ denom: 'uluna', amount: '7000000' }] }]) });
  check('a pool spend in fifth place is shown', row(fifth, 'Action 5') + ' / ' + row(fifth, 'Amount'), 'Pay from the community pool / 7 LUNC');
  check('and the actions are numbered', row(fifth, 'Action 1'), 'Set the wasm parameters');
  const many = changesOf({ messages: Array.from({ length: 25 }, () => ({ '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend', recipient: 'terra1r', amount: [{ denom: 'uluna', amount: '1000000' }] })) });
  check('no cap on summary rows: 20 actions, 3 rows each', many.filter(x => x[0] === 'Amount').length, 20);
  check('past 20 the rest are counted', row(many, 'Not shown'), '5 more actions, listed in full below');
  check('and every action is there as data', /Every action as data \(' \+ msgs\.length \+ '\)/.test(gsrc), true);
}

// split votes keep every option and its weight
console.log('\nsplit votes');
{
  const lib = new Function(gsrc.slice(gsrc.indexOf('const NUM_OPT ='), gsrc.indexOf('const splitText')) + '\n' +
    gsrc.slice(gsrc.indexOf('const shareOf ='), gsrc.indexOf('};', gsrc.indexOf('const shareOf =')) + 2) + '\nreturn { splitOf, shareOf, W1 };')();
  const sp = lib.splitOf([{ option: 'VOTE_OPTION_YES', weight: '0.250000000000000000' }, { option: 'VOTE_OPTION_NO', weight: '0.750000000000000000' }]);
  check('both options kept with their weights', JSON.stringify(sp.map(x => [x[0], String(x[1])])), JSON.stringify([['VOTE_OPTION_YES', '250000'], ['VOTE_OPTION_NO', '750000']]));
  check('numeric options from a transaction read too', lib.splitOf([{ option: 1, weight: '0.5' }, { option: 3, weight: '0.5' }]).map(x => x[0]).join(','), 'VOTE_OPTION_YES,VOTE_OPTION_NO');
  const split = { d1: sp }, votes = { d1: 'VOTE_OPTION_YES', d2: 'VOTE_OPTION_NO' };
  const stake = 100000000n;                               // 100 LUNC
  const of = (a, o) => stake * lib.shareOf(split, votes, a, o) / lib.W1;
  check('100 LUNC split 25/75: 25 to Yes', String(of('d1', 'VOTE_OPTION_YES')), '25000000');
  check('and 75 to No', String(of('d1', 'VOTE_OPTION_NO')), '75000000');
  check('a single vote takes it all', String(of('d2', 'VOTE_OPTION_NO')) + '/' + String(of('d2', 'VOTE_OPTION_YES')), '100000000/0');
  check('the breakdown adds stake by weight', /const stOf = o => known\.reduce\(\(t, a\) => t \+ st\(a\) \* shareOf\(split, votes, a, o\) \/ W1, 0n\)/.test(gsrc) &&
    /const vStake = o => vv\.reduce\(\(a, x\) => a \+ x\.tokens \* part\(x\.acc, o\) \/ W1, 0n\)/.test(gsrc), true);
  check('a split shows as one in the row', /gvd-vote split" title="Split vote">' \+ esc\(splitText\(v\.split\[r\.a\]\)\)/.test(gsrc), true);
}

// a vote stays tied to its wallet and to an open proposal
console.log('\nthe vote flow');
{
  const mk = (addr, live) => new Function('addrOf', 'DATA', gsrc.slice(gsrc.indexOf('function flowValid('), gsrc.indexOf('async function review(')) + '; return flowValid;')(() => addr, { live: live });
  const f = { id: '12237', addr: 'terra1a' };
  const soon = new Date(Date.now() + 3600e3).toISOString(), gone = new Date(Date.now() - 60e3).toISOString();
  check('same wallet, still voting: holds', mk('terra1a', [{ id: '12237', voting_end_time: soon }])(f), true);
  check('another wallet active: does not', mk('terra1b', [{ id: '12237', voting_end_time: soon }])(f), false);
  check('the proposal left voting (Passed): does not', mk('terra1a', [{ id: '12238', voting_end_time: soon }])(f), false);
  check('still in the kept open list but past its end time: does not', mk('terra1a', [{ id: '12237', voting_end_time: gone }])(f), false);
  check('open() offers voting only before the end time', /const live = DATA\.live\.indexOf\(p\) >= 0 && votingOpen\(p\);/.test(gsrc), true);
  check('a redraw drops a flow that no longer holds', /if \(FLOW && !flowValid\(FLOW\)\) FLOW = null;\s*const busy/.test(gsrc), true);
  check('confirm refuses one that no longer holds, before signing', /async function confirm\(btn, f, opt\)\{[\s\S]{0,200}if \(!flowValid\(f\)\) \{/.test(gsrc), true);
  check('and signs for the wallet that was reviewed', /sendVote\(f\.addr, f\.id/.test(gsrc), true);
}

// unknown stays unknown
console.log('\nunknown is not an answer');
{
  check('a vote that could not be read is not "voted on all"', /: unread \? 'Could not read your vote on '/.test(gsrc), true);
  check('"did not vote" only from a history read in full', /: v\.txok \? 'You did not vote on this one\.' :/.test(gsrc), true);
  check('a missing page makes the history partial', /out\.txok = rest\.every\(Boolean\) && Math\.ceil\(total \/ 100\) <= 1 \+ more;/.test(gsrc), true);
}

// a read for one wallet never lands on another
console.log('\nreads per wallet');
{
  const at = gsrc.indexOf('let LOADING =');
  const code = gsrc.slice(at, gsrc.indexOf('/* ---------------- one proposal', at));
  let cur = 'A', DATA = null, drawn = [];
  const pend = {};
  const env = {
    addrOf: () => cur,
    $: () => ({ set innerHTML(v) {} }),
    validators: () => Promise.resolve(),
    keptRaw: () => null,
    keepRaw: () => {},
    fetchRaw: a => new Promise(res => { pend[a] = res; }),
    build: raw => ({ who: raw.who }),
    draw: () => drawn.push(DATA_REF().who),
    badgeFromData: () => {},
    esc: String
  };
  let DATA_REF;
  const mk = new Function(...Object.keys(env), 'let DATA = null;\n' + code + '\nreturn { loadGov, get DATA(){ return DATA; } };');
  const g = mk(...Object.values(env));
  DATA_REF = () => g.DATA;
  const tick = () => new Promise(r => setTimeout(r, 0));
  g.loadGov();                                  // A starts
  cur = 'B'; g.loadGov();                       // B asked while A runs
  pend.A({ who: 'A' }); await tick(); await tick();
  check('A\u2019s late answer is not drawn on B\u2019s screen', drawn.includes('A'), false);
  check('B gets its own read', typeof pend.B, 'function');
  pend.B({ who: 'B' }); await tick(); await tick();
  check('and B\u2019s answer is drawn', drawn.join(','), 'B');
  check('DATA is B\u2019s', g.DATA.who, 'B');
}

// split votes and unknown history in every view
console.log('\nsplit and unknown everywhere');
{
  const lib = new Function('UNKNOWN', 'OPT', 'OPT_SHORT', gsrc.slice(gsrc.indexOf('const NUM_OPT ='), gsrc.indexOf('const shareOf =')) + '\nreturn { myVote, splitText };')(
    {}, { VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No' }, { VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No' });
  const my = lib.myVote({ options: [{ option: 'VOTE_OPTION_YES', weight: '0.25' }, { option: 'VOTE_OPTION_NO', weight: '0.75' }] });
  check('my own split vote reads as the split, not as Yes', my.text, 'Yes 25% \u00b7 No 75%');
  check('a single vote reads as itself', lib.myVote({ options: [{ option: 'VOTE_OPTION_NO', weight: '1' }] }).text, 'No');
  check('the phone card and the list use it', (gsrc.match(/const my = myVote\(p\._mine\), mine = my && my\.o;/g) || []).length, 3);
  check('the vote filter finds a split under each of its options', /v\.split\[r\.a\]\.some\(x => K\(x\[0\]\) === T\.opt\)/.test(gsrc), true);
  check('with history missing, no vote found reads Unknown, not Did not vote', /const NONE = known \? 'Did not vote' : 'Unknown';/.test(gsrc) && /'<span class="gvd-vote none">' \+ NONE \+ '<\/span>'/.test(gsrc), true);
  check('and the validators\u2019 total says the history is incomplete', /known \? 'voted' : 'vote found \\u00b7 history incomplete'/.test(gsrc), true);
}

// a large table: no copy of every vote per lookup
console.log('\nlarge voter list');
{
  const shareOf = new Function('W1', 'return ' + gsrc.slice(gsrc.indexOf('(split, votes, a, o) =>'), gsrc.indexOf('};', gsrc.indexOf('(split, votes, a, o) =>')) + 1))(1000000n);
  const votes = {}, stake = {}, split = {};
  const O = ['VOTE_OPTION_YES', 'VOTE_OPTION_NO', 'VOTE_OPTION_ABSTAIN', 'VOTE_OPTION_NO_WITH_VETO'];
  for (let i = 0; i < 1500; i++) { votes['d' + i] = O[i % 4]; if (i < 300) stake['d' + i] = BigInt(i + 1) * 1000000n; }
  const dl = Object.keys(votes), t0 = Date.now();
  let sum = 0n;
  for (let r = 0; r < 4; r++) for (const o of O) sum += dl.reduce((a, x) => a + (stake[x] || 0n) * shareOf(split, votes, x, o) / 1000000n, 0n);
  const ms = Date.now() - t0;
  check('1,500 voters x 4 options x 4 passes stay fast (' + ms + ' ms)', ms < 500, true);
  check('and add up to every known stake, four times', String(sum), String(4n * Array.from({ length: 300 }, (_, i) => BigInt(i + 1) * 1000000n).reduce((a, b) => a + b, 0n)));
}

// every action can be read, fresh or kept
console.log('\nevery action inspectable');
{
  const at = gsrc.indexOf('const MAX_ACTIONS = 20;');
  const lib = new Function('esc', 'changesOf', 'getJSON', 'G', '$', 'SEL',
    gsrc.slice(at, gsrc.indexOf('function drawDesk(')) + '\n' + gsrc.slice(gsrc.indexOf('function slim('), gsrc.indexOf('function keepRaw(')) +
    '\nreturn { changesHTML, actionText, fullActions, slim, ACTION_CAP };');
  const spend = { '@type': '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend', recipient: 'terra1finalrecipient', amount: [{ denom: 'uluna', amount: '7000000' }], authority: 'terra10d07y265gmmuvt4z0w9aw880jnsr700juxf8sk' };
  const filler = Array.from({ length: 20 }, (_, i) => ({ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1c' + i, msg: { blob: 'x'.repeat(1500) } }));
  const P = { id: '99', messages: filler.concat([spend]) };
  const full = JSON.parse(JSON.stringify(P));
  const L = lib((x) => String(x).replace(/</g, '&lt;'), () => [['Action', 'x']],
    async (url) => ({ proposal: JSON.parse(JSON.stringify(full)) }), 'G', () => null, '99');
  const h = L.changesHTML(P);
  check('fresh: 21 actions listed, one by one', (h.match(/class="gvd-act"/g) || []).length, 21);
  const t21 = L.actionText(P.messages[20]);
  check('fresh: the 21st action shows its recipient and amount', /terra1finalrecipient/.test(t21) && /"amount": "7000000"/.test(t21), true);
  const kept = L.slim(JSON.parse(JSON.stringify(P)));
  check('kept on the device: trimmed and marked', kept._slim === true && !kept.messages[20].recipient, true);
  const hk = L.changesHTML(kept);
  check('kept: the screen says the details are being read again', /were not kept on this device/.test(hk) && !/class="gvd-act"/.test(hk), true);
  const ok = await L.fullActions(kept);
  const t21k = L.actionText(kept.messages[20]);
  check('kept: after the read the 21st action has its recipient and amount', ok && !kept._slim && /terra1finalrecipient/.test(t21k) && /"amount": "7000000"/.test(t21k), true);
  check('kept: and all 21 are listed', (L.changesHTML(kept).match(/class="gvd-act"/g) || []).length, 21);
  const huge = L.actionText({ blob: 'y'.repeat(L.ACTION_CAP + 10) });
  check('an action past the cap says it is cut, and by how much', /\[cut: this action is \d+ characters, the first 200000 are shown\]$/.test(huge), true);
}

// #67 review on c079531: the current vote, the phone list, missing stakes
console.log('\nthe current vote, the phone list, missing stakes');
{
  const pick = (a, b) => gsrc.slice(gsrc.indexOf(a), gsrc.indexOf(b));
  const libsrc = pick('const NUM_OPT =', 'const splitText') + '\n' + pick('function delegatorSums(', '/* Who voted,');
  // voters() run on simulated chain answers
  const runVoters = new Function('getJSON', 'G', 'LCD', 'APP_TAG', 'validators',
    libsrc + '\n' + pick('const VOTERS = {};', 'let DATA = null;') + '\nreturn { voters, shareOf, W1, delegatorSums };');
  const NO1 = [{ option: 'VOTE_OPTION_NO', weight: '1.000000000000000000' }];
  const OLD = [{ option: 1, weight: '0.25' }, { option: 3, weight: '0.75' }];
  const answers = (stakeFails) => async (url) => {
    if (/\/votes\?/.test(url)) return { votes: [{ voter: 'd1', options: NO1 }, { voter: 'd2', options: [{ option: 'VOTE_OPTION_YES', weight: '1' }] }], pagination: {} };
    if (/txs\?query=/.test(url)) return { total: '1', tx_responses: [{ txhash: 'A'.repeat(64), timestamp: '', tx: { body: { memo: '', messages: [{ voter: 'd1', proposal_id: '7', options: OLD }] } } }] };
    if (/delegations\/d1/.test(url)) return { delegation_responses: [{ balance: { amount: '100000000' } }] };
    if (/delegations\/d2/.test(url)) { if (stakeFails) throw new Error('timeout'); return { delegation_responses: [{ balance: { amount: '100000000' } }] }; }
    if (/delegations\/d3/.test(url)) return { delegation_responses: [] };
    return {};
  };
  const G1 = runVoters(answers(false), '', '', /^$/, async () => []);
  const v = await G1.voters('7');
  check('the chain says 100% No, an older transaction said 25/75: the vote is No', v.votes.d1 + ' / split ' + (v.split.d1 ? 'kept' : 'none'), 'VOTE_OPTION_NO / split none');
  check('so the chart gives d1 all of No and none of Yes',
    String(G1.shareOf(v.split, v.votes, 'd1', 'VOTE_OPTION_NO')) + '/' + String(G1.shareOf(v.split, v.votes, 'd1', 'VOTE_OPTION_YES')), '1000000/0');
  const dl = ['d1', 'd2'];
  const both = G1.delegatorSums(dl, v.votes, v.split, v.stake);
  check('two delegators of 100 LUNC, Yes and No: 50/50 of 200 known', both.known + ' ' + String(both.total) + ' ' + String(both.st('VOTE_OPTION_YES')) + '/' + String(both.st('VOTE_OPTION_NO')), '2 200000000 100000000/100000000');

  const G2 = runVoters(answers(true), '', '', /^$/, async () => []);
  const v2 = await G2.voters('8');
  const one = G2.delegatorSums(dl, v2.votes, v2.split, v2.stake);
  check('the Yes voter’s stake read fails: it is missing, not zero', ('d2' in v2.stake) + ' ' + (v2.stakeMiss.d2 === true), 'false true');
  check('and the summary knows 1 of 2 amounts, 100 LUNC of known stake', one.known + ' of ' + one.all + ', ' + String(one.total), '1 of 2, 100000000');
  check('the donut says how many amounts were read', /'voted \\u00b7 stake read for ' \+ dKnown \+ ' of ' \+ dl\.length/.test(gsrc), true);
  check('and the note says the shares are of the stake that could be read', /Delegator percentages are shares of the stake that could be read/.test(gsrc), true);
  const zero = G1.delegatorSums(['d1', 'd3'], { d1: 'VOTE_OPTION_NO', d3: 'VOTE_OPTION_YES' }, {}, { d1: 100000000n, d3: 0n });
  check('a successful zero balance is a known amount of 0', zero.known + ' of ' + zero.all + ', ' + String(zero.total), '2 of 2, 100000000');

  // #67 review on a390d83: several votes in one transaction, paged delegations
  const pctOf = new Function('return ' + gsrc.slice(gsrc.indexOf('(x, t) =>', gsrc.indexOf('const pctOf = (x, t) =>')), gsrc.indexOf(';\n', gsrc.indexOf('const pctOf = (x, t) =>'))))();
  const vt = (voter, option, pid = '9') => ({ voter, proposal_id: pid, option });
  const txOf = (h, msgs) => ({ txhash: h.repeat(64), timestamp: '', tx: { body: { memo: '', messages: msgs } } });
  const closed = (aliceTwo) => async (url) => {
    if (/\/votes\?/.test(url)) return { votes: [], pagination: {} };
    // newest first: Alice Yes then No and Bob Yes in one transaction; an older Alice Abstain
    // Nans's stake case, proposal 10: Alice Yes, Bob No
    if (/txs\?query=.*%3D10&/.test(url)) return { total: '1', tx_responses: [txOf('D', [vt('alice', 'VOTE_OPTION_YES', '10'), vt('bob', 'VOTE_OPTION_NO', '10')])] };
    if (/txs\?query=/.test(url)) return { total: '2', tx_responses: [
      txOf('B', [vt('alice', 'VOTE_OPTION_YES'), vt('bob', 'VOTE_OPTION_YES'), { voter: 'alice', proposal_id: '8', option: 'VOTE_OPTION_YES' }, vt('alice', 'VOTE_OPTION_NO')]),
      txOf('C', [vt('alice', 'VOTE_OPTION_ABSTAIN')]),
    ] };
    if (/delegations\/alice\?pagination\.key=/.test(url)) {
      check('the next page is asked for with the cursor, encoded', /pagination\.key=k%2B1%3D/.test(url), true);
      if (aliceTwo === 'fail') throw new Error('timeout');
      return { delegation_responses: [{ balance: { amount: '99000000' } }], pagination: { next_key: aliceTwo === 'loop' ? 'k+1=' : null } };
    }
    if (/delegations\/alice/.test(url)) return { delegation_responses: [{ balance: { amount: '1000000' } }], pagination: { next_key: 'k+1=' } };
    if (/delegations\/bob/.test(url)) return { delegation_responses: [{ balance: { amount: '99000000' } }], pagination: { next_key: null } };
    return {};
  };
  const G3 = runVoters(closed('ok'), '', '', /^$/, async () => []);
  const v3 = await G3.voters('9');
  check('one transaction, Alice Yes then No, Bob Yes: Alice is No, Bob is Yes', v3.txv.alice + ' ' + v3.txv.bob, 'VOTE_OPTION_NO VOTE_OPTION_YES');
  check('each voter once, the vote on another proposal and the older Abstain ignored', Object.keys(v3.txv).sort().join(','), 'alice,bob');
  check('Alice’s vote points at the transaction that holds it', v3.tx.alice.hash, 'B'.repeat(64));
  check('Alice’s stake is both pages: 1 + 99 LUNC', String(v3.stake.alice), '100000000');
  const v10 = await runVoters(closed('ok'), '', '', /^$/, async () => []).voters('10');
  const ab = G3.delegatorSums(['alice', 'bob'], Object.assign({}, v10.txv), v10.split, v10.stake);
  check('Alice Yes with 1 + 99 LUNC on two pages, Bob No with 99: 50.25% Yes, 49.75% No, 2 of 2 known',
    pctOf(ab.st('VOTE_OPTION_YES'), ab.total).toFixed(2) + '/' + pctOf(ab.st('VOTE_OPTION_NO'), ab.total).toFixed(2) + ' ' + ab.known + ' of ' + ab.all, '50.25/49.75 2 of 2');

  const G4 = runVoters(closed('fail'), '', '', /^$/, async () => []);
  const v4 = await G4.voters('10');
  check('Alice’s second page fails: no partial 1 LUNC, her stake is missing', ('alice' in v4.stake) + ' ' + (v4.stakeMiss.alice === true), 'false true');
  const ab4 = G4.delegatorSums(['alice', 'bob'], Object.assign({}, v4.txv), v4.split, v4.stake);
  check('coverage 1 of 2, Bob’s 99 LUNC is all of the known stake', ab4.known + ' of ' + ab4.all + ', ' + String(ab4.total), '1 of 2, 99000000');
  check('her phone row reads "stake not read"', /\(!val && v\.stakeMiss && v\.stakeMiss\[a\]\) \? 'stake not read'/.test(gsrc), true);

  // the desktop table, rendered: each voter's own Voting stake cell
  const deskSrc = pick('const big = raw =>', 'const ago = t =>') + pick('const FINDER_TX =', 'function paintTable(') +
    pick('function paintTable(', '// a vote flow holds');
  const boxes = {};
  const el = () => ({ innerHTML: '', querySelectorAll: () => [], addEventListener(){} });
  const desk = new Function('$', 'DATA', 'OPT', 'OPT_CLASS', 'esc', 'face', 'shortAcc', 'fillLogos', 'hue', 'splitText', 'shareOf', 'delegatorSums', 'W1', 'addrOf',
    deskSrc + '\nreturn { paintTable };')(
    q => (q === '#gov-voters' || q === '#gov-sum') ? (boxes[q] = boxes[q] || el()) : null, null,
    { VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No' }, { VOTE_OPTION_YES: 'y', VOTE_OPTION_NO: 'n' }, String, () => '', a => a, () => {}, () => 0,
    () => '', G4.shareOf, G4.delegatorSums, G4.W1, () => '');
  const T0 = () => ({ tab: 'all', opt: 'all', memo: false, quiet: false, q: '', limit: 40, open: {} });
  const cell = (st, a) => {
    desk.paintTable('10', false, st, [], T0(), () => {});
    const html = boxes['#gov-voters'].innerHTML, at = html.indexOf('data-a="' + a + '"');
    const m = at < 0 ? null : html.slice(at).match(/<td class="r c-stake">([\s\S]*?)<\/td>/);
    return m ? m[1].replace(/<[^>]+>/g, '') : 'no row';
  };
  const pending = Object.assign({}, v4, { step: 2, stake: { bob: 99000000n }, stakeMiss: {} });
  check('desktop: while the stakes are still being read, Alice’s cell shows …', cell(pending, 'alice'), '\u2026');
  check('desktop: after her second page failed, Alice’s cell says stake not read', cell(v4, 'alice'), 'stake not read');
  check('desktop: Bob’s cell still shows 99', cell(v4, 'bob'), '99');
  check('desktop: and the summary says stake read for 1 of 2', /stake read for 1 of 2/.test(boxes['#gov-sum'].innerHTML), true);
  check('desktop: a read that ended without marking her missing still does not stay …', cell(Object.assign({}, v4, { stakeMiss: {} }), 'alice'), 'stake not read');
  check('desktop: a successful zero balance keeps its dash', cell(Object.assign({}, v4, { stake: { alice: 0n, bob: 99000000n }, stakeMiss: {} }), 'alice'), '\u2014');

  // #67 review on c7402d9: the compact table (container 700 px or less) folds
  // the Voting stake column away; the same state shows under the power bar
  const compact = (st, a) => {
    desk.paintTable('10', false, st, [], T0(), () => {});
    const html = boxes['#gov-voters'].innerHTML, at = html.indexOf('data-a="' + a + '"');
    const m = at < 0 ? null : html.slice(at).match(/<small class="gvd-vp-st">([\s\S]*?)<\/small>/);
    return m ? m[1].replace(/<[^>]+>/g, '') : 'no row';
  };
  const zeroA = Object.assign({}, v4, { stake: { alice: 0n, bob: 99000000n }, stakeMiss: {} });
  check('compact: Alice pending reads … under her bar', compact(pending, 'alice'), '\u2026');
  check('compact: after her failed second page, stake not read', compact(v4, 'alice'), 'stake not read');
  check('compact: a confirmed zero, the dash', compact(zeroA, 'alice'), '\u2014');
  check('compact: Bob’s 99 LUNC is still there to read', compact(v4, 'bob'), '99 LUNC');
  check('compact: and the summary reports 1 of 2 amounts read', /stake read for 1 of 2/.test(boxes['#gov-sum'].innerHTML), true);
  check('both cells come from one state per row', /const stk = r\.stake !== undefined/.test(gsrc) && (gsrc.match(/stkHTML/g) || []).length === 3, true);
  {
    // which of the two is seen at 700 px and at 701 px of container width
    const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');
    const q = css.indexOf('@container (max-width:700px){'), body = css.slice(q, css.indexOf('}\n@container', q));
    const base = /\.gvd-vp-st\{display:none[;}]/.test(css) && css.indexOf('.gvd-vp-st{display:none') < q;
    check('701 px: the Voting stake column shows, the line under the bar does not', base && !/\.gvd-tbl \.c-stake\{display:none\}/.test(css.slice(0, q)), true);
    check('700 px: the column folds and the line under the bar shows', /\.gvd-tbl \.c-stake\{display:none\}/.test(body) && /\.gvd-tbl \.gvd-vp-st\{display:block\}/.test(body), true);
  }

  // the rings: micro-LUNC, not whole LUNC, and the legend's rounding
  const sumOf = (a, b) => Object.assign({}, v4, { txv: { alice: 'VOTE_OPTION_YES', bob: 'VOTE_OPTION_NO' }, stake: { alice: a, bob: b }, stakeMiss: {}, txok: true });
  const ring = st => {
    desk.paintTable('10', false, st, [], T0(), () => {});
    const h = boxes['#gov-sum'].innerHTML, d = h.slice(h.indexOf('<h3>Delegators</h3>'));
    const g = /conic-gradient\([^ ]+ ([0-9.]+)% ([0-9.]+)%/.exec(d), yes = /<div class="y">[\s\S]*?<b>([^<]*)<\/b>/.exec(d);
    return g[2] + ' / ' + (yes && yes[1]);
  };
  check('1.5 LUNC Yes, 1 LUNC No: the ring turns at 60% and the label says 60%', ring(sumOf(1500000n, 1000000n)), '60.00 / 60.00%');
  check('0.6 LUNC Yes, 0.4 LUNC No: both below one LUNC, still 60%', ring(sumOf(600000n, 400000n)), '60.00 / 60.00%');
  check('no stake read at all: the ring falls back to the count (1 of 2 is 50%)', ring(sumOf(0n, 0n)).split(' / ')[0], '50.00');

  const G5 = runVoters(closed('loop'), '', '', /^$/, async () => []);
  const v5 = await G5.voters('9');
  check('a cursor given twice stops the read and leaves the stake missing', ('alice' in v5.stake) + ' ' + (v5.stakeMiss.alice === true), 'false true');

  // the phone list, rendered
  const listLib = new Function('OPT', 'OPT_CLASS', 'esc', 'share', 'L', 'face', 'shortAcc',
    pick('const NUM_OPT =', 'const shareOf =') + '\n' + pick('function voterState(', 'async function showVoters(') + '\nreturn { voterListHTML };')(
    { VOTE_OPTION_YES: 'Yes', VOTE_OPTION_NO: 'No' }, { VOTE_OPTION_YES: 'y', VOTE_OPTION_NO: 'n' }, String, () => '1', String, () => '', a => a);
  const val = { name: 'Val One', tokens: 1000000n };
  const vv = { memo: {}, split: {}, step: 3, stakeMiss: {} };
  const render = (known) => listLib.voterListHTML(['val1'], {}, vv, { val1: val }, known, 'all', false, 1000000n, () => 1000000n);
  const partial = render(false);
  check('history failed: the validator reads Unknown, not Not voted', />Unknown</.test(partial) && !/>Not voted<\/b>/.test(partial), true);
  check('the count says it is incomplete', /0 of 1 voted · history incomplete/.test(partial), true);
  check('and the row is not under the Not voted filter', /data-v="unknown"/.test(partial) && !/data-v="no"/.test(partial), true);
  const whole = render(true);
  check('history read in full and empty: Not voted, counted plainly', />Not voted<\/b>/.test(whole) && /0 of 1 voted</.test(whole) && /data-v="no"/.test(whole), true);
  const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');
  check('the Not voted filter shows only data-v="no" rows', /#gov-vals\[data-f="no"\] \.gov-voter:not\(\[data-v="no"\]\)/.test(css), true);
  check('the phone list is drawn with known = live or a whole history', /voterListHTML\(accs, votes, v, byAcc, live \|\| v\.txok,/.test(gsrc), true);
}

// the voters table's numbers
console.log('\nvoters table');
const big = new Function(gsrc.slice(gsrc.indexOf('const big ='), gsrc.indexOf('const ago =')) + '; return big;')();
check('billions', big(88520000000000000n), '88.52B');
check('millions', big(792000000000000n), '792.00M');
check('thousands', big(1500000000n), '1.5K');
check('nothing', big(0n), '0');
// shares are rounded to 0.01%, not cut
{
  const at = gsrc.indexOf('const pctOf = (x, t) =>');
  const pctOf = new Function('return ' + gsrc.slice(gsrc.indexOf('(x, t) =>', at), gsrc.indexOf(';\n', at)))();
  check('9.6149% reads 9.61', pctOf(96149n, 1000000n), 9.61);
  check('9.6150% reads 9.62 (rounded, not cut)', pctOf(96150n, 1000000n), 9.62);
  check('nothing over nothing', pctOf(1n, 0n), 0);
  check('tally pct rounds too', /const pct = x => all > 0n \? Number\(\(x \* 20000n \/ all \+ 1n\) \/ 2n\) \/ 100 : 0;/.test(gsrc), true);
}
// a narrow card folds the stake column, so Vote stays in view (CSS container query)
{
  const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');
  check('stake cells are marked for folding', (gsrc.match(/c-stake/g) || []).length, 2);
  check('the table measures its own width', /\.gvd-tbl-wrap\{[^}]*container-type:inline-size/.test(css), true);
  const q = css.indexOf('@container (max-width:700px)'), base = css.indexOf('.gvd-voter{display:flex');
  check('the narrow rules come after the base ones (else they lose)', q > base && base > 0, true);
  check('the proposal text fills the card', /\.gvd-card \.gov-text\{max-width:none/.test(css), true);
  check('in a narrow tile the Stake button goes under the value, not over it',
    /\.gvd-tile\{container-type:inline-size\}\s*@container \(max-width:260px\)\{\s*\.gvd-tile-go\{position:static/.test(css), true);
  check('the tiles use the columns of the list below', /\.gvd-stats\{display:grid;grid-template-columns:minmax\(290px,340px\) 0 repeat\(3,minmax\(0,1fr\)\)/.test(css), true);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
