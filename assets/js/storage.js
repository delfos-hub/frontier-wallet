import { $, report, tg } from './shell.js?v=781756b7';
import { S } from './state.js?v=781756b7';

/* ---------------- storage ----------------
   The encrypted key is kept on this device only, in the best place the client
   offers: the iOS Keychain / Android Keystore (SecureStorage, 8.0), else
   Telegram's storage on the device (DeviceStorage, 9.0), else this page's own
   storage. Being device local, a new phone or a reinstall means the recovery
   phrase is the only way back - that is why the backup step is not optional.

   Telegram's CloudStorage is never written: it is kept on Telegram's servers,
   and an encrypted key that leaves the phone can be attacked offline. Earlier
   versions fell back to it on clients without SecureStorage (and on desktop
   clients that refuse SecureStorage); such a copy is moved to this device on
   the next open and then deleted from the cloud (load below).
------------------------------------------- */
const KEY = 'frontier_wallet_v1';
const Store = (() => {
  let mem = null, kind = 'memory', api = null, rung = 0;
  const atLeast = v => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));
  // best first; each entry gives the store or null when this client has none
  const LADDER = [
    ['secure', () => (tg && tg.SecureStorage && atLeast('8.0')) ? tg.SecureStorage : null],
    ['device', () => (tg && tg.DeviceStorage && atLeast('9.0')) ? tg.DeviceStorage : null]
  ];
  function pick(from){
    for (let i = from; i < LADDER.length; i++) {
      const s = LADDER[i][1]();
      if (s) { rung = i; kind = LADDER[i][0]; api = s; return; }
    }
    rung = LADDER.length; kind = 'local'; api = null;
  }
  pick(0);
  const callOn = (target, fn, ...args) => new Promise((res, rej) => {
    try { fn.call(target, ...args, (err, val) => err ? rej(err) : res(val)); }
    catch (e) { rej(e); }
  });

  // Presence is not support. Telegram Desktop hands out a SecureStorage object
  // and a version high enough to pass any check, then answers UNSUPPORTED when
  // you use it - because the thing behind it is a phone's keychain. So when a
  // store refuses, we move to the next one rather than report and stop.
  function stepDown(){
    if (kind === 'local' || kind === 'memory') return false;
    pick(rung + 1);
    return true;
  }

  // what the store in use holds. Copies elsewhere (a lower rung, the page's
  // storage, the cloud) are not read here: load() moves them into this store
  // first, so a copy is only ever dropped once this store holds it (audit F06).
  async function readHere(){
    if (api) {
      try {
        const v = await callOn(api, api.getItem, KEY);
        if (v) return v;
        return mem;
      } catch (e) { stepDown(); return readHere(); }
    }
    if (kind === 'local') {
      try {
        const v = localStorage.getItem(KEY);
        if (v) return v;
      } catch (e) {}
    }
    return mem;
  }

  // Every other place a copy may sit: the rungs below the one in use (a key
  // kept in DeviceStorage before SecureStorage started to work), the page's
  // own storage, and Telegram's cloud (an older version's copy). Read once a
  // session by load(), and all of them emptied by clear().
  const cloud = () => (tg && tg.CloudStorage && atLeast('6.9')) ? tg.CloudStorage : null;
  function elsewhere(){
    const out = [];
    const tgStore = s => ({
      read: async () => { try { return (await callOn(s, s.getItem, KEY)) || null; } catch (e) { return null; } },
      drop: () => callOn(s, s.removeItem, KEY)
    });
    for (let i = rung + 1; i < LADDER.length; i++) { const s = LADDER[i][1](); if (s) out.push(tgStore(s)); }
    if (kind !== 'local') out.push({
      read: async () => { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } },
      drop: async () => localStorage.removeItem(KEY)
    });
    const c = cloud();
    if (c) out.push(tgStore(c));
    return out;
  }
  const dropQuietly = async o => { try { await o.drop(); } catch (e) {} };
  let swept = false;

  const store = {
    get kind(){ return kind; },
    // true when v was kept on this device; false when only memory holds it
    // (private mode, a full quota), which does not survive a reload
    async save(v){
      // one attempt per rung of the ladder at most
      for (let i = 0; i <= LADDER.length; i++) {
        if (api) {
          try { await callOn(api, api.setItem, KEY, v); return true; }
          catch (e) { if (!stepDown()) break; continue; }
        }
        if (kind === 'local') {
          try { localStorage.setItem(KEY, v); return true; }
          catch (e) { /* private mode or a full quota - memory is what is left */ }
        }
        break;
      }
      mem = v;
      kind = 'memory'; api = null;           // what the screen shows: nothing survives a reload
      return false;
    },
    async load(){
      let v = await readHere();
      if (!swept) {
        swept = true;
        for (const o of elsewhere()) {
          const c = await o.read();
          const dropCopy = () => dropQuietly(o);
          if (c) {
            if (!v) {
              // move it here, and drop the other copy only once it is kept here
              // and reads back: if this store cannot keep it, the other copy is
              // the only one that survives a reload, so it stays
              const kept = await store.save(c);
              if (kept && (await readHere()) === c) await dropCopy();
              v = c;
            } else if (c === v) {
              await dropCopy();                    // the same book: nothing to keep
            } else {
              // What is kept is the whole wallet book, and the other copy may
              // hold wallets made on another Telegram client (a desktop that
              // refused SecureStorage). Its wallets the device lacks are added,
              // by address; the other copy goes only once the merged book is
              // kept here and reads back. Anything unreadable stays where it is.
              const merged = mergeBooks(v, c);
              if (merged === v) await dropCopy();
              else if (merged) {
                const kept = await store.save(merged);
                if (kept && (await readHere()) === merged) await dropCopy();
                v = merged;
              }
            }
          }
        }
      }
      return v;
    },
    // Every copy this client can reach, not only the store in use: a copy
    // left in another one came back on the next open (audit F06). True when
    // every removal went through.
    async clear(){
      let all = true;
      const drop = async f => { try { await f(); } catch (e) { all = false; } };
      for (const o of elsewhere()) await drop(o.drop);
      if (api) await drop(() => callOn(api, api.removeItem, KEY));
      if (kind === 'local') await drop(async () => localStorage.removeItem(KEY));
      mem = null;
      return all;
    }
  };
  return store;
})();

