/* Switching wallets on a screen whose reads wait for the move (#77 review).

   Wallet A has a transaction in Activity and a GRAM purchase on Home; B has
   neither. Right after the switch, before any delayed read runs, B must show
   nothing of A's: no Activity rows, no deal amount, no Open button that goes to
   A's tab. After the delay B's own data is drawn. Both delays are run: 280 ms
   (desktop) and 460 ms (phone).

   The handlers are lifted from activity.js and gram.js as they are and run
   against small stand-ins for the page and the timers.

       node tests/walletswitch.mjs
*/
import fs from 'fs';
import path from 'path';
import { ok, group, report } from './harness.mjs';

const act = fs.readFileSync(path.resolve('assets/js/activity.js'), 'utf8');
const gram = fs.readFileSync(path.resolve('assets/js/gram.js'), 'utf8');
const lift = (src, head) => {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('not found: ' + head);
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
};
const A = 'terra1' + 'a'.repeat(38), B = 'terra1' + 'b'.repeat(38);

function page(){
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', hidden: false, className: '',
    classList: (() => { const c = new Set(); return { add: x => c.add(x), remove: x => c.delete(x), toggle: (x, on) => { if (on === undefined ? !c.has(x) : on) c.add(x); else c.delete(x); }, contains: x => c.has(x) }; })(),
    querySelectorAll: () => [] });
  const L = {};
  const doc = { getElementById: el, addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); }, documentElement: { classList: { contains: () => false } }, hidden: false };
  return { el, doc, fire: t => (L[t] || []).forEach(f => f({})) };
}
// timers that run only when the test moves the clock
function clock(){
  let t = 0; const q = [];
  return { setTimeout: (f, ms) => { q.push({ at: t + ms, f }); return q.length; }, clearTimeout: () => {},
    advance(ms){ t += ms; q.sort((a, b) => a.at - b.at); while (q.length && q[0].at <= t) q.shift().f(); } };
}

