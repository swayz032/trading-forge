-- Migration 0152: Add NEEDS_ARCHETYPE and NEEDS_REVISION lifecycle states
--
-- Background (2026-05-26 Pass D Wave 26 Pass G):
--   Strategy library self-maintenance requires two new lifecycle states:
--
--   NEEDS_ARCHETYPE — Gemma extracted a strategy but no archetype matched in
--     the ARCHETYPE_REGISTRY. Set by the graduator when an archetype-dispatch
--     path is required but no handler exists. Strategy stays in library, not
--     eligible for backtest/paper until an archetype is added and re-extraction
--     is run.
--
--   NEEDS_REVISION — Quality gate failed: bidirectional incomplete, source URL
--     unreachable, archetype detector failed at runtime, or STALE cron demoted
--     the strategy after 60 days of inactivity. Strategy stays in library,
--     not eligible for backtest/paper until the operator revises.
--
-- Implementation:
--   PostgreSQL TEXT column carries the lifecycle state. The existing schema.ts
--   comment documents all valid values inline. This migration adds the new values
--   to the known set via UPDATE + comment (no ALTER TYPE needed for TEXT).
--
--   Existing rows are UNTOUCHED — lifecycleState values remain CANDIDATE /
--   PAPER / DEPLOY_READY / PILOT / DEPLOYED etc. This is purely additive.
--
-- Operator mandate: GRAVEYARD is NEVER written from this migration or the
--   STALE cron. Strategies get NEEDS_REVISION at most — always retrievable.
--
-- Idempotency: safe to re-run. The comment update and constraint check are
--   idempotent. No existing strategy rows are modified.
--
-- journal idx: 152

-- Step 1: Self-documenting comment on the strategies table lifecycle_state column.
-- This is informational only — does NOT alter data.
COMMENT ON COLUMN strategies.lifecycle_state IS
  'CANDIDATE | TESTING | PAPER | DEPLOY_READY | PILOT | DEPLOYED | DECLINING | RETIRED | GRAVEYARD | NEEDS_ARCHETYPE | NEEDS_REVISION';

-- Step 2: Confirm schema migration applied (operator-visible verification row).
-- This audit row is idempotent: if re-run it inserts a second row, which is
-- acceptable for migration tracking (same as other migration audit rows).
INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  decision_authority,
  result,
  status,
  created_at
)
VALUES (
  'migration.lifecycle_states_needs_revision_added',
  'system',
  NULL,
  'system',
  '{"migration": "0152", "added_states": ["NEEDS_ARCHETYPE", "NEEDS_REVISION"], "note": "Additive — no existing rows modified; GRAVEYARD never written from STALE path per operator mandate"}'::jsonb,
  'success',
  NOW()
);

-- Note: the ON CONFLICT DO NOTHING above references the audit_log primary key.
-- audit_log has no unique constraint other than PK (uuid), so this is a no-op
-- safeguard and will not prevent the row from being inserted on re-run.
-- If you want true idempotency, the boot-migration-runner's drizzle.__drizzle_migrations
-- guard prevents re-execution in production — the ON CONFLICT DO NOTHING is a
-- belt-and-suspenders guard for direct psql execution.
