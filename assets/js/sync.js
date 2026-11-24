/* sync.js - the same small settings on every device that holds this wallet.

   Favorites picked on the web wallet used to stay there: the Mini App and the
   web wallet are different sites, and each keeps its own storage. Now a
   module can register a "section" (fav.js does), and its value follows the
   wallet: it is encrypted here and kept by the frontier-sync Worker
   (sync-worker/ in this repo), and read back by any other Frontier client
   that has the same recovery phrase.

   What leaves the device: ciphertext, under a name that is itself derived
   from the phrase. Three values come out of the account key through
   HKDF-SHA256 (one way, the key cannot be worked back from them):
     id     where the record is kept (a name, not the address)
     token  what the Worker asks for before it lets the record be replaced
     key    AES-GCM, never sent anywhere
   The Worker sees neither the address nor which tokens are in the list; the
   text is padded to whole kilobytes so its length says little either.

   A watched address has no phrase, so nothing of it is synced. The whole
   thing can be turned off in Settings (fw:sync = 0), and the local copy is
   always the one the screen is drawn from: no network, no difference.

   Merging is per section, the newer change wins (fw:sync:t:<name>:<addr> is
   when this device last changed it). A device that has a list from before
   this module existed has no such time: its list is joined with the kept
   one once, instead of one silently replacing the other. */
import { S } from './state.js?v=b8620ca2';

const HOST = 'https://frontier-sync.delfoshub-team.workers.dev';
const SALT = 'frontier-sync-v1';
const PAD = 1024;
const SECTIONS = {};
const enc = new TextEncoder(), dec = new TextDecoder();

// another server only when testing on this machine
function base(){
  try {
    const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    return ((local && localStorage.getItem('fw:sync:url')) || HOST).replace(/\/+$/, '');
  } catch (e) { return HOST; }
}
// Off unless the user turned it on: nothing leaves the device by default
function enabled(){
  try { return localStorage.getItem('fw:sync') === '1'; } catch (e) { return false; }
}
function asked(){
  try { return localStorage.getItem('fw:sync') !== null; } catch (e) { return true; }
}
const current = () => (S.SAVED && S.SAVED.addr) || '';
const tKey = (name, addr) => 'fw:sync:t:' + name + ':' + addr;
function tGet(name, addr){
  try { const v = Number(localStorage.getItem(tKey(name, addr))); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
}
function tSet(name, addr, t){ try { localStorage.setItem(tKey(name, addr), String(t)); } catch (e) {} }
// this device's list has met the kept one for this wallet once (joined, not replaced)
const jKey = (name, addr) => 'fw:sync:j:' + name + ':' + addr;
function joined(name, addr){ try { return localStorage.getItem(jKey(name, addr)) === '1'; } catch (e) { return false; } }
function markJoined(names, addr){ names.forEach(n => { try { localStorage.setItem(jKey(n, addr), '1'); } catch (e) {} }); }

/* ---------------- keys and the envelope ---------------- */
const hex = u8 => Array.from(u8).map(b => (b < 16 ? '0' : '') + b.toString(16)).join('');
function b64(u8){
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s){
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// the three values, from the account's private key (32 bytes)
async function deriveKeys(priv){
  const ikm = await crypto.subtle.importKey('raw', priv, 'HKDF', false, ['deriveBits']);
  const bits = async info => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) }, ikm, 256));
  const [id, token, raw] = await Promise.all([bits('id'), bits('write'), bits('enc')]);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { id: hex(id), token: hex(token), key: key };
}

async function seal(key, obj){
  let text = JSON.stringify(obj);
  text += ' '.repeat((PAD - (enc.encode(text).length % PAD)) % PAD);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0); out.set(ct, 12);
  return b64(out);
}
async function unseal(key, s){
  const raw = unb64(s);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  return JSON.parse(dec.decode(pt));
}

// Kept only while the wallet is unlocked, and only for the wallet it was
// made from: a lock or a switch drops it (frontier:locked below).
let K = null;
async function keysFor(addr){
  if (K && K.addr === addr) return K;
  const w = S.SAVED;
  if (!w || w.watch || w.addr !== addr || !S.MNEMONIC) return null;
  const phrase = S.MNEMONIC;
  const m = await import('../../vendor/crypto.js');
  const seed = await m.bip39.mnemonicToSeed(phrase);
  const node = m.bip32.HDKey.fromMasterSeed(seed).derive("m/44'/330'/0'/0/0");
  const k = await deriveKeys(node.privateKey);
  // the wallet may have been locked or switched while this was being worked out
  if (S.MNEMONIC !== phrase || current() !== addr) return null;
  K = Object.assign({ addr: addr }, k);
  return K;
}

