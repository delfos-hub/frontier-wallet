/* What changed in a seller's P2P orders between two reads (pure, tested).
   prev / cur: { id: { rem, total, askTotal, fee, exp, offer, ask } }
   closed: ids this wallet cancelled or reclaimed itself.
   Returns events: { kind: 'partial' | 'filled' | 'gone', id, sold, soldTotal,
   total, received, order }.
   - 'partial' / 'filled': the order is still listed and its remaining fell;
   - 'gone': it is no longer listed and this wallet did not close it. It may
     have been bought out, cancelled from another device or the web widget,
     or reclaimed after its expiry or an asset's delisting cutoff (which can
     come before expires_at): the caller looks up the closing tx to tell. */
export function diffOrders(prev, cur, closed){
  const out = [];
  const recv = (o, sold) => o.askTotal * sold / o.total * (10000n - BigInt(o.fee || 0)) / 10000n;
  for (const id of Object.keys(prev)) {
    const p = prev[id], c = cur[id];
    if (c) {
      if (c.rem < p.rem) {
        const sold = p.rem - c.rem;
        out.push({ kind: c.rem === 0n ? 'filled' : 'partial', id, sold, soldTotal: c.total - c.rem, total: c.total,
                   received: recv(c, sold), order: c });
      }
    } else if (!closed.has(String(id)) && p.rem > 0n) {
      out.push({ kind: 'gone', id, sold: p.rem, soldTotal: p.total, total: p.total, received: recv(p, p.rem), order: p });
    }
  }
  return out;
}
