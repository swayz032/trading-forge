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
  {
    name: "get_current_issues",
    description: "Returns the live open-issue list from the proactive issue watcher (severity-sorted: critical first). Call this FIRST on connect to brief the operator on anything that needs attention.",
    tier: "green",
    handler: "get_current_issues",
  },

  // ── Action tools (Tier: green) — capital-SAFE, never bypass a gate ───────────

  {
    name: "run_backtest",
    description: "Runs a walk-forward backtest for a strategy (by ID). Strips compliance_mode/actor/trial_n_total — engine sets those. Returns backtestId and status. Returns system_busy if the concurrent cap is reached.",
    tier: "green",
    handler: "run_backtest",
  },
  {
    name: "run_walk_forward",
    description: "Explicit walk-forward backtest alias. Always uses mode=walkforward. Same guardrails as run_backtest.",
    tier: "green",
    handler: "run_walk_forward",
  },
  {
    name: "run_monte_carlo",
    description: "Runs a Monte Carlo survival simulation for a completed backtest. Always evaluates against Topstep 50K and MFFU 50K firms — B14 gate requires both. Returns mcRunId.",
    tier: "green",
    handler: "run_monte_carlo",
  },
  {
    name: "run_matrix",
    description: "Runs a parameter matrix sweep for a strategy. Returns matrixId. Use to generate variants for the critic review.",
    tier: "green",
    handler: "run_matrix",
  },
  {
    name: "fire_scout_cycle",
    description: "Fires a single autonomous scout research cycle (fire-and-forget, 3-10 min). Returns paused if pipeline is stopped. Does NOT force past the pause — operator must resume first.",
    tier: "green",
    handler: "fire_scout_cycle",
  },
  {
    name: "research_strategy_idea",
    description: "Searches across Brave, Tavily, Exa, and Parallel.ai for strategy ideas matching a query. Returns the top 5 results and provider breakdown.",
    tier: "green",
    handler: "research_strategy_idea",
  },
  {
    name: "competitive_intel",
    description: "Multi-provider competitive intelligence search on a topic (trader methodology, institutional edge, quant approach). Returns the top 5 results.",
    tier: "green",
    handler: "competitive_intel",
  },
  {
    name: "scan_youtube_for_setups",
    description: "Searches YouTube Data API for day-trading videos matching a topic. Returns candidate list (title+URL) only — does NOT extract transcripts. Feed results to the scout cycle for processing.",
    tier: "green",
    handler: "scan_youtube_for_setups",
  },
  {
    name: "deposit_pending_mention",
    description: "Deposits a strategy concept mention into the pending scout bucket (never the strict grading path). Requires conceptName, market (MES/MNQ/MCL), sourceUrl, and layer (web/youtube/reddit).",
    tier: "green",
    handler: "deposit_pending_mention",
  },
  {
    name: "evaluate_kill_signal",
    description: "Evaluates a sequence of backtest attempt metrics and returns a kill signal verdict (catastrophic_risk / no_edge / wrong_direction / unprofitable / flat_improvement / below_tier3 / null=keep going) plus the current stage and prompt.",
    tier: "green",
    handler: "evaluate_kill_signal",
  },
];

/** Fast O(1) lookup by tool name. Returns undefined when not found. */
const _toolIndex = new Map<string, CarterTool>(
  CARTER_TOOLS.map((t) => [t.name, t])
);

export function getCarterTool(name: string): CarterTool | undefined {
  return _toolIndex.get(name);
}
