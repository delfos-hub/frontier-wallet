/* What a transaction is called, and which face it wears.

   The old reading walked every wasm event and kept the last `action` a contract
   logged about itself - so a swap through a router came back named after
   whatever the final contract in the chain happened to call its own bookkeeping.
   "receive cw20 fee" was a true statement about somebody's internals and a
   description of nothing the owner did.

   activity.js touches the DOM when it loads, so the functions are lifted from
   the shipped file the same way swap.js's are. */
import fs from 'fs';
import path from 'path';
import { ok, group } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'activity.js'), 'utf8');

function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found in activity.js: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
function liftLine(s, header){
  const i = s.indexOf(header);
  return s.slice(i, s.indexOf(';\n', i) + 1);
}

// a small market: two tokens the wallet knows, and one it does not
const KNOWN = {
  'cw20:terra1cl8y': { sym: 'CL8Y', dec: 18 },
  'native:uusd': { sym: 'USTC', dec: 6 },
  'cw20:terra1pizza': { sym: 'PIZZAB', dec: 6 }
};

const api = new Function('atob', 'short', 'coins', 'fmt', 'amt', 'knownAsset', 'DEC', [
  liftLine(src, 'const keyFor ='),
  lift(src, 'function wasmCalls('),
  liftLine(src, 'const FACE ='),
  liftLine(src, 'const sentence ='),
  lift(src, 'function nameOf('),
  lift(src, 'function swapMoves('),
  liftLine(src, 'const VERB ='),
  lift(src, 'function hookOf('),
  liftLine(src, 'const PREP ='),
  lift(src, 'function spenderOf('),
  lift(src, 'function isPrep('),
  lift(src, 'function primaryMsg('),
  lift(src, 'function intentOf('),
  liftLine(src, 'const ICON ='),
  lift(src, 'function describe('),
  'return { describe, ICON, swapMoves, nameOf, wasmCalls };'
].join('\n'))(
  s => Buffer.from(s, 'base64').toString(),
  x => String(x).slice(0, 6) + '\u2026',
  c => (c && c[0] ? c[0].amount + ' ' + c[0].denom : ''),
  v => String(Math.round(v * 1e6) / 1e6),
  (raw, dec) => Number(raw) / Math.pow(10, dec),
  k => KNOWN[k] || null,
  {}
);

