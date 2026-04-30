// ─── Drizzle snapshot drift notice (Pass 9, 2026-04-29) ─────────────────────
// Trading Forge uses HAND-WRITTEN SQL migrations as the canonical pattern.
// Migrations 0003–0060 were authored as raw SQL (drizzle-kit was not used for
// generation). The journal `meta/_journal.json` has 63 entries through tag
// `0060_pine_export_content_hash`. The schema snapshots in `meta/*.snapshot.json`
// stop at `0002_snapshot.json` — this is intentional drift and is non-blocking.
//
// `npm run db:generate` is interactive (TTY-only) and asks for resolution on
// every column added since 0002. Because the team has standardized on hand-written
// SQL migrations, db:generate is not part of the deploy pipeline. Schema changes
// are made by:
//   1. Editing schema.ts (this file) for type-system source of truth
//   2. Writing a hand-rolled SQL migration in `migrations/` with the next index
//   3. Adding an entry to `meta/_journal.json`
//   4. Running `npm run db:migrate` (non-interactive) to apply
//
// drizzle-kit does NOT model PostgreSQL triggers (e.g. audit_log append-only
// trigger from migration 0058) or trigger functions. Any future db:generate flush
// must preserve the 0058 trigger and the audit_log index from migration 0058.
//
// Do NOT run `drizzle-kit push --force` against the live DB — it could clobber
// columns added by raw SQL migrations 0003–0060 and silently drop the audit_log
// mutation guard.
// ────────────────────────────────────────────────────────────────────────────
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  numeric,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Strategies ──────────────────────────────────────────────
export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  config: jsonb("config").notNull(), // Full strategy definition JSON
  lifecycleState: text("lifecycle_state").notNull().default("CANDIDATE"), // CANDIDATE | TESTING | PAPER | DEPLOY_READY | DEPLOYED | DECLINING | RETIRED
  lifecycleChangedAt: timestamp("lifecycle_changed_at").defaultNow(),
  preferredRegime: text("preferred_regime"), // TRENDING_UP | TRENDING_DOWN | RANGE_BOUND | HIGH_VOL | LOW_VOL
  rollingSharpe30d: numeric("rolling_sharpe_30d"),
  forgeScore: numeric("forge_score"),
  tags: text("tags").array(),
  searchBudgetUsed: integer("search_budget_used"),  // Cumulative Optuna trials across all WF windows
  parentStrategyId: uuid("parent_strategy_id"), // Self-evolution: links to parent strategy
  generation: integer("generation").notNull().default(0), // Evolution generation (0 = original)
  source: text("source"), // Origin of the strategy: 'ollama' | 'openclaw' | 'manual' | 'n8n' | 'evolved' (added by migration 0045)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
  (table) => [
    index("strategies_lifecycle_state_idx").on(table.lifecycleState),
    index("strategies_source_idx").on(table.source),
  ]
);

// ─── Backtests ───────────────────────────────────────────────
export const backtests = pgTable(
  "backtests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id")
      .references(() => strategies.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    totalReturn: numeric("total_return"),
    sharpeRatio: numeric("sharpe_ratio"),
    maxDrawdown: numeric("max_drawdown"),
    winRate: numeric("win_rate"),
    profitFactor: numeric("profit_factor"),
    totalTrades: integer("total_trades"),
    avgTradePnl: numeric("avg_trade_pnl"),
    avgDailyPnl: numeric("avg_daily_pnl"),
    forgeScore: numeric("forge_score"),
    tier: text("tier"), // TIER_1 | TIER_2 | TIER_3 | REJECTED
    equityCurve: jsonb("equity_curve"),
    monthlyReturns: jsonb("monthly_returns"),
    dailyPnls: jsonb("daily_pnls"),
    config: jsonb("config"), // Snapshot of strategy config used
    walkForwardResults: jsonb("walk_forward_results"),
    propCompliance: jsonb("prop_compliance"),
    decayAnalysis: jsonb("decay_analysis"),
    runReceipt: jsonb("run_receipt"),
    sanityChecks: jsonb("sanity_checks"),
    crossValidation: jsonb("cross_validation"),
    gateResult: jsonb("gate_result"),
    gateRejections: jsonb("gate_rejections"),
    resultExtras: jsonb("result_extras"),   // Governor, analytics, long_short_split, bootstrap_ci_95, deflated_sharpe, recency_analysis, statistical_warnings, confidence_intervals (migration 0053)
    errorMessage: text("error_message"),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("backtests_strategy_idx").on(table.strategyId),
    index("backtests_status_idx").on(table.status),
    index("backtests_tier_idx").on(table.tier),
    index("backtests_strategy_status_idx").on(table.strategyId, table.status),
    index("backtests_strategy_tier_idx").on(table.strategyId, table.tier),
  ]
);

// ─── Backtest Matrix (cross-symbol × timeframe testing) ─────
export const backtestMatrix = pgTable(
  "backtest_matrix",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("running"), // running | tier1 | tier2 | tier3 | completed | failed
    totalCombos: integer("total_combos").notNull(),
    completedCombos: integer("completed_combos").notNull().default(0),
    results: jsonb("results"), // [{symbol, timeframe, forgeScore, sharpe, trades, backtestId}]
    bestCombo: jsonb("best_combo"), // {symbol, timeframe, forgeScore, backtestId}
    tierStatus: jsonb("tier_status"), // {tier1: "completed", tier2: "running", tier3: "pending"}
    correlations: jsonb("correlations"), // [{symbol1, symbol2, correlation, warning}]
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("matrix_strategy_idx").on(table.strategyId),
    index("matrix_status_idx").on(table.status),
  ]
);

// ─── Backtest Trades ─────────────────────────────────────────
export const backtestTrades = pgTable(
  "backtest_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id")
      .references(() => backtests.id, { onDelete: "cascade" })
      .notNull(),
    matrixId: uuid("matrix_id").references(() => backtestMatrix.id),
    symbol: text("symbol"),
    timeframe: text("timeframe"),
    entryTime: timestamp("entry_time").notNull(),
    exitTime: timestamp("exit_time"),
    direction: text("direction").notNull(), // long | short
    entryPrice: numeric("entry_price").notNull(),
    exitPrice: numeric("exit_price"),
    pnl: numeric("pnl"),
    netPnl: numeric("net_pnl"),
    contracts: integer("contracts").notNull().default(1),
    commission: numeric("commission"),
    grossPnl: numeric("gross_pnl"),
    slippage: numeric("slippage"),
    mae: numeric("mae"), // Maximum Adverse Excursion ($)
    mfe: numeric("mfe"), // Maximum Favorable Excursion ($)
    holdDurationMs: integer("hold_duration_ms"),
    hourOfDay: integer("hour_of_day"),     // 0-23 ET
    dayOfWeek: integer("day_of_week"),     // 0=Mon, 4=Fri
    sessionType: text("session_type"),     // ASIA | LONDON | NY_OPEN | NY_CORE | NY_CLOSE | OVERNIGHT
    macroRegime: text("macro_regime"),     // RISK_ON, RISK_OFF, etc.
    eventActive: boolean("event_active"),  // Was FOMC/CPI/NFP within window?
    skipSignal: text("skip_signal"),       // What skip engine would have said
    fillProbability: numeric("fill_probability"), // Modeled fill probability (0-1)
  },
  (table) => [
    index("trades_backtest_idx").on(table.backtestId),
    index("trades_matrix_idx").on(table.matrixId),
    index("trades_symbol_idx").on(table.symbol),
  ]
);

