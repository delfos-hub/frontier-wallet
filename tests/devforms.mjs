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
    classList: (() => { const c = new Set(); return { add: (...a) => a.forEach(x => c.add(x)), remove: (...a) => a.forEach(x => c.delete(x)),
      toggle: (x, on) => { if (on === undefined ? !c.has(x) : on) c.add(x); else c.delete(x); }, contains: x => c.has(x) }; })(),
    addEventListener(t, f){ (L[t] = L[t] || []).push(f); },
    removeEventListener(){},
    dispatchEvent(ev){ (L[ev.type] || []).forEach(f => f(Object.assign({ target: e, currentTarget: e, preventDefault(){}, stopPropagation(){} }, ev))); return true; },
    click(){ return e.dispatchEvent({ type: 'click' }); },
    focus(){}, blur(){}, scrollIntoView(){}, insertAdjacentHTML(_, h){ e.innerHTML += h; },
    selectionStart: 0, selectionEnd: 0,
    setRangeText(t, a, b){ e.value = e.value.slice(0, a) + t + e.value.slice(b); e.selectionStart = e.selectionEnd = a + t.length; },
    getAttribute: () => null, setAttribute(){}, removeAttribute(){}, closest: () => null, matches: () => false,
    querySelector: () => el('child'), querySelectorAll: () => [], appendChild(){}, prepend(){}, remove(){},
    get parentElement(){ return el('parent'); }, get firstElementChild(){ return null; }
  };
  // a select: its options are what its HTML lists, and it shows the first
  // one when the list is replaced, as a browser does
  if (sel === '#dv-denom') {
    let html = '', val = '';
    const opts = () => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => ({ value: m[1] }));
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: h => { html = h; val = (opts()[0] || {}).value || ''; } });
    Object.defineProperty(e, 'options', { get: opts });
    Object.defineProperty(e, 'value', { get: () => val, set: v => { if (opts().some(o => o.value === v)) val = v; } });
  }
  return e;
}
const ELS = {};
const $ = s => (ELS[s] = ELS[s] || el(s));
globalThis.Event = class { constructor(type){ this.type = type; } };
globalThis.document = { addEventListener(t, f){ (listeners[t] = listeners[t] || []).push(f); }, createElement: () => el('new'), hidden: false, documentElement: el('html') };
// the screen observers dev.js sets up, so a test can bring a screen on
const OBS = [];
globalThis.MutationObserver = class { constructor(cb){ this.cb = cb; } observe(el){ OBS.push({ el, cb: this.cb }); } disconnect(){} };
const show = async sel => { $(sel).classList.add('on'); OBS.filter(o => o.el === $(sel)).forEach(o => o.cb()); await new Promise(r => setTimeout(r, 320)); };
globalThis.requestAnimationFrame = f => f();
globalThis.matchMedia = () => ({ matches: false, addEventListener(){} });
const LS = {};
globalThis.localStorage = { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; }, key: () => null, length: 0 };
// the node: the balances the test sets, nothing else
let BAL = [];
// and the faucet: what its /status and /claim answer is set by the test
let FAUCET = { status: null, claim: null }, POSTS = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/\/bank\/v1beta1\/balances\//.test(u)) return { ok: true, status: 200, json: async () => ({ balances: BAL }) };
  if (/workers\.dev\/status/.test(u) && FAUCET.status) return { ok: true, status: 200, json: async () => FAUCET.status };
  if (/workers\.dev\/claim/.test(u) && FAUCET.claim) { POSTS++; return { ok: true, status: FAUCET.claim.code, json: async () => FAUCET.claim.body }; }
  return { ok: false, status: 0, json: async () => ({}) };
};
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
// its confirmation: none (pending) unless the test hands one over
export const sendDev = async (from, msgs, mn, net, fee, memo) => { globalThis.__dev.SENT.push({ from, msgs, memo }); return { hash: 'H'.repeat(64), wait: () => globalThis.__dev.WAIT ? globalThis.__dev.WAIT() : Promise.resolve(null) }; };`,
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

console.log('\nprogrammatic edits: Tab in the JSON editor, the token list rebuilt');
{
  const C = 'terra1' + 'e'.repeat(58);
  type('#dv-x-addr', C); type('#dv-x-msg', '{\n"memo": "ab"\n}');
  $('#dv-x-sim').click(); await tick();
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('execute checked: signing on', $('#dv-x-go').disabled === false);
  const ta = $('#dv-x-msg');
  const key = (k, mods) => { let stopped = false; ta.dispatchEvent(Object.assign({ type: 'keydown', key: k, preventDefault(){ stopped = true; } }, mods || {})); return stopped; };
  ta.selectionStart = ta.selectionEnd = 10;   // inside the string "ab"
  ok('Tab is left to the browser: focus moves on, nothing typed', key('Tab') === false && ta.value === '{\n"memo": "ab"\n}');
  ok('Shift+Tab too', key('Tab', { shiftKey: true }) === false && ta.value === '{\n"memo": "ab"\n}');
  ok('a check survives moving through the editor with Tab', $('#dv-x-go').disabled === false);
  ok('Ctrl+] indents the line, even with the caret inside a JSON string', key(']', { ctrlKey: true }) === true && ta.value === '{\n  "memo": "ab"\n}', JSON.stringify(ta.value));
  ok('and signing goes off at once', $('#dv-x-go').disabled === true);
  const n = SENT.length;
  $('#dv-x-go').disabled = false; $('#dv-x-go').click(); await tick(); await tick();
  ok('the check from before the indent is not signed', SENT.length === n);
  const before = SIMS.length;
  $('#dv-x-sim').click(); await tick();
  ok('a fresh check runs for it', SIMS.length === before + 1 && SIMS[before].msgs[0].msg === '{"memo":"ab"}', JSON.stringify(SIMS[SIMS.length - 1].msgs[0]));
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('then signing is on again', $('#dv-x-go').disabled === false);
  ta.selectionStart = 0; ta.selectionEnd = ta.value.length;
  key('[', { metaKey: true });
  ok('Cmd+[ outdents every selected line, and drops the check too', ta.value === '{\n"memo": "ab"\n}' && $('#dv-x-go').disabled === true, JSON.stringify(ta.value));

  // the send form on a token that a balance refresh takes away
  BAL = [{ denom: 'uluna', amount: '900000000' }, { denom: 'uusd', amount: '5000000' }];
  await show('#st-tsend'); await tick();
  $('#dv-denom').value = 'uusd'; $('#dv-denom').dispatchEvent({ type: 'change' });
  type('#dv-to', B1); type('#dv-amt', '1');
  $('#dv-send-sim').click(); await tick();
  ok('the send checked for USTC', SIMS[SIMS.length - 1].msgs[0].coins[0].denom === 'uusd');
  SIMS[SIMS.length - 1].done(); await tick(); await tick();
  ok('signing on for USTC', $('#dv-send-go').disabled === false);
  BAL = [{ denom: 'uluna', amount: '900000000' }];   // the USTC is gone
  $('#st-tsend').classList.remove('on'); OBS.filter(o => o.el === $('#st-tsend')).forEach(o => o.cb());
  await show('#st-tsend'); await tick();
  ok('a balance refresh replaces the picked token (now LUNC)', $('#dv-denom').value === 'uluna', $('#dv-denom').value);
  ok('and signing goes off: the check was for USTC', $('#dv-send-go').disabled === true);
  const m = SENT.length;
  $('#dv-send-go').disabled = false; $('#dv-send-go').click(); await tick(); await tick();
  ok('the USTC check is not signed for LUNC', SENT.length === m);
  BAL = [{ denom: 'uluna', amount: '900000000' }, { denom: 'uusd', amount: '5000000' }];
  $('#dv-send-sim').click(); await tick(); SIMS[SIMS.length - 1].done(); await tick(); await tick();
  $('#st-tsend').classList.remove('on'); OBS.filter(o => o.el === $('#st-tsend')).forEach(o => o.cb());
  await show('#st-tsend'); await tick();
  ok('a refresh that keeps the picked token leaves a good check alone', $('#dv-denom').value === 'uluna' && $('#dv-send-go').disabled === false);
}

console.log('\nthe faucet: 202, a failure in the block, then a status refresh');
{
  const base = { chain: 'rebel-2', faucet: 'terra1faucet', balance: '900000000000', amount: '1000000000', cooldown_h: 24, open: true, why: '' };
  const H = 'F'.repeat(64);
  FAUCET.status = Object.assign({}, base, { next: 0, pending: false });
  $('#dv-fc-go').disabled = false;
  FAUCET.claim = { code: 202, body: { hash: H, amount: '1000000000', pending: true } };
  FAUCET.status = Object.assign({}, base, { next: 0, pending: true, pending_hash: H });
  $('#dv-fc-go').click(); await tick(); await tick(); await tick(); await tick();
  ok('after the 202 the button is off and says the claim waits for its block',
    $('#dv-fc-go').disabled === true && /waiting for its block/.test($('#dv-fc-next').textContent), $('#dv-fc-next').textContent);
  // the send fails in its block; the worker's /status reconciles and frees the address
  FAUCET.status = Object.assign({}, base, { next: 0, pending: false, pending_hash: '' });
  await show('#st-dev'); await new Promise(r => setTimeout(r, 50));
  ok('a status refresh alone turns the button back on, with no second POST', $('#dv-fc-go').disabled === false && POSTS === 1 && $('#dv-fc-next').textContent === 'Ready', $('#dv-fc-next').textContent + ' posts=' + POSTS);
}

console.log('\na confirmation that lands after the wallet changed');
{
  const S = (await import(pathToFileURL(path.join(dir, 'state.js')).href)).S;
  const A = S.ADDR, B = 'terra1' + 'f'.repeat(38);
  const held = () => { let open; const p = new Promise(r => { open = r; }); globalThis.__dev.WAIT = () => p; return open; };
  const LSget = k => JSON.parse(LS[k] || '[]');
  // upload: a fresh check, signed as A, confirmed after the switch to B
  const file = bytes => ({ name: 'c.wasm', arrayBuffer: async () => Uint8Array.from(bytes).buffer });
  const meta0 = $('#dv-wasm-meta').textContent;
  $('#dv-wasm').dispatchEvent({ type: 'change', target: { files: [file([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 3])] } });
  await fileRead(meta0);
  $('#dv-s1-sim').click(); await tick(); SIMS[SIMS.length - 1].done(); await tick(); await tick();
  let land = held();
  $('#dv-i-code').value = '';
  $('#dv-s1-go').click(); await tick(); await tick();
  ok('the upload is signed by A', SENT[SENT.length - 1].from === A);
  S.ADDR = B; (listeners['frontier:wallet'] || []).forEach(f => f({}));
  land({ events: [{ type: 'store_code', attributes: [{ key: 'code_id', value: '42' }] }] }); await tick(); await tick(); await tick();
  ok('code id 42 is saved in A’s history on rebel-2', LSget('fw:dev:codes:rebel-2:' + A).some(c => c.code === '42'), JSON.stringify(LSget('fw:dev:codes:rebel-2:' + A)));
  ok('and not in B’s', !LSget('fw:dev:codes:rebel-2:' + B).some(c => c.code === '42'));
  ok('B’s instantiate form is not filled with A’s code id', $('#dv-i-code').value === '');

  // instantiate: signed as B, confirmed after the switch back to A
  type('#dv-i-code', '7'); type('#dv-i-label', 'made'); type('#dv-i-msg', '{}');
  $('#dv-i-sim').click(); await tick(); SIMS[SIMS.length - 1].done(); await tick(); await tick();
  land = held();
  $('#dv-i-go').click(); await tick(); await tick();
  ok('the contract is made by B', SENT[SENT.length - 1].from === B);
  S.ADDR = A; (listeners['frontier:wallet'] || []).forEach(f => f({}));
  const X = 'terra1' + '9'.repeat(58);
  type('#dv-x-addr', '');
  land({ events: [{ type: 'instantiate', attributes: [{ key: '_contract_address', value: X }] }] }); await tick(); await tick(); await tick();
  ok('the new contract is saved in B’s list on rebel-2', LSget('fw:dev:mine:rebel-2:' + B).some(c => c.addr === X), JSON.stringify(LSget('fw:dev:mine:rebel-2:' + B)));
  ok('and not in A’s', !LSget('fw:dev:mine:rebel-2:' + A).some(c => c.addr === X));
  ok('A’s forms are not pointed at B’s contract', $('#dv-x-addr').value === '');

  // the same wallet still open: the form shows the result as before
  land = held();
  $('#dv-i-sim').click(); await tick(); SIMS[SIMS.length - 1].done(); await tick(); await tick();
  $('#dv-i-go').click(); await tick(); await tick();
  land({ events: [{ type: 'instantiate', attributes: [{ key: '_contract_address', value: 'terra1' + '8'.repeat(58) }] }] }); await tick(); await tick(); await tick();
  ok('no switch: saved for A and the forms take the new contract', LSget('fw:dev:mine:rebel-2:' + A).some(c => c.addr === 'terra1' + '8'.repeat(58)) && $('#dv-x-addr').value === 'terra1' + '8'.repeat(58));
  globalThis.__dev.WAIT = null;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
