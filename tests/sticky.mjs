/* Long screens keep their way back (shell.js longScreens, app.css).

       node tests/sticky.mjs
*/
import fs from 'fs';
import path from 'path';
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } };
const shell = fs.readFileSync(path.resolve('assets/js/shell.js'), 'utf8');
const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');
ok('a screen\'s bar with a back button sticks to the top', /\.step:not\(\.as-modal\) > \.bar:has\(\.back\)\{position:sticky;top:0/.test(css));
ok('windows (Receive, Send, Swap) are left out', /\.step:not\(\.as-modal\)/.test(css) && /\.step\.on:not\(\.as-modal\)/.test(shell));
ok('the bar takes the screen\'s title once the heading has scrolled away', /const gone = h\.getBoundingClientRect\(\)\.bottom < bar\.getBoundingClientRect\(\)\.bottom;/.test(shell));
ok('a back-to-top button, past about a screen of scrolling', /y > Math\.max\(500, innerHeight \* 0\.9\)/.test(shell) && /aria-label', 'Back to top'/.test(shell));
ok('never over a window or a sheet', /modal-open[\s\S]{0,80}sheet-open/.test(shell));
ok('it scrolls without motion when motion is reduced', /prefers-reduced-motion: reduce/.test(shell));
ok('scroll work is batched into one frame', /requestAnimationFrame\(update\)/.test(shell) && /passive: true/.test(shell));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
