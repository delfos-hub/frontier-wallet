# frontier-faucet

Test LUNC on rebel-2 for the wallet's DEV tab (`assets/js/dev.js`, shown with
Developer mode in Settings).

    GET  /status?address=terra1...   what the faucet holds and pays, and when this address may claim next
    POST /claim  { "address": "terra1..." }   -> { "hash": "...", "amount": "..." }

## Limits

All in `wrangler.jsonc` `vars`, changeable without touching the code:

| var | default | |
|---|---|---|
| `AMOUNT` | `20000000000` | uluna per claim (20,000 LUNC). **Deployed with `1000000000` (1,000 LUNC)** in `wrangler.jsonc` while the faucet wallet is low; set it back once it is funded |
| `COOLDOWN_H` | `24` | hours between two claims of one address |
| `PER_CLIENT_DAY` | `3` | claims per client (IPv4, or IPv6 /64) a day |
| `DAILY_CAP` | `2000000000000` | uluna across everyone a day (2,000,000 LUNC) |
| `PAUSED` | `""` | `"1"` closes the faucet |

On top of these, `CLAIMS` rate limits each client to 5 requests a minute.
Claims are accepted only from the wallet's origins (`ORIGINS` in `worker.js`);
`/status` answers anyone.

A claim reserves its row in D1 before anything is signed (the limit checks and
the insert are one statement), so two claims at once cannot both pass; a send
that fails gives the row back.

## Safety

- The Worker holds the faucet wallet's private key as the secret `FAUCET_KEY`.
  Not the phrase: deriving a key from it is more CPU than a free Worker gets.
- It signs for `CHAIN` (`rebel-2`) only, asks the node which chain it is on
  before every send, and refuses `columbus-5` outright.
- Keep only test coins on the faucet wallet. Use a wallet made for the faucet,
  never one that holds anything on mainnet.

## Deploy

On the Delfos Hub Cloudflare account, after review. Once:

    cd faucet-worker
    source ~/.delfos-cf.env
    npx wrangler d1 create frontier-faucet        # put the id into wrangler.jsonc
    npx wrangler d1 execute frontier-faucet --remote --yes --file schema.sql
    node key.mjs                                  # the faucet phrase, hidden; prints the address, puts the key

Then fund the address `key.mjs` printed with test LUNC on rebel-2, and:

    npx wrangler deploy

The URL it prints should be `https://frontier-faucet.delfoshub-team.workers.dev`,
which is what `assets/js/dev.js` calls (`FAUCET`).

## Testing locally

    echo "FAUCET_KEY=<64 hex of a throwaway key>" > .dev.vars
    npx wrangler d1 execute frontier-faucet --local --file schema.sql
    npx wrangler dev --local

with `LCD` pointed at a node you control (or a stub that answers node_info,
balances, accounts, simulate and txs).
