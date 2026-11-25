-- frontier-faucet: one row per claim, kept a week (worker.js purges older ones)
CREATE TABLE IF NOT EXISTS claims (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT    NOT NULL,
  client  TEXT    NOT NULL,   -- IPv4, or IPv6 /64
  at      INTEGER NOT NULL,   -- ms
  amount  TEXT    NOT NULL,   -- uluna
  hash    TEXT    NOT NULL    -- '' while the send is in flight
);
CREATE INDEX IF NOT EXISTS claims_address ON claims (address, at);
CREATE INDEX IF NOT EXISTS claims_client  ON claims (client, at);
CREATE INDEX IF NOT EXISTS claims_at      ON claims (at);
