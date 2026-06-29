/**
 * carter/tool-registry.ts — canonical registry of Carter voice-agent read tools.
 *
 * Carter is an ElevenLabs ConvAI voice assistant that can call Trading Forge
 * Express endpoints to answer operator questions in real time. All tools in
 * this registry are READ-ONLY (Tier "green") — they surface state but never
 * mutate it. Tier "red" tools (mutations) are declared here for future
 * completeness but have NO handler path and MUST NOT be dispatched.
 *
 * Naming convention: snake_case, starts with a letter, matches ^[a-z][a-z0-9_]*$
 *
 * Adding a tool:
 *   1. Add a CarterTool entry here (with tier + handler key).
 *   2. Add a matching function to carter-reads.ts (same key).
 *   3. The contract test enforces the registry↔handler map parity automatically.
 */

export type CarterTier = "green" | "yellow" | "red";

export interface CarterTool {
  /** Stable identifier used as the URL segment in POST /api/carter/:name */
  name: string;
  /** Human-readable description (for ElevenLabs agent config and docs) */
  description: string;
  /** Access tier — only "green" tools have a live handler today */
  tier: CarterTier;
  /**
   * Key in CARTER_READ_HANDLERS that dispatches this tool.
   * Must be undefined for tier "red" tools (no live handler).
   */
  handler?: string;
}

/** Ordered list of all registered Carter tools. */
export const CARTER_TOOLS: CarterTool[] = [
  // ── Read tools (Tier: green) ──────────────────────────────────────────────

  {
    name: "report_system_health",
    description: "Reports DB latency, Ollama reachability, Python pool saturation, and backtest concurrency.",
    tier: "green",
    handler: "report_system_health",
  },
  {
    name: "report_production_status",
    description: "Returns the six-question production dashboard: are we trading, P&L today, drawdown distance, kill switch layers, alerting status.",
    tier: "green",
    handler: "report_production_status",
  },
  {
    name: "report_switch_states",
    description: "Returns the current state of all Slumhouse Office switches: bot power, learning loop, vacation mode, recovery, live execution.",
    tier: "green",
    handler: "report_switch_states",
  },
  {
    name: "report_composite_health",
    description: "Returns the composite health verdict counts across all active strategies (DEPLOYED / PILOT / PAPER / DEPLOY_READY).",
    tier: "green",
    handler: "report_composite_health",
  },
  {
    name: "report_ab_comparison",
    description: "Returns the rolling 20-session Sharpe and P&L delta between the baseline and RL challenger sub-accounts.",
    tier: "green",
    handler: "report_ab_comparison",
  },
  {
    name: "report_pipeline_lifecycle",
    description: "Returns kitchen data (stage counts) and today's menu (active strategy dishes).",
    tier: "green",
    handler: "report_pipeline_lifecycle",
  },
  {
    name: "report_crib_today",
    description: "Returns the Slumhouse Crib dashboard summary: session P&L, open positions, drawdown remaining.",
    tier: "green",
    handler: "report_crib_today",
  },
  {
    name: "report_strategy_status",
    description: "Returns lifecycle state, gate evidence, blocking gate, and recent transitions for a named or ID-specified strategy.",
    tier: "green",
    handler: "report_strategy_status",
  },
  {
    name: "report_backtest_result",
    description: "Returns detailed backtest metrics (Sharpe, WFE, PBO, BIF, gate result) for a given backtest ID.",
    tier: "green",
    handler: "report_backtest_result",
  },
  {
    name: "report_montecarlo_survival",
    description: "Returns Monte Carlo survival metrics (probability of ruin CI, Sharpe P5/P50, max drawdown P95) for a backtest ID.",
    tier: "green",
    handler: "report_montecarlo_survival",
  },
  {
    name: "report_paper_session",
    description: "Returns the latest open paper trading session state (P&L, drawdown, trade count) for the active session.",
    tier: "green",
    handler: "report_paper_session",
  },
  {
    name: "report_pending_buckets",
    description: "Returns pending strategy buckets awaiting graduation from the scout pipeline.",
    tier: "green",
    handler: "report_pending_buckets",
  },
  {
    name: "report_recent_alerts",
    description: "Returns the most recent warning/critical audit log entries (last N rows, default 20).",
    tier: "green",
    handler: "report_recent_alerts",
  },
  {
    name: "query_audit_log",
    description: "Queries the audit log by action name or correlation ID (max 50 rows).",
    tier: "green",
    handler: "query_audit_log",
  },
  {
    name: "report_drawdown_status",
    description: "Returns current drawdown distance metrics: realized peak equity, current equity, distance to DLL in dollars and percent.",
    tier: "green",
    handler: "report_drawdown_status",
  },
];

/** Fast O(1) lookup by tool name. Returns undefined when not found. */
const _toolIndex = new Map<string, CarterTool>(
  CARTER_TOOLS.map((t) => [t.name, t])
);

export function getCarterTool(name: string): CarterTool | undefined {
  return _toolIndex.get(name);
}
