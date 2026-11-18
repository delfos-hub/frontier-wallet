/* The seller's check of a buyer's TON lock before locking any LUNC (audit
   round 3, B1).

   The lock is compared with the offer this wallet signed and kept on the
   device, never with the offers Worker's copy of it: a lying Worker could
   otherwise get the seller to lock LUNC against a lock that pays someone
   else, or too little. checkTake() is lifted from the shipped gram.js and run
   against stubs for the chain reads. */
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
const ME = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const MY_TON = '0:' + 'aa'.repeat(32), OTHER_TON = '0:' + 'bb'.repeat(32), LOCK = '0:' + 'cc'.repeat(32);
const NOW = 1_800_000_000;
const OFFER = { type: 'htlc-offer', v: 1, network: 'testnet', maker: ME, maker_ton: MY_TON,
  min_lunc: '100000000', max_lunc: '1000000000', total_lunc: '1000000000', price: '33000000000', expires: NOW + 3600 };
const gramFor = (l, p) => (l * p + 1000000000000n - 1n) / 1000000000000n;
let CLOCK = '';

function make({ signed = OFFER, lock = {}, mine = {} } = {}){
  const env = {
    POLICY: { tax_bps: 50, min_terra_left_sec: 900, t_terra_sec: 1200, terra_gap_sec: 900, min_ton_left_sec: 3300, report_slack_sec: 300 },
    // the chain's clock agrees unless a case says otherwise (audit E3)
    clockProblem: async () => CLOCK, answerFloor: p => NOW + p.min_terra_left_sec - 200, ANNOUNCE_SEC: 2100,
    NET: { name: 'testnet', tonApi: '', tonCodeHash: '', tonCode: '' },
    signedOffer: () => signed, addrOf: () => ME, now: () => NOW,
    tonRaw: a => a, takeRefOf: async () => 'ref', gramFor: gramFor,
    ceilDiv: (a, b) => (a + b - 1n) / b,
    // the published rate (R4-E2 takes the higher of it and the chain's)
    taxBpsFor: async p => Number(p.tax_bps),
    terraTimeout: () => NOW + 1200,
    readLock: async () => Object.assign({ state: 'active', status: 'open', hash: 'h', recipient: MY_TON, takerRef: 'ref',
      amount: gramFor(500000000n, 33000000000n), tip: 5000000n, balance: 10n ** 12n, timeout: NOW + 30 * 3600 }, lock),
    buildLock: async () => ({ raw: LOCK }),
    api: async () => { throw new Error('the Worker must not be asked for the offer'); },
    setPolicy: () => null, mineAll: () => mine
  };
  const names = Object.keys(env);
  const f = new Function(...names, lift(src, 'function heldAt(t, n){') + '\n' + lift(src, 'async function checkTake(t){') + '\nreturn checkTake;')(...names.map(k => env[k]));
  return t => f(Object.assign({ offer_id: 'o1', ton_lock: LOCK, hash: 'h', taker_terra: 'terra1x', lunc: '500000000' }, t));
}

group('the seller checks a take against the offer it signed');
let r = await make()({});
ok('a lock that matches the signed offer passes', r.problems.length === 0, r.problems.join('; '));
r = await make({ lock: { recipient: OTHER_TON } })({});
ok('a lock paying another TON address is refused, whatever the Worker says', r.problems.some(p => /does not pay your TON address/.test(p)));
r = await make({ lock: { amount: 1000n } })({});
ok('a lock holding less than the signed price is refused', r.problems.some(p => /too little GRAM/.test(p)));
r = await make({ signed: null })({});
ok('an offer not signed on this device is not answered', r.problems.some(p => /not signed on this device/.test(p)));
r = await make({ signed: Object.assign({}, OFFER, { maker: 'terra1someoneelse' }) })({});
ok('an offer signed for another address is not answered', r.problems.some(p => /not signed on this device/.test(p)));
r = await make()({ lunc: '5000000000' });
ok('a take above the signed maximum is refused', r.problems.some(p => /outside the amounts/.test(p)));
r = await make()({ lunc: '1000' });
ok('a take below the signed minimum is refused', r.problems.some(p => /outside the amounts/.test(p)));


