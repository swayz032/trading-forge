-- Migration 0160: Wave 29 Pass A.1 — lifecycle_shadow_signals + strategies.shadow_mode_enabled
--
-- PURPOSE:
--   Introduces the SHADOW lifecycle stage between TESTING and PAPER.
--   When shadow_mode_enabled=true on a strategy, signals fire Pine alerts (visible on
--   TradingView chart) but TradersPost webhook is NEVER called.  Signal details are
--   logged here for divergence analysis (A.3) before the strategy is promoted to PAPER.
--
--   Per 2026 institutional consensus (AltStreet Quant 2.0 Dec 2025): 15-25% of
--   institutional production model failures are training-serving skew.  The SHADOW
--   stage is the trust boundary that surfaces skew before paper money is at risk.
--
-- APPEND-ONLY CONTRACT:
--   No UPDATE statements are permitted on lifecycle_shadow_signals.
--   divergence_vs_backtest is populated by A.3 divergence checker via a new row
--   (or a dedicated divergence_results table — NOT a mutation of this row).
--   NOTE: divergence_vs_backtest is included here as a nullable column so A.3 can
--   write results back to the same row via UPDATE. This is an intentional exception
--   to the pure append-only pattern — divergence is computed post-insert and the
--   exception is documented here.
--
-- INVARIANT enforced at application layer (never by DB trigger):
--   traderspost_webhook_called MUST be false for every row in this table.
--   If a bug causes it to be true, that is a CRITICAL parity violation — audit and alert.
--
-- IDEMPOTENT: safe to re-run (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).

-- ── 1. New lifecycle_shadow_signals table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_shadow_signals (
    -- Surrogate key — bigserial for high-volume append workload
    id                          BIGSERIAL PRIMARY KEY,

    -- FK to the strategy in SHADOW stage.
    -- UUID: matches strategies.id type (strategies PK is uuid, not integer).
    -- ON DELETE CASCADE: shadow rows are meaningless without parent strategy.
    strategy_id                 UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,

    -- Wall-clock time the signal was evaluated (UTC).
    signal_ts                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Trade direction. Values: 'long' | 'short'
    direction                   TEXT NOT NULL,

    -- Entry price at signal time (paper-close price at signal bar).
    entry_price                 REAL NOT NULL,

    -- Number of contracts the strategy would have entered (pre-shadow intercept).
    intended_size               INTEGER NOT NULL,

    -- Active killzone at signal time.
    -- Values: 'london' | 'ny_am' | 'ny_pm' | 'silver_bullet' | 'macro_window' | NULL
    killzone                    TEXT,

    -- Institutional regime value at signal time (from bias_state).
    -- Values: TRENDING | RANGE_BOUND | HIGH_VOL_MACRO | COMPRESSION | EXPANSION | LOW_LIQ_CHOP | null
    regime                      TEXT,

    -- Weighted confluence score [0,1] at signal time.
    -- NULL when strategy uses boolean path (Path A/B) rather than weighted Path C.
    confluence_score            REAL,

    -- Lifecycle state at time of insert. Always 'SHADOW' — included for
    -- future-proofing if state shifts mid-shadow (e.g., promoted while signal in flight).
    lifecycle_state             TEXT NOT NULL DEFAULT 'SHADOW',

    -- Divergence score vs backtest expected signals [0,1].
    -- NULL on insert; filled by Wave 29 Pass A.3 divergence checker.
    -- 0 = no divergence; 1 = complete divergence; <0.05 = PASS gate.
    -- NOTE: A.3 UPDATEs this column on the existing row (see APPEND-ONLY CONTRACT note above).
    divergence_vs_backtest      REAL,

    -- Correlation ID linking bar → handler → DB → SSE → audit_log per §10b.
    -- Required — every signal must be traceable end-to-end.
    source_correlation_id       TEXT NOT NULL,

    -- Invariant: MUST always be false.
    -- Shadow signals NEVER route to TradersPost — this is the definition of shadow.
    -- Application layer enforces this; column exists for explicit auditability.
    traderspost_webhook_called  BOOLEAN NOT NULL DEFAULT false,

    -- Row creation timestamp (consistent with project schema conventions).
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE lifecycle_shadow_signals IS
    'Append-only log of signals intercepted in SHADOW lifecycle stage. '
    'TradersPost webhook is NEVER called for rows in this table. '
    'Wave 29 Pass A.1. divergence_vs_backtest filled post-insert by A.3 checker. '
    'OCC/Fed/FDIC April 2026 MRM: provides audit lineage for SHADOW → PAPER promotion gate.';

COMMENT ON COLUMN lifecycle_shadow_signals.strategy_id IS
    'UUID FK to strategies.id. Strategies in SHADOW lifecycle_state only.';

COMMENT ON COLUMN lifecycle_shadow_signals.traderspost_webhook_called IS
    'INVARIANT: always false. Shadow signals never route to TradersPost. '
    'If true in any row, that is a CRITICAL parity violation.';

COMMENT ON COLUMN lifecycle_shadow_signals.divergence_vs_backtest IS
    'Divergence score [0,1] vs backtest expected signals. '
    'NULL on insert; filled by Wave 29 Pass A.3 divergence checker. '
    '<0.05 = PASS for SHADOW → PAPER promotion gate.';

COMMENT ON COLUMN lifecycle_shadow_signals.source_correlation_id IS
    'End-to-end trace ID per §10b: bar → handler → DB → SSE → audit_log reconstruction.';

-- ── 2. Indexes ─────────────────────────────────────────────────────────────────

-- Primary access pattern: all shadow signals for a strategy, newest first.
CREATE INDEX IF NOT EXISTS idx_shadow_signals_strategy_ts
    ON lifecycle_shadow_signals (strategy_id, signal_ts DESC);

-- A.3 divergence checker join queries: find rows needing divergence computation.
CREATE INDEX IF NOT EXISTS idx_shadow_signals_lifecycle_state
    ON lifecycle_shadow_signals (lifecycle_state);

-- ── 3. Add shadow_mode_enabled to strategies ───────────────────────────────────
-- Default false: all pre-Wave-29 strategies use the existing TESTING → PAPER path.
-- Set to true on new strategies to route them through the SHADOW stage first.
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS shadow_mode_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN strategies.shadow_mode_enabled IS
    'Wave 29 Pass A.1. When true, strategy signals enter the SHADOW stage: '
    'signals are logged to lifecycle_shadow_signals but TradersPost webhook is NOT called. '
    'Pine alerts still fire on TradingView (operator sees signal on chart). '
    'After ≥20 shadow signals with <5% divergence, strategy promotes to PAPER stage.';
