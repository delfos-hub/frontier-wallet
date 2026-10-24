/* Building a GRAM swap lock on TON, in the browser, with no TON library.

   The buyer's side of the swap: the wallet makes the lock's initial data
   from the terms, puts it with the audited code into a StateInit, and takes
   the lock's address from its hash. TON Connect then sends the GRAM there
   with that StateInit and a "lock" body. Everything here mirrors
   contracts/htlc-swap-ton/lib.mjs (lockData, lockAddress, lockValue, body)
   and is tested against @ton/core with the real lock code.

   Cells: ordinary only. BOC: one root, no index, with a CRC32-C, as
   @ton/core writes it. */

const hexOf = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
const b64of = u => btoa(String.fromCharCode.apply(null, Array.from(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ---------- cells ---------- */
class Cell {
  constructor(bits, refs) { this.bits = bits; this.refs = refs || []; this._h = null; }
  get nbytes() { return Math.ceil(this.bits.length / 8); }
  // data bytes with the completion tag when the bit length is not whole bytes
  dataBytes() {
    const n = this.bits.length, out = new Uint8Array(Math.ceil(n / 8));
    for (let i = 0; i < n; i++) if (this.bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
    if (n % 8) out[n >> 3] |= 0x80 >> (n % 8);
    return out;
  }
  descriptors() { return [this.refs.length, Math.floor(this.bits.length / 8) + Math.ceil(this.bits.length / 8)]; }
  depth() { return this.refs.length ? 1 + Math.max(...this.refs.map(r => r.depth())) : 0; }
  async hash() {
    if (this._h) return this._h;
    const [d1, d2] = this.descriptors(), data = this.dataBytes();
    const hs = [];
    for (const r of this.refs) hs.push(await r.hash());
    const buf = new Uint8Array(2 + data.length + 2 * this.refs.length + 32 * this.refs.length);
    buf[0] = d1; buf[1] = d2; buf.set(data, 2);
    let p = 2 + data.length;
    for (const r of this.refs) { const d = r.depth(); buf[p++] = d >> 8; buf[p++] = d & 255; }
    for (const h of hs) { buf.set(h, p); p += 32; }
    this._h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return this._h;
  }
}

class Builder {
  constructor() { this.bits = []; this.refs = []; }
  bit(b) { this.bits.push(b ? 1 : 0); return this; }
  uint(v, n) { v = BigInt(v); for (let i = n - 1; i >= 0; i--) this.bits.push(Number((v >> BigInt(i)) & 1n)); return this; }
  int(v, n) { v = BigInt(v); if (v < 0n) v += 1n << BigInt(n); return this.uint(v, n); }
  // VarUInteger 16: 4-bit byte length, then the value
  coins(v) {
    v = BigInt(v);
    if (v === 0n) return this.uint(0, 4);
    const len = Math.ceil(v.toString(16).length / 2);
    return this.uint(len, 4).uint(v, len * 8);
  }
  // MsgAddressInt addr_std, no anycast; null = addr_none
  address(raw) {
    if (raw === null) return this.uint(0, 2);
    const [wc, h] = raw.split(':');
    return this.uint(2, 2).bit(0).int(Number(wc), 8).uint(BigInt('0x' + h), 256);
  }
  ref(c) { this.refs.push(c); return this; }
  maybeRef(c) { if (c) { this.bit(1); this.refs.push(c); } else this.bit(0); return this; }
  end() {
    if (this.bits.length > 1023 || this.refs.length > 4) throw new Error('cell overflow');
    return new Cell(this.bits, this.refs);
  }
}

// a BOC (one root) back into Cells, so the audited code can go into a StateInit
function fromBoc(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const uN = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p++]; return v; };
  if (hexOf(bytes.slice(0, 4)) !== 'b5ee9c72') throw new Error('not a BOC');
  p = 4;
  const f = u8(), hasIdx = !!(f & 0x80), size = f & 7, off = u8();
  const count = uN(size), roots = uN(size); uN(size); uN(off);
  if (roots !== 1) throw new Error('one root expected');
  const root = uN(size);
  if (hasIdx) p += count * off;
  const raw = [];
  for (let i = 0; i < count; i++) {
    const d1 = u8(), d2 = u8();
    if (d1 & 8 || d1 >> 5) throw new Error('exotic cells are not expected here');
    const len = Math.ceil(d2 / 2), data = bytes.slice(p, p + len); p += len;
    const refs = []; for (let r = 0; r < (d1 & 7); r++) refs.push(uN(size));
    let n = len * 8;
    if (d2 & 1) { const last = data[len - 1]; let z = 0; while (z < 8 && !((last >> z) & 1)) z++; n -= z + 1; }
    const bits = []; for (let i2 = 0; i2 < n; i2++) bits.push((data[i2 >> 3] >> (7 - (i2 & 7))) & 1);
    raw.push({ bits: bits, refs: refs });
  }
  const cells = new Array(count);
  for (let i = count - 1; i >= 0; i--) cells[i] = new Cell(raw[i].bits, raw[i].refs.map(r => cells[r]));
  return cells[root];
}

// CRC32-C (Castagnoli), as in a BOC's trailer
const CRC_T = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82F63B78 : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32c(u) { let c = 0xFFFFFFFF; for (const b of u) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function toBoc(root) {
  // every distinct cell once, parents before children (refs point forward)
  const order = [], index = new Map();
  (function visit(c) {
    if (index.has(c)) return;
    index.set(c, -1);
    c.refs.forEach(visit);
    order.push(c);
  })(root);
  order.reverse();
  order.forEach((c, i) => index.set(c, i));
  const size = Math.max(1, Math.ceil(Math.log2(order.length + 1) / 8));
  const body = [];
  for (const c of order) {
    const [d1, d2] = c.descriptors();
    body.push(d1, d2, ...c.dataBytes());
    for (const r of c.refs) for (let k = size - 1; k >= 0; k--) body.push((index.get(r) >> (8 * k)) & 255);
  }
  const off = Math.max(1, Math.ceil(Math.log2(body.length + 1) / 8));
  const head = [0xb5, 0xee, 0x9c, 0x72, 0x40 | size, off];
  const num = (v, n) => { for (let k = n - 1; k >= 0; k--) head.push((v / 2 ** (8 * k)) & 255); };
  num(order.length, size); num(1, size); num(0, size); num(body.length, off); num(0, size);
  const all = new Uint8Array(head.length + body.length + 4);
  all.set(head); all.set(body, head.length);
  const crc = crc32c(all.subarray(0, head.length + body.length));
  all.set([crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, crc >>> 24], head.length + body.length);
  return all;
}

/* ---------- addresses ---------- */
function crc16(u) {
  let c = 0;
  for (const b of u) { c ^= b << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c;
}
// raw "0:<hex>" -> user-friendly (base64url), bounceable or not, testnet flag
function friendly(raw, { bounceable = true, testOnly = false } = {}) {
  const [wc, h] = raw.split(':');
  const b = new Uint8Array(36);
  b[0] = (bounceable ? 0x11 : 0x51) | (testOnly ? 0x80 : 0);
  b[1] = Number(wc) & 255;
  for (let i = 0; i < 32; i++) b[2 + i] = parseInt(h.substr(2 * i, 2), 16);
  const c = crc16(b.subarray(0, 34)); b[34] = c >> 8; b[35] = c & 255;
  return b64of(b).replace(/\+/g, '-').replace(/\//g, '_');
}

/* ---------- the lock ---------- */
const OP_LOCK = 0x6c6f636b;
const RESERVE = 50000000n;            // 0.05 GRAM, as lib.mjs RESERVE

// terms: { hash (hex), amount, tip, timeout, takerRef (hex), recipient, refundTo, relayer } - addresses raw
function lockData(t) {
  const parties = new Builder().address(t.recipient).address(t.refundTo).address(t.relayer || t.refundTo).end();
  return new Builder().uint(0, 8).uint(BigInt('0x' + t.hash), 256).coins(t.amount).coins(t.tip || 0n)
    .uint(t.timeout, 32).uint(BigInt('0x' + (t.takerRef || '0')), 256).ref(parties).maybeRef(null).end();
}
// StateInit: no split_depth, no special, code, data, no library
const stateInit = (code, data) => new Builder().bit(0).bit(0).maybeRef(code).maybeRef(data).bit(0).end();

async function buildLock(codeBoc64, terms, { testOnly = false } = {}) {
  const code = fromBoc(unb64(codeBoc64));
  const init = stateInit(code, lockData(terms));
  const raw = '0:' + hexOf(await init.hash());
  return {
    raw: raw,
    address: friendly(raw, { bounceable: true, testOnly: testOnly }),
    value: BigInt(terms.amount) + BigInt(terms.tip || 0n) + RESERVE,
    stateInit: b64of(toBoc(init)),
    payload: b64of(toBoc(new Builder().uint(OP_LOCK, 32).end())),
    codeHash: hexOf(await code.hash()).toUpperCase()
  };
}

// An external message to the lock (free for the sender, the lock pays its
// own gas): refund after the timeout. Anyone may send it; the GRAM always
// goes back to the lock's refund address. ext_in_msg_info$10, src addr_none,
// no import fee, no StateInit, body inline.
const OP_REFUND = 0x72656675;
function refundMessage(lockRaw) {
  const cell = new Builder().uint(2, 2).uint(0, 2).address(lockRaw).coins(0n).bit(0).bit(0).uint(OP_REFUND, 32).end();
  return b64of(toBoc(cell));
}

export { buildLock, refundMessage, friendly, toBoc, fromBoc, Builder, Cell, RESERVE };