const exec = (msg, logs) => ({
  tx: { body: { messages: [
    { '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1pool', msg }
  ] } },
  logs: logs || []
});
const native = (from, to) => ({
  tx: { body: { messages: [
    { '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: from, to_address: to, amount: [] }
  ] } }
});

group('a transaction is named by what was asked for');
{
  // the exact case that produced "receive cw20 fee" on screen
  const hook = Buffer.from(JSON.stringify({ swap: { max_spread: '0.01' } })).toString('base64');
  const t = exec({ send: { contract: 'terra1p', amount: '100', msg: hook } },
                 [{ events: [{ type: 'wasm',
                    attributes: [{ key: 'action', value: 'receive cw20 fee' }] }] }]);
  const d = api.describe(t, 'me');
  ok('a cw20 send whose hook is a swap is a swap', d.title === 'Swapped', d.title);
  ok('and it wears the swap face', d.kind === 'swap', d.kind);
  ok("what a downstream contract logged about itself does not name it",
     d.title.indexOf('receive') < 0 && d.title.indexOf('fee') < 0, d.title);

  // a token transfer: the signer is the message's sender
  const xfer = (sender, msg) => {
    const t = exec(msg);
    Object.assign(t.tx.body.messages[0], { sender: sender, contract: 'terra1pizza' });
    return t;
  };
  const sent = api.describe(xfer('me', { transfer: { recipient: 'terra1x', amount: '50709939' } }), 'me');
  ok('a transfer reads as sent', sent.title === 'Sent', sent.title);
  ok('and says how much of what', sent.value === '-50.709939 PIZZAB', sent.value);
  ok('and to whom, not which contract', sent.sub === 'to terra1\u2026', sent.sub);
  ok('a token transfer leaves the wallet', sent.kind === 'out', sent.kind);
  const got = api.describe(xfer('terra1y', { transfer: { recipient: 'me', amount: '5000000' } }), 'me');
  ok('a token someone else sent here reads as received', got.title === 'Received', got.title);
  ok('with a plus and the ticker', got.value === '+5 PIZZAB', got.value);
  ok('and wears the incoming face', got.kind === 'in', got.kind);
  ok('liquidity has words of its own',
     api.describe(exec({ provide_liquidity: {} }), 'me').title === 'Added liquidity');

  const odd = api.describe(exec({ record_entry: {} }), 'me');
  // shown as it came, but as a sentence: a lower case fragment reads as a leak
  ok('an action nobody has a word for is shown as it came',
     odd.title === 'Record entry', odd.title);
  ok('and is not dressed up as something known', odd.kind === 'code', odd.kind);
}

group('the badge carries the meaning');
{
  const seen = {
    out:   api.describe(native('me', 'terra1x'), 'me').kind,
    in:    api.describe(native('terra1x', 'me'), 'me').kind,
    swap:  api.describe(exec({ swap: {} }), 'me').kind,
    stake: api.describe({ tx: { body: { messages: [
             { '@type': '/cosmos.staking.v1beta1.MsgDelegate', amount: {} }] } } }, 'me').kind,
    gift:  api.describe({ tx: { body: { messages: [
             { '@type': '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward' }] } } }, 'me').kind
  };
  for (const want in seen) {
    ok('a ' + want + ' is marked as one', seen[want] === want, seen[want]);
  }
  // a face with no glyph falls back to a shared one, and every act looks alike
  const missing = Object.keys(seen).concat(['code']).filter(k => !api.ICON[k]);
  ok('every face has a glyph of its own', missing.length === 0, missing.join(','));

  const glyphs = Object.keys(api.ICON).map(k => api.ICON[k]);
  ok('and no two acts share a drawing',
     new Set(glyphs).size === glyphs.length);
}

group('several messages are counted, not hidden');
{
  const many = native('me', 'terra1x');
  many.tx.body.messages.push({ '@type': '/cosmos.bank.v1beta1.MsgSend' });
  ok('a transaction with more than one message says so',
     api.describe(many, 'me').title === 'Sent +1', api.describe(many, 'me').title);
}

group('a swap says what it moved');
{
  // the amounts are in the events the pools emit; a row that omits them is
  // half a sentence, and it was half of every swap on the screen
  const wasm = (attrs) => ({ type: 'wasm', attributes:
    Object.keys(attrs).map(k => ({ key: k, value: String(attrs[k]) })) });

  const one = { logs: [{ events: [wasm({
    action: 'swap', offer_asset: 'terra1cl8y', offer_amount: '8233232000000000000',
    ask_asset: 'uusd', return_amount: '806730000' })] }] };
  const m = api.swapMoves(one);
  ok('the amount received is read', m && m.got === '806.73 USTC', m && m.got);
  ok('and the amount paid', m && m.gave === '8.233232 CL8Y', m && m.gave);
  ok('the pair replaces a contract address', m && m.pair === 'CL8Y \u2192 USTC', m && m.pair);
  ok('each side at its own decimals', m && m.gave.indexOf('8233232') < 0);

  // two pools in one transaction: the first offer and the last return are the
  // two ends of what the owner did, and the middle token is not either of them
  const two = { logs: [{ events: [
    wasm({ action: 'swap', offer_asset: 'terra1cl8y', offer_amount: '1000000000000000000',
           ask_asset: 'terra1mid', return_amount: '500' }),
    wasm({ action: 'swap', offer_asset: 'terra1mid', offer_amount: '500',
           ask_asset: 'uusd', return_amount: '990000' })
  ] }] };
  const h = api.swapMoves(two);
  ok('a two pool trade reports its ends, not its middle',
     h.gave.indexOf('CL8Y') >= 0 && h.got.indexOf('USTC') >= 0, h.gave + ' -> ' + h.got);
  ok('and the middle token appears in neither',
     h.pair.indexOf('terra1mid') < 0, h.pair);

  ok('a transaction with no swap events reports nothing',
     api.swapMoves({ logs: [] }) === null);

  // and the row has to actually use it, which is the whole point
  const row = api.describe({
    tx: { body: { messages: [{ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract',
                               contract: 'terra1pool', msg: { swap: {} } }] } },
    logs: [{ events: [wasm({
      action: 'swap', offer_asset: 'terra1cl8y', offer_amount: '8233232000000000000',
      ask_asset: 'uusd', return_amount: '806730000' })] }]
  }, 'me');
  ok('the row carries the amount received', row.value === '+806.73 USTC', row.value);
  ok('and the pair instead of the contract', row.sub === 'CL8Y \u2192 USTC', row.sub);
  ok('and is coloured as a gain', row.gain === true);

  // an asset nobody has heard of still gets a readable name
  const un = api.nameOf('uwhat');
  ok('an unknown denom is named from itself', un.sym === 'WHAT', un.sym);
  ok('and assumed to be six decimals until told otherwise', un.dec === 6);
}

group('one wasm event, several contracts');
{
  /* The chain concatenates every contract's attributes into one event, in the
     order they ran, separated only by a fresh _contract_address. Reading that
     as a single object gives the first action in the chain - which for a swap
     paid in a CW20 is the token's own send, never the pool's swap. */
  const chained = { logs: [{ events: [{ type: 'wasm', attributes: [
    { key: '_contract_address', value: 'terra1cl8y' },
    { key: 'action', value: 'send' },
    { key: 'from', value: 'me' },
    { key: '_contract_address', value: 'terra1pool' },
    { key: 'action', value: 'swap' },
    { key: 'offer_asset', value: 'terra1cl8y' },
    { key: 'offer_amount', value: '8233232000000000000' },
    { key: 'ask_asset', value: 'uusd' },
    { key: 'return_amount', value: '806730000' }
  ] }] }] };

  const calls = api.wasmCalls(chained);
  ok('each contract is read separately', calls.length === 2, String(calls.length));
  ok("the token's own action does not stand for the pool's",
     calls[0].action === 'send' && calls[1].action === 'swap');

  const m = api.swapMoves(chained);
  ok('so the swap behind a cw20 send is found at last', !!m);
  ok('with the amount that came back', m && m.got === '806.73 USTC', m && m.got);
  ok('and the pair', m && m.pair === 'CL8Y \u2192 USTC', m && m.pair);
}

group('a contract call wears the face of what it did');
{
  const exec2 = (msg) => ({ tx: { body: { messages: [
    { '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1cl8y', msg } ] } } });

  ok('staking is not filed under "some code ran"',
     api.describe(exec2({ stake: {} }), 'me').kind === 'stake');
  ok('nor is unstaking', api.describe(exec2({ unbond: {} }), 'me').kind === 'stake');
  ok('a reward wears the reward face',
     api.describe(exec2({ claim_rewards: {} }), 'me').kind === 'gift');
  ok('and is named in words', api.describe(exec2({ claim_rewards: {} }), 'me').title
     === 'Claimed rewards');
  ok('something with no name still starts with a capital',
     api.describe(exec2({ record_entry: {} }), 'me').title === 'Record entry',
     api.describe(exec2({ record_entry: {} }), 'me').title);
  ok('and still admits it is only code',
     api.describe(exec2({ record_entry: {} }), 'me').kind === 'code');

  // the amount a cw20 carries out of the wallet lives in the message
  const staked = api.describe(exec2({ send: { contract: 'terra1farm',
                                              amount: '1500000000000000000' } }), 'me');
  ok('a cw20 leaving the wallet reports how much',
     staked.value === '-1.5 CL8Y', staked.value);
}

group('approvals before the action do not name it');
{
  const ex = msg => ({ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1pool', msg });
  const t = { tx: { body: { messages: [ex({ increase_allowance: { spender: 'terra1pool', amount: '1' } }),
    ex({ increase_allowance: { spender: 'terra1pool', amount: '1' } }), ex({ provide_liquidity: {} })] } }, logs: [] };
  ok('two approvals and a deposit read as the deposit', api.describe(t, 'me').title === 'Added liquidity', api.describe(t, 'me').title);
  const only = { tx: { body: { messages: [ex({ increase_allowance: { spender: 'x', amount: '1' } })] } }, logs: [] };
  ok('an approval on its own is still named', api.describe(only, 'me').title === 'Approved spending', api.describe(only, 'me').title);
  const other = { tx: { body: { messages: [ex({ increase_allowance: { spender: 'terra1stranger', amount: '1' } }),
    ex({ provide_liquidity: {} })] } }, logs: [] };
  const o = api.describe(other, 'me');
  ok('an approval to someone else is counted, not hidden', o.title === 'Added liquidity +1', o.title);
  const sendTo = { tx: { body: { messages: [ex({ increase_allowance: { spender: 'terra1farm', amount: '1' } }),
    { '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract: 'terra1tok', msg: { send: { contract: 'terra1farm', amount: '5', msg: '' } } }] } }, logs: [] };
  ok('an approval for the contract a cw20 is sent to is part of it', !/\+1/.test(api.describe(sendTo, 'me').title), api.describe(sendTo, 'me').title);
  ok('the period summary counts the fee of a failed transaction too',
     /within\.forEach\(t => \{ if \(Number\(t\.code\) !== 0\) fee \+= feePaid\(t, me\); \}\)/.test(src));
  ok('a prediction is named in words', api.describe({ tx: { body: { messages: [ex({ predict: {} })] } }, logs: [] }, 'me').title === 'Prediction placed');
}

group('network fees: top-level events and logs');
{
  const FEE = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa';
  const fx0 = new Function(
    liftLine(src, 'const FEE_COLLECTOR =') + '\n' + lift(src, 'function eventsOf(') + '\n' + lift(src, 'function taxEvents(') + '\n' + lift(src, 'function taxPaid(') + '\n' +
    lift(src, 'function feeEvents(') + '\n' + lift(src, 'function feePaid(') + '\nreturn { feePaid, taxPaid };')();
  const fees = fx0; const fx = (t, me) => fees.feePaid(t, me);
  const tr = (from, to, amount) => ({ type: 'transfer', attributes: [{ key: 'recipient', value: to }, { key: 'sender', value: from }, { key: 'amount', value: amount }] });
  const msgLogs = [{ events: [tr('me', 'terra1bob', '200000000uluna')] }];
  const feeOnly = [tr('me', FEE, '10000000uluna')];
  ok('fee in top-level events, transfer in the logs: 10 LUNC', fx({ logs: msgLogs, events: feeOnly }, 'me') === 10000000, fx({ logs: msgLogs, events: feeOnly }, 'me'));
  ok('the same with empty logs: 10 LUNC', fx({ logs: [], events: feeOnly }, 'me') === 10000000);
  ok('events holding the messages too: counted once', fx({ logs: msgLogs, events: feeOnly.concat(msgLogs[0].events) }, 'me') === 10000000);
  ok('a fee paid by another address is not this one’s', fx({ logs: msgLogs, events: [tr('terra1granter', FEE, '10000000uluna')] }, 'me') === 0);
  const tax = { type: 'tax_payment', attributes: [{ key: 'tax_amount', value: '5000000uluna' }] };
  const taxed = [tr('me', FEE, '10000000uluna'), tr('me', FEE, '5000000uluna'), tax];
  ok('the burn tax in the same events is left out', fx({ logs: [], events: taxed }, 'me') === 10000000, fx({ logs: [], events: taxed }, 'me'));
  ok('only logs (an old node): still read', fx({ logs: [{ events: feeOnly }] }, 'me') === 10000000);

  // #68 review 2: the tax listed only at the top level, the logs holding the
  // ordinary transfer: the summary and the detail both say 10 LUNC
  const top = [tr('me', FEE, '10000000uluna'), tr('me', FEE, '5000000uluna'), tax];
  const t1 = { logs: msgLogs, events: top };
  ok('tax only at the top level, logs with the transfer: fee 10 LUNC, not 15', fx(t1, 'me') === 10000000, fx(t1, 'me'));
  ok('and the detail still finds the 5 LUNC burn tax', fees.taxPaid(t1, 'me').map(c => c.amount).join() === '5000000');
  // split the other way: fee at the top, tax in the logs
  const t2 = { logs: [{ events: [tr('me', 'terra1bob', '200000000uluna'), tr('me', FEE, '5000000uluna'), tax] }], events: feeOnly };
  ok('fee at the top, tax only in the logs: 10 LUNC', fx(t2, 'me') === 10000000, fx(t2, 'me'));
  ok('and the detail finds the tax in the logs', fees.taxPaid(t2, 'me').map(c => c.amount).join() === '5000000');
  // duplicated: the top level repeats the logs' events
  const t3 = { logs: [{ events: [tr('me', 'terra1bob', '200000000uluna'), tr('me', FEE, '5000000uluna'), tax] }],
               events: [tr('me', FEE, '10000000uluna'), tr('me', 'terra1bob', '200000000uluna'), tr('me', FEE, '5000000uluna'), tax] };
  ok('events duplicated between the logs and the top level: 10 LUNC', fx(t3, 'me') === 10000000, fx(t3, 'me'));
  ok('a tax_payment with no transfer of its own is not taken off the fee', fx({ logs: [], events: [tr('me', FEE, '10000000uluna'), tax] }, 'me') === 10000000);
}

group('the period: whole local days, like the bars');
{
  const calDay = new Function(lift(src, 'function calDay(') + '\nreturn calDay;')();
  const was = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  try {
    const now = new Date('2026-11-23T12:00:00Z').getTime();                  // 13:00 in Paris
    const from7 = calDay(now, 6).getTime();
    ok('7D starts at local midnight on 17 November', from7 === new Date('2026-11-16T23:00:00Z').getTime(), new Date(from7).toISOString());
    ok('so 14:00 on 16 November is outside it, as the bars are', new Date('2026-11-16T13:00:00Z').getTime() < from7);
    const keys = [];
    const dk = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    const nowOct = new Date('2026-10-27T10:00:00Z').getTime();
    for (let i = 6; i >= 0; i--) keys.push(dk(calDay(nowOct, i)));
    ok('across the October clock change each day appears once', new Set(keys).size === 7 && keys.includes('2026-10-25'), keys.join(' '));
    ok('the window and the bars use the same days', /const from = PERIOD \? dayAt\(PERIOD - 1\)\.getTime\(\)/.test(src) && /const d = dayAt\(i\), k = dayKey\(d\)/.test(src));
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

group('rows: approvals to others, grouped unstakes, wallet switch');
{
  // #68 review 4: an allowance raised or lowered for a third party, both views
  const al = new Function('short', [liftLine(src, 'const PREP ='), lift(src, 'function spenderOf('), lift(src, 'function isPrep('),
    lift(src, 'function intentOf('), lift(src, 'function alsoOf('), lift(src, 'function alsoTitle('), lift(src, 'function alsoRow('),
    'return { alsoOf, alsoTitle, alsoRow };'].join('\n'))(x => String(x).slice(0, 8) + '…');
  const ex = (contract, msg) => ({ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', contract, msg });
  const dep = ex('terra1pool', { provide_liquidity: {} });
  const up = [ex('terra1tok', { increase_allowance: { spender: 'terra1stranger', amount: '1' } }), dep];
  const dn = [ex('terra1tok', { decrease_allowance: { spender: 'terra1stranger', amount: '1' } }), dep];
  const own = [ex('terra1tok', { increase_allowance: { spender: 'terra1pool', amount: '1' } }), dep];
  const aUp = al.alsoOf(up, dep), aDn = al.alsoOf(dn, dep);
  ok('a raised allowance for a stranger: "+approval" in the row', al.alsoTitle(aUp) === ' +approval', al.alsoTitle(aUp));
  ok('and "Also approved: spending by" in the detail', al.alsoRow(aUp[0])[0] === 'Also approved' && /^spending by /.test(al.alsoRow(aUp[0])[1]));
  ok('a lowered allowance: "+allowance lowered" in the row', al.alsoTitle(aDn) === ' +allowance lowered', al.alsoTitle(aDn));
  ok('and "Also lowered: allowance of" in the detail, never "approved"', al.alsoRow(aDn[0])[0] === 'Also lowered' && /^allowance of /.test(al.alsoRow(aDn[0])[1]));
  ok('one of each: counted as changes', al.alsoTitle(al.alsoOf([up[0], dn[0], dep], dep)) === ' +2 allowance changes');
  ok('the pool’s own allowance is part of the deposit, nothing added', al.alsoOf(own, dep).length === 0 && al.alsoTitle([]) === '');
  const lk = lift(src, 'function look(');
  ok('the row title and the detail use these', /title \+= alsoTitle\(also\)/.test(lk) && /const r = alsoRow\(a\); html \+= row\(r\[0\], r\[1\]/.test(src));

  // folded runs (#68 review 3 and 5)
  const foldSrc = src.slice(src.indexOf('let fold = { n: run.length };'), src.indexOf('// otherwise only the count'));
  const H = f => Math.abs(f.raw) / 1e6;
  const sym = k => k === 'native:uusd' ? 'USTC' : 'LUNC';
  const amountText = f => (f.raw > 0 ? '+' : '-') + H(f) + ' ' + sym(f.key);
  const fold = new Function('fmt', 'human', 'symOfKey', 'amountText', 'run', 'main', 'sameKey', foldSrc + '\nreturn fold;');
  const F = (rows) => { const main = rows.map(r => r.main); return fold(x => String(x), H, sym, amountText, rows.map(r => ({ l: r })), main, main.every(f => f && f.key === main[0].key)); };
  const unst = [{ main: { key: 'native:uluna', raw: 0, req: 20e6 } }, { main: { key: 'native:uluna', raw: 0, req: 30e6 } }];
  ok('two unstakes of 20 and 30 fold to 50 LUNC, not -0', F(unst).top === '50 LUNC', F(unst).top);
  const odd = [{ main: { key: 'native:uluna', raw: 0 } }, { main: { key: 'native:uluna', raw: 0 } }];
  ok('with no amount to add up, only the count', F(odd).top === undefined);
  const sw = [{ kind: 'swap', main: { key: 'native:uluna', raw: -20e6 }, second: { key: 'native:uusd', raw: 2e6 }, usd: 0 },
              { kind: 'swap', main: { key: 'native:uluna', raw: -30e6 }, second: { key: 'native:uusd', raw: 3e6 }, usd: 0 }];
  const fs2 = F(sw);
  ok('two swaps fold to +5 USTC received', fs2.top === '+5 USTC' && fs2.topIn === true, JSON.stringify(fs2));
  ok('and -50 LUNC spent below it', fs2.below === '-50 LUNC', fs2.below);
  const outs = [{ main: { key: 'native:uluna', raw: -20e6 } }, { main: { key: 'native:uluna', raw: -30e6 } }];
  ok('two sends fold to -50 LUNC, styled as going out', F(outs).top === '-50 LUNC' && F(outs).topIn === false);
  const mixed = [sw[0], { kind: 'swap', main: { key: 'native:uluna', raw: -30e6 }, second: { key: 'cw20:terra1x', raw: 3e6 }, usd: 0 }];
  ok('swaps into two different tokens: no total, only the count', F(mixed).top === undefined, JSON.stringify(F(mixed)));

  // the folded header itself, drawn by rowHTML: native undelegations 20 + 30
  const row = new Function('TXS', 'look', 'dayName', 'clock', 'usd', 'short', 'esc', 'face',
    lift(src, 'function rowHTML(') + '\nreturn rowHTML;')({},
    t => Object.assign({ title: 'Undelegated', kind: 'stake', group: 'staking', sub: 'terra1val', usd: 0, place: '', below: '', topIn: false }, t.l),
    () => 'Today', () => '12:00', v => '$' + v.toFixed(2), x => x, x => String(x), () => '');
  const one = { txhash: 'A', code: 0, timestamp: '', l: { top: '20 LUNC' } };
  const head = row(one, 'me', false, { n: 2, top: '50 LUNC' });
  ok('the folded undelegation header shows 50 LUNC', /Undelegated ×2/.test(head) && />50 LUNC</.test(head) && !/>20 LUNC</.test(head), head);
  const headNo = row(one, 'me', false, { n: 2 });
  ok('without a total it shows only the count, not the first row’s 20', /Undelegated ×2/.test(headNo) && !/20 LUNC/.test(headNo), headNo);
  ok('the expanded rows keep their own amounts', />20 LUNC</.test(row(one, 'me')));
  const swHead = row({ txhash: 'B', code: 0, timestamp: '', l: { title: 'Swapped', kind: 'swap', top: '+2 USTC', topIn: true, below: '-20 LUNC' } }, 'me', false, { n: 2, top: '+5 USTC', topIn: true, below: '-50 LUNC' });
  ok('the folded swap header: +5 USTC in, -50 LUNC below', /class="ac-v in">\+5 USTC</.test(swHead) && /-50 LUNC/.test(swHead), swHead);
  ok('a native undelegation carries its amount for the fold', /if \(!msgKey && coin && STAKING_MSG\.test\(type\)\) \{ msgKey = 'native:' \+ coin\.denom; req = Number\(coin\.amount\); \}/.test(lk));

  // #68 review 1: the summary is the open wallet's only
  const doc = { box: { hidden: false, innerHTML: 'A: -$123', dataset: { for: 'A' } } };
  const sumFns = new Function('document', 'S', 'isDesk', 'ALL', 'LOADED_FOR',
    lift(src, 'function clearSummary(') + '\n' + lift(src, 'function summary(') + '\nreturn { clearSummary, summary };');
  const D = { getElementById: id => id === 'ac-sum' ? doc.box : null };
  const B = sumFns(D, { ADDR: 'B' }, () => true, [{}], 'A');
  B.summary('A');
  ok('A’s summary is not drawn once B is the open wallet (A’s late read): hidden and emptied', doc.box.hidden === true && doc.box.innerHTML === '', JSON.stringify(doc.box));
  doc.box = { hidden: false, innerHTML: 'A: -$123', dataset: { for: 'A' } };
  B.summary('B');
  ok('nor while B’s history is still being read (ALL is not B’s yet)', doc.box.hidden === true && doc.box.innerHTML === '', JSON.stringify(doc.box));
  doc.box = { hidden: false, innerHTML: 'A: -$123', dataset: { for: 'A' } };
  B.clearSummary();
  ok('clearSummary empties it', doc.box.hidden && doc.box.innerHTML === '' && doc.box.dataset.for === '');
  const wl = src.slice(src.indexOf("document.addEventListener('frontier:wallet'"), src.indexOf('function openLink('));
  ok('the wallet-change event clears it at once', /if \(LOADED_FOR && LOADED_FOR !== me\) \{[\s\S]*clearSummary\(\);/.test(wl));
  const rd = lift(src, 'async function read(');
  ok('and read() clears it before waiting for the old wallet’s read', rd.indexOf('clearSummary()') >= 0 && rd.indexOf('clearSummary()') < rd.indexOf('while (FETCH_P)'));
}
