/* The buyer's side after paying (audit round 3, D).

   D1: the TON wallet's answer is not trusted. A buy whose answer was lost
   stays "paying" and is settled from the chain: the lock found open means
   paid, and only once the payment can no longer land (validUntil + 5 min) is
   it called off. D2: a take the offers service refuses is not swallowed: the
   buy says so, with the date the GRAM can come back. watchBuys() is lifted
   from the shipped gram.js and run against stubs for the chain and the Worker. */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('not found: ' + header);
}
const NOW = 1_800_000_000, ID = '0:' + 'cc'.repeat(32), ME = 'terra1me';
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

async function run(buy, { lock, takes, takeRecord, clock = NOW, switchTo, lcd, relay }){
  const store = { [ID]: Object.assign({ offerId: 'o1', lunc: '100000000', gram: '1', timeout: NOW + 30 * 3600, created: NOW - 60 }, buy) };
  const notes = [], savedBy = []; let addrCalls = 0;
  const env = {
    WATCHING_BUYS: false, document: { hidden: false }, REFUSAL_FINAL_SEC: 120,
    buys: () => store, saveBuy: (id, v) => { store[id] = Object.assign({}, store[id], v); },
    readLock: async () => lock, now: () => clock, addrOf: () => (switchTo && addrCalls++ ? switchTo : ME),
    buysOf: a => (a === ME ? store : {}), saveBuyOf: (a, id, v) => { savedBy.push(a); if (a === ME) store[id] = Object.assign({}, store[id], v); },
    api: async (p) => {
      if (p === '/takes') { if (takes instanceof Error) throw takes; return {}; }   // takes undefined = accepted
      if (takeRecord instanceof Error) throw takeRecord;
      return takeRecord;
    },
    notify: n => notes.push(n), drawBuys: () => {}, sellerLockOk: async () => [], chime: () => {}, buzz: () => {}, load: () => {},
    getJSON: async () => (lcd ? { data: lcd } : {}), relayerUrl: () => '', human: x => String(x), CLAIM_MARGIN: 600,
    NET: { tonApi: '', tonCodeHash: '', lcd: '', htlc: '' }, btoa: x => x, fetch: relay || (async () => ({ ok: true }))
  };
  const names = Object.keys(env);
  const f = new Function(...names, lift(src, 'async function watchBuys(){') + '\nreturn watchBuys;')(...names.map(k => env[k]));
  await f();
  return { b: store[ID], notes, savedBy };
}
const OPEN = { state: 'active', status: 'open' }, NONE = { state: 'uninit' };

group('a payment whose answer was lost is settled from the chain (D1)');
let r = await run({ stage: 'paying', validUntil: NOW + 300 }, { lock: OPEN });
ok('the lock found open means paid: the take is announced', r.b.stage === 'announced', r.b.stage);
r = await run({ stage: 'paying', validUntil: NOW - 60 }, { lock: NONE });
ok('no lock yet, payment could still land: the buy stays open', r.b.stage === 'paying', r.b.stage);
r = await run({ stage: 'paying', validUntil: NOW - 400 }, { lock: NONE });
ok('no lock once the payment can no longer land: called off', r.b.stage === 'cancelled', r.b.stage);
r = await run({ stage: 'sent', validUntil: NOW + 300 }, { lock: NONE });
ok('"sent" with the lock not visible yet is not called off early', r.b.stage === 'sent', r.b.stage);

group('a take the offers service refuses is shown, not swallowed (D2)');
const REFUSED = { lock: OPEN, takes: httpError(400, 'the offer has expired'), takeRecord: httpError(404, 'not found') };
r = await run({ stage: 'sent' }, REFUSED);
ok('a first refusal is not final: the Worker may not see the lock yet', r.b.stage === 'sent' && r.b.refusedAt === NOW, r.b.stage);
r = await run({ stage: 'sent', refusedAt: NOW - 60 }, REFUSED);
ok('still refused a minute later: still retried', r.b.stage === 'sent', r.b.stage);
r = await run({ stage: 'sent', refusedAt: NOW - 121 }, REFUSED);
ok('refused for 2 minutes: the buy says so, with the reason', r.b.stage === 'unanswered' && /refused this purchase: the offer has expired/.test(r.b.problem || ''), r.b.problem);
ok('and when the GRAM can come back', /Get my GRAM back/.test(r.b.problem || ''));
ok('the buyer is alerted', r.notes.some(n => /not accepted/.test(n.title)));
r = await run({ stage: 'sent', refusedAt: NOW - 30 }, { lock: OPEN, takes: undefined });
ok('the Worker\u2019s TON read catching up: announced, and the refusal forgotten', r.b.stage === 'announced' && r.b.refusedAt === null, r.b.stage);
r = await run({ stage: 'sent' }, { lock: OPEN, takes: httpError(400, 'TON lock is uninit'), takeRecord: httpError(404, 'not found') });
ok('Pablo\u2019s case: "TON lock is uninit" right after paying is retried, not final', r.b.stage === 'sent', r.b.stage);
r = await run({ stage: 'sent' }, { lock: OPEN, takes: httpError(503, 'busy'), takeRecord: httpError(404, 'not found') });
ok('a Worker that is down is retried, not taken as a refusal', r.b.stage === 'sent' && !r.b.refusedAt, r.b.stage);
r = await run({ stage: 'sent' }, { lock: OPEN, takes: httpError(409, 'already announced'), takeRecord: { taker_terra: ME, lunc: '100000000' } });
ok('a take already announced for this buyer counts as announced', r.b.stage === 'announced', r.b.stage);
r = await run({ stage: 'sent', refusedAt: NOW - 200 }, { lock: OPEN, takes: httpError(409, 'already announced'), takeRecord: { taker_terra: 'terra1other', lunc: '100000000' } });
ok('a take recorded for someone else is, in the end, a refusal for this buyer', r.b.stage === 'unanswered', r.b.stage);

