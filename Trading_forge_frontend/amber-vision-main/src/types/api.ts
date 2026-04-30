// ─────────────────────────────────────────────────────────────────────────
// FRONTEND DB TYPES — kept in sync with `src/shared/db-types.ts` on the server
// ─────────────────────────────────────────────────────────────────────────
// Source of truth: `<repo>/src/shared/db-types.ts`, which derives all row
// shapes via Drizzle's `typeof <table>.$inferSelect` from
// `<repo>/src/server/db/schema.ts`.
//
// The frontend lives in a separate workspace with its own tsconfig and
// cannot import from the server's source tree directly. Until the workspace
// is unified, this file is the canonical mirror — copy the inferred shapes
// here, and never let column drift go uncorrected.
//
// # Drift policy
// When you add or rename a column on the server:
//   1. Update `<repo>/src/server/db/schema.ts` (the table definition).
//   2. The shared `db-types.ts` updates automatically via $inferSelect.
//   3. PATCH THE MATCHING INTERFACE BELOW in the same PR.
// Silent drift here has caused real production bugs (e.g. the `source`
// column from migration 0045 was missing for two months before audit).
//
// # JSON serialization quirks
// - Drizzle returns `numeric` as `string` to preserve precision.
// - Drizzle returns `timestamp` as `Date` server-side; JSON serializes
//   to ISO 8601 string. The interfaces below use `string` for timestamps.
// - `jsonb` columns are typed `any`/`Record<string, any>` here for
//   pragmatism. Apply Zod or narrowing at the route boundary.
//
// # Mutation response shapes
// For mutating-route response shapes (POST/PATCH endpoints), import the
// `<RouteName>Response` interface from the route file directly. See
// `src/server/lib/api-contracts.ts` for the contract pattern. Do NOT
// redeclare response shapes here.
// ─────────────────────────────────────────────────────────────────────────

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string;
  config: Record<string, any>;
  lifecycleState: string;
  lifecycleChangedAt: string | null;
  preferredRegime: string | null;
  rollingSharpe30d: string | null;
  forgeScore: string | null;
  tags: string[] | null;
  searchBudgetUsed: number | null;
  parentStrategyId: string | null;
  generation: number;
  source: string | null;                       // migration 0045 — origin: ollama|openclaw|manual|n8n|evolved
  createdAt: string;
  updatedAt: string;
}

export interface Backtest {
  id: string;
  strategyId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  status: string;
  totalReturn: string | null;
  sharpeRatio: string | null;
  maxDrawdown: string | null;
  winRate: string | null;
  profitFactor: string | null;
  totalTrades: number | null;
  avgTradePnl: string | null;
  avgDailyPnl: string | null;
  forgeScore: string | null;
  tier: string | null;
  equityCurve: any;
  monthlyReturns: any;
  dailyPnls: any;
  config: any;
  walkForwardResults: any;
  propCompliance: any;
  decayAnalysis: {
    halfLifeDays: number | null;
    compositeScore: number;
    decaying: boolean;
    trend: "improving" | "accelerating_decline" | "stable";
    decayDetected: boolean;
    signals: Record<string, any>;
  } | null;
  runReceipt: any;
  sanityChecks: any;
  crossValidation: any;
  gateResult: any;
  gateRejections: any;
  resultExtras: any | null;                    // migration 0053 — governor, analytics, bootstrap_ci_95, etc.
  errorMessage: string | null;
  executionTimeMs: number | null;
  createdAt: string;
}

export interface BacktestTrade {
  id: string;
  backtestId: string;
  entryTime: string;
  exitTime: string | null;
  direction: string;
  entryPrice: string;
  exitPrice: string | null;
  pnl: string | null;
  contracts: number;
  commission: string | null;
  slippage: string | null;
  mae: string | null;
  mfe: string | null;
  holdDurationMs: number | null;
}

export interface MonteCarloRun {
  id: string;
  backtestId: string;
  numSimulations: number;
  maxDrawdownP5: string | null;
  maxDrawdownP50: string | null;
  maxDrawdownP95: string | null;
  sharpeP5: string | null;
  sharpeP50: string | null;
  sharpeP95: string | null;
  probabilityOfRuin: string | null;
  var95: string | null;
  var99: string | null;
  cvar95: string | null;
  paths: any;
  riskMetrics: any;
  executionTimeMs: number | null;
  gpuAccelerated: boolean;
  createdAt: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  metadata: any;
  acknowledged: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  input: any;
  result: any;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  decisionAuthority: string | null;            // gate | human | agent | scheduler | n8n
  correlationId: string | null;                // migration 0054 — HTTP req correlation id
  createdAt: string;
}

export interface CriticOptimizationRun {
  id: string;
  strategyId: string;
  backtestId: string;
  status: string;
  candidatesGenerated: number | null;
  survivorCandidateId: string | null;
  survivorBacktestId: string | null;
  parentCompositeScore: string | null;
  survivorCompositeScore: string | null;
  evidenceSources: any;
  evidencePacket: any;
  compositeWeights: any;
  executionTimeMs: number | null;
  completedAt: string | null;
  createdAt: string;
}

