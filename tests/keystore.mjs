/* Where the encrypted key is kept, the address check on Send, and auto-lock.

   storage.js is loaded with a fake Telegram object: each test sets which
   stores the client has (SecureStorage, DeviceStorage, CloudStorage), their
   contents, and whether they refuse. The rule under test: the key is never
   written to Telegram's CloudStorage, and a copy an older version left there
   is moved to this device and then removed. bech32Ok and the auto-lock wiring
   are read from the shipped tx.js and boot.js. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const KEY = 'frontier_wallet_v1';

function fakeStore(name, opts = {}){
  const data = Object.assign({}, opts.data || {});
  const log = [];
  const cb = (f) => (...a) => { const done = a.pop(); setTimeout(() => {
    if (opts.refuse) return done(new Error('UNSUPPORTED'));
    try { done(null, f(...a)); } catch (e) { done(e); } }, 0); };
  return { data, log,
    getItem: cb(k => { log.push('get'); return data[k] ?? null; }),
    setItem: cb((k, v) => { log.push('set'); data[k] = v; return true; }),
    removeItem: cb(k => { log.push('remove'); delete data[k]; return true; }) };
}
async function loadStore({ version = '9.1', secure, device, cloud, local = {}, localBroken = false }){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
  const tg = { isVersionAtLeast: v => parseFloat(version) >= parseFloat(v) };
  if (secure) tg.SecureStorage = secure;
  if (device) tg.DeviceStorage = device;
  if (cloud) tg.CloudStorage = cloud;
  globalThis.__TG = tg;
  const ls = Object.assign({}, local);
  globalThis.localStorage = { getItem: k => (localBroken ? null : (ls[k] ?? null)),
    setItem: (k, v) => { if (localBroken) throw new Error('quota'); ls[k] = v; }, removeItem: k => { delete ls[k]; } };
  fs.writeFileSync(path.join(dir, 'shell.js'), "export const $=()=>null; export const report=()=>{}; export const tg=globalThis.__TG;");
  fs.writeFileSync(path.join(dir, 'state.js'), 'export const S={};');
  fs.writeFileSync(path.join(dir, 'storage.js'), fs.readFileSync(path.join(SRC, 'storage.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
  const m = await import(pathToFileURL(path.join(dir, 'storage.js')).href);
  return { Store: m.Store, ls };
}

group('the encrypted key stays on the device');
{
  const secure = fakeStore('secure'), cloud = fakeStore('cloud');
  const { Store } = await loadStore({ version: '8.0', secure, cloud });
  await Store.save('BLOB');
  ok('a client with SecureStorage keeps it in the Keychain/Keystore', Store.kind === 'secure' && secure.data[KEY] === 'BLOB');
  ok('and never writes Telegram\u2019s cloud', !cloud.log.includes('set'));
}
{
  const cloud = fakeStore('cloud');
  const { Store, ls } = await loadStore({ version: '7.2', cloud });
  await Store.save('BLOB');
  ok('a client with only CloudStorage (6.9-8.0) keeps it in the page\u2019s storage, not the cloud',
    Store.kind === 'local' && ls[KEY] === 'BLOB' && !cloud.log.includes('set'));
}
{
  // Telegram Desktop: SecureStorage present but refusing
  const secure = fakeStore('secure', { refuse: true }), device = fakeStore('device'), cloud = fakeStore('cloud');
  const { Store } = await loadStore({ version: '9.1', secure, device, cloud });
  await Store.save('BLOB');
  ok('a refusing SecureStorage steps down to DeviceStorage, not to the cloud',
    Store.kind === 'device' && device.data[KEY] === 'BLOB' && !cloud.log.includes('set'));
}

group('a copy left in the cloud by an older version');
{
  const cloud = fakeStore('cloud', { data: { [KEY]: 'OLD' } });
  const { Store, ls } = await loadStore({ version: '7.2', cloud });
  const v = await Store.load();
  ok('is read, so the wallet still opens', v === 'OLD');
  ok('is moved to this device', ls[KEY] === 'OLD');
  ok('and removed from the cloud', !(KEY in cloud.data));
}
{
  const secure = fakeStore('secure', { data: { [KEY]: 'CURRENT' } }), cloud = fakeStore('cloud', { data: { [KEY]: 'STALE' } });
  const { Store } = await loadStore({ version: '8.0', secure, cloud });
  ok('a stale cloud copy next to the device one: the device one wins, the cloud one goes',
    (await Store.load()) === 'CURRENT' && !(KEY in cloud.data));
}
{
  const cloud = fakeStore('cloud', { data: { [KEY]: 'OLD' } });
  const { Store } = await loadStore({ version: '7.2', cloud, localBroken: true });
  const v = await Store.load();
  ok('if this device cannot keep it, the cloud copy is not deleted (nothing is lost)', v === 'OLD' && cloud.data[KEY] === 'OLD');
}
{
  const secure = fakeStore('secure', { data: { [KEY]: 'X' } }), cloud = fakeStore('cloud', { data: { [KEY]: 'Y' } });
  const { Store } = await loadStore({ version: '8.0', secure, cloud });
  await Store.clear();
  ok('deleting the wallet clears the cloud copy too', !(KEY in cloud.data) && !(KEY in secure.data));
}

group('Send checks the address checksum');
const tx = fs.readFileSync(path.join(SRC, 'tx.js'), 'utf8');
const a = tx.indexOf('const B32 ='), b = tx.indexOf('\n}\n', tx.indexOf('function bech32Ok')) + 3;
const bech32Ok = new Function(tx.slice(a, b) + '\nreturn bech32Ok;')();
ok('a wallet address passes', bech32Ok('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l', 'terra'));
ok('a contract address (32 bytes) passes', bech32Ok('terra1k65g4hy99sy6h7f2khrt5rz97ydlemtn4459gj9qhrt79tp83hcsdsq5uj', 'terra'));
ok('one changed character fails', !bech32Ok('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2m', 'terra'));
ok('two swapped characters fail', !bech32Ok('terra1hjtmkmakjvvtwur05klc7fd72e5n39m4x75c2l', 'terra'));
ok('another chain\u2019s prefix fails', !bech32Ok('cosmos1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l', 'terra'));
ok('upper case fails (Send takes lower case)', !bech32Ok('TERRA1JHTMKMAKJVVTWUR05KLC7FD72E5N39M4X75C2L', 'terra'));
ok('Send uses it before signing', /if \(!bech32Ok\(to, 'terra'\)\)/.test(tx));

group('auto-lock');
const boot = fs.readFileSync(path.join(SRC, 'boot.js'), 'utf8');
ok('the lock button and the timers share one lock', /\$\('#btn-lock'\)\.addEventListener\('click', lockWallet\)/.test(boot) && (boot.match(/lockWallet\(\)/g) || []).length >= 2);
ok('locks after 10 min idle and after 5 min in the background', /IDLE_MS = 10 \* 60 \* 1000/.test(boot) && /HIDDEN_MS = 5 \* 60 \* 1000/.test(boot));

report();