// ─── Monte Carlo Runs ────────────────────────────────────────
export const monteCarloRuns = pgTable("monte_carlo_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  backtestId: uuid("backtest_id")
    .references(() => backtests.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  numSimulations: integer("num_simulations").notNull(),
  maxDrawdownP5: numeric("max_drawdown_p5"),
  maxDrawdownP50: numeric("max_drawdown_p50"),
  maxDrawdownP95: numeric("max_drawdown_p95"),
  sharpeP5: numeric("sharpe_p5"),
  sharpeP50: numeric("sharpe_p50"),
  sharpeP95: numeric("sharpe_p95"),
  probabilityOfRuin: numeric("probability_of_ruin"),
  var95: numeric("var_95"),
  var99: numeric("var_99"),
  cvar95: numeric("cvar_95"),
  paths: jsonb("paths"), // Sampled equity paths for visualization
  riskMetrics: jsonb("risk_metrics"), // Full metrics blob
  executionTimeMs: integer("execution_time_ms"),
  gpuAccelerated: boolean("gpu_accelerated").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
  (table) => [
    index("monte_carlo_runs_backtest_idx").on(table.backtestId),
  ]
);

// ─── Stress Test Runs ────────────────────────────────────────
export const stressTestRuns = pgTable("stress_test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  backtestId: uuid("backtest_id")
    .references(() => backtests.id, { onDelete: "cascade" })
    .notNull(),
  passed: boolean("passed").notNull(),
  scenarios: jsonb("scenarios").notNull(), // Array of per-scenario results
  failedScenarios: jsonb("failed_scenarios"), // Array of scenario names that failed
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
  (table) => [
    index("stress_test_runs_backtest_idx").on(table.backtestId),
  ]
);

// NOTE: marketDataMeta and watchlist tables were dropped in migration 0055
// (2026-04 audit: zero readers/writers). Data range resolution uses DuckDB
// queryInfo() against S3 directly; symbol selection uses strategy.symbol +
// firm-config, not a watchlist table.

// ─── Alerts ──────────────────────────────────────────────────
export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // trade_signal | drawdown | regime_change | degradation
  severity: text("severity").notNull().default("info"), // info | warning | critical
  title: text("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  acknowledged: boolean("acknowledged").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
  (table) => [
    index("alerts_type_idx").on(table.type),
    index("alerts_severity_idx").on(table.severity),
  ]
);

// ─── System Journal (AI Self-Learning Loop) ─────────────────
// Logs every AI-generated strategy's simulated performance so
// Ollama Analyst can review its own past generations nightly and
// self-improve. This is the "memory" that makes the system smarter.
export const systemJournal = pgTable(
  "system_journal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "set null" }),
    source: text("source").notNull(), // ollama | openclaw | manual | n8n
    generationPrompt: text("generation_prompt"), // What Ollama was asked
    strategyCode: text("strategy_code"), // The Python code Ollama generated
    strategyParams: jsonb("strategy_params"), // JSON params for the strategy
    simulatedEquity: jsonb("simulated_equity"), // Full vectorbt equity curve
    dailyPnls: jsonb("daily_pnls"), // Array of daily P&L values
    forgeScore: numeric("forge_score"), // 0-100 at time of test
    propComplianceResults: jsonb("prop_compliance_results"), // Per-firm pass/fail
    performanceGateResult: jsonb("performance_gate_result"), // Gate pass/fail + reasons
    tier: text("tier"), // TIER_1 | TIER_2 | TIER_3 | REJECTED
    analystNotes: text("analyst_notes"), // Ollama Analyst self-critique
    parentJournalId: uuid("parent_journal_id"), // Links refinements to original
    status: text("status").notNull().default("tested"), // tested | promoted | archived | failed | scouted | flagged
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("journal_strategy_idx").on(table.strategyId),
    index("journal_status_idx").on(table.status),
    index("journal_tier_idx").on(table.tier),
    index("journal_source_idx").on(table.source),
  ]
);

// ─── Audit Log (Trust Spine) ─────────────────────────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(), // strategy.create | backtest.run | mc.run | paper.trade | etc.
    entityType: text("entity_type"), // strategy | backtest | monte_carlo | paper_session
    entityId: uuid("entity_id"),
    input: jsonb("input"), // What was requested
    result: jsonb("result"), // What happened
    status: text("status").notNull(), // success | failure | pending
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    decisionAuthority: text("decision_authority"), // "gate" | "human" | "agent" | "scheduler" | "n8n"
    correlationId: text("correlation_id"), // HTTP request correlation ID (req.id) — nullable for backward compat
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_action_idx").on(table.action),
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_decision_authority_idx").on(table.decisionAuthority),
    index("audit_correlation_id_idx").on(table.correlationId),
    // Recency index for dashboard queries (ORDER BY created_at DESC LIMIT N).
    // Added by migration 0058 alongside the append-only trigger.
    index("idx_audit_log_created_at_desc").on(table.createdAt.desc()),
  ]
);

// NOTE: audit_log is append-only at the database level. Migration 0058 installs
// a BEFORE UPDATE OR DELETE trigger (`prevent_audit_log_mutation`) that raises
// `EXCEPTION 'audit_log is append-only'` on any mutation attempt. Drizzle does
// not model triggers in TypeScript; the constraint lives in the migration and
// is verified by `src/server/__tests__/audit-log-append-only.test.ts`.

// ─── Data Sync Jobs ──────────────────────────────────────────────
// NOTE: reader-only table as of 2026-04 audit — cost-tracker.ts reads via raw SQL
// (FROM data_sync_jobs) for the cost dashboard, but no TypeScript writer exists.
// Likely populated by an external process (n8n workflow or Python data sync script)
// that we did not catch in the audit. If never populated, the cost dashboard will
// show $0 for Databento spend. Verify whether n8n/Python writes to this table
// before assuming the cost number is accurate.
export const dataSyncJobs = pgTable(
  "data_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    source: text("source").notNull().default("databento"), // databento | massive | alphavantage
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    costUsd: numeric("cost_usd"),
    rowsDownloaded: integer("rows_downloaded"),
    rollsDetected: integer("rolls_detected"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"), // Pipeline result JSON
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("sync_jobs_symbol_idx").on(table.symbol),
    index("sync_jobs_status_idx").on(table.status),
  ]
);

// ─── Compliance Rulesets ────────────────────────────────────
export const complianceRulesets = pgTable(
  "compliance_rulesets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firm: text("firm").notNull(), // MFFU, Topstep, TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade
    accountType: text("account_type").notNull().default("default"), // e.g. '50K', '100K', 'Express'
    sourceUrl: text("source_url"), // URL where rules were fetched from
    contentHash: text("content_hash"), // SHA-256 of raw content for drift detection
    rawContent: text("raw_content"), // Full raw text of rules
    parsedRules: jsonb("parsed_rules"), // Structured parsed rules
    status: text("status").notNull().default("pending"), // pending | verified | stale | drift_detected
    driftDetected: boolean("drift_detected").default(false),
    driftDiff: text("drift_diff"), // Diff description if drift detected
    verifiedBy: text("verified_by"), // 'human' | 'openclaw'
    verifiedAt: timestamp("verified_at"),
    retrievedAt: timestamp("retrieved_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("compliance_rulesets_firm_idx").on(table.firm),
    index("compliance_rulesets_status_idx").on(table.status),
  ]
);

