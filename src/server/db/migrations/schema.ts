import { pgTable, index, foreignKey, uuid, text, numeric, integer, timestamp, boolean, unique, check, bigserial, jsonb, smallint, uniqueIndex, date, vector, bigint, serial, varchar, json, type AnyPgColumn } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const paperTrades = pgTable("paper_trades", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	symbol: text().notNull(),
	side: text().notNull(),
	entryPrice: numeric("entry_price").notNull(),
	exitPrice: numeric("exit_price").notNull(),
	pnl: numeric().notNull(),
	contracts: integer().default(1).notNull(),
	entryTime: timestamp("entry_time", { mode: 'string' }).notNull(),
	exitTime: timestamp("exit_time", { mode: 'string' }).notNull(),
	slippage: numeric(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	grossPnl: numeric("gross_pnl"),
	commission: numeric({ precision: 12, scale:  4 }).default('0'),
	mae: numeric(),
	mfe: numeric(),
	holdDurationMs: integer("hold_duration_ms"),
	hourOfDay: integer("hour_of_day"),
	dayOfWeek: integer("day_of_week"),
	sessionType: text("session_type"),
	macroRegime: text("macro_regime"),
	eventActive: boolean("event_active"),
	skipSignal: text("skip_signal"),
	fillProbability: numeric("fill_probability"),
	rollSpreadCost: numeric("roll_spread_cost"),
}, (table) => [
	index("paper_trades_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("paper_trades_exit_time_idx").using("btree", table.exitTime.asc().nullsLast().op("timestamp_ops")),
	index("paper_trades_macro_regime_idx").using("btree", table.macroRegime.asc().nullsLast().op("text_ops")),
	index("paper_trades_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("paper_trades_session_type_idx").using("btree", table.sessionType.asc().nullsLast().op("text_ops")),
	index("paper_trades_skip_signal_idx").using("btree", table.skipSignal.asc().nullsLast().op("text_ops")),
	index("paper_trades_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [paperSessions.id],
			name: "paper_trades_session_id_paper_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const accountStrategyAssignments = pgTable("account_strategy_assignments", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	status: text().default('active').notNull(),
	releasedToFamily: boolean("released_to_family").default(false).notNull(),
	familyMemberLabel: text("family_member_label"),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	assignedBy: text("assigned_by").notNull(),
}, (table) => [
	index("idx_asa_account_id").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_asa_released_family").using("btree", table.releasedToFamily.asc().nullsLast().op("bool_ops")).where(sql`(released_to_family = true)`),
	index("idx_asa_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_asa_strategy_id").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [brokerAccounts.accountId],
			name: "account_strategy_assignments_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "account_strategy_assignments_strategy_id_fkey"
		}).onDelete("cascade"),
	unique("account_strategy_assignments_account_id_strategy_id_key").on(table.accountId, table.strategyId),
	check("account_strategy_assignments_status_check", sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])`),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	action: text().notNull(),
	entityType: text("entity_type"),
	entityId: uuid("entity_id"),
	input: jsonb(),
	result: jsonb(),
	status: text().notNull(),
	durationMs: integer("duration_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	errorMessage: text("error_message"),
	decisionAuthority: text("decision_authority"),
	correlationId: text("correlation_id"),
}, (table) => [
	index("audit_action_idx").using("btree", table.action.asc().nullsLast().op("text_ops")),
	index("audit_decision_authority_idx").using("btree", table.decisionAuthority.asc().nullsLast().op("text_ops")),
	index("audit_entity_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("text_ops")),
	index("idx_audit_log_correlation_id").using("btree", table.correlationId.asc().nullsLast().op("text_ops")),
	index("idx_audit_log_created_at_desc").using("btree", table.createdAt.desc().nullsFirst().op("timestamp_ops")),
]);

export const paperPositions = pgTable("paper_positions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	symbol: text().notNull(),
	side: text().notNull(),
	entryPrice: numeric("entry_price").notNull(),
	currentPrice: numeric("current_price"),
	contracts: integer().default(1).notNull(),
	unrealizedPnl: numeric("unrealized_pnl").default('0'),
	entryTime: timestamp("entry_time", { mode: 'string' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { mode: 'string' }),
	arrivalPrice: numeric("arrival_price"),
	implementationShortfall: numeric("implementation_shortfall"),
	fillRatio: numeric("fill_ratio").default('1.0'),
	trailHwm: numeric("trail_hwm"),
	barsHeld: integer("bars_held").default(0).notNull(),
	fillProbability: numeric("fill_probability"),
	mae: numeric(),
	mfe: numeric(),
	previousUnrealizedPnl: numeric("previous_unrealized_pnl").default('0'),
}, (table) => [
	index("paper_positions_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [paperSessions.id],
			name: "paper_positions_session_id_paper_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const strategyDslFeatures = pgTable("strategy_dsl_features", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	// TODO: failed to parse database type 'bytea'
	featureVectorCompressed: unknown("feature_vector_compressed").notNull(),
	featureDim: integer("feature_dim").notNull(),
	dslFingerprint: text("dsl_fingerprint").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_dsl_features_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_dsl_features_fingerprint").using("btree", table.dslFingerprint.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_dsl_features_strategy_id_fkey"
		}),
	unique("strategy_dsl_features_strategy_id_key").on(table.strategyId),
]);

export const tradingviewMarkers = pgTable("tradingview_markers", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	accountId: uuid("account_id").notNull(),
	barTimestamp: timestamp("bar_timestamp", { withTimezone: true, mode: 'string' }).notNull(),
	signal: smallint().notNull(),
	pineAlertPayload: jsonb("pine_alert_payload").notNull(),
	hmacValidated: boolean("hmac_validated").default(false).notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	correlationId: uuid("correlation_id"),
}, (table) => [
	index("idx_tradingview_markers_account_bar").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.barTimestamp.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_tradingview_markers_correlation").using("btree", table.correlationId.asc().nullsLast().op("uuid_ops")).where(sql`(correlation_id IS NOT NULL)`),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "tradingview_markers_strategy_id_fkey"
		}),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [brokerAccounts.accountId],
			name: "tradingview_markers_account_id_fkey"
		}),
	check("tradingview_markers_signal_check", sql`signal = ANY (ARRAY['-1'::integer, 0, 1])`),
]);

export const strategies = pgTable("strategies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	symbol: text().notNull(),
	timeframe: text().notNull(),
	config: jsonb().notNull(),
	forgeScore: numeric("forge_score"),
	tags: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	lifecycleState: text("lifecycle_state").default('CANDIDATE').notNull(),
	lifecycleChangedAt: timestamp("lifecycle_changed_at", { mode: 'string' }).defaultNow(),
	preferredRegime: text("preferred_regime"),
	rollingSharpe30D: numeric("rolling_sharpe_30d"),
	parentStrategyId: uuid("parent_strategy_id"),
	generation: integer().default(0).notNull(),
	searchBudgetUsed: integer("search_budget_used"),
	source: text(),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	archiveReason: text("archive_reason"),
	symbols: text().array().default(["RAY['MES'::tex"]).notNull(),
}, (table) => [
	uniqueIndex("strategies_active_config_uniq").using("btree", sql`symbol`, sql`timeframe`, sql`((config -> 'entry_indicator'::text))`, sql`((config -> 'entry_params'::text))`).where(sql`((archived_at IS NULL) AND (lifecycle_state <> ALL (ARRAY['GRAVEYARD'::text, 'RETIRED'::text])))`),
	index("strategies_active_idx").using("btree", table.lifecycleState.asc().nullsLast().op("text_ops")).where(sql`(archived_at IS NULL)`),
	index("strategies_lifecycle_state_idx").using("btree", table.lifecycleState.asc().nullsLast().op("text_ops")),
	index("strategies_source_idx").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("strategies_symbols_gin_idx").using("gin", table.symbols.asc().nullsLast().op("array_ops")),
]);

export const paperSessions = pgTable("paper_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	status: text().default('active').notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow().notNull(),
	stoppedAt: timestamp("stopped_at", { mode: 'string' }),
	startingCapital: numeric("starting_capital").default('50000').notNull(),
	currentEquity: numeric("current_equity").default('50000').notNull(),
	config: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	mode: text().default('paper').notNull(),
	firmId: text("firm_id"),
	lastSignalTime: timestamp("last_signal_time", { mode: 'string' }),
	cooldownUntil: timestamp("cooldown_until", { mode: 'string' }),
	dailyPnlBreakdown: jsonb("daily_pnl_breakdown").default({}),
	metricsSnapshot: jsonb("metrics_snapshot").default({}),
	pausedAt: timestamp("paused_at", { mode: 'string' }),
	peakEquity: numeric("peak_equity").default('50000').notNull(),
	totalTrades: integer("total_trades").default(0).notNull(),
	governorState: jsonb("governor_state"),
	realizedPeakEquity: numeric("realized_peak_equity").default('50000').notNull(),
	highWaterBalance: numeric("high_water_balance", { precision: 20, scale:  8 }).default('50000').notNull(),
}, (table) => [
	index("idx_paper_sessions_governor_state").using("btree", sql`((governor_state ->> 'state'::text))`),
	index("paper_sessions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("paper_sessions_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "paper_sessions_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
]);

export const aPlusMarketScans = pgTable("a_plus_market_scans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	scanDate: date("scan_date").notNull(),
	winnerMarket: text("winner_market"),
	observationMode: boolean("observation_mode").default(false).notNull(),
	edgeScores: jsonb("edge_scores").default({}).notNull(),
	leadMarket: text("lead_market"),
	lagWindowMinutes: integer("lag_window_minutes"),
	entanglementStrength: numeric("entanglement_strength"),
	status: text().default('pending').notNull(),
	errorMessage: text("error_message"),
	scanDurationMs: integer("scan_duration_ms"),
	hardware: text(),
	seed: integer(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_a_plus_market_scans_date").using("btree", table.scanDate.desc().nullsFirst().op("date_ops")),
	index("idx_a_plus_market_scans_status").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	unique("a_plus_market_scans_scan_date_key").on(table.scanDate),
]);

export const strategyLockouts = pgTable("strategy_lockouts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	lockedUntil: timestamp("locked_until", { mode: 'string' }).notNull(),
	reason: text().notNull(),
	triggeredByKillId: uuid("triggered_by_kill_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_strategy_lockouts_strategy_active").using("btree", table.strategyId.asc().nullsLast().op("timestamp_ops"), table.lockedUntil.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_lockouts_strategy_id_fkey"
		}),
]);

export const complianceReviews = pgTable("compliance_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	firm: text().notNull(),
	accountType: text("account_type").default('default').notNull(),
	rulesetId: uuid("ruleset_id"),
	complianceResult: text("compliance_result").notNull(),
	riskScore: numeric("risk_score").default('0'),
	violations: jsonb().default([]),
	warnings: jsonb().default([]),
	requiredChanges: jsonb("required_changes").default([]),
	reasoningSummary: text("reasoning_summary"),
	executionGate: text("execution_gate").notNull(),
	reviewedBy: text("reviewed_by").default('openclaw'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("compliance_reviews_firm_idx").using("btree", table.firm.asc().nullsLast().op("text_ops")),
	index("compliance_reviews_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "compliance_reviews_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.rulesetId],
			foreignColumns: [complianceRulesets.id],
			name: "compliance_reviews_ruleset_id_compliance_rulesets_id_fk"
		}).onDelete("set null"),
]);

export const macroFeatures = pgTable("macro_features", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	seriesId: text("series_id").notNull(),
	seriesDate: date("series_date").notNull(),
	publicationTimestamp: timestamp("publication_timestamp", { mode: 'string' }).notNull(),
	value: numeric().notNull(),
	revisionNumber: integer("revision_number").default(1).notNull(),
	source: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_macro_features_publication").using("btree", table.publicationTimestamp.desc().nullsFirst().op("timestamp_ops")),
	index("idx_macro_features_series_time").using("btree", table.seriesId.asc().nullsLast().op("date_ops"), table.seriesDate.desc().nullsFirst().op("text_ops")),
	unique("macro_features_series_id_series_date_revision_number_key").on(table.seriesId, table.seriesDate, table.revisionNumber),
]);

export const complianceRulesets = pgTable("compliance_rulesets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firm: text().notNull(),
	accountType: text("account_type").default('default').notNull(),
	sourceUrl: text("source_url"),
	contentHash: text("content_hash"),
	rawContent: text("raw_content"),
	parsedRules: jsonb("parsed_rules"),
	status: text().default('pending').notNull(),
	driftDetected: boolean("drift_detected").default(false),
	driftDiff: text("drift_diff"),
	verifiedBy: text("verified_by"),
	verifiedAt: timestamp("verified_at", { mode: 'string' }),
	retrievedAt: timestamp("retrieved_at", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("compliance_rulesets_firm_idx").using("btree", table.firm.asc().nullsLast().op("text_ops")),
	index("compliance_rulesets_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const macroRegimeStates = pgTable("macro_regime_states", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	stateDate: date("state_date").notNull(),
	probGrowth: numeric("prob_growth").notNull(),
	probInflation: numeric("prob_inflation").notNull(),
	probCrisis: numeric("prob_crisis").notNull(),
	probEasing: numeric("prob_easing").notNull(),
	dominantState: text("dominant_state").notNull(),
	crisisGateTriggered: boolean("crisis_gate_triggered").default(false).notNull(),
	fomcDayProximity: integer("fomc_day_proximity"),
	macroReleaseDay: boolean("macro_release_day").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_macro_regime_states_crisis").using("btree", table.crisisGateTriggered.asc().nullsLast().op("date_ops"), table.stateDate.desc().nullsFirst().op("bool_ops")).where(sql`(crisis_gate_triggered = true)`),
	index("idx_macro_regime_states_date").using("btree", table.stateDate.desc().nullsFirst().op("date_ops")),
	unique("macro_regime_states_state_date_key").on(table.stateDate),
]);

export const vectors5AStrategyGen = pgTable("vectors_5a_strategy_gen", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	text: text(),
	metadata: jsonb(),
	embedding: vector(),
});

export const backtestProvenance = pgTable("backtest_provenance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	dataHash: text("data_hash").notNull(),
	codeGitSha: text("code_git_sha").notNull(),
	strategyHash: text("strategy_hash").notNull(),
	resultHash: text("result_hash").notNull(),
	pythonVersion: text("python_version"),
	numpyVersion: text("numpy_version"),
	determinismEnvSet: boolean("determinism_env_set"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_backtest_provenance_backtest_id").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("idx_backtest_provenance_lookup").using("btree", table.dataHash.asc().nullsLast().op("text_ops"), table.codeGitSha.asc().nullsLast().op("text_ops"), table.strategyHash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "backtest_provenance_backtest_id_fkey"
		}),
]);

export const contractSpecsAuthoritative = pgTable("contract_specs_authoritative", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	multiplier: numeric().notNull(),
	tickSize: numeric("tick_size").notNull(),
	pointValue: numeric("point_value").notNull(),
	expiryDate: date("expiry_date"),
	pulledAt: timestamp("pulled_at", { mode: 'string' }).defaultNow().notNull(),
	source: text().default('databento_definition').notNull(),
	rawDefinition: jsonb("raw_definition"),
}, (table) => [
	uniqueIndex("idx_contract_specs_symbol_day").using("btree", sql`symbol`, sql`date_trunc('day'::text, pulled_at)`),
	index("idx_contract_specs_symbol_pulled").using("btree", table.symbol.asc().nullsLast().op("text_ops"), table.pulledAt.desc().nullsFirst().op("text_ops")),
]);

export const paperSignalLog = pgTable("paper_signal_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	symbol: text().notNull(),
	signalType: text("signal_type").notNull(),
	action: text().notNull(),
	reason: text(),
	price: numeric(),
	indicatorValues: jsonb("indicator_values"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("paper_signal_log_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
]);

export const dailyStatistics = pgTable("daily_statistics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	tradeDate: date("trade_date").notNull(),
	settlementPrice: numeric("settlement_price"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	openInterest: bigint("open_interest", { mode: "number" }),
	sessionHigh: numeric("session_high"),
	sessionLow: numeric("session_low"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	volume: bigint({ mode: "number" }),
	pulledAt: timestamp("pulled_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_daily_stats_symbol_date").using("btree", table.symbol.asc().nullsLast().op("date_ops"), table.tradeDate.desc().nullsFirst().op("date_ops")),
	unique("daily_statistics_symbol_trade_date_key").on(table.symbol, table.tradeDate),
]);

export const openingAuctionImbalance = pgTable("opening_auction_imbalance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	auctionDate: date("auction_date").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	imbalanceQuantity: bigint("imbalance_quantity", { mode: "number" }).notNull(),
	imbalanceSide: text("imbalance_side").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	pairedQuantity: bigint("paired_quantity", { mode: "number" }),
	indicativePrice: numeric("indicative_price"),
	auctionTime: timestamp("auction_time", { mode: 'string' }).notNull(),
	pulledAt: timestamp("pulled_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_auction_imbalance_symbol_date").using("btree", table.symbol.asc().nullsLast().op("date_ops"), table.auctionDate.desc().nullsFirst().op("text_ops")),
	unique("opening_auction_imbalance_symbol_auction_date_key").on(table.symbol, table.auctionDate),
]);

export const strategyPendingBuckets = pgTable("strategy_pending_buckets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fingerprintHash: text("fingerprint_hash").notNull(),
	market: text().notNull(),
	entryArchetype: text("entry_archetype").notNull(),
	exitType: text("exit_type").notNull(),
	sourceCount: integer("source_count").default(0).notNull(),
	distinctProviders: integer("distinct_providers").default(0).notNull(),
	status: text().default('pending').notNull(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	graduatedAt: timestamp("graduated_at", { withTimezone: true, mode: 'string' }),
	graduatedStrategyId: uuid("graduated_strategy_id"),
	conceptName: text("concept_name"),
	layerCoverageJson: jsonb("layer_coverage_json"),
	wideFingerprintHash: text("wide_fingerprint_hash"),
}, (table) => [
	index("idx_buckets_market_concept").using("btree", table.market.asc().nullsLast().op("text_ops"), table.conceptName.asc().nullsLast().op("text_ops")).where(sql`(concept_name IS NOT NULL)`),
	index("idx_buckets_status_lastseen").using("btree", table.status.asc().nullsLast().op("text_ops"), table.lastSeenAt.desc().nullsFirst().op("text_ops")),
	index("idx_pending_buckets_wide_fingerprint").using("btree", table.wideFingerprintHash.asc().nullsLast().op("text_ops")).where(sql`(wide_fingerprint_hash IS NOT NULL)`),
	foreignKey({
			columns: [table.graduatedStrategyId],
			foreignColumns: [strategies.id],
			name: "strategy_pending_buckets_graduated_strategy_id_fkey"
		}),
	unique("strategy_pending_buckets_fingerprint_hash_key").on(table.fingerprintHash),
	check("strategy_pending_buckets_market_check", sql`market = ANY (ARRAY['MES'::text, 'MNQ'::text, 'MCL'::text])`),
	check("strategy_pending_buckets_source_count_check", sql`source_count >= 0`),
	check("strategy_pending_buckets_distinct_providers_check", sql`distinct_providers >= 0`),
]);

export const memory5AStrategyGen = pgTable("memory_5a_strategy_gen", {
	id: serial().primaryKey().notNull(),
	sessionId: varchar("session_id", { length: 255 }).notNull(),
	message: jsonb().notNull(),
});

export const strategyPendingMentions = pgTable("strategy_pending_mentions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	bucketId: uuid("bucket_id").notNull(),
	sourceProvider: text("source_provider").notNull(),
	sourceUrl: text("source_url").notNull(),
	extractedIdea: jsonb("extracted_idea").notNull(),
	isCrossValidationResult: boolean("is_cross_validation_result").default(false).notNull(),
	crossValidatorConfidence: numeric("cross_validator_confidence", { precision: 3, scale:  2 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	scoutLayer: text("scout_layer").default('web').notNull(),
}, (table) => [
	index("idx_mentions_bucket").using("btree", table.bucketId.asc().nullsLast().op("uuid_ops")),
	index("idx_mentions_layer").using("btree", table.bucketId.asc().nullsLast().op("uuid_ops"), table.scoutLayer.asc().nullsLast().op("uuid_ops")),
	index("idx_mentions_recent").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.bucketId],
			foreignColumns: [strategyPendingBuckets.id],
			name: "strategy_pending_mentions_bucket_id_fkey"
		}).onDelete("cascade"),
	unique("strategy_pending_mentions_bucket_url_unique").on(table.bucketId, table.sourceUrl),
]);

export const dataIntegrityFindings = pgTable("data_integrity_findings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	runAt: timestamp("run_at", { mode: 'string' }).defaultNow().notNull(),
	checkType: text("check_type").notNull(),
	checkName: text("check_name").notNull(),
	severity: text().notNull(),
	affectedEntityType: text("affected_entity_type"),
	affectedEntityId: uuid("affected_entity_id"),
	details: jsonb(),
	resolved: boolean().default(false).notNull(),
}, (table) => [
	index("idx_data_integrity_entity").using("btree", table.affectedEntityType.asc().nullsLast().op("text_ops"), table.affectedEntityId.asc().nullsLast().op("uuid_ops")).where(sql`(affected_entity_id IS NOT NULL)`),
	index("idx_data_integrity_run_at").using("btree", table.runAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_data_integrity_unresolved").using("btree", table.checkType.asc().nullsLast().op("text_ops"), table.severity.asc().nullsLast().op("text_ops")).where(sql`(resolved = false)`),
]);

export const n8NChatHistories = pgTable("n8n_chat_histories", {
	id: serial().primaryKey().notNull(),
	sessionId: varchar("session_id", { length: 255 }).notNull(),
	message: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_n8n_chat_histories_session").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
]);

export const syntheticRegimeBank = pgTable("synthetic_regime_bank", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	timeframe: text().notNull(),
	regimeLabel: text("regime_label").notNull(),
	// TODO: failed to parse database type 'bytea'
	conditioningVectorCompressed: unknown("conditioning_vector_compressed").notNull(),
	conditioningDim: integer("conditioning_dim").notNull(),
	s3Path: text("s3_path").notNull(),
	numBars: integer("num_bars").notNull(),
	stylizedFactPassed: boolean("stylized_fact_passed").notNull(),
	generatorModelVersion: text("generator_model_version").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_synth_bank_passed").using("btree", table.stylizedFactPassed.asc().nullsLast().op("bool_ops")).where(sql`(stylized_fact_passed = true)`),
	index("idx_synth_bank_regime").using("btree", table.regimeLabel.asc().nullsLast().op("text_ops")),
	index("idx_synth_bank_symbol_tf").using("btree", table.symbol.asc().nullsLast().op("text_ops"), table.timeframe.asc().nullsLast().op("text_ops")),
]);

export const firmAdversarialPriors = pgTable("firm_adversarial_priors", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firmId: text("firm_id").notNull(),
	eventType: text("event_type").notNull(),
	baseRate: numeric("base_rate", { precision: 5, scale:  4 }).notNull(),
	evidenceWeight: integer("evidence_weight").default(0).notNull(),
	evidenceSources: jsonb("evidence_sources"),
	lastObservedAt: timestamp("last_observed_at", { mode: 'string' }),
	fitMethod: text("fit_method").default('manual_seed').notNull(),
	lastFittedAt: timestamp("last_fitted_at", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_firm_priors_event").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("idx_firm_priors_firm").using("btree", table.firmId.asc().nullsLast().op("text_ops")),
	index("idx_firm_priors_recent").using("btree", table.lastFittedAt.desc().nullsFirst().op("timestamp_ops")),
	unique("idx_firm_priors_unique").on(table.firmId, table.eventType),
]);

export const langchainPgCollection = pgTable("langchain_pg_collection", {
	uuid: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	cmetadata: json(),
}, (table) => [
	unique("langchain_pg_collection_name_key").on(table.name),
]);

export const langchainPgEmbedding = pgTable("langchain_pg_embedding", {
	uuid: uuid().defaultRandom().primaryKey().notNull(),
	collectionId: uuid("collection_id"),
	embedding: vector(),
	document: text(),
	cmetadata: json(),
	customId: varchar("custom_id", { length: 255 }),
}, (table) => [
	index("idx_langchain_pg_embedding_collection").using("btree", table.collectionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.collectionId],
			foreignColumns: [langchainPgCollection.uuid],
			name: "langchain_pg_embedding_collection_id_fkey"
		}).onDelete("cascade"),
]);

export const quboTimingRuns = pgTable("qubo_timing_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	sessionType: text("session_type"),
	windowSize: integer("window_size"),
	schedule: jsonb(),
	expectedReturn: numeric("expected_return"),
	costSavings: numeric("cost_savings"),
	backtestImprovement: numeric("backtest_improvement"),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
	seed: integer(),
}, (table) => [
	index("qubo_timing_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("qubo_timing_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "qubo_timing_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "qubo_timing_runs_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const backtests = pgTable("backtests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	symbol: text().notNull(),
	timeframe: text().notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }).notNull(),
	totalReturn: numeric("total_return"),
	sharpeRatio: numeric("sharpe_ratio"),
	maxDrawdown: numeric("max_drawdown"),
	winRate: numeric("win_rate"),
	profitFactor: numeric("profit_factor"),
	totalTrades: integer("total_trades"),
	avgTradePnl: numeric("avg_trade_pnl"),
	equityCurve: jsonb("equity_curve"),
	monthlyReturns: jsonb("monthly_returns"),
	executionTimeMs: integer("execution_time_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
	avgDailyPnl: numeric("avg_daily_pnl"),
	forgeScore: numeric("forge_score"),
	tier: text(),
	dailyPnls: jsonb("daily_pnls"),
	config: jsonb(),
	walkForwardResults: jsonb("walk_forward_results"),
	propCompliance: jsonb("prop_compliance"),
	errorMessage: text("error_message"),
	decayAnalysis: jsonb("decay_analysis"),
	runReceipt: jsonb("run_receipt"),
	sanityChecks: jsonb("sanity_checks"),
	crossValidation: jsonb("cross_validation"),
	gateResult: jsonb("gate_result"),
	gateRejections: jsonb("gate_rejections"),
	resultExtras: jsonb("result_extras"),
	mrpSharpe: numeric("mrp_sharpe"),
	mrpRegimeBreakdown: jsonb("mrp_regime_breakdown"),
	informationRatio: numeric("information_ratio"),
}, (table) => [
	index("backtests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("backtests_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	index("backtests_strategy_status_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("backtests_strategy_tier_idx").using("btree", table.strategyId.asc().nullsLast().op("text_ops"), table.tier.asc().nullsLast().op("uuid_ops")),
	index("backtests_tier_idx").using("btree", table.tier.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "backtests_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const strategyFirmEligibility = pgTable("strategy_firm_eligibility", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	firmId: text("firm_id").notNull(),
	eligible: boolean().notNull(),
	eligibilityReason: text("eligibility_reason"),
	complianceCheckResult: jsonb("compliance_check_result"),
	checkedAt: timestamp("checked_at", { mode: 'string' }).defaultNow().notNull(),
	survivalProbability: numeric("survival_probability", { precision: 5, scale:  4 }),
	survivalCurve: jsonb("survival_curve"),
	survivalEvidenceWeight: integer("survival_evidence_weight"),
	survivalLastFittedAt: timestamp("survival_last_fitted_at", { mode: 'string' }),
}, (table) => [
	index("idx_sfe_checked_at").using("btree", table.strategyId.asc().nullsLast().op("timestamp_ops"), table.checkedAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_sfe_strategy_eligible").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.eligible.asc().nullsLast().op("bool_ops")),
	index("idx_sfe_strategy_firm").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.firmId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_firm_eligibility_strategy_id_fkey"
		}),
]);

export const scoutDrainSamples = pgTable("scout_drain_samples", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sampledAt: timestamp("sampled_at", { mode: 'string' }).defaultNow().notNull(),
	scoutedCount: integer("scouted_count").notNull(),
	pipelineMode: text("pipeline_mode"),
}, (table) => [
	index("idx_scout_drain_samples_sampled_at").using("btree", table.sampledAt.desc().nullsFirst().op("timestamp_ops")),
]);

export const skipDecisions = pgTable("skip_decisions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	decisionDate: timestamp("decision_date", { mode: 'string' }).notNull(),
	decision: text().notNull(),
	score: numeric().notNull(),
	signals: jsonb().notNull(),
	triggeredSignals: text("triggered_signals").array(),
	reason: text(),
	override: boolean().default(false),
	overrideReason: text("override_reason"),
	actualOutcome: text("actual_outcome"),
	actualPnl: numeric("actual_pnl"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	regretScore: numeric("regret_score"),
	opportunityCost: numeric("opportunity_cost"),
}, (table) => [
	index("skip_decisions_date_idx").using("btree", table.decisionDate.asc().nullsLast().op("timestamp_ops")),
	index("skip_decisions_decision_idx").using("btree", table.decision.asc().nullsLast().op("text_ops")),
	index("skip_decisions_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "skip_decisions_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
]);

export const strategyGraveyard = pgTable("strategy_graveyard", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	name: text().notNull(),
	dslSnapshot: jsonb("dsl_snapshot").notNull(),
	failureModes: text("failure_modes").array().notNull(),
	failureDetails: jsonb("failure_details"),
	backtestSummary: jsonb("backtest_summary"),
	embedding: jsonb(),
	deathReason: text("death_reason"),
	deathDate: timestamp("death_date", { mode: 'string' }).notNull(),
	source: text().default('auto'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	failureCategory: text("failure_category"),
	failureSeverity: numeric("failure_severity"),
	searchableMetrics: jsonb("searchable_metrics"),
}, (table) => [
	index("graveyard_death_date_idx").using("btree", table.deathDate.asc().nullsLast().op("timestamp_ops")),
	index("graveyard_failure_category_idx").using("btree", table.failureCategory.asc().nullsLast().op("text_ops")),
	index("graveyard_source_idx").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("graveyard_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_graveyard_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
]);

export const pilotSessions = pgTable("pilot_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	sessionNumber: integer("session_number").notNull(),
	paperSessionId: uuid("paper_session_id"),
	rollingSharpe: numeric("rolling_sharpe"),
	compliancePassed: boolean("compliance_passed"),
	contracts: integer().default(1).notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	outcome: text(),
	killReason: text("kill_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pilot_sessions_outcome").using("btree", table.strategyId.asc().nullsLast().op("text_ops"), table.outcome.asc().nullsLast().op("text_ops")),
	index("idx_pilot_sessions_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "pilot_sessions_strategy_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paperSessionId],
			foreignColumns: [paperSessions.id],
			name: "pilot_sessions_paper_session_id_fkey"
		}),
]);

export const llmInjectionAttempts = pgTable("llm_injection_attempts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	detectedAt: timestamp("detected_at", { mode: 'string' }).defaultNow().notNull(),
	source: text().notNull(),
	sourceUrl: text("source_url"),
	contentSnippet: text("content_snippet"),
	injectionType: text("injection_type"),
	severity: text().notNull(),
	blocked: boolean().default(true),
}, (table) => [
	index("idx_llm_injection_attempts_detected_at").using("btree", table.detectedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_llm_injection_attempts_severity").using("btree", table.severity.asc().nullsLast().op("text_ops"), table.detectedAt.desc().nullsFirst().op("text_ops")).where(sql`(blocked = false)`),
	index("idx_llm_injection_attempts_source").using("btree", table.source.asc().nullsLast().op("text_ops"), table.detectedAt.desc().nullsFirst().op("timestamp_ops")),
	check("llm_injection_attempts_severity_check", sql`severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])`),
]);

export const biasState = pgTable("bias_state", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	sessionDate: date("session_date").notNull(),
	regimeLabel: text("regime_label").notNull(),
	playbook: text().notNull(),
	activeStrategyId: uuid("active_strategy_id"),
	correlationId: text("correlation_id"),
	evidence: jsonb().default({}).notNull(),
	computedAt: timestamp("computed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	symbol: text().default('MES').notNull(),
}, (table) => [
	index("bias_state_active_strategy_idx").using("btree", table.activeStrategyId.asc().nullsLast().op("uuid_ops")),
	index("bias_state_regime_label_idx").using("btree", table.regimeLabel.asc().nullsLast().op("text_ops")),
	index("bias_state_session_date_symbol_idx").using("btree", table.sessionDate.desc().nullsFirst().op("text_ops"), table.symbol.asc().nullsLast().op("date_ops")),
	index("bias_state_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.activeStrategyId],
			foreignColumns: [strategies.id],
			name: "bias_state_active_strategy_id_fkey"
		}).onDelete("set null"),
]);

export const quantumMcBenchmarks = pgTable("quantum_mc_benchmarks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	quantumRunId: uuid("quantum_run_id").notNull(),
	classicalRunId: uuid("classical_run_id"),
	metric: text().notNull(),
	quantumValue: numeric("quantum_value"),
	classicalValue: numeric("classical_value"),
	absoluteDelta: numeric("absolute_delta"),
	relativeDelta: numeric("relative_delta"),
	toleranceThreshold: numeric("tolerance_threshold"),
	passes: boolean(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	backendType: text("backend_type"),
	workloadKey: text("workload_key").default('portfolio_tail_risk'),
	baselineRuntimeMs: integer("baseline_runtime_ms"),
	quantumRuntimeMs: integer("quantum_runtime_ms"),
	baselineCost: numeric("baseline_cost"),
	quantumCost: numeric("quantum_cost"),
	decisionDelta: numeric("decision_delta"),
	paperImpactDelta: numeric("paper_impact_delta"),
	maturityLevel: text("maturity_level").default('shadow'),
	benchmarkPassStatus: text("benchmark_pass_status").default('failed'),
}, (table) => [
	index("qmc_bench_metric_idx").using("btree", table.metric.asc().nullsLast().op("text_ops")),
	index("qmc_bench_quantum_run_idx").using("btree", table.quantumRunId.asc().nullsLast().op("uuid_ops")),
	index("qmc_bench_workload_idx").using("btree", table.workloadKey.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.quantumRunId],
			foreignColumns: [quantumMcRuns.id],
			name: "quantum_mc_benchmarks_quantum_run_id_quantum_mc_runs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.classicalRunId],
			foreignColumns: [monteCarloRuns.id],
			name: "quantum_mc_benchmarks_classical_run_id_monte_carlo_runs_id_fk"
		}).onDelete("set null"),
]);

export const promptVersions = pgTable("prompt_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	promptType: text("prompt_type").notNull(),
	version: integer().notNull(),
	content: text().notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	metrics: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("prompt_versions_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("prompt_versions_type_idx").using("btree", table.promptType.asc().nullsLast().op("text_ops")),
]);

export const promptAbTests = pgTable("prompt_ab_tests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	promptType: text("prompt_type").notNull(),
	versionAId: uuid("version_a_id"),
	versionBId: uuid("version_b_id"),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	metricsA: jsonb("metrics_a"),
	metricsB: jsonb("metrics_b"),
	winner: text(),
	status: text().default('running').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("prompt_ab_tests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("prompt_ab_tests_type_idx").using("btree", table.promptType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.versionAId],
			foreignColumns: [promptVersions.id],
			name: "prompt_ab_tests_version_a_id_fkey"
		}),
	foreignKey({
			columns: [table.versionBId],
			foreignColumns: [promptVersions.id],
			name: "prompt_ab_tests_version_b_id_fkey"
		}),
]);

export const strategyNames = pgTable("strategy_names", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	codename: text().notNull(),
	fullName: text("full_name").notNull(),
	strategyId: uuid("strategy_id"),
	claimed: boolean().default(false),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	retired: boolean().default(false),
	retiredAt: timestamp("retired_at", { withTimezone: true, mode: 'string' }),
	version: text().default('v1.0'),
	originClass: text("origin_class"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("strategy_names_claimed_idx").using("btree", table.claimed.asc().nullsLast().op("bool_ops")),
	index("strategy_names_strategy_id_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_names_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
	unique("strategy_names_codename_key").on(table.codename),
	unique("strategy_names_full_name_key").on(table.fullName),
]);

export const systemParameters = pgTable("system_parameters", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paramName: text("param_name").notNull(),
	currentValue: numeric("current_value").notNull(),
	minValue: numeric("min_value"),
	maxValue: numeric("max_value"),
	description: text(),
	domain: text().notNull(),
	autoTunable: boolean("auto_tunable").default(false),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("system_params_domain_idx").using("btree", table.domain.asc().nullsLast().op("text_ops")),
	uniqueIndex("system_params_name_idx").using("btree", table.paramName.asc().nullsLast().op("text_ops")),
	unique("system_parameters_param_name_key").on(table.paramName),
]);

export const systemParameterHistory = pgTable("system_parameter_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paramId: uuid("param_id").notNull(),
	previousValue: numeric("previous_value").notNull(),
	newValue: numeric("new_value").notNull(),
	reason: text().notNull(),
	source: text().default('meta-optimizer').notNull(),
	gateMetrics: jsonb("gate_metrics"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("param_history_param_idx").using("btree", table.paramId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paramId],
			foreignColumns: [systemParameters.id],
			name: "system_parameter_history_param_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paramId],
			foreignColumns: [systemParameters.id],
			name: "system_parameter_history_param_id_system_parameters_id_fk"
		}).onDelete("cascade"),
]);

export const backtestMatrix = pgTable("backtest_matrix", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	status: text().default('running').notNull(),
	totalCombos: integer("total_combos").notNull(),
	completedCombos: integer("completed_combos").default(0).notNull(),
	results: jsonb(),
	bestCombo: jsonb("best_combo"),
	tierStatus: jsonb("tier_status"),
	executionTimeMs: integer("execution_time_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("matrix_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("matrix_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "backtest_matrix_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const systemJournal = pgTable("system_journal", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	backtestId: uuid("backtest_id"),
	source: text().notNull(),
	generationPrompt: text("generation_prompt"),
	strategyCode: text("strategy_code"),
	strategyParams: jsonb("strategy_params"),
	simulatedEquity: jsonb("simulated_equity"),
	dailyPnls: jsonb("daily_pnls"),
	forgeScore: numeric("forge_score"),
	propComplianceResults: jsonb("prop_compliance_results"),
	performanceGateResult: jsonb("performance_gate_result"),
	tier: text(),
	analystNotes: text("analyst_notes"),
	parentJournalId: uuid("parent_journal_id"),
	status: text().default('tested').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	generatedByModel: text("generated_by_model"),
	generatedByProvider: text("generated_by_provider"),
}, (table) => [
	index("journal_source_idx").using("btree", table.source.asc().nullsLast().op("text_ops")),
	index("journal_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("journal_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	index("journal_tier_idx").using("btree", table.tier.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "system_journal_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "system_journal_backtest_id_backtests_id_fk"
		}).onDelete("set null"),
]);

export const rlTrainingRuns = pgTable("rl_training_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	method: text().notNull(),
	nQubits: integer("n_qubits"),
	nLayers: integer("n_layers"),
	episodes: integer(),
	maxSteps: integer("max_steps"),
	totalReturn: numeric("total_return"),
	sharpeRatio: numeric("sharpe_ratio"),
	winRate: numeric("win_rate"),
	totalTrades: integer("total_trades"),
	policyWeights: jsonb("policy_weights"),
	comparisonResult: jsonb("comparison_result"),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	executionTimeMs: integer("execution_time_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
}, (table) => [
	index("rl_runs_method_idx").using("btree", table.method.asc().nullsLast().op("text_ops")),
	index("rl_runs_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "rl_training_runs_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const mutationOutcomes = pgTable("mutation_outcomes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id"),
	parentArchetype: text("parent_archetype"),
	mutationType: text("mutation_type"),
	paramName: text("param_name"),
	direction: text(),
	magnitude: numeric(),
	parentMetrics: jsonb("parent_metrics"),
	childMetrics: jsonb("child_metrics"),
	improvement: numeric(),
	regime: text(),
	success: boolean(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mutation_outcomes_regime_idx").using("btree", table.regime.asc().nullsLast().op("text_ops")),
	index("mutation_outcomes_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	index("mutation_outcomes_success_idx").using("btree", table.success.asc().nullsLast().op("bool_ops")),
	index("mutation_outcomes_type_idx").using("btree", table.mutationType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "mutation_outcomes_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
]);

export const paperSessionFeedback = pgTable("paper_session_feedback", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	strategyId: uuid("strategy_id"),
	totalTrades: integer("total_trades").default(0).notNull(),
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
	computedAt: timestamp("computed_at", { mode: 'string' }).defaultNow().notNull(),
	sessionStart: timestamp("session_start", { mode: 'string' }),
	sessionEnd: timestamp("session_end", { mode: 'string' }),
	hasMaeData: boolean("has_mae_data").default(false).notNull(),
	notes: text(),
}, (table) => [
	index("paper_session_feedback_computed_idx").using("btree", table.computedAt.desc().nullsFirst().op("timestamp_ops")),
	index("paper_session_feedback_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("paper_session_feedback_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [paperSessions.id],
			name: "paper_session_feedback_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "paper_session_feedback_strategy_id_strategies_id_fk"
		}).onDelete("set null"),
]);

export const shadowSignals = pgTable("shadow_signals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	signalTime: timestamp("signal_time", { mode: 'string' }).notNull(),
	direction: text().notNull(),
	expectedEntry: numeric("expected_entry").notNull(),
	expectedExit: numeric("expected_exit"),
	actualMarketPrice: numeric("actual_market_price"),
	wouldHaveFilled: boolean("would_have_filled"),
	theoreticalPnl: numeric("theoretical_pnl"),
	modelSlippage: numeric("model_slippage"),
	actualSlippage: numeric("actual_slippage"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("shadow_signals_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("shadow_signals_time_idx").using("btree", table.signalTime.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [paperSessions.id],
			name: "shadow_signals_session_id_paper_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const harshRegimePhase = pgTable("harsh_regime_phase", {
	id: integer().default(1).primaryKey().notNull(),
	phase: text().default('advisory').notNull(),
	activatedAt: timestamp("activated_at", { withTimezone: true, mode: 'string' }),
	firstStrategyId: uuid("first_strategy_id"),
	activatedBy: text("activated_by").default('system').notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_harsh_regime_phase_id").using("btree", table.id.asc().nullsLast().op("int4_ops")),
]);

export const paperSignalLogs = pgTable("paper_signal_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	symbol: text().notNull(),
	direction: text().notNull(),
	signalType: text("signal_type"),
	confidence: numeric(),
	price: numeric(),
	indicatorSnapshot: jsonb("indicator_snapshot"),
	acted: boolean().default(false),
	reason: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("paper_signal_logs_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("paper_signal_logs_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [paperSessions.id],
			name: "paper_signal_logs_session_id_paper_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const agentHealthReports = pgTable("agent_health_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	domain: text().notNull(),
	status: text().default('healthy').notNull(),
	lastCheckedAt: timestamp("last_checked_at", { mode: 'string' }).defaultNow().notNull(),
	latencyMs: integer("latency_ms"),
	errorCount: integer("error_count").default(0),
	details: jsonb(),
	recommendations: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("agent_health_domain_idx").using("btree", table.domain.asc().nullsLast().op("text_ops")),
	index("agent_health_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const subsystemMetrics = pgTable("subsystem_metrics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	subsystem: text().notNull(),
	metricName: text("metric_name").notNull(),
	metricValue: numeric("metric_value").notNull(),
	tags: jsonb(),
	measuredAt: timestamp("measured_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("subsystem_metrics_measured_at_idx").using("btree", table.measuredAt.asc().nullsLast().op("timestamp_ops")),
	index("subsystem_metrics_name_idx").using("btree", table.metricName.asc().nullsLast().op("text_ops")),
	index("subsystem_metrics_subsystem_idx").using("btree", table.subsystem.asc().nullsLast().op("text_ops")),
	index("subsystem_metrics_subsystem_name_idx").using("btree", table.subsystem.asc().nullsLast().op("text_ops"), table.metricName.asc().nullsLast().op("text_ops")),
]);

export const alerts = pgTable("alerts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: text().notNull(),
	severity: text().default('info').notNull(),
	title: text().notNull(),
	message: text().notNull(),
	metadata: jsonb(),
	acknowledged: boolean().default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("alerts_severity_idx").using("btree", table.severity.asc().nullsLast().op("text_ops")),
	index("alerts_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops")),
]);

export const deadLetterQueue = pgTable("dead_letter_queue", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	operationType: text("operation_type").notNull(),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	errorMessage: text("error_message").notNull(),
	retryCount: integer("retry_count").default(0).notNull(),
	maxRetries: integer("max_retries").default(3).notNull(),
	firstFailedAt: timestamp("first_failed_at", { mode: 'string' }).notNull(),
	lastFailedAt: timestamp("last_failed_at", { mode: 'string' }).notNull(),
	resolved: boolean().default(false).notNull(),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	escalated: boolean().default(false).notNull(),
}, (table) => [
	index("dlq_escalated_idx").using("btree", table.escalated.asc().nullsLast().op("bool_ops")),
	index("dlq_operation_type_idx").using("btree", table.operationType.asc().nullsLast().op("text_ops")),
	index("dlq_resolved_idx").using("btree", table.resolved.asc().nullsLast().op("bool_ops")),
]);

export const deeparForecasts = pgTable("deepar_forecasts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	forecastDate: date("forecast_date").notNull(),
	generatedAt: timestamp("generated_at", { mode: 'string' }).defaultNow(),
	symbol: text().notNull(),
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
	governanceLabels: jsonb("governance_labels").default({"experimental":true,"authoritative":false,"decision_role":"challenger_only"}).notNull(),
	regretScore: numeric("regret_score"),
	magnitudeError: numeric("magnitude_error"),
}, (table) => [
	index("deepar_forecasts_date_idx").using("btree", table.forecastDate.asc().nullsLast().op("date_ops")),
	index("deepar_forecasts_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
]);

export const deeparTrainingRuns = pgTable("deepar_training_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	trainedAt: timestamp("trained_at", { mode: 'string' }).defaultNow(),
	symbols: jsonb(),
	dataRangeStart: date("data_range_start"),
	dataRangeEnd: date("data_range_end"),
	epochs: integer(),
	trainingLoss: numeric("training_loss"),
	validationLoss: numeric("validation_loss"),
	modelPath: text("model_path"),
	durationMs: integer("duration_ms"),
	status: text().default('pending').notNull(),
	governanceLabels: jsonb("governance_labels").default({"experimental":true,"authoritative":false,"decision_role":"challenger_only"}).notNull(),
}, (table) => [
	index("deepar_training_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const deeparModelRegistry = pgTable("deepar_model_registry", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	versionHash: text("version_hash").notNull(),
	trainingRunId: uuid("training_run_id"),
	modelPath: text("model_path").notNull(),
	validationLoss: numeric("validation_loss"),
	avgHitRate30D: numeric("avg_hit_rate_30d"),
	status: text().default('active').notNull(),
	promotedAt: timestamp("promoted_at", { mode: 'string' }),
	demotedAt: timestamp("demoted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deepar_registry_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const macroSnapshots = pgTable("macro_snapshots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	snapshotDate: timestamp("snapshot_date", { mode: 'string' }).notNull(),
	fedFundsRate: numeric("fed_funds_rate"),
	treasury10Y: numeric("treasury_10y"),
	treasury2Y: numeric("treasury_2y"),
	treasury3M: numeric("treasury_3m"),
	vix: numeric(),
	yieldSpread10Y2Y: numeric("yield_spread_10y2y"),
	unemployment: numeric(),
	cpiYoy: numeric("cpi_yoy"),
	pceYoy: numeric("pce_yoy"),
	wtiCrude: numeric("wti_crude"),
	naturalGas: numeric("natural_gas"),
	macroRegime: text("macro_regime"),
	regimeConfidence: numeric("regime_confidence"),
	rawData: jsonb("raw_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("macro_snapshots_date_idx").using("btree", table.snapshotDate.asc().nullsLast().op("timestamp_ops")),
	index("macro_snapshots_regime_idx").using("btree", table.macroRegime.asc().nullsLast().op("text_ops")),
	unique("macro_snapshots_snapshot_date_unique").on(table.snapshotDate),
]);

export const dayArchetypes = pgTable("day_archetypes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	tradingDate: timestamp("trading_date", { mode: 'string' }).notNull(),
	archetype: text().notNull(),
	confidence: numeric(),
	metrics: jsonb(),
	features: jsonb(),
	predictedArchetype: text("predicted_archetype"),
	predictionCorrect: boolean("prediction_correct"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("day_archetypes_archetype_idx").using("btree", table.archetype.asc().nullsLast().op("text_ops")),
	uniqueIndex("day_archetypes_symbol_date_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops"), table.tradingDate.asc().nullsLast().op("text_ops")),
]);

export const complianceDriftLog = pgTable("compliance_drift_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firm: text().notNull(),
	accountType: text("account_type").default('default').notNull(),
	rulesetId: uuid("ruleset_id"),
	previousHash: text("previous_hash"),
	newHash: text("new_hash"),
	driftSummary: text("drift_summary"),
	detectedAt: timestamp("detected_at", { mode: 'string' }).defaultNow().notNull(),
	resolved: boolean().default(false),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	resolvedBy: text("resolved_by"),
	notes: text(),
}, (table) => [
	index("compliance_drift_log_firm_idx").using("btree", table.firm.asc().nullsLast().op("text_ops")),
	index("compliance_drift_log_resolved_idx").using("btree", table.resolved.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.rulesetId],
			foreignColumns: [complianceRulesets.id],
			name: "compliance_drift_log_ruleset_id_compliance_rulesets_id_fk"
		}).onDelete("set null"),
]);

export const schedulerJobRuns = pgTable("scheduler_job_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobName: text("job_name").notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	status: text().default('pending').notNull(),
	durationMs: integer("duration_ms"),
	errorMessage: text("error_message"),
	retryCount: integer("retry_count").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("scheduler_job_runs_name_idx").using("btree", table.jobName.asc().nullsLast().op("text_ops")),
	index("scheduler_job_runs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const circuitBreakerEvents = pgTable("circuit_breaker_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	endpoint: text().notNull(),
	fromState: text("from_state").notNull(),
	toState: text("to_state").notNull(),
	consecutiveFailures: integer("consecutive_failures"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("cb_events_endpoint_idx").using("btree", table.endpoint.asc().nullsLast().op("text_ops")),
]);

export const n8NExecutionLog = pgTable("n8n_execution_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	workflowId: text("workflow_id").notNull(),
	workflowName: text("workflow_name").notNull(),
	executionId: text("execution_id"),
	status: text().notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	finishedAt: timestamp("finished_at", { mode: 'string' }),
	durationMs: integer("duration_ms"),
	errorMessage: text("error_message"),
	triggerType: text("trigger_type"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_n8n_exec_started_at").using("btree", table.startedAt.desc().nullsLast().op("timestamp_ops")).where(sql`(started_at IS NOT NULL)`),
	index("n8n_exec_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("n8n_exec_workflow_idx").using("btree", table.workflowId.asc().nullsLast().op("text_ops")),
	uniqueIndex("uq_n8n_exec_execution_id").using("btree", table.executionId.asc().nullsLast().op("text_ops")),
]);

export const dataQualityChecks = pgTable("data_quality_checks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	timeframe: text().notNull(),
	checkType: text("check_type").notNull(),
	passed: boolean().notNull(),
	details: jsonb(),
	checkedAt: timestamp("checked_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("data_quality_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
]);

export const pythonExecutionLog = pgTable("python_execution_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	module: text().notNull(),
	componentName: text("component_name"),
	correlationId: text("correlation_id"),
	status: text().default('success').notNull(),
	durationMs: integer("duration_ms"),
	exitCode: integer("exit_code"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("python_exec_module_idx").using("btree", table.module.asc().nullsLast().op("text_ops")),
	index("python_exec_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
	key: text().primaryKey().notNull(),
	responseStatus: integer("response_status").notNull(),
	responseBody: jsonb("response_body"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const dataSyncJobs = pgTable("data_sync_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	source: text().default('databento').notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }).notNull(),
	status: text().default('pending').notNull(),
	costUsd: numeric("cost_usd"),
	rowsDownloaded: integer("rows_downloaded"),
	rollsDetected: integer("rolls_detected"),
	errorMessage: text("error_message"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
}, (table) => [
	index("sync_jobs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("sync_jobs_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
]);

export const aiInferenceLog = pgTable("ai_inference_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	modelName: text("model_name").notNull(),
	provider: text().notNull(),
	role: text(),
	promptTokens: integer("prompt_tokens"),
	completionTokens: integer("completion_tokens"),
	latencyMs: integer("latency_ms"),
	status: text().default('success').notNull(),
	fallbackUsed: boolean("fallback_used").default(false),
	errorMessage: text("error_message"),
	correlationId: text("correlation_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	apiPath: text("api_path"),
	reasoningTokens: integer("reasoning_tokens"),
	usedStrictSchema: boolean("used_strict_schema"),
}, (table) => [
	index("ai_inference_api_path_idx").using("btree", table.apiPath.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")).where(sql`(api_path IS NOT NULL)`),
	index("ai_inference_model_idx").using("btree", table.modelName.asc().nullsLast().op("text_ops")),
	index("ai_inference_provider_idx").using("btree", table.provider.asc().nullsLast().op("text_ops")),
	index("ai_inference_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const contractRolls = pgTable("contract_rolls", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	positionId: uuid("position_id").notNull(),
	sessionId: uuid("session_id").notNull(),
	symbol: text().notNull(),
	action: text().notNull(),
	rollDate: date("roll_date").notNull(),
	flattenDate: date("flatten_date").notNull(),
	contracts: integer().notNull(),
	preRollPnl: numeric("pre_roll_pnl"),
	activeContract: text("active_contract"),
	reason: text().default('contract_rollover').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("contract_rolls_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("contract_rolls_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("contract_rolls_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
]);

export const exchangeOutages = pgTable("exchange_outages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	exchange: text().notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	reason: text(),
	affectedSymbols: text("affected_symbols").array(),
	responseTaken: text("response_taken"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_exchange_outages_active").using("btree", table.exchange.asc().nullsLast().op("text_ops"), table.endedAt.asc().nullsLast().op("timestamp_ops")).where(sql`(ended_at IS NULL)`),
	index("idx_exchange_outages_exchange_time").using("btree", table.exchange.asc().nullsLast().op("timestamp_ops"), table.startedAt.desc().nullsFirst().op("text_ops")),
]);

export const propFirmHealthChecks = pgTable("prop_firm_health_checks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	firmId: text("firm_id").notNull(),
	checkedAt: timestamp("checked_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().notNull(),
	responseCode: integer("response_code"),
	responseBodySnippet: text("response_body_snippet"),
	alertFired: boolean("alert_fired").default(false),
}, (table) => [
	index("idx_prop_firm_health_alerts").using("btree", table.alertFired.asc().nullsLast().op("bool_ops"), table.checkedAt.desc().nullsFirst().op("timestamp_ops")).where(sql`(alert_fired = true)`),
	index("idx_prop_firm_health_firm_time").using("btree", table.firmId.asc().nullsLast().op("timestamp_ops"), table.checkedAt.desc().nullsFirst().op("timestamp_ops")),
]);

export const systemHealthHeartbeat = pgTable("system_health_heartbeat", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('alive').notNull(),
	source: text().default('backend').notNull(),
}, (table) => [
	index("idx_heartbeat_ts_desc").using("btree", table.ts.desc().nullsFirst().op("timestamptz_ops")),
]);

export const operatorAbsentPeriods = pgTable("operator_absent_periods", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	reason: text(),
	endedBy: text("ended_by"),
}, (table) => [
	index("idx_operator_absent_active").using("btree", table.startedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(ended_at IS NULL)`),
]);

