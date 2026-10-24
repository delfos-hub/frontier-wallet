/* The GRAM <-> LUNC swap's own network settings.

   The rest of the wallet is columbus-5 only. The swap is still on test
   networks (rebel-2 + TON testnet), so it carries its own { chain, lcd } and
   hands it to tx.js; nothing outside the swap screen imports this file.
   Mainnet is a second entry here once the contracts are audited and deployed.
*/
const NETS = {
  testnet: {
    name: 'testnet',
    chain: 'rebel-2',
    lcd: 'https://lcd.luncblaze.com',
    // offers Worker (delfos-hub/widgets offers-worker), Delfos Hub account
    worker: 'https://htlc-offers-testnet.delfoshub-team.workers.dev',
    // contracts/htlc-swap on rebel-2, instantiated with no admin
    htlc: 'terra16zz7rtpkwurte9srfznaa3ctj35xk8k3rgvpm2n7e6s4lr0sssrssxd34z',
    // contracts/htlc-swap-ton build: a TON lock is trusted only with this code
    tonCodeHash: '39D4C6CCA7AEC5DBEA9FD5BBC5B28CD0BADB04B8E99822FC241075B9FC58172C',
    tonApi: 'https://testnet.toncenter.com/api/v2',
    tonExplorer: 'https://testnet.tonviewer.com/',
    terraExplorer: 'https://finder.terraclassic.community/rebel-2/tx/'
  }
};

const GRAM_NET = NETS.testnet;

export { GRAM_NET };