// The device's book with the other book's wallets it lacks (by address)
// added; the device's active wallet stays active. Returns the device's own
// string when nothing is added, null when either cannot be read.
function mergeBooks(deviceRaw, otherRaw){
  const a = parseBook(deviceRaw), b = parseBook(otherRaw);
  if (!a || !b) return null;
  const have = {}, ids = {};
  a.list.forEach(w => { have[w.addr] = 1; ids[w.id] = 1; });
  const add = b.list.filter(w => w && w.addr && !have[w.addr]);
  if (!add.length) return deviceRaw;
  add.forEach(w => {
    const e = Object.assign({}, w);
    if (!e.id || ids[e.id]) e.id = newId();
    ids[e.id] = 1;
    a.list.push(e);
  });
  return JSON.stringify(a);
}

const short = a => a.slice(0, 11) + '\u2026' + a.slice(-6);

function showStore(){
  const el = $('#store-kind');
  if (!el) return;
  const label = Store.kind === 'secure' ? 'device keychain'
              : Store.kind === 'device' ? 'Telegram storage on this device'
              : Store.kind === 'local' ? 'this device\u2019s browser storage'
              : 'memory only, nothing is saved';
  el.innerHTML = 'stored in <b>' + label + '</b>';
  el.classList.toggle('weak', Store.kind !== 'secure');

  const rt = $('#rt');
  if (rt) {
    const w = window.Telegram;
    rt.textContent = !w
      ? 'window.Telegram absent - plain browser, or telegram-web-app.js failed to load'
      : !w.WebApp
        ? 'window.Telegram exists but WebApp does not'
        : 'WebApp ' + (w.WebApp.version || '?') + ' / ' + (w.WebApp.platform || '?') +
          ' | initData ' + ((w.WebApp.initData || '').length) +
          ' | Secure ' + (w.WebApp.SecureStorage ? 'y' : 'n') +
          ' | Cloud ' + (w.WebApp.CloudStorage ? 'y' : 'n') +
          ' | Device ' + (w.WebApp.DeviceStorage ? 'y' : 'n') +
          ' | store=' + Store.kind;
  }
}

/* ---------------- the wallet book ----------------
   Several wallets on one device, each with its own encrypted phrase and its
   own PIN, plus read-only "watch" addresses with no key at all. One of them
   is active; S.SAVED is always that one, so every module that reads
   S.SAVED.addr or S.SAVED.blob keeps working unchanged.

   Stored as { v:2, active, list:[{ id, name, addr, blob? , watch? }] } under
   the same key as before. A wallet saved by an earlier version is a bare
   { addr, blob }; it is read as a book of one, named "Main", and written back
   in the new shape on the next save - nothing to do for the person. */
