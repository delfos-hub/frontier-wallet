/* Versions are stamped at build time, not kept in the repo (stamp.py).

   The repo has no ?v= stamps, so two branches never conflict over them and an
   approval survives a merge of main. Cloudflare Pages runs `python3 stamp.py`
   as its build command; this test runs it on a copy and checks that every
   internal URL gets the one tag, that it is the same tag every time, and that
   --clean gives back the repo byte for byte.

       node tests/stamp.mjs
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

let pass = 0, fail = 0;
const ok = (name, cond, more) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (more ? '\n       ' + more : '')); } };
const JS = path.resolve('assets/js');
const files = fs.readdirSync(JS).filter(f => f.endsWith('.js')).sort();
const read = p => fs.readFileSync(p, 'utf8');

console.log('the repo keeps no stamps');
const stamped = files.filter(f => /\?v=[0-9a-f]{6,12}/.test(read(path.join(JS, f))));
ok('no module carries a ?v= stamp', stamped.length === 0, stamped.join(', '));
ok('index.html carries none', !/\?v=[0-9a-f]{6,12}/.test(read(path.resolve('index.html'))));
ok('the old commit-time stamper is gone', !fs.existsSync(path.resolve('bust37.py')));

let py = null;
for (const c of ['python3', 'python']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break; } catch (e) {} }
if (!py) {
  console.log('\n(no python here: the build step itself is not run)');
} else {
  console.log('\nthe build step, on a copy');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.cpSync(path.resolve('assets'), path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.resolve('index.html'), path.join(dir, 'index.html'));
  fs.copyFileSync(path.resolve('stamp.py'), path.join(dir, 'stamp.py'));
  const run = (...a) => execFileSync(py, ['stamp.py', ...a], { cwd: dir, encoding: 'utf8' });
  const tag = run('--print').trim();
  ok('--print gives an 8-hex tag', /^[0-9a-f]{8}$/.test(tag), tag);
  const out = run();
  ok('the build stamps everything and says so', out.includes('version ' + tag), out);
  const ix = read(path.join(dir, 'index.html'));
  ok('index.html: app.css and every script tag carry the tag', ix.includes('assets/css/app.css?v=' + tag) && !/src="assets\/js\/[a-z0-9_-]+\.js"/.test(ix));
  const bare = files.filter(f => /(?:from|import) '\.\/[a-z0-9_-]+\.js'/.test(read(path.join(dir, 'assets/js', f))));
  ok('every internal import carries it', bare.length === 0, bare.join(', '));
  const other = files.filter(f => (read(path.join(dir, 'assets/js', f)).match(/\?v=([0-9a-f]{8})/g) || []).some(m => m !== '?v=' + tag));
  ok('one tag for all, no mixture', other.length === 0, other.join(', '));
  ok('the same commit gives the same tag, stamped or not', run('--print').trim() === tag && (run(), run('--print').trim() === tag));
  run('--clean');
  const back = files.filter(f => read(path.join(dir, 'assets/js', f)) !== read(path.join(JS, f)));
  ok('--clean gives back the repo byte for byte', back.length === 0 && read(path.join(dir, 'index.html')) === read(path.resolve('index.html')), back.join(', '));
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
