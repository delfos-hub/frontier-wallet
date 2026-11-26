/* frontier-faucet - test LUNC on a test network (rebel-2) for the wallet's
   DEV tab (assets/js/dev.js).

     GET  /status?address=terra1...  -> what the faucet holds and pays, and
                                        when this address may claim next
     POST /claim   { address }       -> { hash }   sends AMOUNT uluna

   Limits, all in wrangler.jsonc vars: one claim per address every COOLDOWN_H
   hours, PER_CLIENT_DAY claims per client (IPv4, or IPv6 /64) a day, and
   DAILY_CAP uluna across everyone a day, so an address farm empties nothing
   faster than the cap. Claims are rate limited per client too (CLAIMS).
   A claim reserves its row before anything is signed (the check and the insert
   are one statement), so two claims at once cannot both pass; a send that
   fails gives the row back.

   The key: FAUCET_KEY is the faucet wallet's private key (64 hex), a secret,
   put there by key.mjs from the phrase typed into a hidden prompt. Not the
   phrase itself: deriving a key from it is 2048 rounds of PBKDF2, more CPU
   than a free Worker gets per request. The chain id signed is CHAIN, and a
   node that reports another one (columbus-5 above all) is refused.

   The transaction is built by hand like the wallet's (assets/js/tx.js), with
   the wallet's own vendor/crypto.js: no dependencies to install. */
import { base, bip32, ripemd160, sha256 } from '../vendor/crypto.js';

const ORIGINS = [
  'https://wallet.delfos-hub.net',
  'https://delfos-hub.github.io',
  'http://localhost:8080'
];
const GAS_PRICE = 28.325;
const GAS_SAFETY = 1.3;
const MAX_GAS = 400000;

