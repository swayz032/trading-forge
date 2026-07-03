/**
 * Track O (deepscan11, 2026-07-02) — Extraction grounding enforcement.
 *
 * Verifies that numeric params and mechanism terms extracted by the LLM are
 * actually present in the source transcript. Hallucinated numbers (e.g. "RSI 14"
 * when the speaker never mentioned 14) indicate the model invented params rather
 * than extracting them. These get quarantined rather than silently entering the
 * conveyor.
 *
 * Design:
 *   - Reuses normalize() + contentTokens() from extraction-coverage-gate.ts (no
 *     duplication of the digit-boundary split logic).
 *   - Pure function (no I/O) — testable without mocks.
 *   - Fail direction: on helper ERROR → fail-open (return "pass") so a bug in
 *     this function doesn't strangle the extraction conveyor. Mismatch → fail-closed.
 *
 * Status semantics:
 *   "pass"    — all numeric tokens grounded, or no numeric tokens extracted
 *   "partial" — some numeric tokens grounded (grounded_pct < 1.0)
 *   "reject"  — 0% of numeric tokens found in transcript (and ≥1 numeric token exists)
 *   "error"   — helper threw; caller should emit extraction.grounding_check_failed + fail-open
 *
 * Thresholds:
 *   grounded_pct == 0 AND num_candidates >= 1 → reject
 *   0 < grounded_pct < 1.0                    → partial
 *   grounded_pct == 1.0 OR num_candidates == 0 → pass
 */

import { normalize, contentTokens } from "./extraction-coverage-gate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroundingResult {
  status: "pass" | "partial" | "reject" | "error";
  /** Fraction of numeric candidate tokens found in transcript (0–1). */
  grounded_pct: number;
  /** Numeric tokens extracted from strategy that were NOT found in transcript. */
  failed_params: string[];
  /** Numeric tokens extracted from strategy (full set — both passed and failed). */
  all_candidates: string[];
  error?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Collect grounding-relevant text from a minimal-schema strategy object.
 * Targets: entry_sequence steps, confluences descriptions, stop/target rationales.
 * Does NOT look at legacy fields (entry_indicator, entry_condition) — those may
 * be absent in minimal-schema output.
 */
function collectStrategyText(strategy: Record<string, unknown>): string {
  const parts: string[] = [];

  // entry_sequence actions + rationales
  const entrySeq = Array.isArray(strategy["entry_sequence"])
    ? (strategy["entry_sequence"] as Array<Record<string, unknown>>)
    : [];
  for (const step of entrySeq) {
    if (typeof step["action"] === "string") parts.push(step["action"]);
    if (typeof step["rationale"] === "string") parts.push(step["rationale"]);
  }

  // confluences descriptions
  const confluences = Array.isArray(strategy["confluences"])
    ? (strategy["confluences"] as Array<Record<string, unknown>>)
    : [];
  for (const c of confluences) {
    if (typeof c["description"] === "string") parts.push(c["description"]);
    if (typeof c["name"] === "string") parts.push(c["name"]);
  }

  // stop rationale
  const stop = strategy["stop"] as Record<string, unknown> | undefined;
  if (stop && typeof stop["rationale"] === "string") parts.push(stop["rationale"]);

  // target rationales
  const targets = Array.isArray(strategy["targets"])
    ? (strategy["targets"] as Array<Record<string, unknown>>)
    : [];
  for (const t of targets) {
    if (typeof t["rationale"] === "string") parts.push(t["rationale"]);
  }

  // stop_management
  if (typeof strategy["stop_management"] === "string") parts.push(strategy["stop_management"]);

  // legacy fields present in DSL-shaped outputs (present during transition period)
  if (typeof strategy["entry_condition"] === "string") parts.push(strategy["entry_condition"]);
  if (typeof strategy["description"] === "string") parts.push(strategy["description"]);

  // entry_params / exit_params JSON string representations (values not keys)
  const extractParamValues = (params: unknown): void => {
    if (params && typeof params === "object") {
      for (const v of Object.values(params)) {
        if (typeof v === "number") parts.push(String(v));
        else if (typeof v === "string") parts.push(v);
      }
    }
  };
  extractParamValues(strategy["entry_params"]);
  extractParamValues(strategy["exit_params"]);

  return parts.join(" ");
}

/**
 * Extract numeric candidate tokens from strategy text.
 * A "numeric candidate" is any token that CONTAINS a digit (len≥2).
 * These are the values the LLM claimed to have read from the transcript
 * (e.g. "9", "21", "14", "1.5", "200").
 *
 * Excludes single-digit tokens to reduce noise (0-9 alone appear in almost
 * every transcript as step numbers, list indices, etc.).
 */
function extractNumericCandidates(strategyText: string): string[] {
  const tokens = contentTokens(strategyText);
  // Strip leading/trailing punctuation from each token before digit-check.
  // contentTokens splits on spaces but does NOT strip punctuation from token
  // edges — a sentence-final number like "below 30." yields "30." with an
  // attached period.  Stripping edges canonicalises "30." → "30" so it
  // matches "30" in the transcript without a false failure.
  const numerics = tokens
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter((t) => /\d/.test(t) && t.length >= 2);
  return [...new Set(numerics)];
}

/**
 * Check whether a candidate token (from the extraction) appears in the
 * normalized transcript. Uses substring matching after normalization so
 * "4-hour" matches "4hour" and "RSI14" matches "14".
 */
function isTokenGrounded(candidate: string, normalizedTranscript: string): boolean {
  const norm = normalize(candidate);
  if (!norm) return false;
  return normalizedTranscript.includes(norm);
}

/**
 * Check numeric grounding for a set of strategies against the source transcript.
 *
 * Per-strategy result — callers iterate strategies and apply per-strategy:
 * @param strategy  Minimal-schema strategy object (or any Record with text fields)
 * @param transcript  Raw transcript text (normalized internally)
 * @returns GroundingResult — status + grounded_pct + failed_params
 */
export function checkNumericGrounding(
  strategy: Record<string, unknown>,
  transcript: string,
): GroundingResult {
  try {
    if (!transcript || transcript.length < 50) {
      // No usable transcript → skip check (can't ground anything)
      return { status: "pass", grounded_pct: 1, failed_params: [], all_candidates: [] };
    }

    const strategyText = collectStrategyText(strategy);
    const candidates = extractNumericCandidates(strategyText);

    if (candidates.length === 0) {
      // No numeric params extracted — no hallucination risk from numbers
      // (e.g. a pure structure-based strategy with no periods/thresholds)
      return { status: "pass", grounded_pct: 1, failed_params: [], all_candidates: [] };
    }

    const normalizedTranscript = normalize(transcript);
    const failed: string[] = [];
    let groundedCount = 0;

    for (const candidate of candidates) {
      if (isTokenGrounded(candidate, normalizedTranscript)) {
        groundedCount++;
      } else {
        failed.push(candidate);
      }
    }

    const groundedPct = groundedCount / candidates.length;

    if (groundedPct === 0) {
      return {
        status: "reject",
        grounded_pct: 0,
        failed_params: failed,
        all_candidates: candidates,
      };
    }

    if (groundedPct < 1) {
      return {
        status: "partial",
        grounded_pct: groundedPct,
        failed_params: failed,
        all_candidates: candidates,
      };
    }

    return {
      status: "pass",
      grounded_pct: 1,
      failed_params: [],
      all_candidates: candidates,
    };
  } catch (err) {
    return {
      status: "error",
      grounded_pct: 0,
      failed_params: [],
      all_candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
