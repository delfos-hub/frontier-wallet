/* The burn tax as the chain charges it since the reverse charge.

   Figures from a real columbus-5 send (5C10B8A8...): 57637494133 uluna sent at
   0.015, tax_payment 864562411 (truncated), the recipient got 56772931722 and
   the 349017885 fee went to the fee collector separately. */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const tx = fs.readFileSync(path.join(SRC, 'tx.js'), 'utf8');
const act = fs.readFileSync(path.join(SRC, 'activity.js'), 'utf8');
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
const liftLine = (s, h) => { const i = s.indexOf(h); return s.slice(i, s.indexOf(';\n', i) + 1); };

const { burnTaxOn } = new Function(lift(tx, 'function burnTaxOn(') + '\nreturn { burnTaxOn };')();
const A = new Function('wasmCalls', 'worthOf', [
  liftLine(act, 'const FEE_COLLECTOR ='),
  lift(act, 'function eventsOf('), lift(act, 'function taxPaid('), lift(act, 'function flows('),
  'return { taxPaid, flows };'].join('\n'))(() => [], () => 0);

const ME = 'terra1txkkdtkulpqpdw4uc5u3kr5ptj486r7x9qkfup';
const TO = 'terra1205xwr3xj3wf368f42489g345ywyz52r2qwun5';
const FC = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa';
const ev = (type, o) => ({ type, attributes: Object.entries(o).map(([key, value]) => ({ key, value })) });
const T = { logs: [{ events: [
  ev('transfer', { recipient: FC, sender: ME, amount: '349017885uluna' }),
  ev('transfer', { recipient: FC, sender: ME, amount: '864562411uluna', msg_index: '0' }),
  ev('transfer', { recipient: 'terra1jv65s3grqf6v6jl3dp4t6c9t9rk99cd8pm7utl', sender: FC, amount: '86456241uluna', msg_index: '0' }),
  ev('tax_payment', { reverse_charge: 'true', tax_amount: '864562411uluna', msg_index: '0' }),
  ev('transfer', { recipient: TO, sender: ME, amount: '56772931722uluna', msg_index: '0' })
] }] };

group('burn tax on a send');
ok('truncated like the chain', burnTaxOn('57637494133', '0.015000000000000000') === 864562411n);
ok('180 LUNC pays 2.70', burnTaxOn('180000000', '0.015') === 2700000n);
ok('no rate, no tax', burnTaxOn('180000000', null) === 0n);
ok('zero rate', burnTaxOn('180000000', '0.000000000000000000') === 0n);

group('burn tax in activity');
const paid = A.taxPaid(T, ME);
ok('the sender paid the tax', paid.length === 1 && paid[0].amount === '864562411' && paid[0].denom === 'uluna', JSON.stringify(paid));
ok('the recipient did not', A.taxPaid(T, TO).length === 0);
const f = A.flows(T, ME);
ok('the sender\'s flow is the whole amount sent', f.length === 1 && f[0].raw === -57637494133, JSON.stringify(f));
const g = A.flows(T, TO);
ok('the recipient\'s flow is what arrived', g.length === 1 && g[0].raw === 56772931722, JSON.stringify(g));
const old = { logs: [{ events: [ev('transfer', { recipient: FC, sender: ME, amount: '349017885uluna' }),
  ev('transfer', { recipient: TO, sender: ME, amount: '1000uluna' })] }] };
ok('a send with no tax_payment is unchanged', A.flows(old, ME)[0].raw === -1000 && A.taxPaid(old, ME).length === 0);
const viaEvents = { logs: [], events: T.logs[0].events };
ok('newer nodes with events only', A.taxPaid(viaEvents, ME).length === 1);
report();