/* ---------- protobuf (as assets/js/tx.js) ---------- */
const enc = new TextEncoder();
function varint(n){
  const out = []; let v = BigInt(n);
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; out.push(b); } while (v > 0n);
  return Uint8Array.from(out);
}
function cat(parts){
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
const tag = (num, type) => varint((num << 3) | type);
const fBytes = (num, b) => (b && b.length) ? cat([tag(num, 2), varint(b.length), b]) : new Uint8Array(0);
const fStr = (num, s) => (!s) ? new Uint8Array(0) : fBytes(num, enc.encode(s));
const fUint = (num, n) => (!n || n === '0') ? new Uint8Array(0) : cat([tag(num, 0), varint(n)]);
const coin = c => cat([fStr(1, c.denom), fStr(2, String(c.amount))]);
const any = (url, value) => cat([fStr(1, url), fBytes(2, value)]);
const msgSend = (from, to, coins) => cat([fStr(1, from), fStr(2, to), ...coins.map(c => fBytes(3, coin(c)))]);
// timeout_height (field 3): past that block the chain itself refuses the transaction
const txBody = (msgs, memo, timeout) => cat([...msgs.map(m => fBytes(1, m)), fStr(2, memo), fUint(3, timeout)]);
const pubKeyAny = key => any('/cosmos.crypto.secp256k1.PubKey', fBytes(1, key));
const signerInfo = (key, seq) => cat([fBytes(1, pubKeyAny(key)), fBytes(2, fBytes(1, cat([tag(1, 0), varint(1)]))), fUint(3, seq)]);
const feeMsg = (coins, gas) => cat([...coins.map(c => fBytes(1, coin(c))), fUint(2, gas)]);
const authInfo = (key, seq, coins, gas) => cat([fBytes(1, signerInfo(key, seq)), fBytes(2, feeMsg(coins, gas))]);
const signDoc = (body, auth, chain, accNum) => cat([fBytes(1, body), fBytes(2, auth), fStr(3, chain), fUint(4, accNum)]);
const txRaw = (body, auth, sigs) => cat([fBytes(1, body), fBytes(2, auth), ...sigs.map(s => fBytes(3, s))]);
const b64 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/* ---------- the faucet's key ---------- */
let KEY = null;
function keyOf(env){
  if (KEY && KEY.src === env.FAUCET_KEY) return KEY;
  const h = String(env.FAUCET_KEY || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('the faucet has no key');
  const priv = Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
  const node = new bip32.HDKey({ privateKey: priv });
  const addr = base.bech32.encode('terra', base.bech32.toWords(ripemd160(sha256(node.publicKey))));
  KEY = { src: env.FAUCET_KEY, node: node, pub: node.publicKey, addr: addr };
  return KEY;
}

// a terra1 account address with a valid checksum (20 bytes, or 32 for a contract)
function addressOk(a){
  if (typeof a !== 'string' || a.length > 90 || !/^terra1[02-9ac-hj-np-z]+$/.test(a)) return false;
  try {
    const d = base.bech32.decode(a);
    const n = base.bech32.fromWords(d.words).length;
    return d.prefix === 'terra' && (n === 20 || n === 32);
  } catch (e) { return false; }
}

/* ---------- the node ---------- */
async function lcd(env, path, body){
  const r = await fetch(env.LCD + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || ('node -> ' + r.status)); e.status = r.status; throw e; }
  return j;
}
// asked before every send, not remembered: a node moved to another chain
// must stop the faucet at once (its signature is for CHAIN either way)
async function checkChain(env){
  if (env.CHAIN === 'columbus-5') throw new Error('the faucet never runs on columbus-5');
  const j = await lcd(env, '/cosmos/base/tendermint/v1beta1/node_info');
  const net = (j.default_node_info || {}).network;
  if (net !== env.CHAIN) throw new Error('the node is on ' + net + ', not ' + env.CHAIN);
}
async function height(env){
  const j = await lcd(env, '/cosmos/base/tendermint/v1beta1/blocks/latest');
  const h = Number((((j.block || {}).header) || {}).height);
  if (!(h > 0)) throw new Error('the node gave no block height');
  return h;
}
async function faucetBalance(env, addr){
  const j = await lcd(env, '/cosmos/bank/v1beta1/balances/' + addr + '/by_denom?denom=uluna');
  return BigInt((j.balance || {}).amount || '0');
}

/* The send, in steps that tell the caller what is known:
   - every transaction carries a timeout height (TIMEOUT_BLOCKS past the
     current block): after it the chain refuses it, so a hash still unknown
     past that block can never be paid;
   - signed(hash, timeout) is awaited before every broadcast: the claim's row
     then names the transaction and its timeout before it can exist on chain;
   - a node that answers with a code refused it: nothing was sent;
   - a broadcast that fails without an answer (timeout, network) may still
     have gone through: the error carries unknown = true and the hash. */
async function send(env, to, amount, signed){
  const k = keyOf(env);
  await checkChain(env);
  let last;
  // two claims at once can take the same sequence; the second is rebuilt
  for (let i = 0; i < 3; i++) {
    const a = (await lcd(env, '/cosmos/auth/v1beta1/accounts/' + k.addr)).account || {};
    const timeout = (await height(env)) + Number(env.TIMEOUT_BLOCKS || 100);
    const body = txBody([any('/cosmos.bank.v1beta1.MsgSend', msgSend(k.addr, to, [{ denom: 'uluna', amount: amount }]))], 'Frontier faucet', timeout);
    const probe = authInfo(k.pub, a.sequence || '0', [{ denom: 'uluna', amount: '1000000' }], MAX_GAS);
    const sim = await lcd(env, '/cosmos/tx/v1beta1/simulate', { tx_bytes: b64(txRaw(body, probe, [new Uint8Array(64)])) });
    const used = Number((sim.gas_info || {}).gas_used);
    if (!(used > 0) || used > MAX_GAS) throw new Error('the node gave no usable gas figure');
    const gas = Math.ceil(used * GAS_SAFETY);
    const auth = authInfo(k.pub, a.sequence || '0', [{ denom: 'uluna', amount: String(Math.ceil(gas * GAS_PRICE)) }], gas);
    const sig = k.node.sign(sha256(signDoc(body, auth, env.CHAIN, a.account_number || '0')));
    const raw = txRaw(body, auth, [sig]);
    const hash = hex(sha256(raw)).toUpperCase();
    if (signed) await signed(hash, timeout);
    let res;
    try {
      res = (await lcd(env, '/cosmos/tx/v1beta1/txs', { tx_bytes: b64(raw), mode: 'BROADCAST_MODE_SYNC' })).tx_response || {};
    } catch (e) {
      // a 4xx with a message is the node saying no; anything else is silence
      if (e.status >= 400 && e.status < 500) throw e;
      e.unknown = true; e.hash = hash; e.timeout = timeout;
      throw e;
    }
    // taken into the node's mempool: not paid yet, only on its way
    if (!res.code) return { hash: hash, timeout: timeout };
    last = new Error('the node refused the send (code ' + res.code + '): ' + (res.raw_log || ''));
    if (!/sequence/i.test(res.raw_log || '')) break;
    await new Promise(z => setTimeout(z, 1500));
  }
  throw last;
}

/* ---------- HTTP ---------- */
function cors(origin){
  const h = { 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.indexOf(origin) >= 0) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status: status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origin)) });

