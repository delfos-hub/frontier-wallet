/* frontier-sync - keeps one small encrypted record per wallet, so settings
   picked in one Frontier client (the favorites, to begin with) show up in the
   others: the web wallet, the Mini App, later the extension.

   What this Worker can see: nothing about the wallet. The record's name is a
   hash derived from the recovery phrase, the body is AES-GCM ciphertext made
   in the browser, and neither the address nor the key ever comes here.

     GET /v1/doc/<id>   -> { d: "<base64>", t: <ms> }   or 404
     PUT /v1/doc/<id>   Authorization: Bearer <token>, body { d: "<base64>" }

   <id> and <token> are 64 hex characters, both derived from the phrase. The
   first PUT binds the record to its token (only the token's hash is kept);
   later PUTs with another token are refused, so knowing an id is not enough
   to overwrite it. Reading needs only the id and returns ciphertext.

     DELETE /v1/doc/<id> Authorization: Bearer <token>   (sync turned off)

   A PUT names the revision it read (p: the record's t, 0 for none); if the
   record changed since, it is refused with 409 and the client reads, merges
   and writes again, so two devices never overwrite each other unseen.

   Storage is Workers KV (binding SYNC). The free plan allows 1,000 writes a
   day for the whole account, so writes are rate limited per client (WRITES,
   reads by READS) and a PUT that would change nothing is answered without
   writing. */

const ORIGINS = [
  'https://wallet.delfos-hub.net',
  'https://delfos-hub.github.io',
  'http://localhost:8080'
];
const HEX64 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_DOC = 8192;                    // base64 characters
const TTL = 400 * 24 * 3600;             // a record nobody writes for 400 days goes

function cors(origin){
  const h = { 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.indexOf(origin) >= 0) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, PUT, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
function json(body, status, origin){
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origin))
  });
}
async function sha256hex(s){
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  let out = '';
  for (let i = 0; i < d.length; i++) out += (d[i] < 16 ? '0' : '') + d[i].toString(16);
  return out;
}

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
async function limited(binding, request){
  if (!binding) return false;
  try { const r = await binding.limit({ key: clientKey(request) }); return !r.success; } catch (e) { return false; }
}

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const m = /^\/v1\/doc\/([^/]+)$/.exec(url.pathname);
    if (!m) return json({ error: 'not found' }, 404, origin);
    const id = m[1];
    if (!HEX64.test(id)) return json({ error: 'bad id' }, 400, origin);
    const key = 'doc:' + id;

    if (request.method === 'GET') {
      if (await limited(env.READS, request)) return json({ error: 'too many requests' }, 429, origin);
      const rec = await env.SYNC.get(key, 'json');
      if (!rec || typeof rec.d !== 'string') return json({ error: 'no record' }, 404, origin);
      return json({ d: rec.d, t: rec.t || 0 }, 200, origin);
    }

    if (request.method === 'PUT') {
      // a browser always names its origin on a cross-site PUT; only ours write
      if (ORIGINS.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);
      const auth = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
      if (!auth) return json({ error: 'no token' }, 401, origin);
      if (await limited(env.WRITES, request)) return json({ error: 'too many requests' }, 429, origin);
      const raw = await request.text();
      if (raw.length > MAX_DOC + 64) return json({ error: 'too large' }, 413, origin);
      let body = null;
      try { body = JSON.parse(raw); } catch (e) {}
      const d = body && body.d;
      if (typeof d !== 'string' || !d.length || d.length > MAX_DOC || !B64.test(d)) return json({ error: 'bad body' }, 400, origin);

      const a = await sha256hex(auth[1]);
      const rec = await env.SYNC.get(key, 'json');
      if (rec && rec.a !== a) return json({ error: 'wrong token' }, 403, origin);
      // the revision this write was made from: changed since, read again
      if (rec && Number(body.p) !== Number(rec.t || 0)) return json({ error: 'changed', t: rec.t || 0 }, 409, origin);
      if (rec && rec.d === d) return json({ ok: true, t: rec.t || 0, same: true }, 200, origin);
      const t = Date.now();
      await env.SYNC.put(key, JSON.stringify({ a: a, d: d, t: t }), { expirationTtl: TTL });
      return json({ ok: true, t: t }, 200, origin);
    }

    if (request.method === 'DELETE') {
      if (ORIGINS.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);
      const auth = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
      if (!auth) return json({ error: 'no token' }, 401, origin);
      if (await limited(env.WRITES, request)) return json({ error: 'too many requests' }, 429, origin);
      const rec = await env.SYNC.get(key, 'json');
      if (!rec) return json({ ok: true, gone: true }, 200, origin);
      if (rec.a !== await sha256hex(auth[1])) return json({ error: 'wrong token' }, 403, origin);
      await env.SYNC.delete(key);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  }
};
