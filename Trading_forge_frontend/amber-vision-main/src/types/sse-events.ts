/**
 * SSE event catalog mirrored from `broadcastSSE("...")` call sites in `src/server/`.
 * Add new variants here when the backend publishes a new event so consumers
 * (notably `useSSE`) can stay exhaustive without falling back to `any`.
 *
 * Where the backend payload is uncertain, use `Record<string, unknown>` and
 * leave a `// TODO` comment so the next pass can sharpen the shape.
 */

// ─── Strategy lifecycle ───────────────────────────────────────────────

export interface StrategyCreatedData {
  strategyId: string;
  name: string;
}

export interface StrategyPromotedData {
  strategyId: string;
  tier?: string | number;
  forgeScore?: number;
  paperSessionId?: string;
  // Lifecycle-service variants also include `from`/`to`/`name`/`survivalRate`
  from?: string;
  to?: string;
  name?: string;
  survivalRate?: string;
}

export interface LifecyclePromotedData {
  strategyId: string;
  from: string;
  to: string;
  name?: string;
  forgeScore?: number;
  tier?: string | number;
  survivalRate?: string;
}

export interface StrategyDeployReadyData {
  strategyId: string;
  name: string;
  symbol?: string;
  rollingSharpe?: number;
  tradingDays?: number;
  message?: string;
}

export interface StrategyDeployedData {
  strategyId: string;
  name: string | null;
}

export interface StrategyExportabilityBlockedData {
  strategyId: string;
  name?: string;
  fromState: string;
  toState: string;
  score?: number;
  band?: string;
  reasons?: unknown;
}

export interface StrategyDecayWarningData {
  strategyId: string;
  name?: string;
  decayScore: number;
  lifecycleState?: string;
  message?: string;
}

export interface StrategyDecayDemotionData {
  strategyId: string;
  name?: string;
  decayScore: number;
  fromState: string;
  toState: string;
  message?: string;
}

export interface StrategyDriftAlertData {
  strategyId: string;
  message?: string;
  // TODO: backend emits drift summary fields — confirm exact shape.
  [key: string]: unknown;
}

export interface StrategyDriftDemotionData {
  strategyId: string;
  driftSeverity: number;
}

export interface StrategyEvolvedData {
  parentId: string;
  evolvedId: string;
  generation: number;
  improvement?: number;
  reason?: string;
}

/**
 * Emitted by `src/server/services/evolution-service.ts` when child-strategy
 * promotion is refused (CANDIDATE→TESTING gate failure or other tx error).
 * The child insert is rolled back to avoid orphans; this event surfaces the
 * abort so the loop is observable from the dashboard.
 */
export interface EvolutionAbortData {
  parentStrategyId: string;
  parentGeneration: number | null;
  reason: string;
  stage: "child_promotion" | string;
}

export interface StrategyAnalyzedData {
  strategyId: string;
  // TODO: scout/n8n analyzer payload — verify fields.
  [key: string]: unknown;
}

export interface StrategyAnalysisErrorData {
  strategyId?: string;
  // TODO: confirm error envelope shape.
  [key: string]: unknown;
}

export interface StrategyPaperVsBacktestAlertData {
  strategyId: string;
  // TODO: drift comparison — confirm shape.
  [key: string]: unknown;
}

// ─── Critic loop ──────────────────────────────────────────────────────

export interface CriticStartedData {
  runId: string;
  strategyId?: string;
  // TODO: confirm full payload.
  [key: string]: unknown;
}