export const backtestTrades = pgTable("backtest_trades", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	entryTime: timestamp("entry_time", { mode: 'string' }).notNull(),
	exitTime: timestamp("exit_time", { mode: 'string' }),
	direction: text().notNull(),
	entryPrice: numeric("entry_price").notNull(),
	exitPrice: numeric("exit_price"),
	pnl: numeric(),
	contracts: integer().default(1).notNull(),
	commission: numeric(),
	slippage: numeric(),
	mae: numeric(),
	mfe: numeric(),
	holdDurationMs: integer("hold_duration_ms"),
	matrixId: uuid("matrix_id"),
	symbol: text(),
	timeframe: text(),
	netPnl: numeric("net_pnl"),
	hourOfDay: integer("hour_of_day"),
	dayOfWeek: integer("day_of_week"),
	macroRegime: text("macro_regime"),
	eventActive: boolean("event_active"),
	skipSignal: text("skip_signal"),
	grossPnl: numeric("gross_pnl"),
	fillProbability: numeric("fill_probability"),
	sessionType: text("session_type"),
}, (table) => [
	index("trades_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("trades_matrix_idx").using("btree", table.matrixId.asc().nullsLast().op("uuid_ops")),
	index("trades_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "backtest_trades_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.matrixId],
			foreignColumns: [backtestMatrix.id],
			name: "backtest_trades_matrix_id_backtest_matrix_id_fk"
		}).onDelete("set null"),
]);

