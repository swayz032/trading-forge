import {
  pgTable,
  uuid,
  text,
  timestamp,
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
  lifecycleState: text("lifecycle_state").notNull().default("CANDIDATE"), // CANDIDATE | TESTING | PAPER | DEPLOYED | DECLINING | RETIRED
  lifecycleChangedAt: timestamp("lifecycle_changed_at").defaultNow(),
  preferredRegime: text("preferred_regime"), // TRENDING_UP | TRENDING_DOWN | RANGE_BOUND | HIGH_VOL | LOW_VOL
  rollingSharpe30d: numeric("rolling_sharpe_30d"),
  forgeScore: numeric("forge_score"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Backtests ───────────────────────────────────────────────
export const backtests = pgTable(
  "backtests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id")
      .references(() => strategies.id)
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
    errorMessage: text("error_message"),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("backtests_strategy_idx").on(table.strategyId),
    index("backtests_status_idx").on(table.status),
    index("backtests_tier_idx").on(table.tier),
  ]
);

// ─── Backtest Matrix (cross-symbol × timeframe testing) ─────
export const backtestMatrix = pgTable(
  "backtest_matrix",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id).notNull(),
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
    slippage: numeric("slippage"),
    mae: numeric("mae"), // Maximum Adverse Excursion ($)
    mfe: numeric("mfe"), // Maximum Favorable Excursion ($)
    holdDurationMs: integer("hold_duration_ms"),
    hourOfDay: integer("hour_of_day"),     // 0-23 ET
    dayOfWeek: integer("day_of_week"),     // 0=Mon, 4=Fri
    macroRegime: text("macro_regime"),     // RISK_ON, RISK_OFF, etc.
    eventActive: boolean("event_active"),  // Was FOMC/CPI/NFP within window?
    skipSignal: text("skip_signal"),       // What skip engine would have said
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
    .references(() => backtests.id)
    .notNull(),
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
});

// ─── Stress Test Runs ────────────────────────────────────────
export const stressTestRuns = pgTable("stress_test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  backtestId: uuid("backtest_id")
    .references(() => backtests.id)
    .notNull(),
  passed: boolean("passed").notNull(),
  scenarios: jsonb("scenarios").notNull(), // Array of per-scenario results
  failedScenarios: jsonb("failed_scenarios"), // Array of scenario names that failed
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Market Data Metadata ────────────────────────────────────
export const marketDataMeta = pgTable(
  "market_data_meta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    earliestDate: timestamp("earliest_date").notNull(),
    latestDate: timestamp("latest_date").notNull(),
    totalBars: integer("total_bars").notNull(),
    s3Path: text("s3_path"),
    lastSyncAt: timestamp("last_sync_at"),
  },
  (table) => [
    uniqueIndex("market_data_symbol_tf_idx").on(table.symbol, table.timeframe),
  ]
);

// ─── Watchlist ───────────────────────────────────────────────
export const watchlist = pgTable("watchlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().unique(),
  name: text("name"),
  exchange: text("exchange"),
  active: boolean("active").default(true),
  notes: text("notes"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

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
});

// ─── System Journal (AI Self-Learning Loop) ─────────────────
// Logs every AI-generated strategy's simulated performance so
// Ollama Analyst can review its own past generations nightly and
// self-improve. This is the "memory" that makes the system smarter.
export const systemJournal = pgTable(
  "system_journal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id").references(() => strategies.id),
    backtestId: uuid("backtest_id").references(() => backtests.id),
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
    status: text("status").notNull().default("tested"), // tested | promoted | archived | failed
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_action_idx").on(table.action),
    index("audit_entity_idx").on(table.entityType, table.entityId),
  ]
);

// ─── Data Sync Jobs ──────────────────────────────────────────────
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
    strategyId: uuid("strategy_id").references(() => strategies.id),
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
    strategyId: uuid("strategy_id").references(() => strategies.id), // nullable — can be portfolio-wide
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
    strategyId: uuid("strategy_id").references(() => strategies.id), // nullable — might not have been saved
    name: text("name").notNull(),
    dslSnapshot: jsonb("dsl_snapshot").notNull(), // full strategy DSL at time of death
    failureModes: text("failure_modes").array().notNull(), // array of failure mode tags
    failureDetails: jsonb("failure_details"), // detailed analysis per failure mode
    backtestSummary: jsonb("backtest_summary"), // key metrics at time of death
    embedding: jsonb("embedding"), // vector as JSON array (768 dims) — using jsonb since pgvector may not be available
    deathReason: text("death_reason"), // human-readable summary
    deathDate: timestamp("death_date").notNull(),
    source: text("source").default("auto"), // auto | manual | decay
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("graveyard_strategy_idx").on(table.strategyId),
    index("graveyard_death_date_idx").on(table.deathDate),
    index("graveyard_source_idx").on(table.source),
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
    backtestId: uuid("backtest_id").references(() => backtests.id),
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
    strategyId: uuid("strategy_id").references(() => strategies.id),
    status: text("status").notNull().default("active"), // active | stopped
    startedAt: timestamp("started_at").defaultNow().notNull(),
    stoppedAt: timestamp("stopped_at"),
    startingCapital: numeric("starting_capital").notNull().default("100000"),
    currentEquity: numeric("current_equity").notNull().default("100000"),
    config: jsonb("config"),
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
    pnl: numeric("pnl").notNull(),
    contracts: integer("contracts").notNull().default(1),
    entryTime: timestamp("entry_time").notNull(),
    exitTime: timestamp("exit_time").notNull(),
    slippage: numeric("slippage"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paper_trades_session_idx").on(table.sessionId),
  ]
);

// ─── Paper Signal Log ─────────────────────────────────────
export const paperSignalLog = pgTable(
  "paper_signal_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => paperSessions.id, { onDelete: "cascade" })
      .notNull(),
    symbol: text("symbol").notNull(),
    signalType: text("signal_type").notNull(), // entry_long, entry_short, exit, stop_loss, hold
    action: text("action").notNull(), // taken, skipped, rejected
    reason: text("reason"), // why skipped/rejected (risk gate, session filter, cooldown, etc.)
    price: numeric("price"),
    indicatorValues: jsonb("indicator_values"), // snapshot of indicator values at signal time
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("paper_signal_log_session_idx").on(table.sessionId),
  ]
);