// ─── Compliance Reviews ─────────────────────────────────────
export const complianceReviews = pgTable(
  "compliance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    firm: text("firm").notNull(),
    accountType: text("account_type").notNull().default("default"),
    rulesetId: uuid("ruleset_id").references(() => complianceRulesets.id),
    complianceResult: text("compliance_result").notNull(), // pass | fail | warning | needs_review
    riskScore: numeric("risk_score").default("0"), // 0-100
    violations: jsonb("violations").default([]), // Array of violation objects
    warnings: jsonb("warnings").default([]), // Array of warning objects
    requiredChanges: jsonb("required_changes").default([]), // Array of required changes
    reasoningSummary: text("reasoning_summary"), // AI reasoning
    executionGate: text("execution_gate").notNull(), // APPROVED | BLOCKED | CONDITIONAL
    reviewedBy: text("reviewed_by").default("openclaw"), // openclaw | human
    invalidatedAt: timestamp("invalidated_at"),
    invalidationReason: text("invalidation_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("compliance_reviews_strategy_idx").on(table.strategyId),
    index("compliance_reviews_firm_idx").on(table.firm),
  ]
);

// ─── Compliance Drift Log ───────────────────────────────────
export const complianceDriftLog = pgTable(
  "compliance_drift_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firm: text("firm").notNull(),
    accountType: text("account_type").notNull().default("default"),
    rulesetId: uuid("ruleset_id").references(() => complianceRulesets.id),
    previousHash: text("previous_hash"),
    newHash: text("new_hash"),
    driftSummary: text("drift_summary"), // What changed
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
    resolved: boolean("resolved").default(false),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"),
    notes: text("notes"),
  },
  (table) => [
    index("compliance_drift_log_firm_idx").on(table.firm),
    index("compliance_drift_log_resolved_idx").on(table.resolved),
  ]
);

// ─── Skip Decisions (Pre-Session Classifier) ─────────────────
export const skipDecisions = pgTable(
  "skip_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }), // nullable — can be portfolio-wide
    decisionDate: timestamp("decision_date").notNull(),
    decision: text("decision").notNull(), // TRADE | REDUCE | SKIP
    score: numeric("score").notNull(),
    signals: jsonb("signals").notNull(), // full signal breakdown
    triggeredSignals: text("triggered_signals").array(), // array of signal names that fired
    reason: text("reason"),
    override: boolean("override").default(false), // human override
    overrideReason: text("override_reason"),
    actualOutcome: text("actual_outcome"), // WIN | LOSS | FLAT (filled post-session)
    actualPnl: numeric("actual_pnl"), // filled post-session
    // Phase 2.4 — Regret scoring
    regretScore: numeric("regret_score"),      // how much we regret this decision (>= 0)
    opportunityCost: numeric("opportunity_cost"), // for SKIP: foregone PnL; for TRADE: 0
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("skip_decisions_strategy_idx").on(table.strategyId),
    index("skip_decisions_date_idx").on(table.decisionDate),
    index("skip_decisions_decision_idx").on(table.decision),
  ]
);

// ─── Macro Snapshots (FRED/BLS/EIA Data) ─────────────────────
export const macroSnapshots = pgTable(
  "macro_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: timestamp("snapshot_date").notNull().unique(),
    fedFundsRate: numeric("fed_funds_rate"),
    treasury10y: numeric("treasury_10y"),
    treasury2y: numeric("treasury_2y"),
    treasury3m: numeric("treasury_3m"),
    vix: numeric("vix"),
    yieldSpread10y2y: numeric("yield_spread_10y2y"),
    unemployment: numeric("unemployment"),
    cpiYoy: numeric("cpi_yoy"),
    pceYoy: numeric("pce_yoy"),
    wtiCrude: numeric("wti_crude"),
    naturalGas: numeric("natural_gas"),
    macroRegime: text("macro_regime"), // RISK_ON | RISK_OFF | TIGHTENING | EASING | STAGFLATION | GOLDILOCKS | TRANSITION
    regimeConfidence: numeric("regime_confidence"),
    rawData: jsonb("raw_data"), // Full snapshot blob from all sources
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("macro_snapshots_date_idx").on(table.snapshotDate),
    index("macro_snapshots_regime_idx").on(table.macroRegime),
  ]
);

// ─── Strategy Graveyard ───────────────────────────────────────
// Vector-searchable archive of every failed strategy.
// New candidates checked before wasting backtest compute.
export const strategyGraveyard = pgTable(
  "strategy_graveyard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }), // nullable — might not have been saved
    name: text("name").notNull(),
    dslSnapshot: jsonb("dsl_snapshot").notNull(), // full strategy DSL at time of death
    failureModes: text("failure_modes").array().notNull(), // array of failure mode tags
    failureDetails: jsonb("failure_details"), // detailed analysis per failure mode
    backtestSummary: jsonb("backtest_summary"), // key metrics at time of death
    embedding: jsonb("embedding"), // vector as JSON array (768 dims) — using jsonb since pgvector may not be available
    deathReason: text("death_reason"), // human-readable summary
    deathDate: timestamp("death_date").notNull(),
    source: text("source").default("auto"), // auto | manual | decay
    failureCategory: text("failure_category"), // top-level category from MODE_TO_CATEGORY (robustness | regime | execution | compliance | performance | structural)
    failureSeverity: numeric("failure_severity"), // 0.0–1.0 from MODE_TO_SEVERITY for the primary failure mode
    searchableMetrics: jsonb("searchable_metrics"), // denormalised key metrics for graveyard search without parsing backtestSummary
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("graveyard_strategy_idx").on(table.strategyId),
    index("graveyard_death_date_idx").on(table.deathDate),
    index("graveyard_source_idx").on(table.source),
    index("graveyard_failure_category_idx").on(table.failureCategory),
  ]
);

// ─── Day Archetypes (Phase 4.13) ─────────────────────────────
export const dayArchetypes = pgTable(
  "day_archetypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    tradingDate: timestamp("trading_date").notNull(),
    archetype: text("archetype").notNull(), // TREND_DAY_UP | TREND_DAY_DOWN | RANGE_DAY | REVERSAL_DAY | EXPANSION_DAY | GRIND_DAY | GAP_AND_GO | INSIDE_DAY
    confidence: numeric("confidence"),
    metrics: jsonb("metrics"), // classification metrics
    features: jsonb("features"), // premarket features used for prediction
    predictedArchetype: text("predicted_archetype"), // what was predicted pre-session
    predictionCorrect: boolean("prediction_correct"), // was prediction right?
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("day_archetypes_symbol_date_idx").on(table.symbol, table.tradingDate),
    index("day_archetypes_archetype_idx").on(table.archetype),
  ]
);

// ─── Tournament Results (Phase 4.8) ──────────────────────────
export const tournamentResults = pgTable(
  "tournament_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentDate: timestamp("tournament_date").notNull(),
    candidateName: text("candidate_name").notNull(),
    candidateDsl: jsonb("candidate_dsl").notNull(),
    proposerOutput: jsonb("proposer_output"), // qwen3 proposer reasoning
    compilerPass: boolean("compiler_pass"),
    graveyardPass: boolean("graveyard_pass"),
    criticOutput: jsonb("critic_output"), // llama3.1:8b critic assessment
    prosecutorOutput: jsonb("prosecutor_output"), // llama3.1:8b prosecutor findings
    promoterOutput: jsonb("promoter_output"), // qwen3 final decision
    finalVerdict: text("final_verdict").notNull(), // PROMOTE | REVISE | KILL
    revisionNotes: text("revision_notes"),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at"), // TTL — null means no expiry
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tournament_results_date_idx").on(table.tournamentDate),
    index("tournament_results_verdict_idx").on(table.finalVerdict),
    index("tournament_results_candidate_idx").on(table.candidateName),
  ]
);

