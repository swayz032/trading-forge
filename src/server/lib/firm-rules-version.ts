/**
 * Firm-rule version fingerprinting for stage-aware drift detection.
 *
 * The canonical input is src/shared/firm-stage-rules.json. It includes the
 * evaluation, funded, payout, and live rule stages, so a payout-only change
 * cannot be missed by a version stamp or be mistaken for an evaluation rule.
 */

import { createHash } from "node:crypto";
import { FIRM_STAGE_RULES } from "../../shared/firm-stage-rules.js";

/** Produce sorted-key JSON with no whitespace, matching Python json.dumps. */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedKeyReplacer);
}

function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = (value as Record<string, unknown>)[key];
    }
    return sorted;
  }
  return value;
}

function versionFor(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * Hash an explicit stage rule book. Exported for deterministic parity tests.
 */
export function computeFirmRulesVersionFromStageRules(
  stageRules: Record<string, unknown>,
): string {
  return versionFor({ FIRM_STAGE_RULES: stageRules });
}

/**
 * Backward-compatible generic dictionary hash helper. It remains useful for
 * tests and callers that need to fingerprint arbitrary legacy projections;
 * production rules use computeFirmRulesVersionFromStageRules instead.
 */
export function computeFirmRulesVersionFromDicts(
  firmConfigs: Record<string, unknown>,
  firmRules: Record<string, unknown>,
): string {
  return versionFor({ FIRM_CONFIGS: firmConfigs, FIRM_RULES: firmRules });
}

/** Current production version stamped on new backtests and checked by MC. */
export function computeFirmRulesVersion(): string {
  return computeFirmRulesVersionFromStageRules(
    FIRM_STAGE_RULES as unknown as Record<string, unknown>,
  );
}
