/* The swap rules a wallet trades under (audit round 3, B3).

   The offers Worker publishes its rules in /offers, but the wallet only
   accepts rules equal to the ones pinned for the network in gram-net.js, and
   uses the pinned values. A compromised Worker could otherwise send the fees
   elsewhere or shorten the time each side has. pinPolicy() is lifted from the
   shipped gram.js by brace matching, as tests/envelopes.mjs does with swap.js. */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const { GRAM_NET, NETS } = await import(pathToFileURL(path.join(SRC, 'gram-net.js')).href);
// the testnet entry, which the rules below were written against
const NET = NETS.testnet;
const { rawOf: tonRaw } = await import(pathToFileURL(path.join(SRC, 'gram-ton.js')).href);
const src = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found in gram.js: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
const pinPolicy = new Function('NET', 'tonRaw', lift(src, 'function pinPolicy(p){') + '\nreturn pinPolicy;')(NET, tonRaw);

// what the testnet Worker publishes today (GET /offers, 26 Oct 2026)
const WORKER = { min_deal: null, max_deal: null, max_open_takes_per_taker: 3, tip_address: 'kQDv5WLiT79cdIQjT9KE1BWeyomLMz7H8iRnW5_ef7LkgU7j', min_tip: '5000000', fee_bps: 0,
  ton_code_hash: '39D4C6CCA7AEC5DBEA9FD5BBC5B28CD0BADB04B8E99822FC241075B9FC58172C', min_ton_left_sec: 3300,
  terra_gap_sec: 900, t_terra_sec: 1200, min_terra_left_sec: 900, answer_window_sec: 900, tax_bps: 50 };
const refused = (over, why) => {
  try { pinPolicy(Object.assign({}, WORKER, over)); return false; } catch (e) { return why ? e.message.includes(why) : true; }
};

group('swap rules from the offers Worker');
const p = pinPolicy(WORKER);
ok('the Worker\u2019s current rules are accepted', p && p.tax_bps === 50 && p.answer_window_sec === 900);
ok('the fee address may be written in another TON format', !!pinPolicy(Object.assign({}, WORKER, { tip_address: '0:' + tonRaw(WORKER.tip_address).slice(2) })));
ok('another fee address is refused', refused({ tip_address: '0:' + '11'.repeat(32) }, 'fee address'));
ok('a garbage fee address is refused', refused({ tip_address: '<script>' }, 'fee address'));
ok('a different fee rate is refused', refused({ fee_bps: 5000 }, 'fee_bps'));
ok('a different minimum fee is refused', refused({ min_tip: '900000000' }, 'min_tip'));
ok('a shorter gap between the locks is refused', refused({ terra_gap_sec: 60 }, 'terra_gap_sec'));
ok('a shorter answer window is refused', refused({ answer_window_sec: 60 }, 'answer_window_sec'));
ok('less TON time left is refused', refused({ min_ton_left_sec: 600 }, 'min_ton_left_sec'));
ok('another lock code is refused', refused({ ton_code_hash: 'AB'.repeat(32) }, 'lock code'));
ok('a burn tax above the ceiling is refused', refused({ tax_bps: 5000 }, 'burn tax'));
ok('a negative or broken burn tax is refused', refused({ tax_bps: -1 }) && refused({ tax_bps: 'x' }));
ok('a burn tax below the floor is refused (a Worker saying 0)', refused({ tax_bps: 0 }, 'burn tax') && refused({ tax_bps: 30 }, 'burn tax'));
ok('a burn tax change within the range is followed', pinPolicy(Object.assign({}, WORKER, { tax_bps: 80 })).tax_bps === 80);
ok('no rules at all is refused', (() => { try { pinPolicy(null); return false; } catch (e) { return true; } })());
const odd = pinPolicy(Object.assign({}, WORKER, { extra: 1 }));
ok('the pinned values are the ones used', odd.tip_address === NET.policy.tip_address && odd.min_tip === NET.policy.min_tip && !('extra' in odd));

ok('different deal limits are refused', refused({ min_deal: '1' }, 'min_deal') && refused({ max_deal: '1' }, 'max_deal'));
ok('a different per-buyer limit is refused', refused({ max_open_takes_per_taker: 10 }, 'max_open_takes_per_taker'));
ok('a Worker without deal limits matches a network without them', !!pinPolicy(Object.assign({}, WORKER, { min_deal: undefined, max_deal: undefined })));

group('deal limits in the forms');
const helpers = new Function('NET', 'POLICY', 'human',
  lift(src, 'function dealLimits(){') + lift(src, 'function dealErr(gram){') + '\nreturn { dealLimits, dealErr };');
const human9 = (raw, dec) => (Number(raw) / 10 ** dec).toString();
const main = helpers(NETS.mainnet, null, human9);
ok('mainnet: 5 GRAM minimum, 500 GRAM maximum', main.dealLimits().min === 5000000000n && main.dealLimits().max === 500000000000n);
ok('a 4.99 GRAM deal is refused, 5 is fine', /at least 5 GRAM/.test(main.dealErr(4990000000n)) && main.dealErr(5000000000n) === '');
ok('a 500.01 GRAM deal is refused', /at most 500 GRAM/.test(main.dealErr(500010000000n)));
ok('testnet: no limits', helpers(NET, null, human9).dealErr(1n) === '');
const waiting = stages => new Function('NET', 'POLICY', 'buys',
  lift(src, 'function waitingBuys(){') + lift(src, 'function openErr(){') + '\nreturn openErr;')(NET, null, () => Object.fromEntries(stages.map((st, i) => [i, { stage: st }])));
