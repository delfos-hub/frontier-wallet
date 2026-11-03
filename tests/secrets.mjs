/* What creating or importing a wallet leaves behind. The phrase and the PIN
   pass through form fields, a word grid and the verify answers; locking used to
   clear only S.MNEMONIC and S.PASS, so the phrase stayed in the page after the
   lock. And the import took a PIN that creation refuses. */
import fs from 'fs';
import path from 'path';
import { ok, group } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
function lift(s, header){
  const i = s.indexOf(header);
  if (i < 0) throw new Error('not found: ' + header);
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d += 1;
    else if (s[k] === '}') { d -= 1; if (!d) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + header);
}
const line = (s, h) => { const i = s.indexOf(h); if (i < 0) throw new Error('not found: ' + h); return s.slice(i, s.indexOf(';\n', i) + 1); };
const onb = read('onboarding.js'), boot = read('boot.js');
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function page(){
  const els = new Map();
  const $ = id => { if (!els.has(id)) els.set(id, { value: '', innerHTML: '', textContent: '', disabled: false, style: {} }); return els.get(id); };
  return $;
}

group('the phrase and the PIN are gone from the page once the wallet opens or locks');
{
  const $ = page(), S = { SLOTS: [{ pos: 3, answer: 'abandon', word: 'abandon' }] };
  $('#imp').value = PHRASE; $('#ip1').value = '24681357';
  $('#p1').value = '24681357'; $('#p2').value = '24681357';
  $('#seedgrid').innerHTML = '<div class="word"><b>abandon</b></div>';
  $('#slots').innerHTML = '<span class="slot-w">abandon</span>'; $('#tray').innerHTML = '<span class="chip">about</span>';
  $('#imptxt').textContent = 'Valid phrase';
  const rows = [];
  const wipe = new Function('$', 'S', 'dots', lift(onb, 'function wipeForms(') + '\nreturn wipeForms;')($, S, (r, n) => rows.push(r + ':' + n));
  wipe();
  ok('the imported phrase is cleared', $('#imp').value === '');
  ok('the import PIN is cleared', $('#ip1').value === '');
  ok('both create PIN fields are cleared', $('#p1').value === '' && $('#p2').value === '');
  ok('the word grid is emptied', $('#seedgrid').innerHTML === '');
  ok('the verify slots and chips are emptied', $('#slots').innerHTML === '' && $('#tray').innerHTML === '');
  ok('the verify answers are dropped', Array.isArray(S.SLOTS) && S.SLOTS.length === 0);
  ok('the PIN dots are reset', ['pinrow1:0', 'pinrow2:0', 'pinrowI:0'].every(r => rows.includes(r)), rows.join(' '));
  ok('Continue and Restore wait for new input', $('#btn-setup').disabled && $('#btn-import').disabled);
  ok('it runs when a wallet opens', /addEventListener\('frontier:wallet', wipeForms\)/.test(onb));
  ok('and when it locks', /addEventListener\('frontier:locked', wipeForms\)/.test(onb));
  ok('the lock still announces itself', /S\.MNEMONIC = null; S\.PASS = null; locked\(\);/.test(lift(boot, 'function lockWallet(')));
}

group('import takes no PIN that creation refuses');
{
  const PIN_LEN = 8;
  const weakPin = new Function('PIN_LEN', line(onb, 'const weakPin =') + '\nreturn weakPin;')(PIN_LEN);
  ok('one digit repeated is weak', weakPin('00000000') && weakPin('77777777'));
  ok('a run up or down the keypad is weak', weakPin('12345678') && weakPin('23456789') && weakPin('87654321'));
  ok('an ordinary PIN is fine', !weakPin('24681357') && !weakPin('90817263'));
  ok('creation uses the same rule', /const weak = weakPin\(a\);/.test(lift(onb, 'function checkPass(')));

  async function importWith(pin){
    const $ = page();
    $('#imp').value = PHRASE; $('#ip1').value = pin; $('#btn-import').disabled = true;
    const check = new Function('$', 'PIN_LEN', 'weakPin', 'libs', 'bip39',
      lift(boot, 'async function checkImport(') + '\nreturn checkImport;')($, PIN_LEN, weakPin, async () => {}, { validateMnemonic: () => true, wordlist: [] });
    await check();
    return $;
  }
  const zero = await importWith('00000000');
  ok('import refuses 00000000', zero('#btn-import').disabled === true);
  ok('and says why', /too easy/.test(zero('#imptxt').textContent), zero('#imptxt').textContent);
  const fine = await importWith('24681357');
  ok('import takes an ordinary PIN', fine('#btn-import').disabled === false);
  ok('Restore itself checks the rule too', /if \(weakPin\(S\.PASS\)\) throw/.test(boot));
}
