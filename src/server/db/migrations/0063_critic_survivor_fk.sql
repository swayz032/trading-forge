-- ═══════════════════════════════════════════════════════════════════════════════
-- 0063: Critic Survivor FK Constraints (referential-integrity hardening)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The deep-scan audit identified two unconstrained pointer columns on
-- critic_optimization_runs:
--
--   survivor_candidate_id  → critic_candidates.id  (selected candidate)
--   survivor_backtest_id   → backtests.id          (replay backtest of survivor)
--
-- Without FK constraints, deleting a candidate or replay backtest leaves a
-- dangling pointer on the run row, and consumers (frontend, agent-coordinator,
-- pipeline-funnel-service) silently read stale IDs that 404 on follow-up
-- queries. This migration repairs any existing dangling pointers and installs
-- ON DELETE SET NULL so the run row survives cleanup of its referenced rows
-- (the run is the audit trail; it must outlive the candidate it picked).
--
-- Pattern (per PRODUCTION-HARDENING.md Wave 4 #17): forensics/audit rows use
-- SET NULL — same posture as critic_candidates.replay_backtest_id (set in
-- 0052). CASCADE would erase the audit trail when a candidate is purged.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS guards re-application; the cleanup
-- UPDATEs are idempotent (NULLing already-NULL rows is a no-op).

-- ─── Cleanup: NULL out any dangling pointers before adding the FK ───
-- A FK ADD will fail if any row points at a non-existent target. The audit
-- has not surfaced any known dangling rows, but production drift is possible
-- (older buggy code paths, partially-rolled-back deletes, …) so we run the
-- cleanup defensively.
UPDATE "critic_optimization_runs" SET "survivor_candidate_id" = NULL
  WHERE "survivor_candidate_id" IS NOT NULL
    AND "survivor_candidate_id" NOT IN (SELECT "id" FROM "critic_candidates");
--> statement-breakpoint

UPDATE "critic_optimization_runs" SET "survivor_backtest_id" = NULL
  WHERE "survivor_backtest_id" IS NOT NULL
    AND "survivor_backtest_id" NOT IN (SELECT "id" FROM "backtests");
--> statement-breakpoint

-- ─── critic_optimization_runs.survivor_candidate_id → critic_candidates.id (SET NULL) ───
ALTER TABLE "critic_optimization_runs"
  DROP CONSTRAINT IF EXISTS "critic_optimization_runs_survivor_candidate_id_critic_candidates_id_fk";
--> statement-breakpoint

ALTER TABLE "critic_optimization_runs"
  ADD CONSTRAINT "critic_optimization_runs_survivor_candidate_id_critic_candidates_id_fk"
  FOREIGN KEY ("survivor_candidate_id") REFERENCES "critic_candidates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- ─── critic_optimization_runs.survivor_backtest_id → backtests.id (SET NULL) ───
ALTER TABLE "critic_optimization_runs"
  DROP CONSTRAINT IF EXISTS "critic_optimization_runs_survivor_backtest_id_backtests_id_fk";
--> statement-breakpoint

ALTER TABLE "critic_optimization_runs"
  ADD CONSTRAINT "critic_optimization_runs_survivor_backtest_id_backtests_id_fk"
  FOREIGN KEY ("survivor_backtest_id") REFERENCES "backtests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
