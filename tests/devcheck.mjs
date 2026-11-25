/* DEV tab checks bound to their wallet and network (assets/js/devcheck.js),
   and the line shown after a send (#76 review).

       node tests/devcheck.mjs
*/
import path from 'path';
import { pathToFileURL } from 'url';
const { checks, blockLine, STALE } = await import(pathToFileURL(path.resolve('assets/js/devcheck.js')).href);

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more ? '\n       ' + more : '')); }
}
const refused = fn => { try { fn(); return false; } catch (e) { return e.message === STALE; } };
const A = 'terra1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', B = 'terra1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

console.log('DEV checks: bound to wallet and network');
{
  const live = { addr: A, net: { chain: 'rebel-2', lcd: 'https://lcd.one', gasPrice: 28.325, gasAdjust: 1.3 } };
  const C = checks(() => live);
  const p = C.bound({ m: 'send' });
  ok('a check keeps the wallet it ran for', p.from === A);
  ok('and a copy of the network, not the live object', p.net !== live.net && p.net.lcd === 'https://lcd.one');
  ok('it can be signed while nothing changed', C.fresh(p) === p);

  live.addr = B;
  ok('another wallet: the check is refused', refused(() => C.fresh(p)));
  live.addr = A;
  ok('back on the same wallet and network it is valid again', C.fresh(p) === p);

  live.net.lcd = 'https://lcd.two';
  ok('another node: refused', refused(() => C.fresh(p)));
  ok('and the copy it would sign with still names the node it was checked on', p.net.lcd === 'https://lcd.one');
  live.net.lcd = 'https://lcd.one';

  live.net.chain = 'columbus-5';
  ok('another chain: refused', refused(() => C.fresh(p)));
  live.net.chain = 'rebel-2';

  live.net.gasPrice = 50;
  ok('other gas settings: refused (the fee was worked out with the old ones)', refused(() => C.fresh(p)));
  live.net.gasPrice = 28.325;

  ok('no check at all: refused', refused(() => C.fresh(null)));
}

{
  const live = { addr: A, net: { chain: 'rebel-2', lcd: 'https://lcd.one', gasPrice: 28.325, gasAdjust: 1.3 } };
  const C = checks(() => live);
  let seen = null;
  const got = await C.simulate(async (from, net) => { seen = { from, net }; return { gasFee: 7 }; });
  ok('a simulation runs for the active wallet and a copy of the network', got.gasFee === 7 && seen.from === A && seen.net !== live.net);

  let release;
  const slow = C.simulate(() => new Promise(r => { release = r; }));
  live.addr = B;                       // the wallet changes while the node is thinking
  release({ gasFee: 9 });
  let threw = null;
  try { await slow; } catch (e) { threw = e.message; }
  ok('a simulation that comes back after a wallet switch is thrown away', threw === STALE, String(threw));

  live.addr = A;
  const slow2 = C.simulate(() => new Promise(r => { release = r; }));
  live.net.lcd = 'https://lcd.two';
  release({ gasFee: 9 });
  threw = null;
  try { await slow2; } catch (e) { threw = e.message; }
  ok('and one that comes back after a node switch too', threw === STALE, String(threw));
}

console.log('DEV send: "in block" only after inclusion');
{
  const link = '<a>ABC</a>';
  const none = blockLine(null, link);
  ok('wait() gave nothing: confirmation pending, not "in block"', !none.ok && /Confirmation pending/.test(none.html) && !/In block/.test(none.html), none.html);
  ok('the hash stays on screen', none.html.indexOf(link) >= 0);
  const noHeight = blockLine({}, link);
  ok('an answer without a height is not a block either', !noHeight.ok && /Confirmation pending/.test(noHeight.html));
  const yes = blockLine({ height: '33520021' }, link);
  ok('a block height: "In block" with it', yes.ok && yes.html === 'In block 33,520,021.', yes.html);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
