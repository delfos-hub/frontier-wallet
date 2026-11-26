/* Amounts typed in each interface language (assets/js/amount.js, #85).

   One parser for every form: the quote, the dollar line, the review and the
   signed message all use the integer it returns. The issue's example is
   12,345.678 LUNC written the way each language writes it: every reading
   below must give exactly 12,345,678,000 base units at six decimals.

       node tests/amount.mjs
*/
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const A = await import(pathToFileURL(path.resolve('assets/js/amount.js')).href);
const src = f => fs.readFileSync(path.resolve('assets/js/' + f), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more !== undefined ? '\n       ' + more : '')); }
}
const P = (s, l, d = 6) => { try { return A.parseAmount(s, d, l); } catch (e) { return 'ERR:' + e.code; } };
const N = '12345678000';

console.log('the issue’s example, in every language');
ok('English  12,345.678', P('12,345.678', 'en') === N, P('12,345.678', 'en'));
ok('French   12 345,678 (narrow no-break space, U+202F)', P('12 345,678', 'fr') === N, P('12 345,678', 'fr'));
ok('French   12 345,678 (plain space, as typed)', P('12 345,678', 'fr') === N);
ok('Russian  12 345,678 (no-break space, U+00A0)', P('12 345,678', 'ru') === N, P('12 345,678', 'ru'));
for (const l of ['it', 'es', 'tr']) ok(l + '       12.345,678', P('12.345,678', l) === N, P('12.345,678', l));
ok('without grouping it reads the same: 12345,678 in French, 12345.678 in English', P('12345,678', 'fr') === N && P('12345.678', 'en') === N);

console.log('\nthe same text, another meaning: asked, not guessed');
ok('"12,345" in English (twelve thousand, or 12.345?)', P('12,345', 'en') === 'ERR:ambiguous');
ok('"12.345" in Italian, Spanish, Turkish', ['it', 'es', 'tr'].every(l => P('12.345', l) === 'ERR:ambiguous'));
ok('"12.345" in French and Russian (English decimals, or Italian grouping?)', P('12.345', 'fr') === 'ERR:ambiguous' && P('12.345', 'ru') === 'ERR:ambiguous');
ok('"12,345" in French is the French decimal: 12.345', P('12,345', 'fr') === '12345000');
ok('"12.345" in English is the English decimal: 12.345', P('12.345', 'en') === '12345000');
let msg = ''; try { A.parseAmount('12,345', 6, 'en'); } catch (e) { msg = e.message; }
ok('the question names both readings and how to write each', msg === 'That could be 12345 or 12.345: write 12345, or 12.345 for the decimals.', msg);

console.log('\nwhat can only mean one thing is read');
ok('"1,5" in English: one and a half (a comma that cannot group)', P('1,5', 'en') === '1500000');
ok('"1.5" in Italian: one and a half', P('1.5', 'it') === '1500000');
ok('"0,345" anywhere: a decimal', ['en', 'fr', 'it'].every(l => P('0,345', l) === '345000'));
ok('"1.234.567" in Italian and "1,234,567" in English: millions', P('1.234.567', 'it') === '1234567000000' && P('1,234,567', 'en') === '1234567000000');
ok('"1 234 567" in French', P('1 234 567', 'fr') === '1234567000000');

console.log('\nbelow one token, and the token’s precision');
ok('"0,000001" in French: one base unit', P('0,000001', 'fr') === '1');
ok('"0.5" in English, "0,5" in Russian', P('0.5', 'en') === '500000' && P('0,5', 'ru') === '500000');
ok('seven decimals on a six-decimal token are refused, not cut', P('1.0049991', 'en') === 'ERR:precision');
ok('trailing zeros past the precision are fine', P('1.0000000', 'en') === '1000000');
ok('nine-decimal GRAM reads nine', P('1,5', 'fr', 9) === '1500000000');

