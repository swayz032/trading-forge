-- Wave 29 Pass C.1 -- quantum_rl_runs: separate namespace from quantum_mc_runs
-- prevents circular IAE-vs-RL feedback (audit finding 2026-05-26).
--
-- NAMESPACE CONTRACT:
--   quantum_rl_runs  = RL training rows (this table)
--   quantum_mc_runs  = IAE challenger rows (existing table)
--   These namespaces must NEVER be merged. The separation prevents RL-confidence
--   scores from contaminating IAE Quantum Monte Carlo estimates and vice versa.
--
-- APPEND-ONLY CONTRACT:
--   This table is append-only. No UPDATE statements are permitted.
--   Every RL decision writes a new row. Callers read the latest row per strategy
--   via the (strategy_id, evaluated_at DESC) index.
--   Rationale: immutable audit lineage required by OCC/Fed/FDIC April 2026 MRM.
--
-- GOVERNANCE LABELS CONTRACT (enforced at app layer before every INSERT):
--   governance_labels MUST include:
--     { "experimental": true, "authoritative": false,
--       "decision_role": "challenger_only", "training_mode": true }
--   NOT "replay_mode" -- that is quantum_mc_runs IAE replay's contract.
--
-- IDEMPOTENT:
--   Re-running this migration on an existing DB is a no-op (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS quantum_rl_runs (
    -- Surrogate key -- bigserial for high-volume append workload
    id                      BIGSERIAL PRIMARY KEY,

    -- FK to the strategy being evaluated. ON DELETE CASCADE: RL rows are
    -- meaningless without the parent strategy.
    strategy_id             INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,

    -- When this RL decision was produced (wall-clock UTC).
    evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Institutional regime at decision time.
    -- Values: TRENDING | RANGE_BOUND | HIGH_VOL_MACRO | COMPRESSION | EXPANSION | LOW_LIQ_CHOP
    regime                  TEXT NOT NULL,

    -- ~25-feature state vector serialized for replay.
    -- Shape: { daily_atr, daily_ema_20, htf_bias_direction, itf_structure_state,
    --          htf_narrative_phase, killzone, institutional_regime,
    --          confluence_score_11factor, liquidity_proximity_pts, session_phase,
    --          smt_score, noise_score (nullable), position, pnl, ... }
    state_vector            JSONB NOT NULL,

    -- Agent action at decision time.
    -- Values: 'act' (take the trade) | 'skip' (pass)
    -- LONG/FLAT 2-action space only -- no short signals against HTF trend.
    -- See: feedback_day_trader_only_no_swing.md operator mandate.
    action                  TEXT NOT NULL,

    -- Raw policy confidence score in [0, 1] before dampening.
    confidence_score        REAL NOT NULL,

    -- Post-dampening confidence score (confidence dampening applied for first
    -- N=100 trades: effective = raw * min(1.0, n_trades / 100)).
    -- C.2 computes and passes this value; C.1 persists what was used.
    effective_confidence    REAL NOT NULL,

    -- Realized reward for this step.
    -- Formula: realized_R - alpha * max(0, ci_high - 0.40) - beta * drawdown_penalty
    -- where alpha = QUANTUM_RL_REWARD_ALPHA (default 0.5)
    --       beta  = QUANTUM_RL_REWARD_BETA  (default 0.3)
    reward                  REAL NOT NULL,

    -- Snapshot of probability_of_ruin_ci.ci_high at decision time.
    -- Read from monte_carlo_runs table (BCa-bootstrap conservative bound,
    -- Wave 27.5 Pass A). NULL when no MC run available for this strategy.
    ci_high_at_evaluation   REAL,

    -- beta drawdown penalty component from rolling 20-step P&L drawdown.
    -- NULL when drawdown window not yet filled.
    drawdown_penalty        REAL,

    -- Governance metadata -- REQUIRED on every row.
    -- Must include: { experimental: true, authoritative: false,
    --                 decision_role: "challenger_only", training_mode: true }
    -- Note: training_mode NOT replay_mode (IAE replay uses replay_mode).
    governance_labels       JSONB NOT NULL,

    -- Walk-forward fold this training row came from.
    -- Used by CPCV purge gate (C.3) to filter IS/OOS overlap.
    -- NULL for live-paper training rows (no WF fold context).
    cpcv_fold_id            INTEGER,

    -- Row creation timestamp (consistent with project schema conventions).
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quantum_rl_runs IS
    'Append-only RL training + inference row log. '
    'Separate namespace from quantum_mc_runs -- prevents circular IAE-vs-RL feedback. '
    'Wave 29 Pass C.1. Governance: challenger_only, training_mode=true. '
    'OCC/Fed/FDIC April 2026 MRM one-lineage-graph pattern.';

COMMENT ON COLUMN quantum_rl_runs.action IS
    'act = take trade, skip = pass. LONG/FLAT 2-action only. '
    'No short signals against HTF trend per operator day-trader-only mandate.';

COMMENT ON COLUMN quantum_rl_runs.reward IS
    'Realized R - alpha * max(0, ci_high - 0.40) - beta * drawdown_penalty. '
    'alpha default 0.5 (QUANTUM_RL_REWARD_ALPHA env), beta default 0.3 (QUANTUM_RL_REWARD_BETA env).';

COMMENT ON COLUMN quantum_rl_runs.ci_high_at_evaluation IS
    'BCa-bootstrap ci_high snapshot from monte_carlo_runs at decision time. '
    'Wave 27.5 Pass A conservative bound. NULL when no MC run available.';

COMMENT ON COLUMN quantum_rl_runs.governance_labels IS
    'Must contain: experimental=true, authoritative=false, '
    'decision_role=challenger_only, training_mode=true. '
    'training_mode is DISTINCT from replay_mode (IAE replay contract).';

COMMENT ON COLUMN quantum_rl_runs.cpcv_fold_id IS
    'Walk-forward fold ID for CPCV purge gate (Pass C.3). '
    'NULL for live-paper rows (no WF context).';

-- Indexes

-- Primary lookup: latest RL run per strategy (most-recent-first)
CREATE INDEX IF NOT EXISTS idx_quantum_rl_runs_strategy_evaluated
    ON quantum_rl_runs (strategy_id, evaluated_at DESC);

-- Per-regime training set queries (regime-conditioned policy training)
CREATE INDEX IF NOT EXISTS idx_quantum_rl_runs_regime_action
    ON quantum_rl_runs (regime, action);

-- CPCV purge gate: query by fold for IS/OOS leakage detection (Pass C.3)
CREATE INDEX IF NOT EXISTS idx_quantum_rl_runs_cpcv_fold
    ON quantum_rl_runs (cpcv_fold_id)
    WHERE cpcv_fold_id IS NOT NULL;
