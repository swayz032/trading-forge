/**
 * pglite-db.ts — Wave hardening 2026-06-22, pglite real-DB test layer
 *
 * Creates a fresh in-memory PGlite instance per test file, wired to Drizzle ORM
 * using the real schema.ts table definitions.  Replaces the structurally-blind
 * mock-DB layer that gave green CI while hiding DB bugs (e.g. G4 INTEGER-vs-UUID,
 * B14 ci_high key-path disconnect).
 *
 * USAGE:
 *   import { createTestDb } from "../helpers/pglite-db.js";
 *
 *   let ctx: Awaited<ReturnType<typeof createTestDb>>;
 *   beforeAll(async () => { ctx = await createTestDb(); });
 *   afterAll(async ()  => { await ctx.close(); });
 *
 *   // Then use ctx.db exactly like the production db import.
 *
 * SCHEMA APPLICATION:
 *   We create the 10 core tables directly using inline SQL DDL (not migration files).
 *   The live migrations are PostgreSQL-specific and contain features like triggers,
 *   partial indexes with WHERE clauses, and pgcrypto functions that add friction
 *   without adding test coverage value.  All FK relationships are preserved so
 *   FK-violation bugs are caught.
 *
 * SKIPPED FEATURES (safe for test layer):
 *   - audit_log append-only trigger (migration 0058) — observability, not correctness
 *   - pgcrypto uuid_generate_v4() DEFAULT — supply explicit UUIDs in test inserts
 *   - paper_sessions unique partial index WHERE status='active' — production-only guard
 *   - paper_positions open partial index WHERE closed_at IS NULL — hot-path lookup only
 *
 * OTHER TESTS ADOPTING THIS LAYER:
 *   1. Import createTestDb, call in beforeAll/afterAll.
 *   2. Use ctx.db for Drizzle queries — same API as production.
 *   3. Supply explicit UUID strings (crypto.randomUUID()) for primary keys.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "../../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestDb {
  /** Drizzle client bound to the in-memory PGlite instance. */
  db: PgliteDatabase<typeof schema>;
  /** Raw PGlite instance for low-level SQL execution if needed. */
  pg: PGlite;
  /** Shut down the PGlite instance.  Call in afterAll(). */
  close: () => Promise<void>;
}

// ─── Core DDL ─────────────────────────────────────────────────────────────────
//
// Creates the 7 tables referenced by integration tests.
// PGlite supports standard PostgreSQL DDL including UUID, JSONB, BIGSERIAL,
// REAL, NUMERIC, TEXT[], TIMESTAMPTZ, FOREIGN KEY, and CHECK constraints.
//
// gen_random_uuid() is NOT available as a DEFAULT in PGlite 0.5.x without
// the pgcrypto extension being loaded.  Test code supplies explicit UUIDs via
// crypto.randomUUID() instead.

