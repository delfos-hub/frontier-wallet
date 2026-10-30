/* What the DeFi contracts answer, read the way the Earn screen reads it.

   Every fixture below is an answer a mainnet contract gave on 29 Oct 2026
   (defi-discover.mjs), trimmed to the fields that matter. defi-parse.js has
   no imports, so it is loaded as it ships. */
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const P = await import(pathToFileURL(path.join(SRC, 'defi-parse.js')).href);
const GRDX_REWARD = 'terra1mm8tdp40r2slzwqxk8jsz66ayc4zp69muxeateq37x2xquttzsaqy7275a';

group('how an asset is named');
{
  ok('garuda cw20', P.assetKey({ cw20: 'terra1abc' }) === 'cw20:terra1abc');
  ok('garuda native', P.assetKey({ native: 'uluna' }) === 'native:uluna');
  ok('terraswap token', P.assetKey({ token: { contract_addr: 'terra1abc' } }) === 'cw20:terra1abc');
  ok('terraport dynamic', P.assetKey({ asset_type: 'native', address: 'uluna' }) === 'native:uluna');
  ok('nothing is nothing', P.assetKey(null) === '');
}

group('a Garuda farm');
{
  const f = P.farm(
    { lp_token: 'terra1mq7w3f0y7z82rys2md5hqtanylm9mlpnvmdtrjvnlv3mu880qacs08rhsl', start_time: 1788256800, end_time: 1819360800, unstake_duration: 0 },
    { staked_amount: '149419837191' },
    { rewards: [{ asset: { cw20: GRDX_REWARD }, pending_rewards: '1264918472', claimed_rewards: '4293903844' }] },
    { unstakes: [] });
  ok('the LP it takes', f.lp.indexOf('terra1mq7w') === 0);
  ok('what is staked', f.staked === '149419837191', f.staked);
  ok('pending, not claimed', f.rewards.length === 1 && f.rewards[0].raw === '1264918472', JSON.stringify(f.rewards));
  ok('the reward token', f.rewards[0].key === 'cw20:' + GRDX_REWARD);
  ok('when it ends', f.endsAt === 1819360800);
  ok('claimed so far', f.claimed[0].raw === '4293903844');
  const noClaim = P.farm({}, { staked_amount: '1' }, { rewards: [{ asset: { cw20: 'x' }, pending_rewards: '5' }] }, null);
  ok('claimed never borrows the pending figure', !noClaim.claimed.length, JSON.stringify(noClaim.claimed));
  const empty = P.farm({}, { staked_amount: '0' }, { rewards: [{ asset: { cw20: 'x' }, pending_rewards: '0' }] }, null);
  ok('an empty farm is empty', empty.staked === '0' && !empty.rewards.length);
}

group('a Garuda pool');
{
  const p = P.pool({ lp_tokens: '1000', share_of_pool: '0.0123', asset1_amount: '5000000', asset2_amount: '9000000' },
                   { asset1: { native: 'uluna' }, asset2: { cw20: 'terra1tok' } });
  ok('LP and share', p.lp === '1000' && Math.abs(p.share - 0.0123) < 1e-9);
  ok('both sides, named', p.sides[0].key === 'native:uluna' && p.sides[1].key === 'cw20:terra1tok' && p.sides[1].raw === '9000000');
}

group('Garuda token staking');
{
  const s = P.tokenStake(
    { config: { factory_contract: 'terra1f', token_contract: 'terra1wsmy4llflw9mc9qfysge5nnmpk5vfcrvc3hevrmaxzlr0qsyvh4q5yuhwd', apr: '0.3' } },
    { stake: { staker: 'me', amount: '1003500000000', pending_reward: '0', staked_at: '1773107424147013916' } },
    { reward: '12433471917' },
    { unstake: [] });
  ok('token', s.token === 'cw20:terra1wsmy4llflw9mc9qfysge5nnmpk5vfcrvc3hevrmaxzlr0qsyvh4q5yuhwd');
  ok('staked', s.staked === '1003500000000');
  ok('the reward query wins over the stale field', s.reward === '12433471917', s.reward);
  ok('APR as a fraction', s.apr === 0.3);
}

