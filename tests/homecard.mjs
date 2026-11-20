/* The home page: the GRAM swap card's markup and states, and the Favorites
   card layout (static checks: both modules touch the DOM when they load). */
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const html = fs.readFileSync(path.resolve(SRC, '..', '..', 'index.html'), 'utf8');
const gram = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
const fav = fs.readFileSync(path.join(SRC, 'fav.js'), 'utf8');

group('the GRAM card');
const card = html.slice(html.indexOf('id="xc-gram"'), html.indexOf('id="xc-gram-acts"') + 600);
ok('a div holding buttons, not a button holding buttons', /<div class="xc xg" id="xc-gram"/.test(html) && !/<button class="xc"[^>]*id="xc-gram"/.test(html));
ok('both directions on the card', /data-tab="buy"><b>Buy LUNC<\/b><small>pay with GRAM/.test(card) && /data-tab="sell"><b>Sell LUNC<\/b><small>get GRAM/.test(card));
ok('market facts: best price, deal size, time', /id="xc-gram-price"/.test(card) && /id="xc-gram-size"/.test(card) && /id="xc-gram-time"/.test(card) && !/about 5 min/.test(card));
ok('a deal state with its steps and an Open button', /id="xc-gram-deal"/.test(card) && /id="xc-gram-steps"><i><\/i><i><\/i><i><\/i><i><\/i>/.test(card) && /id="xc-gram-deal-go"/.test(card));
ok('the buttons open the swap on their tab', /function openSwap\(name\)\{ if \(name\) tab\(name\)/.test(gram));
ok('a buyer waiting for an answer takes the card over', /if \(WAITING_N !== n\) \{ WAITING_N = n; homeDeal\(\); \}/.test(gram));
ok('the market is read at most every 2 minutes, and not in a hidden tab', /now\(\) - HOME_AT < 120/.test(gram) && /card\.hidden \|\| document\.hidden/.test(gram));
const deal = gram.slice(gram.indexOf('function homeDeal('), gram.indexOf('async function homeMarket('));
ok('an unanswered or refunding buy is a running deal on the card', /unanswered: 4, refunding: 5/.test(deal) && /The seller did not answer/.test(deal) && /Refund sent/.test(deal));
ok('a refund that can be taken now is flagged, in every stage the Buy tab offers it for (review of 3fccf9a)',
  /const back = late && \['unanswered', 'announced', 'sent', 'refunding', 'claiming'\]/.test(deal) && /hot: back, go: back \? 'Get GRAM back'/.test(deal) &&
  /'unanswered', 'announced', 'sent', 'refunding', 'claiming'\]\.includes\(b\.stage\)/.test(gram.slice(gram.indexOf('function refundBtn('))));
ok('the market is read only while home is the screen shown', /function onHome\(\)/.test(gram) && /document\.hidden \|\| !onHome\(\)/.test(gram));
ok('the answer window comes from the policy', /aw = Number\(p\.answer_window_sec\)/.test(gram) && /time: aw > 0 \? 'up to '/.test(gram));
ok('the last figures are kept per network and painted at once', /const HOME_KEY = 'fw:gram:home:' \+ NET\.name;/.test(gram) && /paintMarket\(keptMarket\(\)\)/.test(gram));
ok('kept figures are a day old at most and painted as text', /now\(\) - Number\(m\.at\) < 86400/.test(gram) && !/innerHTML/.test(gram.slice(gram.indexOf('function paintMarket('), gram.indexOf('async function homeMarket('))));
ok('home shown reads the market at once (not only a click or the 30 s tick)', /new MutationObserver\(\(\) => \{ if \(onHome\(\)\) homeCard\(false\); \}\)/.test(gram));
ok('a failed read does not hold the next one back 2 minutes', /catch \(e\) \{ HOME_AT = 0; return; \}/.test(gram));
ok('Worker numbers reach the card as text only', !/innerHTML/.test(gram.slice(gram.indexOf('function homeDeal('), gram.indexOf('function homeCard('))));

group('Favorites');
ok('nothing drawn over the chart: the change sits by the price', /<div class="fav-row"><div class="fav-v">/.test(fav) && !/fav-span/.test(fav));
ok('the span under the price, the chart last', /'<em>' \+ spanLabel\(ch\) \+ '<\/em>'/.test(fav) && /\(ch \? line\(ch\.pts, up\) : '<div class="fav-nol"><\/div>'\) \+ '<\/div>';/.test(fav));

group('Favorites price record');
{
  const lift = (s, h) => { const i = s.indexOf(h); let d = 0; for (let k = s.indexOf('{', i); k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (!d) return s.slice(i, k + 1); } } };
  const liftLine = (s, h) => { const i = s.indexOf(h); return s.slice(i, s.indexOf('\n', i)); };
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  let T0 = 1_800_000_000;
  const F = new Function('now', [lift(fav, 'function pxBook('), liftLine(fav, 'const PX_KEYS'), lift(fav, 'function recordAll('),
    lift(fav, 'function change('), liftLine(fav, 'const spanLabel'), 'return { recordAll, change, spanLabel, pxBook };'].join('\n'))(() => T0);
  F.recordAll({ 'cw20:a': 1, 'cw20:b': 2 });
  ok('every priced token in the list is recorded, not only favorites', Object.keys(F.pxBook()).length === 2);
  T0 += 600; F.recordAll({ 'cw20:a': 1.1, 'cw20:b': 2 });
  ok('under 15 min of record: no line yet', F.change('cw20:a') === null);
  T0 += 600; F.recordAll({ 'cw20:a': 1.2 });
  const c = F.change('cw20:a');
  ok('from 15 min: the line, labelled in minutes, no % yet', c && c.pct === null && c.pts.length === 3 && F.spanLabel(c) === '20m', JSON.stringify(c));
  for (let i = 0; i < 4; i++) { T0 += 600; F.recordAll({ 'cw20:a': 1.3 }); }
  const d = F.change('cw20:a');
  ok('from an hour: the % change and hours', d && Math.abs(d.pct - 30) < 1e-9 && F.spanLabel(d) === '1h', JSON.stringify(d && d.pct));
  T0 += 27 * 3600; F.recordAll({ 'cw20:a': 1.3 });
  ok('a token not seen for 26 h drops out', !('cw20:b' in F.pxBook()) && F.pxBook()['cw20:a'].length === 1);
  const many = {}; for (let i = 0; i < 100; i++) many['cw20:t' + i] = 1;
  F.recordAll(many);
  ok('the record is bounded', Object.keys(F.pxBook()).length === 80);
}
report();
