-- Migration: 0096_production_path
-- Track 4 Phase 4A — Production Hardening Foundation.
-- Creates the four tables that form the hard-isolated production trading path.
-- Isolation rule: src/server/production/* imports NOTHING from agent-service,
-- critic-optimizer-service, quantum_*, scout-* or synthetic_market_simulator.

-- ─── system_state ────────────────────────────────────────────────────────────
-- Singleton row. Single source of truth for production trading mode.
-- production_mode:  'HALT' | 'PAPER' | 'LIVE'
-- Starts HALT. Only KillSwitch.setMode() may mutate this row.
-- Every mutation writes an audit_log row + broadcasts SSE.
CREATE TABLE system_state (
  id               INT PRIMARY KEY DEFAULT 1,
  production_mode  TEXT NOT NULL DEFAULT 'HALT',
  kill_reason      TEXT,
  set_by           TEXT NOT NULL DEFAULT 'system',
  set_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO system_state (id, production_mode, kill_reason, set_by)
VALUES (1, 'HALT', 'initial_state', 'migration')
ON CONFLICT DO NOTHING;

-- ─── production_trades ───────────────────────────────────────────────────────
-- One row per production trade signal with full provenance.
-- Links strategy version, bias decision, compliance check, broker IDs,
-- slippage / PnL actuals vs expected, and a correlation_id for end-to-end trace.
CREATE TABLE production_trades (
  id                         BIGSERIAL PRIMARY KEY,
  strategy_id                UUID NOT NULL,
  strategy_version_hash      TEXT NOT NULL,
  bar_timestamp              TIMESTAMPTZ NOT NULL,
  signal_value               SMALLINT NOT NULL,          -- -1 short | 0 none | 1 long
  bias_decision_id           BIGINT REFERENCES bias_decisions(id),
  compliance_check_id        BIGINT,
  traderspost_webhook_id     TEXT,
  tradovate_fill_id          TEXT,
  expected_slippage          NUMERIC(8,4),
  actual_slippage            NUMERIC(8,4),
  expected_pnl               NUMERIC(12,4),
  actual_pnl                 NUMERIC(12,4),
  correlation_id             UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prod_trades_strategy    ON production_trades(strategy_id, created_at DESC);
CREATE INDEX idx_prod_trades_bar_ts      ON production_trades(bar_timestamp);
CREATE INDEX idx_prod_trades_correlation ON production_trades(correlation_id);

-- ─── daily_reconciliation ────────────────────────────────────────────────────
-- One row per trading day. Reconciles production_trades count vs TradersPost
-- log count vs Tradovate fills count vs MFFU dashboard P&L.
-- mismatch_count > 0 fires an alert_fired flag. Phase 4B wires the cron.
CREATE TABLE daily_reconciliation (
  id                       BIGSERIAL PRIMARY KEY,
  recon_date               DATE NOT NULL UNIQUE,
  production_trades_count  INT NOT NULL,
  traderspost_log_count    INT NOT NULL,
  tradovate_fills_count    INT NOT NULL,
  mffu_dashboard_pnl       NUMERIC(12,4),
  expected_pnl             NUMERIC(12,4) NOT NULL,
  mismatch_count           INT NOT NULL DEFAULT 0,
  mismatch_details         JSONB NOT NULL DEFAULT '[]',
  alert_fired              BOOLEAN NOT NULL DEFAULT false,
  ran_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── weekly_drift_reports ────────────────────────────────────────────────────
-- One row per week. Live vs backtest drift detection.
-- severity: 'green' | 'yellow' | 'red'
-- auto_halt_triggered: true when severity='red' caused a HALT mode transition.
-- Phase 4B wires the drift-detector cron (Sunday).
CREATE TABLE weekly_drift_reports (
  id                        BIGSERIAL PRIMARY KEY,
  report_week               DATE NOT NULL UNIQUE,
  live_sharpe_30d           NUMERIC(8,4),
  backtest_sharpe_expected  NUMERIC(8,4),
  sharpe_delta_sigma        NUMERIC(8,4),
  win_rate_delta            NUMERIC(8,4),
  slippage_delta            NUMERIC(8,4),
  latency_p95_ms            INT,
  severity                  TEXT NOT NULL,                -- 'green' | 'yellow' | 'red'
  auto_halt_triggered       BOOLEAN NOT NULL DEFAULT false,
  ran_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DOWN ────────────────────────────────────────────────────────────────────
-- Reversible. Run this block manually to roll back:
--
-- DROP TABLE IF EXISTS weekly_drift_reports;
-- DROP TABLE IF EXISTS daily_reconciliation;
-- DROP TABLE IF EXISTS production_trades;
-- DROP TABLE IF EXISTS system_state;
