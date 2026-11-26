/* The DEV tab signs only what it checked (assets/js/dev.js, #76 review).

   dev.js is loaded as shipped against a small stand-in for the page: every
   element it asks for is a plain object that keeps its value, its disabled
   flag and its listeners. The simulation is held open, a field is edited (or
   another file chosen) while it runs, and then it is let go: signing must stay
   off until a fresh check succeeds, and a check signs exactly the values it
   was built from.

       node tests/devforms.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more !== undefined ? '\n       ' + more : '')); }
}

// ---- the page, as far as dev.js uses it
const listeners = {};
function el(sel){
  const L = {};
  const e = {
    sel, options: [], value: '', disabled: false, hidden: false, checked: false, textContent: '', innerHTML: '', className: '', dataset: {}, style: {}, files: [],
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(t, f){ (L[t] = L[t] || []).push(f); },
    removeEventListener(){},
    dispatchEvent(ev){ (L[ev.type] || []).forEach(f => f(Object.assign({ target: e, currentTarget: e, preventDefault(){}, stopPropagation(){} }, ev))); return true; },
    click(){ return e.dispatchEvent({ type: 'click' }); },
    focus(){}, blur(){}, scrollIntoView(){}, setRangeText(){}, insertAdjacentHTML(_, h){ e.innerHTML += h; },
    getAttribute: () => null, setAttribute(){}, removeAttribute(){}, closest: () => null, matches: () => false,
    querySelector: () => el('child'), querySelectorAll: () => [], appendChild(){}, prepend(){}, remove(){},
    get parentElement(){ return el('parent'); }, get firstElementChild(){ return null; }
  };
  return e;
}
const ELS = {};
const $ = s => (ELS[s] = ELS[s] || el(s));
globalThis.Event = class { constructor(type){ this.type = type; } };
globalThis.document = { addEventListener(t, f){ (listeners[t] = listeners[t] || []).push(f); }, createElement: () => el('new'), hidden: false, documentElement: el('html') };
globalThis.MutationObserver = class { observe(){} disconnect(){} };
globalThis.requestAnimationFrame = f => f();
globalThis.matchMedia = () => ({ matches: false, addEventListener(){} });
const LS = {};
globalThis.localStorage = { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; }, key: () => null, length: 0 };
globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) });
try { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText(){} } }, configurable: true }); } catch (e) {}
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// ---- what dev.js imports
const SIMS = [], SENT = [];
const ADDR = 'terra1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
globalThis.__dev = { $, SIMS, SENT };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devforms-'));
const stubs = {
  'chain.js': `export const esc = s => String(s == null ? '' : s); export const fmt = String;`,
  'shell.js': `export const $ = s => globalThis.__dev.$(s); export const $$ = () => []; export const go = () => {};`,
  'state.js': `export const S = { ADDR: '${ADDR}', MNEMONIC: 'test words' };`,
  'tx.js': `export const DEV_URLS = [];
export const toRaw = (v, dec) => { const n = Number(String(v).replace(',', '.')); if (!(n > 0)) throw new Error('bad amount'); return String(Math.round(n * 10 ** dec)); };
// a simulation held open until the test lets it go
export const dryRunDev = (from, msgs, mn, net, memo) => new Promise(res => globalThis.__dev.SIMS.push({ msgs, memo, done: () => res({ gasFee: 1000, gas: 100000, fee: 1000 }) }));
export const sendDev = async (from, msgs, mn, net, fee, memo) => { globalThis.__dev.SENT.push({ msgs, memo }); return { hash: 'H', wait: async () => null }; };`,
};
for (const [f, s] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), s);
fs.writeFileSync(path.join(dir, 'devcheck.js'), fs.readFileSync(path.resolve('assets/js/devcheck.js'), 'utf8'));
fs.writeFileSync(path.join(dir, 'dev.js'), fs.readFileSync(path.resolve('assets/js/dev.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
await import(pathToFileURL(path.join(dir, 'dev.js')).href);

const tick = () => new Promise(r => setTimeout(r, 0));
// a chosen file is read, hashed and compressed over several turns: wait for its line
const fileRead = async before => { for (let i = 0; i < 500 && ($('#dv-wasm-meta').textContent === before || !/sha256/.test($('#dv-wasm-meta').textContent)); i++) await new Promise(r => setTimeout(r, 2)); };
const type = (s, v) => { $(s).value = v; $(s).dispatchEvent({ type: 'input' }); };
const B1 = 'terra1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', B2 = 'terra1cccccccccccccccccccccccccccccccccccccc';

console.log('send: a change during the check');
{
  type('#dv-to', B1); type('#dv-amt', '5'); $('#dv-denom').value = 'uluna';
  $('#dv-send-sim').click(); await tick();
  ok('the check is running for 5 to B1', SIMS.length === 1 && SIMS[0].msgs[0].to === B1);
  type('#dv-to', B2);
  SIMS[0].done(); await tick(); await tick();
  ok('recipient changed while it ran: signing stays off', $('#dv-send-go').disabled === true);
  $('#dv-send-go').click(); await tick();
  ok('and nothing is signed', SENT.length === 0);
  $('#dv-send-sim').click(); await tick();
  ok('a fresh check runs for B2', SIMS.length === 2 && SIMS[1].msgs[0].to === B2);
  type('#dv-amt', '7');
  SIMS[1].done(); await tick(); await tick();
  ok('amount changed while it ran: signing stays off', $('#dv-send-go').disabled === true);
  $('#dv-send-sim').click(); await tick();
  SIMS[2].done(); await tick(); await tick();
  ok('a check with no edit while it ran: signing on', $('#dv-send-go').disabled === false);
  $('#dv-send-go').click(); await tick(); await tick();
  ok('and what is signed is what was checked: 7 to B2', SENT.length === 1 && SENT[0].msgs[0].to === B2 && SENT[0].msgs[0].coins[0].amount === '7000000', JSON.stringify(SENT[0]));
}
console.log('\nsend: an edit after a good check');
{
  $('#dv-send-sim').click(); await tick();
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('checked: signing on', $('#dv-send-go').disabled === false);
  type('#dv-amt', '9');
  ok('the amount is edited: signing off at once', $('#dv-send-go').disabled === true);
  $('#dv-send-go').disabled = false;   // even if the button were turned back on
  const n = SENT.length;
  $('#dv-send-go').click(); await tick(); await tick();
  ok('the old check is not signed', SENT.length === n);
}

console.log('\nupload: another file during the check');
{
  const file = bytes => ({ name: 'c.wasm', arrayBuffer: async () => Uint8Array.from(bytes).buffer });
  $('#dv-wasm').dispatchEvent({ type: 'change', target: { files: [file([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1])] } });
  await fileRead('');
  const n0 = SIMS.length;
  $('#dv-s1-sim').click(); await tick();
  ok('the check runs for the first file', SIMS.length === n0 + 1);
  const firstBytes = SIMS[n0].msgs[0].wasm;
  const meta1 = $('#dv-wasm-meta').textContent;
  $('#dv-wasm').dispatchEvent({ type: 'change', target: { files: [file([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 2])] } });
  await fileRead(meta1);
  SIMS[n0].done(); await tick(); await tick();
  ok('another file chosen while it ran: signing stays off', $('#dv-s1-go').disabled === true);
  const s0 = SENT.length;
  $('#dv-s1-go').click(); await tick(); await tick();
  ok('and nothing is uploaded', SENT.length === s0);
  $('#dv-s1-sim').click(); await tick();
  const second = SIMS[SIMS.length - 1];
  ok('a fresh check is for the second file', second.msgs[0].wasm !== firstBytes);
  second.done(); await tick(); await tick();
  ok('then signing is on', $('#dv-s1-go').disabled === false);
  $('#dv-s1-go').click(); await tick(); await tick();
  ok('and the file uploaded is the one checked', SENT.length === s0 + 1 && SENT[SENT.length - 1].msgs[0].wasm === second.msgs[0].wasm);
}

console.log('\nexecute, instantiate, admin: an edit during the check');
{
  const C = 'terra1' + 'd'.repeat(58);
  type('#dv-x-addr', C); type('#dv-x-msg', '{"a":1}');
  $('#dv-x-sim').click(); await tick();
  type('#dv-x-msg', '{"a":2}');
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('execute: message edited while it ran: signing stays off', $('#dv-x-go').disabled === true);
  type('#dv-i-code', '7'); type('#dv-i-label', 'x'); type('#dv-i-msg', '{}');
  $('#dv-i-sim').click(); await tick();
  type('#dv-i-label', 'y');
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('instantiate: label edited while it ran: signing stays off', $('#dv-i-go').disabled === true);
  type('#dv-a-addr', C); type('#dv-a-code', '8'); type('#dv-a-msg', '{}');
  $('#dv-a-sim').click(); await tick();
  type('#dv-a-code', '9');
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('admin: code edited while it ran: signing stays off', $('#dv-a-go').disabled === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
