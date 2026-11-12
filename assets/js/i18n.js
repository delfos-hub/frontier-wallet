/* i18n.js - interface language, Settings > Language.

   The pages are written in English. In another language every text node whose
   whole text (trimmed) is a key of i18n-dict.js is shown translated, including
   text the other modules render later: a MutationObserver translates what they
   add. The English stays remembered per node, so switching back restores it.
   Elements marked data-i18n="key" (the tab bar) are looked up by "@key".
   A key with {name} in it is a pattern for text built around numbers
   ("{a} of {b} voted"); the values are kept, and translated when they are
   keys themselves. Placeholders of text fields are translated the same way.
   Text that must never change (phrases, hashes, inputs, code) is skipped.

   The first choice follows Telegram's language when Frontier has it; after
   that the user's pick is kept on this device (fw:lang). */
import { $, tap, tg } from './shell.js?v=1072f2a7';
import { LANGS, DICT } from './i18n-dict.js?v=1072f2a7';

const KEY = 'fw:lang';
const SKIP = 'script,style,code,textarea,input,select,[data-no-i18n],.sd-words,.tx-hash';
let LANG = 'en';
const ORIG = new WeakMap();   // text node -> its English text
const WROTE = new WeakMap();  // text node -> the text this module wrote into it

function pick(){
  let c = null;
  try { c = localStorage.getItem(KEY); } catch (e) {}
  if (c === 'en' || (c && DICT[c])) return c;
  const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const l = String((u && u.language_code) || navigator.language || 'en').slice(0, 2).toLowerCase();
  return DICT[l] ? l : 'en';
}

// patterns of the current language: [regex, translation]
let PATS = [];
function buildPats(){
  PATS = [];
  if (LANG === 'en') return;
  for (const k in DICT[LANG]) {
    if (k.indexOf('{') < 0 || k.charAt(0) === '@') continue;
    const src = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}/g, '(?<$1>.+?)');
    try { PATS.push([new RegExp('^' + src + '$'), DICT[LANG][k]]); } catch (e) {}
  }
}
function lookup(key){
  const d = DICT[LANG];
  if (d[key]) return d[key];
  for (const p of PATS) {
    const m = p[0].exec(key);
    if (m) return p[1].replace(/\{(\w+)\}/g, (x, n) => { const v = m.groups[n]; return d[v] || v; });
  }
  return null;
}

function doPh(el){
  if (!el.hasAttribute('data-en-ph')) el.setAttribute('data-en-ph', el.getAttribute('placeholder'));
  const en = el.getAttribute('data-en-ph');
  const t = (LANG !== 'en' && lookup(en)) || en;
  if (el.getAttribute('placeholder') !== t) el.setAttribute('placeholder', t);
}

function doText(n){
  const p = n.parentElement;
  if (!p || p.closest(SKIP) || p.closest('[data-i18n]')) return;
  let src = n.nodeValue;
  if (WROTE.has(n)) {
    if (WROTE.get(n) === src) src = ORIG.get(n);           // still ours: start from the English
    else { WROTE.delete(n); ORIG.delete(n); }              // the app wrote new text into it
  }
  const key = src.trim();
  if (!key) return;
  const tr = LANG !== 'en' && lookup(key);
  if (tr) {
    const out = src.replace(key, tr);
    ORIG.set(n, src); WROTE.set(n, out);
    if (n.nodeValue !== out) n.nodeValue = out;
  } else if (ORIG.has(n)) {
    ORIG.delete(n); WROTE.delete(n);
    if (n.nodeValue !== src) n.nodeValue = src;
  }
}

function doKeyed(el){
  if (!el.hasAttribute('data-en')) el.setAttribute('data-en', el.textContent);
  const t = (LANG !== 'en' && DICT[LANG]['@' + el.getAttribute('data-i18n')]) || el.getAttribute('data-en');
  if (el.textContent !== t) el.textContent = t;
}

