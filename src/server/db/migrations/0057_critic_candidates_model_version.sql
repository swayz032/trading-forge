-- Migration 0057: Add critic_model_version and evidence_run_ids to critic_candidates
-- critic_model_version: stores the model tag used for the critic run (e.g. "deepseek-r1:14b@2026-04")
--   so each candidate is permanently linked to the model that scored it.
-- evidence_run_ids: JSONB map of {mc, sqa, wf, qmc, tensor, rl} -> UUID[]
--   each candidate records which upstream run rows were used as evidence,
--   enabling full audit replay without re-fetching by backtestId.
-- Both nullable: pre-migration rows have null and remain queryable.
ALTER TABLE critic_candidates ADD COLUMN IF NOT EXISTS critic_model_version TEXT;
ALTER TABLE critic_candidates ADD COLUMN IF NOT EXISTS evidence_run_ids JSONB;
