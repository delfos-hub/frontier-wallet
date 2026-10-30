/* Every id in index.html is used once. Two elements with one id is how the
   recovery-phrase sheet opened the Send screen's hidden token picker instead:
   getElementById returns the first, silently. */
import fs from 'fs';
import path from 'path';
import { ok, group } from './harness.mjs';

const root = path.resolve(process.argv[2] || 'assets/js', '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
group('the page');
{
  const ids = (html.match(/\sid="[^"]+"/g) || []).map(s => s.slice(5, -1));
  const seen = {}, dup = [];
  ids.forEach(i => { if (seen[i]) dup.push(i); seen[i] = 1; });
  ok('no id is used twice', !dup.length, dup.join(', '));
}