// ─── Paper Trading Sessions ────────────────────────────────
export const paperSessions = pgTable(
  "paper_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"), // active | stopped | paused
    mode: text("mode").notNull().default("paper"), // paper | shadow
    firmId: text("firm_id"),                          // e.g. "mffu", "topstep" — null = tightest defaults
    startedAt: timestamp("started_at").defaultNow().notNull(),
    stoppedAt: timestamp("stopped_at"),
    pausedAt: timestamp("paused_at"),                 // Gap 9: pause/resume
    startingCapital: numeric("starting_capital").notNull().default("50000"),
    currentEquity: numeric("current_equity").notNull().default("50000"),
    peakEquity: numeric("peak_equity").notNull().default("50000"),
    config: jsonb("config"),
    lastSignalTime: timestamp("last_signal_time"),    // Gap 3: cooldown persistence
    cooldownUntil: timestamp("cooldown_until"),        // Gap 3: cooldown persistence
    dailyPnlBreakdown: jsonb("daily_pnl_breakdown").default({}), // Gap 4: consistency tracking
    metricsSnapshot: jsonb("metrics_snapshot").default({}),       // Gap 5: rolling Sharpe
    totalTrades: integer("total_trades").notNull().default(0),    // H3: trade counter for promotion inputs
    governorState: jsonb("governor_state"),                        // P0-4: persisted governor state — { state, consecutiveLosses, sessionLossPct, lastUpdatedAt }
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paper_sessions_strategy_idx").on(table.strategyId),
    index("paper_sessions_status_idx").on(table.status),
  ]
);

// ─── Paper Trading Positions ───────────────────────────────
export const paperPositions = pgTable(
  "paper_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => paperSessions.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // long | short
    entryPrice: numeric("entry_price").notNull(),
    currentPrice: numeric("current_price"),
    contracts: integer("contracts").notNull().default(1),
    unrealizedPnl: numeric("unrealized_pnl").default("0"),
    entryTime: timestamp("entry_time").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
    arrivalPrice: numeric("arrival_price"),                  // Gap 8: TCA — signal price before latency/slippage
    implementationShortfall: numeric("implementation_shortfall"), // Gap 8: TCA — cost of execution
    fillRatio: numeric("fill_ratio").default("1.0"),         // Gap 8: TCA — intended vs filled
    trailHwm: numeric("trail_hwm"),                          // H2: trail stop high-water mark (persisted so restarts don't lose it)
    barsHeld: integer("bars_held").notNull().default(0),     // H2: bars held counter (persisted so restarts don't lose it)
    fillProbability: numeric("fill_probability"),            // Phase 1.1: fill probability used at entry (null for market orders that bypass the model)
    mae: numeric("mae"),                                     // Maximum Adverse Excursion ($) — per-bar watermark, accumulated by updatePositionPrices (migration 0034)
    mfe: numeric("mfe"),                                     // Maximum Favorable Excursion ($) — per-bar watermark, accumulated by updatePositionPrices (migration 0034)
    previousUnrealizedPnl: numeric("previous_unrealized_pnl").default("0"), // FIX 2 (B1): last committed unrealized P&L — enables delta-only SQL-atomic equity update
  },
  (table) => [
    index("paper_positions_session_idx").on(table.sessionId),
  ]
);

// ─── Paper Trading Trades ──────────────────────────────────
export const paperTrades = pgTable(
  "paper_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => paperSessions.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // long | short
    entryPrice: numeric("entry_price").notNull(),
    exitPrice: numeric("exit_price").notNull(),
    pnl: numeric("pnl").notNull(),           // NET P&L (after commission deduction)
    grossPnl: numeric("gross_pnl"),          // Gross P&L before commission (reference / audit)
    commission: numeric("commission", { precision: 12, scale: 4 }).default("0"), // Round-trip commission cost
    contracts: integer("contracts").notNull().default(1),
    entryTime: timestamp("entry_time").notNull(),
    exitTime: timestamp("exit_time").notNull(),
    slippage: numeric("slippage"),
    // ─── Phase 1.1: Journal Enrichment ──────────────────────
    mae: numeric("mae"),                              // Maximum Adverse Excursion — null until per-bar watermark tracking is implemented
    mfe: numeric("mfe"),                              // Maximum Favorable Excursion — null until per-bar watermark tracking is implemented
    holdDurationMs: integer("hold_duration_ms"),      // exitTime - entryTime in milliseconds
    hourOfDay: integer("hour_of_day"),                // UTC hour of entryTime (0–23)
    dayOfWeek: integer("day_of_week"),                // JS standard: 0=Sun, 1=Mon, ..., 6=Sat
    sessionType: text("session_type"),                // ASIA | LONDON | NY_OPEN | NY_CORE | NY_CLOSE | OVERNIGHT
    macroRegime: text("macro_regime"),                // Latest macroSnapshots.macroRegime at close time
    eventActive: boolean("event_active"),             // True if entryTime fell within an economic event blackout window
    skipSignal: text("skip_signal"),                  // Most recent skipDecisions.decision for the ET trading day (TRADE | REDUCE | SKIP)
    fillProbability: numeric("fill_probability"),     // Fill probability used at entry (copied from paperPositions)
    rollSpreadCost: numeric("roll_spread_cost"),      // Estimated calendar spread cost when position held across a CME roll date (null = pre-migration or no roll crossed)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paper_trades_session_idx").on(table.sessionId),
    index("paper_trades_symbol_idx").on(table.symbol),
    index("paper_trades_exit_time_idx").on(table.exitTime),
    index("paper_trades_created_idx").on(table.createdAt),
  ]
);

// ─── Paper Signal Logs (Full-Potential: detailed signal persistence) ──────
// Note: legacy "paper_signal_log" table still exists in DB (migration 0005) but is unused.
export const paperSignalLogs = pgTable(
  "paper_signal_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => paperSessions.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),           // "long" | "short"
    signalType: text("signal_type"),                  // "sma_cross", "rsi_reversal", etc.
    confidence: numeric("confidence"),
    price: numeric("price"),                          // market price at signal time
    indicatorSnapshot: jsonb("indicator_snapshot"),    // RSI, ATR, VWAP values at signal time
    acted: boolean("acted").default(false),            // was a position opened?
    reason: text("reason"),                           // if not acted, why (cooldown, risk gate, etc.)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paper_signal_logs_session_idx").on(table.sessionId),
    index("paper_signal_logs_created_idx").on(table.createdAt),
  ]
);

// ─── Shadow Signals (Gap 9 — Signal vs Reality) ──────────────
export const shadowSignals = pgTable(
    "shadow_signals",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        sessionId: uuid("session_id")
            .references(() => paperSessions.id, { onDelete: "cascade" })
            .notNull(),
        signalTime: timestamp("signal_time").notNull(),
        direction: text("direction").notNull(), // long | short
        expectedEntry: numeric("expected_entry").notNull(),
        expectedExit: numeric("expected_exit"),
        actualMarketPrice: numeric("actual_market_price"),
        wouldHaveFilled: boolean("would_have_filled"),
        theoreticalPnl: numeric("theoretical_pnl"),
        modelSlippage: numeric("model_slippage"),
        actualSlippage: numeric("actual_slippage"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("shadow_signals_session_idx").on(table.sessionId),
        index("shadow_signals_time_idx").on(table.signalTime),
    ]
);

// ─── Walk-Forward Windows ────────────────────────────────────
export const walkForwardWindows = pgTable(
    "walk_forward_windows",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
        windowIndex: integer("window_index").notNull(),
        isStart: text("is_start"),
        isEnd: text("is_end"),
        oosStart: text("oos_start"),
        oosEnd: text("oos_end"),
        bestParams: jsonb("best_params"),
        isMetrics: jsonb("is_metrics"),
        oosMetrics: jsonb("oos_metrics"),
        paramStability: jsonb("param_stability"),
        confidence: text("confidence"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("wf_windows_backtest_idx").on(table.backtestId),
    ]
);

