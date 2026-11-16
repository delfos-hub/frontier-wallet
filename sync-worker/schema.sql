-- frontier-sync: one encrypted record per wallet (worker.js)
-- npx wrangler d1 execute frontier-sync --remote --yes --file schema.sql
CREATE TABLE IF NOT EXISTS docs (
  id  TEXT PRIMARY KEY,      -- 64 hex, derived from the recovery phrase
  a   TEXT NOT NULL,         -- sha256 of the write token
  d   TEXT NOT NULL,         -- base64 AES-GCM ciphertext
  t   INTEGER NOT NULL       -- revision: ms of the last write
);
CREATE INDEX IF NOT EXISTS docs_t ON docs (t);
