/* getJSON against a node that answers 500 for two different reasons.

   A balance{} query sent to a contract that is not a CW20 comes back from
   publicnode as HTTP 500 with a parse error in the body. That is the contract
   answering, and must not be retried or counted as a failure; a 500 without
   one is the node struggling and is retried as before.

       node tests/getjson.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.location = { search: '' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-'));
fs.writeFileSync(path.join(dir, 'shell.js'), 'export const $ = () => null;');
fs.writeFileSync(path.join(dir, 'chain.js'), fs.readFileSync(path.resolve('assets/js/chain.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
const chain = await import(pathToFileURL(path.join(dir, 'chain.js')).href);

let calls = 0, reply = null;
globalThis.fetch = async () => { calls++; return reply(); };
const res = (status, body) => ({ ok: status < 300, status, text: async () => body, json: async () => JSON.parse(body) });

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ': ' + extra : '')); } };
async function run(r){ calls = 0; reply = r; try { await chain.getJSON('https://x/y', 2000, 3); return null; } catch (e) { return e; } }

console.log('getJSON and 500s');
let e = await run(() => res(500, '{"code":2,"message":"Error parsing into type cw721_base::msg::QueryMsg: unknown variant `balance`, expected one of `owner_of`"}'));
check('parse error: asked once', calls === 1, 'calls ' + calls);
check('parse error: marked refused', e && e.refused === true);
e = await run(() => res(500, '{"code":13,"message":"internal"}'));
check('plain 500: retried three times', calls === 3, 'calls ' + calls);
check('plain 500: not refused', e && !e.refused);
e = await run(() => res(429, 'slow down'));
check('429: retried, not refused', calls === 3 && e && !e.refused, 'calls ' + calls);
e = await run(() => res(400, 'bad'));
check('400: asked once (final), not refused', calls === 1 && e && !e.refused, 'calls ' + calls);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
