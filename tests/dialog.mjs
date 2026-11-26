/* Desktop windows (Receive, Send, Swap) and the phone headings (#76 review).

   The keyboard was checked in Chromium at 1440 px: Enter on Receive opens it
   with focus inside, 25 Tabs and 10 Shift+Tabs stay inside, Escape gives focus
   back to Receive, and the Swap close button closes on Enter and on Space.
   The headings were measured at 390 px (17 px, white; the Swap network label
   12 px, muted) and at 1440 px (unchanged). Receive opened at 1440 px and
   narrowed to 390 px stays open with role, aria-modal and aria-labelledby
   removed. This keeps what those checks
   depend on in place.

       node tests/dialog.mjs
*/
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0;
function ok(name, cond){ if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
const shell = fs.readFileSync(path.resolve('assets/js/shell.js'), 'utf8');
const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');

console.log('windows: the keyboard');
for (const id of ['st-receive', 'st-send', 'st-swap', 'st-tsend']) {
  const i = html.indexOf('id="' + id + '"'), bar = html.slice(i, html.indexOf('</div>', html.indexOf('class="back"', i)) + 20);
  ok(id + ': its close control is a native button', /<button type="button" class="back" data-go="home" aria-label="[A-Z][a-z]+">/.test(bar));
}
ok('the opener is kept when the first window opens', /if \(!m\) OPENER = document\.activeElement/.test(shell));
ok('focus moves into the window, marked as a modal dialog', /enterModal\(w\);/.test(shell) && /setAttribute\('aria-modal', 'true'\)/.test(shell) && /first\.focus\(/.test(shell));
ok('Tab and Shift+Tab go round inside it', /if \(e\.key !== 'Tab' \|\| !m\) return;/.test(shell) && /f\[f\.length - 1\]\.focus\(\)/.test(shell) && /f\[0\]\.focus\(\)/.test(shell));
ok('closing gives focus back to the opener', /const o = OPENER; OPENER = null;\s*if \(o && o\.isConnected && !o\.closest\('\[hidden\]'\)\) o\.focus\(/.test(shell));
ok('Escape closes the window (and so restores focus)', /if \(e\.key !== 'Escape' \|\| !modal\(\)\) return;[\s\S]{0,120}closeModal\(\);/.test(shell));

ok('a window that turns into a phone page stays open, no longer a dialog', /m\.classList\.remove\('as-modal'\);[\s\S]{0,200}\['role', 'aria-modal', 'aria-labelledby'\]\.forEach\(a => m\.removeAttribute\(a\)\)/.test(shell) &&
  /\$\$\('\.step'\)\.forEach\(s => \{ if \(s !== m\) s\.classList\.remove\('on'\); \}\)/.test(shell));
console.log('\nheadings on a phone');
const base = css.indexOf('.head span{font-size:12px;color:var(--muted)}'), fix = css.indexOf('.head h2>span{font-size:inherit;color:inherit;letter-spacing:inherit}');
ok('a heading’s own span keeps the heading’s size and colour, at every width', fix > base && base > 0 && !/@media|html\.dk/.test(css.slice(base, fix)));
ok('the Swap network label is outside the h2, so it stays muted', /<\/h2><span id="sw-net"><\/span>/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