// one key per client: the IPv4 address, an IPv4 written as IPv6, or the /64
function clientKey(request){
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip.indexOf(':') < 0) return ip;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1];
  const parts = ip.split('::'), h = parts[0] ? parts[0].split(':') : [];
  const t = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const full = parts.length > 1 ? h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t) : h;
  return full.slice(0, 4).map(x => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

const DAY = 24 * 3600 * 1000;
const conf = env => ({
  amount: String(env.AMOUNT || '20000000000'),
  cooldown: Number(env.COOLDOWN_H || 24) * 3600 * 1000,
  perClient: Number(env.PER_CLIENT_DAY || 3),
  cap: BigInt(env.DAILY_CAP || '2000000000000'),
  paused: String(env.PAUSED || '') === '1'
});

async function status(env, address){
  const c = conf(env), k = keyOf(env), now = Date.now();
  // the address's open claims are asked about first, so a send that failed in
  // its block frees the address here, with no second POST (#76 review)
  if (address) await reconcile(env, address, now).catch(() => {});
  const [bal, mine, day, open] = await Promise.all([
    faucetBalance(env, k.addr),
    address ? env.DB.prepare(UNRESOLVED_NOT + ' AND address = ?1').bind(address).first() : null,
    env.DB.prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS s FROM claims WHERE at > ?1').bind(now - DAY).first(),
    address ? env.DB.prepare("SELECT hash FROM claims WHERE address = ?1 AND (hash LIKE 'p:%' OR hash = '') ORDER BY at DESC LIMIT 1").bind(address).first() : null
  ]);
  // a claim whose outcome is not known yet: it blocks, whatever its age
  const pending = !!open;
  const pendingHash = pending && open.hash ? open.hash.slice(PENDING.length).split('@')[0] : '';
  const paid = BigInt((day && day.s) || 0);
  let why = '';
  if (c.paused) why = 'The faucet is paused for now.';
  else if (bal < BigInt(c.amount) + 10000000n) why = 'The faucet is empty for now; it is topped up by hand.';
  else if (paid + BigInt(c.amount) > c.cap) why = 'The faucet has paid out its daily limit; it opens again within a day.';
  return {
    chain: env.CHAIN, faucet: k.addr, balance: bal.toString(), amount: c.amount,
    cooldown_h: c.cooldown / 3600000,
    next: mine && mine.at ? mine.at + c.cooldown : 0,
    pending: pending, pending_hash: pendingHash,
    open: !why, why: why
  };
}

async function claim(env, request, origin){
  const c = conf(env);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'send JSON: { "address": "terra1..." }' }, 400, origin); }
  const to = String((body || {}).address || '').trim();
  if (!addressOk(to)) return json({ error: 'that is not a terra1 address' }, 400, origin);
  const k = keyOf(env);
  if (to === k.addr) return json({ error: 'that is the faucet itself' }, 400, origin);
  const st = await status(env, to);
  if (!st.open) return json({ error: st.why }, 503, origin);
  const now = Date.now(), ip = clientKey(request);
  await reconcile(env, to, now);
  // the reservation: inserted only if this address and this client are under
  // their limits and the day's cap holds, all in one statement
  const r = await env.DB.prepare(
    `INSERT INTO claims (address, client, at, amount, hash)
     SELECT ?1, ?2, ?3, ?4, ''
     WHERE NOT EXISTS (SELECT 1 FROM claims WHERE address = ?1 AND (at > ?3 - ?5 OR hash LIKE 'p:%' OR hash = ''))
       AND (SELECT COUNT(*) FROM claims WHERE client = ?2 AND at > ?3 - ?6) < ?7
       AND (SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) FROM claims WHERE at > ?3 - ?6) + CAST(?4 AS INTEGER) <= CAST(?8 AS INTEGER)`
  ).bind(to, ip, now, c.amount, c.cooldown, DAY, c.perClient, c.cap.toString()).run();
  if (!r.meta || !r.meta.changes) {
    if (st.pending) return json({ error: 'The last claim for this address is still waiting for its block' + (st.pending_hash ? ': ' + st.pending_hash : '') + '. It is checked again before another one.', hash: st.pending_hash, pending: true }, 429, origin);
    const again = st.next > now ? ' Next claim for this address in about ' + Math.ceil((st.next - now) / 3600000) + ' h.' : '';
    return json({ error: 'Not now: one claim per address a day, and a few per connection.' + again }, 429, origin);
  }
  const id = r.meta.last_row_id;
  // The row is the reservation, and it stays as long as a payment may exist:
  // 'p:HASH@TIMEOUT' before each broadcast, the bare hash only once the
  // transaction is in a block and succeeded. It goes only when nothing was
  // paid: refused by the node, failed in its block, or past its timeout
  // height and not on chain (#76 review).
  const mark = (h, t) => PENDING + h + '@' + t;
  let sent;
  try {
    sent = await send(env, to, c.amount, (h, t) => env.DB.prepare('UPDATE claims SET hash = ?1 WHERE id = ?2').bind(mark(h, t), id).run());
  } catch (e) {
    if (!e.unknown) {
      await env.DB.prepare('DELETE FROM claims WHERE id = ?1').bind(id).run().catch(() => {});
      return json({ error: 'The faucet could not send: ' + String(e.message || e).slice(0, 300) }, 502, origin);
    }
    return json({ error: 'The faucet sent, but the node did not confirm it. It is checked again before this address can claim: look for ' + e.hash + ' on the explorer.', hash: e.hash, pending: true }, 502, origin);
  }
  // accepted is not paid: wait a little for the block, then say what is known
  const until = Date.now() + Number(env.WAIT_MS == null ? 20000 : env.WAIT_MS);
  for (;;) {
    const o = await outcome(env, sent.hash, sent.timeout);
    if (o === 'paid') {
      // a failed write here leaves the pending mark, which the next claim reconciles
      await env.DB.prepare('UPDATE claims SET hash = ?1 WHERE id = ?2').bind(sent.hash, id).run().catch(() => {});
      return json({ hash: sent.hash, amount: c.amount }, 200, origin);
    }
    if (o === 'failed') {
      await env.DB.prepare('DELETE FROM claims WHERE id = ?1').bind(id).run().catch(() => {});
      return json({ error: 'The send failed in its block; nothing was paid. Try again.', hash: sent.hash }, 502, origin);
    }
    if (Date.now() >= until) break;
    await new Promise(z => setTimeout(z, Number(env.POLL_MS || 2500)));
  }
  return json({ hash: sent.hash, amount: c.amount, pending: true }, 202, origin);
}

