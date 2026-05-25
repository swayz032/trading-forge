/**
 * compliance-mode.ts — Wave 27.5 Pass C.2 (paper-parity)
 *
 * Env-knob helper for compliance gate mode.
 *
 * Two modes:
 *   "shadow"  — log violations, do NOT block trades. Preserves pre-C.2 behavior.
 *               Use for novel-edge research backtests where you want to observe
 *               what would have happened without blocking the signal stream.
 *   "enforce" — block trades that would violate firm rules; emit Discord WARN per
 *               violation batch (>5% of attempted trades). INSTITUTIONAL DEFAULT
 *               per operator mandate. Promotion-candidate backtests MUST run in
 *               enforce mode to produce trustworthy P&L estimates.
 *
 * Resolution order (highest priority wins):
 *   1. per-backtest config field `compliance_mode` (explicit opt-out to "shadow")
 *   2. env var BACKTEST_COMPLIANCE_MODE
 *   3. hardcoded default "enforce"
 *
 * Design notes:
 *   - "shadow" mode is the RESEARCH ESCAPE HATCH. Research backtests must
 *     explicitly opt-out; silence means enforcement.
 *   - Changing this default from "shadow" (pre-C.2 implicit) to "enforce"
 *     (C.2 explicit) means pre-C.2 strategies backed by shadow-mode backtests
 *     WILL produce different block counts when re-run. This is intentional:
 *     those backtests were grading strategies with hidden compliance violations
 *     and producing unrealistically optimistic P&L estimates.
 *   - The previous env var was TF_BACKTEST_COMPLIANCE_MODE (Python-side).
 *     We keep BACKTEST_COMPLIANCE_MODE (no TF_ prefix) on the TS side to match
 *     the operator-facing convention for new env vars (TF_ is legacy).
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { logger } from "./logger.js";

export type ComplianceMode = "shadow" | "enforce";

const VALID_MODES: ReadonlySet<string> = new Set(["shadow", "enforce"]);

/**
 * Read the default compliance mode from BACKTEST_COMPLIANCE_MODE env var.
 * Returns "enforce" when env var is unset or invalid (institutional default).
 *
 * @returns "shadow" | "enforce"
 */
export function getDefaultComplianceMode(): ComplianceMode {
  const raw = process.env.BACKTEST_COMPLIANCE_MODE;
  if (raw === undefined || raw === "") return "enforce";
  const lower = raw.toLowerCase().trim();
  if (VALID_MODES.has(lower)) return lower as ComplianceMode;
  logger.warn(
    { raw, defaulted: "enforce" },
    "BACKTEST_COMPLIANCE_MODE has invalid value — using institutional default 'enforce'",
  );
  return "enforce";
}

/**
 * Resolve the effective compliance mode for a single backtest run.
 *
 * Per-backtest config wins over env var wins over hardcoded default.
 * A per-backtest "shadow" opt-in is the ONLY way to run research mode
 * without changing the env for all backtests.
 *
 * @param backtestConfig  The config object stored in backtests.config JSONB.
 *                        Should carry `compliance_mode?: "shadow" | "enforce"`.
 * @returns Resolved ComplianceMode with reason string for logging.
 */
export function resolveComplianceMode(backtestConfig: Record<string, unknown> | null | undefined): {
  mode: ComplianceMode;
  source: "per_backtest_config" | "env_var" | "institutional_default";
} {
  // Per-backtest config override is highest priority
  const configMode = backtestConfig?.["compliance_mode"];
  if (configMode !== undefined && configMode !== null) {
    const configStr = String(configMode).toLowerCase().trim();
    if (VALID_MODES.has(configStr)) {
      return { mode: configStr as ComplianceMode, source: "per_backtest_config" };
    }
    logger.warn(
      { configMode, defaulted: "enforce" },
      "backtestConfig.compliance_mode invalid — ignoring override, using env/default",
    );
  }

  // Env var is next
  const raw = process.env.BACKTEST_COMPLIANCE_MODE;
  if (raw !== undefined && raw !== "") {
    const lower = raw.toLowerCase().trim();
    if (VALID_MODES.has(lower)) {
      return { mode: lower as ComplianceMode, source: "env_var" };
    }
    logger.warn(
      { raw, defaulted: "enforce" },
      "BACKTEST_COMPLIANCE_MODE has invalid value — using institutional default 'enforce'",
    );
  }

  return { mode: "enforce", source: "institutional_default" };
}

/**
 * Determine whether a backtest config represents a research run that has
 * explicitly opted out of enforcement mode.
 *
 * Returns true ONLY when the per-backtest config carries an EXPLICIT
 * `compliance_mode: "shadow"` field. An env-var-based shadow override
 * does NOT qualify as a research-tagged backtest because it affects ALL
 * runs indiscriminately.
 *
 * Used by backtest-service to log the override at INSERT time so operators
 * can audit which backtests were run in shadow mode.
 *
 * @param backtestConfig  The config object stored in backtests.config JSONB.
 * @returns true when this is an explicitly-tagged research backtest.
 */
export function isResearchBacktest(backtestConfig: Record<string, unknown> | null | undefined): boolean {
  const configMode = backtestConfig?.["compliance_mode"];
  if (configMode === undefined || configMode === null) return false;
  return String(configMode).toLowerCase().trim() === "shadow";
}
