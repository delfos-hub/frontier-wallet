/* Round 5, part E: the seller's answer against the clock and the Worker's
   margin, the pay time read from the TON lock, a refund described as it pays.
   Functions lifted from the shipped gram.js, as in the other gram tests. */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
const net = await import(new URL('file://' + path.join(SRC, 'gram-net.js')).href);
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
const line = (s, h) => { const i = s.indexOf(h); if (i < 0) throw new Error('not found: ' + h); return s.slice(i, s.indexOf('\n', i)); };

const MAIN = net.NETS.mainnet.policy, TEST = net.NETS.testnet.policy;
let NOW = 1800000000, BLOCK = NOW, POLICY = MAIN;
const make = () => new Function('now', 'getJSON', 'NET', 'POLICY', [
  'let CHAIN_SKEW = null, CHAIN_SKEW_AT = 0;', line(src, 'const CLOCK_TOL ='), line(src, 'const ANNOUNCE_SEC ='),
  lift(src, 'async function chainSkew('), lift(src, 'async function clockProblem('), lift(src, 'function answerFloor('),
  lift(src, 'function terraTimeout('), line(src, 'const MARGIN ='), lift(src, 'function heldAt('),
  'return { clockProblem, answerFloor, terraTimeout, heldAt };'].join('\n'))(
  () => NOW,
  async () => ({ block: { header: { time: new Date(BLOCK * 1000).toISOString() } } }),
  { lcd: 'https://lcd.test' }, POLICY);

group('the seller’s clock is checked against the chain (E3)');
{
  let f = make();
  ok('a clock in step answers', (await f.clockProblem(true)) === '');
  BLOCK = NOW - 8; f = make();
  ok('a block a few seconds old is fine', (await f.clockProblem(true)) === '');
  BLOCK = NOW + 3600; f = make();
  ok('a phone an hour behind is stopped before anything is locked', /60 min off/.test(await f.clockProblem(true)));
  BLOCK = NOW - 45 * 60; f = make();
  ok('a phone 45 min ahead is stopped too', /45 min off/.test(await f.clockProblem(true)));
  BLOCK = NOW;
}

group('the margin the wallet keeps and the one the Worker allows (E3)');
for (const [name, p] of [['mainnet', MAIN], ['testnet', TEST]]) {
  POLICY = p; const f = make();
  const floor = f.answerFloor(p) - NOW;
  ok(name + ': the Worker’s slack is pinned', Number(p.report_slack_sec) > 0);
  ok(name + ': the wallet asks for more than the Worker will check at report time',
     floor > p.min_terra_left_sec - p.report_slack_sec, floor);
  ok(name + ': and leaves at least a minute for the PIN, the block and the report',
     floor - (p.min_terra_left_sec - p.report_slack_sec) >= 60, floor);
  // the latest answer: announced 35 min after Pay, answered at the end of the window
  const pay = NOW - (35 * 60 + p.answer_window_sec);
  const n = { timeout: pay + p.min_ton_left_sec + 35 * 60 };
  ok(name + ': a take announced late and answered at the end of the window can still be answered',
     f.terraTimeout(n) >= f.answerFloor(p), (f.terraTimeout(n) - NOW) + ' vs ' + floor);
  ok(name + ': the buyer keeps at least the relayer’s claim margin', p.min_terra_left_sec - p.report_slack_sec >= (name === 'mainnet' ? 3600 : 300));
}
POLICY = MAIN;

group('a take without an intent is held to the offer as it was when paid (E4)');
{
  const f = make();
  const paid = NOW - 50 * 60;
  const n = { timeout: paid + MAIN.min_ton_left_sec + 35 * 60 };
  ok('without held_since the pay time comes from the TON lock', f.heldAt({}, n) === paid, f.heldAt({}, n) - NOW);
  ok('an offer that ended after Pay is not "ended" for this take', !(NOW - 10 * 60 <= f.heldAt({}, n)));
  ok('a lock timeout from a clock ahead never moves it past now', f.heldAt({}, { timeout: NOW + 10 * 86400 }) === NOW);
  ok('no lock read: now, as before', f.heldAt({}, null) === NOW);
  const c = NOW - 600;
  ok('held_since inside the intent’s life still wins', f.heldAt({ held_since: c - 300, created: c }, n) === c - 300);
}

group('texts (E1, E2, 5, 9)');
{
  const refundTexts = ['If unclaimed', "is back on your address, ' + backNote()", 'it can come back to you now, \' + backNote()'];
  ok('every refund text says the burn tax is taken again', refundTexts.every(t => src.includes(t)) && !src.includes("the LUNC comes back to you after that'"));
  ok('the buyer is no longer told it may close the page', !/even if you close this page/.test(src));
  ok('"no gas needed" says when', src.includes('no gas needed when the relayer claims'));
  ok('the Sell form names the real reserve', !src.includes('50 LUNC kept for gas') && src.includes("human(GAS_RESERVE, 6) + ' LUNC kept for gas"));
  ok('watchBuys is not stopped by a hidden tab', !/WATCHING_BUYS \|\| document\.hidden/.test(src));
  ok('a phone is told to keep it on screen', /on a phone, keep it on screen/.test(src) && !/a background tab is fine\)/.test(src.replace(/KEEP_OPEN = .*/, '')));
  ok('the seller sees the refund\u2019s burn tax before publishing', /el\.textContent \+= ' If a buyer never claims, your LUNC comes back ' \+ backNote\(\)/.test(src));
  const terms = fs.readFileSync(path.resolve(SRC, '..', '..', 'terms.html'), 'utf8');
  ok('Terms: no "do not need to remain online"', !/do not need to remain\s+online/.test(terms));
  ok('Terms: the 7-day hold after an unclaimed answer, and how to have it lifted',
     /cannot accept offers for 7 days after that lock\s+expired/.test(terms) && /may ask a team member to lift the\s+hold/.test(terms));
  ok('Terms: on a phone the wallet stays on screen', /On a phone, including inside Telegram, the\s+wallet must stay on screen/.test(terms));
  ok('Terms: the refund pays the burn tax again', /charges the burn tax again/.test(terms));
  ok('Terms: late responses are checked, not ignored', !/does not process that/.test(terms));
}
report();