for (const [where, dk, delay] of [['desktop', true, 280], ['phone', false, 460]]) {
  group('Activity, ' + where + ' (' + delay + ' ms)');
  {
    const P = page(), C = clock(), S = { ADDR: A };
    P.doc.documentElement.classList.contains = x => x === 'dk' && dk;
    const txOf = { [A]: [{ txhash: 'A1' }], [B]: [{ txhash: 'B1' }] };
    const env = new Function('document', 'S', 'setTimeout', 'clearTimeout', 'cachedFor', 'chainFor',
      `let ALL = [], LOADED = '', LOADED_FOR = '', MORE = true, SHOWN = 40;
       const $ = s => document.getElementById(s.replace('#', ''));
       const cached = me => cachedFor[me] || null;
       const clearSummary = () => { document.getElementById('ac-sum').innerHTML = ''; };
       function render(){ document.getElementById('ac-list').innerHTML = ALL.map(t => '<div class="ac-row" data-h="' + t.txhash + '">' + t.txhash + '</div>').join(''); }
       // the read itself: what the chain has for the wallet open now
       function load(){ const me = S.ADDR; if (LOADED === me) return; LOADED_FOR = me; ALL = chainFor[me].slice(); LOADED = me; render(); }
       ${act.slice(act.indexOf('const later = fn =>'), act.indexOf(';', act.indexOf('const later = fn =>')) + 1)}
       ${act.slice(act.indexOf("document.addEventListener('frontier:wallet', () => {"), act.indexOf('});', act.indexOf("document.addEventListener('frontier:wallet', () => {")) + 3)}
       return { load, later, rows: () => document.getElementById('ac-list').innerHTML };`)(P.doc, S, C.setTimeout, C.clearTimeout, {}, txOf);
    env.load();
    ok('A’s Activity shows A’s transaction', /data-h="A1"/.test(env.rows()));
    P.el('ac-sum').innerHTML = 'A figures';
    S.ADDR = B; P.fire('frontier:wallet');
    env.later(env.load);                     // B's Activity opened before its background read
    ok('right after the switch: no row of A’s, a reading state instead', !/A1/.test(env.rows()) && /Reading the chain/.test(env.rows()), env.rows());
    ok('and none of A’s figures', P.el('ac-sum').innerHTML === '');
    C.advance(delay - 1);
    ok('still nothing of A’s just before the read', !/A1/.test(env.rows()));
    C.advance(1);
    ok('after ' + delay + ' ms: B’s own transaction', /data-h="B1"/.test(env.rows()) && !/A1/.test(env.rows()), env.rows());
  }
  {
    // B has a kept list: shown at once instead of the reading state
    const P = page(), C = clock(), S = { ADDR: A };
    const env = new Function('document', 'S', 'setTimeout', 'clearTimeout', 'cachedFor', 'chainFor',
      `let ALL = [], LOADED = '', LOADED_FOR = '', MORE = true, SHOWN = 40;
       const cached = me => cachedFor[me] || null;
       const clearSummary = () => {};
       function render(){ document.getElementById('ac-list').innerHTML = ALL.map(t => '<div class="ac-row">' + t.txhash + '</div>').join(''); }
       function load(){ const me = S.ADDR; LOADED_FOR = me; ALL = chainFor[me].slice(); LOADED = me; render(); }
       ${act.slice(act.indexOf("document.addEventListener('frontier:wallet', () => {"), act.indexOf('});', act.indexOf("document.addEventListener('frontier:wallet', () => {")) + 3)}
       return { load, rows: () => document.getElementById('ac-list').innerHTML };`)(P.doc, S, C.setTimeout, C.clearTimeout, { [B]: [{ txhash: 'Bkept' }] }, { [A]: [{ txhash: 'A1' }], [B]: [] });
    env.load();
    S.ADDR = B; P.fire('frontier:wallet');
    ok('B’s kept history is shown at once, nothing of A’s', /Bkept/.test(env.rows()) && !/A1/.test(env.rows()), env.rows());
  }

  group('GRAM card on Home, ' + where + ' (' + delay + ' ms)');
  {
    const P = page(), C = clock(), S = { ADDR: A };
    const card = P.el('xc-gram');
    const opened = [];
    const buys = { [A]: { x: { stage: 'announced', lunc: '25000000', gram: '3000000000', timeout: String(Date.now() + 3600e3) } }, [B]: {} };
    let market = 0;
    const env = new Function('document', 'S', 'setTimeout', 'clearTimeout', 'buysFor', 'opened', 'marketRead',
      `const $ = s => document.getElementById(s.replace('#', ''));
       const addrOf = () => S.ADDR;
       const card = $('#xc-gram');
       const now = () => Date.now();
       const human = (raw, dec) => String(Number(raw) / Math.pow(10, dec));
       const hm = () => '1 h';
       const buysOf = a => buysFor[a] || {};
       const ownDeals = () => [];
       const mineFor = () => ({});
       const homeMarket = () => { marketRead(); };
       const onHome = () => true;
       function openSwap(name){ opened.push(name); }
       ${gram.slice(gram.indexOf('let HOME_AT = 0, HOME_TAB'), gram.indexOf(';', gram.indexOf('let HOME_AT = 0, HOME_TAB')) + 1)}
       ${lift(gram, 'function homeDeal(')}
       ${gram.slice(gram.indexOf('function homeCard(force)'), gram.indexOf('\n', gram.indexOf('function homeCard(force)')))}
       ${gram.slice(gram.indexOf('const later = fn =>'), gram.indexOf(';', gram.indexOf('const later = fn =>')) + 1)}
       ${gram.slice(gram.indexOf("document.addEventListener('frontier:wallet', () => {\n  WAITING_N = 0;"), gram.indexOf('});', gram.indexOf("document.addEventListener('frontier:wallet', () => {\n  WAITING_N = 0;")) + 3)}
       return { homeDeal, homeCard, later, goDeal: () => openSwap(HOME_TAB), shown: () => !$('#xc-gram-deal').hidden };`)(P.doc, S, C.setTimeout, C.clearTimeout, buys, opened, () => { market++; });
    P.doc.documentElement.classList.contains = x => x === 'dk' && dk;
    env.homeDeal();
    ok('A’s Home shows the purchase and its amount', env.shown() && /Buying 25 LUNC/.test(P.el('xc-gram-deal-t').textContent), P.el('xc-gram-deal-t').textContent);
    env.goDeal();
    ok('A’s Open button goes to the Buy tab', opened.pop() === 'buy');
    S.ADDR = B; P.fire('frontier:wallet');
    env.later(() => env.homeCard(false));    // Home shown after the switch: the read waits for the move
    ok('right after the switch: B’s card shows no deal', !env.shown() && !card.classList.contains('busy') && !card.classList.contains('hot'));
    ok('its market stats are back in place of A’s amount', P.el('xc-gram-stats').hidden === false && P.el('xc-gram-acts').hidden === false);
    env.goDeal();
    ok('and the deal action no longer goes to A’s tab', opened.pop() === '');
    ok('the market read has not run yet', market === 0);
    C.advance(delay);
    ok('after ' + delay + ' ms: the market read runs, B still has no deal', market === 1 && !env.shown());
  }
}
ok('Home shown draws the deal at once and only delays the market read',
  /new MutationObserver\(\(\) => \{ if \(onHome\(\) && card && !card\.hidden\) \{ homeDeal\(\); later\(\(\) => homeCard\(false\)\); \} \}\)/.test(gram));
report();
