// Mirrors src/server/db/schema.ts — Drizzle returns numeric as string

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
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  startingCapital: string;
  currentEquity: string;
  config: any;
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
}

export interface PaperTrade {
  id: string;
  sessionId: string;
  symbol: string;
  side: string;
  entryPrice: string;
  exitPrice: string;
  pnl: string;
  contracts: number;
  entryTime: string;
  exitTime: string;
  slippage: string | null;
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
