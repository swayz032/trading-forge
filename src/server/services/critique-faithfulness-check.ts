/**
 * critique-faithfulness-check.ts — Wave 1: faithfulness verification for the
 * per-trade critique analyst.
 *
 * Enforces the FAITHFULNESS RULE defined in
 * src/agents/kb/attribution-methodology.md: an attribution dimension may only
 * carry a MATERIAL weight (>= 0.10) if the underlying data field that evidences
 * it is actually present (non-null) in the trade input. A material weight on
 * absent data is a confabulation flag, not a finding.
 *
 * This closes the "confabulated but confident" failure mode directly (evidence
 * file R11; arXiv 2605.27773 CoT-faithfulness; arXiv 2602.14233; arXiv 2512.02261
 * TradeTrap): a frontier model can be right about the grade and wrong about WHY.
 * Also verifies every parameter_hint.field is in the rubric whitelist.
 *
 * ADVISORY-ONLY (challenger governance): this NEVER re-grades, NEVER blocks
 * persistence, and NEVER touches a live-trading control. Gated on
 * CRITIQUE_FAITHFULNESS_CHECK=true in trade-critique-service.ts; when the flag
 * is off it is a no-op.
 */

// ─── Materiality threshold ─────────────────────────────────────────────────────

/** A dimension weighted at/above this must have its evidencing field present. */
export const MATERIAL_WEIGHT_THRESHOLD = 0.1;

// ─── Dimension → evidencing input field (canonical mapping, mirrors card A) ────

type Presence = (input: FaithfulnessInput) => boolean;

const ATTRIBUTION_FIELD_MAP: Record<string, { field: string; present: Presence }> = {
  regime:     { field: "context.regime_at_entry",           present: (i) => notNull(i.context?.regime_at_entry) },
  structure:  { field: "context.structure_state",           present: (i) => notNull(i.context?.structure_state) },
  narrative:  { field: "context.narrative_phase",           present: (i) => notNull(i.context?.narrative_phase) },
  confluence: { field: "context.confluence_factors_active", present: (i) => notNull(i.context?.confluence_factors_active) },
  decay:      { field: "context.confluence_factors_active", present: (i) => notNull(i.context?.confluence_factors_active) },
  liquidity:  { field: "context.nearest_liquidity_level",   present: (i) => notNull(i.context?.nearest_liquidity_level) },
  // fill + exit_plan are ALWAYS recorded on a paper_position — either field suffices.
  fill:       { field: "position.fill_probability", present: (i) => notNull(i.position?.fill_probability) || notNull(i.position?.slippage) },
  exit_plan:  { field: "position.exit_reason",      present: (i) => notNull(i.position?.exit_reason) },
};

/** Rubric-whitelisted parameter_hint fields (trade-critique.md §Parameter Hint). */
export const PARAMETER_HINT_WHITELIST = new Set<string>([
  "stop_multiplier",
  "tp1_r",
  "tp2_r",
  "min_factors_satisfied",
  "atr_period",
  "killzone_window",
]);

// ─── Loose input typing ────────────────────────────────────────────────────────

interface FaithfulnessInput {
  position?: {
    fill_probability?: unknown;
    slippage?: unknown;
    exit_reason?: unknown;
    [k: string]: unknown;
  } | null;
  context?: {
    regime_at_entry?: unknown;
    structure_state?: unknown;
    narrative_phase?: unknown;
    confluence_factors_active?: unknown;
    nearest_liquidity_level?: unknown;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

// Accepts either the raw parsed critique ({ technical_diagnosis, ... }) or the
// validated shape ({ td, ... }). Both are tolerated defensively.
interface ParsedCritiqueLike {
  technical_diagnosis?: unknown;
  td?: unknown;
  [k: string]: unknown;
}

function notNull(v: unknown): boolean {
  return v !== null && v !== undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ─── Main check ────────────────────────────────────────────────────────────────

export interface FaithfulnessResult {
  supported: boolean;
  flags: string[];
}

/**
 * Check a parsed critique against its trade input for faithfulness.
 *
 * @param parsedCritique - raw parsed LLM critique OR validated { td, pes } shape.
 * @param llmInput       - the exact input object passed to the model.
 * @returns { supported, flags } — `supported` is true iff flags is empty.
 */
export function checkCritiqueFaithfulness(
  parsedCritique: ParsedCritiqueLike,
  llmInput: FaithfulnessInput,
): FaithfulnessResult {
  const flags: string[] = [];

  // Resolve technical_diagnosis from either shape.
  const td =
    (isRecord(parsedCritique?.technical_diagnosis) && parsedCritique.technical_diagnosis) ||
    (isRecord(parsedCritique?.td) && parsedCritique.td) ||
    null;

  if (!td) {
    // Nothing to check against — treat as unsupported (nothing to attribute).
    return { supported: false, flags: ["technical_diagnosis missing — cannot verify faithfulness"] };
  }

  // 1. Attribution faithfulness: material weight requires evidencing field present.
  const attribution = isRecord(td.attribution) ? td.attribution : null;
  if (attribution) {
    for (const [dim, spec] of Object.entries(ATTRIBUTION_FIELD_MAP)) {
      const raw = attribution[dim];
      const weight = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      if (weight >= MATERIAL_WEIGHT_THRESHOLD && !spec.present(llmInput)) {
        flags.push(
          `attribution.${dim} weighted ${weight} but ${spec.field} missing`,
        );
      }
    }
  }

  // 2. parameter_hint.field must be in the rubric whitelist.
  const hint = td.parameter_hint;
  if (isRecord(hint)) {
    const field = hint.field;
    if (typeof field === "string" && !PARAMETER_HINT_WHITELIST.has(field)) {
      flags.push(
        `parameter_hint.field "${field}" not in whitelist (${[...PARAMETER_HINT_WHITELIST].join(", ")})`,
      );
    }
  }

  return { supported: flags.length === 0, flags };
}
