/**
 * jsonb-shapes.ts — TypeScript shapes for JSONB columns in paper trading tables.
 *
 * These interfaces describe the validated shapes of JSONB config columns.
 * They are NOT enforced by Drizzle at the DB level — they are runtime contracts
 * used by paper-signal-service, paper-execution-service, and related code.
 *
 * All fields optional unless noted. Unknown keys are tolerated (strict subsets only).
 *
 * IMPORTANT: When adding fields here, keep in sync with any Python callers that
 * read session.config from the DB (paper_sessions.config JSONB).
 */

// ─── Paper Session Config Shape ─────────────────────────────────────────────

/**
 * Shape of paper_sessions.config JSONB column.
 *
 * Populated when a paper session is created via POST /api/paper-sessions.
 * All fields are optional; absent fields fall back to per-firm or global defaults.
 */
export interface PaperSessionConfigShape {
  /** Strategy side for new entries. Default: from strategy DSL. */
  side?: "long" | "short";

  /** Cooldown bars after position close before re-entry allowed. Default: 4. */
  cooldown_bars?: number;

  /** Daily loss budget in dollars for governor state machine. Default: 500. */
  daily_loss_budget?: number;

  /** Whether news blackout windows are bypassed. Default: false. */
  bypass_news_blackout?: boolean;

  /** Fill model enabled (realistic latency + partial fill simulation). Default: true. */
  fillModelEnabled?: boolean;

  /** Simulated execution latency in ms. Default: 150. */
  latencyMs?: number;

  /** Firm key override (e.g. "topstep", "mffu"). Falls back to session.firmId. */
  firm_key?: string;

  // ── F-5: Topstep trailing-DD config ──────────────────────────────────────
  /**
   * Topstep trailing drawdown amount in dollars.
   * Resolution order (paper-signal-service):
   *   1. session.config.trailing_dd_amount  (this field)
   *   2. TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor]  (from firm-config.ts)
   *   3. 2000  (50K Topstep combine hard default)
   *
   * Set this when running a non-50K Topstep account or after a rule change.
   * Absent = use table lookup (preferred — avoids stale hardcoded values).
   */
  trailing_dd_amount?: number;
}