export interface CriticEvidenceCollectedData {
  runId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface CriticCandidatesReadyData {
  runId: string;
  count: number;
}

export interface CriticCompletedData {
  runId: string;
  status?: "failed" | string;
  killSignal?: string;
  survivor?: string | null;
  manual?: boolean;
  error?: string;
}

export interface CriticChildCreatedData {
  runId: string;
  parentStrategyId: string;
  childStrategyId: string;
  generation: number;
  manual?: boolean;
  idempotent?: boolean;
}

export interface CriticReplayStartedData {
  runId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface CriticReplayCompleteData {
  runId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface CriticEvaluationCompleteData {
  runId: string;
  // TODO: confirm critic-evaluator output shape.
  [key: string]: unknown;
}

export interface CriticEvidenceSourceData {
  runId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

// ─── Backtest / Monte Carlo ───────────────────────────────────────────

export interface BacktestCompletedData {
  backtestId?: string;
  strategyId?: string;
  // TODO: confirm full backtest summary fields.
  [key: string]: unknown;
}

export interface BacktestFailedData {
  backtestId?: string;
  strategyId?: string;
  error?: string;
  [key: string]: unknown;
}

/** CF-3: Fired after every completed backtest, regardless of tier outcome.
 *  Allows dashboards to update strategies.forgeScore immediately.
 *  gateRejected=true means tier is REJECTED or missing — strategy won't auto-promote. */
export interface BacktestScoredData {
  backtestId: string;
  strategyId: string;
  forgeScore: number;
  tier: string | null;
  gateRejected: boolean;
  correlationId?: string | null;
}

export interface BacktestMatrixProgressData {
  matrixId: string;
  tier: string;
  completed: number;
  total: number;
  latest?: {
    symbol?: string;
    timeframe?: string;
    forgeScore?: number;
  };
}

export interface BacktestMatrixTierData {
  matrixId: string;
  tier: "tier2" | "tier3" | string;
  completed: number;
  total: number;
  survivingSymbols?: string[];
  promotedSymbols?: string[];
  tier1Completed?: number;
  tier2Completed?: number;
}

export interface BacktestMatrixCompletedData {
  matrixId: string;
  strategyId: string;
  totalCombos: number;
  bestCombo?: {
    symbol?: string;
    timeframe?: string;
    forgeScore?: number;
  };
}

export interface BacktestMatrixFailedData {
  matrixId: string;
  strategyId?: string;
  error?: string;
  [key: string]: unknown;
}

export interface MonteCarloCompletedData {
  mcRunId?: string;
  backtestId?: string;
  // TODO: confirm full payload.
  [key: string]: unknown;
}

export interface MonteCarloFailedData {
  mcRunId?: string;
  backtestId?: string;
  error?: string;
  [key: string]: unknown;
}

// ─── Paper trading ────────────────────────────────────────────────────

export interface PaperTradeData {
  sessionId?: string;
  // TODO: confirm trade fields.
  [key: string]: unknown;
}

export interface PaperPnlData {
  sessionId?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperSignalData {
  sessionId?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperKillSwitchTrippedData {
  sessionId: string;
  symbol?: string;
  reason: string;
  force_close?: boolean;
  correlationId?: string | null;
}

export interface PaperAutoStoppedData {
  sessionId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperAutoRecoveredData {
  sessionId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperPositionOpenedData {
  sessionId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperFillMissData {
  sessionId: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperRollEventData {
  sessionId?: string;
  symbol?: string;
  // TODO: confirm roll-flatten / roll-warning shape.
  [key: string]: unknown;
}

/**
 * Emitted by `src/server/services/paper-execution-service.ts:1210` after a
 * paper position closes that crossed one or more contract roll boundaries.
 * The roll-spread cost has already been deducted from netPnl on the trade row;
 * this event surfaces the cost so the dashboard can render roll friction
 * separately from execution slippage.
 */
export interface PaperRollSpreadAppliedData {
  positionId: string;
  tradeId: string;
  symbol: string;
  contracts: number;
  rollDates: unknown;
  costUsd: number;
}

export interface PaperConsistencyWarningData {
  sessionId?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PaperDecayEventData {
  strategyId?: string;
  // TODO: confirm decay-alert / decay-warning shape.
  [key: string]: unknown;
}

export interface PaperSessionFeedbackComputedData {
  sessionId: string;
  reason?: string;
  source?: string;
}

export interface PaperSessionLifecycleData {
  sessionId: string;
  // TODO: confirm session_start / session_stop shape.
  [key: string]: unknown;
}

// ─── Pipeline ─────────────────────────────────────────────────────────

export interface PipelineModeChangeData {
  mode?: string;
  // TODO: confirm shape.
  [key: string]: unknown;
}

export interface PipelineSnapshotData {
  // TODO: confirm pause_snapshot / resume_stale_positions shapes.
  [key: string]: unknown;
}

export interface PipelineDrainResumeData {
  // TODO: confirm.
  [key: string]: unknown;
}

// ─── Alerts / compliance ──────────────────────────────────────────────

export interface AlertNewData {
  id?: string;
  type?: string;
  severity?: string;
  title?: string;
  message?: string;
  // TODO: align with `Alert` type from `@/types/api`.
  [key: string]: unknown;
}

export interface AlertTriggeredData {
  type: string;
  sessionId?: string;
  strategyId?: string;
  [key: string]: unknown;
}

export interface AlertGuardDownData {
  reason?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface ComplianceGateBlockedData {
  strategyId?: string;
  firm?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface ComplianceCascadeRevalidationData {
  firm: string;
  invalidatedReviews: number;
  pausedStrategies: string[];
  affectedStrategyIds: string[];
  severity: string;
  message: string;
  timestamp: string;
}

// ─── Scheduler ────────────────────────────────────────────────────────

export interface SchedulerJobCompleteData {
  job?: string;
  durationMs?: number;
  // TODO: confirm.
  [key: string]: unknown;
}

export interface SchedulerSharpeUpdatedData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface SchedulerPreMarketAlertData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface SchedulerDecaySweepCompleteData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface SchedulerRegretScoreFillData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface LifecycleAutoCheckData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface NightlyReviewCompleteData {
  // TODO: confirm.
  [key: string]: unknown;
}

// ─── DeepAR ───────────────────────────────────────────────────────────

export interface DeeparForecastReadyData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface DeeparTrainingCompleteData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface DeeparWeightChangedData {
  previousWeight: number;
  currentWeight: number;
  rollingHitRate: number;
  daysTracked: number;
  timestamp: string;
}

// ─── Anti-setup / regime / archetype ──────────────────────────────────

export interface AntiSetupMinedData {
  count: number;
}

export interface AntiSetupBlockedData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface AntiSetupEffectivenessData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface ArchetypePredictedData {
  symbol: string;
  date: string;
  predicted: string;
  confidence: number;
}

export interface RegimeStateUpdatedData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface CorrelationAlertData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PortfolioCorrelationSnapshotData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface DriftAlertData {
  // TODO: confirm — `drift:alert` is generic vs `strategy:drift-alert`.
  [key: string]: unknown;
}

// ─── Pine export ──────────────────────────────────────────────────────

export interface PineExportCompletedData {
  strategyId: string;
  exportId: string;
  exportType?: string;
  score?: number;
  indicator_file?: string;
  strategy_file?: string;
}

/** Emitted by the pine-export agent after a successful Pine script export. */
export interface PineExportCompletedV2Data {
  strategyId: string;
  exportId: string;
  contentHash: string;
  exportabilityScore: number;
  durationMs: number;
}

/** Emitted by the pine-export agent when an export attempt fails. */
export interface PineExportFailedData {
  strategyId: string;
  errorCode: string;
  message: string;
  durationMs: number;
}

/** Emitted by the critic agent after a successful critic optimizer run. */
export interface CriticRunCompletedData {
  runId: string;
  strategyId: string;
  candidatesGenerated: number;
  survivorCandidateId: string | null;
  durationMs: number;
}

/** Emitted by the critic agent when a critic optimizer run fails. */
export interface CriticRunFailedData {
  runId: string;
  strategyId: string;
  errorCode: string;
  message: string;
  durationMs: number;
}

/** Emitted by the critic agent after a replay ranking pass completes. */
export interface CriticReplayCompletedData {
  runId: string;
  replayedCount: number;
  survivorCount: number;
}

/** Emitted by MetricsAggregator.warmUp() after server boot DB replay. */
export interface MetricsWarmedUpData {
  sessionsRecovered: number;
  tradesReplayed: number;
}

// ─── n8n / agents ─────────────────────────────────────────────────────

export interface N8nHealthAlertData {
  failing: Array<{
    workflowName?: string;
    total?: number;
    failures?: number;
  }>;
}

export interface N8nWorkflowFailedData {
  workflowName?: string;
  // TODO: confirm.
  [key: string]: unknown;
}

/**
 * Emitted by `src/server/scheduler.ts:1452` when the tournament_results table
 * has not seen a fresh row inside `STALE_THRESHOLD_HOURS`. Indicates that the
 * n8n tournament workflow may be down or paused — the dashboard should surface
 * this and the on-call should investigate the n8n side.
 */
export interface N8nTournamentStaleData {
  ageHours: number | null;
  latestResultAt: string | null;
  threshold: number;
}

export interface AgentHealthSweepData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PromptABTestResolvedData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface PromptEvolutionCompleteData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface MetaParameterReviewData {
  // TODO: confirm.
  [key: string]: unknown;
}

// ─── Metrics / system ─────────────────────────────────────────────────

export interface MetricsSnapshotData {
  sessions: unknown[];
  timestamp: string;
}

export interface MetricsTradeCloseData {
  // TODO: confirm.
  [key: string]: unknown;
}

export interface SystemShutdownData {
  reason: string;
  signal?: string;
}

// ─── Pending validation watchlist (Pass 18 cross-source validation) ───

/**
 * Emitted whenever a `strategy_pending_buckets` row changes (new mention added,
 * source_count bumped, distinct_providers changed). Frontend pending watchlist
 * subscribes and invalidates the list query.
 */
export interface PendingBucketUpdatedData {
  bucketId: string;
  status: string;
  sourceCount: number;
  distinctProviders: number;
}

/**
 * Emitted when a pending bucket crosses the 3-source threshold and is promoted
 * to the existing `/scout-ideas/strict` pipeline. Frontend shows a success
 * toast and removes the row from the pending list.
 */
export interface PendingBucketGraduatedData {
  bucketId: string;
  strategyId?: string;
  name?: string;
  market?: string;
}

// ─── Lifecycle gate evaluation (Wave 2 / Wave 4, 2026-05-16) ─────────────────

/**
 * Emitted by `lifecycle-service.ts` whenever a lifecycle gate runs.
 * Covers: Frankenstein (TESTING→PAPER), A7 signal-correlation (PAPER→DEPLOY_READY),
 * pilot_auto_promotion sweep (PILOT→DEPLOYED), and any future gate added to the
 * lifecycle service.
 *
 * `ramp_up_mode: true` signals that A7 passed because this is the first strategy
 * (no DEPLOYED strategy exists yet to compare against) — operator must see this
 * distinctly in the UI.
 *
 * `decision` values:
 *   - "passed"                      — gate cleared, promotion allowed
 *   - "failed"                      — gate blocked, promotion refused
 *   - "killed"                      — strategy sent to GRAVEYARD
 *   - "promoted"                    — PILOT auto-promoted to DEPLOYED
 *   - "deferred_insufficient_sessions" — PILOT not enough sessions yet
 *   - "deferred_sharpe_below_threshold" — PILOT Sharpe too low
 */
export interface LifecycleGateEvaluatedData {
  strategy_id: string;
  /** The gate that ran: "frankenstein" | "A7" | "pilot_auto_promotion" */
  gate: string;
  /** Outcome of the evaluation */
  decision:
    | "passed"
    | "failed"
    | "killed"
    | "promoted"
    | "deferred_insufficient_sessions"
    | "deferred_sharpe_below_threshold"
    | string;
  /**
   * True only when gate="A7" and the strategy passed because it is the FIRST
   * strategy (no DEPLOYED strategy to compare signal vectors against).
   * Operator must see this as a distinct UI state.
   */
  ramp_up_mode?: boolean;
  correlation_id?: string | null;
}

// ─── Operator-dashboard events (emitter-only; no frontend UX yet) ────────────
// These events are emitted by the backend but consumed by operator dashboards
// that are not yet built. They are typed here so the SSE union stays exhaustive
// and TypeScript remains happy. When a dashboard panel is added, move the type
// to a more specific section and add a useSSE handler.

/** `production:mode-changed` — kill-switch state toggle */
export interface ProductionModeChangedData {
  mode: string;
  reason?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/** `production:drift-detection-completed` — reconciliation drift scan complete */
export interface ProductionDriftDetectionCompletedData {
  driftItems?: unknown[];
  [key: string]: unknown;
}

/** `production:reconciliation-completed` — reconciliation service sweep done */
export interface ProductionReconciliationCompletedData {
  [key: string]: unknown;
}

/** `compute:failover-state-change` — Ollama primary/fallback flip */
export interface ComputeFailoverStateChangeData {
  state: string;
  [key: string]: unknown;
}

/** `network:failover-state-change` — network path flip */
export interface NetworkFailoverStateChangeData {
  state: string;
  [key: string]: unknown;
}

/** `strategy:compliance_blocked` — strategy blocked by 2026 compliance gate */
export interface StrategyComplianceBlockedData {
  strategyId: string;
  firm?: string;
  reasons?: unknown;
  [key: string]: unknown;
}

/** `strategy:assignment_collision` — duplicate strategy+account assignment attempt */
export interface StrategyAssignmentCollisionData {
  strategyId: string;
  accountId: string;
  [key: string]: unknown;
}

/** `compliance:collaborative_trading_warning` — MFFU collaborative-trading rule triggered */
export interface ComplianceCollaborativeTradingWarningData {
  strategyId: string;
  accountIds: string[];
  [key: string]: unknown;
}

/** `lifecycle:operator_absent_autopromoted` — operator-absent auto-promotion fired */
export interface LifecycleOperatorAbsentAutopromovedData {
  strategyId: string;
  from: string;
  to: string;
  [key: string]: unknown;
}

/** `paper:entry-blocked-production-halt` — new paper entry blocked (production mode halt) */
export interface PaperEntryBlockedProductionHaltData {
  sessionId?: string;
  [key: string]: unknown;
}

/** `paper:order-blocked-outage` — order blocked due to CME/exchange outage */
export interface PaperOrderBlockedOutageData {
  sessionId?: string;
  [key: string]: unknown;
}

/** `paper:order-blocked-suspension` — order blocked due to prop firm suspension */
export interface PaperOrderBlockedSuspensionData {
  sessionId?: string;
  firmId?: string;
  [key: string]: unknown;
}

/** `paper:kill-switch-threshold-tripped` — 67% DLL reached; new entries blocked */
export interface PaperKillSwitchThresholdTrippedData {
  sessionId: string;
  threshold: number;
  [key: string]: unknown;
}

/** `paper:force-flatten-all` — all positions force-flattened */
export interface PaperForceFlattenAllData {
  reason: string;
  count: number;
  errors: number;
}

/** `broker:order_routed` — order dispatched through broker-router */
export interface BrokerOrderRoutedData {
  success: boolean;
  reason?: string;
  correlationId?: string | null;
  [key: string]: unknown;
}

/** `pine_export:hmac_persist_failed` — HMAC secret write failed (will retry) */
export interface PineExportHmacPersistFailedData {
  assignmentId?: string;
  error?: string;
  [key: string]: unknown;
}

/** `pine_export:recipient_generated` — per-recipient Pine artifact generated */
export interface PineExportRecipientGeneratedData {
  assignmentId: string;
  strategyId: string;
  [key: string]: unknown;
}

/** `pine_export:delivered` — Pine artifact delivered to recipient */
export interface PineExportDeliveredData {
  assignmentId?: string;
  [key: string]: unknown;
}

/** `pending_bucket.expired` — pending bucket TTL expired without graduation */
export interface PendingBucketExpiredData {
  bucketId: string;
  market?: string;
  [key: string]: unknown;
}

/** `auction:imbalance-updated` — opening auction order imbalance updated */
export interface AuctionImbalanceUpdatedData {
  symbol?: string;
  imbalance?: number;
  [key: string]: unknown;
}

/** `scout-health:reject-spike` — scout pipeline rejection rate spiked */
export interface ScoutHealthRejectSpikeData {
  count?: number;
  [key: string]: unknown;
}

/** `scout-health:no-strategies-today` — no strategies produced by scout today */
export interface ScoutHealthNoStrategiesTodayData {
  [key: string]: unknown;
}

/** `prop-firm:snapshot-captured` — prop firm balance snapshot taken */
export interface PropFirmSnapshotCapturedData {
  firmId?: string;
  [key: string]: unknown;
}

/** `prop-firm:suspension-detected` — prop firm account suspended */
export interface PropFirmSuspensionDetectedData {
  firmId: string;
  status?: string;
  [key: string]: unknown;
}

/** `prop-firm:suspension-cleared` — prop firm suspension cleared */
export interface PropFirmSuspensionClearedData {
  firmId: string;
  [key: string]: unknown;
}

/** `vp:levels-computed` — volume profile levels computed for session */
export interface VpLevelsComputedData {
  symbol: string;
  sessionDate: string;
  shape?: string;
}

/** `windows:health-check-failed` — Windows health check failed */
export interface WindowsHealthCheckFailedData {
  reason?: string;
  [key: string]: unknown;
}

/** `windows:health-check-ram-warning` — RAM usage exceeding threshold */
export interface WindowsHealthCheckRamWarningData {
  usedGb?: number;
  totalGb?: number;
  [key: string]: unknown;
}

/** `windows:real-reboot-pending` — Windows reboot is pending */
export interface WindowsRealRebootPendingData {
  [key: string]: unknown;
}

/** `compliance:violation_detected` — 2026 MFFU compliance rule violation */
export interface ComplianceViolationDetectedData {
  rule: string;
  strategy_id?: string | null;
  position_id?: string | null;
  firm: string;
  details: Record<string, unknown>;
  correlation_id?: string | null;
}

/** `migration:legacy_firm_cleanup_complete` — migration 0097 cleanup done */
export interface MigrationLegacyFirmCleanupCompleteData {
  retained_firms: string[];
  removed_firms: string[];
  applied_at: string;
}

/** `firm_count_changed` — active firm count changed */
export interface FirmCountChangedData {
  previous_count: number;
  new_count: number;
  active_firms: string[];
}

/**
 * `paper:tp1_filled` — TP1 fill in the Style C exit handler.
 *
 * CORRECTED 2026-07-05 (deepscan17-wave2): this catalog previously typed the
 * discriminant as `paper:exit:tp1_filled` (and siblings below with an
 * `:exit:` infix). Verified against the actual broadcast site
 * (paper-execution-service.ts via `PAPER_EXIT_EVENTS.TP1_FILLED`, defined in
 * src/server/routes/sse.ts) — the real constant values have NO `:exit:`
 * infix (`"paper:tp1_filled"`, not `"paper:exit:tp1_filled"`). The old
 * `:exit:` names never matched anything the server actually broadcasts, so
 * these 6 dashboard events (TP1/TP2 fill, BE-stop move, trail tighten,
 * time-stop flatten, handler error) were silently un-typeable — a real
 * silent-tile bug, not a checker false-positive. `useSSE.ts`'s
 * `dispatchSideEffects` switch (src/hooks/useSSE.ts ~line 753) still
 * references the stale `paper:exit:*` names and needs a coordinated fix in a
 * session with frontend-hook edit scope — flagged as a carry-forward.
 */
export interface PaperExitTp1FilledData {
  position_id: string;
  strategy_id: string | null;
  decision_type: string;
  evidence: Record<string, unknown>;
  exit_style: "D" | "C";
  correlation_id: string | null;
}

/** `paper:tp2_filled` — TP2 fill in the Style C exit handler. See `PaperExitTp1FilledData` naming-correction note. */
export type PaperExitTp2FilledData = PaperExitTp1FilledData;
/** `paper:be_stop_moved` — BE+1 tick stop move in exit handler. See `PaperExitTp1FilledData` naming-correction note. */
export type PaperExitBeStopMovedData = PaperExitTp1FilledData;
/** `paper:trail_tightened` — Chandelier trail tightened. See `PaperExitTp1FilledData` naming-correction note. */
export type PaperExitTrailTightenedData = PaperExitTp1FilledData;
/** `paper:time_stop_flattened` — 15:55 ET time-stop flatten. See `PaperExitTp1FilledData` naming-correction note. */
export type PaperExitTimeStopFlattenedData = PaperExitTp1FilledData;
/** `paper:handler_error` — exit handler threw an error. See `PaperExitTp1FilledData` naming-correction note. */
export type PaperExitHandlerErrorData = PaperExitTp1FilledData;

/** `a-plus-auditor:scan-complete` — A+ auditor noise scan done */
export interface APlusAuditorScanCompleteData {
  [key: string]: unknown;
}

/** `nemo:scenario-generated` — NEMO scenario generated */
export interface NemoScenarioGeneratedData {
  [key: string]: unknown;
}

/** `nemo:scenario-error` — NEMO scenario generation errored */
export interface NemoScenarioErrorData {
  [key: string]: unknown;
}

/** `strategy:assigned` — strategy assigned to a family member account */
export interface StrategyAssignedData {
  strategyId: string;
  accountId: string;
  [key: string]: unknown;
}

/** `strategy:unassigned` — strategy unassigned from an account */
export interface StrategyUnassignedData {
  strategyId: string;
  accountId: string;
  [key: string]: unknown;
}

/**
 * `strategy:graveyard_burial` — emitted by `buryInGraveyard()` after the
 * strategy_graveyard row is committed and the audit row is written. This is
 * a non-reversible terminal transition; the frontend shows an error toast so
 * the operator sees the burial even if they are on a different page.
 *
 * `failureModes` values: "low_sharpe" | "unprofitable" | "low_win_rate" |
 * "excessive_drawdown" | "below_minimum_daily_pnl" | "rejected_by_gate" |
 * "alpha_decay"
 */
export interface StrategyGraveyardBurialData {
  strategyId: string;
  name: string;
  failureModes: string[];
  deathReason: string;
  correlationId?: string | null;
}

// ─── W9-2: Pine export failure ────────────────────────────────────────

/**
 * `pine_export:failed` — emitted by `generateRecipientExport()` or the
 * pine-export route layer when Pine compilation throws or returns errors.
 * Operator dashboard shows a real-time error toast so failures are not
 * invisible (no polling required).
 *
 * `errorCode` values:
 *   "pipeline_paused"           — export blocked by pipeline pause guard
 *   "strategy_not_found"        — strategyId does not resolve to a row
 *   "account_not_found"         — accountId not found or firm not allowed
 *   "compilation_failed"        — pine-compiler returned errors
 *   "hmac_persist_failed"       — HMAC write exhausted all retries (non-fatal path)
 *   "internal_error"            — unexpected throw (check server logs)
 */
export interface PineExportFailedServerData {
  exportId: string | null;
  strategyId: string;
  /** accountId or recipientId depending on call path */
  accountId?: string | null;
  /** firm_id e.g. "mffu" | "topstep" */
  firmId?: string | null;
  errorCode:
    | "pipeline_paused"
    | "strategy_not_found"
    | "account_not_found"
    | "compilation_failed"
    | "hmac_persist_failed"
    | "internal_error"
    | string;
  errorMessage: string;
  correlationId: string | null;
  timestamp: string;
}

// ─── W9-3: Walk-forward window progress ──────────────────────────────

/**
 * `walkforward:window_complete` — emitted after each OOS window is
 * persisted in the backtest transaction. Lets the operator track
 * multi-window walk-forward jobs in real time without polling.
 */
export interface WalkforwardWindowCompleteData {
  backtestId: string;
  strategyId: string;
  windowIndex: number;
  windowStart: string | null;
  windowEnd: string | null;
  /** OOS Sharpe ratio for this window (null if engine omitted the field) */
  oosSharpe: number | null;
  /** OOS net P&L for this window (null if engine omitted the field) */
  oosNetPnl: number | null;
  /** Whether this window passed the OOS Sharpe threshold */
  passed: boolean;
  correlationId: string | null;
  timestamp: string;
}

// ─── W9-3: Compliance drift detection ────────────────────────────────

/**
 * `compliance:drift_detected` — emitted by `checkComplianceRuleDrift()`
 * when the prop-firm-rules.md document hash changes. The operator must
 * review and re-validate active strategies.
 *
 * `severity` values: "warning" (hash changed, no strategy impact yet) |
 *   "critical" (affected strategies are currently PAPER/DEPLOYED)
 */
export interface ComplianceDriftDetectedData {
  affectedFirms: string[];
  oldHash: string | null;
  newHash: string;
  /** Number of strategies that may be affected (PAPER/DEPLOYED) */
  affectedStrategyCount: number;
  severity: "warning" | "critical";
  correlationId: string | null;
  timestamp: string;
}

// ─── Wave 23 Track C: bias engine + A+ gate (2026-05-19) ──────────────
// `bias_engine:strategy_selected` is emitted once per RTH session-open from
// `bias-state-service.ts` after the playbook router has chosen an active
// strategy for today's regime. Consumers (dashboards, frontends, ProductionStatusPanel)
// can subscribe to render the "today's strategy" badge without polling.
export interface BiasEngineStrategySelectedData {
  /** YYYY-MM-DD CME trading day */
  sessionDate: string;
  /** Regime label from bias_engine.compute_bias() (e.g. 'TRENDING_UP', 'MEAN_REVERSION_LONG', 'NO_TRADE') */
  regimeLabel: string;
  /** Playbook chosen by route_playbook() */
  playbook: string;
  /** Strategy assigned for the regime; null when no match */
  activeStrategyId: string | null;
  /** ISO timestamp of the decision */
  computedAt: string;
}

// `signal:a_plus_rejected` is emitted at signal time from paper-signal-service
// when a strategy with non-legacy `entry_quality` produced fewer satisfied
// confluence factors than `min_factors_satisfied`. The audit_log counterpart
// is `signal.a_plus_rejected`. Note: the paired pass event
// (`signal.a_plus_passed`) is audit-only; harsh-regime advisory rides the
// existing `lifecycle:gate_evaluated` channel with `gate: "harsh_regime_survival_w23"`.
export interface SignalAPlusRejectedData {
  sessionId: string;
  symbol: string;
  strategyId: string;
  satisfiedCount: number;
  minRequired: number;
  factorResults: Record<string, boolean> | unknown;
  timestamp: number | string;
}

// ─── Deep-scan #12 Track R: Safety-critical + operational SSE interfaces ─────
// Payload shapes derived from broadcastSSE() call sites in src/server/.

/** kill_switch:dll_force_close — DLL 95% breach force-close triggered (kill-switch.ts) */
export interface KillSwitchDllForceCloseData {
  session_id: string;
  firm_id: string;
  day_pnl: number;
  dll: number;
}

/** kill_switch:layer_halted — Kill-switch layer fired and halted trading (kill-switch.ts) */
export interface KillSwitchLayerHaltedData {
  layer: number;
  reason: string;
  detail: Record<string, unknown>;
  correlationId: string | null;
}

/** kill_switch:c1_cme_eval_failed — CME eval failed at layer 6; trading halted (kill-switch.ts) */
export interface KillSwitchC1CmeEvalFailedData {
  error_message: string;
  layer: number;
  halted: boolean;
  timestamp: string;
}

/** quantum_rl:kill_switch_engaged — RL kill switch engaged; Sharpe gap > 30% (rl-signal-fetcher.ts) */
export interface QuantumRlKillSwitchEngagedData {
  strategy_id: number;
  reason: string;
  sharpe_gap_ratio: number;
  sessions_evaluated: number;
}

/** exchange:outage-detected — CME / exchange outage detected; entry blocked (exchange-status-service.ts) */
export interface ExchangeOutageDetectedData {
  exchange: string;
  reason: string;
  affectedSymbols: string[];
  outageId: string;
}

/** exchange:outage-resolved — CME / exchange outage resolved; entry block lifted (exchange-status-service.ts) */
export interface ExchangeOutageResolvedData {
  exchange: string;
  outageId: string;
  note: string;
}

/** broker:degraded — TradersPost circuit breaker opened (broker-router.ts) */
export interface BrokerDegradedData {
  broker: string;
  reason: string;
  failureThreshold: number;
  cooldownMs: number;
}

/** risk:dd_velocity_autopause — DD velocity breach exceeded threshold; session auto-paused (dd-velocity-gate.ts) */
export interface RiskDdVelocityAutopauseData {
  sessionId: string | null;
  firmId: string;
  rollingDDPct: number;
  windowMinutes: number;
  windowPeakEquity: number;
  currentEquity: number;
  effectiveThreshold: number;
  topstepTightenApplied: boolean;
}

/** risk:dd_velocity_warning — DD velocity above warning threshold; not yet paused (dd-velocity-gate.ts) */
export interface RiskDdVelocityWarningData {
  sessionId: string | null;
  firmId: string;
  rollingDDPct: number;
  windowMinutes: number;
}

/** paper:position-stop-breached — Paper position closed at stop level (paper-execution-service.ts) */
export interface PaperPositionStopBreachedData {
  positionId: string;
  sessionId: string;
  symbol: string;
  side: string;
  stopLevel: number;
  adversePrice: number;
  currentPrice: number;
}

/** paper:auto_restart_exhausted — Paper session auto-restart cap reached; manual action required (scheduler.ts) */
export interface PaperAutoRestartExhaustedData {
  sessionId: string;
  strategyId: number;
  restartCount: number;
}

/** paper:auto_restarted — Paper session stream successfully restarted (scheduler.ts) */
export interface PaperAutoRestartedData {
  sessionId: string;
  strategyId: number;
  restartAttempt: number;
  symbols: string[];
}

/** fill_reconciliation:drift_detected — Position qty drift between server and broker (fill-reconciliation-service.ts) */
export interface FillReconciliationDriftDetectedData {
  accountId: string;
  symbol: string;
  serverNetQty: number;
  brokerPositionQty: number;
  correlationId?: string | null;
}

/** fill_reconciliation:unmatched_fill — Fill event received with no matching server order (fill-reconciliation-service.ts) */
export interface FillReconciliationUnmatchedFillData {
  symbol: string;
  filled_qty: number;
  broker_order_ref: string | null;
  correlationId: string | null;
}

/** PAPER_PARITY_DEGRADED — Paper signal parity degraded; SMT live bridge used null fallback (paper-signal-service.ts) */
export interface PaperParityDegradedData {
  source: string;
  sessionId: string;
  strategyId: number;
  symbol: string;
}

/** backtest:truthiness_failure — Backtest truthiness invariant or parity check failed (backtest-service.ts) */
export interface BacktestTruthinessFailureData {
  backtestId: string;
  strategyId: number;
  type: "invariant" | "parity" | "parity_skip";
  severity: string;
}

/** compliance:rejected — Order rejected for compliance rule violation (broker-router.ts) */
export interface ComplianceRejectedData {
  firmId: string;
  symbol: string;
  reason: string;
  correlationId: string | null;
}

/** signal:macro_gate_eval_failed — C11 macro gate evaluation failed; signal fail-closed (paper-signal-service.ts) */
export interface SignalMacroGateEvalFailedData {
  sessionId: string;
  symbol: string;
  error_message: string;
}

/** monte_carlo:trades_fallback_used — MC bootstrap uses daily P&L because trade records sparse (monte-carlo-service.ts) */
export interface MonteCarloTradesFallbackUsedData {
  backtestId: string;
  tradeCount: number;
  minRequired: number;
  message: string;
}

/** pending_bucket:killed — Pending bucket killed by operator or automation (agent.ts) */
export interface PendingBucketKilledData {
  bucket_id: string;
  reason: string;
  correlation_id: string | null;
}

// ─── Wave 29 Passes A/C/D: SHADOW stage + PBO gate + RL A/B routing ──────────
// These 5 are members of the backend's `WAVE29_EVENTS` catalog
// (src/server/routes/sse.ts:383-396) that had real broadcastSSE() call sites
// but NO frontend type — `quantum_rl:kill_switch_engaged` (the 6th member) was
// already typed above as `QuantumRlKillSwitchEngagedData`. Shapes below are
// copied from the actual call sites, not guessed:
//   signal:shadow_logged                 — paper-signal-service.ts (~5640)
//   lifecycle:pbo_evaluated               — lifecycle-service.ts (~1541, ~1604)
//   lifecycle:shadow_divergence_evaluated — lifecycle-service.ts (~4254, ~4319)
//   signal:rl_ab_routed                   — paper-signal-service.ts (~5912)
//   quantum_rl:training_completed         — backtest-service.ts (~2365)

/** signal:shadow_logged — SHADOW-stage signal logged; TradersPost webhook is
 *  intentionally SKIPPED (shadow invariant). Fired instead of the normal
 *  pending-entry queue path. */
export interface SignalShadowLoggedData {
  sessionId: string;
  strategyId: number | string;
  symbol: string;
  direction: string | null;
  entryPrice: number;
  intendedSize: number;
  killzone: string | null;
  regime: string | null;
  lifecycleState: "SHADOW";
  traderspostWebhookCalled: false;
  barTimestamp: string | number;
  correlationId: string | null;
}

/** lifecycle:pbo_evaluated — Probability-of-Backtest-Overfitting gate
 *  evaluated at TESTING → SHADOW / TESTING → PAPER. `blocked=true` means the
 *  promotion was refused (pbo > threshold); `legacy_null` marks a pre-Wave-29
 *  backtest with no computable PBO (grandfathered PASS). */
export interface LifecyclePboEvaluatedData {
  strategyId: string;
  fromState: string;
  toState: string;
  pbo: number | null;
  threshold: number;
  blocked: boolean;
  legacy_null?: boolean;
}

/** lifecycle:shadow_divergence_evaluated — shadow-vs-backtest signal
 *  divergence gate evaluated at SHADOW → PAPER. `ok=false` means the
 *  promotion was blocked (divergence too high, or insufficient sample —
 *  see `reason`). */
export interface LifecycleShadowDivergenceEvaluatedData {
  strategyId: string;
  ok: boolean;
  divergence_pct: number | null;
  sample_size: number;
  reason?: string;
}

/** signal:rl_ab_routed — signal routed to one of the two A/B paper
 *  sub-accounts (slumdawg-baseline vs slumdawg-rl-challenger). Advisory
 *  observability only — never gates promotion (CLAUDE.md §12). */
export interface SignalRlAbRoutedData {
  sessionId: string;
  strategyId: number | string;
  symbol: string;
  routing: string;
  targetSubAccount: string;
  resolvedAccountId: string | null;
  routingCalled: boolean;
  routingSuccess: boolean;
  side: string | null;
  contracts: number;
  signalBar: string | number;
}

/** quantum_rl:training_completed — RL training epoch batch completed for a
 *  strategy (fires post-subprocess-success only; failed runs do not emit). */
export interface QuantumRlTrainingCompletedData {
  strategy_id: number | string;
  regimes_trained: number;
  duration_ms: number;
  correlation_id: string | null;
}

// ─── Deep-scan #17 Wave 2 (2026-07-05): server-only advisory events ─────────
// `npm run check:sse-contract` reported these as broadcast by the server but
// absent from this catalog (silent-tile risk — frontend cannot type/subscribe).
// Shapes derived directly from the broadcastSSE() call sites, not guessed.

/** `alert:broker_error_budget` — broker rejection-class error-budget threshold
 *  breached (broker-error-budget-service.ts). */
export interface AlertBrokerErrorBudgetData {
  broker: string;
  rejectionClass: string;
  pct: number;
  count: number;
  totalAttempts: number;
  computedAt: string;
}

/** `alert:path_c_error` — Wave 25 Path C weighted-confluence evaluation threw;
 *  signal flow fell back to Path B for this bar (paper-signal-service.ts). */
export interface AlertPathCErrorData {
  sessionId?: string;
  strategyId: number | string;
  symbol: string;
  error: string;
  fallback: "path_b" | string;
  correlationId: string | null;
}

/** `alert:regime_coverage_gap` — no PILOT/DEPLOYED strategy covers one or more
 *  regimes; a regime shift into the gap would produce zero trades
 *  (regime-coverage-monitor-service.ts). */
export interface AlertRegimeCoverageGapData {
  gapRegimes: string[];
  coverage: Record<string, number>;
  allRegimesChecked: string[];
  timestamp: string;
}

/** `alert:webhook_latency_high` — rolling p95 Pine→TradingView→TradersPost→broker
 *  webhook latency exceeded threshold (webhook-latency-monitor-service.ts). */
export interface AlertWebhookLatencyHighData {
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
  thresholdMs: number;
  windowHours: number;
  timestamp: string;
}

/** `backtest:completion_write_failed` — the final backtest-completion DB write
 *  threw; backtest is re-thrown to the outer catch to be marked failed
 *  (backtest-service.ts). Distinct from `backtest:failed` (a run-time failure) —
 *  this is a persistence-layer failure on an otherwise-completed run. */
export interface BacktestCompletionWriteFailedData {
  backtestId: string;
  strategyId: number | string;
  error: string;
}

/**
 * `bias_engine:refreshed` — bias engine recomputed a session's regime/playbook.
 * TWO DISTINCT BROADCAST SITES emit under this same event name with DIFFERENT
 * field sets — consumers must treat every field as optional and branch on which
 * are present, not assume both shapes simultaneously:
 *   - bias-state-service.ts (per-symbol refresh): symbol/regimeLabel/playbook/
 *     activeStrategyId/computedAt/priorRegimeLabel/priorActiveStrategyId/
 *     regimeChanged/strategyChanged
 *   - scheduler.ts `bias-engine-refresh-10am-et` cron (all-symbols batch):
 *     correlationId/symbolCount/symbols/forceRefresh/timestamp
 */
export interface BiasEngineRefreshedData {
  sessionDate: string;
  // Per-symbol refresh shape (bias-state-service.ts)
  symbol?: string;
  regimeLabel?: string;
  playbook?: string;
  activeStrategyId?: string | null;
  computedAt?: string;
  priorRegimeLabel?: string | null;
  priorActiveStrategyId?: string | null;
  regimeChanged?: boolean;
  strategyChanged?: boolean;
  // All-symbols batch cron shape (scheduler.ts bias-engine-refresh-10am-et)
  correlationId?: string;
  symbolCount?: number;
  symbols?: string[];
  forceRefresh?: boolean;
  timestamp?: string;
}

/** `bias_engine:session_start` — daily 9:30 AM ET bias computation completed
 *  for all symbols (scheduler.ts `bias-engine-session-start` cron). */
export interface BiasEngineSessionStartData {
  sessionDate: string;
  correlationId: string;
  symbolCount: number;
  symbols: string[];
  timestamp: string;
}

/** `factory:candidate_backtest_enqueued` — autonomous conveyor enqueued a
 *  backtest for a CANDIDATE strategy (candidate-backtest-conveyor-service.ts). */
export interface FactoryCandidateBacktestEnqueuedData {
  strategyId: number | string;
  strategyName: string;
  backtestId: string;
  correlationId: string;
}

/** `factory:graduation_entry_quality` — direct-bucket-graduator.ts graduation
 *  completed with an entry_quality block attached. Mirrors the server-side
 *  `FactoryGraduationEntryQualityPayload` shape in src/server/routes/sse.ts. */
export interface FactoryGraduationEntryQualityData {
  strategy_id: number;
  name: string;
  symbols: string[];
  confluence_factor_count: number;
  extraction_provenance: string;
  has_source_claim_win_rate: boolean;
  has_source_claim_avg_r: boolean;
  correlation_id: string | null;
}

/** `factory:multi_market_bucket` — cross-symbol concept bucket converged across
 *  ≥2 symbols at graduation (direct-bucket-graduator.ts). Mirrors the
 *  server-side `FactoryMultiMarketBucketPayload` shape in src/server/routes/sse.ts. */
export interface FactoryMultiMarketBucketData {
  bucket_fingerprint: string;
  concept_name: string;
  symbols: string[];
  layer_coverage: {
    web: boolean;
    youtube: boolean;
    reddit: boolean;
  };
  correlation_id: string | null;
}

/** `fill_reconciliation:fill_ingested` — a broker fill event was matched to a
 *  server-mediated order and applied (fill-reconciliation-service.ts). */
export interface FillReconciliationFillIngestedData {
  orderId: string;
  newStatus: string;
  newFilledQty: number;
  intendedQty: number;
  correlationId: string | null;
}

/** `fill_reconciliation:reconcile_cleared` — operator/automation cleared all
 *  `needs_reconcile` orders for an account (fill-reconciliation-service.ts). */
export interface FillReconciliationReconcileClearedData {
  accountId: string;
  cleared: number;
  resolvedBy: string;
  correlationId: string | null;
}

/**
 * `lifecycle:dsl_guards_evaluated` — DSL guards gate evaluated at a lifecycle
 * promotion checkpoint (lifecycle-service.ts, 6 call sites across
 * TESTING→PAPER / SHADOW→PAPER / PAPER→DEPLOY_READY). `...auditPayload` is
 * spread from `evaluateDslGuardsGate()` and its exact keys vary by guard —
 * kept as an index signature rather than enumerated.
 */
export interface LifecycleDslGuardsEvaluatedData {
  strategyId: number | string;
  passed: boolean;
  reason?: string;
  [key: string]: unknown;
}

/**
 * `macro:regime-updated` — daily macro regime classification refreshed
 * (scheduler.ts `macro-data-sync` cron, `runMacroDailySync()`). NOTE: the
 * System Map's manual SSE inventory section marks this "removed" from a
 * Wave 11 cleanup pass, but verified 2026-07-05 (deepscan17-wave2) that the
 * scheduler cron still actively calls broadcastSSE() with this literal on
 * every successful daily run — the emission is live, only the System Map
 * inventory doc and this frontend catalog were stale. Left the System Map
 * inventory untouched (separate file, out of this session's scope).
 */
export interface MacroRegimeUpdatedData {
  date: string;
  regime: string;
  confidence: number;
}

/** `risk:dd_velocity_vacation_auto_recovered` — DD-velocity autopause was
 *  auto-cleared during operator-absent vacation mode (dd-velocity-gate.ts). */
export interface RiskDdVelocityVacationAutoRecoveredData {
  sessionId: string | null;
  operatorAbsentSince: string;
  pauseAgeHours: number;
  timestamp: string;
}

/** `signal:weighted_score_rejected` — Wave 25 Path C weighted-confluence score
 *  fell below threshold (or hit a hard-block); signal rejected
 *  (paper-signal-service.ts). */
export interface SignalWeightedScoreRejectedData {
  sessionId: string;
  strategyId: number | string;
  symbol: string;
  score: number;
  threshold: number;
  hardBlock: boolean;
  weightsSource: string;
  topUnsatisfiedFactors: Array<{ factor: string; weight: number; reason?: string }>;
  price: number;
  timestamp: string | number;
  correlationId: string | null;
}

/** `strategy:exportability_infra_error` — Pine exportability pre-check threw
 *  an infra error (dynamic-import / subprocess failure) during a lifecycle
 *  promotion tick; strategy skipped this cycle, not blocked outright
 *  (lifecycle-service.ts, TESTING→PAPER and SHADOW→PAPER call sites). */
export interface StrategyExportabilityInfraErrorData {
  strategyId: number | string;
  name: string | null;
  reason: "infra_failure_in_outer_catch" | string;
  errorMessage: string;
  correlationId: string | null;
}

/** `tradingview:marker-received` — inbound TradingView alert marker accepted
 *  and persisted (tradingview-webhook.ts). */
export interface TradingviewMarkerReceivedData {
  markerId: string | null;
  strategyId: number | string | null;
  accountId: string | null;
  barTimestamp: string | number;
  signal: string;
  firmId: string | null;
  correlationId: string | null;
  receivedAt: string;
}

/** `windows:health-check-auto-resumed` — pipeline auto-resumed after a
 *  Windows pending-reboot pause was confirmed cleared
 *  (windows-health-check-service.ts). */
export interface WindowsHealthCheckAutoResumedData {
  reason: "reboot_pending_flag_cleared" | string;
  timestamp: string;
}

// ─── Discriminated union ──────────────────────────────────────────────

export type SSEEvent =
  | { type: "strategy:created"; data: StrategyCreatedData }
  | { type: "strategy:promoted"; data: StrategyPromotedData }
  | { type: "lifecycle:promoted"; data: LifecyclePromotedData }
  | { type: "strategy:deploy-ready"; data: StrategyDeployReadyData }
  | { type: "strategy:deployed"; data: StrategyDeployedData }
  | { type: "strategy:exportability_blocked"; data: StrategyExportabilityBlockedData }
  | { type: "strategy:decay-warning"; data: StrategyDecayWarningData }
  | { type: "strategy:decay-demotion"; data: StrategyDecayDemotionData }
  | { type: "strategy:drift-alert"; data: StrategyDriftAlertData }
  | { type: "strategy:drift-demotion"; data: StrategyDriftDemotionData }
  | { type: "strategy:evolved"; data: StrategyEvolvedData }
  | { type: "evolution:abort"; data: EvolutionAbortData }
  | { type: "strategy:analyzed"; data: StrategyAnalyzedData }
  | { type: "strategy:analysis-error"; data: StrategyAnalysisErrorData }
  | { type: "strategy:paper-vs-backtest-alert"; data: StrategyPaperVsBacktestAlertData }
  | { type: "critic:started"; data: CriticStartedData }
  | { type: "critic:started_async"; data: CriticStartedData }
  | { type: "critic:evidence_collected"; data: CriticEvidenceCollectedData }
  | { type: "critic:evidence_collected_async"; data: CriticEvidenceCollectedData }
  | { type: "critic:evidence_source"; data: CriticEvidenceSourceData }
  | { type: "critic:candidates_ready"; data: CriticCandidatesReadyData }
  | { type: "critic:completed"; data: CriticCompletedData }
  | { type: "critic:child_created"; data: CriticChildCreatedData }
  | { type: "critic:replay_started"; data: CriticReplayStartedData }
  | { type: "critic:replay_complete"; data: CriticReplayCompleteData }
  | { type: "critic:evaluation_complete"; data: CriticEvaluationCompleteData }
  | { type: "backtest:completed"; data: BacktestCompletedData }
  // NOTE (deepscan17-wave2, 2026-07-05): the legacy `backtest:complete` (no "d")
  // catalog entry was REMOVED here — verified the server only ever emits
  // "backtest:completed" (backtest-service.ts:~1202); "backtest:complete" had
  // no broadcast site anywhere in src/server/. `Backtests.tsx:40` subscribes
  // to both names defensively and `useSSE.ts`'s dispatch switch still has a
  // dead `case "backtest:complete":` — both are harmless (the case can never
  // match; the extra subscription string is a no-op) but are stale and should
  // be cleaned up in a session with frontend-file edit scope.
  | { type: "backtest:scored"; data: BacktestScoredData }
  | { type: "backtest:failed"; data: BacktestFailedData }
  | { type: "backtest:matrix-progress"; data: BacktestMatrixProgressData }
  | { type: "backtest:matrix-tier"; data: BacktestMatrixTierData }
  | { type: "backtest:matrix-completed"; data: BacktestMatrixCompletedData }
  | { type: "backtest:matrix-failed"; data: BacktestMatrixFailedData }
  | { type: "mc:completed"; data: MonteCarloCompletedData }
  | { type: "mc:failed"; data: MonteCarloFailedData }
  | { type: "paper:trade"; data: PaperTradeData }
  | { type: "paper:pnl"; data: PaperPnlData }
  | { type: "paper:signal"; data: PaperSignalData }
  | { type: "paper:kill-switch-tripped"; data: PaperKillSwitchTrippedData }
  | { type: "paper:auto_stopped"; data: PaperAutoStoppedData }
  | { type: "paper:auto_recovered"; data: PaperAutoRecoveredData }
  | { type: "paper:position-opened"; data: PaperPositionOpenedData }
  | { type: "paper:fill-miss"; data: PaperFillMissData }
  | { type: "paper:roll-flatten"; data: PaperRollEventData }
  | { type: "paper:roll-warning"; data: PaperRollEventData }
  | { type: "paper:roll-spread-applied"; data: PaperRollSpreadAppliedData }
  | { type: "paper:consistency-warning"; data: PaperConsistencyWarningData }
  | { type: "paper:decay-alert"; data: PaperDecayEventData }
  | { type: "paper:decay-warning"; data: PaperDecayEventData }
  | { type: "paper:session-feedback-computed"; data: PaperSessionFeedbackComputedData }
  | { type: "paper:session_start"; data: PaperSessionLifecycleData }
  | { type: "paper:session_stop"; data: PaperSessionLifecycleData }
  | { type: "pipeline:mode-change"; data: PipelineModeChangeData }
  | { type: "pipeline:pause_snapshot"; data: PipelineSnapshotData }
  | { type: "pipeline:resume_stale_positions"; data: PipelineSnapshotData }
  | { type: "pipeline:drain-resume"; data: PipelineDrainResumeData }
  | { type: "alert:new"; data: AlertNewData }
  | { type: "alert:triggered"; data: AlertTriggeredData }
  | { type: "alert:kill_switch_down"; data: AlertGuardDownData }
  | { type: "alert:compliance_gate_blocked"; data: ComplianceGateBlockedData }
  | { type: "alert:compliance_guard_down"; data: AlertGuardDownData }
  | { type: "alert:calendar_guard_down"; data: AlertGuardDownData }
  | { type: "alert:ict_bridge_down"; data: AlertGuardDownData }
  | { type: "compliance:cascade_revalidation"; data: ComplianceCascadeRevalidationData }
  | { type: "scheduler:job-complete"; data: SchedulerJobCompleteData }
  | { type: "scheduler:sharpe-updated"; data: SchedulerSharpeUpdatedData }
  | { type: "scheduler:pre-market-alert"; data: SchedulerPreMarketAlertData }
  | { type: "scheduler:decay-sweep-complete"; data: SchedulerDecaySweepCompleteData }
  | { type: "scheduler:regret-score-fill"; data: SchedulerRegretScoreFillData }
  | { type: "lifecycle:auto-check"; data: LifecycleAutoCheckData }
  | { type: "nightly:review-complete"; data: NightlyReviewCompleteData }
  | { type: "deepar:forecast_ready"; data: DeeparForecastReadyData }
  | { type: "deepar:training_complete"; data: DeeparTrainingCompleteData }
  | { type: "deepar:weight_changed"; data: DeeparWeightChangedData }
  | { type: "anti-setup:mined"; data: AntiSetupMinedData }
  | { type: "anti-setup:blocked"; data: AntiSetupBlockedData }
  | { type: "anti-setup:effectiveness"; data: AntiSetupEffectivenessData }
  | { type: "archetype:predicted"; data: ArchetypePredictedData }
  | { type: "regime:state_updated"; data: RegimeStateUpdatedData }
  | { type: "correlation:alert"; data: CorrelationAlertData }
  | { type: "portfolio:correlation_snapshot"; data: PortfolioCorrelationSnapshotData }
  | { type: "drift:alert"; data: DriftAlertData }
  | { type: "pine:export_completed"; data: PineExportCompletedData }
  | { type: "pine:export-completed"; data: PineExportCompletedV2Data }
  | { type: "pine:export-failed"; data: PineExportFailedData }
  | { type: "critic:run-completed"; data: CriticRunCompletedData }
  | { type: "critic:run-failed"; data: CriticRunFailedData }
  | { type: "critic:replay-completed"; data: CriticReplayCompletedData }
  | { type: "metrics:warmed-up"; data: MetricsWarmedUpData }
  | { type: "n8n:health-alert"; data: N8nHealthAlertData }
  | { type: "n8n:workflow-failed"; data: N8nWorkflowFailedData }
  | { type: "n8n:tournament-stale"; data: N8nTournamentStaleData }
  | { type: "agent:health_sweep"; data: AgentHealthSweepData }
  | { type: "prompt-ab-test:resolved"; data: PromptABTestResolvedData }
  | { type: "prompt-evolution:complete"; data: PromptEvolutionCompleteData }
  | { type: "meta:parameter_review"; data: MetaParameterReviewData }
  | { type: "metrics:snapshot"; data: MetricsSnapshotData }
  | { type: "metrics:trade-close"; data: MetricsTradeCloseData }
  | { type: "system:shutdown"; data: SystemShutdownData }
  | { type: "pending_bucket.updated"; data: PendingBucketUpdatedData }
  | { type: "pending_bucket.graduated"; data: PendingBucketGraduatedData }
  // ─── Wave 4: lifecycle gate evaluation (Wave 2 carry-forward) ───────
  | { type: "lifecycle:gate_evaluated"; data: LifecycleGateEvaluatedData }
  // ─── Operator-dashboard events (typed for exhaustiveness) ───────────
  | { type: "production:mode-changed"; data: ProductionModeChangedData }
  | { type: "production:drift-detection-completed"; data: ProductionDriftDetectionCompletedData }
  | { type: "production:reconciliation-completed"; data: ProductionReconciliationCompletedData }
  | { type: "compute:failover-state-change"; data: ComputeFailoverStateChangeData }
  | { type: "network:failover-state-change"; data: NetworkFailoverStateChangeData }
  | { type: "strategy:compliance_blocked"; data: StrategyComplianceBlockedData }
  | { type: "strategy:assignment_collision"; data: StrategyAssignmentCollisionData }
  | { type: "compliance:collaborative_trading_warning"; data: ComplianceCollaborativeTradingWarningData }
  | { type: "lifecycle:operator_absent_autopromoted"; data: LifecycleOperatorAbsentAutopromovedData }
  | { type: "paper:entry-blocked-production-halt"; data: PaperEntryBlockedProductionHaltData }
  | { type: "paper:order-blocked-outage"; data: PaperOrderBlockedOutageData }
  | { type: "paper:order-blocked-suspension"; data: PaperOrderBlockedSuspensionData }
  | { type: "paper:kill-switch-threshold-tripped"; data: PaperKillSwitchThresholdTrippedData }
  | { type: "paper:force-flatten-all"; data: PaperForceFlattenAllData }
  | { type: "broker:order_routed"; data: BrokerOrderRoutedData }
  | { type: "pine_export:hmac_persist_failed"; data: PineExportHmacPersistFailedData }
  | { type: "pine_export:recipient_generated"; data: PineExportRecipientGeneratedData }
  | { type: "pine_export:delivered"; data: PineExportDeliveredData }
  | { type: "pending_bucket.expired"; data: PendingBucketExpiredData }
  | { type: "auction:imbalance-updated"; data: AuctionImbalanceUpdatedData }
  | { type: "scout-health:reject-spike"; data: ScoutHealthRejectSpikeData }
  | { type: "scout-health:no-strategies-today"; data: ScoutHealthNoStrategiesTodayData }
  | { type: "prop-firm:snapshot-captured"; data: PropFirmSnapshotCapturedData }
  | { type: "prop-firm:suspension-detected"; data: PropFirmSuspensionDetectedData }
  | { type: "prop-firm:suspension-cleared"; data: PropFirmSuspensionClearedData }
  | { type: "vp:levels-computed"; data: VpLevelsComputedData }
  | { type: "windows:health-check-failed"; data: WindowsHealthCheckFailedData }
  | { type: "windows:health-check-ram-warning"; data: WindowsHealthCheckRamWarningData }
  | { type: "windows:real-reboot-pending"; data: WindowsRealRebootPendingData }
  | { type: "compliance:violation_detected"; data: ComplianceViolationDetectedData }
  | { type: "migration:legacy_firm_cleanup_complete"; data: MigrationLegacyFirmCleanupCompleteData }
  | { type: "firm_count_changed"; data: FirmCountChangedData }
  | { type: "paper:tp1_filled"; data: PaperExitTp1FilledData }
  | { type: "paper:tp2_filled"; data: PaperExitTp2FilledData }
  | { type: "paper:be_stop_moved"; data: PaperExitBeStopMovedData }
  | { type: "paper:trail_tightened"; data: PaperExitTrailTightenedData }
  | { type: "paper:time_stop_flattened"; data: PaperExitTimeStopFlattenedData }
  | { type: "paper:handler_error"; data: PaperExitHandlerErrorData }
  | { type: "a-plus-auditor:scan-complete"; data: APlusAuditorScanCompleteData }
  | { type: "nemo:scenario-generated"; data: NemoScenarioGeneratedData }
  | { type: "nemo:scenario-error"; data: NemoScenarioErrorData }
  | { type: "strategy:assigned"; data: StrategyAssignedData }
  | { type: "strategy:unassigned"; data: StrategyUnassignedData }
  // ─── Wave 8: graveyard burial terminal event ──────────────────
  | { type: "strategy:graveyard_burial"; data: StrategyGraveyardBurialData }
  // ─── Wave 9-2: Pine export server-side failure ────────────────
  | { type: "pine_export:failed"; data: PineExportFailedServerData }
  // ─── Wave 9-3: Walk-forward window progress ───────────────────
  | { type: "walkforward:window_complete"; data: WalkforwardWindowCompleteData }
  // ─── Wave 9-3: Compliance drift detection ─────────────────────
  | { type: "compliance:drift_detected"; data: ComplianceDriftDetectedData }
  // ─── Wave 23 Track C: bias engine + A+ gate (2026-05-19) ───────
  | { type: "bias_engine:strategy_selected"; data: BiasEngineStrategySelectedData }
  | { type: "signal:a_plus_rejected"; data: SignalAPlusRejectedData }
  // ─── Deep-scan #12 Track R: Safety-critical events (sticky persistent toast) ──
  | { type: "kill_switch:dll_force_close"; data: KillSwitchDllForceCloseData }
  | { type: "kill_switch:layer_halted"; data: KillSwitchLayerHaltedData }
  | { type: "kill_switch:c1_cme_eval_failed"; data: KillSwitchC1CmeEvalFailedData }
  | { type: "quantum_rl:kill_switch_engaged"; data: QuantumRlKillSwitchEngagedData }
  | { type: "exchange:outage-detected"; data: ExchangeOutageDetectedData }
  | { type: "broker:degraded"; data: BrokerDegradedData }
  | { type: "risk:dd_velocity_autopause"; data: RiskDdVelocityAutopauseData }
  | { type: "paper:position-stop-breached"; data: PaperPositionStopBreachedData }
  | { type: "paper:auto_restart_exhausted"; data: PaperAutoRestartExhaustedData }
  | { type: "fill_reconciliation:drift_detected"; data: FillReconciliationDriftDetectedData }
  | { type: "fill_reconciliation:unmatched_fill"; data: FillReconciliationUnmatchedFillData }
  // ─── Deep-scan #12 Track R: Operationally-significant events (warning/info toast) ──
  | { type: "exchange:outage-resolved"; data: ExchangeOutageResolvedData }
  | { type: "risk:dd_velocity_warning"; data: RiskDdVelocityWarningData }
  | { type: "PAPER_PARITY_DEGRADED"; data: PaperParityDegradedData }
  | { type: "backtest:truthiness_failure"; data: BacktestTruthinessFailureData }
  | { type: "compliance:rejected"; data: ComplianceRejectedData }
  | { type: "signal:macro_gate_eval_failed"; data: SignalMacroGateEvalFailedData }
  | { type: "paper:auto_restarted"; data: PaperAutoRestartedData }
  // ─── Deep-scan #12 Track R: Dot-normalized events (colon form — server updated) ──
  | { type: "monte_carlo:trades_fallback_used"; data: MonteCarloTradesFallbackUsedData }
  | { type: "pending_bucket:killed"; data: PendingBucketKilledData }
  // ─── Deep-scan #15 FIX-3 (H4): Wave 29 catalog completeness ────────────
  | { type: "signal:shadow_logged"; data: SignalShadowLoggedData }
  | { type: "lifecycle:pbo_evaluated"; data: LifecyclePboEvaluatedData }
  | { type: "lifecycle:shadow_divergence_evaluated"; data: LifecycleShadowDivergenceEvaluatedData }
  | { type: "signal:rl_ab_routed"; data: SignalRlAbRoutedData }
  | { type: "quantum_rl:training_completed"; data: QuantumRlTrainingCompletedData }
  // ─── Deep-scan #17 Wave 2 (2026-07-05): server-only advisory events ────
  | { type: "alert:broker_error_budget"; data: AlertBrokerErrorBudgetData }
  | { type: "alert:path_c_error"; data: AlertPathCErrorData }
  | { type: "alert:regime_coverage_gap"; data: AlertRegimeCoverageGapData }
  | { type: "alert:webhook_latency_high"; data: AlertWebhookLatencyHighData }
  | { type: "backtest:completion_write_failed"; data: BacktestCompletionWriteFailedData }
  | { type: "bias_engine:refreshed"; data: BiasEngineRefreshedData }
  | { type: "bias_engine:session_start"; data: BiasEngineSessionStartData }
  | { type: "factory:candidate_backtest_enqueued"; data: FactoryCandidateBacktestEnqueuedData }
  | { type: "factory:graduation_entry_quality"; data: FactoryGraduationEntryQualityData }
  | { type: "factory:multi_market_bucket"; data: FactoryMultiMarketBucketData }
  | { type: "fill_reconciliation:fill_ingested"; data: FillReconciliationFillIngestedData }
  | { type: "fill_reconciliation:reconcile_cleared"; data: FillReconciliationReconcileClearedData }
  | { type: "lifecycle:dsl_guards_evaluated"; data: LifecycleDslGuardsEvaluatedData }
  | { type: "macro:regime-updated"; data: MacroRegimeUpdatedData }
  | { type: "risk:dd_velocity_vacation_auto_recovered"; data: RiskDdVelocityVacationAutoRecoveredData }
  | { type: "signal:weighted_score_rejected"; data: SignalWeightedScoreRejectedData }
  | { type: "strategy:exportability_infra_error"; data: StrategyExportabilityInfraErrorData }
  | { type: "tradingview:marker-received"; data: TradingviewMarkerReceivedData }
  | { type: "windows:health-check-auto-resumed"; data: WindowsHealthCheckAutoResumedData };

export type SSEEventType = SSEEvent["type"];

/**
 * Helper: pick the data shape for a given event name. Lets call sites declare
 * `SSEEventData<"strategy:deploy-ready">` instead of digging through the union.
 */
export type SSEEventData<T extends SSEEventType> = Extract<SSEEvent, { type: T }>["data"];
