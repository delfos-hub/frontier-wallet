/* Pricing by identity, against the shipped tokens.js and swap.js.

   A row's dollar price must come from what the row is - an exact contract
   address, an exact IBC denom, or one of the two native denoms the feed is
   about - never from its symbol, which anyone can copy. unitOf and fiatOf are
   lifted out of the shipped tokens.js (it touches the page when it loads),
   with the real KNOWN_CW20 / KNOWN_IBC maps from chain.js.

       node tests/pricing.mjs
*/
import fs from 'fs';
import path from 'path';

const chain = fs.readFileSync(path.resolve('assets/js/chain.js'), 'utf8');
const tokens = fs.readFileSync(path.resolve('assets/js/tokens.js'), 'utf8');
const swap = fs.readFileSync(path.resolve('assets/js/swap.js'), 'utf8');
const lift = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

const maps = lift(chain, 'const KNOWN_CW20', 'export {').replace(/export[\s\S]*/, '');
const fns = lift(tokens, 'const FEED', '// What a row is worth') + lift(tokens, 'function fiatOf(t){', '\n}\n') + '\n}\n';
const LUNC = new Function('return ' + swap.match(/const LUNC = (\{[^}]*\});/)[1])();
// the one call site in swap.js that prices LUNC itself
const swapCall = swap.match(/const lunc = (fiatOf\([^;]*\));/)[1];

let LAST = { px: { LUNC: 0.00005, USTC: 0.006 } };
const env = new Function('LAST', 'LUNC', maps + '\n' + fns + '\nreturn { unitOf, fiatOf, KNOWN_CW20, KNOWN_IBC, swapLunc: () => ' + swapCall + ' };');
const P = env(LAST, LUNC);

const USDT = 'terra1z0xe7t5ymmltg4vju8tghkq0pewy4et548ta23nlu9zxtl950uyqkv8mv4';
const USDCINJ = 'ibc/F52112392095A6D6D1B17EF1FE19BE0B39B2A79B8A2B2F55CD721FC7DBF5081F';
let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + got + ', want ' + want); }
};

console.log('pricing by identity');
check('real USDT (exact contract) is $1', P.fiatOf({ sym: 'USDT', contract: USDT, v: 5 }), 5);
check('fake CW20 named USDT has no price', P.fiatOf({ sym: 'USDT', contract: 'terra1fakefakefake', v: 5 }), null);
check('fake CW20 named LUNC has no price', P.fiatOf({ sym: 'LUNC', contract: 'terra1fakefakefake', v: 5 }), null);
check('fake CW20 named USDC.inj has no price', P.fiatOf({ sym: 'USDC.inj', contract: 'terra1fakefakefake', v: 5 }), null);
check('USDC.inj by its full denom is $1', P.fiatOf({ sym: 'USDC.inj', denom: USDCINJ, v: 2 }), 2);
check('native LUNC takes the feed', P.fiatOf({ sym: 'LUNC', denom: 'uluna', v: 1000 }), 1000 * 0.00005);
check('native USTC takes the feed', P.fiatOf({ sym: 'USTC', denom: 'uusd', v: 10 }), 10 * 0.006);
check('a row without usd (old snapshot) still priced by address', P.unitOf({ sym: 'USDT', contract: USDT }, LAST.px), 1);
check('a pool-priced CW20 still uses its pool', P.fiatOf({ sym: 'GRDX', contract: 'terra1grdx', v: 100, pool: { inLunc: 2 } }), 100 * 2 * 0.00005);
check('swap.js learnPrice gets the LUNC price', P.swapLunc(), 0.00005);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
