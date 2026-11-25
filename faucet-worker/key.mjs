/* Puts the faucet wallet's key into the Worker as the secret FAUCET_KEY.

       cd faucet-worker && source ~/.delfos-cf.env && node key.mjs

   The phrase is typed into a hidden prompt and never echoed or written
   anywhere. The key is derived on this computer (m/44'/330'/0'/0/0, the
   wallet's own path), its address is printed so you can check it is the
   faucet wallet, and after you confirm, the key goes straight into
   `npx wrangler secret put FAUCET_KEY` through stdin: not on screen, not in
   a file, not in the shell history. */
import { spawn } from 'child_process';
import readline from 'readline';
import { base, bip32, bip39, ripemd160, sha256, wordlist } from '../vendor/crypto.js';

function hidden(question){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) { if (s.indexOf(question) === 0) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}
function ask(question){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, a => { rl.close(); resolve(a.trim()); });
  });
}

const phrase = (await hidden('Faucet wallet phrase (hidden): ')).trim().toLowerCase().split(/\s+/).join(' ');
if (!bip39.validateMnemonic(phrase, wordlist)) {
  console.error('That is not a valid recovery phrase. Nothing was sent.');
  process.exit(1);
}
const node = bip32.HDKey.fromMasterSeed(await bip39.mnemonicToSeed(phrase)).derive("m/44'/330'/0'/0/0");
const addr = base.bech32.encode('terra', base.bech32.toWords(ripemd160(sha256(node.publicKey))));
console.log('Faucet address: ' + addr);
console.log('Fund this address with test LUNC on rebel-2. It is the address the faucet pays from.');
if ((await ask('Put its key into the Worker as FAUCET_KEY? Type YES: ')) !== 'YES') {
  console.log('Nothing was sent.');
  process.exit(0);
}
const key = Array.from(node.privateKey, x => x.toString(16).padStart(2, '0')).join('');
const p = spawn('npx', ['wrangler', 'secret', 'put', 'FAUCET_KEY'], { stdio: ['pipe', 'inherit', 'inherit'] });
p.stdin.write(key + '\n');
p.stdin.end();
p.on('exit', code => process.exit(code || 0));