/* ---------------- one pass: read, merge, write if this device is ahead ---------------- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function pass(addr, again){
  if (!enabled() || !addr || !Object.keys(SECTIONS).length) return 'off';
  const k = await keysFor(addr);
  if (!k) return 'no key';
  LAST = Date.now();

  let kept = null, exists = false, rev = 0;
  const r = await fetch(base() + '/v1/doc/' + k.id, { cache: 'no-store' });
  if (r.status === 200) {
    // a record that does not open is left alone: writing over it would lose
    // what another device put there
    const got = await r.json();
    kept = await unseal(k.key, got.d);
    rev = Number(got.t) || 0;
    exists = true;
  } else if (r.status !== 404) throw new Error('sync read ' + r.status);
  if (current() !== addr) return 'switched';

  const theirs = (kept && kept.s && typeof kept.s === 'object') ? kept.s : {};
  // sections this version does not know are carried over untouched
  const out = Object.assign({}, theirs);
  let push = false;
  const joins = [];                        // marked joined once this pass succeeds
  for (const name in SECTIONS) {
    const h = SECTIONS[name];
    const mine = h.read(addr), mineT = tGet(name, addr);
    const rem = theirs[name] && typeof theirs[name].t === 'number' ? theirs[name] : null;
    if (!rem) {
      if (!h.empty(mine) || (exists && mineT)) {
        const t = mineT || Date.now();
        tSet(name, addr, t); out[name] = { t: t, v: mine }; push = true;
        joins.push(name);
      }
      continue;
    }
    const remV = h.clean(rem.v);
    if (!joined(name, addr)) {
      // the first meeting with the kept list (a list from before sync, or
      // picked while sync was Off): joined once, not replaced (Pablo, #56)
      joins.push(name);
      const both = h.merge(mine, remV);
      if (same(both, remV)) {
        if (!same(mine, remV)) h.write(addr, remV);
        tSet(name, addr, rem.t);
      } else {
        const t = Math.max(Date.now(), rem.t + 1);
        h.write(addr, both); tSet(name, addr, t);
        out[name] = { t: t, v: both }; push = true;
      }
    } else if (rem.t > mineT) {
      if (!same(mine, remV)) h.write(addr, remV);
      tSet(name, addr, rem.t);
    } else if (mineT > rem.t) {
      out[name] = { t: mineT, v: mine }; push = true;
    }
  }
  if (!push) { markJoined(joins, addr); return 'read'; }
  // turned off, locked or switched while this pass was reading: no write
  const body = JSON.stringify({ d: await seal(k.key, { v: 1, s: out }), p: rev });
  if (!enabled() || current() !== addr || !K) return 'stopped';

  const w = await fetch(base() + '/v1/doc/' + k.id, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + k.token, 'Content-Type': 'application/json' },
    body: body
  });
  // another device wrote since this pass read: read, merge and write again, once
  if (w.status === 409 && !again) return pass(addr, true);
  if (!w.ok) throw new Error('sync write ' + w.status);
  markJoined(joins, addr);
  return 'written';
}

// one pass at a time; a failed one (no network, the Worker down) is silent:
// the local list is what the screen shows either way
let QUEUE = Promise.resolve(), TIMER = 0, LAST = 0;
function syncNow(){
  const addr = current();
  QUEUE = QUEUE.then(() => pass(addr)).catch(e => {
    try { if (localStorage.getItem('fw:debug') === '1') console.info('[sync]', e && e.message ? e.message : e); } catch (x) {}
    return 'failed';
  });
  return QUEUE;
}

// Turning sync off deletes the server copy (needs the open wallet's key)
// A delete that fails (offline, 429) is remembered for the wallet and tried
// again at its next unlock (Pablo, #56).
const delKey = addr => 'fw:sync:del:' + addr;
async function forget(addr){
  try { localStorage.setItem(delKey(addr), '1'); } catch (e) {}
  // its next turn-on meets the kept list as a first meeting again: joined
  unjoin(addr);
  const k = await keysFor(addr);
  if (!k) return 'no key';
  let r = null;
  try { r = await fetch(base() + '/v1/doc/' + k.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + k.token } }); } catch (e) {}
  if (!r || !r.ok) return 'failed';
  try { localStorage.removeItem(delKey(addr)); } catch (e) {}
  return 'deleted';
}
// A wallet removed from this device takes its data with it: the server copy
// when its key is at hand (the open wallet), and every per-address entry kept
// here, except GRAM trades. A server copy left behind is sealed and is purged
// once it goes stale.
async function dropWallet(addr){
  if (!addr) return 'none';
  let synced = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('fw:sync:j:') && k.endsWith(':' + addr)) { synced = true; break; }
    }
  } catch (e) {}
  const r = synced ? await forget(addr) : 'none';
  if (K && K.addr === addr) K = null;
  const gone = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      // GRAM trades stay: a buy in flight keeps its HTLC secret and its
      // refund screen there, and importing the phrase again brings it back
      if (k.startsWith('fw:') && !k.startsWith('fw:gram:') && k.indexOf(addr) !== -1) gone.push(k);
    }
    gone.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  return r;
}
function unjoin(addr){
  for (const n in SECTIONS) { try { localStorage.removeItem(jKey(n, addr)); } catch (e) {} }
}
// Off on this device: every wallet synced here (it has a joined marker) gets
// its markers cleared and its server copy deleted, the open one now, the
// others at their next unlock, since their keys are needed (Pablo, #56).
function offAll(){
  const others = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), m = /^fw:sync:j:[^:]+:(.+)$/.exec(k || '');
      if (m) others.add(m[1]);
    }
  } catch (e) {}
  const a = current();
  others.delete(a);
  others.forEach(o => { try { localStorage.setItem(delKey(o), '1'); } catch (e) {} unjoin(o); });
  if (a) QUEUE = QUEUE.then(() => forget(a)).catch(() => 'failed');
  return QUEUE;
}
function pendingDelete(addr){
  try { return localStorage.getItem(delKey(addr)) === '1'; } catch (e) { return false; }
}
function retryDelete(){
  const a = current();
  if (!a || enabled() || !pendingDelete(a)) return QUEUE;
  QUEUE = QUEUE.then(() => forget(a)).catch(() => 'failed');
  return QUEUE;
}

/* ---------------- asking once ---------------- */
// At the first favorite, once per browser: what sync sends and what the
// server sees, with Turn on / Not now (Pablo, #56). Never for a watched address.
function offer(){
  if (asked() || !current() || (S.SAVED && S.SAVED.watch) || typeof document === 'undefined') return;
  if (document.getElementById('sync-ask')) return;
  const box = document.createElement('div');
  box.id = 'sync-ask'; box.className = 'sync-ask';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'sync-ask-t');
  box.innerHTML = '<div class="sync-ask-in"><b id="sync-ask-t">Sync favorites to your other devices?</b>' +
    '<p>Your favorites list is encrypted on this device and kept on the Delfos sync server, so the other Frontier apps with this recovery phrase show it too.</p>' +
    '<p>The server sees your IP address and an anonymous id, never your address, your keys or which tokens you picked. To stop, turn sync off in Settings on each device; that deletes the server copy.</p>' +
    '<div class="sync-ask-act"><button class="btn" type="button" data-a="0">Not now</button><button class="btn solid" type="button" data-a="1">Turn on</button></div></div>';
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    try { localStorage.setItem('fw:sync', b.dataset.a); } catch (x) {}
    box.remove(); paint();
    document.dispatchEvent(new CustomEvent('frontier:sync'));
    if (enabled()) syncNow();
  });
  document.body.appendChild(box);
  const yes = box.querySelector('[data-a="1"]'); if (yes) yes.focus();
}