group('a buy called off by the phone clock is read once more (review of #21)');
r = await run({ stage: 'cancelled', validUntil: NOW - 600 }, { lock: OPEN });
ok('the payment landed after all (chain time behind the phone): back to "sent"', r.b.stage === 'sent', r.b.stage);
r = await run({ stage: 'cancelled', validUntil: NOW - 600 }, { lock: NONE });
ok('nothing landed: stays cancelled', r.b.stage === 'cancelled', r.b.stage);

group('the secret is read back before any GRAM is asked for');
// the Pay handler itself, lifted from gram.js; storage either keeps writes or
// refuses them like a private window or a full disk does
async function pay(storageWorks, serverTime){
  let saved = {}; const sent = [], msgs = [];
  const LOCK = { raw: ID, address: 'EQlock', value: '1', stateInit: '', payload: '', codeHash: 'AB' };
  const env = {
    buyTerms: () => ({ o: { id: 'o1', price: '1', maker_ton: 'EQmaker' }, lunc: 100000000n, gram: 1n, tip: 1n }),
    addrOf: () => ME, say: (_, m) => msgs.push(m), needTerms: async () => true,
    loadTonConnect: async () => ({ wallet: {}, sendTransaction: async t => { sent.push(t); } }),
    tonAccount: () => ({ chain: '-3', address: 'EQme' }),
    NET: { tonChain: '-3', tonCode: '', tonCodeHash: 'ab', name: 'testnet' },
    POLICY: { answer_window_sec: 60, min_ton_left_sec: 60, tip_address: 'EQtip', min_tip: '7' }, POLICY_ERR: '', setPolicy: x => x,
    api: async () => ({ live: true, price: '1', maker_ton: 'EQmaker', remaining_lunc: '1000000000', min_lunc: '1', expires: NOW + 99999, server_time: serverTime }),
    load: () => {}, human: x => String(x), now: () => NOW, sha256hex: async () => 'hash', takeRefOf: async () => 'ref',
    tonRaw: x => x, buildLock: async () => LOCK, toHex: u => Buffer.from(u).toString('hex'),
    buys: () => JSON.parse(JSON.stringify(saved)), buysOf: () => JSON.parse(JSON.stringify(saved)),
    saveBuyOf: (a, id, v) => { const b = JSON.parse(JSON.stringify(saved)); b[id] = Object.assign(b[id] || {}, v); if (storageWorks) saved = b; return b[id]; },
    tipOf: (g, p) => (p && p.min_tip ? BigInt(p.min_tip) : 1n),
    saveBuy: (id, v) => { const b = JSON.parse(JSON.stringify(saved)); b[id] = Object.assign(b[id] || {}, v); if (storageWorks) saved = b; return b[id]; },
    drawBuys: () => {}, watchBuys: () => {}, buzz: () => {}, BUYING: null,
    $: () => ({ hidden: false })
  };
  const names = Object.keys(env);
  const head = "$('#gx-bb-pay').addEventListener('click', ";
  const body = lift(src.slice(src.indexOf(head) + head.length), 'async function(){');
  const f = new Function(...names, 'return ' + body + ';')(...names.map(k => env[k]));
  await f.call({ disabled: false });
  return { sent, msgs, saved };
}
let p = await pay(false);
ok('storage refusing the write: nothing is sent to the TON wallet', p.sent.length === 0, p.sent.length);
ok('and the buyer is told why', p.msgs.some(m => /did not keep/.test(m)), p.msgs.join(' | '));
p = await pay(true);
ok('storage working: the payment is asked for as before', p.sent.length === 1, p.msgs.join(' | '));
ok('with the secret kept before it', p.saved[ID] && /^[0-9a-f]{64}$/.test(p.saved[ID].secret) && p.saved[ID].stage === 'sent');


// ---- R4-B1: the take is registered before paying, with the old flow as fallback ----
const b1At = src.indexOf("$('#gx-bb-pay').addEventListener('click'");
const b1 = src.slice(b1At, src.indexOf('/* ---------- my buys', b1At));
ok('R4-B1: the intent is signed and sent after the secret is kept and before the TON wallet opens',
  b1.indexOf("api('/intents'") > b1.indexOf('kept.secret !== toHex(secret)') && b1.indexOf("api('/intents'") < b1.indexOf('tc.sendTransaction('));