/* What became of a transaction, from the chain: 'paid' (in a block, code 0),
   'failed' (in a block with an error, or not on chain once the chain is past
   its timeout height, after which it can never be included), or 'unknown'
   (not seen yet, or the node did not answer). */
async function outcome(env, hash, timeout){
  let tx = null;
  try { tx = (await lcd(env, '/cosmos/tx/v1beta1/txs/' + hash)).tx_response || null; }
  catch (e) { if (e.status !== 404 && e.status !== 400) return 'unknown'; }
  if (tx) return tx.code ? 'failed' : 'paid';
  if (!(timeout > 0)) return 'unknown';
  let h = 0;
  try { h = await height(env); } catch (e) { return 'unknown'; }
  if (h <= timeout) return 'unknown';
  // past the timeout: asked once more, so a block that just landed is not missed
  try { tx = (await lcd(env, '/cosmos/tx/v1beta1/txs/' + hash)).tx_response || null; }
  catch (e) { if (e.status !== 404 && e.status !== 400) return 'unknown'; }
  return tx ? (tx.code ? 'failed' : 'paid') : 'failed';
}

/* Claims whose outcome was not known ('p:HASH@TIMEOUT'), asked about before
   the same address may claim again: paid -> a normal paid claim; failed ->
   nothing was paid, the row goes; unknown -> it stays and keeps blocking the
   address. No clock releases a claim: only the chain's answer does. */
