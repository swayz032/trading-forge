-- 0204 (M2 determinism + durability, campaign M2, 2026-07-17): persists the
-- paper-signal-service in-memory pendingEntryQueue (paper-signal-service.ts:673)
-- so a process restart between a deferred-entry signal (bar N) and its fill
-- (bar N+1) no longer silently drops the trade.
--
-- Why: pendingEntryQueue is a plain `Map<string, PendingEntry>` — a restart
-- (NSSM respawn, tower reboot, deploy) landing in the split-second window
-- between signal and fill wipes the entry with no record. Under D6/D7 the
-- paper engine becomes promotion-evidence authority, so this gap is a real
-- evidence hole, not cosmetic.
--
-- CREATE TABLE IF NOT EXISTS — idempotent, no data migration, no INSERT/UPDATE.
-- Additive only; safe to re-apply. Nullable columns mirror the PendingEntry
-- TS interface's optional fields exactly (paper-signal-service.ts:644-671).
--
-- Primary/unique key (session_id, symbol, signal_bar_timestamp) doubles as the
-- queue key (session_id+symbol, matching the in-memory Map key) plus the
-- idempotency key for the upsert on enqueue.
--
-- Behavior default: inert until paper-signal-service.ts wires the persist/
-- consume/rehydrate call sites in this same change (no separate flag needed —
-- an unused table is harmless; the code wiring is the activation).

CREATE TABLE IF NOT EXISTS paper_pending_entries (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                   UUID NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  symbol                       TEXT NOT NULL,
  side                         TEXT NOT NULL,
  contracts                    INTEGER NOT NULL,
  order_type                   TEXT NOT NULL,
  stop_limit_offset            NUMERIC,
  rsi                          NUMERIC,
  atr                          NUMERIC,
  bar_volume                   NUMERIC,
  median_bar_volume            NUMERIC,
  signal_bar_timestamp         TEXT NOT NULL,
  correlation_id               TEXT,
  stop_multiplier              NUMERIC NOT NULL,
  entry_context                JSONB,
  news_reduced_at_signal_time  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_pending_entries_key_idx
  ON paper_pending_entries (session_id, symbol, signal_bar_timestamp);

CREATE INDEX IF NOT EXISTS paper_pending_entries_session_idx
  ON paper_pending_entries (session_id);
