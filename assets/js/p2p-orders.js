/* What changed in a seller's P2P orders between two reads (pure, tested).
   prev / cur: { id: { rem, total, askTotal, fee, exp, offer, ask } }
   closed: ids this wallet cancelled or reclaimed itself.
   Returns events: { kind: 'partial' | 'filled', id, sold, soldTotal, total,
   received, order }. An order that vanished is "filled" unless this wallet
   closed it or it had expired (then nobody bought it). */
export function diffOrders(prev, cur, closed, now){
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
    } else if (!closed.has(String(id)) && now < p.exp && p.rem > 0n) {
      out.push({ kind: 'filled', id, sold: p.rem, soldTotal: p.total, total: p.total, received: recv(p, p.rem), order: p });
    }
  }
  return out;
}