// ── Quantum Risk Lab ──────────────────────────────────────────────────

export const quantumMcRuns = pgTable("quantum_mc_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    method: text("method").notNull(), // iae | sqa | tensor_mps | qubo_timing | quantum_rl
    backend: text("backend"), // aer_statevector | aer_gpu | cpu | dwave_neal | pennylane
    numQubits: integer("num_qubits"),
    estimatedValue: numeric("estimated_value"),
    classicalValue: numeric("classical_value"),
    toleranceDelta: numeric("tolerance_delta"),
    withinTolerance: boolean("within_tolerance"),
    confidenceInterval: jsonb("confidence_interval"), // {lower, upper, confidence_level}
    executionTimeMs: integer("execution_time_ms"),
    gpuAccelerated: boolean("gpu_accelerated").default(false),
    governanceLabels: jsonb("governance_labels").notNull().default({}), // {experimental: true, authoritative: false, decision_role: "challenger_only"}
    rawResult: jsonb("raw_result"),
    reproducibilityHash: text("reproducibility_hash"), // SHA-256 of run config
    cloudProvider: text("cloud_provider"),
    cloudBackendName: text("cloud_backend_name"),
    cloudJobId: text("cloud_job_id"),
    cloudQpuTimeSeconds: numeric("cloud_qpu_time_seconds"),
    cloudCostDollars: numeric("cloud_cost_dollars"),
    cloudRegion: text("cloud_region"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("qmc_runs_backtest_idx").on(table.backtestId),
    index("qmc_runs_method_idx").on(table.method),
]);

export const quantumMcBenchmarks = pgTable("quantum_mc_benchmarks", {
    id: uuid("id").primaryKey().defaultRandom(),
    quantumRunId: uuid("quantum_run_id").references(() => quantumMcRuns.id).notNull(),
    classicalRunId: uuid("classical_run_id").references(() => monteCarloRuns.id),
    metric: text("metric").notNull(), // breach_probability | ruin_probability | target_hit | tail_loss | sharpe | max_drawdown
    quantumValue: numeric("quantum_value"),
    classicalValue: numeric("classical_value"),
    absoluteDelta: numeric("absolute_delta"),
    relativeDelta: numeric("relative_delta"),
    toleranceThreshold: numeric("tolerance_threshold"),
    passes: boolean("passes"),
    notes: text("notes"),
    backendType: text("backend_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("qmc_bench_quantum_run_idx").on(table.quantumRunId),
    index("qmc_bench_metric_idx").on(table.metric),
]);

// ─── Strategy Names (Forge Codename Pool) ────────────────────────────
export const strategyNames = pgTable("strategy_names", {
    id: uuid("id").primaryKey().defaultRandom(),
    codename: text("codename").notNull().unique(),
    fullName: text("full_name").notNull().unique(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    claimed: boolean("claimed").default(false),
    claimedAt: timestamp("claimed_at"),
    retired: boolean("retired").default(false),
    retiredAt: timestamp("retired_at"),
    version: text("version").default("v1.0"),
    originClass: text("origin_class"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("strategy_names_claimed_idx").on(table.claimed),
    index("strategy_names_strategy_id_idx").on(table.strategyId),
]);

// ── Strategy Exports ──────────────────────────────────────────────────

export const strategyExports = pgTable("strategy_exports", {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    // FIX 3: backtestId links the export to the backtest that produced it (for reproducibility).
    // ON DELETE SET NULL so exports survive backtest row deletion.
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "set null" }),
    exportType: text("export_type").notNull(), // pine_indicator | pine_strategy | alert_only | pine_dual
    // P1-4: Pine v5 is what the compiler actually emits. Default was historically
    // v6 (an aspirational target) but no v6-only feature is used. Aligning the
    // schema default with the runtime emission removes drift between the column
    // value and the artifact text.
    pineVersion: text("pine_version").default("v5"),
    exportabilityScore: numeric("exportability_score"), // 0-100
    exportabilityDetails: jsonb("exportability_details"),
    status: text("status").notNull().default("pending"), // pending | compiling | completed | failed
    errorMessage: text("error_message"),
    propOverlayFirm: text("prop_overlay_firm"),
    // FIX 3: contentHash — SHA-256 of all artifact texts concatenated. Used to detect re-export drift.
    contentHash: text("content_hash"),
    // FIX 3: configSnapshot — snapshot of the strategy config at export time for reproducibility.
    configSnapshot: jsonb("config_snapshot"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("strat_exports_strategy_idx").on(table.strategyId),
    index("strat_exports_status_idx").on(table.status),
]);

export const strategyExportArtifacts = pgTable("strategy_export_artifacts", {
    id: uuid("id").primaryKey().defaultRandom(),
    exportId: uuid("export_id").references(() => strategyExports.id, { onDelete: "cascade" }).notNull(),
    artifactType: text("artifact_type").notNull(), // indicator | strategy_shell | prop_overlay | alerts_json | dual_indicator | dual_strategy
    fileName: text("file_name").notNull(),
    content: text("content").notNull(),
    sizeBytes: integer("size_bytes"),
    // P1-4: matches strategy_exports.pine_version default (compiler emits v5).
    pineVersion: text("pine_version").default("v5"),
    // FIX 3: contentHash — SHA-256 of this artifact's content text. Used to detect per-artifact drift.
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("strat_export_artifacts_export_idx").on(table.exportId),
]);

// ─── Quantum Persistence: SQA Optimization Runs ─────────────────────

export const sqaOptimizationRuns = pgTable("sqa_optimization_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    paramRanges: jsonb("param_ranges"), // [{name, min_val, max_val, n_bits}]
    bestParams: jsonb("best_params"),
    bestEnergy: numeric("best_energy"),
    robustPlateau: jsonb("robust_plateau"), // {center, width, stability_score}
    allSolutions: jsonb("all_solutions"), // top 20 solutions with energies
    numReads: integer("num_reads"),
    numSweeps: integer("num_sweeps"),
    executionTimeMs: integer("execution_time_ms"),
    governanceLabels: jsonb("governance_labels").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("sqa_runs_backtest_idx").on(table.backtestId),
    index("sqa_runs_strategy_idx").on(table.strategyId),
]);

// ─── Quantum Persistence: QUBO Timing Runs ──────────────────────────

export const quboTimingRuns = pgTable("qubo_timing_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    sessionType: text("session_type"), // rth | eth | full
    windowSize: integer("window_size"), // minutes per block (default 30)
    schedule: jsonb("schedule"), // [{block_index, start_time, end_time, trade: bool}]
    expectedReturn: numeric("expected_return"),
    costSavings: numeric("cost_savings"),
    backtestImprovement: numeric("backtest_improvement"), // % improvement vs trade-all
    governanceLabels: jsonb("governance_labels").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("qubo_timing_backtest_idx").on(table.backtestId),
    index("qubo_timing_strategy_idx").on(table.strategyId),
]);

// ─── Quantum Persistence: Tensor Predictions ────────────────────────

export const tensorPredictions = pgTable("tensor_predictions", {
    id: uuid("id").primaryKey().defaultRandom(),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    modelVersion: text("model_version"), // hash of MPS model used
    probability: numeric("probability"), // P(profitable)
    confidence: numeric("confidence"),
    signal: text("signal"), // bullish | bearish | neutral
    featureSnapshot: jsonb("feature_snapshot"), // input features at prediction time
    regimeAtPrediction: text("regime_at_prediction"),
    fragilityScore: numeric("fragility_score"), // 0-1, regime variance + param sensitivity
    regimeBreakdown: jsonb("regime_breakdown"), // {regime: P(profitable)}
    governanceLabels: jsonb("governance_labels").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("tensor_pred_backtest_idx").on(table.backtestId),
    index("tensor_pred_strategy_idx").on(table.strategyId),
]);