console.log('\nnot an amount');
ok('letters, exponents, signs', ['abc', '1e5', '-1', '+1', '1..2', '1,,2'].every(s => /^ERR:/.test(P(s, 'en'))));
ok('a broken group', P('12 34', 'fr') === 'ERR:format' && P('1,23,456', 'en') === 'ERR:format');
ok('empty says so', P('', 'en') === 'ERR:empty' && P('   ', 'fr') === 'ERR:empty');
ok('an already-read amount ({ raw }) passes through untouched', A.parseAmount({ raw: '12345678000' }, 6, 'it') === N);

console.log('\nshown before signing: every digit, in the language’s separators');
ok('12,345.678 in English', A.formatRaw(N, 6, 'en') === '12,345.678');
ok('12 345,678 in French (no-break space)', A.formatRaw(N, 6, 'fr') === '12 345,678');
ok('12.345,678 in Italian', A.formatRaw(N, 6, 'it') === '12.345,678');
ok('1.004999 stays 1.004999 (not "1")', A.formatRaw('1004999', 6, 'en') === '1.004999');
ok('one base unit', A.formatRaw('1', 6, 'fr') === '0,000001');

console.log('\nMax and the percent buttons write what reads back');
for (const l of ['en', 'fr', 'ru', 'it', 'es', 'tr']) {
  const back = ['12345678000', '12345000', '1004999', '1', '1000000'].every(r => A.parseAmount(A.formatRaw(r, 6, l, { group: false }), 6, l) === r);
  ok(l + ': a field filled by the wallet reads back to the same base units', back);
}
ok('a worked-out balance becomes base units without float noise', A.rawFromNumber(0.1 + 0.2, 6) === '300000' && A.rawFromNumber(12345.678, 6) === N);

console.log('\none value from the field to the signature');
const tx = src('tx.js'), swap = src('swap.js'), stake = src('stake.js'), gram = src('gram.js');
ok('tx.js parses through amount.js in the interface language', /function toRaw\(human, dec\)\{\s*return parseAmount\(human, dec, currentLang\(\)\);/.test(tx));
ok('the field is read into a let, so it can be replaced by { raw }', /let human = \$\('#send-amt'\)\.value\.trim\(\);/.test(tx));
ok('the send review parses once and hands on { raw }', /try \{ rawAmt = toRaw\(human, dec\); \}[\s\S]{0,200}human = \{ raw: rawAmt \};/.test(tx));
ok('and shows every digit of it', (tx.match(/full\(rawAmt\)/g) || []).length === 4 && /line\('Amount', full\(d\.amount\)/.test(tx));
ok('swap: "You pay" is the quoted offerRaw, every digit', /\$\('#cf-from'\)\.textContent = formatRaw\(QUOTE\.offerRaw, decOf\(FROM\), currentLang\(\)\)/.test(swap));
ok('swap: no parseFloat of the field is left', !/parseFloat\(String\(\$\('#sw-amt'\)/.test(swap));
ok('swap: percent buttons write the language’s separator', /formatRaw\(rawFromNumber\(v, decOf\(FROM\)\), decOf\(FROM\), currentLang\(\), \{ group: false \}\)/.test(swap));
ok('send Max writes the language’s separator', (tx.match(/\$\('#send-amt'\)\.value = [^;]*formatRaw\(/g) || []).length === 2);
ok('staking: Max writes it, the review shows every digit', /\$\('#stk-amt'\)\.value = formatRaw\(String\(lim\.max\), 6, currentLang\(\), \{ group: false \}\)/.test(stake) &&
  /const a = formatRaw\(String\(f\.amount\), 6, currentLang\(\)\) \+ ' LUNC';/.test(stake));
ok('GRAM: no comma swapped for a point before parsing', !/\.replace\(',', '\.'\)/.test(gram));
ok('GRAM: a refused amount is said, not read as zero', /if \(PARSE_ERR\.sell\) out\.errs\.push\(PARSE_ERR\.sell\);/.test(gram));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