/* ---------------- what the other modules call ---------------- */
// h: read(addr) -> value, write(addr, value), clean(value) -> value,
//    empty(value) -> bool, merge(mine, theirs) -> value
function section(name, h){ SECTIONS[name] = h; }

// this device has just changed the section for the open wallet
function changed(name){
  const addr = current();
  if (!addr) return;
  tSet(name, addr, Math.max(Date.now(), tGet(name, addr) + 1));
  clearTimeout(TIMER);
  TIMER = setTimeout(syncNow, 1200);
}

/* ---------------- wiring ---------------- */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('frontier:wallet', () => { retryDelete(); syncNow(); });
  document.addEventListener('frontier:locked', () => { K = null; });
  // coming back to the page: what another device changed meanwhile
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && current() && Date.now() - LAST > 60 * 1000) syncNow();
  });

  // Settings > App > Sync favorites
  const row = document.getElementById('set-sync');
  paint();
  if (row) row.addEventListener('click', () => {
    const was = enabled();
    try { localStorage.setItem('fw:sync', was ? '0' : '1'); } catch (e) {}
    paint();
    document.dispatchEvent(new CustomEvent('frontier:sync'));
    if (was) offAll();
    else { try { localStorage.removeItem(delKey(current())); } catch (e) {} syncNow(); }
  });
}
function paint(){
  const cur = typeof document !== 'undefined' && document.getElementById && document.getElementById('sync-cur');
  if (cur) cur.textContent = enabled() ? 'On' : 'Off';
}

export { changed, deriveKeys, dropWallet, enabled as syncOn, forget, offAll, offer, pendingDelete, retryDelete, seal, section, syncNow, unseal };
