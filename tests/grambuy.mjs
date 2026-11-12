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

async function run(buy, { lock, takes, takeRecord, clock = NOW }){
  const store = { [ID]: Object.assign({ offerId: 'o1', lunc: '100000000', gram: '1', timeout: NOW + 30 * 3600, created: NOW - 60 }, buy) };
  const notes = [];
  const env = {
    WATCHING_BUYS: false, document: { hidden: false }, REFUSAL_FINAL_SEC: 120,
    buys: () => store, saveBuy: (id, v) => { store[id] = Object.assign({}, store[id], v); },
    readLock: async () => lock, now: () => clock, addrOf: () => ME,
    api: async (p) => {
      if (p === '/takes') { if (takes instanceof Error) throw takes; return {}; }   // takes undefined = accepted
      if (takeRecord instanceof Error) throw takeRecord;
      return takeRecord;
    },
    notify: n => notes.push(n), drawBuys: () => {}, sellerLockOk: async () => [], chime: () => {}, buzz: () => {}, load: () => {},
    getJSON: async () => ({}), relayerUrl: () => '', human: x => String(x),
    NET: { tonApi: '', tonCodeHash: '', lcd: '', htlc: '' }, btoa: x => x, fetch: async () => ({ ok: true })
  };
  const names = Object.keys(env);
  const f = new Function(...names, lift(src, 'async function watchBuys(){') + '\nreturn watchBuys;')(...names.map(k => env[k]));
  await f();
  return { b: store[ID], notes };
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
async function pay(storageWorks){
  let saved = {}; const sent = [], msgs = [];
  const LOCK = { raw: ID, address: 'EQlock', value: '1', stateInit: '', payload: '', codeHash: 'AB' };
  const env = {
    buyTerms: () => ({ o: { id: 'o1', price: '1', maker_ton: 'EQmaker' }, lunc: 100000000n, gram: 1n, tip: 1n }),
    addrOf: () => ME, say: (_, m) => msgs.push(m), needTerms: async () => true,
    loadTonConnect: async () => ({ wallet: {}, sendTransaction: async t => { sent.push(t); } }),
    tonAccount: () => ({ chain: '-3', address: 'EQme' }),
    NET: { tonChain: '-3', tonCode: '', tonCodeHash: 'ab', name: 'testnet' },
    POLICY: { answer_window_sec: 60, min_ton_left_sec: 60, tip_address: 'EQtip' }, POLICY_ERR: '', setPolicy: x => x,
    api: async () => ({ live: true, price: '1', maker_ton: 'EQmaker', remaining_lunc: '1000000000', min_lunc: '1', expires: NOW + 99999 }),
    load: () => {}, human: x => String(x), now: () => NOW, sha256hex: async () => 'hash', takeRefOf: async () => 'ref',
    tonRaw: x => x, buildLock: async () => LOCK, toHex: u => Buffer.from(u).toString('hex'),
    buys: () => JSON.parse(JSON.stringify(saved)),
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
  /if \(!\(e && \(e\.code === 'intents_full' \|\| e\.code === 'rate_limited'\)\)\) \{[^]*?saveBuy\(id, \{ stage: 'cancelled' \}\);[^]*?return;/.test(b1) &&
  !/e\.status === 429/.test(b1));
ok('R4-B1: any other refusal stops before any GRAM moves', /stage: 'cancelled'[^]*?Nothing was paid\.[^]*?return;/.test(b1));
ok('R4-B1: without intents on the Worker or a key to sign, the old flow', /if \(policy\.intent_ttl_sec && S\.MNEMONIC\)/.test(b1));
ok('R4-B1: the error code reaches the wallet', /if \(d\.code\) e\.code = String\(d\.code\)/.test(src));

ok('R4 (5): the self-claim sends nothing to the LCD before the consent (no feeFor with the secret)',
  /const fee = CLAIM_FEE_MAX;/.test(src) && !/const fee = await feeFor\(\[step\]\);\n    await consent\('Claim your LUNC'/.test(src));

report();