// ─── Quantum Persistence: RL Training Runs ──────────────────────────

export const rlTrainingRuns = pgTable("rl_training_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    method: text("method").notNull(), // pennylane_vqc | classical_dqn
    nQubits: integer("n_qubits"),
    nLayers: integer("n_layers"),
    episodes: integer("episodes"),
    maxSteps: integer("max_steps"),
    totalReturn: numeric("total_return"),
    sharpeRatio: numeric("sharpe_ratio"),
    winRate: numeric("win_rate"),
    totalTrades: integer("total_trades"),
    policyWeights: jsonb("policy_weights"), // serialized weights for replay
    comparisonResult: jsonb("comparison_result"), // quantum vs classical delta
    governanceLabels: jsonb("governance_labels").notNull().default({}),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("rl_runs_strategy_idx").on(table.strategyId),
    index("rl_runs_method_idx").on(table.method),
]);

// ─── Critic Optimization Runs ───────────────────────────────────────

export const criticOptimizationRuns = pgTable("critic_optimization_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | collecting_evidence | analyzing | replaying | completed | failed
    candidatesGenerated: integer("candidates_generated"),
    // P1-8: FK constraints — survivor pointers must reference live rows or be NULL.
    // SET NULL on cascade so deleting a candidate/backtest doesn't blow away the
    // critic run record (we want the run history preserved even if its survivor
    // is later cleaned up). criticCandidates is declared below this table, but
    // Drizzle's references() callback is lazy so the forward reference resolves
    // at table-build time without a TDZ issue. The matching FK constraint is
    // installed by migration 0063.
    survivorCandidateId: uuid("survivor_candidate_id").references((): any => criticCandidates.id, { onDelete: "set null" }),
    survivorBacktestId: uuid("survivor_backtest_id").references(() => backtests.id, { onDelete: "set null" }),
    parentCompositeScore: numeric("parent_composite_score"),
    survivorCompositeScore: numeric("survivor_composite_score"),
    evidenceSources: jsonb("evidence_sources"), // {sqa, mc, quantum_mc, tensor, qubo, pennylane, rl}
    evidencePacket: jsonb("evidence_packet"), // full assembled packet for reproducibility
    compositeWeights: jsonb("composite_weights"),
    executionTimeMs: integer("execution_time_ms"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("critic_runs_strategy_idx").on(table.strategyId),
    index("critic_runs_backtest_idx").on(table.backtestId),
    index("critic_runs_status_idx").on(table.status),
]);

// ─── Critic Candidates ──────────────────────────────────────────────

export const criticCandidates = pgTable("critic_candidates", {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => criticOptimizationRuns.id, { onDelete: "cascade" }).notNull(),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
    rank: integer("rank").notNull(),
    changedParams: jsonb("changed_params").notNull(), // {param_name: new_value}
    parentParams: jsonb("parent_params"), // {param_name: old_value}
    sourceOfChange: text("source_of_change").notNull(), // sqa_plateau | optuna_consensus | pennylane_refined | timing_optimized | cuopt_selected | mixed
    expectedUplift: numeric("expected_uplift"),
    riskPenalty: numeric("risk_penalty"),
    compositeScore: numeric("composite_score"), // predicted pre-replay
    actualCompositeScore: numeric("actual_composite_score"), // after replay
    confidence: text("confidence"), // high | medium | low
    reasoning: text("reasoning"),
    replayStatus: text("replay_status").notNull().default("pending"), // pending | running | completed | failed | skipped
    replayBacktestId: uuid("replay_backtest_id").references(() => backtests.id, { onDelete: "set null" }),
    replayTier: text("replay_tier"), // TIER_1 | TIER_2 | TIER_3 | REJECTED
    replayForgeScore: numeric("replay_forge_score"),
    selected: boolean("selected").default(false), // was this the survivor?
    governanceLabels: jsonb("governance_labels").notNull().default({}),
    // P2-2: critic model version and run IDs for full audit provenance
    criticModelVersion: text("critic_model_version"), // e.g. "deepseek-r1:14b@2026-04"
    evidenceRunIds: jsonb("evidence_run_ids").$type<{
      mc?: string[];
      sqa?: string[];
      wf?: string[];
      qmc?: string[];
      tensor?: string[];
      rl?: string[];
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("critic_cand_run_idx").on(table.runId),
    index("critic_cand_strategy_idx").on(table.strategyId),
    index("critic_cand_status_idx").on(table.replayStatus),
    index("critic_cand_selected_idx").on(table.selected),
]);

// ─── DeepAR Forecasts (Regime Prediction) ────────────────────────────

export const deeparForecasts = pgTable("deepar_forecasts", {
    id: uuid("id").primaryKey().defaultRandom(),
    forecastDate: date("forecast_date").notNull(),
    generatedAt: timestamp("generated_at").defaultNow(),
    symbol: text("symbol").notNull(),
    predictionHorizon: integer("prediction_horizon").default(5),
    pHighVol: numeric("p_high_vol"),
    pTrending: numeric("p_trending"),
    pMeanRevert: numeric("p_mean_revert"),
    pCorrelationStress: numeric("p_correlation_stress"),
    forecastConfidence: numeric("forecast_confidence"),
    quantileP10: numeric("quantile_p10"),
    quantileP50: numeric("quantile_p50"),
    quantileP90: numeric("quantile_p90"),
    actualRegime: text("actual_regime"),
    hitRate: numeric("hit_rate"),
    modelVersion: text("model_version"),
    // Phase 2.4 — Forecast quality tracking
    regretScore: numeric("regret_score"),    // magnitude of regime mis-call cost
    magnitudeError: numeric("magnitude_error"), // |predicted_prob - actual_prob| for top regime
    governanceLabels: jsonb("governance_labels").notNull().default({ experimental: true, authoritative: false, decision_role: "challenger_only" }),
},
(table) => [
    index("deepar_forecasts_symbol_idx").on(table.symbol),
    index("deepar_forecasts_date_idx").on(table.forecastDate),
]);

// ─── DeepAR Training Runs ────────────────────────────────────────────

export const deeparTrainingRuns = pgTable("deepar_training_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    trainedAt: timestamp("trained_at").defaultNow(),
    symbols: jsonb("symbols"),
    dataRangeStart: date("data_range_start"),
    dataRangeEnd: date("data_range_end"),
    epochs: integer("epochs"),
    trainingLoss: numeric("training_loss"),
    validationLoss: numeric("validation_loss"),
    modelPath: text("model_path"),
    durationMs: integer("duration_ms"),
    status: text("status").notNull().default("pending"),
    governanceLabels: jsonb("governance_labels").notNull().default({ experimental: true, authoritative: false, decision_role: "challenger_only" }),
},
(table) => [
    index("deepar_training_status_idx").on(table.status),
]);

// NOTE: portfolioSnapshots table was dropped in migration 0055 (2026-04 audit:
// writer-only, zero readers). The correlation snapshot continues to be computed
// by portfolio-optimizer-service.runPortfolioCorrelationCheck() and broadcast
// via SSE ("portfolio:correlation_snapshot"); historical persistence was
// removed because no consumer queried it.

// ─── Agent Health Reports ───────────────────────────────────────────

