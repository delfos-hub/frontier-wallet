/* Interface languages (i18n-dict.js, i18n.js): every language has every
   string, the tab labels fit the dock, and the page carries the hooks the
   module looks for. */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const ROOT = path.resolve(SRC, '..', '..');
const { LANGS, KEYS, ROWS, DICT, EXTRA } = await import(pathToFileURL(path.join(SRC, 'i18n-dict.js')).href);

group('the dictionary');
ok('six languages, English first', LANGS.length === 6 && LANGS[0].code === 'en');
ok('every language but English has a dictionary', LANGS.slice(1).every(l => DICT[l.code]));
for (const code in ROWS) {
  ok(code + ': one translation per string, none empty',
     ROWS[code].length === KEYS.length && ROWS[code].every(s => typeof s === 'string' && s.trim().length > 0));
  ok(code + ': tab labels fit the dock (9 characters at most)',
     KEYS.filter(k => k.slice(0, 5) === '@tab.').every(k => DICT[code][k].length <= 9));
}
ok('no key repeats', new Set(KEYS).size === KEYS.length);
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
ok('Staking and Governance: five translations per string, none empty',
   Object.keys(EXTRA).every(k => EXTRA[k].length === 5 && EXTRA[k].every(s => s.trim().length > 0)));
ok('every pattern keeps its placeholders in every language',
   Object.keys(EXTRA).every(k => EXTRA[k].every(s => ph(s) === ph(k))));

group('the page');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('the five tabs are keyed', ['home', 'stake', 'vote', 'activity', 'settings'].every(t => html.includes('data-i18n="tab.' + t + '"')));
ok('Settings has the language row, the picker and its grid', ['id="set-lang"', 'id="lang-sheet"', 'id="lang-grid"', 'id="lang-cur"'].every(x => html.includes(x)));
ok('the rows other modules wire up are still there', ['id="set-wallets"', 'id="set-seed"', 'id="btn-lock"', 'id="btn-close"', 'id="btn-reset"', 'id="store-kind"'].every(x => html.includes(x)));
const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
ok('app.js loads i18n.js', /import '\.\/i18n\.js(\?v=[0-9a-f]+)?';/.test(app));

report();
