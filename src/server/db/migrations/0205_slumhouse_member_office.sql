-- 0205 (ops-experience Tier-2 item 6): per-member Slumhouse office — PIN second factor + TEST-ONLY broker-connect state.
-- Closes the "each member sets up their own office code" directive (OR-003 §1 / OR-013 §2) and gives the
-- floating broker-connect card a home that can NEVER be mistaken for production credentials (OR-017 §1).
-- Two tables, opposite trust levels ON PURPOSE:
--   slumhouse_member_pins   — REAL production data. The PIN is the Office feature itself, not broker plumbing.
--   slumhouse_connect_test  — TEST data. The TEST-ness lives in the NAME and the schema, not in a filter column.
--                             `broker_accounts` is NEVER written from this lane. At Phase 5 the FLOW migrates,
--                             never the DATA: members reconnect through the real vault path and these rows die
--                             with test mode. There is nothing here that could accidentally become production.
-- Nullable + idempotent (CREATE TABLE/INDEX IF NOT EXISTS, drop-then-add constraints); safe to re-apply.
-- Inert until the member-office routes ship — no existing code reads these tables.

-- ── Member PIN (REAL) ────────────────────────────────────────────────────────────────────────────────
-- One row per Discord identity. pin_hash is scrypt, encoded `scrypt$N$r$p$salt$hash` so cost parameters
-- travel with the record (src/server/lib/member-pin.ts). NEVER stores a PIN in any recoverable form.
CREATE TABLE IF NOT EXISTS "slumhouse_member_pins" (
  "discord_user_id" text PRIMARY KEY,
  "pin_hash"        text NOT NULL,
  "failures"        integer NOT NULL DEFAULT 0,
  "locked_until"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "slumhouse_member_pins" DROP CONSTRAINT IF EXISTS "slumhouse_member_pins_user_fk";
ALTER TABLE "slumhouse_member_pins"
  ADD CONSTRAINT "slumhouse_member_pins_user_fk"
  FOREIGN KEY ("discord_user_id") REFERENCES "slumhouse_users"("discord_user_id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_slumhouse_member_pins_locked" ON "slumhouse_member_pins" ("locked_until");

-- ── Broker-connect TEST state (TEST ONLY — never production credentials) ─────────────────────────────
-- `broker_kind` records which wizard the member exercised. `test_key_ref` holds a reference to an
-- ENCRYPTED designated TEST key only — real broker keys are never persisted in test mode, and the
-- encryption is deliberate practice for the real Phase-5 vault flow rather than protection of anything
-- valuable. `validated_at` is set by MOCK validation; no live broker call exists in this lane.
CREATE TABLE IF NOT EXISTS "slumhouse_connect_test" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "discord_user_id" text NOT NULL,
  "broker_kind"     text NOT NULL,
  "test_key_ref"    text,
  "status"          text NOT NULL DEFAULT 'pending',
  "validated_at"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "slumhouse_connect_test" DROP CONSTRAINT IF EXISTS "slumhouse_connect_test_user_fk";
ALTER TABLE "slumhouse_connect_test"
  ADD CONSTRAINT "slumhouse_connect_test_user_fk"
  FOREIGN KEY ("discord_user_id") REFERENCES "slumhouse_users"("discord_user_id") ON DELETE CASCADE;

-- Guard the enum-ish columns at the DB layer so a stray write cannot invent a broker or a status.
ALTER TABLE "slumhouse_connect_test" DROP CONSTRAINT IF EXISTS "slumhouse_connect_test_broker_kind_ck";
ALTER TABLE "slumhouse_connect_test"
  ADD CONSTRAINT "slumhouse_connect_test_broker_kind_ck"
  CHECK ("broker_kind" IN ('topstepx', 'traderspost'));

ALTER TABLE "slumhouse_connect_test" DROP CONSTRAINT IF EXISTS "slumhouse_connect_test_status_ck";
ALTER TABLE "slumhouse_connect_test"
  ADD CONSTRAINT "slumhouse_connect_test_status_ck"
  CHECK ("status" IN ('pending', 'validated', 'rejected'));

CREATE INDEX IF NOT EXISTS "idx_slumhouse_connect_test_user" ON "slumhouse_connect_test" ("discord_user_id");