export const agentHealthReports = pgTable("agent_health_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull(), // lifecycle | paper | compliance | critic | deepar | decay | scout | risk | scheduler
  status: text("status").notNull().default("healthy"), // healthy | degraded | down | unknown
  lastCheckedAt: timestamp("last_checked_at").defaultNow().notNull(),
  latencyMs: integer("latency_ms"),
  errorCount: integer("error_count").default(0),
  details: jsonb("details"), // domain-specific health payload
  recommendations: jsonb("recommendations"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("agent_health_domain_idx").on(table.domain),
    index("agent_health_status_idx").on(table.status),
]);

// ─── System Parameters (Auto-Tuning) ───────────────────────────────

export const systemParameters = pgTable("system_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  paramName: text("param_name").notNull().unique(),
  currentValue: numeric("current_value").notNull(),
  minValue: numeric("min_value"),
  maxValue: numeric("max_value"),
  description: text("description"),
  domain: text("domain").notNull(), // lifecycle | paper | compliance | critic | risk | scheduler
  autoTunable: boolean("auto_tunable").default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    uniqueIndex("system_params_name_idx").on(table.paramName),
    index("system_params_domain_idx").on(table.domain),
]);

export const systemParameterHistory = pgTable("system_parameter_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  paramId: uuid("param_id").references(() => systemParameters.id).notNull(),
  previousValue: numeric("previous_value").notNull(),
  newValue: numeric("new_value").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("meta-optimizer"), // meta-optimizer | manual | auto-tune
  gateMetrics: jsonb("gate_metrics"), // snapshot of metrics that triggered the change
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
    index("param_history_param_idx").on(table.paramId),
]);

// ─── Paper Session Feedback (Phase 4.6 — Critic Evidence) ───────────
// Per-session learning evidence computed when a paper session closes.
// Critic queries this to use empirical paper evidence in optimization.
// Created by migration 0037_paper_session_feedback.

export const paperSessionFeedback = pgTable("paper_session_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => paperSessions.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  totalTrades: integer("total_trades").notNull().default(0),
  totalPnl: numeric("total_pnl"),
  winRate: numeric("win_rate"),
  avgRrRealized: numeric("avg_rr_realized"),
  profitFactor: numeric("profit_factor"),
  medianMae: numeric("median_mae"),
  avgLoss: numeric("avg_loss"),
  stopTightnessRatio: numeric("stop_tightness_ratio"),
  winRateBySession: jsonb("win_rate_by_session"),
  pnlBySession: jsonb("pnl_by_session"),
  tradeCountBySession: jsonb("trade_count_by_session"),
  bestSessionWindow: text("best_session_window"),
  worstSessionWindow: text("worst_session_window"),
  winRateBySide: jsonb("win_rate_by_side"),
  medianMfe: numeric("median_mfe"),
  avgMfeOnWinners: numeric("avg_mfe_on_winners"),
  mfeCaptureRate: numeric("mfe_capture_rate"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  sessionStart: timestamp("session_start"),
  sessionEnd: timestamp("session_end"),
  hasMaeData: boolean("has_mae_data").notNull().default(false),
  notes: text("notes"),
},
(table) => [
    index("paper_session_feedback_session_idx").on(table.sessionId),
    index("paper_session_feedback_strategy_idx").on(table.strategyId),
    index("paper_session_feedback_computed_idx").on(table.computedAt),
]);

// ─── Mutation Outcomes (Phase 2.2 — Impact Tracking) ─────────────────
// Records the observed impact of every parameter mutation that was backtested
// during evolution. Used by the critic to learn which mutation types work in
// which regimes, building an empirical mutation effectiveness database.

export const mutationOutcomes = pgTable("mutation_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  parentArchetype: text("parent_archetype"),  // strategy tag / archetype label
  mutationType: text("mutation_type"),         // param_shift | period_expand | period_contract | mixed
  paramName: text("param_name"),               // e.g. ind_0_period
  direction: text("direction"),                // increase | decrease
  magnitude: numeric("magnitude"),             // absolute change applied
  parentMetrics: jsonb("parent_metrics"),      // {sharpe, profitFactor, maxDrawdown}
  childMetrics: jsonb("child_metrics"),        // {sharpe, profitFactor, maxDrawdown}
  improvement: numeric("improvement"),         // childSharpe - parentSharpe (signed)
  regime: text("regime"),                      // preferredRegime at time of mutation
  success: boolean("success"),                 // improvement > 0
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("mutation_outcomes_strategy_idx").on(table.strategyId),
  index("mutation_outcomes_type_idx").on(table.mutationType),
  index("mutation_outcomes_success_idx").on(table.success),
  index("mutation_outcomes_regime_idx").on(table.regime),
]);

// ─── Contract Roll Events (Wave D3) ─────────────────────────────────────────
// Logs every flatten/warn action triggered by the roll calendar handler.
// pre_roll_pnl captures unrealized P&L at the moment of flattening — used to
// quantify the P&L impact of per-roll discontinuities vs held-to-expiry.
export const contractRolls = pgTable("contract_rolls", {
  id:             uuid("id").primaryKey().defaultRandom(),
  positionId:     uuid("position_id").notNull(),       // soft FK to paper_positions
  sessionId:      uuid("session_id").notNull(),
  symbol:         text("symbol").notNull(),
  action:         text("action").notNull(),             // 'flatten' | 'warn'
  rollDate:       date("roll_date").notNull(),          // CME roll date
  flattenDate:    date("flatten_date").notNull(),       // day action was taken (roll - 1 biz day)
  contracts:      integer("contracts").notNull(),
  preRollPnl:     numeric("pre_roll_pnl"),              // unrealized P&L at flatten time
  activeContract: text("active_contract"),              // e.g. 'MESH26'
  reason:         text("reason").notNull().default("contract_rollover"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("contract_rolls_session_idx").on(table.sessionId),
  index("contract_rolls_symbol_idx").on(table.symbol),
  index("contract_rolls_created_idx").on(table.createdAt),
]);

// ─── Dead Letter Queue (0039 / 0046) ────────────────────────────────
// Failed async ops that exhausted retries; consumed by health-monitor + alerts.

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationType: text("operation_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  errorMessage: text("error_message").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  firstFailedAt: timestamp("first_failed_at").notNull(),
  lastFailedAt: timestamp("last_failed_at").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  metadata: jsonb("metadata"),
  escalated: boolean("escalated").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("dlq_operation_type_idx").on(table.operationType),
  index("dlq_resolved_idx").on(table.resolved),
  index("dlq_escalated_idx").on(table.escalated),
]);

// ─── n8n Execution Log (0042) ───────────────────────────────────────

export const n8nExecutionLog = pgTable("n8n_execution_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: text("workflow_id").notNull(),
  workflowName: text("workflow_name").notNull(),
  executionId: text("execution_id"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  triggerType: text("trigger_type"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("n8n_exec_workflow_idx").on(table.workflowId),
  index("n8n_exec_status_idx").on(table.status),
]);

// ─── Idempotency Keys (0047) ────────────────────────────────────────

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey().notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Subsystem Metrics (0048) ───────────────────────────────────────

export const subsystemMetrics = pgTable("subsystem_metrics", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  subsystem: text("subsystem").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: numeric("metric_value").notNull(),
  tags: jsonb("tags"),
  measuredAt: timestamp("measured_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("subsystem_metrics_subsystem_idx").on(table.subsystem),
  index("subsystem_metrics_name_idx").on(table.metricName),
  index("subsystem_metrics_measured_at_idx").on(table.measuredAt),
  index("subsystem_metrics_subsystem_name_idx").on(table.subsystem, table.metricName),
]);

// ─── Prompt Versions + A/B Tests (0049) ─────────────────────────────

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  promptType: text("prompt_type").notNull(),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  metrics: jsonb("metrics"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("prompt_versions_type_idx").on(table.promptType),
  index("prompt_versions_active_idx").on(table.isActive),
]);

