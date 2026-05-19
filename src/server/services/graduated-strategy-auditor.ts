/**
 * Graduated-Strategy Auditor (Pass 21, 2026-05-12)
 *
 * Stateless rule engine that validates a graduated strategy's config blob
 * against CLAUDE.md §4 framework + §13 Don't rules. Used at four enforcement
 * layers (layered defense — bugs caught at any layer block the bad strategy
 * from reaching the backtest engine):
 *
 *   1. Graduator self-audit (`direct-bucket-graduator.ts`)
 *      — reject DSL with defects before INSERT into strategies table
 *
 *   2. Pre-backtest gate (`agent-service.ts` / backtest enqueue)
 *      — refuse to queue a backtest job for a strategy that has audit defects
 *        (catches drift from manual UI edits / SQL mutations / migrations)
 *
 *   3. Daily drift-detection cron (`scheduler.ts`)
 *      — runs across the whole graduated library; Discord alert on any defect
 *
 *   4. CI / vitest tests
 *      — assert live library has zero defects + auditor itself catches both
 *        known-good and known-bad fixture configs (prevents regressions in
 *        the audit rules themselves — see fixture comment below)
 *
 * KNOWN-BAD FIXTURE-PROTECTION: First version of the deep-scan script (the
 * one used to GENERATE this auditor) had a path bug — it read fields from
 * `config.strategy.time_stop` instead of the actual `config.time_stop`. That
 * produced 96 fake defects on a clean library. The vitest tests now lock in
 * the correct paths: known-good fixture must produce 0 defects, known-bad
 * fixture must produce the expected defects. Future agents who refactor this
 * file will see tests fail loudly if they touch the wrong path.
 */

export type DefectCode =
  | "B3_FIXED_POINT_STOP"
  | "B4_TIME_STOP_MISSING"
  | "B6_MES_CAP_EXCEEDED"
  | "B7_MINI_WITHOUT_FLAG"
  | "C1_DUPLICATE_FINGERPRINT"
  | "D1_GENERIC_NAME"
  | "D3_UNKNOWN_ENTRY_TYPE"
  | "E1_REGIME_GATE_DISABLED"
  | "POSITION_SIZE_TYPE_WRONG";

export type WarningCode =
  | "A2_INDICATOR_TYPE_MISMATCH"
  | "A3_PARAM_OUT_OF_RANGE"
  | "B1_STOP_MULTIPLIER_HIGH"
  | "B2_STOP_MULTIPLIER_LOW"
  | "B5_PERSONAL_DLL_DRIFT"
  | "B6_BASE_CONTRACTS_NON_4"
  | "E1_NO_PREFERRED_REGIME"
  | "E2_SESSION_FILTER_NOT_RTH";

export interface AuditFinding<T extends string = string> {
  code: T;
  message: string;
}

export interface AuditResult {
  defects: AuditFinding<DefectCode>[];
  warnings: AuditFinding<WarningCode>[];
  passed: boolean; // true if defects.length === 0
}

// ─── Framework constants (CLAUDE.md §4) ─────────────────────────────────────

const MINI_SYMBOLS = new Set(["ES", "NQ", "CL"]);

const TYPE_INDICATOR_COMPAT: Record<string, RegExp> = {
  session_pattern: /opening_range_breakout|session_open_breakout|orb|vwap|volume_profile|pivot/i,
  breakout: /breakout|inside_bar|nr4|squeeze|fvg|liquidity_sweep|ict|smc/i,
  trend_follow: /ema|sma|macd|supertrend|adx|crossover|pullback/i,
  mean_reversion: /rsi|bollinger|stochastic|williams|squeeze|fade|reversion/i,
  volatility_expansion: /atr|donchian|keltner|breakout/i,
  event_driven: /news|fomc|cpi|nfp|inventory|earnings/i,
};

const PERIOD_BOUNDS: Record<string, [number, number]> = {
  ema: [5, 200],
  sma: [5, 200],
  rsi: [2, 21],
  atr: [7, 21],
  bollinger: [10, 30],
  macd: [5, 26],
  adx: [7, 21],
};

