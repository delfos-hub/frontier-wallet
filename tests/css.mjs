/* app.css stays one valid sheet.

   A rule left open (a "{" without its "}") does not fail loudly: the browser
   folds every rule after it into the open one and drops them, so whole
   screens lose their styles. That happened once in a merge (#76), so every
   brace is counted here, outside comments and strings.

       node tests/css.mjs
*/
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0;
function ok(name, cond, more){
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (more ? '\n       ' + more : '')); }
}
const css = fs.readFileSync(path.resolve('assets/css/app.css'), 'utf8');
// comments and strings blanked, lines kept
const t = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
             .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, m => m.replace(/[^\n]/g, ' '));
const open = [], extra = [];
t.split('\n').forEach((l, i) => {
  for (const ch of l) {
    if (ch === '{') open.push(i + 1);
    else if (ch === '}') { if (open.length) open.pop(); else extra.push(i + 1); }
  }
});
ok('every { has its }', open.length === 0, 'left open at line ' + open.join(', '));
ok('no } without its {', extra.length === 0, 'stray at line ' + extra.join(', '));
ok('no merge markers', !/^(<{7}|={7}|>{7})/m.test(css));
// a declaration block followed by a new selector on the next line, with no
// "}" between: the shape of a rule cut in half
const cut = [];
const L = t.split('\n');
for (let i = 1; i < L.length; i++) {
  if (/^\s*(html|body|@|\.|#|:)/.test(L[i]) && /[;:]\s*$/.test(L[i - 1]) && !/[{}]\s*$/.test(L[i - 1])) cut.push(i + 1);
}
ok('no rule cut in half (a selector right after an unfinished declaration line)', cut.length === 0, 'at line ' + cut.join(', '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
