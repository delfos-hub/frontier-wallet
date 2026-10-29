/* The wallet book: an old single-wallet save must open as a book of one,
   untouched, and a new book must be read back as it was written. */
import fs from 'fs';
import path from 'path';
import { ok, group } from './harness.mjs';

function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found in storage.js: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}

const SRC = path.resolve(process.argv[2] || 'assets/js');
const src = fs.readFileSync(path.join(SRC, 'storage.js'), 'utf8');
const parseBook = new Function(lift(src, 'function parseBook(') + '\nreturn parseBook;')();

group('the wallet book');
{
  const blob = { v: 1, kdf: 'pbkdf2-sha256', iter: 600000, salt: 's', iv: 'i', ct: 'c' };
  const old = parseBook(JSON.stringify({ addr: 'terra1old', blob: blob }));
  ok('an old save becomes a book of one', old && old.list.length === 1 && old.active === old.list[0].id);
  ok('named Main, same address', old.list[0].name === 'Main' && old.list[0].addr === 'terra1old');
  ok('the encrypted phrase is carried over byte for byte', JSON.stringify(old.list[0].blob) === JSON.stringify(blob));
  const book = { v: 2, active: 'w2', list: [{ id: 'w1', name: 'Main', addr: 'a', blob: blob }, { id: 'w2', name: 'Watch 1', addr: 'b', watch: true }] };
  const back = parseBook(JSON.stringify(book));
  ok('a book reads back as written', JSON.stringify(back) === JSON.stringify(book));
  ok('nothing stored is no book', parseBook(null) === null && parseBook('') === null);
  ok('garbage is no book, not a crash', parseBook('{not json') === null);
}