group('the offer as signed: its end and its total (audit round 5, D11)');
r = await make({ signed: Object.assign({}, OFFER, { expires: NOW - 1 }) })({});
ok('an ended offer is not answered', r.problems.some(p => /has ended/.test(p)));
r = await make({ mine: { '0:other': { id: 3, offer_id: 'o1', lunc: '800000000' } } })({});
ok('a take past the offer\u2019s total, counting my own locks, is not answered', r.problems.some(p => /more than your offer/.test(p)));

group('the GRAM claim follows this device\u2019s own locks (audit round 5, D1, D2, D4, D5)');
function deals(mine, takes, fin = {}){
  const env = { finals: () => fin, mineAll: () => mine };
  const names = Object.keys(env);
  return new Function(...names, lift(src, 'function ownDeals(takes){') + '\nreturn ownDeals;')(...names.map(k => env[k]))(takes);
}
let d = deals({ [LOCK]: { id: 9, lunc: '500000000', gram: '17' } }, []);
ok('a lock of mine the Worker does not list is followed, with my lock id', d.length === 1 && d[0].terra_lock_id === 9 && d[0].ton_lock === LOCK);
d = deals({ [LOCK]: { id: 9 } }, [{ ton_lock: LOCK, status: 'locked', terra_lock_id: 4, lunc: '1', gram: '1' }]);
ok('my own lock id wins over the Worker\u2019s', d.length === 1 && d[0].terra_lock_id === 9);
d = deals({ [LOCK]: { id: 9 } }, [{ ton_lock: LOCK, status: 'unanswered', lunc: '1', gram: '1' }]);
ok('an answer the Worker refused is still followed', d.length === 1 && d[0].terra_lock_id === 9);

async function finish({ terra, ton, clock = NOW }){
  const sent = [], finalsSet = {}, notes = [];
  const env = {
    CHECKING: false, OPEN_SEEN: new Set(), RELEASE: {}, REFUND_DUE: {}, LOST_SEEN: {}, DRAWN: [],
    mineFor: () => ({ watched: true }), watchDeal: async () => {}, terraLockRead: async () => terra,
    readLock: async () => ton, NET: { tonApi: '', tonCodeHash: '' }, now: () => clock, human: x => String(x),
    setFinal: (k, v) => { finalsSet[k] = v; }, notify: n => notes.push(n), sendGramClaim: async (t, s) => sent.push(s), drawTakes: () => {}
  };
  const names = Object.keys(env);
  const f = new Function(...names, lift(src, 'async function checkFinished(list){') + '\nreturn [checkFinished, () => REFUND_DUE];')(...names.map(k => env[k]));
  await f[0]([{ ton_lock: LOCK, terra_lock_id: 9, lunc: '1', gram: '1', own: true }]);
  return { sent, finalsSet, due: f[1]() };
}
let f = await finish({ terra: { status: 'claimed', secret: 'ab' }, ton: { status: 'open', timeout: NOW + 3600 } });
ok('the buyer claimed on Terra: the GRAM is claimed with the secret, whatever the Worker said', f.sent[0] === 'ab');
f = await finish({ terra: { status: 'claimed', secret: 'ab' }, ton: { status: 'uninitialized' } });
ok('an odd TON answer does not end the claim as lost', !f.finalsSet[LOCK]);
f = await finish({ terra: { status: 'open', timeout: NOW - 1 }, ton: {} });
ok('a lock of mine open past its timeout gets a Refund', f.due[LOCK] === 9);


