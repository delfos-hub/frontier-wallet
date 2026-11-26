/* amount.js - a typed amount, read once into the token's base units (#85).

   Every screen that takes an amount (send, swap, staking, the GRAM and DEV
   forms) reads it here, in the language the wallet is shown in, and from
   then on carries the integer it got: the quote, the dollar line, the review
   and the signed message all use that one value. Nothing parses the text a
   second time, and no float sits between the field and the transaction.

   The separators follow the interface language:
     en           1,234.5    comma groups, point is the decimal
     fr, ru       1 234,5    spaces group (normal, no-break, narrow), comma is the decimal
     it, es, tr   1.234,5    point groups, comma is the decimal
   A single separator followed by three digits ("12,345", "12.345") is read
   as the decimal only when it is this language's decimal separator; anything
   else is refused with a question rather than guessed: "12,345" in English,
   "12.345" in Italian, Spanish, Turkish, French or Russian. "12,5", "0,345",
   "1.5", "12 345,678" and "12.345,678" can only mean one thing and are read.
   More digits after the decimal than the token has is refused too: a wallet
   never sends something other than what was typed.

   No DOM, no imports: tests/amount.mjs runs it in Node. */

export const SEPS = {
  en: { dec: '.', group: ',' },
  fr: { dec: ',', group: ' ' },
  ru: { dec: ',', group: ' ' },
  it: { dec: ',', group: '.' },
  es: { dec: ',', group: '.' },
  tr: { dec: ',', group: '.' },
};
const SPACES = /[\s   ']/g;

export function currentLang(){
  const l = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en';
  return SEPS[l] ? l : 'en';
}

function fail(code, message){ const e = new Error(message); e.code = code; return e; }

// groups after the first: exactly three digits each; the first: one to three
const grouped = (s, sep) => new RegExp('^[0-9]{1,3}(\\' + sep + '[0-9]{3})+$').test(s);

/* The text as typed or pasted -> the amount in base units, as a string of
   digits. Throws an Error with .code: empty, format, ambiguous, precision. */
export function parseAmount(text, dec, lang){
  const L = SEPS[lang] || SEPS.en;
  if (text && typeof text === 'object' && /^[0-9]+$/.test(String(text.raw))) return String(BigInt(text.raw));
  let s = String(text == null ? '' : text).trim();
  if (!s) throw fail('empty', 'Enter an amount first.');
  // spaces group in any language (a pasted "12 345" or "12 345"), and only
  // between digits
  if (/[^0-9.,\s   ']/.test(s)) throw fail('format', 'That is not an amount: use digits, and one decimal separator.');
  if (/[\s   ']/.test(s)) {
    const parts = s.split(SPACES);
    if (!grouped(parts.join(' ').replace(/[.,][0-9]*$/, ''), ' ') && parts.length > 1)
      throw fail('format', 'That is not an amount: digits are grouped by three.');
    s = s.replace(SPACES, '');
  }
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  let whole, frac = '';
  if (dots && commas) {
    // both: the last one is the decimal, the other groups
    const d = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',', g = d === '.' ? ',' : '.';
    if (s.split(d).length !== 2) throw fail('format', 'That is not an amount: one decimal separator only.');
    [whole, frac] = s.split(d);
    if (!grouped(whole, g)) throw fail('format', 'That is not an amount: digits are grouped by three.');
    whole = whole.split(g).join('');
  } else if (dots + commas === 0) {
    whole = s;
  } else {
    const sep = dots ? '.' : ',', n = dots + commas;
    if (n > 1) {
      // several of one kind: only grouping can repeat
      if (!grouped(s, sep)) throw fail('format', 'That is not an amount: one decimal separator only.');
      whole = s.split(sep).join('');
    } else {
      const [a, b] = s.split(sep);
      // "12,345" / "12.345": a group of three after a group of up to three
      // could be a thousand or three decimals
      const couldGroup = /^[1-9][0-9]{0,2}$/.test(a) && /^[0-9]{3}$/.test(b);
      // read as the decimal only where this language writes it that way;
      // anywhere else it is a question, not a guess
      if (couldGroup && sep !== L.dec)
        throw fail('ambiguous', 'That could be ' + a + b + ' or ' + a + L.dec + b + ': write ' + a + b + ', or ' + a + L.dec + b + ' for the decimals.');
      whole = a; frac = b;
    }
  }
  if (whole === '' && frac === '') throw fail('format', 'That is not an amount.');
  if (!/^[0-9]*$/.test(whole) || !/^[0-9]*$/.test(frac)) throw fail('format', 'That is not an amount.');
  if (frac.replace(/0+$/, '').length > dec) throw fail('precision', 'This token has ' + dec + ' decimals: that amount has more.');
  frac = frac.slice(0, dec);
  const out = ((whole || '0') + frac + '0'.repeat(dec - frac.length)).replace(/^0+(?=[0-9])/, '');
  return out;
}

/* Base units -> text in the language's separators, every digit kept (no
   rounding: what is shown before signing is exactly what is signed).
   group: false gives a value for an input field. */
export function formatRaw(raw, dec, lang, opts){
  const L = SEPS[lang] || SEPS.en;
  const group = !(opts && opts.group === false);
  let s = String(BigInt(raw == null || raw === '' ? 0 : String(raw)));
  const neg = s[0] === '-'; if (neg) s = s.slice(1);
  s = s.padStart(dec + 1, '0');
  let whole = dec ? s.slice(0, -dec) : s, frac = dec ? s.slice(-dec).replace(/0+$/, '') : '';
  if (group) whole = whole.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, L.group === ' ' ? ' ' : L.group);
  return (neg ? '-' : '') + whole + (frac ? L.dec + frac : '');
}

// a number the wallet worked out (a balance, a share of it) -> base units,
// floored, without the float's own decimal digits going through any parser
export function rawFromNumber(v, dec){
  if (!(v > 0) || !isFinite(v)) return '0';
  const s = v.toFixed(Math.min(dec, 20));
  const [w, f = ''] = s.split('.');
  return ((w + f.padEnd(dec, '0').slice(0, dec)).replace(/^0+(?=[0-9])/, '')) || '0';
}
