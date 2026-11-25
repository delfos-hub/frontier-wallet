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
const NODE = { broadcast: 'ok', txs: {}, sent: 0 };
globalThis.fetch = async (url, init) => {
  const u = String(url).replace('http://lcd', '');
  const reply = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
  if (u.endsWith('/node_info')) return reply({ default_node_info: { network: 'rebel-2' } });
  if (u.includes('/balances/')) return reply({ balance: { amount: '900000000000' } });
  if (u.includes('/auth/v1beta1/accounts/')) return reply({ account: { account_number: '5', sequence: String(NODE.sent) } });
  if (u.endsWith('/tx/v1beta1/simulate')) return reply({ gas_info: { gas_used: '100000' } });
  if (u.endsWith('/tx/v1beta1/txs') && init && init.method === 'POST') {
    NODE.sent++;
    if (NODE.broadcast === 'timeout') throw new TypeError('fetch failed (test: no answer)');
    if (NODE.broadcast === 'refused') return reply({ tx_response: { code: 5, raw_log: 'insufficient funds' } });
    return reply({ tx_response: { code: 0 } });
  }
  const m = /\/tx\/v1beta1\/txs\/([0-9A-F]+)$/.exec(u);
  if (m) return NODE.txs[m[1]] ? reply({ tx_response: NODE.txs[m[1]] }) : reply({ message: 'tx not found' }, 404);
  return reply({ message: 'not stubbed: ' + u }, 500);
};

const ORIGIN = 'https://wallet.delfos-hub.net';
const TO = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
function env(db){
  return { DB: db, CHAIN: 'rebel-2', LCD: 'http://lcd', FAUCET_KEY: '11'.repeat(32), AMOUNT: '1000000000', COOLDOWN_H: '24', PER_CLIENT_DAY: '3' };
}
const req = (ip = '203.0.113.7') => new Request('https://faucet/claim', {
  method: 'POST', body: JSON.stringify({ address: TO }), headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip } });
const claim = async (e, ip) => { const r = await W.claim(e, req(ip), ORIGIN); return { status: r.status, body: await r.json() }; };
const rows = db => db.raw.prepare('SELECT id, at, hash FROM claims WHERE address = ?').all(TO);
const reset = () => { NODE.broadcast = 'ok'; NODE.txs = {}; NODE.sent = 0; };

console.log('faucet: one payment per claim');

// 1. paid, then the last write fails: the reservation stays and blocks a retry
{
  reset(); const db = d1(), e = env(db);
  db.breakWhen = (sql, a) => /^UPDATE/.test(sql) && !String(a[0]).startsWith(W.PENDING);
  const a = await claim(e);
  ok('a paid claim answers with its hash even when the last write fails', a.status === 200 && /^[0-9A-F]{64}$/.test(a.body.hash), JSON.stringify(a));
  const r = rows(db);
  ok('its row stays, marked pending with that hash', r.length === 1 && r[0].hash === W.PENDING + a.body.hash, JSON.stringify(r));
  db.breakWhen = null;
  const b = await claim(e, '198.51.100.9');
  ok('a second claim is refused, nothing broadcast again', b.status === 429 && NODE.sent === 1, JSON.stringify(b) + ' sent=' + NODE.sent);
  NODE.txs[a.body.hash] = { code: 0, height: '100' };
  await claim(e, '198.51.100.10');
  ok('once the node shows it paid, the row becomes a normal paid claim', rows(db)[0].hash === a.body.hash && NODE.sent === 1, JSON.stringify(rows(db)));
}

// 2. broadcast with no answer: pending, kept, and checked before anything else
{
  reset(); const db = d1(), e = env(db);
  NODE.broadcast = 'timeout';
  const a = await claim(e);
  ok('no answer from the node: 502 with the hash, marked pending', a.status === 502 && a.body.pending === true && /^[0-9A-F]{64}$/.test(a.body.hash), JSON.stringify(a));
  ok('the reservation is kept as pending', rows(db).length === 1 && rows(db)[0].hash === W.PENDING + a.body.hash);
  NODE.broadcast = 'ok';
  const b = await claim(e, '198.51.100.9');
  ok('a retry while the node does not know the hash yet pays nothing', b.status === 429 && NODE.sent === 1, JSON.stringify(b) + ' sent=' + NODE.sent);
  // it never landed: well past the settling time the row goes, a claim pays again
  db.raw.prepare('UPDATE claims SET at = at - ? WHERE address = ?').run(11 * 60 * 1000, TO);
  const c = await claim(e, '198.51.100.10');
  ok('a transaction the node never saw frees the address after it settles', c.status === 200 && NODE.sent === 2, JSON.stringify(c));
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
  ok('a send that failed on chain frees the claim at once', b.status === 200 && NODE.sent === 2, JSON.stringify(b));
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
