/* Settings sync (assets/js/sync.js) against the real Worker (sync-worker/worker.js).

   Each "device" is its own instance of the shipped sync.js with its own
   storage; fetch is routed into the shipped Worker, which keeps its records
   in a fake KV. So what is checked is the two files as deployed, end to end:
   the list reaches the other device, the newer change wins, two old lists
   are joined instead of one replacing the other, and what the Worker holds
   is neither readable nor replaceable without the phrase. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const ROOT = path.resolve(SRC, '..', '..');
const worker = (await import(pathToFileURL(path.join(ROOT, 'sync-worker', 'worker.js')).href)).default;

const PHRASE_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const ADDR_A = 'terra1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ADDR_B = 'terra1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ORIGIN = 'https://wallet.delfos-hub.net';

// the Worker's storage
function fakeD1(){
  // a D1 that knows the Worker's statements; rows kept as data['doc:'+id] = JSON
  const data = {}; let puts = 0;
  const row = id => (data['doc:' + id] ? JSON.parse(data['doc:' + id]) : null);
  const prepare = sql => ({ bind: (...a) => ({
    first: async () => {
      const r = row(a[0]); if (!r) return null;
      if (/^SELECT d, t /.test(sql)) return { d: r.d, t: r.t };
      if (/^SELECT a, d, t /.test(sql)) return { a: r.a, d: r.d, t: r.t };
      if (/^SELECT a /.test(sql)) return { a: r.a };
      throw new Error('fake D1: ' + sql);
    },
    run: async () => {
      let changes = 0;
      if (/^UPDATE docs/.test(sql)) { const [d, t, id, aa, old] = a; const r = row(id); if (r && r.a === aa && r.t === old) { data['doc:' + id] = JSON.stringify({ a: r.a, d, t }); changes = 1; } }
      else if (/^INSERT INTO docs/.test(sql)) { const [id, aa, d, t] = a; if (!row(id)) { data['doc:' + id] = JSON.stringify({ a: aa, d, t }); changes = 1; } }
      else if (/^DELETE FROM docs WHERE id/.test(sql)) { const r = row(a[0]); if (r && r.a === a[1]) { delete data['doc:' + a[0]]; changes = 1; } }
      else if (/^DELETE FROM docs WHERE t </.test(sql)) { for (const k of Object.keys(data)) if (JSON.parse(data[k]).t < a[0]) { delete data[k]; changes++; } }
      else throw new Error('fake D1: ' + sql);
      if (changes) puts += 1;
      return { meta: { changes } };
    } }) });
  return { data, get puts(){ return puts; }, prepare };
}
let KV = fakeD1(), DOWN = false, CALLS = 0, LIMIT = null, LASTURL = '';
const call = (url, init = {}, origin = ORIGIN) => worker.fetch(
  new Request(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, origin ? { Origin: origin } : {}) })), { DB: KV, WRITES: LIMIT, READS: LIMIT });
globalThis.fetch = async (url, init) => {
  CALLS += 1; LASTURL = String(url);
  if (DOWN) throw new TypeError('network down');
  return call(String(url), init);
};

// the debounced pass (1.2 s after a change) is not started here: every pass is
// driven by the cases, and a late timer would run with another device's storage
const REAL_TIMEOUT = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => (ms === 1200 ? 0 : REAL_TIMEOUT(f, ms, ...a));

let seq = 0;
async function device(phrase, addr, opts = {}){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  fs.mkdirSync(path.join(dir, 'assets', 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vendor'));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'crypto.js'), path.join(dir, 'vendor', 'crypto.js'));
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'state.js'), 'export const S = { MNEMONIC: null, SAVED: null };');
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'sync.js'),
    fs.readFileSync(path.join(SRC, 'sync.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
  // on unless the case says otherwise: sync is off by default (tested below)
  const ls = Object.assign(opts.fresh ? {} : { 'fw:sync': '1' }, opts.local || {});
  const storage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
  globalThis.localStorage = storage;
  const m = await import(pathToFileURL(path.join(dir, 'assets', 'js', 'sync.js')).href + '?n=' + (seq++));
  const { S } = await import(pathToFileURL(path.join(dir, 'assets', 'js', 'state.js')).href);
  S.MNEMONIC = opts.watch ? null : phrase;
  S.SAVED = opts.watch ? { addr, watch: true } : { addr, blob: {} };
  // the same shape fav.js registers: a list of { k, sym } under fw:fav:<addr>
  const get = a => JSON.parse(ls['fw:fav:' + a] || '[]');
  m.section('fav', {
    read: get,
    write: (a, v) => { ls['fw:fav:' + a] = JSON.stringify(v); },
    clean: v => (Array.isArray(v) ? v.filter(f => f && typeof f.k === 'string').slice(0, 6) : []),
    empty: v => !v.length,
    merge: (mine, theirs) => { const seen = {}; return theirs.concat(mine).filter(f => !seen[f.k] && (seen[f.k] = 1)).slice(0, 6); }
  });
  const use = () => { globalThis.localStorage = storage; };
  return { m, S, ls, addr,
    list: () => get(addr).map(f => f.sym).join(','),
    set(v){ use(); ls['fw:fav:' + addr] = JSON.stringify(v); m.changed('fav'); },
    sync(){ use(); return m.syncNow(); } };
}
const tok = s => ({ k: 'cw20:terra1' + s.toLowerCase(), sym: s });
const tick = () => new Promise(r => setTimeout(r, 3));

group('keys and the envelope');
{
  const d = await device(PHRASE_A, ADDR_A);
  const priv = new Uint8Array(32).fill(7);
  const a = await d.m.deriveKeys(priv), b = await d.m.deriveKeys(priv), c = await d.m.deriveKeys(new Uint8Array(32).fill(8));
  ok('the same key gives the same id and token', a.id === b.id && a.token === b.token);
  ok('id and token are 64 hex characters and differ', /^[0-9a-f]{64}$/.test(a.id) && /^[0-9a-f]{64}$/.test(a.token) && a.id !== a.token);
  ok('neither is the key itself', a.id !== '07'.repeat(32) && a.token !== '07'.repeat(32));
  ok('another key gives another id', c.id !== a.id && c.token !== a.token);
  const one = await d.m.seal(a.key, { v: 1, s: { fav: { t: 1, v: [tok('JURIS')] } } });
  const five = await d.m.seal(a.key, { v: 1, s: { fav: { t: 1, v: ['A', 'B', 'C', 'D', 'E'].map(tok) } } });
  ok('what was sealed opens with the same key', (await d.m.unseal(a.key, one)).s.fav.v[0].sym === 'JURIS');
  ok('one favorite and five are the same length on the wire', one.length === five.length);
  ok('sealing twice never gives the same text', one !== await d.m.seal(a.key, { v: 1, s: { fav: { t: 1, v: [tok('JURIS')] } } }));
  let opened = true;
  try { await d.m.unseal(c.key, one); } catch (e) { opened = false; }
  ok('another key does not open it', !opened);
}

group('one wallet on two devices');
KV = fakeD1();
const web = await device(PHRASE_A, ADDR_A), tg = await device(PHRASE_A, ADDR_A);
{
  ok('nothing kept and nothing picked: no record is made', (await web.sync()) === 'read' && KV.puts === 0);
  web.set([tok('JURIS'), tok('TCO')]);
  ok('a pick on the web wallet is written', (await web.sync()) === 'written' && KV.puts === 1);
  const stored = JSON.stringify(KV.data);
  ok('the Worker holds no address, contract or symbol', !/terra1|JURIS|TCO|cw20/.test(stored));
  ok('nor the token that guards the record', (() => { const rec = JSON.parse(Object.values(KV.data)[0]); return /^[0-9a-f]{64}$/.test(rec.a) && !stored.includes(Object.keys(KV.data)[0].slice(4) + rec.a); })());
  ok('the Mini App opens with the same list', (await tg.sync()) === 'read' && tg.list() === 'JURIS,TCO');
  ok('reading wrote nothing', KV.puts === 1);
  await tick();
  tg.set([tok('TCO')]);
  await tg.sync();
  ok('a removal in the Mini App reaches the web wallet', (await web.sync()) === 'read' && web.list() === 'TCO');
  await tick();
  web.set([]);
  await web.sync(); await tg.sync();
  ok('removing the last one empties the other device too', tg.list() === '');
  await tick();
  tg.set([tok('LTK'), tok('VIMA')]); await tg.sync();
  await tick();
  web.set([tok('VIMA'), tok('LTK')]); await web.sync(); await tg.sync();
  ok('the order set last is the order everywhere', tg.list() === 'VIMA,LTK' && web.list() === 'VIMA,LTK');
  const before = KV.puts;
  await web.sync(); await tg.sync();
  ok('opening again with nothing changed writes nothing', KV.puts === before);
}

group('lists from before sync existed');
{
  KV = fakeD1();
  const a = await device(PHRASE_A, ADDR_A, { local: { ['fw:fav:' + ADDR_A]: JSON.stringify([tok('JURIS'), tok('TCO')]) } });
  const b = await device(PHRASE_A, ADDR_A, { local: { ['fw:fav:' + ADDR_A]: JSON.stringify([tok('TCO'), tok('LTK')]) } });
  ok('the first device to open puts its old list up', (await a.sync()) === 'written');
  await b.sync();
  ok('the second keeps its own and gains the other’s', b.list() === 'JURIS,TCO,LTK');
  await a.sync();
  ok('and the first ends with the same joined list', a.list() === 'JURIS,TCO,LTK');
  const many = await device(PHRASE_A, ADDR_A, { local: { ['fw:fav:' + ADDR_A]: JSON.stringify(['P', 'Q', 'R', 'S', 'T'].map(tok)) } });
  await many.sync();
  ok('a joined list stops at six', many.list().split(',').length === 6 && many.list().indexOf('JURIS,TCO,LTK') === 0);
}

group('what stays on the device');
{
  KV = fakeD1(); CALLS = 0;
  const w = await device(PHRASE_A, ADDR_A, { watch: true });
  w.set([tok('JURIS')]);
  ok('a watched address is never sent anywhere', (await w.sync()) === 'no key' && CALLS === 0 && KV.puts === 0);
  const off = await device(PHRASE_A, ADDR_A, { local: { 'fw:sync': '0' } });
  off.set([tok('JURIS')]);
  ok('nor a wallet with sync turned off', (await off.sync()) === 'off' && CALLS === 0);
  off.ls['fw:sync'] = '1';
  ok('turning it on sends what was picked meanwhile', (await off.sync()) === 'written' && KV.puts === 1);
  const other = await device(PHRASE_B, ADDR_B);
  await other.sync();
  ok('another wallet does not see this one’s list', other.list() === '' );
  other.set([tok('DO')]); await other.sync();
  ok('and keeps its own record', Object.keys(KV.data).length === 2);
  const locked = await device(PHRASE_A, ADDR_A);
  locked.S.MNEMONIC = null;
  ok('a locked wallet does not sync', (await locked.sync()) === 'no key');
}

group('when something is wrong');
{
  KV = fakeD1();
  const a = await device(PHRASE_A, ADDR_A);
  a.set([tok('JURIS')]);
  DOWN = true;
  ok('no network: the pass fails quietly', (await a.sync()) === 'failed');
  ok('and the list on the device is untouched', a.list() === 'JURIS');
  DOWN = false;
  ok('the next pass sends it', (await a.sync()) === 'written');
  const key = Object.keys(KV.data)[0], rec = JSON.parse(KV.data[key]);
  KV.data[key] = JSON.stringify(Object.assign({}, rec, { d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
  const spoiled = KV.data[key];
  await tick();
  a.set([tok('TCO')]);
  ok('a record that does not open is not written over', (await a.sync()) === 'failed' && KV.data[key] === spoiled);
  ok('and does not empty the device', a.list() === 'TCO');
}

group('the Worker');
{
  KV = fakeD1();
  const id = 'ab'.repeat(32), token = 'cd'.repeat(32), u = 'https://sync.test/v1/doc/' + id;
  const put = (d, t = token, origin = ORIGIN, url = u, p) => call(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ d, p: p === undefined ? (KV.data['doc:' + id] ? JSON.parse(KV.data['doc:' + id]).t : 0) : p }) }, origin);
  ok('nothing kept yet: 404', (await call(u)).status === 404);
  ok('the first write is taken', (await put('AAAA')).status === 200);
  const got = await call(u);
  ok('and read back, for our origin', got.status === 200 && (await got.json()).d === 'AAAA' && got.headers.get('Access-Control-Allow-Origin') === ORIGIN);
  ok('another token cannot replace it', (await put('BBBB', 'ef'.repeat(32))).status === 403 && JSON.parse(KV.data['doc:' + id]).d === 'AAAA');
  ok('the same token can, naming the revision it read', (await put('BBBB', token, ORIGIN, u, JSON.parse(KV.data['doc:' + id]).t)).status === 200 && JSON.parse(KV.data['doc:' + id]).d === 'BBBB');
  const n = KV.puts;
  ok('writing the same text again spends no KV write', (await put('BBBB')).status === 200 && KV.puts === n);
  ok('only the token’s hash is kept', !KV.data['doc:' + id].includes(token));
  ok('a page on another site cannot write', (await put('CCCC', token, 'https://evil.example')).status === 403);
  ok('and is not given the CORS header', !(await call(u, {}, 'https://evil.example')).headers.get('Access-Control-Allow-Origin'));
  ok('no token: 401', (await call(u, { method: 'PUT', body: JSON.stringify({ d: 'AAAA' }) })).status === 401);
  ok('a record over the size limit is refused', (await put('A'.repeat(8196))).status >= 400);
  ok('so is one that is not base64', (await put('<script>')).status === 400);
  ok('a bad id is refused', (await call('https://sync.test/v1/doc/nothex')).status === 400);
  ok('any other path is 404', (await call('https://sync.test/v1/other')).status === 404);
  ok('the preflight answers for our origin', await (async () => { const r = await call(u, { method: 'OPTIONS' }); return r.status === 204 && /PUT/.test(r.headers.get('Access-Control-Allow-Methods')) && /Authorization/.test(r.headers.get('Access-Control-Allow-Headers')); })());
  ok('nothing else is allowed', (await call(u, { method: 'POST' })).status === 405);
}

group('the wiring');
{
  const fav = fs.readFileSync(path.join(SRC, 'fav.js'), 'utf8');
  ok('fav.js registers its list with sync.js', /syncSection\('fav',/.test(fav));
  ok('a pick, a removal and a reorder are all reported', (fav.match(/synced\('fav'\)/g) || []).length === 2 && /save\(favs\); synced\('fav'\);\n  try \{ const h = window\.Telegram/.test(fav));
  ok('a refreshed symbol or logo is not a change to send', /if \(changed\) save\(favs\);/.test(fav));
  ok('an embedded image is never sent', /\^\(https:\\\/\\\/\|assets\\\/\)/.test(fav));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('Settings has the sync row', html.includes('id="set-sync"') && html.includes('id="sync-cur"'));
  const sync = fs.readFileSync(path.join(SRC, 'sync.js'), 'utf8');
  ok('the keys are dropped when the wallet locks', /frontier:locked', \(\) => \{ K = null; \}/.test(sync));
  const hosts = fs.readFileSync(path.join(ROOT, 'sync-worker', 'worker.js'), 'utf8');
  ok('the Worker lets the web wallet and the Mini App in', hosts.includes("'https://wallet.delfos-hub.net'") && hosts.includes("'https://delfos-hub.github.io'"));
}


group('off by default, asked once, a deleted copy, a refused stale write, limits (Pablo, #56)');
{
  KV = fakeD1(); CALLS = 0;
  const fresh = await device(PHRASE_A, ADDR_A, { fresh: true });
  fresh.set([tok('JURIS')]);
  ok('a wallet that was never asked sends nothing', (await fresh.sync()) === 'off' && CALLS === 0);
  {
    const u = 'https://sync.test/v1/doc/' + 'ef'.repeat(32), tk = '12'.repeat(32);
    const w = (d, p) => call(u, { method: 'PUT', headers: { Authorization: 'Bearer ' + tk }, body: JSON.stringify({ d, p }) });
    ok('the first write names no revision', (await w('AAAA', 0)).status === 200);
    const t1 = JSON.parse(KV.data['doc:' + 'ef'.repeat(32)]).t;
    ok('a write made from an older read is refused with 409', (await w('BBBB', 0)).status === 409 && JSON.parse(KV.data['doc:' + 'ef'.repeat(32)]).d === 'AAAA');
    ok('the same write from the current revision is taken', (await w('BBBB', t1)).status === 200);
  }
  const a = await device(PHRASE_A, ADDR_A);
  a.set([tok('JURIS')]); await a.sync();
  const key = Object.keys(KV.data).find(k => k !== 'doc:' + 'ef'.repeat(32));
  a.ls['fw:sync'] = '0'; globalThis.localStorage = { getItem: k => (k in a.ls ? a.ls[k] : null), setItem: (k, v) => { a.ls[k] = String(v); }, removeItem: k => { delete a.ls[k]; } };
  ok('turning sync off deletes the server copy', (await a.m.forget(ADDR_A)) === 'deleted' && !KV.data[key]);
  a.ls['fw:sync:url'] = 'https://evil.example';
  a.ls['fw:sync'] = '1'; a.set([tok('LTK')]); await a.sync();
  ok('the server address cannot be changed outside localhost', LASTURL.indexOf('https://frontier-sync.delfoshub-team.workers.dev') === 0);
  LIMIT = { limit: async () => ({ success: false }) };
  const r = await call('https://sync.test/v1/doc/' + 'ab'.repeat(32), { method: 'PUT', headers: { Authorization: 'Bearer ' + 'cd'.repeat(32) }, body: JSON.stringify({ d: 'AAAA', p: 0 }) });
  ok('a client over the write limit gets 429 and spends no KV write', r.status === 429);
  ok('reads are limited too', (await call('https://sync.test/v1/doc/' + 'ab'.repeat(32))).status === 429);
  LIMIT = null;
  const fav = fs.readFileSync(path.join(SRC, 'fav.js'), 'utf8');
  ok('the first favorite asks once', /if \(i < 0\) offerSync\(\);/.test(fav));
  ok('while off, the wallet says the list stays on this device', /syncOn\(\) \? 'Up to 6, synced between your devices \(encrypted\)\.' : 'Up to 6, kept on this device\.'/.test(fav));
}


group('second review (Pablo, #56): picked while Off, a failed delete, the daily purge');
{
  KV = fakeD1();
  const a = await device(PHRASE_A, ADDR_A);
  a.set([tok('JURIS')]); await a.sync();
  const b = await device(PHRASE_A, ADDR_A, { fresh: true });
  b.set([tok('TCO'), tok('CLUB')]);
  ok('picked while Off: nothing sent', (await b.sync()) === 'off');
  b.ls['fw:sync'] = '1';
  await b.sync(); await a.sync();
  ok('turned on later: the lists are joined, not replaced', b.list() === 'JURIS,TCO,CLUB' && a.list() === 'JURIS,TCO,CLUB');
  await tick();
  b.set([tok('TCO')]); await b.sync(); await a.sync();
  ok('after the first meeting a removal still goes everywhere', a.list() === 'TCO');
  DOWN = true;
  globalThis.localStorage = { getItem: k => (k in a.ls ? a.ls[k] : null), setItem: (k, v) => { a.ls[k] = String(v); }, removeItem: k => { delete a.ls[k]; } };
  a.ls['fw:sync'] = '0';
  ok('a delete that fails is remembered', (await a.m.forget(ADDR_A)) === 'failed' && a.m.pendingDelete(ADDR_A));
  DOWN = false;
  await a.m.retryDelete();
  ok('and done at the next unlock', !a.m.pendingDelete(ADDR_A) && Object.keys(KV.data).length === 0);
  KV = fakeD1();
  const id = 'aa'.repeat(32);
  KV.data['doc:' + id] = JSON.stringify({ a: 'x', d: 'AAAA', t: Date.now() - 401 * 86400 * 1000 });
  KV.data['doc:' + 'bb'.repeat(32)] = JSON.stringify({ a: 'x', d: 'AAAA', t: Date.now() });
  let waited = null;
  await worker.scheduled({}, { DB: KV }, { waitUntil: p => { waited = p; } }); await waited;
  ok('the daily cron removes a record not written for 400 days, and keeps the others', !KV.data['doc:' + id] && KV.data['doc:' + 'bb'.repeat(32)]);
  const sync = fs.readFileSync(path.join(SRC, 'sync.js'), 'utf8');
  ok('the dialog says sync is turned off on each device', /turn sync off in Settings on each device/.test(sync));
}

report();
