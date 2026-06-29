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
  /** Access tier — "green" + "yellow" tools dispatch; "red" tools never do */
  tier: CarterTier;
  /**
   * Key in CARTER_READ_HANDLERS / CARTER_ACTION_HANDLERS / CARTER_CONFIRM_HANDLERS
   * that dispatches this tool. Explicitly `null` for tier "red" tools — they are
   * DOCUMENTED in the registry as the refusal surface but have NO tool path.
   */
  handler?: string | null;
  /**
   * JSON-Schema for the tool's request body. configure-agent.ts emits this as the
   * ElevenLabs `request_body_schema` so the agent KNOWS which arguments to collect
   * and SEND (e.g. research_reddit needs `topic`). Tools with no params omit this
   * and ship a clean empty-object schema. Attached below from CARTER_PARAMS_SCHEMAS.
   */
  paramsSchema?: Record<string, unknown>;
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

  // ── Introspection tools (Tier: green) — "knows every inch of Trading Forge" ──
  {
    name: "explain_gate",
    description: "Explains a Trading Forge hard gate in plain English (what it catches, lifecycle stage, live threshold). Knows B14 ci_high, WFE, PBO, parameter drift, B15, BIF, compliance enforce, frozen policy, shadow divergence, daily trade cap, lunch blackout, macro alignment, kill switch, A4 Frankenstein, A7 signal correlation. Accepts loose names. Params: { name }.",
    tier: "green",
    handler: "explain_gate",
  },
  {
    name: "list_subsystems",
    description: "Returns the bounded list of registered Trading Forge subsystems (name + category) from the system subsystem registry. No params.",
    tier: "green",
    handler: "list_subsystems",
  },
  {
    name: "summarize_subsystem",
    description: "Returns one subsystem's registry entry (domain, scope/description, routes, tables, audit actions). Params: { name }.",
    tier: "green",
    handler: "summarize_subsystem",
  },
  {
    name: "read_strategy_internals",
    description: "Returns a strategy's policy slice (lifecycle state, symbols, entry_quality, position_size, stop_loss, take_profit, exit_plan_config, use_weighted_scoring) from its config. Identify by id or name. Params: { strategyId, name }.",
    tier: "green",
    handler: "read_strategy_internals",
  },
  {
    name: "trace_correlation",
    description: "Traces one correlationId end-to-end: returns up to 50 audit_log events (action, status, time) in chronological order. Params: { correlationId }.",
    tier: "green",
    handler: "trace_correlation",
  },
  {
    name: "read_recent_decisions",
    description: "Returns the most recent lifecycle promotion/demotion decisions (strategy name, from-state, to-state, time), newest first. Params: { limit } (default 15, max 50).",
    tier: "green",
    handler: "read_recent_decisions",
  },
  {
    name: "read_system_map",
    description: "Reads the Trading Forge System Map. With a section name, returns the text under the best-matching heading (bounded); without one, returns the list of available headings. Params: { section }.",
    tier: "green",
    handler: "read_system_map",
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
    name: "competitive_intel",
    description: "Multi-provider competitive intelligence search on a topic (trader methodology, institutional edge, quant approach). Returns the top 5 results.",
    tier: "green",
    handler: "competitive_intel",
  },

  // ── STRATEGY lane (Wave 7) — strategies enter ONLY via YouTube extraction ────
  {
    name: "scan_youtube_for_setups",
    description: "STRATEGY LANE — YouTube discovery only. Searches YouTube Data API for day-trading videos matching a topic and returns a candidate list (title+URL). Does NOT extract transcripts. Pairs with extract_youtube_strategy: scan first, then extract a chosen video's strategy.",
    tier: "green",
    handler: "scan_youtube_for_setups",
  },
  {
    name: "extract_youtube_strategy",
    description: "STRATEGY LANE — the ONLY way a strategy enters the system. Takes a YouTube URL, runs the existing extraction pipeline on its transcript, and deposits the result into the pending scout bucket (never the strict path). Web/Reddit are NEVER used to source strategies. Params: { url }.",
    tier: "green",
    handler: "extract_youtube_strategy",
  },

  // ── RESEARCH lane (Wave 7) — NON-strategy research only ──────────────────────
  {
    name: "research_reddit",
    description: "RESEARCH LANE (non-strategy) — general Reddit community/sentiment/market research across finance subs (sort=relevance). Returns top posts + an LLM summary. Explicitly NOT a strategy source. Params: { topic }.",
    tier: "green",
    handler: "research_reddit",
  },
  {
    name: "institutional_research",
    description: "RESEARCH LANE (non-strategy) — top-tier institutional-grade research. Fans out across Brave (web), Exa (neural + research-paper whitepapers), Tavily (web), and Reddit in parallel with per-provider timeouts and graceful degradation, leaning to >=2025 sources, then synthesizes a cited brief. NEVER sources a trading strategy. Params: { question, includeParallel? }.",
    tier: "green",
    handler: "institutional_research",
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

  // ── Confirm-action tools (Tier: yellow) — propose/confirm voice protocol ─────
  // Each capability is a PAIR: propose_<x> reads back a summary + mints a token;
  // confirm_<x> verifies the token then calls the underlying service directly.
  // RISKY-BUT-REVERSIBLE only. Gates remain authoritative; nothing is forced.

  {
    name: "propose_toggle_bot_power",
    description: "Proposes pausing or resuming Trading Forge engine authority (ACTIVE/PAUSED). Returns a human read-back summary + a single-use confirmation token. Does NOT mutate.",
    tier: "yellow",
    handler: "propose_toggle_bot_power",
  },
  {
    name: "confirm_toggle_bot_power",
    description: "Executes a previously-proposed bot power toggle. Requires a valid confirmation token; calls setMode(ACTIVE|PAUSED) and audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_toggle_bot_power",
  },
  {
    name: "propose_set_learning_loop_mode",
    description: "Proposes setting the autonomous learning-loop mode (0=OFF, 1=OBSERVE, 2=AUTOPILOT). Returns a summary + token. Lowering to OFF/OBSERVE needs no token; raising to AUTOPILOT requires confirmation.",
    tier: "yellow",
    handler: "propose_set_learning_loop_mode",
  },
  {
    name: "confirm_set_learning_loop_mode",
    description: "Sets the learning-loop mode. Down-shift to OFF/OBSERVE executes without a token (GREEN); up-shift to AUTOPILOT requires a valid confirmation token (YELLOW). Audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_set_learning_loop_mode",
  },
  {
    name: "propose_toggle_vacation_mode",
    description: "Proposes turning operator-absent (vacation) mode on or off. Returns a summary + token. Does NOT mutate.",
    tier: "yellow",
    handler: "propose_toggle_vacation_mode",
  },
  {
    name: "confirm_toggle_vacation_mode",
    description: "Sets/clears system_state.operator_absent_since. Requires a valid confirmation token; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_toggle_vacation_mode",
  },
  {
    name: "propose_self_restart",
    description: "Proposes a graceful backend self-restart. Returns a summary + token. Does NOT restart.",
    tier: "yellow",
    handler: "propose_self_restart",
  },
  {
    name: "confirm_self_restart",
    description: "Triggers a graceful self-restart via the HMAC-signed /api/admin/self-restart endpoint. Requires a valid confirmation token; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_self_restart",
  },
  {
    name: "propose_trigger_n8n_workflow",
    description: "Proposes firing an n8n webhook workflow by its webhook path. Returns a summary + token. Cannot create/update/delete workflows (that is RED).",
    tier: "yellow",
    handler: "propose_trigger_n8n_workflow",
  },
  {
    name: "confirm_trigger_n8n_workflow",
    description: "Fires the n8n webhook at N8N_BASE_URL/webhook/<path>. Requires a valid confirmation token; webhook trigger paths only; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_trigger_n8n_workflow",
  },
  {
    name: "propose_run_quantum",
    description: "Proposes running the LOCAL quantum Monte Carlo survival simulation for a backtest. Returns a summary + token. Cloud QPU stays OFF.",
    tier: "yellow",
    handler: "propose_run_quantum",
  },
  {
    name: "confirm_run_quantum",
    description: "Runs runQuantumMC for a backtest with cloud OFF (challenger-only, advisory). Requires a valid confirmation token; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_run_quantum",
  },
  {
    name: "propose_request_lifecycle_check",
    description: "Proposes running the lifecycle sweep (auto-promotion + auto-demotion checks). Returns a summary + token. Does NOT mutate.",
    tier: "yellow",
    handler: "propose_request_lifecycle_check",
  },
  {
    name: "confirm_request_lifecycle_check",
    description: "Runs checkAutoPromotions + checkAutoDemotions. Honors pipeline pause. Requires a valid confirmation token; gates run inside; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_request_lifecycle_check",
  },
  {
    name: "propose_request_promotion",
    description: "Proposes promoting a strategy to a target lifecycle state. Returns a summary + token. The gates remain authoritative; nothing is forced.",
    tier: "yellow",
    handler: "propose_request_promotion",
  },
  {
    name: "confirm_request_promotion",
    description: "Calls lifecycleService.promoteStrategy with actor='voice_agent'. Gates run INSIDE; a gate block is RETURNED as the reason, never bypassed. Requires a valid confirmation token; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_request_promotion",
  },
  {
    name: "propose_rearm_scheduler_job",
    description: "Proposes re-enabling a disabled scheduler job. Returns a summary + token. Does NOT mutate.",
    tier: "yellow",
    handler: "propose_rearm_scheduler_job",
  },
  {
    name: "confirm_rearm_scheduler_job",
    description: "Re-enables a disabled scheduler job via enableJob(). Requires a valid confirmation token; audits carter.action_executed.",
    tier: "yellow",
    handler: "confirm_rearm_scheduler_job",
  },

  // ── RED tools (Tier: red) — DOCUMENTED refusal surface, NO tool path ─────────
  // These are listed so the registry positively documents what Carter will NEVER
  // do. handler is `null`. POST /api/carter/<name> returns 403 red_action_no_tool_path.
  // Capital-risk, gate-threshold, safety-disable, and destructive actions live here.

  { name: "enable_live_execution",   description: "RED — enable live order execution. No tool path; refused.", tier: "red", handler: null },
  { name: "place_live_order",        description: "RED — place a live broker order. No tool path; refused.", tier: "red", handler: null },
  { name: "open_position",           description: "RED — open a trading position. No tool path; refused.", tier: "red", handler: null },
  { name: "clear_kill_switch",       description: "RED — clear the production halt kill switch. No tool path; refused.", tier: "red", handler: null },
  { name: "clear_safety_autopause",  description: "RED — clear an AUTOPAUSE drawdown-velocity safety pause. No tool path; refused.", tier: "red", handler: null },
  { name: "clear_stuck_session",     description: "RED — force-clear a stuck paper/live session. No tool path; refused.", tier: "red", handler: null },
  { name: "delete_backtest",         description: "RED — delete a backtest record. No tool path; refused.", tier: "red", handler: null },
  { name: "delete_strategy",         description: "RED — delete a strategy. No tool path; refused.", tier: "red", handler: null },
  { name: "set_gate_threshold",      description: "RED — change a gate threshold (B14/WFE/PBO/DSR/payout). No tool path; refused.", tier: "red", handler: null },
  { name: "set_compliance_shadow",   description: "RED — switch backtest compliance to shadow mode. No tool path; refused.", tier: "red", handler: null },
  { name: "edit_framework_sizing",   description: "RED — edit framework sizing / risk parameters. No tool path; refused.", tier: "red", handler: null },
  { name: "enable_cloud_quantum",    description: "RED — enable IBM cloud quantum QPU. No tool path; refused.", tier: "red", handler: null },
  { name: "assign_rl_challenger",    description: "RED — assign an RL challenger to an account route. No tool path; refused.", tier: "red", handler: null },
  { name: "manage_n8n_workflow",     description: "RED — create/update/delete an n8n workflow. No tool path; refused.", tier: "red", handler: null },
  { name: "kasa_power_cycle",        description: "RED — remote Kasa power-cycle the tower. No tool path; refused.", tier: "red", handler: null },
  { name: "disable_safety_cron",     description: "RED — disable a safety cron (heartbeat, drift, recon). No tool path; refused.", tier: "red", handler: null },
];

