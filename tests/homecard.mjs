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
ok('market facts: best price, deal size, time', /id="xc-gram-price"/.test(card) && /id="xc-gram-size"/.test(card) && /Usually done in/.test(card));
ok('a deal state with its steps and an Open button', /id="xc-gram-deal"/.test(card) && /id="xc-gram-steps"><i><\/i><i><\/i><i><\/i><i><\/i>/.test(card) && /id="xc-gram-deal-go"/.test(card));
ok('the buttons open the swap on their tab', /function openSwap\(name\)\{ if \(name\) tab\(name\)/.test(gram));
ok('a buyer waiting for an answer takes the card over', /if \(WAITING_N !== n\) \{ WAITING_N = n; homeDeal\(\); \}/.test(gram));
ok('the market is read at most every 2 minutes, and not in a hidden tab', /now\(\) - HOME_AT < 120/.test(gram) && /card\.hidden \|\| document\.hidden/.test(gram));
ok('Worker numbers reach the card as text only', !/innerHTML/.test(gram.slice(gram.indexOf('function homeDeal('), gram.indexOf('function homeCard('))));

group('Favorites');
ok('nothing drawn over the chart: the change sits by the price', /<div class="fav-row"><div class="fav-v">/.test(fav) && !/fav-span/.test(fav));
ok('the hours under the price, the chart last', /'<em>' \+ ch\.hours \+ 'h<\/em>'/.test(fav) && /\(ch \? line\(ch\.pts, up\) : '<div class="fav-nol"><\/div>'\) \+ '<\/div>';/.test(fav));
report();
