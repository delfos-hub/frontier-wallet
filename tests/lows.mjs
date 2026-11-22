/* Smaller hardening, each case pinned to the shipped code.

   - Wrong PINs cost time after a few, and reloading does not reset the count.
   - An amount like "1,000" is refused instead of guessed; "1,000.5" and "1,5"
     still read as they always did.
   - The transaction hash on screen is computed from the signed bytes, and a
     node reporting absurd gas is not believed.
   - A DeFi contract that is not pinned by address is confirmed on two nodes
     before signing.
   - The backup check can ask for the last word.
   - Telegram storage is used only inside Telegram, not because the URL says so.
   - Balances and icons in the swap picker follow the token, not its symbol.
   - Removing a wallet removes what this device kept for its address.
   - Response headers set what a <meta> policy cannot.
   Run: node tests/lows.mjs */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const ROOT = path.resolve(SRC, '..', '..');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
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
const liftLine = (src, header) => { const i = src.indexOf(header); if (i < 0) throw new Error('not found: ' + header); return src.slice(i, src.indexOf(';\n', i) + 1); };

// a localStorage that lives for the run
function memStore(){
  const m = new Map();
  return {
    get length(){ return m.size; },
    key: i => Array.from(m.keys())[i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    _m: m
  };
}
globalThis.localStorage = memStore();

const tx = read('tx.js'), swap = read('swap.js'), defi = read('defi.js'), sync = read('sync.js');

group('wrong PINs');
{
  const pg = await import(path.join(SRC, 'pinguard.js'));
  const t0 = 1e12;
  localStorage.clear();
  for (let i = 0; i < 4; i++) pg.pinFail(t0);
  ok('the first wrong ones cost nothing', pg.pinWait(t0) === 0);
  pg.pinFail(t0);
  ok('the fifth makes the next wait 30 s', pg.pinWait(t0) === 30000, pg.pinWait(t0));
  pg.pinFail(t0);
  ok('each further miss doubles it', pg.pinWait(t0) === 60000, pg.pinWait(t0));
  for (let i = 0; i < 20; i++) pg.pinFail(t0);
  ok('up to 15 minutes', pg.pinWait(t0) === 15 * 60000, pg.pinWait(t0));
  ok('the count is in storage, so a reload keeps it', JSON.parse(localStorage.getItem('fw:pin:fails')).n === 26);
  ok('the wait runs out', pg.pinWait(t0 + 15 * 60000) === 0);
  pg.pinOk();
  ok('a right PIN clears it', pg.pinWait(t0) === 0 && JSON.parse(localStorage.getItem('fw:pin:fails')).n === 0);
  localStorage.setItem('fw:pin:fails', '{"n":"x"}');
  ok('a garbled record reads as none', pg.pinWait(t0) === 0);
  ok('wait text', pg.waitText(30000) === '30 s' && pg.waitText(120000) === '2 min');
  const boot = read('boot.js'), seed = read('seed.js');
  ok('the unlock screen refuses while waiting', /const wait = pinWait\(\);\s*if \(wait > 0\)[\s\S]{0,300}return;/.test(boot) && /pinFail\(/.test(boot) && /pinOk\(/.test(boot));
  ok('the show-phrase sheet counts too', /pinFail\(/.test(seed) && /pinWait\(/.test(seed));
}

group('amounts');
{
  const toRaw = new Function(lift(tx, 'function toRaw(') + '\nreturn toRaw;')();
  const bad = s => { try { toRaw(s, 6); return false; } catch (e) { return e.message; } };
  ok('1.5 -> 1500000', toRaw('1.5', 6) === '1500000');
  ok('1,5 -> 1500000 (comma as the point)', toRaw('1,5', 6) === '1500000');
  ok('1,000.5 -> 1000500000', toRaw('1,000.5', 6) === '1000500000');
  ok('1 000 000 -> 1000000000000', toRaw('1 000 000', 6) === '1000000000000');
  ok('1000 -> 1000000000', toRaw('1000', 6) === '1000000000');
  ok('"1,000" is refused, not read as 1', /could mean either/.test(bad('1,000') || ''), bad('1,000'));
  ok('"12,345,678" too', /could mean either/.test(bad('12,345,678') || ''));
  ok('"1,0001" is still a decimal comma', toRaw('1,0001', 6) === '1000100');
  ok('junk is refused', !!bad('1e5') && !!bad('abc') && !!bad(''));
  ok('decimals past the token are cut', toRaw('0.1234567', 6) === '123456');
  ok('0 decimals', toRaw('7', 0) === '7');
  ok('the review shows a refused amount instead of failing silently', /toRaw\([^)]*\)[\s\S]{0,200}catch/.test(lift(tx, 'async function review') ) || /catch \(e\)[\s\S]{0,120}sbad/.test(tx));
}

group('what the node says about a transaction');
{
  ok('the hash shown is sha256 of the signed bytes', /sha\.sha256\(raw\)/.test(lift(tx, 'async function broadcast(')) &&
    !/return\s+res\.txhash/.test(lift(tx, 'async function broadcast(')));
  ok('a link is drawn only for a 64-hex hash', /\[0-9A-F\]\{64\}/.test(swap));
  ok('gas above the cap is refused', /used\s*>\s*MAX_GAS/.test(tx) && /const MAX_GAS = 4000000;/.test(tx));
}

group('DeFi contracts confirmed before signing');
{
  const calls = [], perms = [];
  const mk = (a, b) => new Function('FIXED', 'codeNow', 'LCD', 'LCD2', 'KIND_OF_CODE', 'permSet',
    lift(defi, 'async function confirmCode(') + '\nreturn confirmCode;')(
    [{ contract: 'terra1pinned', kind: 'vault' }],
    async (lcd, c) => { calls.push(lcd); const v = lcd === 'L1' ? a : b; if (v instanceof Error) throw v; return v; },
    'L1', 'L2', { 7: 'vault', 9: 'pool' }, (k, v) => perms.push([k, v]));
  const run = async (f, c, k) => { try { await f(c, k); return 'ok'; } catch (e) { return e.message; } };
  ok('a pinned contract needs no lookup', (await run(mk(1, 1), 'terra1pinned', 'vault')) === 'ok' && calls.length === 0);
  ok('both nodes agree on a known code: allowed and remembered', (await run(mk(7, 7), 'terra1x', 'vault')) === 'ok' && perms.some(p => p[0] === 'code:terra1x' && p[1] === 7));
  ok('the nodes disagree: refused', /disagree/.test(await run(mk(7, 8), 'terra1x', 'vault')));
  ok('the second node is down: refused', /second LCD/.test(await run(mk(7, new Error('down')), 'terra1x', 'vault')));
  ok('the code is known, but for another kind: refused', /no longer a known/.test(await run(mk(9, 9), 'terra1x', 'vault')));
  ok('it runs in confirm(), before the signature', /await confirmCode\(/.test(lift(defi, 'async function confirm(')));
}

group('the backup check');
{
  const body = lift(read('onboarding.js'), 'function buildVerify(');
  const rnd = /let a = (.+);/.exec(body)[1];
  const pos = r => new Function('n', 'Math', 'return ' + rnd + ';')(24, { floor: Math.floor, random: () => r });
  ok('position 1 can be asked', pos(0) === 1);
  ok('position 24, the checksum word, can be asked', pos(0.9999) === 24);
}

group('Telegram storage only inside Telegram');
{
  const st = read('storage.js');
  const gate = new Function('tg', liftLine(st, 'const inTelegram =') + '\nreturn inTelegram;');
  ok('no Telegram object: no', gate(null) === false);
  ok('the script loaded on the web (initData empty): no', gate({ initData: '' }) === false);
  ok('a made-up initData without a hash: no', gate({ initData: 'user=1&auth_date=1' }) === false);
  ok('a signed initData: yes', gate({ initData: 'user=%7B%7D&auth_date=1&hash=' + 'a'.repeat(64) }) === true);
  ok('each Telegram store requires it', /const atLeast = v => inTelegram &&/.test(st));
}

group('swap picker follows the token');
{
  const held = [
    { sym: 'USDC', contract: 'terra1fake', v: 999 },
    { sym: 'USDC', denom: 'ibc/REAL', v: 5 }
  ];
  const balOf = new Function('heldTokens', 'keyOf', lift(swap, 'function balOf(') + '\nreturn balOf;')(
    () => held, new Function('return ' + /const keyOf = (.+);\n/.exec(swap)[1])());
  ok('two tokens named USDC keep their own balances', balOf({ sym: 'USDC', denom: 'ibc/REAL' }) === 5 && balOf({ sym: 'USDC', contract: 'terra1fake' }) === 999);
  ok('the icon is matched the same way', /keyOf\(x\) === keyOf\(t\)/.test(lift(swap, 'function face(')));
}

group('removing a wallet');
{
  const A1 = 'terra1aaaa', A2 = 'terra1bbbb';
  localStorage.clear();
  for (const k of ['fw:fav:' + A1, 'fw:tot:' + A1, 'fw:earn:pos:' + A1, 'fw:sync:j:fav:' + A1,
    'fw:fav:' + A2, 'fw:sync', 'fw:labs']) localStorage.setItem(k, '1');
  const forgot = [];
  const drop = new Function('localStorage', 'forget', 'K',
    lift(sync, 'async function dropWallet(') + '\nreturn dropWallet;')(localStorage, async a => { forgot.push(a); return 'deleted'; }, null);
  const r = await drop(A1);
  const left = Array.from(localStorage._m.keys()).sort();
  ok('a synced wallet has its server copy deleted', r === 'deleted' && forgot[0] === A1);
  ok('its entries here are gone', !left.some(k => k.indexOf(A1) >= 0), left.join(' '));
  ok('other wallets and device settings stay', left.join(' ') === ['fw:fav:' + A2, 'fw:labs', 'fw:sync'].sort().join(' '), left.join(' '));
  forgot.length = 0;
  await drop(A2);
  ok('a wallet that never synced makes no server call', forgot.length === 0);
  ok('both remove buttons use it', /dropWallet\(/.test(read('wallets.js')) && /dropWallet\(/.test(read('boot.js')));
}

group('headers');
{
  const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const csp = /Content-Security-Policy: (.+)/.exec(h);
  ok('a policy is served as a header', !!csp);
  ok('scripts only from this site', csp && /script-src 'self'(;|$)/.test(csp[1]) && csp[1].indexOf('unsafe') < 0);
  ok('framing limited (Telegram allowed)', csp && /frame-ancestors 'self' https:\/\/web\.telegram\.org/.test(csp[1]));
  ok('HSTS', /Strict-Transport-Security: max-age=\d{7,}/.test(h));
}

group('markup from outside is escaped');
{
  const wl = read('wallets.js');
  ok('wallet ids', /data-id="' \+ esc\(w\.id\)/.test(wl) && /data-remove="' \+ esc\(w\.id\)/.test(wl));
  ok('denoms are checked where balances are read', /\^\[a-zA-Z\]\[a-zA-Z0-9\/:\._-\]\{2,127\}\$/.test(read('tokens.js')));
  ok('the seed sheet drops a decrypt that finished after it closed', /gen !== GEN/.test(read('seed.js')));
}

report();
