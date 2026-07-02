-- 0187_slumhouse_session_epoch.sql
-- FIX 4 (deep-scan #12): per-user session revocation via epoch field.
--
-- Adds session_epoch to slumhouse_users. When the epoch stored in the signed
-- session token (claim) does not match the DB value, verifySession returns
-- "revoked". POST /slumhouse/admin/revoke-sessions increments this column,
-- invalidating all tokens signed under the previous epoch.
--
-- New sign format:  <discordUserId>:<epoch>:<expUnixSec>:<sig>  (4-part)
-- Legacy 3-part tokens are treated as epoch=0 and accepted while the DB value
-- remains 0. After a revoke (DB epoch → 1) all legacy tokens are also rejected.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS
-- Boot-migration-runner keyed on meta/_journal.json idx 190 / tag 0187_slumhouse_session_epoch

ALTER TABLE slumhouse_users
  ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN slumhouse_users.session_epoch IS
  'Revocation epoch. Increment via POST /slumhouse/admin/revoke-sessions to invalidate all currently-valid session tokens for this user.';
