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
const { GRAM_NET: NET, NETS } = await import(pathToFileURL(path.join(SRC, 'gram-net.js')).href);
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
ok('not selectable until filled at deploy', NETS.mainnet.ready === false && (() => { try { new Function('NET', 'tonRaw', lift(src, 'function pinPolicy(p){') + '\nreturn pinPolicy;')(NETS.mainnet, tonRaw)(WORKER); return false; } catch (e) { return /not open/.test(e.message); } })());
ok('min TON time left = answer window + 5 h + 24 h + 10 min', m.min_ton_left_sec === m.answer_window_sec + m.min_terra_left_sec + m.terra_gap_sec + 600);
ok('the agreed numbers: 30 min, 6 h, 0.3%, 0.05 GRAM', m.answer_window_sec === 1800 && m.t_terra_sec === 21600 && m.fee_bps === 30 && m.min_tip === '50000000');
ok('the same audited lock code as testnet', NETS.mainnet.tonCodeHash === NET.tonCodeHash && NETS.mainnet.tonCode === NET.tonCode);

report();
