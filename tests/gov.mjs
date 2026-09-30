/* Governance vote, byte for byte.

   MsgVote (cosmos.gov.v1) is hand-encoded in tx.js like every other message;
   the expected bytes were generated once with cosmjs-types 0.9.0 and pasted in.

       node tests/gov.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const D = 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l';
const EXPECTED = {
  "yes": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123308c25f122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1801",
  "abstain": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123308c25f122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1802",
  "no": "0a162f636f736d6f732e676f762e76312e4d7367566f746512320807122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1803",
  "veto": "0a162f636f736d6f732e676f762e76312e4d7367566f7465123408e0a712122c7465727261316a68746d6b6d616b6a76767477757230356b6c63376664373265356e33396d3478373563326c1804"
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-'));
const stubs = {
  'chain.js': `export const LCD=''; export const amt=()=>0; export const fmt=String; export const getJSON=async()=>({});
export const iconHTML=()=>''; export const paintIcons=()=>{};`,
  'shell.js': `export const $=()=>null; export const buzz=()=>{}; export const go=()=>{}; export const tap=()=>{};`,
  'state.js': `export const S={};`,
  'tokens.js': `export const heldTokens=()=>[]; export const refreshBalances=()=>{};`,
};
for (const [f, src] of Object.entries(stubs)) fs.writeFileSync(path.join(dir, f), src);
fs.writeFileSync(path.join(dir, 'tx.js'), fs.readFileSync(path.resolve('assets/js/tx.js'), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
globalThis.document = { getElementById: () => null, querySelector: () => null, addEventListener(){} };
const tx = await import(pathToFileURL(path.join(dir, 'tx.js')).href);

const hex = b => Buffer.from(b).toString('hex');
let pass = 0, fail = 0;
function check(name, got, want){
  if (got === want) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + got + '\n       want ' + want); }
}
function throws(name, fn, re){
  try { fn(); fail++; console.log('  FAIL ' + name + ' (was allowed)'); }
  catch (e) { if (re.test(e.message)) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + ': ' + e.message); } }
}

console.log('MsgVote vs cosmjs-types');
check('yes on 12226', hex(tx.voteAny(D, '12226', 'yes')), EXPECTED.yes);
check('abstain on 12226', hex(tx.voteAny(D, '12226', 'abstain')), EXPECTED.abstain);
check('no on 7', hex(tx.voteAny(D, '7', 'no')), EXPECTED.no);
check('veto on 300000', hex(tx.voteAny(D, '300000', 'veto')), EXPECTED.veto);
throws('unknown option refused', () => tx.voteAny(D, '1', 'maybe'), /unknown vote option/);
throws('proposal 0 refused', () => tx.voteAny(D, '0', 'yes'), /bad proposal id/);


// gov.js touches the page when it loads, so its two pure helpers are lifted out
// of the shipped source text and run on their own.
const gsrc = fs.readFileSync(path.resolve('assets/js/gov.js'), 'utf8');
const rewrap = new Function(gsrc.slice(gsrc.indexOf('const B32'), gsrc.indexOf('const accOf')) + '; return rewrap;')();
const APP_TAG = new Function(gsrc.slice(gsrc.indexOf('const APP_TAG'), gsrc.indexOf('let VALS')) + '; return APP_TAG;')();
console.log('\nvalidator account addresses (checked against the bech32 package)');
check('terravaloper1jhtmkma... -> account', rewrap('terravaloper1jhtmkmakjvvtwur05klc7fd72e5n39m4x3c96v', 'terra'), 'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l');
check('terra1jhtmkmak... -> operator', rewrap('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l', 'terravaloper'), 'terravaloper1jhtmkmakjvvtwur05klc7fd72e5n39m4x3c96v');
check('terravaloper1csj849g... -> account', rewrap('terravaloper1csj849g63q7dkgx02djsjjq8ph3ce60mg5tu53', 'terra'), 'terra1csj849g63q7dkgx02djsjjq8ph3ce60mgm8pyz');
check('terra1csj849g6... -> operator', rewrap('terra1csj849g63q7dkgx02djsjjq8ph3ce60mgm8pyz', 'terravaloper'), 'terravaloper1csj849g63q7dkgx02djsjjq8ph3ce60mg5tu53');
check('bad checksum refused', String(rewrap('terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2m', 'terravaloper')), 'null');
console.log('\napp tags are not comments');
check('"Vote with BiNodes Finder" skipped', APP_TAG.test('Vote with BiNodes Finder'), true);
check('"Voted via Station" skipped', APP_TAG.test('Voted via Station'), true);
check('a real reason kept', APP_TAG.test('Voting YES to fund the security audit. Much needed.'), false);
check('"Scammer proposal..." kept', APP_TAG.test('Scammer proposal to take 21 percent of lunc from CP'), false);

// linkify: lifted with its escaper, run on hostile and ordinary text
const escSrc = gsrc.slice(gsrc.indexOf('const esc ='), gsrc.indexOf('const L ='));
const linkSrc = gsrc.slice(gsrc.indexOf('const URL_RE'), gsrc.indexOf('function openOutside'));
const linkify = new Function(escSrc + '\n' + linkSrc + '; return linkify;')();
console.log('\nlinks in proposal text');
check('https link becomes a link showing its own address',
  linkify('Details: https://discourse.luncgoblins.com/t/x/536'),
  'Details: <a class="gov-link" href="https://discourse.luncgoblins.com/t/x/536" rel="noopener noreferrer" target="_blank">https://discourse.luncgoblins.com/t/x/536</a>');
check('trailing full stop stays outside the link',
  linkify('see https://a.io/p.').endsWith('</a>.'), true);
check('http:// is not linked', linkify('http://a.io/x').includes('<a'), false);
check('javascript: is not linked', linkify('javascript:alert(1)').includes('<a'), false);
check('a quote ends the link and is escaped, no attribute injection',
  linkify('https://a.io/"onmouseover="x').includes('href="https://a.io/"') && linkify('https://a.io/"onmouseover="x').includes('&quot;onmouseover'), true);
check('markup in the text is escaped', linkify('<img src=x onerror=1> https://a.io').startsWith('&lt;img'), true);
check('& in a link is escaped in the href', linkify('https://a.io/?a=1&b=2').includes('href="https://a.io/?a=1&amp;b=2"'), true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
