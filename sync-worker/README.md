# frontier-sync

A small Cloudflare Worker that keeps one encrypted record per wallet, so the
favorites picked in one Frontier client show up in the others (web wallet,
Mini App, later the extension). The client side is `assets/js/sync.js`.

## What it stores

- The record name is a hash derived from the recovery phrase (HKDF-SHA256). It
  is not the wallet address and cannot be linked to it.
- The body is AES-GCM ciphertext made in the browser. The key never leaves
  the device.
- A write token (also derived from the phrase) is required to replace a
  record. Only its SHA-256 is kept.

The Worker cannot read the list and does not know whose it is.

## API

    GET /v1/doc/<id>   -> { "d": "<base64>", "t": <ms> }   or 404
    PUT /v1/doc/<id>   Authorization: Bearer <token>, body { "d": "<base64>" }

`<id>` and `<token>` are 64 hex characters. Records are capped at 8 KB and
expire after 400 days without a write. Writes are accepted only from the
origins listed in `worker.js` (`ORIGINS`); add the extension's origin there
when it ships.

## Deploy

On the Delfos Hub Cloudflare account:

    cd sync-worker
    source ~/.delfos-cf.env
    npx wrangler deploy

The first deploy creates the KV namespace for the `SYNC` binding and writes
its id into `wrangler.jsonc`; commit that change. The client expects the
Worker at `https://frontier-sync.delfoshub-team.workers.dev` (`HOST` in
`assets/js/sync.js`).

## Limits

Workers KV on the free plan allows 1,000 writes a day. A write happens only
when a favorites list actually changes; opening the wallet is a read.

## Tests

    node tests/sync.mjs

Runs the shipped `sync.js` against the shipped `worker.js` with a fake KV.
