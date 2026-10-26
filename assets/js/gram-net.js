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
    // the lock's compiled code (contracts/htlc-swap-ton/build/htlc.json), checked against tonCodeHash
    tonCode: 'te6ccgECDwEAAvsAART/APSkE/S88sgLAQIBIAIDAgFIBAUCRvLXLCMbYwtM4wLXLCOTKzOs4wLXLCNjextcMZSED/Lw4PI/DA0B4ND4kZEw4CDHAJF/jhMg10nCH5gg1wsfwADDAJFw4sMA4o4oMO1E0NMH0/8x+gAx+gAx0x8x0/8x1DH0BDHRIJTAAcMAkjB/4vLgbeDXLCNjextc4wLXLCMbYwtMk/LAbuDXLCOTKzOsMZPywG7g8j8GAgEgCAkB/jDtRNDTB9P/+gD6ANMf0//U9ATRB/LQZfgjIIECWKAku5qCCAk6gKAjvsMAkjBw4vLgZyDQ+kj6SPpI0QL6RDCSMHCX+kQwwADDAOKX+kQwwADDAJIwcOLy4GwkwgCOEPgnbxBTVKCCCvrwgKC+wwCRcOLy4GjIz4QGFsv/UAQHAB76Alj6Assfy//M9ADJ7VQCAUgKCwAPvjZkEFfXhAQATbXrvaiaGmDmOn/mP0AGP0AGOmPmOn/mOoY+gJokDdJGDhwaGn/6MABFtEHdqJoaYPp//0AfQBpj+n/6noCGOjofSR9JH0kaIgiogHAB/u1E0NMH0//6APoA0x/T/9T0BDHRB9cL/ybAATcG8uBm+CMiufLgaSXIy//PUPkCJbry4Gv4ACTIy/8mzwv/ycjPjxgABI0HwAAAAAAAAAAAAAAAAAAAAAAAAAAAGh0bGMtY2xhaW2DPFnHPC2HMyXL7AFRzJgjIy//JyM+EChgOANow7UTQ0wfT//oA+gDTH9P/1PQE0SfAAZI3f5cnwAA4B8MA4vLgZvgjI77y4Gr4ACDIz4QOF8v/UAX6AlAD+gLLH8v/EswS9ADJ7VTQ+kgx+kj6SDHRggiYloBy+wLIz4UI+lJwzwtuyYEAgvsAAMTL/1j6AgH6AhLLH8v/FMwS9ADJ7VQC0PpI+kj6SNHIz4UIE/pSUAT6AnDPC2rJc/sAIcIAjhHIz4UI+lIB+gJwzwtqyXP7AJFb4oIImJaAcvsCyM+FCPpScM8LbsmBAIL7AA==',
    tonChain: '-3',                 // TON Connect: '-3' testnet, '-239' mainnet
    // the relayer's public address; on testnet a tunnel that can change, so the
    // Buy tab lets it be edited (stored on the device)
    relayer: 'https://f5ac2e11d4afd5.lhr.life',
    tonConnectScript: 'vendor/tonconnect-ui-3.0.2.min.js',
    twaReturnUrl: '',               // e.g. https://t.me/<bot>/<app>, for coming back from a TON wallet in Telegram
    tonApi: 'https://testnet.toncenter.com/api/v2',
    tonExplorer: 'https://testnet.tonviewer.com/',
    terraExplorer: 'https://finder.terraclassic.community/rebel-2/tx/'
  }
};

const GRAM_NET = NETS.testnet;

export { GRAM_NET };