/**
 * Request-body JSON-Schemas for the tools that take parameters. configure-agent.ts
 * reads `tool.paramsSchema` and registers it as the ElevenLabs `request_body_schema`
 * so the agent collects + SENDS these args. Names + requireds are derived from the
 * actual handler param reads (carter-reads.ts / carter-actions.ts). Tools NOT listed
 * here take no params and ship the clean empty-object schema. `token` (on confirm_*)
 * is the single-use confirmation token minted by the matching propose_ call.
 */
const _tokenProp = {
  token: {
    type: "string",
    description: "The single-use confirmation token returned by the matching propose_ call.",
  },
} as const;

export const CARTER_PARAMS_SCHEMAS: Record<string, Record<string, unknown>> = {
  // ── reads ──────────────────────────────────────────────────────────────────
  report_strategy_status: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Strategy UUID. Provide this OR name." },
      name: { type: "string", description: "Strategy name. Provide this OR strategyId." },
    },
    required: [],
    description: "Identify the strategy by id or name (one of the two).",
  },
  report_backtest_result: {
    type: "object",
    properties: { backtestId: { type: "string", description: "Backtest UUID to report." } },
    required: ["backtestId"],
  },
  report_montecarlo_survival: {
    type: "object",
    properties: { backtestId: { type: "string", description: "Backtest UUID whose Monte Carlo survival to report." } },
    required: ["backtestId"],
  },
  report_recent_alerts: {
    type: "object",
    properties: { limit: { type: "number", description: "How many recent alerts to return (default 20, max 100)." } },
    required: [],
  },
  query_audit_log: {
    type: "object",
    properties: {
      action: { type: "string", description: "Audit action name to filter by (e.g. 'lifecycle.promoted')." },
      correlationId: { type: "string", description: "Correlation ID to trace one event end-to-end." },
      limit: { type: "number", description: "Max rows (default 20, max 50)." },
    },
    required: [],
  },
  // ── introspection (green) ───────────────────────────────────────────────────
  explain_gate: {
    type: "object",
    properties: {
      name: { type: "string", description: "Gate name (loose match): e.g. 'B14', 'WFE', 'PBO', 'frozen policy', 'lunch blackout', 'kill switch', 'A4'." },
    },
    required: ["name"],
  },
  summarize_subsystem: {
    type: "object",
    properties: {
      name: { type: "string", description: "Subsystem id/name from the registry (e.g. 'strategy_lifecycle', 'quantum_rl_challenger')." },
    },
    required: ["name"],
  },
  read_strategy_internals: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Strategy UUID. Provide this OR name." },
      name: { type: "string", description: "Strategy name. Provide this OR strategyId." },
    },
    required: [],
    description: "Identify the strategy by id or name (one of the two).",
  },
  trace_correlation: {
    type: "object",
    properties: {
      correlationId: { type: "string", description: "The correlation ID to trace end-to-end through the audit log." },
    },
    required: ["correlationId"],
  },
  read_recent_decisions: {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many recent lifecycle decisions to return (default 15, max 50)." },
    },
    required: [],
  },
  read_system_map: {
    type: "object",
    properties: {
      section: { type: "string", description: "Optional heading to read (e.g. 'API Routes', 'Scheduler Jobs'). Omit to list all available headings." },
    },
    required: [],
  },
  // ── actions (green) ─────────────────────────────────────────────────────────
  run_backtest: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Strategy UUID to backtest." },
      mode: { type: "string", enum: ["single", "walkforward"], description: "Backtest mode; defaults to walkforward." },
    },
    required: ["strategyId"],
  },
  run_walk_forward: {
    type: "object",
    properties: { strategyId: { type: "string", description: "Strategy UUID to walk-forward backtest." } },
    required: ["strategyId"],
  },
  run_monte_carlo: {
    type: "object",
    properties: { backtestId: { type: "string", description: "Completed backtest UUID to run Monte Carlo survival on." } },
    required: ["backtestId"],
  },
  run_matrix: {
    type: "object",
    properties: { strategyId: { type: "string", description: "Strategy UUID to run a parameter matrix sweep on." } },
    required: ["strategyId"],
  },
  competitive_intel: {
    type: "object",
    properties: {
      topic: { type: "string", description: "What to research (trader methodology, institutional edge, quant approach)." },
      regime: { type: "string", description: "Optional market regime context." },
      market: { type: "string", description: "Optional market/symbol context (MES/MNQ/MCL)." },
    },
    required: ["topic"],
  },
  scan_youtube_for_setups: {
    type: "object",
    properties: { topic: { type: "string", description: "Day-trading topic to search YouTube for (e.g. 'ICT silver bullet ES')." } },
    required: ["topic"],
  },
  extract_youtube_strategy: {
    type: "object",
    properties: {
      url: { type: "string", description: "YouTube video URL to extract a strategy from." },
      title: { type: "string", description: "Optional video title for logging." },
    },
    required: ["url"],
  },
  research_reddit: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The Reddit research topic/question — NON-strategy (sentiment, community discussion, market/bot/growth). Never a strategy source." },
    },
    required: ["topic"],
  },
  institutional_research: {
    type: "object",
    properties: {
      question: { type: "string", description: "The institutional research question — NON-strategy (market structure, methodology, growth, compliance)." },
      includeParallel: { type: "boolean", description: "Optional: also run the deep Parallel.ai research provider." },
    },
    required: ["question"],
  },
  deposit_pending_mention: {
    type: "object",
    properties: {
      conceptName: { type: "string", description: "Strategy concept name (snake_case)." },
      market: { type: "string", description: "Target market: MES, MNQ, or MCL." },
      sourceUrl: { type: "string", description: "Source URL of the mention." },
      layer: { type: "string", enum: ["web", "youtube", "reddit"], description: "Discovery layer." },
    },
    required: ["conceptName", "market", "sourceUrl", "layer"],
  },
  evaluate_kill_signal: {
    type: "object",
    properties: {
      attempts: {
        type: "array",
        description: "Ordered list of backtest attempt metric objects to evaluate for a kill verdict.",
        items: { type: "object" },
      },
    },
    required: ["attempts"],
  },
  // ── yellow propose/confirm (confirm_* additionally require the token) ─────────
  propose_toggle_bot_power: {
    type: "object",
    properties: { mode: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Target engine authority; defaults to ACTIVE." } },
    required: [],
  },
  confirm_toggle_bot_power: {
    type: "object",
    properties: { mode: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Same target proposed." }, ..._tokenProp },
    required: ["token"],
  },
  propose_set_learning_loop_mode: {
    type: "object",
    properties: { mode: { type: "number", description: "Learning-loop mode: 0=OFF, 1=OBSERVE, 2=AUTOPILOT." } },
    required: ["mode"],
  },
  confirm_set_learning_loop_mode: {
    type: "object",
    properties: { mode: { type: "number", description: "Same mode proposed (0=OFF, 1=OBSERVE, 2=AUTOPILOT)." }, ..._tokenProp },
    required: ["mode", "token"],
  },
  propose_toggle_vacation_mode: {
    type: "object",
    properties: { on: { type: "boolean", description: "true = turn operator-absent (vacation) mode ON, false = OFF." } },
    required: ["on"],
  },
  confirm_toggle_vacation_mode: {
    type: "object",
    properties: { on: { type: "boolean", description: "Same value proposed." }, ..._tokenProp },
    required: ["on", "token"],
  },
  confirm_self_restart: { type: "object", properties: { ..._tokenProp }, required: ["token"] },
  propose_trigger_n8n_workflow: {
    type: "object",
    properties: { workflowWebhookPath: { type: "string", description: "The n8n webhook trigger path (no leading slash)." } },
    required: ["workflowWebhookPath"],
  },
  confirm_trigger_n8n_workflow: {
    type: "object",
    properties: { workflowWebhookPath: { type: "string", description: "Same path proposed." }, ..._tokenProp },
    required: ["workflowWebhookPath", "token"],
  },
  propose_run_quantum: {
    type: "object",
    properties: { backtestId: { type: "string", description: "Completed backtest UUID to run local quantum MC on." } },
    required: ["backtestId"],
  },
  confirm_run_quantum: {
    type: "object",
    properties: { backtestId: { type: "string", description: "Same backtest proposed." }, ..._tokenProp },
    required: ["backtestId", "token"],
  },
  confirm_request_lifecycle_check: { type: "object", properties: { ..._tokenProp }, required: ["token"] },
  propose_request_promotion: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Strategy UUID to promote." },
      toState: { type: "string", description: "Target lifecycle state (e.g. PAPER, DEPLOY_READY, PILOT)." },
    },
    required: ["strategyId", "toState"],
  },
  confirm_request_promotion: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Same strategy proposed." },
      toState: { type: "string", description: "Same target state proposed." },
      ..._tokenProp,
    },
    required: ["strategyId", "toState", "token"],
  },
  propose_rearm_scheduler_job: {
    type: "object",
    properties: { jobName: { type: "string", description: "The disabled scheduler job name to re-enable." } },
    required: ["jobName"],
  },
  confirm_rearm_scheduler_job: {
    type: "object",
    properties: { jobName: { type: "string", description: "Same job proposed." }, ..._tokenProp },
    required: ["jobName", "token"],
  },
};

// Attach the schemas onto the registry entries so configure-agent.ts (which reads
// `tool.paramsSchema`) registers them as ElevenLabs request_body_schema.
for (const _t of CARTER_TOOLS) {
  const _s = CARTER_PARAMS_SCHEMAS[_t.name];
  if (_s) _t.paramsSchema = _s;
}

/** Fast O(1) lookup by tool name. Returns undefined when not found. */
const _toolIndex = new Map<string, CarterTool>(
  CARTER_TOOLS.map((t) => [t.name, t])
);

export function getCarterTool(name: string): CarterTool | undefined {
  return _toolIndex.get(name);
}
