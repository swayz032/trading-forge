-- migration 0178 — Wave 4 Track 4C: Research Governance Gates
--
-- R2: research_trial_counter — cumulative trial count per strategy.
--     A nightly loop emitting K proposals over N nights = K·N total trials.
--     Storing N_total lets DSR/PBO calculations use the correct denominator
--     instead of always assuming N=1, which inflates significance 2–5×.
--
-- R8: governance_meta JSONB on critic_candidates — mandatory 5-field pre-commit
--     declaration (economic_rationale, declared_param_space_size, min_sample_size,
--     target_regime, declared_failure_mode). Missing any → candidate is tagged
--     precommit_incomplete and skipped at replay.

-- ─── R2: Cumulative trial counter ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_trial_counter (
  strategy_id       UUID         PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  n_total           INTEGER      NOT NULL DEFAULT 0,
  last_updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── R8: Pre-commit governance metadata on critic candidates ─────────────────
ALTER TABLE critic_candidates
  ADD COLUMN IF NOT EXISTS governance_meta JSONB NOT NULL DEFAULT '{}';

-- GIN index: efficient JSONB equality / containment queries on precommit_status,
-- sample_tag, etc. used by monitoring and promotion layers.
CREATE INDEX IF NOT EXISTS critic_cand_governance_meta_idx
  ON critic_candidates USING GIN (governance_meta);