const GENERIC_NAME_PATTERNS = [
  /^(futures|trading)_strategy(_\d+)?$/i,
  /^method_\d+$/i,
  /^pattern_\d+$/i,
  /^unknown(_strategy)?$/i,
  /\b(strategy|method|approach)\b\s*$/i,
];

function checkIndicatorPeriod(name: string, value: unknown): string | null {
  const n = String(name).toLowerCase();
  const bounds = Object.entries(PERIOD_BOUNDS).find(([k]) => n.includes(k));
  if (!bounds || typeof value !== "number") return null;
  const [, [lo, hi]] = bounds;
  if (value < lo || value > hi) return `param ${name}=${value} outside sane range [${lo}, ${hi}]`;
  return null;
}

// ─── Main auditor ───────────────────────────────────────────────────────────

export interface AuditInput {
  conceptName: string;     // canonical concept_name (snake_case)
  symbol: string;          // MES / MNQ / MCL / ES / NQ / CL
  config: any;             // strategies.config blob
  // Optional: when set, C1 is checked against this duplicate-fingerprint signal.
  // Pre-existing strategy IDs sharing the same fingerprint cause a defect.
  duplicateFingerprintOf?: string | null;
}

export function auditGraduatedConfig(input: AuditInput): AuditResult {
  const defects: AuditFinding<DefectCode>[] = [];
  const warnings: AuditFinding<WarningCode>[] = [];

  const c = input.config ?? {};
  const cn = String(input.conceptName ?? "").toLowerCase();
  const strat = c?.strategy ?? {};
  const market = input.symbol;

  // ─── A. Semantic correctness ─────────────────────────────────────────────

  const entryType: string = c?.entry_type ?? "";
  const entryIndicator: string = strat?.indicators?.[0]?.type ?? strat?.entry_indicator ?? "";

  if (entryType && entryType !== "unknown") {
    const compat = TYPE_INDICATOR_COMPAT[entryType];
    if (compat && entryIndicator && !compat.test(entryIndicator) && !compat.test(cn)) {
      warnings.push({
        code: "A2_INDICATOR_TYPE_MISMATCH",
        message: `entry_indicator='${entryIndicator}' may not match entry_type='${entryType}' (concept: ${cn})`,
      });
    }
  }

  const entryParams = c?.entry_params ?? {};
  for (const [k, v] of Object.entries(entryParams)) {
    const err = checkIndicatorPeriod(k, v);
    if (err) warnings.push({ code: "A3_PARAM_OUT_OF_RANGE", message: err });
  }

  // ─── B. Framework compliance ────────────────────────────────────────────

  const sl = strat?.stop_loss ?? {};
  if (sl?.type !== "atr") {
    defects.push({
      code: "B3_FIXED_POINT_STOP",
      message: `stop_loss.type='${sl?.type}' (must be 'atr' — NO fixed-point stops per CLAUDE.md §13)`,
    });
  } else {
    const mult = Number(sl?.multiplier ?? 0);
    if (mult < 1.5) {
      warnings.push({
        code: "B2_STOP_MULTIPLIER_LOW",
        message: `stop multiplier=${mult} < 1.5× ATR floor (CLAUDE.md §4)`,
      });
    } else if (mult > 5) {
      warnings.push({
        code: "B1_STOP_MULTIPLIER_HIGH",
        message: `stop multiplier=${mult} suspiciously high — verify against pt ceiling`,
      });
    }
  }

  // time_stop lives at TOP-LEVEL of config (NOT under strategy.*) — auditor
  // path-bug regression test fixture exists for this exact reason.
  const ts = c?.time_stop ?? {};
  if (ts?.type !== "hard_flatten" || ts?.flat_at !== "15:55 ET") {
    defects.push({
      code: "B4_TIME_STOP_MISSING",
      message: `time_stop=${JSON.stringify(ts)} (must be hard_flatten @ 15:55 ET)`,
    });
  }

  const ps = strat?.position_size ?? {};
  // Wave 10 + W23F-live-fix (2026-05-19): risk_derived_pyramid is the current canonical type;
  // profit_tier_pyramid kept for backward-compat with pre-Wave-10 strategies in the library.
  const VALID_POSITION_SIZE_TYPES = new Set(["risk_derived_pyramid", "profit_tier_pyramid"]);
  if (!VALID_POSITION_SIZE_TYPES.has(String(ps?.type))) {
    defects.push({
      code: "POSITION_SIZE_TYPE_WRONG",
      message: `position_size.type='${ps?.type}' (must be one of: risk_derived_pyramid, profit_tier_pyramid)`,
    });
  } else {
    const dll = Number(ps?.personal_dll_pct ?? 0);
    if (Math.abs(dll - 0.67) > 0.02) {
      warnings.push({
        code: "B5_PERSONAL_DLL_DRIFT",
        message: `personal_dll_pct=${dll} (expected ~0.67)`,
      });
    }
    const base = Number(ps?.base_contracts ?? 0);
    const cap = Number(ps?.max_contracts ?? 0);
    if (market === "MES" && base !== 4) {
      warnings.push({
        code: "B6_BASE_CONTRACTS_NON_4",
        message: `base_contracts=${base} (CLAUDE.md §4 default = 4 MES)`,
      });
    }
    if (market === "MES" && cap > 30) {
      defects.push({
        code: "B6_MES_CAP_EXCEEDED",
        message: `max_contracts=${cap} > 30 MES cap`,
      });
    }
  }

  if (MINI_SYMBOLS.has(market)) {
    const cclass = c?.metadata?.contract_class ?? "";
    if (cclass !== "mini") {
      defects.push({
        code: "B7_MINI_WITHOUT_FLAG",
        message: `symbol='${market}' is a MINI but contract_class!='mini' — CLAUDE.md §5 BLOCKER (10x silent risk inflation)`,
      });
    }
  }

  // ─── C. Replay / D. False-positive checks ───────────────────────────────

  if (input.duplicateFingerprintOf) {
    defects.push({
      code: "C1_DUPLICATE_FINGERPRINT",
      message: `concept fingerprint already used by strategy ${input.duplicateFingerprintOf}`,
    });
  }

  for (const pat of GENERIC_NAME_PATTERNS) {
    if (pat.test(cn)) {
      defects.push({
        code: "D1_GENERIC_NAME",
        message: `concept_name '${cn}' matches generic-template pattern ${pat}`,
      });
      break;
    }
  }

  if (entryType === "unknown") {
    defects.push({
      code: "D3_UNKNOWN_ENTRY_TYPE",
      message: `entry_type='unknown' (deriveEntryType should have resolved a category)`,
    });
  }

  // ─── E. Compliance gates ────────────────────────────────────────────────

  const regimeGate = c?.regime_gate ?? {};
  if (!regimeGate?.enabled) {
    defects.push({
      code: "E1_REGIME_GATE_DISABLED",
      message: `regime_gate.enabled !== true (CLAUDE.md §13 — every strategy must have regime tag)`,
    });
  } else if (!regimeGate?.preferred_regime) {
    warnings.push({
      code: "E1_NO_PREFERRED_REGIME",
      message: `regime_gate enabled but no preferred_regime set`,
    });
  }

  const sessionFilter = c?.session_filter ?? {};
  if (!sessionFilter?.enabled || sessionFilter?.session !== "RTH_ONLY") {
    warnings.push({
      code: "E2_SESSION_FILTER_NOT_RTH",
      message: `session_filter=${JSON.stringify(sessionFilter)} (expected enabled+RTH_ONLY)`,
    });
  }

  return { defects, warnings, passed: defects.length === 0 };
}

/** Convenience: format an AuditResult for log messages. */
export function formatAuditResult(r: AuditResult): string {
  const parts: string[] = [];
  if (r.defects.length) parts.push(`DEFECTS(${r.defects.length}): ${r.defects.map((d) => d.code).join(", ")}`);
  if (r.warnings.length) parts.push(`WARNINGS(${r.warnings.length}): ${r.warnings.map((w) => w.code).join(", ")}`);
  return parts.join(" | ") || "PASS";
}
