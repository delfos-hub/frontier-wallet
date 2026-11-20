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
    PUT /v1/doc/<id>   Authorization: Bearer <token>, body { "d": "<base64>", "p": <t read, 0 for none> }
    DELETE /v1/doc/<id> Authorization: Bearer <token>

A PUT whose `p` is not the record's current `t` gets 409: the client reads,
merges and writes again.

`<id>` and `<token>` are 64 hex characters. Records are capped at 8 KB and
expire after 400 days without a write. Writes are accepted only from the
origins listed in `worker.js` (`ORIGINS`); add the extension's origin there
when it ships.

## Deploy

On the Delfos Hub Cloudflare account. Once, first: create the database, put
the `database_id` it prints into `wrangler.jsonc`, and create the table:

    cd sync-worker
    source ~/.delfos-cf.env
    npx wrangler d1 create frontier-sync
    npx wrangler d1 execute frontier-sync --remote --yes --file schema.sql

Then, and on every change:

    npx wrangler deploy

The client expects the
Worker at `https://frontier-sync.delfoshub-team.workers.dev` (`HOST` in
`assets/js/sync.js`).

## Your data

Sync is off until the user turns it on (Frontier asks once, at the first
favorite, and it can be changed in Settings). When it is on:

- What is kept: one record per wallet, the favorites list encrypted in the
  browser (AES-GCM, padded to whole kilobytes), under a name derived from the
  recovery phrase, with the SHA-256 of a write token.
- What the server sees: the request's IP address (as any web server does) and
  that name. Never the wallet address, the keys, or which tokens are listed.
- How long: until sync is turned off (Frontier deletes the record; it is
  turned off on each device, or another one with sync on writes it back), or
  400 days after the last write (a daily cron removes it).
- Watched addresses are never synced.

## Limits

Records live in D1 (100,000 writes a day on the free plan), not in KV, whose
1,000 daily writes are shared with relayer-watchdog. Writes are rate limited per client (10 a minute, IPv6 by /64), reads too
(60 a minute), and a write happens only when a list actually changes; opening
the wallet is a read.

## Tests

    node tests/sync.mjs

Runs the shipped `sync.js` against the shipped `worker.js` with a fake KV.
