/* Text from the chain is shown as text. A memo, a token's symbol, a failed
   transaction's log are written by whoever sent them; drawn as markup, one
   with an onerror= ran inside the wallet. These keep that from coming back. */
import fs from 'fs';
import path from 'path';
import { ok, group } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const ROOT = path.resolve(SRC, '..', '..');
const line = (s, h) => { const i = s.indexOf(h); return s.slice(i, s.indexOf('\n', i)); };
function block(s, h){
  const i = s.indexOf(h); let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d++; else if (s[k] === '}' && !--d) return s.slice(i, k + 1);
  }
}
const chain = fs.readFileSync(path.join(SRC, 'chain.js'), 'utf8');
const act = fs.readFileSync(path.join(SRC, 'activity.js'), 'utf8');
const escAt = chain.indexOf('const esc = s =>');
const escSrc = chain.slice(escAt, chain.indexOf('[c]);', escAt) + 5);
const lib = new Function(line(chain, 'const clean = ') + '\n' + escSrc + '\n' + block(act, 'function row(') +
  '\nreturn { clean: clean, esc: esc, row: row };')();
const BAD = '<img src=x onerror=alert(1)>';

group('text from the chain stays text');
{
  ok('a memo is escaped in the details', lib.row('Memo', BAD).indexOf('<img') < 0, lib.row('Memo', BAD));
  ok('so are quotes', lib.esc('"\'`').indexOf('"') < 0);
  ok('a symbol loses its markup where it enters', lib.clean(BAD).indexOf('<') < 0 && lib.clean(BAD).indexOf('>') < 0);
  ok('a normal symbol is untouched', lib.clean('LUNC') === 'LUNC' && lib.clean('USDC.inj') === 'USDC.inj');
  ok('and kept short', lib.clean('X'.repeat(100), 16).length === 16);
}

group('the page runs only its own scripts');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  ok('a Content-Security-Policy is set', !!csp);
  ok('scripts only from this site', csp && /script-src 'self'(;|$)/.test(csp[1]) && csp[1].indexOf('unsafe-inline') < 0, csp && csp[1]);
  ok('no inline <script> block', !/<script(?![^>]*\ssrc=)[^>]*>/i.test(html));
  ok('no inline event handlers', !/\son[a-z]+="/i.test(html));
}