group('Terraport dynamic staking');
{
  const d = P.dynamicStake(
    { stake_assets: [{ asset: { asset_type: 'cw20', address: 'terra1ex0h' }, weight: '1' }], unlock_period_seconds: 1209600 },
    { user: 'me', staked_assets: [], pending_rewards: [[{ asset_type: 'native', address: 'uluna' }, '0'], [{ asset_type: 'native', address: 'uusd' }, '0']] });
  ok('nothing staked reads as nothing', !d.staked.length && !d.rewards.length);
  ok('the token it takes', d.stakeKeys[0] === 'cw20:terra1ex0h');
  ok('14 days to unlock', d.unlockSeconds === 1209600);
  const live = P.dynamicStake({}, { staked_assets: [[{ asset_type: 'cw20', address: 'terra1ex0h' }, '5000000']],
    pending_rewards: [[{ asset_type: 'native', address: 'uluna' }, '42']] });
  ok('a stake in pairs is read', live.staked[0].raw === '5000000' && live.rewards[0].key === 'native:uluna');
}

group('Terraport: unstaked and waiting to be withdrawn');
{
  // the real answer for an address that unstaked 282,943 TERRA on 13 Oct
  const d = P.dynamicStake({ unlock_period_seconds: 1209600 }, {
    staked_assets: [], pending_rewards: [[{ asset_type: 'native', address: 'uluna' }, '0']],
    total_rewards_withdrawn: [[{ asset_type: 'native', address: 'uluna' }, '246616874642'], [{ asset_type: 'native', address: 'uusd' }, '0']],
    pending_unstakes: [{ asset: { asset_type: 'cw20', address: 'terra1ex0h' }, amount: '282943314837',
                         unlock_time: 1793141533, time_remaining: 0, is_unlocked: true }] });
  ok('the unstake is there', d.unstakes.length === 1 && d.unstakes[0].raw === '282943314837');
  ok('and ready', d.unstakes[0].ready === true && d.unstakes[0].key === 'cw20:terra1ex0h');
  ok('earned so far, zeros dropped', d.withdrawn.length === 1 && d.withdrawn[0].raw === '246616874642');
}

group('Juris staking');
{
  const j = P.jurisStake({ bonded: '0', tiered: [
    { owner: 'me', id: '158', amount: '21854512466771', release: 1824087289, tier: 'gold', materialized: false },
    { owner: 'me', id: '1646', amount: '58646024935651', release: 1852999388, tier: 'gold', materialized: false }],
    released: [], voting_power: '96600636' });
  ok('two locks', j.locks.length === 2);
  ok('amount and release', j.locks[1].raw === '58646024935651' && j.locks[1].release === 1852999388);
  ok('tier', j.locks[0].tier === 'gold');
}

group('GRDX staking');
{
  const g = P.grdxStake({ token_address: 'terra16hzl' }, null);
  ok('refused means nothing staked', g.staked === '0' && g.token === 'cw20:terra16hzl');
  ok('an amount in an object is found', P.grdxStake({}, { amount: '77' }).staked === '77');
  ok('a list is summed', P.grdxStake({}, [{ amount: '2' }, { amount: '3' }]).staked === '5');
}

group('Garuda order book');
{
  const o = P.orders({ orders: [{ id: 100, owner: 'me', offer_asset: { cw20: 'terra1wsmy' }, offer_amount: '25514445715',
                                  ask_asset: { native: 'uluna' }, ask_amount: '1000' }] });
  ok('an open order', o.length === 1 && o[0].id === '100' && o[0].give.raw === '25514445715' && o[0].get.key === 'native:uluna');
}
