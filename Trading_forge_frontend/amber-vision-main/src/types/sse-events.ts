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
  | { type: "backtest:complete"; data: BacktestCompletedData }
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
  | { type: "system:shutdown"; data: SystemShutdownData };

export type SSEEventType = SSEEvent["type"];

/**
 * Helper: pick the data shape for a given event name. Lets call sites declare
 * `SSEEventData<"strategy:deploy-ready">` instead of digging through the union.
 */
export type SSEEventData<T extends SSEEventType> = Extract<SSEEvent, { type: T }>["data"];
