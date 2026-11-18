/* incoming.js: which transactions raise a "Received" or "Claimed" card.
   The module touches the DOM when it loads, so arrivals() is lifted from the
   source, as tests/activity.mjs does. */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'incoming.js'), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
const line = (s, h) => { const i = s.indexOf(h); if (i < 0) throw new Error('not found: ' + h); return s.slice(i, s.indexOf(';\n', i) + 1); };
const actSrc = fs.readFileSync(path.join(SRC, 'activity.js'), 'utf8');
const wasmCalls = new Function(lift(actSrc, 'function wasmCalls(') + '\nreturn wasmCalls;')();
const NETS = { mainnet: { htlc: 'terra1htlcmain' }, testnet: { htlc: 'terra1htlctest' } };
const arrivals = new Function('nameOf', 'fmt', 'amt', 'wasmCalls', 'NETS', [
  line(src, 'const FEE_COLLECTOR ='), line(src, 'const QUIET ='), line(src, 'const CW20_MOVES ='),
  lift(src, 'function arrivals('), 'return arrivals;'].join('\n'))(
  a => ({ sym: a === 'uluna' ? 'LUNC' : a === 'terra1tco' ? 'TCO' : 'X', dec: 6 }), v => String(v), (r, d) => Number(r) / 10 ** d, wasmCalls, NETS);

const ME = 'terra1me', OTHER = 'terra1other', MARKET = 'terra1prophecy', FC = 'terra17xpfvakm2amg962yls6f84z3kell8c5lkaeqfa';
const ev = (type, o) => ({ type, attributes: Object.entries(o).map(([key, value]) => ({ key, value })) });
const tx = (msgs, events) => ({ txhash: 'H', height: '10', tx: { body: { messages: msgs } }, logs: [{ events }] });
const exec = (sender, contract, msg) => ({ '@type': '/cosmwasm.wasm.v1.MsgExecuteContract', sender, contract, msg });

group('a claim this address signed on a site');
let r = arrivals(tx([exec(ME, MARKET, { claim: { market_id: 7 } })], [
  ev('transfer', { recipient: FC, sender: ME, amount: '300000uluna' }),
  ev('transfer', { recipient: ME, sender: MARKET, amount: '250000000uluna' })]), ME);
ok('a LUNC payout from the market is announced', r.length === 1 && r[0].sym === 'LUNC' && r[0].text === '250' && r[0].from === MARKET, JSON.stringify(r));
r = arrivals(tx([exec(ME, MARKET, { claim: {} })], [
  ev('wasm', { _contract_address: 'terra1tco', action: 'transfer', from: MARKET, to: ME, amount: '5000000' })]), ME);
ok('a token payout (CW20 transfer from the contract) is announced', r.length === 1 && r[0].sym === 'TCO' && r[0].from === MARKET, JSON.stringify(r));

group('quiet');
r = arrivals(tx([exec(ME, 'terra1pair', { swap: {} })], [
  ev('transfer', { recipient: 'terra1pair', sender: ME, amount: '100uluna' }),
  ev('wasm', { _contract_address: 'terra1tco', action: 'transfer', from: 'terra1pair', to: ME, amount: '5' })]), ME);
ok('a swap (LUNC left this address) is not announced as money arriving', r.length === 0, JSON.stringify(r));
r = arrivals(tx([exec(OTHER, 'terra1k65g4hy99sy6h7f2khrt5rz97ydlemtn4459gj9qhrt79tp83hcsdsq5uj', { fill: {} })], [
  ev('transfer', { recipient: ME, sender: 'terra1k65g4hy99sy6h7f2khrt5rz97ydlemtn4459gj9qhrt79tp83hcsdsq5uj', amount: '9uluna' })]), ME);
ok('a P2P fill has its own card', r.length === 0);
r = arrivals(tx([exec('terra1relayer', 'terra1htlcmain', { claim: {} })], [
  ev('transfer', { recipient: ME, sender: 'terra1htlcmain', amount: '9uluna' })]), ME);
ok('a GRAM swap claim has its own card', r.length === 0);
r = arrivals(tx([exec(ME, 'terra1tco', { send: { contract: 'terra1k65g4hy99sy6h7f2khrt5rz97ydlemtn4459gj9qhrt79tp83hcsdsq5uj', amount: '1', msg: '' } })], []), ME);
ok('a token sent into the P2P contract stays quiet', r.length === 0);

group('as before');
r = arrivals(tx([{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: OTHER, to_address: ME }], [
  ev('transfer', { recipient: ME, sender: OTHER, amount: '7000000uluna' })]), ME);
ok('a plain send from someone else', r.length === 1 && r[0].text === '7' && r[0].from === OTHER);
r = arrivals(tx([exec(OTHER, 'terra1tco', { transfer: { recipient: ME, amount: '3000000' } })], [
  ev('wasm', { _contract_address: 'terra1tco', action: 'transfer', from: OTHER, to: ME, amount: '3000000' })]), ME);
ok('a token sent by hand', r.length === 1 && r[0].sym === 'TCO');
r = arrivals(tx([{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: ME, to_address: OTHER }], [
  ev('transfer', { recipient: OTHER, sender: ME, amount: '7uluna' })]), ME);
ok('this address sending is not an arrival', r.length === 0);

group('what this wallet sent is left to its own screen');
ok('tx.js remembers its own hashes', /localStorage\.setItem\('fw:mine'/.test(fs.readFileSync(path.join(SRC, 'tx.js'), 'utf8')));
ok('incoming skips them, and no longer everything this address signed', /filter\(t => !sentHere\(t\.txhash\)\)/.test(src) && !/signer\(\(\(\(t\.tx \|\| \{\}\)\.body \|\| \{\}\)\.messages \|\| \[\]\)\[0\]\) !== addr\)/.test(src));
group('a made-up token event (Pablo, #62)');
{
  const pick = new Function('smart', lift(src, 'async function realRows(') + '\nreturn realRows;');
  const bal = { 'terra1tco': '5000000' };
  const realRows = pick(async (c, q) => { if (!(c in bal)) throw new Error('not a cw20'); return { data: { balance: bal[c] } }; });
  const rows = [{ key: 'native:uluna', raw: '1' }, { key: 'cw20:terra1tco', raw: '5000000' }, { key: 'cw20:terra1fake', raw: '9' }, { key: 'cw20:terra1tco', raw: '9000000' }];
  const kept = await realRows(rows, ME);
  ok('coins pass, a real token pass', kept.length === 2 && kept[0].key === 'native:uluna' && kept[1].raw === '5000000', JSON.stringify(kept));
  ok('a contract that is not a token, or more than this address holds, raises nothing', !kept.some(r => r.key === 'cw20:terra1fake' || r.raw === '9000000'));
  ok('the poll checks token rows before announcing', /x\.rows = await realRows\(x\.rows, addr\)/.test(src));
}
report();
