/* Activity rows of the GRAM swap (activity.js gramSwapRow), lifted from the
   source as the other activity tests do, with localStorage as gram.js fills it. */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'activity.js'), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
const line = (s, h) => { const i = s.indexOf(h); return s.slice(i, s.indexOf('\n', i)); };
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null) };
const NETS = { mainnet: { htlc: 'terra1htlc' } };
const gramSwapRow = new Function('NETS', 'localStorage', [
  line(src, 'const HTLC = {};'), line(src, 'for (const k of Object.keys(NETS'),
  lift(src, 'function swapStore('), lift(src, 'function gramText('), lift(src, 'function gramSwapRow('),
  'return gramSwapRow;'].join('\n'))(NETS, localStorage);

const ME = 'terra1me';
const claim = { contract: 'terra1htlc', msg: { claim: { id: 2, secret: 'x' } } };
const lock = { contract: 'terra1htlc', msg: { lock: { hash: 'h' } } };
const IN = [{ key: 'native:uluna', raw: 129724853585 }];

group('a buy');
store['fw:gram:buys:mainnet:' + ME] = JSON.stringify({ EQton: { terraLockId: 2, gram: '5000000001', lunc: '129724853585' } });
let r = gramSwapRow({ txhash: 'C' }, claim, 'claim', IN, ME);
ok('the relayer’s claim reads as "Bought LUNC" under Swaps', r && r.title === 'Bought LUNC' && r.group === 'swaps' && r.kind === 'in', JSON.stringify(r));
ok('with the GRAM it cost', r.below === 'for 5.000000001 GRAM', r.below);
ok('another buyer’s lock id gives no GRAM line', gramSwapRow({ txhash: 'C' }, { contract: 'terra1htlc', msg: { claim: { id: 9 } } }, 'claim', IN, ME).below === '');

group('a sale');
store['fw:gram:locks:mainnet:' + ME] = JSON.stringify({ EQton2: { tx: 'L', gram: '5000000000', lunc: '1' } });
r = gramSwapRow({ txhash: 'L' }, lock, 'lock', [], ME);
ok('a lock not yet paid', r.title === 'Locked for a GRAM sale' && r.below === 'for 5 GRAM', JSON.stringify(r));
store['fw:gram:final:mainnet:' + ME] = JSON.stringify({ EQton2: 'claimed' });
r = gramSwapRow({ txhash: 'L' }, lock, 'lock', [], ME);
ok('once the buyer claimed: "Sold LUNC" +GRAM', r.title === 'Sold LUNC' && r.below === '+5 GRAM', JSON.stringify(r));
ok('a refund', gramSwapRow({ txhash: 'R' }, { contract: 'terra1htlc', msg: { refund: { id: 1 } } }, 'refund', IN, ME).title === 'LUNC returned');
ok('any other contract is left alone', gramSwapRow({ txhash: 'X' }, { contract: 'terra1other', msg: { claim: {} } }, 'claim', IN, ME) === null);

group('the swap refreshes Activity when it ends');
const gram = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
ok('buy done, sale paid and refund each announce a transaction', (gram.match(/dispatchEvent\(new CustomEvent\('frontier:tx'/g) || []).length >= 3);
report();
