/* What the DeFi contracts on Terra Classic answer, turned into one shape.

   No imports and no network: every function here takes the JSON a contract
   returned and gives back plain numbers in raw units, so the shapes can be
   tested against real answers (tests/defi.mjs) without a chain.

   The answers these were written against were read from mainnet on
   29 Oct 2026 (defi-discover.mjs): Garuda farms (code 10913 / 10899), Garuda
   pools (10907), Garuda token staking (10920), the GRDX staking contract,
   Terraport's dynamic staking (10715), Juris staking (11230) and the Garuda
   order book. A field that is missing reads as zero rather than throwing,
   because a contract that changes its answer should cost a row, not the
   whole screen. */

const isNum = v => v !== null && v !== undefined && /^\d+$/.test(String(v));
const raw = v => isNum(v) ? String(v) : '0';

// Every way an asset is named on this chain, to one key: cw20:<addr> or native:<denom>.
function assetKey(a){
  if (!a) return '';
  if (typeof a === 'string') return a.indexOf('terra1') === 0 ? 'cw20:' + a : 'native:' + a;
  if (a.cw20) return 'cw20:' + a.cw20;
  if (a.native) return 'native:' + a.native;
  if (a.token && a.token.contract_addr) return 'cw20:' + a.token.contract_addr;
  if (a.native_token && a.native_token.denom) return 'native:' + a.native_token.denom;
  if (a.asset_type && a.address) return (a.asset_type === 'cw20' ? 'cw20:' : 'native:') + a.address;
  if (a.info) return assetKey(a.info);
  if (a.asset) return assetKey(a.asset);
  return '';
}

// [[asset, "123"], ...] or [{asset, amount}, ...] -> [{ key, raw }], zeros dropped.
function amounts(list, field){
  const out = [];
  for (const x of (Array.isArray(list) ? list : [])) {
    let key = '', amount = '0';
    if (Array.isArray(x)) { key = assetKey(x[0]); amount = raw(x[1]); }
    else if (x && typeof x === 'object') {
      key = assetKey(x.asset || x.info || x.denom || x);
      // a named field means that field: claimed must never fall back to pending
      amount = field ? raw(x[field]) : raw(x.amount !== undefined ? x.amount : x.pending_rewards);
    }
    if (key && amount !== '0') out.push({ key: key, raw: amount });
  }
  return out;
}

/* Garuda farm: LP tokens staked for rewards.
   config        { lp_token, start_time, end_time, unstake_duration, ... }
   stake_info    { staked_amount }
   reward_info   { rewards: [{ asset: { cw20 }, pending_rewards, claimed_rewards }] }
   pending_unstakes { unstakes: [...] } */
function farm(cfg, stake, reward, unstakes){
  cfg = cfg || {};
  const pending = amounts(((reward || {}).rewards) || [], 'pending_rewards');
  const claimed = amounts(((reward || {}).rewards) || [], 'claimed_rewards');
  const leaving = ((unstakes || {}).unstakes || []).map(function (u) {
    return { raw: raw(u.amount), at: Number(u.release_time || u.unlock_time || u.release || 0) || null };
  }).filter(u => u.raw !== '0');
  return {
    lp: cfg.lp_token || '',
    staked: raw((stake || {}).staked_amount),
    rewards: pending,
    claimed: claimed,
    leaving: leaving,
    endsAt: Number(cfg.end_time) || null,
    unstakeDelay: Number(cfg.unstake_duration) || 0
  };
}

/* Garuda pool: the position lives in the pool.
   user_position { lp_tokens, share_of_pool, asset1_amount, asset2_amount }
   pool          { asset1, asset2, reserve1, reserve2, ... } */
function pool(pos, p){
  pos = pos || {}; p = p || {};
  return {
    lp: raw(pos.lp_tokens),
    share: Number(pos.share_of_pool) || 0,
    sides: [
      { key: assetKey(p.asset1), raw: raw(pos.asset1_amount) },
      { key: assetKey(p.asset2), raw: raw(pos.asset2_amount) }
    ]
  };
}

/* Garuda token staking (the "Create staking contract" kind).
   config  { config: { token_contract, apr, unstak... } }
   stake   { stake: { staker, amount, pending_reward, staked_at, last_withdraw } }
   reward  { reward }
   unstake { unstake: [...] } */
