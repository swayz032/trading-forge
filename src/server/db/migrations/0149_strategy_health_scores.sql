-- Migration 0149: strategy_health_scores — composite health bus foundation table
-- Wave 28 Pass A.1 — Layer C decision bus schema
--
-- APPEND-ONLY CONTRACT:
--   This table is append-only. No UPDATE statements are permitted.
--   Every aggregator run INSERTS a new row. Callers read the latest row
--   per strategy via the (strategy_id, evaluated_at DESC) index.
--   Rationale: immutable audit lineage required by OCC/Fed/FDIC April 2026
--   Model Risk Management "one lineage graph" pattern. Downstream consumers
--   (critic, paper engine, prop sim, portfolio optimizer) must never assume
--   a row can be mutated after insert.
--
-- IDEMPOTENT:
--   Re-running this migration on an existing DB is a no-op (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS strategy_health_scores (
    -- Surrogate key — bigserial for high-volume append workload
    id                          BIGSERIAL PRIMARY KEY,

    -- FK to the strategy being evaluated. ON DELETE CASCADE: health rows
    -- are meaningless without the parent strategy.
    strategy_id                 INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,

    -- When the aggregator produced this composite score row (wall-clock UTC).
    evaluated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite [0,1] health score. NULL when fewer than
    -- MIN_COMPOSITE_SUBSYSTEMS subsystems were available — callers must
    -- gate on computed_from_n_subsystems before reading this value.
    composite_score             REAL,

    -- Categorical verdict derived from composite_score thresholds.
    -- HEALTHY | MARGINAL | UNHEALTHY | CRITICAL | NULL (insufficient data)
    verdict                     TEXT,

    -- Per-subsystem detail map across all 12 canonical subsystems.
    -- Shape: { "<subsystem_name>": { score, confidence, available, computed_at, error? } }
    -- "available" is false for subsystems that could not produce a score this cycle.
    -- This column is always present; individual subsystem entries may be missing
    -- when the aggregator did not attempt them.
    subsystem_scores            JSONB NOT NULL,

    -- Count of subsystems that returned a valid score in this aggregation run.
    -- Out of 12 canonical subsystems. Gate decisions on this value before
    -- trusting composite_score or verdict.
    computed_from_n_subsystems  INTEGER NOT NULL,

    -- SHA-256 (full 64 hex chars) of canonical-sorted-JSON of the weights
    -- config used to produce this composite score. Mirrors the
    -- firm_rules_version pattern from Wave 27.5 Pass A but uses the full
    -- 256-bit hash (not a 16-char prefix) because weights are a larger,
    -- more complex config surface and full auditability is required.
    -- Consumers can detect weights drift by comparing current hash to stored.
    weights_version_id          TEXT NOT NULL,

    -- Hours elapsed between NOW() and the oldest subsystem.computed_at
    -- timestamp in subsystem_scores. Populated by the aggregator at insert
    -- time. NULL acceptable on legacy rows inserted before this column was
    -- defined (not expected in production).
    staleness_age_hours         REAL,

    -- Pairwise disagreement deltas between subsystems.
    -- Shape: { "<subsystem_a>:<subsystem_b>": delta_score }
    -- Populated in Pass D (multi-subsystem disagreement engine).
    -- NULL in Pass A — column reserved for forward compatibility.
    disagreements               JSONB,

    -- Row creation timestamp (redundant with evaluated_at but
    -- consistent with project schema conventions).
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE strategy_health_scores IS
    'Append-only composite health bus. One row per aggregator run per strategy. '
    'Never UPDATE — insert a new row on each aggregation cycle. '
    'Wave 28 Pass A.1 — Layer C decision bus foundation. '
    'OCC/Fed/FDIC April 2026 MRM "one lineage graph" pattern.';

COMMENT ON COLUMN strategy_health_scores.composite_score IS
    'Weighted composite of all available subsystem scores in [0,1]. '
    'NULL when computed_from_n_subsystems < MIN_COMPOSITE_SUBSYSTEMS threshold.';

COMMENT ON COLUMN strategy_health_scores.verdict IS
    'HEALTHY | MARGINAL | UNHEALTHY | CRITICAL | NULL (insufficient subsystems). '
    'Derived from composite_score at aggregation time.';

COMMENT ON COLUMN strategy_health_scores.subsystem_scores IS
    'Per-subsystem detail map. Key = subsystem name (12 canonical). '
    'Value = {score, confidence, available, computed_at, error?}. '
    '"available: false" when the subsystem did not produce a score this cycle.';

COMMENT ON COLUMN strategy_health_scores.computed_from_n_subsystems IS
    'Number of the 12 canonical subsystems that returned a valid score. '
    'Gate composite_score / verdict decisions on this value.';

COMMENT ON COLUMN strategy_health_scores.weights_version_id IS
    'SHA-256 (64 hex chars) of canonical-sorted-JSON of the weights config. '
    'Full hash (vs 16-char firm_rules_version prefix) for complete lineage. '
    'Use this to detect weights drift across aggregation runs.';

COMMENT ON COLUMN strategy_health_scores.staleness_age_hours IS
    'Hours between NOW() and the oldest subsystem.computed_at in this run. '
    'Computed by the aggregator at insert time. High values flag stale data.';

COMMENT ON COLUMN strategy_health_scores.disagreements IS
    'Pairwise score deltas between subsystems. Populated in Pass D. '
    'NULL in Pass A (column reserved for forward compatibility).';

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary lookup: latest health score per strategy (most-recent-first)
CREATE INDEX IF NOT EXISTS idx_strategy_health_scores_strategy_evaluated
    ON strategy_health_scores (strategy_id, evaluated_at DESC);

-- Audit lineage: all rows produced under a given weights config
CREATE INDEX IF NOT EXISTS idx_strategy_health_scores_weights_version
    ON strategy_health_scores (weights_version_id);
