/* Base64 for transactions of any size (assets/js/b64.js, #76 review).

       node tests/b64.mjs
*/
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const { b64 } = await import(pathToFileURL(path.resolve('assets/js/b64.js')).href);

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more !== undefined ? '\n       ' + more : '')); }
}
const back = s => Uint8Array.from(Buffer.from(s, 'base64'));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

for (const n of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 256 * 1024, 800 * 1024 + 7]) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * 131 + 7) & 255;
  let out = '', err = '';
  try { out = b64(u); } catch (e) { err = e.message; }
  ok(n + ' bytes: encodes without error and decodes to the same bytes', !err && same(back(out), u) && out === Buffer.from(u).toString('base64'), err);
}
const tx = fs.readFileSync(path.resolve('assets/js/tx.js'), 'utf8');
ok('tx.js simulates and broadcasts through b64.js', /import \{ b64 \} from '\.\/b64\.js';/.test(tx) && !/String\.fromCharCode\.apply\(null, b\)/.test(tx));
ok('nothing else spreads bytes into String.fromCharCode', !/String\.fromCharCode\(\.\.\./.test(fs.readFileSync(path.resolve('assets/js/crypto.js'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