function tokenStake(cfg, stake, reward, unstake){
  const c = (cfg && cfg.config) || cfg || {};
  const s = (stake && stake.stake) || {};
  const leaving = (((unstake || {}).unstake) || []).map(function (u) {
    return { raw: raw(u.amount), at: Number(u.release_time || u.unlock_time || u.release || 0) || null };
  }).filter(u => u.raw !== '0');
  const pend = raw((reward || {}).reward);
  return {
    token: c.token_contract ? 'cw20:' + c.token_contract : '',
    staked: raw(s.amount),
    reward: pend !== '0' ? pend : raw(s.pending_reward),
    apr: c.apr !== undefined ? Number(c.apr) : null,
    leaving: leaving
  };
}

/* Terraport dynamic staking.
   config    { stake_assets: [{ asset, weight }], reward_assets: [...], unlock_period_seconds }
   user_info { staked_assets: [...], pending_rewards: [[asset, amount], ...], ... } */
function dynamicStake(cfg, user){
  cfg = cfg || {}; user = user || {};
  // unstaked tokens wait out the unlock period here, then sit until withdrawn
  const unstakes = (user.pending_unstakes || []).map(function (u) {
    return { key: assetKey(u.asset), raw: raw(u.amount), at: Number(u.unlock_time) || null,
             ready: u.is_unlocked === true || Number(u.time_remaining) === 0 };
  }).filter(u => u.key && u.raw !== '0');
  return {
    staked: amounts(user.staked_assets),
    rewards: amounts(user.pending_rewards),
    unstakes: unstakes,
    withdrawn: amounts(user.total_rewards_withdrawn),
    unlockSeconds: Number(cfg.unlock_period_seconds) || 0,
    stakeKeys: (cfg.stake_assets || []).map(x => assetKey(x.asset || x)).filter(Boolean)
  };
}

/* Juris staking: tokens locked by tier until a release time.
   user_info { bonded, tiered: [{ id, amount, release, tier }], released: [...], voting_power } */
function jurisStake(user){
  user = user || {};
  const locks = (user.tiered || []).map(function (t) {
    return { id: String(t.id || ''), raw: raw(t.amount), release: Number(t.release) || null, tier: String(t.tier || '') };
  }).filter(t => t.raw !== '0');
  const released = (user.released || []).reduce((a, r) => a + Number(raw(r.amount || r)), 0);
  return { bonded: raw(user.bonded), locks: locks, released: String(released), power: raw(user.voting_power) };
}

/* GRDX staking. A staker with nothing staked is refused with "type ...
   StakedAsset" not found, which is an answer, not an error; with something
   staked the shape was not seen yet, so anything numeric that looks like an
   amount is taken. */
function grdxStake(cfg, assets){
  cfg = cfg || {};
  let staked = '0';
  if (Array.isArray(assets)) {
    staked = String(assets.reduce((a, x) => a + Number(raw(x && (x.amount || x.staked_amount || x.balance))), 0));
  } else if (assets && typeof assets === 'object') {
    for (const k of ['amount', 'staked_amount', 'total', 'balance']) if (isNum(assets[k])) { staked = String(assets[k]); break; }
    if (staked === '0' && Array.isArray(assets.assets)) return grdxStake(cfg, assets.assets);
  }
  return { token: cfg.token_address ? 'cw20:' + cfg.token_address : '', staked: staked };
}

/* Garuda order book: open limit orders.
   user_orders { orders: [{ id, owner, offer_asset, offer_amount, remaining..., ask_asset, ... }] } */
function orders(d){
  return (((d || {}).orders) || []).map(function (o) {
    const left = isNum(o.remaining_offer_amount) ? o.remaining_offer_amount
      : isNum(o.remaining_amount) ? o.remaining_amount
      : isNum(o.remaining) ? o.remaining : o.offer_amount;
    return {
      id: String(o.id),
      give: { key: assetKey(o.offer_asset), raw: raw(left) },
      get: { key: assetKey(o.ask_asset), raw: raw(o.ask_amount || o.min_receive || o.receive_amount) }
    };
  }).filter(o => o.give.key && o.give.raw !== '0');
}

export { amounts, assetKey, dynamicStake, farm, grdxStake, jurisStake, orders, pool, tokenStake };
