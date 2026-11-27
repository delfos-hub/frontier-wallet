/* Developer tool messages, byte for byte.

   The DEV tab (dev.js) signs a bank send, a contract call, a code upload and
   a contract creation on test networks. tx.js encodes them by hand like every
   other message, so each is compared with what cosmjs-types (0.9.0) produces
   for the same fields; the expected bytes were generated with cosmjs-types and
   pasted in.

       node tests/devtx.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const D = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const C = 'terra16zz7rtpkwurte9srfznaa3ctj35xk8k3rgvpm2n7e6s4lr0sssrssxd34z';
const EXPECTED = {
 "send": "0a1c2f636f736d6f732e62616e6b2e763162657461312e4d736753656e641286010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1240746572726131367a7a377274706b7775727465397372667a6e61613363746a3335786b386b33726776706d326e37653673346c7230737373727373786433347a1a140a05756c756e61120b3230303030303030303030",
 "exec": "0a242f636f736d7761736d2e7761736d2e76312e4d736745786563757465436f6e74726163741299010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1240746572726131367a7a377274706b7775727465397372667a6e61613363746a3335786b386b33726776706d326e37653673346c7230737373727373786433347a1a157b22636c61696d223a7b226964223a223766227d7d2a100a05756c756e61120735303030303030",
 "store": "0a1e2f636f736d7761736d2e7761736d2e76312e4d736753746f7265436f6465123b0a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c120b0061736d01000000010203",
 "inst": "0a282f636f736d7761736d2e7761736d2e76312e4d7367496e7374616e7469617465436f6e7472616374128d010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c189a5c220e68746c632d737761702d746573742a0d7b226665655f627073223a307d320d0a05756c756e61120431303030",
 "instNoAdmin": "0a282f636f736d7761736d2e7761736d2e76312e4d7367496e7374616e7469617465436f6e747261637412370a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c18072201782a027b7d"
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtx-'));
const stubs = {
  'chain.js': `export const LCD=''; export const amt=()=>0; export const fmt=String; export const getJSON=async()=>({});
export const iconHTML=()=>''; export const paintIcons=()=>{};`,
  'shell.js': `export const $=()=>null; export const buzz=()=>{}; export const go=()=>{}; export const tap=()=>{}; export const sha={};`,
  'state.js': `export const S={};`,
  'tokens.js': `export const heldTokens=()=>[]; export const refreshBalances=()=>{}; export const sortHeld=a=>a;`,
  'notify.js': `export const notify=()=>{}; export const chime=()=>{};`,
};
for (const [f, src] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), src);
const src = fs.readFileSync(path.resolve('assets/js/tx.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, '');
fs.writeFileSync(path.join(dir, 'tx.js'), src);
fs.writeFileSync(path.join(dir, 'amount.js'), fs.readFileSync(path.resolve('assets/js/amount.js'), 'utf8'));
fs.writeFileSync(path.join(dir, 'b64.js'), fs.readFileSync(path.resolve('assets/js/b64.js'), 'utf8'));
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

const WASM = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3]);
console.log('developer messages vs cosmjs-types');
check('MsgSend', hex(tx.devAny(D, { kind: 'send', to: C, coins: [{ denom: 'uluna', amount: '20000000000' }] })), EXPECTED.send);
check('MsgExecuteContract with funds', hex(tx.devAny(D, { kind: 'exec', contract: C, msg: '{"claim":{"id":"7f"}}', funds: [{ denom: 'uluna', amount: '5000000' }] })), EXPECTED.exec);
check('MsgStoreCode', hex(tx.devAny(D, { kind: 'store', wasm: WASM })), EXPECTED.store);
check('MsgInstantiateContract with admin and funds', hex(tx.devAny(D, { kind: 'inst', admin: D, code: '11802', label: 'htlc-swap-test', msg: '{"fee_bps":0}', funds: [{ denom: 'uluna', amount: '1000' }] })), EXPECTED.inst);
check('MsgInstantiateContract with no admin', hex(tx.devAny(D, { kind: 'inst', admin: '', code: 7, label: 'x', msg: '{}' })), EXPECTED.instNoAdmin);
throws('a send of nothing refused', () => tx.devAny(D, { kind: 'send', to: C, coins: [] }), /nothing to send/);
throws('a zero amount refused', () => tx.devAny(D, { kind: 'send', to: C, coins: [{ denom: 'uluna', amount: '0' }] }), /not valid/);
throws('a bad denom refused', () => tx.devAny(D, { kind: 'exec', contract: C, msg: '{}', funds: [{ denom: 'u luna', amount: '1' }] }), /not valid/);
throws('an empty wasm refused', () => tx.devAny(D, { kind: 'store', wasm: new Uint8Array(0) }), /no wasm/);
throws('a code id that is not a whole number refused', () => tx.devAny(D, { kind: 'inst', code: '1.5', label: 'x', msg: '{}' }), /whole number/);
throws('a contract with no label refused', () => tx.devAny(D, { kind: 'inst', code: 1, label: '', msg: '{}' }), /label/);
const N = 'terra1n3t028lesg4yhmnk9w3utmdxvehlmx9cr6f4jx';
check('MsgMigrateContract', hex(tx.devAny(D, { kind: 'migrate', contract: C, code: '11803', msg: '{"version":"2"}' })), "0a242f636f736d7761736d2e7761736d2e76312e4d73674d696772617465436f6e74726163741284010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1240746572726131367a7a377274706b7775727465397372667a6e61613363746a3335786b386b33726776706d326e37653673346c7230737373727373786433347a189b5c220f7b2276657273696f6e223a2232227d");
check('MsgUpdateAdmin', hex(tx.devAny(D, { kind: 'admin', contract: C, admin: N })), "0a202f636f736d7761736d2e7761736d2e76312e4d736755706461746541646d696e129e010a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c122c7465727261316e33743032386c6573673479686d6e6b39773375746d64787665686c6d783963723666346a781a40746572726131367a7a377274706b7775727465397372667a6e61613363746a3335786b386b33726776706d326e37653673346c7230737373727373786433347a");
check('MsgClearAdmin', hex(tx.devAny(D, { kind: 'clearadmin', contract: C })), "0a1f2f636f736d7761736d2e7761736d2e76312e4d7367436c65617241646d696e12700a2c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1a40746572726131367a7a377274706b7775727465397372667a6e61613363746a3335786b386b33726776706d326e37653673346c7230737373727373786433347a");
throws('a migrate to a code id that is not a number refused', () => tx.devAny(D, { kind: 'migrate', contract: C, code: 'x', msg: '{}' }), /whole number/);
throws('a new admin that is not an address refused', () => tx.devAny(D, { kind: 'admin', contract: C, admin: 'bob' }), /new admin/);
// the gas settings of a network profile stay inside their bounds
{
  const g1 = tx.devGas({ gasPrice: 28.325, gasAdjust: 1.5 }), g2 = tx.devGas({ gasPrice: 99999, gasAdjust: 9 }), g3 = tx.devGas({});
  check('profile gas settings are used', g1.price + '/' + g1.adjust, '28.325/1.5');
  check('out of bounds settings fall back', g2.price + '/' + g2.adjust, '28.325/1.3');
  check('no settings: the defaults', g3.price + '/' + g3.adjust, '28.325/1.3');
}
// columbus-5 is refused before a key is even derived
{
  let msg = '';
  try { await tx.dryRunDev(D, [{ kind: 'send', to: C, coins: [{ denom: 'uluna', amount: '1' }] }], 'x', { chain: 'columbus-5', lcd: 'https://x' }); }
  catch (e) { msg = e.message; }
  check('mainnet refused', /test networks only/.test(msg) ? 'refused' : msg, 'refused');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