function walk(root){
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.matches('[data-i18n]')) doKeyed(root);
  root.querySelectorAll('[data-i18n]').forEach(doKeyed);
  if (root.hasAttribute('placeholder')) doPh(root);
  root.querySelectorAll('[placeholder]').forEach(doPh);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
}

const mo = new MutationObserver(list => {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target);
    else m.addedNodes.forEach(walk);
  }
});

// Flags for the picker: drawn here, because flag emoji do not render on Windows.
const FLAG = {
  en: '<rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0L0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12"/><path d="M30 0v40M0 20h60" stroke="#C8102E" stroke-width="7"/>',
  ru: '<rect width="60" height="40" fill="#fff"/><rect y="13.3" width="60" height="13.4" fill="#0039A6"/><rect y="26.7" width="60" height="13.3" fill="#D52B1E"/>',
  fr: '<rect width="60" height="40" fill="#fff"/><rect width="20" height="40" fill="#002395"/><rect x="40" width="20" height="40" fill="#ED2939"/>',
  it: '<rect width="60" height="40" fill="#fff"/><rect width="20" height="40" fill="#009246"/><rect x="40" width="20" height="40" fill="#CE2B37"/>',
  es: '<rect width="60" height="40" fill="#AA151B"/><rect y="10" width="60" height="20" fill="#F1BF00"/>',
  tr: '<rect width="60" height="40" fill="#E30A17"/><circle cx="22" cy="20" r="10" fill="#fff"/><circle cx="24.6" cy="20" r="8" fill="#E30A17"/><polygon points="29.3,20.0 32.8,18.8 32.9,15.1 35.1,18.0 38.7,16.9 36.6,20.0 38.7,23.1 35.1,22.0 32.9,24.9 32.8,21.2" fill="#fff"/>',
};
const flag = (c, cls) => '<svg class="' + cls + '" viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + (FLAG[c] || '') + '</svg>';

const meta = c => LANGS.filter(l => l.code === c)[0] || LANGS[0];

function paintRow(){
  const el = $('#lang-cur');
  if (el) el.innerHTML = flag(LANG, 'lg-dot') + '<span>' + meta(LANG).name + '</span>';
}
function paintGrid(){
  const g = $('#lang-grid');
  if (!g) return;
  g.innerHTML = LANGS.map(l =>
    '<button class="lg-tile" type="button" data-lang="' + l.code + '" lang="' + l.code + '" aria-pressed="' + (l.code === LANG) + '">' +
      flag(l.code, 'lg-flag') +
      '<svg class="lg-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' +
      '<span class="lg-hello">' + l.hello + '</span>' +
      '<span class="lg-name">' + l.name + '</span>' +
      '<span class="lg-en">' + l.en + '</span>' +
    '</button>').join('');
  const note = $('#lang-note');
  if (note) note.hidden = LANG === 'en';
}

function apply(code){
  LANG = DICT[code] ? code : 'en';
  document.documentElement.lang = LANG;
  buildPats();
  mo.disconnect();
  walk(document.body);
  if (LANG !== 'en') mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  paintRow();
  paintGrid();
  document.dispatchEvent(new CustomEvent('frontier:lang', { detail: LANG }));
}

// for modules that build text in code: t('Paid')
function t(s){ return (LANG !== 'en' && lookup(s)) || s; }

const sheet = $('#lang-sheet');
const close = () => { if (sheet) sheet.hidden = true; };
const row = $('#set-lang');
if (row && sheet) row.addEventListener('click', () => { tap(); paintGrid(); sheet.hidden = false; });
const x = $('#lang-x');
if (x) x.addEventListener('click', close);
if (sheet) sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
const grid = $('#lang-grid');
if (grid) grid.addEventListener('click', e => {
  const b = e.target.closest('.lg-tile');
  if (!b) return;
  tap();
  const c = b.getAttribute('data-lang');
  try { localStorage.setItem(KEY, c); } catch (e2) {}
  apply(c);
  setTimeout(close, 220);
});

apply(pick());

export { t, LANGS };
