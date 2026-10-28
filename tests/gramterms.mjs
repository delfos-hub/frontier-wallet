/* The Terms of Use the swap is offered under.

   Accepted once per address and version, before the first offer or buy; a
   new version (or the draft marker coming off) asks again. termsAccepted()
   is lifted from the shipped gram.js; the page and the sheet are checked
   in the shipped files. */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const ROOT = path.resolve(SRC, '..', '..');
const { TERMS } = await import(pathToFileURL(path.join(SRC, 'gram-net.js')).href);
const src = fs.readFileSync(path.join(SRC, 'gram.js'), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('not found: ' + header);
}
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
let me = 'terra1alice';
const make = terms => new Function('TERMS', 'localStorage', 'addrOf',
  "const termsKey = () => 'fw:gram:terms:' + addrOf();\n" + lift(src, 'function termsAccepted(){') + '\nreturn termsAccepted;')(terms, localStorage, () => me);

group('accepting the Terms of Use');
const accepted = make(TERMS);
ok('not accepted on a fresh wallet', accepted() === false);
store['fw:gram:terms:terra1alice'] = TERMS.version;
ok('accepted once this version is stored for this address', accepted() === true);
me = 'terra1bob';
ok('another address on the same device has to accept for itself', accepted() === false);
me = 'terra1alice';
ok('a new version asks again', make(Object.assign({}, TERMS, { version: '1.1' }))() === false);
ok('the version is 1.0, the text approved by the team', TERMS.version === '1.0' && TERMS.label === '1.0');

group('the page and the sheet');
const page = fs.readFileSync(path.join(ROOT, TERMS.url), 'utf8');
ok('terms.html ships with the wallet', page.length > 5000);
ok('it shows the same version', page.includes('Version ' + TERMS.label));
ok('no reviewers\u2019 notes, draft marks or [TBD] left in the public page', !/For reviewers|remove before publishing|\[TBD|\(draft\)/i.test(page));
ok('the fee is shown as the service fee, with its recipient', /'<div><span>Service fee<\/span>/.test(src) && /Fee goes to/.test(src) && !/Relayer fee/.test(src));
ok('all twelve sections are there', (page.match(/<h2/g) || []).length === 12);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('the sheet, its accept button and the link are in index.html', ['id="gx-terms"', 'id="gx-terms-ok"', 'id="gx-terms-link"', 'id="gx-terms-full"'].every(x => html.includes(x)));
ok('both the offer and the buy wait for the terms', (src.match(/await needTerms\(\)/g) || []).length === 2);

report();
