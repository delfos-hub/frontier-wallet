/* What is signed is what is shown (swap and send).

   - A pool is used only for the two tokens it actually holds, read from the
     pool itself, not from the market feed; before signing, from two nodes.
   - A token's decimals come from its own contract before the feed, and 0 is
     a real answer (a token with no fractions is not sent x1e6).
   - A swap plan belongs to the quote it was built from; a send review to the
     form it was asked for, and it names the recipient.
   - TerraSwap's price guard is taken on the return before its commission, so
     the floor it enforces is the floor shown.
   Run: node tests/signing.mjs */
import fs from 'fs';
import path from 'path';
import { loadMarket, ok, group, report } from './harness.mjs';
import { A, META, POOLS, makeChain } from './fixture.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const swap = read('swap.js'), tx = read('tx.js');
function lift(src, header){
  const i = src.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d += 1;
    else if (src[k] === '}') { d -= 1; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
const liftLine = (src, header) => { const i = src.indexOf(header); return src.slice(i, src.indexOf(';\n', i) + 1); };

// a pool made with a known pair code, holding LUNC and a junk token, that a
// wrong feed row calls LUNC/USTC
const JUNK = 'cw20:terra1junk';
META[JUNK] = { sym: 'JUNK', dec: 6 };
POOLS.P_EVIL = { a: JUNK, ra: '1000000000000000', b: A.LUNC, rb: '1000000000000', dex: 'ts' };
const chain = makeChain();
const realGet = chain.getJSON;
chain.getJSON = async (url, ...r) => {
  const d = await realGet(url, ...r);
  if (String(url).indexOf('orbitwire') >= 0) {
    d.pairs.push({ pool: 'P_EVIL', dex: 'FeedSwap', liquidity: 999999999,
      base: { type: 'NATIVE', address: 'uluna', symbol: 'LUNC', decimals: 6 },
      quote: { type: 'NATIVE', address: 'uusd', symbol: 'USTC', decimals: 6 } });
    // and a feed row that says 6 for a contract that says 18
    for (const p of d.pairs) for (const s of [p.base, p.quote]) if (s && s.address === 'terra1ustr') s.decimals = 6;
  }
  return d;
};
const { mod } = await loadMarket({ chain });
await mod.owMarket(); await mod.graph();

group('a pool is used only for what it holds');
{
  ok('the wrong feed row does offer the pool for LUNC -> USTC', mod.poolsBetween(A.LUNC, A.USTC).some(p => p.pair === 'P_EVIL'));
  let err = null;
  try { await mod.simulateSwap('P_EVIL', A.LUNC, '1000000', 'ts', A.USTC); } catch (e) { err = e; }
  ok('quoting it as LUNC -> USTC is refused', err && /does not hold the pair/.test(err.message), err && err.message);
  const good = await mod.simulateSwap('P_USTC_LUNC', A.LUNC, '1000000', 'ts', A.USTC).catch(e => e);
  ok('a real LUNC/USTC pool quotes (either order of its sides)', good && Number(good.return_amount) > 0, good && good.message);
  const gd = await mod.simulateSwap('P_CL8Y_USTC', A.USTC, '1000000', 'gd', A.CL8Y).catch(e => e);
  ok('a Garuda pool, read through pool{}, quotes', gd && Number(gd.return_amount) > 0, gd && gd.message);
  ok('before signing, both nodes are asked', await mod.poolHolds('P_USTC_LUNC', A.LUNC, A.USTC, true).then(() => true, () => false));
  chain.second.holds.P_JURIS_LUNC = [JUNK, A.LUNC];
  const two = await mod.poolHolds('P_JURIS_LUNC', A.JURIS, A.LUNC, true).then(() => null, e => e);
  ok('a second node that disagrees stops the signature', two && /disagree/.test(two.message), two && two.message);
  delete chain.second.holds.P_JURIS_LUNC;
  chain.second.down = true;
  const down = await mod.poolHolds('P_JURIS_LUNC', A.JURIS, A.LUNC, true).then(() => null, e => e);
  ok('and one that does not answer stops it too', down && /second LCD/.test(down.message), down && down.message);
  chain.second.down = false;
  ok('every quote asks for both sides (direct, and each leg of a hop)',
     (swap.match(/await bestPool\(.*, keyOf\(TO\)\);/g) || []).length === 2 && /await bestPool\(m\.first, .*, m\.key\);/.test(swap));
  ok('signing reads each leg’s tokens again from two nodes', /await poolHolds\(leg\.pair, leg\.offerKey, leg\.askKey, true\)/.test(swap));
}

group('decimals from the token itself, and 0 is a real answer');
{
  ok('the feed says 6 for USTR', mod.knownAsset(A.USTR) && true);
  const d = await mod.confirmDec(A.USTR);
  ok('the contract is asked and says 18', d === 18, d);
  ok('after that the wallet uses 18, not the feed’s 6', mod.DEC[A.USTR] === 18 && mod.knownAsset(A.USTR).dec === 18, mod.knownAsset(A.USTR).dec);
  const ZERO = 'cw20:terra1zero';
  META[ZERO] = { sym: 'ZERO', dec: 0 };
  ok('a token with 0 decimals is 0', (await mod.confirmDec(ZERO)) === 0 && mod.DEC[ZERO] === 0);
  ok('a quote waits for both tokens’ own decimals', /await Promise\.all\(\[confirmDec\(keyOf\(FROM\)\), confirmDec\(keyOf\(TO\)\)\]\)/.test(swap));
  const swapDec = new Function('DEC', 'keyOf', lift(swap, 'function decOf(') + '; return decOf;')({ 'cw20:z': 0 }, t => t && t.key);
  ok('swap: 0 decimals stay 0', swapDec({ key: 'cw20:z', dec: 6 }) === 0 && swapDec({ dec: 0 }) === 0);
  ok('swap: nothing known means 6, nonsense means 6', swapDec({}) === 6 && swapDec({ dec: 99 }) === 6);
  const txDec = new Function(lift(tx, 'function decOf(') + '; return decOf;')();
  ok('send: 0 decimals stay 0', txDec({ dec: 0 }) === 0 && txDec({ dec: '0' }) === 0);
  ok('send: missing means 6', txDec({}) === 6 && txDec(null) === 6 && txDec({ dec: '' }) === 6);
  ok('send: no "|| 6" is left anywhere', !/dec \|\| 6/.test(tx) && !/dec \|\| 6/.test(swap) && !/dec \|\| 6/.test(read('token.js')));
}

group('what is signed is the quote on screen');
{
  const sw = swap.slice(swap.indexOf("$('#sw-go').addEventListener"), swap.indexOf("$('#cf-cancel')"));
  ok('the plan is dropped when a new quote came in while the node was asked', /if \(QUOTE !== q \|\| SEQ !== my\) return;/.test(sw));
  ok('the plan carries its quote, tolerance and amount', /PLAN = \{ steps: plan, est: est, quote: q, seq: my, slip: SLIP, amount:/.test(sw));
  const cf = swap.slice(swap.indexOf("$('#cf-go').addEventListener"));
  ok('signing refuses a plan that is not the quote on screen', /PLAN\.quote !== QUOTE \|\| PLAN\.seq !== SEQ \|\| PLAN\.slip !== SLIP/.test(cf));
  ok('a new quote closes the review panel', /closeConfirm\(\);\n  if \(!TO/.test(swap) || /armGo\('Enter an amount', false\);\n  closeConfirm\(\);/.test(swap));
  ok('the price is checked against the floor just before signing', /the price moved past your tolerance/.test(cf));
}

group('the floor TerraSwap enforces is the one shown');
{
  const env = q => new Function('FROM', 'QUOTE', 'SLIP', 'gdInfo', 'keyOf', lift(swap, 'function envelope(') + '; return envelope;')(
    { denom: 'uluna' }, null, 0.01, () => ({}), () => 'native:uluna')(null, q);
  // a pool with a 0.3% commission on the return: net 997, commission 3
  const m = env({ pair: 'p', dialect: 'ts', offerRaw: '1000', returnRaw: '997', feeRaw: '3' }).msg.swap;
  const expected = 1000 / Number(m.belief_price);        // the gross return the pool checks against
  // the pool accepts while (gross actual) >= expected * (1 - max_spread); the
  // net then is gross * 997/1000
  const netFloor = expected * (1 - Number(m.max_spread)) * 0.997;
  ok('the price is taken on the gross return', Math.abs(expected - 1000) < 1e-9, expected);
  ok('so the net floor equals the minimum shown', Math.abs(netFloor - 997 * 0.99) < 1e-6, netFloor);
  const old = env({ pair: 'p', dialect: 'ts', offerRaw: '1000', returnRaw: '997' }).msg.swap;
  ok('with no commission reported it is what it was', Math.abs(1000 / Number(old.belief_price) - 997) < 1e-9);
  ok('CL8Y signs the minimum shown (min_return), so the review no longer hedges it', /min_return: floor/.test(swap) && !/takes a price limit rather than a minimum/.test(swap));
}

group('a send review belongs to its form and names the recipient');
{
  const rv = tx.slice(tx.indexOf('async function review('), tx.indexOf('async function confirmSend('));
  ok('a review answer for an older form is dropped', (rv.match(/if \(my !== REV\) return;/g) || []).length >= 3);
  ok('editing the form invalidates a review on its way', /REV\+\+;/.test(tx));
  ok('both review panels show the recipient in full', (rv.match(/line\('To', '<code class="saddr">' \+ esc\(to\) \+ '<\/code>'\)/g) || []).length === 2);
  const cs = tx.slice(tx.indexOf('async function confirmSend('));
  ok('sending checks the form is still what was reviewed', /\$\('#send-to'\)\.value\.trim\(\) !== to \|\| \$\('#send-amt'\)\.value\.trim\(\) !== human/.test(cs));
}

report();