ok('R4-B1: only intents_full and rate_limited fall back to the old flow; any other 429 stops before paying',
  /if \(!\(e && \(e\.code === 'intents_full' \|\| e\.code === 'rate_limited'\)\)\) \{[^]*?saveBuy(?:Of\(me, |\()id, \{ stage: 'cancelled' \}\);[^]*?return;/.test(b1) &&
  !/e\.status === 429/.test(b1));
ok('R4-B1: any other refusal stops before any GRAM moves', /stage: 'cancelled'[^]*?Nothing was paid\.[^]*?return;/.test(b1));
ok('R4-B1: without intents on the Worker or a key to sign, the old flow', /if \(policy\.intent_ttl_sec && S\.MNEMONIC\)/.test(b1));
ok('R4-B1: the error code reaches the wallet', /if \(d\.code\) e\.code = String\(d\.code\)/.test(src));

ok('R4 (5): the self-claim sends nothing to the LCD before the consent (no feeFor with the secret)',
  /const fee = Math\.floor\(CLAIM_FEE_MAX \/ 1\.25\);/.test(src) && !/const fee = await feeFor\(\[step\]\);\n    await consent\('Claim your LUNC'/.test(src));


group('an unanswered buy is still read while its TON lock runs (audit C1)');
r = await run({ stage: 'unanswered' }, { lock: OPEN, takeRecord: { status: 'locked', terra_lock_id: '7', taker_terra: ME, lunc: '100000000' } });
ok('the seller answered late: the buy goes on to claiming', r.b.stage === 'claiming' && r.b.terraLockId === 7, r.b.stage);
r = await run({ stage: 'unanswered', terraLockId: 7 }, { lock: OPEN, takeRecord: { status: 'locked', terra_lock_id: '7', taker_terra: ME } });
ok('the Terra lock that already expired for this buy is not taken again', r.b.stage === 'unanswered', r.b.stage);
r = await run({ stage: 'unanswered', problem: 'refused' }, { lock: OPEN, takeRecord: { status: 'pending', taker_terra: ME } });
ok('a refused announcement promoted later goes back to announced', r.b.stage === 'announced' && !r.b.problem, r.b.stage);
r = await run({ stage: 'unanswered', timeout: NOW - 1 }, { lock: OPEN, takeRecord: { status: 'locked', terra_lock_id: '7', taker_terra: ME } });
ok('past the TON timeout it is not read: the refund is the way out', r.b.stage === 'unanswered', r.b.stage);
r = await run({ stage: 'unanswered', lookedAt: NOW - 30 }, { lock: OPEN, takeRecord: { status: 'locked', terra_lock_id: '7', taker_terra: ME } });
ok('read at most once a minute', r.b.stage === 'unanswered', r.b.stage);


group('a switched wallet, the fee, stage-only records (audit C8, C6)');
r = await run({ stage: 'paying', validUntil: NOW + 300 }, { lock: OPEN, switchTo: 'terra1other' });
ok('a round that sees the wallet switched still writes to the wallet that made the buy', r.savedBy.length && r.savedBy.every(a => a === ME), r.savedBy.join(','));
p = await pay(true);
ok('the fee comes from the rules loaded right before paying', p.saved[ID] && p.saved[ID].tip === '7', p.saved[ID] && p.saved[ID].tip);
{
  const store = {}, key = id => id;
  const saveBuyOf = new Function('localStorage', 'gkOf', lift(src, 'function buysOf(a){') + '\n' + lift(src, 'function saveBuyOf(a, id, v){') + '\nreturn saveBuyOf;')(
    { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } }, (kind, a) => kind + ':' + a);
  ok('a record holding only a stage is never created', saveBuyOf('terra1me', 'x', { stage: 'claiming' }) === null && !store['buys:terra1me']);
}


group('smaller items: odd TON answers, a withheld secret, the clock (audit C5, B10, C4)');
r = await run({ stage: 'paying', validUntil: NOW + 300 }, { lock: { state: 'active', status: 'unfunded' } });
ok('an unfunded answer is shown, not taken as a finished purchase', r.b.stage === 'paying' && /unfunded/.test(r.b.problem || ''), r.b.stage);
r = await run({ stage: 'claiming', terraLockId: 7, secret: 'ab' }, { lock: OPEN, lcd: { status: 'open', timeout: NOW + 3600 },
  relay: async () => ({ ok: true, json: async () => ({ withheld: true }) }) });
ok('a pair the relayer kept back is said on the buy', /kept the secret back/.test(r.b.problem || ''), r.b.problem);
p = await pay(true, NOW - 3600);
ok('a device clock an hour off stops the buy before paying', p.sent.length === 0 && p.msgs.some(m => /clock is 60 min off/.test(m)), p.msgs.join(' | '));
p = await pay(true, NOW - 30);
ok('a clock within 10 min pays as before', p.sent.length === 1, p.msgs.join(' | '));

report();