ok('3 buys waiting for an answer: a 4th is not paid', /3 buys waiting/.test(waiting(['announced', 'sent', 'paying'])()));
ok('2 waiting (others finished or called off): a 3rd can be paid', waiting(['announced', 'sent', 'claiming', 'done', 'cancelled'])() === '');

group('the mainnet entry');
const m = NETS.mainnet.policy;
// what the mainnet Worker publishes (GET /policy, 4 Nov 2026)
const WORKER_MAIN = { tip_address: 'EQCJoQe2ZL8tMvcT4LUNzVYana45p1kFDr8upKfiN5qWyJjX', min_tip: '50000000', fee_bps: 30,
  ton_code_hash: '39D4C6CCA7AEC5DBEA9FD5BBC5B28CD0BADB04B8E99822FC241075B9FC58172C', min_ton_left_sec: 106800,
  terra_gap_sec: 86400, t_terra_sec: 21600, min_terra_left_sec: 18000, answer_window_sec: 1800, tax_bps: 150,
  min_deal: '5000000000', max_deal: '500000000000', max_open_takes_per_taker: 3 };
const pinMain = new Function('NET', 'tonRaw', lift(src, 'function pinPolicy(p){') + '\nreturn pinPolicy;')(NETS.mainnet, tonRaw);
ok('open, every deploy value filled', NETS.mainnet.ready === true && !/REPLACE_/.test(JSON.stringify(NETS.mainnet)));
ok('the swap runs on mainnet', GRAM_NET === NETS.mainnet);
ok('the mainnet Worker\u2019s rules are accepted as published', (() => { try { const r = pinMain(WORKER_MAIN); return r.tax_bps === 150 && r.fee_bps === 30; } catch (e) { return false; } })());
ok('the mainnet Worker on another fee address is refused', (() => { try { pinMain(Object.assign({}, WORKER_MAIN, { tip_address: WORKER.tip_address })); return false; } catch (e) { return /fee address/.test(e.message); } })());
ok('no Mini App return on mainnet (the swap runs on the web)', !NETS.mainnet.twaReturnUrl);
ok('the mainnet swap is offered on Frontier Web only, never on the Mini App\u2019s address', Array.isArray(NETS.mainnet.origins) &&
  NETS.mainnet.origins.indexOf('https://wallet.delfos-hub.net') >= 0 && NETS.mainnet.origins.every(o => o.indexOf('github.io') < 0) &&
  /NET\.origins\.indexOf\(location\.origin\)/.test(src));
ok('consents name the network in use, never a fixed "TON testnet" (R4-C1)', !/TON testnet'/.test(src));
ok('a second node for the seller\u2019s lock on mainnet (R4-B3)', !!NETS.mainnet.lcd2 && NETS.mainnet.lcd2 !== NETS.mainnet.lcd && /NET\.lcd2/.test(lift(src, 'async function sellerLockOk(b, take){')));
ok('every GRAM Terra signing shows its fee in the consent first (R4-D1)', (src.match(/await feeFor\(\[step\]\)/g) || []).length === 3 && !/NO_FEE_REVIEW/.test(src));
ok('a paused book keeps its rules, flagged paused, so swaps under way go on (R4-E1, review of 1379f8a)', (() => { try { const r = pinMain(Object.assign({}, WORKER_MAIN, { paused: 'tax changed' })); return r.paused === 'tax changed' && r.tax_bps === 150; } catch (e) { return false; } })());
ok('a refusal on a cached pause reads the book again, so it ends without a reload (R4-F1)',
  /POLICY\.paused\) \{ say\('#gx-msg', PAUSED_MSG, true\); load\(\); return; \}/.test(src) &&
  /policy\.paused\) \{ say\('#gx-bb-msg', PAUSED_MSG, true\); load\(\); return; \}/.test(src));
ok('publishing and paying stop while paused (R4-E1)', /if \(POLICY && POLICY\.paused\) \{ say\('#gx-msg', PAUSED_MSG/.test(src) && /if \(policy\.paused\) \{ say\('#gx-bb-msg', PAUSED_MSG/.test(src));
ok('the pay step refuses a paused offer (R4-E1)', /if \(fresh\.paused\)/.test(src));
ok('the seller\u2019s lock and the buyer\u2019s check use the higher of published and chain tax (R4-E2)', (src.match(/taxBps = await taxBpsFor\(p\)/g) || []).length === 2 && /Math\.max\(Number\(p\.tax_bps\)/.test(src));
ok('a chain rate above max_tax_bps is never used (review of 1379f8a)', /chain > max\) \{\s*throw/.test(lift(src, 'async function taxBpsFor(p){')));
ok('self-claim reads the lock again before signing (R4-B2)', /terraLockRead\(b\.terraLockId\)/.test(lift(src, 'async function selfClaim(id){')));
ok('min TON time left = answer window + 5 h + 24 h + 10 min', m.min_ton_left_sec === m.answer_window_sec + m.min_terra_left_sec + m.terra_gap_sec + 600);
ok('the agreed numbers: 30 min, 6 h, 0.3%, 0.05 GRAM', m.answer_window_sec === 1800 && m.t_terra_sec === 21600 && m.fee_bps === 30 && m.min_tip === '50000000');
ok('the same audited lock code as testnet', NETS.mainnet.tonCodeHash === NET.tonCodeHash && NETS.mainnet.tonCode === NET.tonCode);

ok('R4-C2: the seller is told the answer window before publishing, and how to hear of a take',
  /function dutyPaint\(\)/.test(src) && /answer_window_sec/.test(src.slice(src.indexOf('function dutyPaint'))) &&
  /open Frontier at least once a day while your offer is live/.test(src) && /dutyPaint\(\);\n\}/.test(src));

report();
