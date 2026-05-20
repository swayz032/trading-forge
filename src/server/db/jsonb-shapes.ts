// ─── JSONB Shape Contracts ──────────────────────────────────────────────────
// F-4 / F-7 (migrations 0125+): TypeScript-level shape annotations for JSONB
// columns. Postgres JSON Schema validation in Drizzle is messy + brittle, so
// we enforce shape at the language boundary instead:
//
//   • Writers must `.$type<>()` the column in schema.ts.
//   • Python writers mirror these shapes in `src/engine/jsonb_contracts.py`
//     and `.model_dump()` through a pydantic model before INSERT/UPDATE.
//   • TS readers SHOULD zod-validate at the JSONB boundary
//     (see `src/server/lib/jsonb-validators.ts` — TODO if absent).
//
// Schema-version gating
// ─────────────────────
// Every JSONB shape carries a `schema_version` string. Writers stamp the version
// they produced; readers MUST refuse to consume an unknown version. Bumping the
// version is mandatory for any breaking change.
//
//   Current versions:
//     BacktestResultExtrasShape    → "v2_truthiness"
//     PaperSessionConfigShape      → "v1"
//     PaperSessionGovernorState    → "v1"
//
// DO NOT mutate a shape silently. Any new key requires:
//   1. schema_version bump (e.g. v2_truthiness → v3_<reason>)
//   2. Python pydantic mirror updated in jsonb_contracts.py
//   3. Reader validator updated to accept both old + new versions during rollout
// ────────────────────────────────────────────────────────────────────────────

/**
 * Backtest `result_extras` JSONB (table: backtests).
 *
 * Python writer: src/engine/backtester.py (governor, invariants, parity_shadow).
 * TS reader: src/server/services/backtest-orchestrator.ts and truthiness-check.
 */
export interface BacktestResultExtrasShape {
  /**
   * Reader-side gate (current: "v2_truthiness"). Optional during rollout —
   * legacy rows pre-F-4 lack it; readers MUST treat absence as "v1_legacy"
   * and apply the legacy validator. Bump → bump pydantic mirror in same PR.
   */
  schema_version?: string;

  /** Truthiness invariant harness (B-2). */
  invariants?: {
    overall_passed: boolean;
    checks?: Array<{
      name: string;
      passed: boolean;
      detail?: string;
    }>;
  };

  /** Parity-shadow run vs deterministic baseline (B-1). */
  parity_shadow?: {
    passed: boolean;
    drift_pct?: number;
    baseline_run_id?: string;
  };

  /** DSL stop-ceiling / floor / time-stop skip counters. */
  dsl_guards?: {
    stop_ceiling_skips?: number;
    stop_floor_skips?: number;
    time_stop_flatten_count?: number;
  };

  /** Governor (B-4) state captured at run end. */
  governor?: {
    state: "ENABLED" | "PAUSED" | "FAILED";
    sessionLossPct?: number;
    consecutiveLosses?: number;
    lastUpdatedAt?: string; // ISO8601
  };

  /** Analytics rollups (migration 0053). */
  long_short_split?: { long_pnl: number; short_pnl: number };
  bootstrap_ci_95?: { lower: number; upper: number };
  deflated_sharpe?: number;
  recency_analysis?: Record<string, unknown>;
  statistical_warnings?: string[];
  confidence_intervals?: Record<string, { lower: number; upper: number }>;

  // Forward-compat: allow but don't require extra keys. Readers MUST NOT
  // depend on unknown keys; writers MUST NOT remove documented keys without
  // bumping schema_version.
  [k: string]: unknown;
}

/**
 * Paper session `config` JSONB (table: paper_sessions).
 *
 * Writer: src/server/services/paper-execution-service.ts on session create.
 * Reader: same service on session resume.
 */
export interface PaperSessionConfigShape {
  /** Optional during rollout — see BacktestResultExtrasShape.schema_version. */
  schema_version?: string; // "v1"
  symbols?: string[];
  timeframe?: string;
  maxRiskPctPerTrade?: number;
  personalDllPct?: number;
  pyramidBaseContracts?: Record<string, number>;
  liquidityCaps?: Record<string, number>;
  [k: string]: unknown;
}

/**
 * Paper session `governor_state` JSONB (table: paper_sessions).
 *
 * Writer: paper-execution-service.ts on every governor transition.
 * Reader: governor service on resume / SSE broadcast.
 */
export interface PaperSessionGovernorStateShape {
  /** Optional during rollout — see BacktestResultExtrasShape.schema_version. */
  schema_version?: string; // "v1"
  // Permissive string union — actual states defined by GovernorStateName in
  // paper-signal-service.ts: normal | alert | cautious | defensive | lockout
  // | recovery (plus legacy ENABLED/PAUSED/FAILED for back-compat). Don't tighten
  // this without updating the writers in lockstep.
  state: string;
  consecutiveLosses: number;
  sessionLossPct?: number;
  lastUpdatedAt: string; // ISO8601
  reason?: string;
  // Forward-compat: governor implementations may track additional counters
  // (e.g. consecutiveWins). Readers MUST NOT depend on unknown keys.
  [k: string]: unknown;
}
