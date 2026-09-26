/* Staking messages, byte for byte.

   tx.js encodes protobuf by hand, so every new message is compared with what
   cosmjs-types (0.9.0) produces for the same fields. The expected bytes below
   were generated once with cosmjs-types and pasted in; a wrong field number or
   a missing length prefix shows up here, not in a signed transaction.

       node tests/stake.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const D = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const V = 'terravaloper1ze5dxzs4zcm60tg48m9unp8eh7maerma38dl84';
const W = 'terravaloper1uymwfafhq8fruvcjq8k67a29nqzrxnv9m6m427';
const EXPECTED = {
  "delegate": "0a232f636f736d6f732e7374616b696e672e763162657461312e4d736744656c656761746512750a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1233746572726176616c6f706572317a653564787a73347a636d3630746734386d39756e70386568376d6165726d613338646c38341a100a05756c756e61120731323334353637",
  "undelegate": "0a252f636f736d6f732e7374616b696e672e763162657461312e4d7367556e64656c656761746512750a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1233746572726176616c6f706572317a653564787a73347a636d3630746734386d39756e70386568376d6165726d613338646c38341a100a05756c756e61120731303030303030",
  "redelegate": "0a2a2f636f736d6f732e7374616b696e672e763162657461312e4d7367426567696e526564656c656761746512aa010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1233746572726176616c6f706572317a653564787a73347a636d3630746734386d39756e70386568376d6165726d613338646c38341a33746572726176616c6f7065723175796d7766616668713866727576636a71386b36376132396e717a72786e76396d366d34323722100a05756c756e61120735303030303030",
  "claim": "0a372f636f736d6f732e646973747269627574696f6e2e763162657461312e4d7367576974686472617744656c656761746f7252657761726412630a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1233746572726176616c6f706572317a653564787a73347a636d3630746734386d39756e70386568376d6165726d613338646c3834"
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-'));
const stubs = {
  'chain.js': `export const LCD=''; export const amt=()=>0; export const fmt=String; export const getJSON=async()=>({});
export const iconHTML=()=>''; export const paintIcons=()=>{};`,
  'shell.js': `export const $=()=>null; export const buzz=()=>{}; export const go=()=>{}; export const tap=()=>{};`,
  'state.js': `export const S={};`,
  'tokens.js': `export const heldTokens=()=>[]; export const refreshBalances=()=>{};`,
};
for (const [f, src] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), src);
const src = fs.readFileSync(path.resolve('assets/js/tx.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, '');
fs.writeFileSync(path.join(dir, 'tx.js'), src);
globalThis.document = { getElementById: () => null, querySelector: () => null, addEventListener(){} };
const tx = await import(pathToFileURL(path.join(dir, 'tx.js')).href);

const hex = b => Buffer.from(b).toString('hex');
let pass = 0, fail = 0;
function check(name, got, want){
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want); }
}
function throws(name, fn, re){
  try { fn(); fail++; console.log('  FAIL ' + name + ' (was allowed)'); }
  catch (e) { if (re.test(e.message)) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + ': ' + e.message); } }
}

console.log('staking messages vs cosmjs-types');
check('MsgDelegate', hex(tx.stakeAny(D, { kind: 'delegate', validator: V, amount: '1234567' })), EXPECTED.delegate);
check('MsgUndelegate', hex(tx.stakeAny(D, { kind: 'undelegate', validator: V, amount: '1000000' })), EXPECTED.undelegate);
check('MsgBeginRedelegate', hex(tx.stakeAny(D, { kind: 'redelegate', from: V, to: W, amount: '5000000' })), EXPECTED.redelegate);
check('MsgWithdrawDelegatorReward', hex(tx.stakeAny(D, { kind: 'claim', validator: V })), EXPECTED.claim);
throws('zero amount refused', () => tx.stakeAny(D, { kind: 'delegate', validator: V, amount: '0' }), /greater than zero/);
throws('decimal amount refused', () => tx.stakeAny(D, { kind: 'delegate', validator: V, amount: '1.5' }), /greater than zero/);
throws('unknown action refused', () => tx.stakeAny(D, { kind: 'send', validator: V, amount: '1' }), /unknown staking action/);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
