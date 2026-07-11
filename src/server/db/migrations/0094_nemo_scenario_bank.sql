-- Migration 0094: nemo_scenario_bank
-- Track 1 — NeMo Data Designer Integration (Challenger-Only, Phase 0)
--
-- Stores every NeMo macro-narrative scenario that conditioned an A14 run.
-- Auditability: every NeMo scenario -> A14 regime -> strategy evaluation chain
-- must be fully replayable. This table is the entry point of that chain.
--
-- Authority: challenger_only. Decision_role is advisory. No promotion authority.
-- Rows are immutable after insert (no update of scenario_json after creation).

-- ─── UP ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nemo_scenario_bank (
    id                BIGSERIAL PRIMARY KEY,
    scenario_label    TEXT NOT NULL,
    scenario_json     JSONB NOT NULL,                          -- Full NeMoScenario dataclass
    severity          TEXT NOT NULL                            -- 'mild' | 'moderate' | 'severe' | 'extreme'
                        CHECK (severity IN ('mild', 'moderate', 'severe', 'extreme')),
    duration_days     INT NOT NULL CHECK (duration_days > 0),
    target_vol        NUMERIC(8, 4),
    target_trend      NUMERIC(8, 4),
    generator_version TEXT NOT NULL,
    used_in_a14_run_ids JSONB NOT NULL DEFAULT '[]',           -- list of synthetic_black_swan_runs.id (UUIDs)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nemo_scenario_label ON nemo_scenario_bank(scenario_label);
CREATE INDEX IF NOT EXISTS idx_nemo_severity        ON nemo_scenario_bank(severity);
CREATE INDEX IF NOT EXISTS idx_nemo_created         ON nemo_scenario_bank(created_at DESC);
-- Partial index for batch lookups — all rows from a given generator version
CREATE INDEX IF NOT EXISTS idx_nemo_generator_ver   ON nemo_scenario_bank(generator_version);

COMMENT ON TABLE nemo_scenario_bank IS
    'NeMo Data Designer macro-narrative scenarios (Track 1, challenger_only Phase 0). '
    'Each row is a scenario that conditioned A14 VAE to generate OHLCV bars for a '
    'plausible-but-unprecedented event. Linked to A14 runs via used_in_a14_run_ids.';

-- ─── DOWN ─────────────────────────────────────────────────────────────────────

-- To reverse this migration:
-- DROP INDEX IF EXISTS idx_nemo_generator_ver;
-- DROP INDEX IF EXISTS idx_nemo_created;
-- DROP INDEX IF EXISTS idx_nemo_severity;
-- DROP INDEX IF EXISTS idx_nemo_scenario_label;
-- DROP TABLE IF EXISTS nemo_scenario_bank;