let BOOK = null;

function parseBook(raw){
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (d && d.v === 2 && Array.isArray(d.list)) return d;
  if (d && d.addr) return { v: 2, active: 'w1', list: [{ id: 'w1', name: 'Main', addr: d.addr, blob: d.blob }] };
  return null;
}
const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const activeEntry = () => BOOK && (BOOK.list.filter(w => w.id === BOOK.active)[0] || BOOK.list[0]) || null;

async function persist(){
  try {
    if (BOOK && BOOK.list.length) {
      if (!(await Store.save(JSON.stringify(BOOK)))) report('save', new Error('kept in memory only, it will not survive a reload'));
    } else if (!(await Store.clear())) report('save', new Error('a copy of the wallets could not be removed'));
  } catch (e) { report('save', e); }
  showStore();
}

function useActive(){
  const w = activeEntry();
  S.SAVED = w ? (w.watch ? { addr: w.addr, watch: true, name: w.name, id: w.id }
                         : { addr: w.addr, blob: w.blob, name: w.name, id: w.id }) : null;
  const ua = $('#unlock-addr');
  if (ua && w) ua.textContent = w.name + ' \u00b7 ' + short(w.addr);
  return S.SAVED;
}

async function loadBook(){
  BOOK = parseBook(await Store.load());
  return useActive();
}

function nextName(watch){
  const n = BOOK ? BOOK.list.filter(w => !!w.watch === !!watch).length : 0;
  return watch ? 'Watch ' + (n + 1) : (n ? 'Wallet ' + (n + 1) : 'Main');
}

// a wallet with a key: created, imported, or unlocked again
async function saveWallet(addr, blob){
  if (!BOOK) BOOK = { v: 2, active: '', list: [] };
  let w = BOOK.list.filter(x => x.addr === addr && !x.watch)[0];
  if (!w) {
    // a watched address that now gets its phrase becomes a full wallet
    const watched = BOOK.list.filter(x => x.addr === addr && x.watch)[0];
    if (watched) { w = watched; delete w.watch; }
    else { w = { id: newId(), name: nextName(false), addr: addr }; BOOK.list.push(w); }
  }
  w.blob = blob;
  BOOK.active = w.id;
  useActive();
  await persist();
}

async function addWatch(addr){
  if (!BOOK) BOOK = { v: 2, active: '', list: [] };
  let w = BOOK.list.filter(x => x.addr === addr)[0];
  if (!w) { w = { id: newId(), name: nextName(true), addr: addr, watch: true }; BOOK.list.push(w); }
  BOOK.active = w.id;
  useActive();
  await persist();
  return w;
}

async function setActive(id){
  if (!BOOK || !BOOK.list.some(w => w.id === id)) return null;
  BOOK.active = id;
  const w = useActive();
  await persist();
  return w;
}

async function renameWallet(id, name){
  const w = BOOK && BOOK.list.filter(x => x.id === id)[0];
  if (!w) return;
  w.name = String(name || '').trim().slice(0, 24) || w.name;
  if (BOOK.active === id) useActive();
  await persist();
}

// removes one wallet; the next one becomes active, or none is left
async function removeWallet(id){
  if (!BOOK) return null;
  BOOK.list = BOOK.list.filter(w => w.id !== id);
  if (BOOK.active === id) BOOK.active = BOOK.list[0] ? BOOK.list[0].id : '';
  const w = useActive();
  await persist();
  return w;
}

async function clearBook(){
  BOOK = null; S.SAVED = null;
  if (!(await Store.clear())) report('clear', new Error('a copy of the wallets could not be removed'));
}
const wallets = () => (BOOK ? BOOK.list.slice() : []);
const activeId = () => (BOOK ? BOOK.active : '');

async function decryptSeed(blob, pin){
  const u8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
  const enc = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:u8(blob.salt), iterations:blob.iter, hash:'SHA-256' },
    km, { name:'AES-GCM', length:256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:u8(blob.iv) }, key, u8(blob.ct));
  return new TextDecoder().decode(pt);
}

export { Store, activeId, addWatch, clearBook, decryptSeed, loadBook, parseBook, removeWallet, renameWallet, saveWallet, setActive, short, showStore, wallets };