const CORE_DDL = `
-- Wave hardening 2026-06-22, pglite real-DB test layer
-- 10 core tables: strategies, backtests, monte_carlo_runs,
-- strategy_health_scores, lifecycle_shadow_signals, audit_log, lifecycle_transitions,
-- paper_sessions, paper_positions, paper_trades
-- Plus quantum_rl_runs (deepscan16 W1 T4) and broker_accounts (deepscan15 M3).
-- DDL mirrors schema.ts column-for-column so Drizzle INSERT statements match.

CREATE TABLE IF NOT EXISTS strategies (
  id                          UUID PRIMARY KEY,
  name                        TEXT NOT NULL,
  description                 TEXT,
  symbol                      TEXT NOT NULL DEFAULT 'MES',
  symbols                     TEXT[] NOT NULL DEFAULT ARRAY['MES'],
  timeframe                   TEXT NOT NULL DEFAULT '5m',
  config                      JSONB NOT NULL DEFAULT '{}',
  lifecycle_state             TEXT NOT NULL DEFAULT 'CANDIDATE',
  lifecycle_changed_at        TIMESTAMPTZ,
  preferred_regime            TEXT,
  preferred_regimes           TEXT[],
  rolling_sharpe_30d          NUMERIC,
  forge_score                 NUMERIC,
  tags                        TEXT[],
  search_budget_used          INTEGER,
  parent_strategy_id          UUID REFERENCES strategies(id) ON DELETE SET NULL,
  lineage_root_id             UUID REFERENCES strategies(id) ON DELETE SET NULL,
  generation                  INTEGER NOT NULL DEFAULT 0,
  source                      TEXT,
  use_weighted_scoring        BOOLEAN DEFAULT FALSE,
  confluence_score_threshold  NUMERIC,
  confluence_score_weights    JSONB,
  exit_plan_config            JSONB,
  paper_account_routing       TEXT NOT NULL DEFAULT 'baseline',
  shadow_mode_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_policy_hash          TEXT,
  frozen_policy_set_at        TIMESTAMPTZ,
  regime_trained_on           TEXT,
  frozen_policy_override_count INTEGER NOT NULL DEFAULT 0,
  daily_tf                    TEXT,
  htf_tf                      TEXT,
  itf_tf                      TEXT,
  trigger_tf                  TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backtests (
  id                    UUID PRIMARY KEY,
  strategy_id           UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  symbol                TEXT NOT NULL DEFAULT 'MES',
  timeframe             TEXT NOT NULL DEFAULT '5m',
  start_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                TEXT NOT NULL DEFAULT 'pending',
  total_return          NUMERIC,
  sharpe_ratio          NUMERIC,
  max_drawdown          NUMERIC,
  win_rate              NUMERIC,
  profit_factor         NUMERIC,
  total_trades          INTEGER,
  avg_trade_pnl         NUMERIC,
  avg_daily_pnl         NUMERIC,
  forge_score           NUMERIC,
  bif                   NUMERIC,
  k_eff                 NUMERIC,
  tier                  TEXT,
  equity_curve          JSONB,
  monthly_returns       JSONB,
  daily_pnls            JSONB,
  config                JSONB,
  walk_forward_results  JSONB,
  prop_compliance       JSONB,
  decay_analysis        JSONB,
  run_receipt           JSONB,
  sanity_checks         JSONB,
  cross_validation      JSONB,
  gate_result           JSONB,
  gate_rejections       JSONB,
  result_extras         JSONB,
  mrp_sharpe            NUMERIC,
  mrp_regime_breakdown  JSONB,
  information_ratio     NUMERIC,
  b15_battery           JSONB,
  firm_rules_version    TEXT,
  compliance_mode       TEXT,
  wrc_result            JSONB,
  spa_result            JSONB,
  provenance_stamp      JSONB,
  slippage_survival     JSONB,
  error_message         TEXT,
  execution_time_ms     INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key       TEXT
);

-- deepscan14 E7: partial unique index — only enforced when a caller supplies a key.
CREATE UNIQUE INDEX IF NOT EXISTS backtests_idempotency_key_uq
  ON backtests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS monte_carlo_runs (
  id                    UUID PRIMARY KEY,
  backtest_id           UUID NOT NULL REFERENCES backtests(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending',
  num_simulations       INTEGER NOT NULL DEFAULT 1000,
  max_drawdown_p5       NUMERIC,
  max_drawdown_p50      NUMERIC,
  max_drawdown_p95      NUMERIC,
  sharpe_p5             NUMERIC,
  sharpe_p50            NUMERIC,
  sharpe_p95            NUMERIC,
  probability_of_ruin   NUMERIC,
  var_95                NUMERIC,
  var_99                NUMERIC,
  cvar_95               NUMERIC,
  paths                 JSONB,
  risk_metrics          JSONB,
  execution_time_ms     INTEGER,
  gpu_accelerated       BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_health_scores (
  id                          BIGSERIAL PRIMARY KEY,
  strategy_id                 UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  evaluated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  composite_score             REAL,
  verdict                     TEXT,
  subsystem_scores            JSONB NOT NULL DEFAULT '{}',
  computed_from_n_subsystems  INTEGER NOT NULL,
  weights_version_id          TEXT NOT NULL,
  staleness_age_hours         REAL,
  disagreements               JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifecycle_shadow_signals (
  id                          BIGSERIAL PRIMARY KEY,
  strategy_id                 UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  signal_ts                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction                   TEXT NOT NULL,
  entry_price                 REAL NOT NULL,
  intended_size               INTEGER NOT NULL,
  killzone                    TEXT,
  regime                      TEXT,
  confluence_score            REAL,
  lifecycle_state             TEXT NOT NULL DEFAULT 'SHADOW',
  divergence_vs_backtest      REAL,
  source_correlation_id       TEXT NOT NULL,
  traderspost_webhook_called  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id                  UUID PRIMARY KEY,
  action              TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           UUID,
  input               JSONB,
  result              JSONB,
  status              TEXT NOT NULL DEFAULT 'success',
  duration_ms         INTEGER,
  error_message       TEXT,
  decision_authority  TEXT,
  correlation_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifecycle_transitions (
  id                                  UUID PRIMARY KEY,
  strategy_id                         UUID REFERENCES strategies(id) ON DELETE SET NULL,
  from_state                          TEXT NOT NULL,
  to_state                            TEXT NOT NULL,
  decision_authority                  TEXT NOT NULL,
  reason                              TEXT,
  backtest_id                         UUID REFERENCES backtests(id) ON DELETE SET NULL,
  forge_score                         NUMERIC,
  mc_survival_rate                    NUMERIC,
  quantum_agreement_score             NUMERIC,
  quantum_advantage_delta             NUMERIC,
  quantum_fallback_triggered          BOOLEAN DEFAULT FALSE,
  quantum_classical_disagreement_pct  NUMERIC,
  cloud_qmc_run_id                    UUID,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pass 6 Track C: paper_sessions / paper_positions / paper_trades tables.
-- Mirrors schema.ts column-for-column.  Partial/conditional unique indexes
-- and partial WHERE indexes are omitted here to reduce PGlite DDL friction
-- (they are observability/correctness guards for production, not correctness
-- correctness guards for the state-machine logic under test).
--
-- SKIPPED:
--   - UNIQUE INDEX WHERE status='active'  (paper_sessions_one_active_per_strategy)
--   - PARTIAL INDEX WHERE closed_at IS NULL (paper_positions_open_idx)
-- Both are safe to skip for state-machine / P&L integration tests.

CREATE TABLE IF NOT EXISTS paper_sessions (
  id                    UUID PRIMARY KEY,
  strategy_id           UUID REFERENCES strategies(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  mode                  TEXT NOT NULL DEFAULT 'paper',
  firm_id               TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at            TIMESTAMPTZ,
  paused_at             TIMESTAMPTZ,
  starting_capital      NUMERIC NOT NULL DEFAULT '50000',
  current_equity        NUMERIC NOT NULL DEFAULT '50000',
  peak_equity           NUMERIC NOT NULL DEFAULT '50000',
  realized_peak_equity  NUMERIC NOT NULL DEFAULT '50000',
  high_water_balance    NUMERIC NOT NULL DEFAULT '50000',
  config                JSONB,
  last_signal_time      TIMESTAMPTZ,
  cooldown_until        TIMESTAMPTZ,
  daily_pnl_breakdown   JSONB DEFAULT '{}',
  metrics_snapshot      JSONB DEFAULT '{}',
  total_trades          INTEGER NOT NULL DEFAULT 0,
  governor_state        JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id                        UUID PRIMARY KEY,
  session_id                UUID NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  symbol                    TEXT NOT NULL,
  side                      TEXT NOT NULL,
  entry_price               NUMERIC NOT NULL,
  current_price             NUMERIC,
  contracts                 INTEGER NOT NULL DEFAULT 1,
  unrealized_pnl            NUMERIC DEFAULT '0',
  entry_time                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at                 TIMESTAMPTZ,
  arrival_price             NUMERIC,
  implementation_shortfall  NUMERIC,
  fill_ratio                NUMERIC DEFAULT '1.0',
  trail_hwm                 NUMERIC,
  bars_held                 INTEGER NOT NULL DEFAULT 0,
  fill_probability          NUMERIC,
  mae                       NUMERIC,
  mfe                       NUMERIC,
  previous_unrealized_pnl   NUMERIC DEFAULT '0',
  tp1_filled_at             TIMESTAMPTZ,
  tp2_filled_at             TIMESTAMPTZ,
  tp1_filled                BOOLEAN NOT NULL DEFAULT FALSE,
  tp2_filled                BOOLEAN NOT NULL DEFAULT FALSE,
  be_stop_applied           BOOLEAN NOT NULL DEFAULT FALSE,
  current_exit_style        TEXT,
  current_trail_method      TEXT,
  last_handler_eval_at      TIMESTAMPTZ,
  exit_plan                 JSONB
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id                UUID PRIMARY KEY,
  session_id        UUID NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,
  entry_price       NUMERIC NOT NULL,
  exit_price        NUMERIC NOT NULL,
  pnl               NUMERIC NOT NULL,
  gross_pnl         NUMERIC,
  commission        NUMERIC DEFAULT '0',
  contracts         INTEGER NOT NULL DEFAULT 1,
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  slippage          NUMERIC,
  mae               NUMERIC,
  mfe               NUMERIC,
  hold_duration_ms  INTEGER,
  hour_of_day       INTEGER,
  day_of_week       INTEGER,
  session_type      TEXT,
  macro_regime      TEXT,
  event_active      BOOLEAN,
  skip_signal       TEXT,
  fill_probability  NUMERIC,
  roll_spread_cost  NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- deepscan16 W1 T4: quantum_rl_runs — mirrors migration 0158 + 0165 column-for-column
-- (schema.ts F-2 fix corrected strategy_id from INTEGER to UUID to match this DDL).
-- Append-only RL training + inference row log, separate namespace from
-- quantum_mc_runs. See migrations/0158_quantum_rl_runs.sql for full column comments.
CREATE TABLE IF NOT EXISTS quantum_rl_runs (
  id                      BIGSERIAL PRIMARY KEY,
  strategy_id             UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  regime                  TEXT NOT NULL,
  state_vector            JSONB NOT NULL,
  action                  TEXT NOT NULL,
  confidence_score        REAL NOT NULL,
  effective_confidence    REAL NOT NULL,
  reward                  REAL NOT NULL,
  ci_high_at_evaluation   REAL,
  drawdown_penalty        REAL,
  governance_labels       JSONB NOT NULL,
  cpcv_fold_id            INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seed                    INTEGER
);

-- deep-scan #15 FIX M3: broker_accounts with the firm↔broker_type topology CHECK
-- constraint (migration 0190). Mirrored here so the gate-chain integration test can
-- exercise the DB-level invariant (topstep MUST route topstepx, never traderspost;
-- mffu/others MUST route traderspost). CORE_DDL creates the table fresh so the CHECK
-- validates immediately (production migration uses NOT VALID for existing-row safety).
CREATE TABLE IF NOT EXISTS broker_accounts (
  account_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             TEXT NOT NULL,
  broker_type         TEXT NOT NULL,
  api_key_vault_ref   TEXT,
  account_id_external TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_symbols     TEXT[] NOT NULL DEFAULT ARRAY['MES'],
  dll_opted_in        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT broker_accounts_firm_broker_topology_chk CHECK (
    (regexp_replace(lower(firm_id), '_[0-9]+k$', '')  = 'topstep' AND broker_type = 'topstepx')
    OR
    (regexp_replace(lower(firm_id), '_[0-9]+k$', '') <> 'topstep' AND broker_type = 'traderspost')
  )
);
`;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Spin up a fresh in-memory PGlite database with core tables applied.
 *
 * Each call is fully isolated — no state shared between test files.
 * Startup time is <200ms on the Skytech tower (WASM already loaded).
 *
 * @returns TestDb with { db, pg, close }
 */
export async function createTestDb(): Promise<TestDb> {
  // No dataDir argument → purely in-memory, ephemeral, isolated
  const pg = new PGlite();

  // Apply core DDL synchronously inside PGlite before any test runs
  await pg.exec(CORE_DDL);

  // Bind Drizzle using the production schema.ts so column names, JSONB types,
  // and FK relationships are identical to production.
  const db = drizzle(pg, { schema }) as PgliteDatabase<typeof schema>;

  return {
    db,
    pg,
    close: async () => {
      await pg.close();
    },
  };
}
