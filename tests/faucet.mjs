/* The faucet Worker (faucet-worker/worker.js): a claim is paid at most once.

   The claim's row in D1 is the reservation. It must outlive every moment in
   which a payment may exist: a broadcast with no answer, or a paid send
   whose last D1 write failed, keeps it, and the next claim of the address
   first asks the node what became of that transaction (#76 review).

   D1 is played by an in-memory SQLite (node:sqlite) loaded with the real
   schema.sql; the node is a stub answering the few paths the Worker reads.

       node tests/faucet.mjs
*/
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

let sqlite;
try { sqlite = await import('node:sqlite'); }
catch (e) { console.log('faucet: node:sqlite is not in this Node, skipped\n0 passed, 0 failed'); process.exit(0); }

const { __test: W } = await import(pathToFileURL(path.resolve('faucet-worker/worker.js')).href);

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more ? '\n       ' + more : '')); }
}

/* ---- D1 on SQLite, with a switch to make chosen writes fail ---- */
function d1(){
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve('faucet-worker/schema.sql'), 'utf8'));
  const api = {
    raw: db,
    breakWhen: null,                     // (sql, args) => true makes that write throw
    prepare(sql){
      let args = [];
      const st = {
        bind(...a){ args = a; return st; },
        async run(){
          if (api.breakWhen && api.breakWhen(sql, args)) throw new Error('D1 write refused (test)');
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
        async first(){ return db.prepare(sql).get(...args) || null; },
        async all(){ return { results: db.prepare(sql).all(...args) }; }
      };
      return st;
    }
  };
  return api;
}

/* ---- the node ---- */
const NODE = { broadcast: 'ok', txs: {}, sent: 0, height: 1000, onBroadcast: null, last: '' };
globalThis.fetch = async (url, init) => {
  const u = String(url).replace('http://lcd', '');
  const reply = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
  if (u.endsWith('/node_info')) return reply({ default_node_info: { network: 'rebel-2' } });
  if (u.endsWith('/blocks/latest')) return reply({ block: { header: { height: String(NODE.height) } } });
  if (u.includes('/balances/')) return reply({ balance: { amount: '900000000000' } });
  if (u.includes('/auth/v1beta1/accounts/')) return reply({ account: { account_number: '5', sequence: String(NODE.sent) } });
  if (u.endsWith('/tx/v1beta1/simulate')) return reply({ gas_info: { gas_used: '100000' } });
  if (u.endsWith('/tx/v1beta1/txs') && init && init.method === 'POST') {
    NODE.sent++;
    if (NODE.broadcast === 'timeout') throw new TypeError('fetch failed (test: no answer)');
    if (NODE.broadcast === 'refused') return reply({ tx_response: { code: 5, raw_log: 'insufficient funds' } });
    // accepted into the mempool; what the block does with it is up to the test
    if (NODE.onBroadcast) NODE.onBroadcast();
    return reply({ tx_response: { code: 0 } });
  }
  const m = /\/tx\/v1beta1\/txs\/([0-9A-F]+)$/.exec(u);
  if (m) return NODE.txs[m[1]] ? reply({ tx_response: NODE.txs[m[1]] }) : reply({ message: 'tx not found' }, 404);
  return reply({ message: 'not stubbed: ' + u }, 500);
};

const ORIGIN = 'https://wallet.delfos-hub.net';
const TO = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
function env(db){
  return { DB: db, CHAIN: 'rebel-2', LCD: 'http://lcd', FAUCET_KEY: '11'.repeat(32), AMOUNT: '1000000000', COOLDOWN_H: '24', PER_CLIENT_DAY: '3',
           WAIT_MS: '0', POLL_MS: '1', TIMEOUT_BLOCKS: '100' };
}
// the hash a claim's pending row names, and the block it times out at
const markOf = db => { const r = rows(db)[0]; return r ? r.hash.slice(W.PENDING.length).split('@') : []; };
// the next broadcast lands in a block with this result (code 0 paid, else failed)
const req = (ip = '203.0.113.7') => new Request('https://faucet/claim', {
  method: 'POST', body: JSON.stringify({ address: TO }), headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip } });
