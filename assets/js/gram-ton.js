/* Reading a GRAM swap lock on TON, in the browser, with no TON library.

   The maker checks a taker's TON lock itself before locking any LUNC (spec,
   step 4): the Worker's word is not enough. That needs two things the
   wallet has no library for, so they are here, small and tested against
   @ton/core: the hash of the lock's code (to know it runs the audited
   contract) and the addresses in the get-method's answer.

   Bag-of-cells (BOC) layout and the cell hash follow the TON spec
   (tvm.pdf 3.1.4-3.1.5, boc.tlb): only ordinary cells, which is all the
   lock's code and its answers contain; anything else is refused. */

const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hexOf = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

// cells of a BOC, root first: { d1, d2, data (as stored, with its completion
// bit), refs: [index], bits }
function parseBoc(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const uN = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p++]; return v; };
  if (hexOf(bytes.slice(0, 4)) !== 'b5ee9c72') throw new Error('not a BOC');
  p = 4;
  const f = u8();
  const hasIdx = !!(f & 0x80), hasCrc = !!(f & 0x40), size = f & 7;
  const off = u8();
  const count = uN(size), roots = uN(size), absent = uN(size);
  uN(off);                                         // total size of the cells
  if (roots !== 1 || absent !== 0) throw new Error('unexpected BOC shape');
  const root = uN(size);
  if (hasIdx) p += count * off;
  const cells = [];
  for (let i = 0; i < count; i++) {
    const d1 = u8(), d2 = u8();
    const nrefs = d1 & 7, exotic = !!(d1 & 8), level = d1 >> 5;
    if (exotic || level) throw new Error('exotic cells are not expected here');
    const len = Math.ceil(d2 / 2);
    const data = bytes.slice(p, p + len); p += len;
    const refs = []; for (let r = 0; r < nrefs; r++) refs.push(uN(size));
    let bits = len * 8;
    if (d2 & 1) {                                  // last byte holds a completion tag
      const last = data[len - 1];
      let z = 0; while (z < 8 && !((last >> z) & 1)) z++;
      bits -= z + 1;
    }
    cells.push({ d1, d2, data, refs, bits });
  }
  if (hasCrc) p += 4;
  return { cells, root };
}

// representation hash of an ordinary cell: sha256(d1 d2 data depths hashes)
async function cellHash(boc) {
  const { cells, root } = parseBoc(boc);
  const hash = new Array(cells.length), depth = new Array(cells.length);
  for (let i = cells.length - 1; i >= 0; i--) {    // refs always point forward
    const c = cells[i];
    const parts = [c.d1, c.d2, ...c.data];
    for (const r of c.refs) parts.push(depth[r] >> 8, depth[r] & 255);
    const buf = new Uint8Array(parts.length + 32 * c.refs.length);
    buf.set(parts);
    c.refs.forEach((r, k) => buf.set(hash[r], parts.length + 32 * k));
    hash[i] = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    depth[i] = c.refs.length ? 1 + Math.max(...c.refs.map(r => depth[r])) : 0;
  }
  return hexOf(hash[root]).toUpperCase();
}

// an internal address (addr_std, no anycast) at the start of a slice -> "0:<hex>"
function addressOf(boc) {
  const { cells, root } = parseBoc(boc);
  const c = cells[root];
  const bit = i => (c.data[i >> 3] >> (7 - (i & 7))) & 1;
  const read = (from, n) => { let v = 0n; for (let i = 0; i < n; i++) v = (v << 1n) | BigInt(bit(from + i)); return v; };
  if (c.bits < 267 || read(0, 2) !== 2n || read(2, 1) !== 0n) throw new Error('not a standard address');
  let wc = Number(read(3, 8)); if (wc > 127) wc -= 256;
  return wc + ':' + read(11, 256).toString(16).padStart(64, '0');
}

// a user-friendly TON address (48 base64url chars) or raw "0:<hex>" -> raw
function rawOf(a) {
  a = String(a).trim();
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(a)) return a.toLowerCase();
  const b = b64bytes(a.replace(/-/g, '+').replace(/_/g, '/'));
  if (b.length !== 36) throw new Error('not a TON address');
  const wc = b[1] > 127 ? b[1] - 256 : b[1];
  return wc + ':' + hexOf(b.slice(2, 34));
}

const STATUS = ['unfunded', 'open', 'claimed', 'refunded'];

// The lock at `address`, read through toncenter's v2 API (the same reads the
// offers Worker makes). Only if it runs `codeHash` are its terms trusted.
async function readLock(api, address, codeHash, apiKey) {
  const headers = apiKey ? { 'X-API-Key': apiKey } : {};
  const go = async (path, init) => {
    for (let i = 0; ; i++) {                       // toncenter: 1 request/s without a key
      const r = await fetch(api + path, Object.assign({ headers: headers }, init || {}));
      if (r.status === 429 && i < 4) { await new Promise(z => setTimeout(z, 1200 * (i + 1))); continue; }
      const j = await r.json();
      if (!j.ok) throw new Error('TON API: ' + (j.error || r.status));
      return j.result;
    }
  };
  const info = await go('/getAddressInformation?address=' + encodeURIComponent(address));
  if (info.state !== 'active' || !info.code) return { state: info.state || 'none' };
  if (await cellHash(b64bytes(info.code)) !== String(codeHash).toUpperCase()) return { state: 'active', foreignCode: true };
  await new Promise(z => setTimeout(z, 1100));
  const run = await go('/runGetMethod', {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: JSON.stringify({ address: address, method: 'lock', stack: [] })
  });
  if (run.exit_code !== 0) throw new Error('the lock did not answer');
  const s = run.stack;
  const num = i => BigInt(s[i][1]);
  const adr = i => addressOf(b64bytes(s[i][1].bytes));
  return {
    state: 'active', balance: BigInt(info.balance || 0),
    status: STATUS[Number(num(0))],
    hash: num(1).toString(16).padStart(64, '0'),
    amount: num(2), timeout: Number(num(3)),
    recipient: adr(4), refundTo: adr(5), tip: num(6), relayer: adr(7),
    takerRef: s[8] ? num(8).toString(16).padStart(64, '0') : null
  };
}

// taker_ref the lock must carry for this take: sha256("terra|offer|uluna")
async function takeRefOf(takerTerra, offerId, lunc) {
  const b = new TextEncoder().encode(takerTerra + '|' + offerId + '|' + BigInt(lunc));
  return hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', b)));
}

export { readLock, takeRefOf, rawOf, cellHash, addressOf, parseBoc };
