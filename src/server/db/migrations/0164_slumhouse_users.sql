-- 0164_slumhouse_users.sql
-- Maps Discord user IDs to broker accounts for the Slumhouse portal.
-- Operator populates rows manually via POST /api/admin/slumhouse-users.
-- Read-only friend-facing portal; no governance writes.

CREATE TABLE IF NOT EXISTS slumhouse_users (
  discord_user_id   TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  jersey_number     INTEGER,
  broker_account_id UUID REFERENCES broker_accounts(account_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slumhouse_users_broker
  ON slumhouse_users(broker_account_id)
  WHERE broker_account_id IS NOT NULL;

COMMENT ON TABLE slumhouse_users IS
  'Slumhouse portal user mapping. discord_user_id is the OAuth subject; broker_account_id is null until operator maps them in admin (POST /api/admin/slumhouse-users).';