group('a take from an intent: the offer\u2019s end against when it was registered');
const ENDED = Object.assign({}, OFFER, { expires: NOW - 60 });
r = await make({ signed: ENDED })({ created: NOW - 30, held_since: NOW - 600 });
ok('registered before the offer ended: answered', !r.problems.some(p => /has ended/.test(p)), r.problems.join('; '));
r = await make({ signed: ENDED })({ created: NOW - 30, held_since: NOW - 30 * 86400 });
ok('a held_since far before the take is not believed', r.problems.some(p => /has ended/.test(p)));
r = await make({ signed: ENDED })({ created: NOW - 30 });
ok('no held_since, a lock paid long ago: checked against now, as before', r.problems.some(p => /has ended/.test(p)));
// paid 10 min ago, the offer ended a minute ago: the lock's timeout says when (audit E4)
const PAID = NOW - 600, PAID_LOCK = { timeout: PAID + 3300 + 2100 };
r = await make({ signed: ENDED, lock: PAID_LOCK })({ created: NOW - 30 });
ok('no held_since: held to the offer as it was when the TON lock was paid', !r.problems.some(p => /has ended/.test(p)), r.problems.join('; '));
r = await make({ signed: Object.assign({}, OFFER, { expires: PAID - 60 }), lock: PAID_LOCK })({ created: NOW - 30 });
ok('an offer that had ended before the payment is still refused', r.problems.some(p => /has ended/.test(p)));


group('the seller\u2019s clock (audit E3)');
CLOCK = 'this device\u2019s clock is 60 min off the chain\u2019s time; set it to automatic and try again';
r = await make()({});
ok('a clock off the chain\u2019s stops the answer before anything is locked', r.problems.some(p => /clock is 60 min off/.test(p)), r.problems.join('; '));
CLOCK = '';


group('review of the part D fixes: the chain\u2019s time, a lock on its way');
async function finishTwice({ terra, ton, clock = NOW }){
  const sent = [], finalsSet = {};
  const env = {
    CHECKING: false, OPEN_SEEN: new Set(), RELEASE: {}, REFUND_DUE: {}, LOST_SEEN: {}, DRAWN: [],
    mineFor: () => ({ watched: true }), watchDeal: async () => {}, terraLockRead: async () => terra,
    readLock: async () => ton, NET: { tonApi: '', tonCodeHash: '' }, now: () => clock, human: x => String(x),
    setFinal: (k, v) => { finalsSet[k] = v; }, notify: () => {}, sendGramClaim: async (t, s) => sent.push(s), drawTakes: () => {}
  };
  const names = Object.keys(env);
  const f = new Function(...names, lift(src, 'async function checkFinished(list){') + '\nreturn checkFinished;')(...names.map(k => env[k]));
  const deal = [{ ton_lock: LOCK, terra_lock_id: 9, lunc: '1', gram: '1', own: true }];
  await f(deal); await f(deal);
  return { sent, finalsSet };
}
let g = await finishTwice({ terra: { status: 'claimed', secret: 'ab' }, ton: { status: 'open', timeout: NOW - 60, chainTime: NOW - 600 } });
ok('a device clock ahead of the chain does not end the claim: the chain says open, the GRAM is claimed', !g.finalsSet[LOCK] && g.sent[0] === 'ab');
g = await finishTwice({ terra: { status: 'claimed', secret: 'ab' }, ton: { status: 'open', timeout: NOW - 60 } });
ok('no chain time: never "lost" on the device clock alone', !g.finalsSet[LOCK]);
g = await finishTwice({ terra: { status: 'claimed', secret: 'ab' }, ton: { status: 'open', timeout: NOW - 60, chainTime: NOW } });
ok('the chain past the timeout on two reads: lost', g.finalsSet[LOCK] === 'lost');
ok('a lock on its way stays in view, and its id is looked up', /\(mineFor\(t\.ton_lock\)\.tx && !mineFor\(t\.ton_lock\)\.id\)/.test(src) && /resolveIds\(\)\.then/.test(src));

report();