const claim = async (e, ip) => { const r = await W.claim(e, req(ip), ORIGIN); return { status: r.status, body: await r.json() }; };
const rows = db => db.raw.prepare('SELECT id, at, hash FROM claims WHERE address = ?').all(TO);
const reset = () => { NODE.broadcast = 'ok'; NODE.txs = {}; NODE.sent = 0; NODE.height = 1000; NODE.onBroadcast = null; };

console.log('faucet: one payment per claim');

// 1. accepted, in a block and paid, then the last write fails: the
// reservation stays pending and blocks a retry until reconciled as paid
{
  reset(); const db = d1(), e = env(db);
  NODE.onBroadcast = () => { NODE.landNext = { code: 0, height: '1001' }; };
  db.breakWhen = (sql, a) => /^UPDATE/.test(sql) && !String(a[0]).startsWith(W.PENDING);
  // the stub shows a broadcast transaction in a block as soon as it is asked
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const m = /\/tx\/v1beta1\/txs\/([0-9A-F]+)$/.exec(String(url));
    if (m && NODE.landNext && !NODE.txs[m[1]]) { NODE.txs[m[1]] = NODE.landNext; NODE.landNext = null; }
    return origFetch(url, init);
  };
  const a = await claim(e);
  ok('in a block and paid: 200 with its hash even when the last write fails', a.status === 200 && /^[0-9A-F]{64}$/.test(a.body.hash), JSON.stringify(a));
  const r = rows(db);
  ok('its row stays, marked pending with that hash and its timeout height', r.length === 1 && r[0].hash === W.PENDING + a.body.hash + '@1100', JSON.stringify(r));
  db.breakWhen = null;
  const b = await claim(e, '198.51.100.9');
  ok('a second claim finds it paid: refused, nothing broadcast again, the row now a normal paid claim',
     b.status === 429 && NODE.sent === 1 && rows(db)[0].hash === a.body.hash, JSON.stringify(b) + ' ' + JSON.stringify(rows(db)));
  globalThis.fetch = origFetch;
}

// 1b. accepted by the node, then failed in its block: not paid, row released
{
  reset(); const db = d1(), e = env(db);
  const a = await claim(e);
  ok('accepted but not in a block yet: 202 pending, not paid', a.status === 202 && a.body.pending === true, JSON.stringify(a));
  ok('the row is still pending, not a paid claim', rows(db).length === 1 && rows(db)[0].hash.startsWith(W.PENDING));
  const b = await claim(e, '198.51.100.9');
  ok('a claim while it waits for a block pays nothing', b.status === 429 && NODE.sent === 1, JSON.stringify(b));
  NODE.txs[a.body.hash] = { code: 11, height: '1003', raw_log: 'out of gas' };
  const c = await claim(e, '198.51.100.10');
  ok('it failed in its block: the address is free and a new claim is sent', c.status === 202 && NODE.sent === 2, JSON.stringify(c));
}

// 1c. delayed inclusion: still not on chain, well past ten minutes, but its
// timeout height not yet passed: the claim stays pending; then it lands paid
{
  reset(); const db = d1(), e = env(db);
  const a = await claim(e);
  const [h, t] = markOf(db);
  ok('the transaction carries a timeout height 100 blocks on', h === a.body.hash && t === '1100', h + '@' + t);
  db.raw.prepare('UPDATE claims SET at = at - ? WHERE address = ?').run(60 * 60 * 1000, TO);   // an hour later, cooldown still on
  NODE.height = 1100;
  await W.reconcile(e, TO, Date.now());
  ok('an hour later, not seen, at its timeout block: still pending, not released', rows(db).length === 1 && rows(db)[0].hash.startsWith(W.PENDING), JSON.stringify(rows(db)));
  NODE.txs[a.body.hash] = { code: 0, height: '1100' };
  await W.reconcile(e, TO, Date.now());
  ok('it lands late and paid: a normal paid claim', rows(db)[0].hash === a.body.hash, JSON.stringify(rows(db)));
}

// 1d. never included: released only once the chain is past its timeout height
{
  reset(); const db = d1(), e = env(db);
  await claim(e);
  NODE.height = 1101;
  await W.reconcile(e, TO, Date.now());
  ok('past its timeout height and not on chain: it can never be paid, the row goes', rows(db).length === 0, JSON.stringify(rows(db)));
}