export const cloudQmcRuns = pgTable("cloud_qmc_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	backendName: text("backend_name").notNull(),
	surfaceCodeDistance: integer("surface_code_distance").notNull(),
	nLogicalQubits: integer("n_logical_qubits").notNull(),
	nPhysicalQubits: integer("n_physical_qubits").notNull(),
	ibmJobId: text("ibm_job_id"),
	submittedAt: timestamp("submitted_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	qpuSecondsUsed: numeric("qpu_seconds_used"),
	rawSyndromeCount: integer("raw_syndrome_count"),
	isingCorrectedEstimate: numeric("ising_corrected_estimate"),
	pymatchingEstimate: numeric("pymatching_estimate"),
	uncorrectedEstimate: numeric("uncorrected_estimate"),
	agreementWithClassical: numeric("agreement_with_classical"),
	agreementWithLocalIae: numeric("agreement_with_local_iae"),
	status: text().default('queued').notNull(),
	errorMessage: text("error_message"),
	governanceLabels: jsonb("governance_labels").default({"experimental":true,"authoritative":false,"decision_role":"challenger_only"}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_cloud_qmc_runs_backtest").using("btree", table.backtestId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_cloud_qmc_runs_ibm_job_id").using("btree", table.ibmJobId.asc().nullsLast().op("text_ops")).where(sql`(ibm_job_id IS NOT NULL)`),
	index("idx_cloud_qmc_runs_status").using("btree", table.status.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['queued'::text, 'running'::text]))`),
	index("idx_cloud_qmc_runs_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "cloud_qmc_runs_backtest_id_fkey"
		}),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "cloud_qmc_runs_strategy_id_fkey"
		}),
]);

export const criticOptimizationRuns = pgTable("critic_optimization_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	backtestId: uuid("backtest_id").notNull(),
	status: text().default('pending').notNull(),
	candidatesGenerated: integer("candidates_generated"),
	survivorCandidateId: uuid("survivor_candidate_id"),
	survivorBacktestId: uuid("survivor_backtest_id"),
	parentCompositeScore: numeric("parent_composite_score"),
	survivorCompositeScore: numeric("survivor_composite_score"),
	evidenceSources: jsonb("evidence_sources"),
	evidencePacket: jsonb("evidence_packet"),
	compositeWeights: jsonb("composite_weights"),
	executionTimeMs: integer("execution_time_ms"),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("critic_runs_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("critic_runs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("critic_runs_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "critic_optimization_runs_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "critic_optimization_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.survivorCandidateId],
			foreignColumns: [criticCandidates.id],
			name: "critic_optimization_runs_survivor_candidate_id_critic_candidate"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.survivorBacktestId],
			foreignColumns: [backtests.id],
			name: "critic_optimization_runs_survivor_backtest_id_backtests_id_fk"
		}).onDelete("set null"),
]);

export const frankensteinTestRuns = pgTable("frankenstein_test_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	testMode: text("test_mode").notNull(),
	nShuffles: integer("n_shuffles").notNull(),
	p95Sharpe: numeric("p95_sharpe").notNull(),
	medianPf: numeric("median_pf").notNull(),
	passed: boolean().notNull(),
	sharpeDistribution: jsonb("sharpe_distribution"),
	pfDistribution: jsonb("pf_distribution"),
	failureExamples: jsonb("failure_examples"),
	status: text().default('pending').notNull(),
	errorMessage: text("error_message"),
	wallClockMs: integer("wall_clock_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_frankenstein_backtest").using("btree", table.backtestId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_frankenstein_passed_status").using("btree", table.passed.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("bool_ops")).where(sql`(status = 'completed'::text)`),
	index("idx_frankenstein_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "frankenstein_test_runs_backtest_id_fkey"
		}),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "frankenstein_test_runs_strategy_id_fkey"
		}),
]);

export const monteCarloRuns = pgTable("monte_carlo_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
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
	paths: jsonb(),
	riskMetrics: jsonb("risk_metrics"),
	executionTimeMs: integer("execution_time_ms"),
	gpuAccelerated: boolean("gpu_accelerated").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
}, (table) => [
	index("monte_carlo_runs_backtest_id_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "monte_carlo_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
]);

export const quantumMcRuns = pgTable("quantum_mc_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	method: text().notNull(),
	backend: text(),
	numQubits: integer("num_qubits"),
	estimatedValue: numeric("estimated_value"),
	classicalValue: numeric("classical_value"),
	toleranceDelta: numeric("tolerance_delta"),
	withinTolerance: boolean("within_tolerance"),
	confidenceInterval: jsonb("confidence_interval"),
	executionTimeMs: integer("execution_time_ms"),
	gpuAccelerated: boolean("gpu_accelerated").default(false),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	rawResult: jsonb("raw_result"),
	reproducibilityHash: text("reproducibility_hash"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
	cloudProvider: text("cloud_provider"),
	cloudBackendName: text("cloud_backend_name"),
	cloudJobId: text("cloud_job_id"),
	cloudQpuTimeSeconds: numeric("cloud_qpu_time_seconds"),
	cloudCostDollars: numeric("cloud_cost_dollars"),
	cloudRegion: text("cloud_region"),
}, (table) => [
	index("qmc_runs_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("qmc_runs_method_idx").using("btree", table.method.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "quantum_mc_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
]);

export const quantumRunCosts = pgTable("quantum_run_costs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	moduleName: text("module_name").notNull(),
	backtestId: uuid("backtest_id"),
	strategyId: uuid("strategy_id"),
	wallClockMs: integer("wall_clock_ms").notNull(),
	qpuSeconds: numeric("qpu_seconds").default('0'),
	costDollars: numeric("cost_dollars").default('0'),
	cacheHit: boolean("cache_hit").default(false),
	status: text().notNull(),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_quantum_run_costs_module_created").using("btree", table.moduleName.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "quantum_run_costs_backtest_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "quantum_run_costs_strategy_id_fkey"
		}).onDelete("set null"),
]);

export const shadowRerunFindings = pgTable("shadow_rerun_findings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	runAt: timestamp("run_at", { mode: 'string' }).defaultNow().notNull(),
	runReason: text("run_reason").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	backtestId: uuid("backtest_id").notNull(),
	oldCodeGitSha: text("old_code_git_sha").notNull(),
	newCodeGitSha: text("new_code_git_sha").notNull(),
	oldResultHash: text("old_result_hash").notNull(),
	newResultHash: text("new_result_hash").notNull(),
	oldPf: numeric("old_pf"),
	newPf: numeric("new_pf"),
	oldSharpe: numeric("old_sharpe"),
	newSharpe: numeric("new_sharpe"),
	oldMaxDd: numeric("old_max_dd"),
	newMaxDd: numeric("new_max_dd"),
	statusFlipped: boolean("status_flipped").notNull(),
	severity: text().default('info').notNull(),
}, (table) => [
	index("idx_shadow_rerun_run_at").using("btree", table.runAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_shadow_rerun_severity").using("btree", table.severity.asc().nullsLast().op("text_ops"), table.statusFlipped.asc().nullsLast().op("bool_ops")).where(sql`(severity = ANY (ARRAY['warning'::text, 'critical'::text]))`),
	index("idx_shadow_rerun_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.runAt.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("idx_shadow_rerun_unique_finding").using("btree", table.strategyId.asc().nullsLast().op("text_ops"), table.backtestId.asc().nullsLast().op("text_ops"), table.newCodeGitSha.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "shadow_rerun_findings_strategy_id_fkey"
		}),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "shadow_rerun_findings_backtest_id_fkey"
		}),
]);

export const sqaOptimizationRuns = pgTable("sqa_optimization_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	paramRanges: jsonb("param_ranges"),
	bestParams: jsonb("best_params"),
	bestEnergy: numeric("best_energy"),
	robustPlateau: jsonb("robust_plateau"),
	allSolutions: jsonb("all_solutions"),
	numReads: integer("num_reads"),
	numSweeps: integer("num_sweeps"),
	executionTimeMs: integer("execution_time_ms"),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
	comparisonResult: jsonb("comparison_result"),
	seed: integer(),
}, (table) => [
	index("sqa_runs_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("sqa_runs_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "sqa_optimization_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "sqa_optimization_runs_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const stressTestRuns = pgTable("stress_test_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	passed: boolean().notNull(),
	scenarios: jsonb().notNull(),
	failedScenarios: jsonb("failed_scenarios"),
	executionTimeMs: integer("execution_time_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("stress_test_runs_backtest_id_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "stress_test_runs_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
]);

export const syntheticBlackSwanRuns = pgTable("synthetic_black_swan_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	backtestId: uuid("backtest_id").notNull(),
	status: text().default('pending').notNull(),
	numRegimesTested: integer("num_regimes_tested"),
	numRegimesSurvived: integer("num_regimes_survived"),
	survivalRate: numeric("survival_rate", { precision: 5, scale:  4 }),
	worstRegimeId: uuid("worst_regime_id"),
	worstRegimeDrawdown: numeric("worst_regime_drawdown"),
	worstRegimeLabel: text("worst_regime_label"),
	resultSummary: jsonb("result_summary"),
	errorMessage: text("error_message"),
	executionTimeMs: integer("execution_time_ms"),
	generatorModelVersion: text("generator_model_version"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
}, (table) => [
	index("idx_blackswan_backtest").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("idx_blackswan_completed").using("btree", table.status.asc().nullsLast().op("numeric_ops"), table.survivalRate.asc().nullsLast().op("text_ops")).where(sql`(status = 'completed'::text)`),
	index("idx_blackswan_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "synthetic_black_swan_runs_strategy_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "synthetic_black_swan_runs_backtest_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.worstRegimeId],
			foreignColumns: [syntheticRegimeBank.id],
			name: "synthetic_black_swan_runs_worst_regime_id_fkey"
		}),
]);

export const tensorPredictions = pgTable("tensor_predictions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	modelVersion: text("model_version"),
	probability: numeric(),
	confidence: numeric(),
	signal: text(),
	featureSnapshot: jsonb("feature_snapshot"),
	regimeAtPrediction: text("regime_at_prediction"),
	fragilityScore: numeric("fragility_score"),
	regimeBreakdown: jsonb("regime_breakdown"),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	status: text().default('pending').notNull(),
}, (table) => [
	index("tensor_pred_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("tensor_pred_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "tensor_predictions_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "tensor_predictions_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
]);

export const tournamentResults = pgTable("tournament_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tournamentDate: timestamp("tournament_date", { mode: 'string' }).notNull(),
	candidateName: text("candidate_name").notNull(),
	candidateDsl: jsonb("candidate_dsl").notNull(),
	proposerOutput: jsonb("proposer_output"),
	compilerPass: boolean("compiler_pass"),
	graveyardPass: boolean("graveyard_pass"),
	criticOutput: jsonb("critic_output"),
	prosecutorOutput: jsonb("prosecutor_output"),
	promoterOutput: jsonb("promoter_output"),
	finalVerdict: text("final_verdict").notNull(),
	revisionNotes: text("revision_notes"),
	backtestId: uuid("backtest_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
}, (table) => [
	index("tournament_results_candidate_idx").using("btree", table.candidateName.asc().nullsLast().op("text_ops")),
	index("tournament_results_date_idx").using("btree", table.tournamentDate.asc().nullsLast().op("timestamp_ops")),
	index("tournament_results_verdict_idx").using("btree", table.finalVerdict.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "tournament_results_backtest_id_backtests_id_fk"
		}).onDelete("set null"),
]);

export const walkForwardWindows = pgTable("walk_forward_windows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	windowIndex: integer("window_index").notNull(),
	isStart: text("is_start"),
	isEnd: text("is_end"),
	oosStart: text("oos_start"),
	oosEnd: text("oos_end"),
	bestParams: jsonb("best_params"),
	isMetrics: jsonb("is_metrics"),
	oosMetrics: jsonb("oos_metrics"),
	paramStability: jsonb("param_stability"),
	confidence: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wf_windows_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "walk_forward_windows_backtest_id_backtests_id_fk"
		}).onDelete("cascade"),
]);

export const strategyExports = pgTable("strategy_exports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	exportType: text("export_type").notNull(),
	pineVersion: text("pine_version").default('v5'),
	exportabilityScore: numeric("exportability_score"),
	exportabilityDetails: jsonb("exportability_details"),
	status: text().default('pending').notNull(),
	errorMessage: text("error_message"),
	propOverlayFirm: text("prop_overlay_firm"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	configHash: text("config_hash"),
	contentHash: text("content_hash"),
	configSnapshot: jsonb("config_snapshot"),
	backtestId: uuid("backtest_id"),
}, (table) => [
	index("strat_exports_backtest_idx").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("strat_exports_content_hash_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops")),
	index("strat_exports_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("strat_exports_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_exports_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "strategy_exports_backtest_id_fkey"
		}).onDelete("set null"),
]);

export const criticCandidates = pgTable("critic_candidates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	runId: uuid("run_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	rank: integer().notNull(),
	changedParams: jsonb("changed_params").notNull(),
	parentParams: jsonb("parent_params"),
	sourceOfChange: text("source_of_change").notNull(),
	expectedUplift: numeric("expected_uplift"),
	riskPenalty: numeric("risk_penalty"),
	compositeScore: numeric("composite_score"),
	actualCompositeScore: numeric("actual_composite_score"),
	confidence: text(),
	reasoning: text(),
	replayStatus: text("replay_status").default('pending').notNull(),
	replayBacktestId: uuid("replay_backtest_id"),
	replayTier: text("replay_tier"),
	replayForgeScore: numeric("replay_forge_score"),
	selected: boolean().default(false),
	governanceLabels: jsonb("governance_labels").default({}).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	regretScore: numeric("regret_score"),
	criticModelVersion: text("critic_model_version"),
	evidenceRunIds: jsonb("evidence_run_ids"),
}, (table) => [
	index("critic_cand_run_idx").using("btree", table.runId.asc().nullsLast().op("uuid_ops")),
	index("critic_cand_selected_idx").using("btree", table.selected.asc().nullsLast().op("bool_ops")),
	index("critic_cand_status_idx").using("btree", table.replayStatus.asc().nullsLast().op("text_ops")),
	index("critic_cand_strategy_idx").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.runId],
			foreignColumns: [criticOptimizationRuns.id],
			name: "critic_candidates_run_id_critic_optimization_runs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "critic_candidates_strategy_id_strategies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.replayBacktestId],
			foreignColumns: [backtests.id],
			name: "critic_candidates_replay_backtest_id_backtests_id_fk"
		}).onDelete("set null"),
]);

export const lifecycleTransitions = pgTable("lifecycle_transitions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	fromState: text("from_state").notNull(),
	toState: text("to_state").notNull(),
	decisionAuthority: text("decision_authority").notNull(),
	reason: text(),
	backtestId: uuid("backtest_id"),
	forgeScore: numeric("forge_score"),
	mcSurvivalRate: numeric("mc_survival_rate"),
	quantumAgreementScore: numeric("quantum_agreement_score"),
	quantumAdvantageDelta: numeric("quantum_advantage_delta"),
	quantumFallbackTriggered: boolean("quantum_fallback_triggered").default(false),
	quantumClassicalDisagreementPct: numeric("quantum_classical_disagreement_pct"),
	cloudQmcRunId: uuid("cloud_qmc_run_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	correlationId: text("correlation_id"),
}, (table) => [
	index("idx_lifecycle_transitions_correlation_id").using("btree", table.correlationId.asc().nullsLast().op("text_ops")).where(sql`(correlation_id IS NOT NULL)`),
	index("idx_lifecycle_transitions_correlation_strategy").using("btree", table.correlationId.asc().nullsLast().op("uuid_ops"), table.strategyId.asc().nullsLast().op("uuid_ops")).where(sql`(correlation_id IS NOT NULL)`),
	index("idx_lifecycle_transitions_quantum_agreement").using("btree", table.quantumAgreementScore.asc().nullsLast().op("numeric_ops")).where(sql`(quantum_agreement_score IS NOT NULL)`),
	index("idx_lifecycle_transitions_strategy_created").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "lifecycle_transitions_strategy_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "lifecycle_transitions_backtest_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.cloudQmcRunId],
			foreignColumns: [cloudQmcRuns.id],
			name: "fk_lifecycle_transitions_cloud_qmc_run"
		}).onDelete("set null"),
]);

export const adversarialStressRuns = pgTable("adversarial_stress_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	backtestId: uuid("backtest_id").notNull(),
	strategyId: uuid("strategy_id").notNull(),
	nQubits: integer("n_qubits").default(0).notNull(),
	nTrades: integer("n_trades").default(0).notNull(),
	dailyLossLimit: numeric("daily_loss_limit").notNull(),
	worstCaseBreachProb: numeric("worst_case_breach_prob"),
	breachMinimalNTrades: integer("breach_minimal_n_trades"),
	worstSequenceExamples: jsonb("worst_sequence_examples"),
	qpuSeconds: numeric("qpu_seconds").default('0'),
	wallClockMs: integer("wall_clock_ms"),
	method: text().notNull(),
	status: text().default('pending').notNull(),
	errorMessage: text("error_message"),
	governanceLabels: jsonb("governance_labels").default({"experimental":true,"authoritative":false,"decision_role":"challenger_only"}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_adversarial_stress_backtest").using("btree", table.backtestId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_adversarial_stress_high_risk").using("btree", table.worstCaseBreachProb.asc().nullsLast().op("int4_ops"), table.breachMinimalNTrades.asc().nullsLast().op("numeric_ops")).where(sql`((status = 'completed'::text) AND (worst_case_breach_prob IS NOT NULL))`),
	index("idx_adversarial_stress_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "adversarial_stress_runs_backtest_id_fkey"
		}),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "adversarial_stress_runs_strategy_id_fkey"
		}),
]);

export const strategySignalVectors = pgTable("strategy_signal_vectors", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	backtestId: uuid("backtest_id").notNull(),
	// TODO: failed to parse database type 'bytea'
	signalVectorCompressed: unknown("signal_vector_compressed").notNull(),
	nBars: integer("n_bars").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_signal_vectors_backtest").using("btree", table.backtestId.asc().nullsLast().op("uuid_ops")),
	index("idx_signal_vectors_strategy").using("btree", table.strategyId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.strategyId],
			foreignColumns: [strategies.id],
			name: "strategy_signal_vectors_strategy_id_fkey"
		}),
	foreignKey({
			columns: [table.backtestId],
			foreignColumns: [backtests.id],
			name: "strategy_signal_vectors_backtest_id_fkey"
		}),
	unique("strategy_signal_vectors_strategy_id_backtest_id_key").on(table.strategyId, table.backtestId),
]);

export const strategyExportArtifacts = pgTable("strategy_export_artifacts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	exportId: uuid("export_id").notNull(),
	artifactType: text("artifact_type").notNull(),
	fileName: text("file_name").notNull(),
	content: text().notNull(),
	sizeBytes: integer("size_bytes"),
	pineVersion: text("pine_version").default('v5'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	contentHash: text("content_hash"),
}, (table) => [
	index("strat_export_artifacts_content_hash_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops")),
	index("strat_export_artifacts_export_idx").using("btree", table.exportId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.exportId],
			foreignColumns: [strategyExports.id],
			name: "strategy_export_artifacts_export_id_strategy_exports_id_fk"
		}).onDelete("cascade"),
]);

export const dailyVolumeProfileLevels = pgTable("daily_volume_profile_levels", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: text().notNull(),
	sessionDate: date("session_date").notNull(),
	poc: numeric({ precision: 20, scale:  8 }).notNull(),
	vah: numeric({ precision: 20, scale:  8 }).notNull(),
	val: numeric({ precision: 20, scale:  8 }).notNull(),
	nakedPocs: jsonb("naked_pocs").default([]).notNull(),
	profileShape: text("profile_shape").notNull(),
	shapeConfidence: numeric("shape_confidence", { precision: 5, scale:  4 }).notNull(),
	ibHigh: numeric("ib_high", { precision: 20, scale:  8 }),
	ibLow: numeric("ib_low", { precision: 20, scale:  8 }),
	ibExtensionStatus: text("ib_extension_status"),
	openClassification: text("open_classification"),
	computedAt: timestamp("computed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("daily_vp_levels_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
	uniqueIndex("daily_vp_levels_symbol_session_idx").using("btree", table.symbol.asc().nullsLast().op("date_ops"), table.sessionDate.asc().nullsLast().op("date_ops")),
]);

export const nemoScenarioBank = pgTable("nemo_scenario_bank", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	scenarioLabel: text("scenario_label").notNull(),
	scenarioJson: jsonb("scenario_json").notNull(),
	severity: text().notNull(),
	durationDays: integer("duration_days").notNull(),
	targetVol: numeric("target_vol", { precision: 8, scale:  4 }),
	targetTrend: numeric("target_trend", { precision: 8, scale:  4 }),
	generatorVersion: text("generator_version").notNull(),
	usedInA14RunIds: jsonb("used_in_a14_run_ids").default([]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_nemo_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_nemo_generator_ver").using("btree", table.generatorVersion.asc().nullsLast().op("text_ops")),
	index("idx_nemo_scenario_label").using("btree", table.scenarioLabel.asc().nullsLast().op("text_ops")),
	index("idx_nemo_severity").using("btree", table.severity.asc().nullsLast().op("text_ops")),
	check("nemo_scenario_bank_severity_check", sql`severity = ANY (ARRAY['mild'::text, 'moderate'::text, 'severe'::text, 'extreme'::text])`),
	check("nemo_scenario_bank_duration_days_check", sql`duration_days > 0`),
]);

export const biasDecisions = pgTable("bias_decisions", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	symbol: text().notNull(),
	decisionTimestamp: timestamp("decision_timestamp", { withTimezone: true, mode: 'string' }).notNull(),
	featureSnapshot: jsonb("feature_snapshot").notNull(),
	featureVersions: jsonb("feature_versions").notNull(),
	classifierVersion: text("classifier_version").notNull(),
	rawStateProbs: jsonb("raw_state_probs").notNull(),
	calibratedConfidence: numeric("calibrated_confidence", { precision: 5, scale:  4 }),
	calibrationVersion: text("calibration_version"),
	routerVersion: text("router_version").notNull(),
	routerHash: text("router_hash").notNull(),
	playbook: text().notNull(),
	allowedStrategies: jsonb("allowed_strategies").notNull(),
	hysteresisApplied: boolean("hysteresis_applied").default(false).notNull(),
	engineMode: text("engine_mode").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_bias_decisions_engine_mode").using("btree", table.engineMode.asc().nullsLast().op("text_ops")),
	index("idx_bias_decisions_playbook").using("btree", table.playbook.asc().nullsLast().op("text_ops")),
	index("idx_bias_decisions_symbol_ts").using("btree", table.symbol.asc().nullsLast().op("timestamptz_ops"), table.decisionTimestamp.desc().nullsFirst().op("text_ops")),
	unique("bias_decisions_symbol_decision_timestamp_router_version_key").on(table.symbol, table.decisionTimestamp, table.routerVersion),
]);

export const biasCalibrationCurves = pgTable("bias_calibration_curves", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	fitAt: timestamp("fit_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	windowDays: integer("window_days").notNull(),
	curveMethod: text("curve_method").notNull(),
	curveParams: jsonb("curve_params").notNull(),
	reliabilityScore: numeric("reliability_score", { precision: 5, scale:  4 }),
	version: text().notNull(),
}, (table) => [
	index("idx_bias_calibration_fit_at").using("btree", table.fitAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const biasAblationResults = pgTable("bias_ablation_results", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	runAt: timestamp("run_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	periodStart: date("period_start").notNull(),
	periodEnd: date("period_end").notNull(),
	modeOffSharpe: numeric("mode_off_sharpe", { precision: 8, scale:  4 }),
	modeGatedSharpe: numeric("mode_gated_sharpe", { precision: 8, scale:  4 }),
	sharpeDelta: numeric("sharpe_delta", { precision: 8, scale:  4 }),
	costMultiplier: numeric("cost_multiplier", { precision: 4, scale:  2 }),
	pboScore: numeric("pbo_score", { precision: 5, scale:  4 }),
	gpt5Verdict: text("gpt5_verdict"),
	gpt5Reasoning: text("gpt5_reasoning"),
	acceptedByOperator: boolean("accepted_by_operator"),
}, (table) => [
	index("idx_bias_ablation_run_at").using("btree", table.runAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const systemState = pgTable("system_state", {
	id: integer().default(1).primaryKey().notNull(),
	productionMode: text("production_mode").default('HALT').notNull(),
	killReason: text("kill_reason"),
	setBy: text("set_by").default('system').notNull(),
	setAt: timestamp("set_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("singleton", sql`id = 1`),
]);

export const productionTrades = pgTable("production_trades", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	strategyId: uuid("strategy_id").notNull(),
	strategyVersionHash: text("strategy_version_hash").notNull(),
	barTimestamp: timestamp("bar_timestamp", { withTimezone: true, mode: 'string' }).notNull(),
	signalValue: smallint("signal_value").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	biasDecisionId: bigint("bias_decision_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	complianceCheckId: bigint("compliance_check_id", { mode: "number" }),
	traderspostWebhookId: text("traderspost_webhook_id"),
	tradovateFillId: text("tradovate_fill_id"),
	expectedSlippage: numeric("expected_slippage", { precision: 8, scale:  4 }),
	actualSlippage: numeric("actual_slippage", { precision: 8, scale:  4 }),
	expectedPnl: numeric("expected_pnl", { precision: 12, scale:  4 }),
	actualPnl: numeric("actual_pnl", { precision: 12, scale:  4 }),
	correlationId: uuid("correlation_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_prod_trades_bar_ts").using("btree", table.barTimestamp.asc().nullsLast().op("timestamptz_ops")),
	index("idx_prod_trades_correlation").using("btree", table.correlationId.asc().nullsLast().op("uuid_ops")),
	index("idx_prod_trades_strategy").using("btree", table.strategyId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.biasDecisionId],
			foreignColumns: [biasDecisions.id],
			name: "production_trades_bias_decision_id_fkey"
		}),
]);

export const dailyReconciliation = pgTable("daily_reconciliation", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	reconDate: date("recon_date").notNull(),
	productionTradesCount: integer("production_trades_count").notNull(),
	traderspostLogCount: integer("traderspost_log_count").notNull(),
	tradovateFillsCount: integer("tradovate_fills_count").notNull(),
	mffuDashboardPnl: numeric("mffu_dashboard_pnl", { precision: 12, scale:  4 }),
	expectedPnl: numeric("expected_pnl", { precision: 12, scale:  4 }).notNull(),
	mismatchCount: integer("mismatch_count").default(0).notNull(),
	mismatchDetails: jsonb("mismatch_details").default([]).notNull(),
	alertFired: boolean("alert_fired").default(false).notNull(),
	ranAt: timestamp("ran_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("daily_reconciliation_recon_date_key").on(table.reconDate),
]);

export const weeklyDriftReports = pgTable("weekly_drift_reports", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	reportWeek: date("report_week").notNull(),
	liveSharpe30D: numeric("live_sharpe_30d", { precision: 8, scale:  4 }),
	backtestSharpeExpected: numeric("backtest_sharpe_expected", { precision: 8, scale:  4 }),
	sharpeDeltaSigma: numeric("sharpe_delta_sigma", { precision: 8, scale:  4 }),
	winRateDelta: numeric("win_rate_delta", { precision: 8, scale:  4 }),
	slippageDelta: numeric("slippage_delta", { precision: 8, scale:  4 }),
	latencyP95Ms: integer("latency_p95_ms"),
	severity: text().notNull(),
	autoHaltTriggered: boolean("auto_halt_triggered").default(false).notNull(),
	ranAt: timestamp("ran_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("weekly_drift_reports_report_week_key").on(table.reportWeek),
]);

export const instanceConfig = pgTable("instance_config", {
	id: integer().default(1).primaryKey().notNull(),
	instanceId: text("instance_id").notNull(),
	enabledFirms: jsonb("enabled_firms").default([]).notNull(),
	activeStrategies: jsonb("active_strategies").default({}).notNull(),
	tradeifyExclusiveMode: boolean("tradeify_exclusive_mode").default(false).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	check("instance_config_singleton_check", sql`id = 1`),
]);

export const brokerAccounts = pgTable("broker_accounts", {
	accountId: uuid("account_id").defaultRandom().primaryKey().notNull(),
	firmId: text("firm_id").notNull(),
	brokerType: text("broker_type").notNull(),
	apiKeyVaultRef: text("api_key_vault_ref"),
	accountIdExternal: text("account_id_external"),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_broker_accounts_enabled").using("btree", table.enabled.asc().nullsLast().op("bool_ops")),
	uniqueIndex("idx_broker_accounts_firm_external").using("btree", table.firmId.asc().nullsLast().op("text_ops"), table.accountIdExternal.asc().nullsLast().op("text_ops")).where(sql`(account_id_external IS NOT NULL)`),
	index("idx_broker_accounts_firm_id").using("btree", table.firmId.asc().nullsLast().op("text_ops")),
	check("broker_accounts_firm_id_check", sql`firm_id = ANY (ARRAY['mffu'::text, 'topstep'::text])`),
	check("broker_accounts_broker_type_check", sql`broker_type = ANY (ARRAY['traderspost'::text, 'topstepx'::text])`),
]);