export const promptAbTests = pgTable("prompt_ab_tests", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  promptType: text("prompt_type").notNull(),
  versionAId: uuid("version_a_id").references(() => promptVersions.id),
  versionBId: uuid("version_b_id").references(() => promptVersions.id),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  metricsA: jsonb("metrics_a"),
  metricsB: jsonb("metrics_b"),
  winner: text("winner"),
  status: text("status").default("running").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("prompt_ab_tests_status_idx").on(table.status),
  index("prompt_ab_tests_type_idx").on(table.promptType),
]);

// ─── Lifecycle Transitions (Tier 0.1, migration 0064) ───────────────────────
// First-class typed table for lifecycle state transitions. Mirrors the
// existing audit_log.action="strategy.lifecycle" rows but with first-class
// quantum challenger evidence columns so Tier 7 graduation queries become
// indexable single-table SQL instead of JSONB blob scans.
//
// Dual-write contract: lifecycle-service.ts writes to BOTH audit_log
// (existing, preserved) AND lifecycle_transitions (new) on every successful
// transition, inside the same db.transaction(). Synchronous, no fire-and-forget.
//
// cloud_qmc_run_id is intentionally unconstrained at the column level; the FK
// to cloud_qmc_runs(id) is added in W4 (Tier 4.5) once that table lands.
export const lifecycleTransitions = pgTable("lifecycle_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id")
    .references(() => strategies.id, { onDelete: "cascade" })
    .notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  decisionAuthority: text("decision_authority").notNull(), // gate | human | scheduler | n8n | quantum_challenger
  reason: text("reason"),
  backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "set null" }),
  forgeScore: numeric("forge_score"),
  mcSurvivalRate: numeric("mc_survival_rate"),
  // Quantum challenger evidence (Tier 1.1+, populated as modules land)
  quantumAgreementScore: numeric("quantum_agreement_score"),         // 0-1, classical/quantum agreement
  quantumAdvantageDelta: numeric("quantum_advantage_delta"),         // signed delta (quantum - classical)
  quantumFallbackTriggered: boolean("quantum_fallback_triggered").default(false),
  quantumClassicalDisagreementPct: numeric("quantum_classical_disagreement_pct"),
  cloudQmcRunId: uuid("cloud_qmc_run_id"), // Reserved for W4 cloud_qmc_runs FK
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("idx_lifecycle_transitions_strategy_created").on(table.strategyId, table.createdAt.desc()),
  // Partial index condition (WHERE quantum_agreement_score IS NOT NULL) lives
  // in the SQL migration. Drizzle-kit doesn't model partial-index predicates
  // in TypeScript; the constraint is enforced by migration 0064.
  index("idx_lifecycle_transitions_quantum_agreement").on(table.quantumAgreementScore),
]);

// ─── A+ Market Auditor Scans (Tier 3.3, migration 0066) ─────────────────────
// One row per calendar day. Pending-row contract: status="pending" on insert;
// updated to "completed"/"failed" on resolve by a-plus-auditor-service.ts.
// Governance: challenger_only — advisory output, no execution authority.
// Compliance handoff: lead_market field is consumed by Tier 5.3.1
// (check_correlated_position_guard, W5b) to enforce sequential-only ordering.
export const aPlusMarketScans = pgTable(
  "a_plus_market_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanDate: date("scan_date").notNull(),
    winnerMarket: text("winner_market"),             // MES | MNQ | MCL | null (observation mode)
    observationMode: boolean("observation_mode").notNull().default(false),
    edgeScores: jsonb("edge_scores").notNull().default({}),
    // {MES: {vol, p_target, noise, entangle, composite, passes_p_target_gate, passes_noise_gate}, ...}
    leadMarket: text("lead_market"),                // MES | MNQ | MCL | DXY | null
    lagWindowMinutes: integer("lag_window_minutes"),
    entanglementStrength: numeric("entanglement_strength"),
    status: text("status").notNull().default("pending"), // pending | completed | failed
    errorMessage: text("error_message"),
    scanDurationMs: integer("scan_duration_ms"),
    hardware: text("hardware"),                     // default.qubit | fallback_classical | fallback_unavailable
    seed: integer("seed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_a_plus_market_scans_scan_date").on(table.scanDate),
    index("idx_a_plus_market_scans_date").on(table.scanDate.desc()),
    index("idx_a_plus_market_scans_status").on(table.status),
  ],
);

// ─── Quantum Run Costs Telemetry (Tier 0.2, migration 0065) ─────────────────
// Per-run cost telemetry for every quantum module. Without this, "is quantum
// worth the compute?" is unanswerable at graduation time (Tier 7 / W7a).
//
// Pending-row contract: status starts "pending" on insert (before Python
// subprocess spawn), updated to "completed"/"failed" on resolve.
//
// FK posture: SET NULL on delete — cost rows MUST outlive the backtests/
// strategies they reference (they ARE the audit trail for graduation).
export const quantumRunCosts = pgTable("quantum_run_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleName: text("module_name").notNull(),  // quantum_mc | sqa | rl_agent | entropy_filter | adversarial_stress | cloud_qmc | ising_decoder
  backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "set null" }),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  wallClockMs: integer("wall_clock_ms").notNull(),
  qpuSeconds: numeric("qpu_seconds").default("0"),       // only nonzero for cloud QPU runs
  costDollars: numeric("cost_dollars").default("0"),     // only nonzero for paid cloud
  cacheHit: boolean("cache_hit").default(false),
  status: text("status").notNull(),                      // pending | completed | failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("idx_quantum_run_costs_module_created").on(table.moduleName, table.createdAt.desc()),
]);

// ─── Adversarial Stress Runs (Tier 3.4, migration 0066) ──────────────────────
// Grover worst-case sequencer evidence. Challenger-only.
// Phase 0 shadow: lifecycle gate is 100% classical — this table is observation-only.
// Phase 1 block (W7b Day 52): worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4
//   will block TESTING->PAPER promotion ONLY after W7b graduation.
//
// governance_labels always enforces:
//   experimental:true, authoritative:false, decision_role:challenger_only
export const adversarialStressRuns = pgTable("adversarial_stress_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  backtestId: uuid("backtest_id").references(() => backtests.id, { onDelete: "cascade" }).notNull(),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }).notNull(),
  nQubits: integer("n_qubits").notNull().default(0),
  nTrades: integer("n_trades").notNull().default(0),
  dailyLossLimit: numeric("daily_loss_limit").notNull(),
  worstCaseBreachProb: numeric("worst_case_breach_prob"),           // [0,1]; NULL when not completed
  breachMinimalNTrades: integer("breach_minimal_n_trades"),         // Smallest consecutive window
  worstSequenceExamples: jsonb("worst_sequence_examples"),          // top-K [{sequence, loss_sum}]
  qpuSeconds: numeric("qpu_seconds").default("0"),                  // 0 for local; nonzero for cloud QPU
  wallClockMs: integer("wall_clock_ms"),
  method: text("method").notNull(),                                  // grover_quantum | brute_force_classical | random_sample_classical
  status: text("status").notNull().default("pending"),               // pending | completed | failed | aborted
  errorMessage: text("error_message"),
  governanceLabels: jsonb("governance_labels").default(
    '{"experimental":true,"authoritative":false,"decision_role":"challenger_only"}'
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(table) => [
  index("idx_adversarial_stress_backtest").on(table.backtestId, table.createdAt.desc()),
  index("idx_adversarial_stress_strategy").on(table.strategyId, table.createdAt.desc()),
]);
