/* DEV tab: a check (simulation) is bound to the wallet and the network it ran
   for (#76 review). dev.js keeps one per form; here is what makes it safe:

   - bound(p) stamps a check with the wallet, a copy of the network and a key
     of both; signing uses that wallet and that copy, never the live ones;
   - fresh(p) lets a check be signed only while its key is still the active
     one: a switch of wallet, chain, node or gas settings refuses it;
   - simulate(run) throws a result away if the key changed while it ran.

   No DOM and no imports: tests/devcheck.mjs runs it in Node. */

export const STALE = 'the wallet or the network changed since the check: check again';

export function checks(get){
  const key = () => { const g = get(); return [g.addr, g.net.chain, g.net.lcd, g.net.gasPrice, g.net.gasAdjust].join('|'); };
  return {
    key: key,
    bound(o){
      const g = get();
      return Object.assign(o, { ctx: key(), from: g.addr, net: Object.assign({}, g.net) });
    },
    fresh(p){
      if (!p || p.ctx !== key()) throw new Error(STALE);
      return p;
    },
    async simulate(run){
      const c0 = key(), g = get();
      const res = await run(g.addr, Object.assign({}, g.net));
      if (key() !== c0) throw new Error(STALE);
      return res;
    }
  };
}

// What a sent transaction's wait() came back with, as the line under it:
// a block only when the node has shown one; otherwise the hash stays and the
// line says the confirmation is pending.
export function blockLine(res, link){
  if (res && res.height) return { ok: true, html: 'In block ' + Number(res.height).toLocaleString('en-US') + '.' };
  return { ok: false, html: 'Confirmation pending: not seen in a block yet. Look it up later · ' + link };
}