const PENDING = 'p:';
// paid claims only: the newest one sets the cooldown
const UNRESOLVED_NOT = "SELECT MAX(at) AS at FROM claims WHERE hash NOT LIKE 'p:%' AND hash <> ''";
// a reservation with no hash yet was never broadcast (the mark is written
// before any broadcast): one older than this is a claim that stopped half way
const UNSIGNED_MS = 5 * 60 * 1000;
async function reconcile(env, address, now){
  await env.DB.prepare("DELETE FROM claims WHERE address = ?1 AND hash = '' AND at < ?2").bind(address, (now || Date.now()) - UNSIGNED_MS).run();
  const rows = (await env.DB.prepare("SELECT id, at, hash FROM claims WHERE address = ?1 AND hash LIKE 'p:%'").bind(address).all()).results || [];
  for (const row of rows) {
    const [h, t] = row.hash.slice(PENDING.length).split('@');
    const o = await outcome(env, h, Number(t || 0));
    if (o === 'paid') await env.DB.prepare('UPDATE claims SET hash = ?1 WHERE id = ?2').bind(h, row.id).run();
    else if (o === 'failed') await env.DB.prepare('DELETE FROM claims WHERE id = ?1').bind(row.id).run();
  }
}

// rows older than a week are not needed for any limit
let PURGED = 0;
function purge(env, ctx){
  if (Date.now() - PURGED < 3600000) return;
  PURGED = Date.now();
  // an unresolved claim (pending, legacy 'p:HASH' included, or not yet signed)
  // is never purged: it goes only by its outcome
  ctx.waitUntil(env.DB.prepare("DELETE FROM claims WHERE at < ?1 AND hash NOT LIKE 'p:%' AND hash <> ''").bind(Date.now() - 7 * DAY).run().catch(() => {}));
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      purge(env, ctx);
      if (request.method === 'GET' && url.pathname === '/status') {
        const a = (url.searchParams.get('address') || '').trim();
        if (a && !addressOk(a)) return json({ error: 'that is not a terra1 address' }, 400, origin);
        return json(await status(env, a), 200, origin);
      }
      if (request.method === 'POST' && url.pathname === '/claim') {
        // claims come from the wallet's pages only; anyone may read /status
        if (ORIGINS.indexOf(origin) < 0) return json({ error: 'claims are made from the wallet' }, 403, origin);
        if (env.CLAIMS) {
          const lim = await env.CLAIMS.limit({ key: clientKey(request) });
          if (!lim.success) return json({ error: 'Too many tries; wait a minute.' }, 429, origin);
        }
        return await claim(env, request, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: String(e.message || e).slice(0, 300) }, 500, origin);
    }
  }
};

// for tests/faucet.mjs
export const __test = { send: send, claim: claim, status: status, reconcile: reconcile, outcome: outcome, purge: purge, PENDING: PENDING };
