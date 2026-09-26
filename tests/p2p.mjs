/* The P2P bridge's gatekeeper, against the shipped assets/js/p2p.js.

   understand() decides what may be signed for the widget and writes the words
   the user reads before typing the PIN. A mistake here signs something the
   user did not agree to, so the cases below are the refusals from EMBEDDING.md
   rule 4 and the arithmetic behind the summary. Only the module's imports are
   stubbed; the file itself is the one that ships, with P2P_CONTRACT filled in
   because it is empty until deployment.

       node tests/p2p.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const P2P = 'terra1f8zjd4rax6ptqn3zqglk5h5lwfjj3esvjt4lgx3d6hdz07gwjufsa2xy6m';
const TOKEN = 'terra1sxhzljjqhnfztc377wghtg80xmav5a99rdzk8xca9hmm3tjq7rzs5ejkdz';
const OTHER = 'terra1ctvrh09s3q2tgxm88vt6zexle8wcf22qwhxe5qa2wchc9e2ynw3qhvksyl';
const ME = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const SOMEONE = 'terra180wgtfvhmxcarmddhwzpapt8pasmvgv5skegx7';

const ORDERS = {
  7: { id: 7, seller: SOMEONE, offer: { native: { denom: 'uluna' } }, offer_total: '1000000000000',
       offer_remaining: '400000000000', ask: { cw20: { address: TOKEN } }, ask_total: '10000000', fee_bps: 10 },
  8: { id: 8, seller: SOMEONE, offer: { cw20: { address: TOKEN } }, offer_total: '5000000',
       offer_remaining: '5000000', ask: { native: { denom: 'uluna' } }, ask_total: '100000000000', fee_bps: 10 },
  10: { id: 10, seller: SOMEONE, offer: { native: { denom: 'uluna' } }, offer_total: '500000000000',
       offer_remaining: '500000000000', ask: { cw20: { address: TOKEN } }, ask_total: '10000000', fee_bps: 10 },
  9: { id: 9, seller: ME, offer: { native: { denom: 'uluna' } }, offer_total: '2000000',
       offer_remaining: '1500000', ask: { native: { denom: 'uusd' } }, ask_total: '30000', fee_bps: 10 },
};

globalThis.__smart = async (addr, msg) => {
  if (addr === P2P && msg.assets) return { data: { assets: [
    { asset: { cw20: { address: TOKEN } } }, { asset: { native: { denom: 'uluna' } } } ] } };
  if (addr === P2P && msg.order) {
    const o = ORDERS[msg.order.order_id];
    if (!o) throw Object.assign(new Error('not found'), { status: 400 });
    return { data: o };
  }
  if (addr === TOKEN && msg.token_info) return { data: { symbol: 'TUSD', decimals: 6 } };
  throw new Error('unexpected query ' + addr + ' ' + JSON.stringify(msg));
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-'));
const stubs = {
  'chain.js': `export const KNOWN_IBC={'ibc/0BB9D8513E8E8E9AE6A9D211D9136E6DA42288DDE6CFAA453A150A4566054DC5':{sym:'USDC.n',dec:6},'ibc/F52112392095A6D6D1B17EF1FE19BE0B39B2A79B8A2B2F55CD721FC7DBF5081F':{sym:'USDC.inj',dec:6}};
export const amt=(r,d)=>Number(r||0)/Math.pow(10,d);
export const fmt=v=>v.toLocaleString('en-US',{maximumFractionDigits:v<1?6:2});
export const smart=(a,m)=>globalThis.__smart(a,m);`,
  'onboarding.js': `export const PIN_LEN=8; export const digitsOnly=e=>e.value; export const dots=()=>{}; export const focusPin=()=>{};`,
  'shell.js': `const el=()=>({addEventListener(){},classList:{contains:()=>false},hidden:true,style:{},textContent:'',innerHTML:'',value:''});
export const $=()=>el(); export const buzz=()=>{}; export const go=()=>{}; export const libs=async()=>{}; export const report=()=>{};`,
  'state.js': `export const S={ADDR:'${ME}',MNEMONIC:'x',SAVED:{addr:'${ME}',blob:{}}};`,
  'storage.js': `export const decryptSeed=async()=>'x';`,
  'tx.js': `export const dryRunSwap=async()=>({gasFee:1}); export const sendSwap=async()=>({});`,
};
for (const [f, src] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), src);

const shipped = fs.readFileSync(path.resolve('assets/js/p2p.js'), 'utf8')
  .replace(/\?v=[0-9a-f]+/g, '');
globalThis.window = { addEventListener(){} };
globalThis.location = { origin: 'https://delfos-hub.github.io' };
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');

async function load(contract){
  const src = shipped.replace("const P2P_CONTRACT = '';", "const P2P_CONTRACT = '" + contract + "';");
  const f = path.join(dir, 'p2p-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}

let pass = 0, fail = 0;
async function expect(name, fn){
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const refused = async (m, req, re) => {
  let got = null;
  try { await m.understand(req); } catch (e) { got = e.message; }
  if (!got) throw new Error('was allowed');
  if (re && !re.test(got)) throw new Error('refused for the wrong reason: ' + got);
};
const lineOf = (plan, k) => (plan.lines.find(l => l[0] === k) || [])[1] || '';
const hook = o => Buffer.from(JSON.stringify(o)).toString('base64');

const empty = await load('');
const m = await load(P2P);

console.log('p2p bridge');
await expect('no contract configured: every execute refused', () =>
  refused(empty, { contract: P2P, msg: { cancel_order: { order_id: 9 } }, funds: [] }, /not deployed/));

await expect('admin call on the P2P contract refused', () =>
  refused(m, { contract: P2P, msg: { update_config: { paused: true } }, funds: [] }, /not allowed/));
await expect('distribute_fees refused (not a user action here)', () =>
  refused(m, { contract: P2P, msg: { distribute_fees: { asset: { native: { denom: 'uluna' } } } }, funds: [] }, /not allowed/));
await expect('two actions in one msg refused', () =>
  refused(m, { contract: P2P, msg: { cancel_order: { order_id: 9 }, fill_order: { order_id: 7 } }, funds: [] }, /not allowed/));
await expect('call to an unrelated contract refused', () =>
  refused(m, { contract: OTHER, msg: { send: { contract: P2P, amount: '1', msg: hook({ fill_order: { order_id: 8 } }) } }, funds: [] }, /not listed/));
await expect('CW20 transfer refused', () =>
  refused(m, { contract: TOKEN, msg: { transfer: { recipient: SOMEONE, amount: '5' } }, funds: [] }, /only a CW20 send/));
await expect('CW20 send to anything but the P2P contract refused', () =>
  refused(m, { contract: TOKEN, msg: { send: { contract: OTHER, amount: '5', msg: hook({ fill_order: { order_id: 8 } }) } }, funds: [] }, /must go to the P2P/));
await expect('CW20 increase_allowance refused', () =>
  refused(m, { contract: TOKEN, msg: { increase_allowance: { spender: P2P, amount: '5' } }, funds: [] }, /only a CW20 send/));
await expect('CW20 send with an unknown hook refused', () =>
  refused(m, { contract: TOKEN, msg: { send: { contract: P2P, amount: '5', msg: hook({ distribute_fees: {} }) } }, funds: [] }, /hook is not allowed/));
await expect('CW20 send carrying native funds refused', () =>
  refused(m, { contract: TOKEN, msg: { send: { contract: P2P, amount: '5', msg: hook({ fill_order: { order_id: 7 } }) } }, funds: [{ denom: 'uluna', amount: '1' }] }, /must not carry/));
await expect('two coins refused', () =>
  refused(m, { contract: P2P, msg: { fill_order: { order_id: 8 } }, funds: [{ denom: 'uluna', amount: '1' }, { denom: 'uusd', amount: '1' }] }, /at most one/));
await expect('cancel with funds attached refused', () =>
  refused(m, { contract: P2P, msg: { cancel_order: { order_id: 9 } }, funds: [{ denom: 'uluna', amount: '1' }] }, /must not carry/));
await expect('cancelling somebody else\'s order refused', () =>
  refused(m, { contract: P2P, msg: { cancel_order: { order_id: 7 } }, funds: [] }, /not yours/));
await expect('paying an order with the wrong asset refused', () =>
  refused(m, { contract: P2P, msg: { fill_order: { order_id: 7 } }, funds: [{ denom: 'uluna', amount: '100' }] }, /different payment asset/));

await expect('native create_order described from the funds', async () => {
  const p = await m.understand({ contract: P2P, msg: { create_order: { ask: { cw20: { address: TOKEN } }, ask_total: '10000000', ttl: null } },
    funds: [{ denom: 'uluna', amount: '1000000000000' }] });
  if (lineOf(p, 'Action') !== 'Sell 1,000,000 LUNC') throw new Error(lineOf(p, 'Action'));
  if (!/^10 TUSD \(terra1sxhz/.test(lineOf(p, 'For'))) throw new Error(lineOf(p, 'For'));
  if (p.steps.length !== 1 || p.steps[0].contract !== P2P) throw new Error('steps changed');
});
await expect('CW20 fill: pays, gets proportional share minus 0.1%, excess refunded', async () => {
  // order 7: 1,000,000 LUNC for 10 TUSD, 400,000 LUNC left. Paying 5 TUSD would
  // buy 500,000 - capped at 400,000, which costs 4 TUSD, 1 TUSD comes back.
  const p = await m.understand({ contract: TOKEN, msg: { send: { contract: P2P, amount: '5000000', msg: hook({ fill_order: { order_id: 7, min_offer_out: null } }) } }, funds: [] });
  if (!/^4 TUSD .*the rest of 5 TUSD/.test(lineOf(p, 'You pay'))) throw new Error(lineOf(p, 'You pay'));
  if (!/about 399,600 LUNC, before the chain burn tax/.test(lineOf(p, 'You get'))) throw new Error(lineOf(p, 'You get'));
});
await expect('native fill of a CW20 order, minimum shown', async () => {
  // order 8: 5 TUSD for 100,000 LUNC. 20,000 LUNC buys 1 TUSD, minus 0.1%.
  const p = await m.understand({ contract: P2P, msg: { fill_order: { order_id: 8, min_offer_out: '990000' } }, funds: [{ denom: 'uluna', amount: '20000000000' }] });
  if (!/about 0\.999 TUSD/.test(lineOf(p, 'You get'))) throw new Error(lineOf(p, 'You get'));
  if (!/^0\.99 TUSD/.test(lineOf(p, 'Minimum'))) throw new Error(lineOf(p, 'Minimum'));
});
await expect('Noble USDC named USDC.n, not a hash', async () => {
  const USDC = 'ibc/0BB9D8513E8E8E9AE6A9D211D9136E6DA42288DDE6CFAA453A150A4566054DC5';
  const p = await m.understand({ contract: P2P, msg: { create_order: { ask: { native: { denom: USDC } }, ask_total: '47000000', ttl: null } },
    funds: [{ denom: 'uluna', amount: '1000000000000' }] });
  if (lineOf(p, 'For') !== '47 USDC.n') throw new Error(lineOf(p, 'For'));
});
await expect('Injective USDC named USDC.inj', async () => {
  const INJ = 'ibc/F52112392095A6D6D1B17EF1FE19BE0B39B2A79B8A2B2F55CD721FC7DBF5081F';
  const p = await m.understand({ contract: P2P, msg: { create_order: { ask: { native: { denom: INJ } }, ask_total: '47000000', ttl: null } },
    funds: [{ denom: 'uluna', amount: '1000000000000' }] });
  if (lineOf(p, 'For') !== '47 USDC.inj') throw new Error(lineOf(p, 'For'));
});
await expect('a look-alike IBC denom is not called USDC', async () => {
  const p = await m.understand({ contract: P2P, msg: { create_order: { ask: { native: { denom: 'ibc/0BB9D85000000000000000000000000000000000000000000000000000000000' } }, ask_total: '1000000', ttl: null } },
    funds: [{ denom: 'uluna', amount: '1000000' }] });
  if (/USDC/.test(lineOf(p, 'For'))) throw new Error(lineOf(p, 'For'));
});
await expect('own cancel allowed and described', async () => {
  const p = await m.understand({ contract: P2P, msg: { cancel_order: { order_id: 9 } }, funds: [] });
  if (!/^1\.5 LUNC/.test(lineOf(p, 'Returned to you'))) throw new Error(lineOf(p, 'Returned to you'));
});

const fillMsg = (id, amount, min) => ({ contract: TOKEN, funds: [],
  msg: { send: { contract: P2P, amount: amount, msg: hook({ fill_order: { order_id: id, min_offer_out: min } }) } } });
const refusedBatch = async (mod, msgs, re) => {
  let got = null;
  try { await mod.understandBatch(msgs); } catch (e) { got = e.message; }
  if (!got) throw new Error('was allowed');
  if (re && !re.test(got)) throw new Error('refused for the wrong reason: ' + got);
};

console.log('\nexecute-batch');
await expect('no contract configured: batch refused', () =>
  refusedBatch(empty, [fillMsg(7, '1', '1'), fillMsg(10, '1', '1')], /not deployed/));
await expect('a single fill is not a batch', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1')], /2 to 10/));
await expect('more than 10 fills refused', () =>
  refusedBatch(m, Array.from({ length: 11 }, (_, i) => fillMsg(7, '1', '1')), /2 to 10/));
await expect('a fill without min_offer_out refused', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1'), fillMsg(10, '5000000', null)], /needs min_offer_out/));
await expect('the same order twice refused', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1'), fillMsg(7, '1000000', '1')], /appears twice/));
await expect('fills on two different pairs refused', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1'), { contract: P2P, funds: [{ denom: 'uluna', amount: '20000000000' }], msg: { fill_order: { order_id: 8, min_offer_out: '1' } } }], /one pair|different payment/));
await expect('a cancel inside a batch refused', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1'), { contract: P2P, funds: [], msg: { cancel_order: { order_id: 9 } } }], /only fill orders/));
await expect('a CW20 transfer smuggled into a batch refused', () =>
  refusedBatch(m, [fillMsg(7, '2000000', '1'), { contract: TOKEN, funds: [], msg: { transfer: { recipient: SOMEONE, amount: '5' } } }], /only a CW20 send/));
await expect('sweep of two orders summed as one trade', async () => {
  // #7: 2 TUSD buys 200,000 LUNC; #10 (twice the price): 5 TUSD buys 250,000.
  // Net of 0.1%: 199,800 + 249,750 = 449,550 LUNC for 7 TUSD.
  const p = await m.understandBatch([fillMsg(7, '2000000', '199000000000'), fillMsg(10, '5000000', '249000000000')]);
  if (p.steps.length !== 2) throw new Error('steps: ' + p.steps.length);
  if (!/^Buy from 2 orders \(#7, #10\)$/.test(lineOf(p, 'Action'))) throw new Error(lineOf(p, 'Action'));
  if (!/^7 TUSD/.test(lineOf(p, 'You pay'))) throw new Error(lineOf(p, 'You pay'));
  if (!/about 449,550 LUNC/.test(lineOf(p, 'You get'))) throw new Error(lineOf(p, 'You get'));
  if (!/^448,000 LUNC in total/.test(lineOf(p, 'Minimum'))) throw new Error(lineOf(p, 'Minimum'));
  if (!/^0\.00002 TUSD/.test(lineOf(p, 'Worst price'))) throw new Error(lineOf(p, 'Worst price'));
  if (!/^0\.000016 TUSD/.test(lineOf(p, 'Average price'))) throw new Error(lineOf(p, 'Average price'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