// 1e. accepted, then failed in its block while the claim still waits: 502, no row
{
  reset(); const db = d1(), e = Object.assign(env(db), { WAIT_MS: '50' });
  const origFetch = globalThis.fetch;
  let asks = 0;
  globalThis.fetch = async (url, init) => {
    const m = /\/tx\/v1beta1\/txs\/([0-9A-F]+)$/.exec(String(url));
    if (m && ++asks === 2) NODE.txs[m[1]] = { code: 11, height: '1001', raw_log: 'out of gas' };   // in the block a moment later
    return origFetch(url, init);
  };
  const a = await claim(e);
  ok('failed in its block during the wait: 502, nothing paid, the reservation gone', a.status === 502 && !a.body.pending && rows(db).length === 0, JSON.stringify(a));
  globalThis.fetch = origFetch;
}

// 2. broadcast with no answer: pending, kept, and checked before anything else
{
  reset(); const db = d1(), e = env(db);
  NODE.broadcast = 'timeout';
  const a = await claim(e);
  ok('no answer from the node: 502 with the hash, marked pending', a.status === 502 && a.body.pending === true && /^[0-9A-F]{64}$/.test(a.body.hash), JSON.stringify(a));
  ok('the reservation is kept as pending', rows(db).length === 1 && rows(db)[0].hash.startsWith(W.PENDING + a.body.hash + '@'));
  NODE.broadcast = 'ok';
  const b = await claim(e, '198.51.100.9');
  ok('a retry while the node does not know the hash yet pays nothing', b.status === 429 && NODE.sent === 1, JSON.stringify(b) + ' sent=' + NODE.sent);
  db.raw.prepare('UPDATE claims SET at = at - ? WHERE address = ?').run(11 * 60 * 1000, TO);
  const c0 = await claim(e, '198.51.100.11');
  ok('ten minutes alone release nothing: still refused', c0.status === 429 && NODE.sent === 1, JSON.stringify(c0));
  NODE.height = 1200;
  const c = await claim(e, '198.51.100.10');
  ok('past its timeout height and never seen: the address is free again', c.status === 202 && NODE.sent === 2, JSON.stringify(c));
}

// 3. no answer, but it did land: reconciled as paid, the cooldown holds
{
  reset(); const db = d1(), e = env(db);
  NODE.broadcast = 'timeout';
  const a = await claim(e);
  NODE.txs[a.body.hash] = { code: 0, height: '7' };
  NODE.broadcast = 'ok';
  const b = await claim(e, '198.51.100.9');
  ok('a landed send found by its hash counts as the paid claim', b.status === 429 && NODE.sent === 1 && rows(db)[0].hash === a.body.hash, JSON.stringify(rows(db)));
}

// 4. landed but failed on chain: nothing was paid, the address may claim
{
  reset(); const db = d1(), e = env(db);
  NODE.broadcast = 'timeout';
  const a = await claim(e);
  NODE.txs[a.body.hash] = { code: 11, height: '7' };
  NODE.broadcast = 'ok';
  const b = await claim(e, '198.51.100.9');
  ok('a send that failed on chain frees the claim at once', b.status === 202 && NODE.sent === 2, JSON.stringify(b));
}

// 5. the node refuses: nothing sent, the reservation goes
{
  reset(); const db = d1(), e = env(db);
  NODE.broadcast = 'refused';
  const a = await claim(e);
  ok('a refused send answers 502 and keeps no row', a.status === 502 && !a.body.pending && rows(db).length === 0, JSON.stringify(a));
}

// 6. the write before the broadcast fails: nothing is broadcast, no row stays
{
  reset(); const db = d1(), e = env(db);
  db.breakWhen = (sql, a) => /^UPDATE/.test(sql) && String(a[0]).startsWith(W.PENDING);
  const a = await claim(e);
  ok('no pending mark, no broadcast', a.status === 502 && NODE.sent === 0 && rows(db).length === 0, JSON.stringify(a) + ' sent=' + NODE.sent);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
