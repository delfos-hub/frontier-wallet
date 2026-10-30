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
    // back to the wallet from the TON wallet after paying (audit round 3, D2)
    twaReturnUrl: 'https://t.me/Frontier_WalletBot/gramtest',
    tonApi: 'https://testnet.toncenter.com/api/v2',
    // The swap rules this wallet trades under on this network (audit round 3,
    // B3). The offers Worker publishes its own copy in /offers; a Worker whose
    // rules differ is refused, never followed, since these numbers decide where
    // fees go and how much time each side has. Only the burn tax may move (a
    // chain parameter), between min_tax_bps and max_tax_bps: a floor too, or a
    // Worker saying 0 would let a seller lock too little LUNC for the buyer to
    // receive after the burn tax (review of #20). Must match the Worker's config.
    policy: {
      tip_address: 'kQDv5WLiT79cdIQjT9KE1BWeyomLMz7H8iRnW5_ef7LkgU7j',
      min_tip: '5000000',
      fee_bps: 0,
      answer_window_sec: 900,
      t_terra_sec: 1200,
      terra_gap_sec: 900,
      min_terra_left_sec: 900,
      min_ton_left_sec: 3300,
      min_tax_bps: 50,
      max_tax_bps: 100,
      min_deal: null,                 // nanoGRAM per deal; null = no limit
      max_deal: null,
      max_open_takes_per_taker: 3     // buys one address may have waiting for an answer
    },
    tonExplorer: 'https://testnet.tonviewer.com/',
    terraExplorer: 'https://finder.terraclassic.community/rebel-2/tx/'
  }
};

// Mainnet: the agreed launch parameters (team chat 25-26 Oct 2026, audit
// round 3 E). Not selectable until every REPLACE_ value is filled at deploy
// time (ready: true then); the Worker's env.mainnet in offers-worker/
// wrangler.jsonc must carry the same numbers, and the relayer checks the tip
// address and minimum tip against that Worker when it starts.
NETS.mainnet = {
  name: 'mainnet',
  ready: false,
  chain: 'columbus-5',
  lcd: 'https://terra-classic-lcd.publicnode.com',
  worker: 'REPLACE_WITH_MAINNET_WORKER_URL',
  // htlc-swap code 11746, instantiated on columbus-5 with no admin
  htlc: 'REPLACE_WITH_MAINNET_HTLC_ADDRESS',
  tonCodeHash: NETS.testnet.tonCodeHash,
  tonCode: NETS.testnet.tonCode,
  tonChain: '-239',
  relayer: 'https://relayer.delfos-hub.net',
  tonConnectScript: NETS.testnet.tonConnectScript,
  twaReturnUrl: 'REPLACE_WITH_MAINNET_MINI_APP_URL',
  tonApi: 'https://toncenter.com/api/v2',
  tonExplorer: 'https://tonviewer.com/',
  terraExplorer: 'https://finder.terraclassic.community/columbus-5/tx/',
  policy: {
    tip_address: 'REPLACE_WITH_TON_TREASURY_MULTISIG',
    min_tip: '50000000',              // 0.05 GRAM
    fee_bps: 30,                      // 0.3%
    answer_window_sec: 1800,
    t_terra_sec: 21600,               // the seller's LUNC lock: 6 h
    terra_gap_sec: 86400,             // 24 h between the two locks
    min_terra_left_sec: 18000,        // 5 h the buyer keeps to claim
    min_ton_left_sec: 106800,         // window + 5 h + 24 h + 10 min
    min_tax_bps: 150,                 // columbus-5 burn tax 0.015 (read 2026-10-28)
    max_tax_bps: 300,                 // a rise above 3% stops trading until an update
    min_deal: '5000000000',           // 5 GRAM
    max_deal: '500000000000',         // 500 GRAM
    max_open_takes_per_taker: 3
  }
};

const GRAM_NET = NETS.testnet;

// The Terms of Use the swap is offered under (terms.html). A new version id
// asks every user to accept again before their next offer or buy.
// 1.0: the text approved by the team on 28 Oct 2026.
const TERMS = { version: '1.0', label: '1.0', date: '2026-10-28', url: 'terms.html' };

export { GRAM_NET, NETS, TERMS };
