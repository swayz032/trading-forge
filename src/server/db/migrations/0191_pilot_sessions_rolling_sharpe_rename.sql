-- Deep-Scan #18b Z-1 (2026-07-05): pilot_sessions column-name drift.
-- schema.ts declares numeric("rolling_sharpe_final") but migration 0077 created the
-- column as `rolling_sharpe`. lifecycleService.recordPilotSession() INSERTs
-- `rolling_sharpe_final` → "column does not exist", swallowed by a non-blocking
-- try/catch in routes/paper.ts → NO pilot_sessions row has ever been inserted →
-- PILOT→DEPLOYED auto-promotion has never fired since 0077. Rename to match schema.ts.
--
-- Idempotent: renames only when the OLD column exists AND the NEW one does not, so a
-- re-run (or a prod DB already fixed out-of-band) is a safe no-op and an existing
-- rolling_sharpe_final is never clobbered.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pilot_sessions' AND column_name = 'rolling_sharpe'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pilot_sessions' AND column_name = 'rolling_sharpe_final'
  ) THEN
    ALTER TABLE pilot_sessions RENAME COLUMN rolling_sharpe TO rolling_sharpe_final;
  END IF;
END $$;