export interface StrategyExport {
  id: string;
  strategyId: string;
  exportType: string;                          // pine_indicator | pine_strategy | alert_only
  pineVersion: string | null;
  exportabilityScore: string | null;
  exportabilityDetails: any;
  status: string;
  errorMessage: string | null;
  propOverlayFirm: string | null;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  strategyId: string | null;
  backtestId: string | null;
  source: string;
  generationPrompt: string | null;
  strategyCode: string | null;
  strategyParams: any;
  simulatedEquity: any;
  dailyPnls: any;
  forgeScore: string | null;
  propComplianceResults: any;
  performanceGateResult: any;
  tier: string | null;
  analystNotes: string | null;
  parentJournalId: string | null;
  status: string;
  createdAt: string;
}

export interface JournalStats {
  total: number;
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  bySource: Record<string, number>;
  passRate: number;
}

export interface ScoutFunnelResponse {
  days: number;
  by_source: Record<string, Record<string, number>>;
  totals: Record<string, number>;
}

/** Derived flat shape used by UI components */
export interface ScoutFunnel {
  scouted: number;
  tested: number;
  passed: number;
  deployed: number;
}

export interface AgentJob {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  input: any;
  result: any;
  status: string;
  durationMs: number | null;
  createdAt: string;
}

export interface PaperSession {
  id: string;
  strategyId: string | null;
  status: string;                              // active | stopped | paused
  mode: string;                                // paper | shadow
  firmId: string | null;                       // firm key, null = tightest defaults
  startedAt: string;
  stoppedAt: string | null;
  pausedAt: string | null;                     // pause/resume timestamp
  startingCapital: string;
  currentEquity: string;
  peakEquity: string;                          // for drawdown floor enforcement
  config: any;
  lastSignalTime: string | null;               // cooldown persistence
  cooldownUntil: string | null;                // cooldown persistence
  dailyPnlBreakdown: Record<string, any>;      // consistency tracking
  metricsSnapshot: Record<string, any>;        // rolling Sharpe + post-trade analytics
  totalTrades: number;                         // trade counter for promotion inputs
  createdAt: string;
}

export interface PaperPosition {
  id: string;
  sessionId: string;
  symbol: string;
  side: string;
  entryPrice: string;
  currentPrice: string | null;
  contracts: number;
  unrealizedPnl: string;
  entryTime: string;
  closedAt: string | null;
  arrivalPrice: string | null;                 // TCA — signal price before slippage
  implementationShortfall: string | null;      // TCA — cost of execution
  fillRatio: string | null;                    // TCA — intended vs filled
  trailHwm: string | null;                     // trail stop high-water mark
  barsHeld: number;                            // bars held counter (persisted)
  fillProbability: string | null;              // fill probability used at entry
  mae: string | null;                          // migration 0034 — Maximum Adverse Excursion
  mfe: string | null;                          // migration 0034 — Maximum Favorable Excursion
  previousUnrealizedPnl: string | null;        // FIX 2 — last committed unrealized P&L
}

export interface PaperTrade {
  id: string;
  sessionId: string;
  symbol: string;
  side: string;
  entryPrice: string;
  exitPrice: string;
  pnl: string;                                 // NET P&L (after commission)
  grossPnl: string | null;                     // pre-commission reference value
  commission: string | null;                   // round-trip commission cost
  contracts: number;
  entryTime: string;
  exitTime: string;
  slippage: string | null;
  mae: string | null;                          // maximum adverse excursion
  mfe: string | null;                          // maximum favorable excursion
  holdDurationMs: number | null;
  hourOfDay: number | null;                    // UTC hour of entry (0-23)
  dayOfWeek: number | null;                    // 0=Sun ... 6=Sat
  sessionType: string | null;                  // ASIA | LONDON | NY_OPEN | ...
  macroRegime: string | null;
  eventActive: boolean | null;                 // entry inside event blackout
  skipSignal: string | null;                   // TRADE | REDUCE | SKIP
  fillProbability: string | null;
  rollSpreadCost: string | null;               // migration 0056 — calendar spread cost across roll
  createdAt: string;
}

export interface MarketDataMeta {
  id: string;
  symbol: string;
  timeframe: string;
  earliestDate: string;
  latestDate: string;
  totalBars: number;
  s3Path: string | null;
  lastSyncAt: string | null;
}

export interface ComplianceRuleset {
  id: string;
  firm: string;
  accountType: string;
  status: string;
  driftDetected: boolean;
  retrievedAt: string;
}

export interface ComplianceDrift {
  id: string;
  firm: string;
  accountType: string;
  driftSummary: string | null;
  resolved: boolean;
  detectedAt: string;
}

export interface TournamentResult {
  id: string;
  tournamentDate: string;
  candidateName: string;
  finalVerdict: string;
  createdAt: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

export interface StrategyPipeline {
  total: number;
  byState: Record<string, number>;
}

export interface OhlcvBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
