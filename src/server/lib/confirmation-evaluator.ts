/**
 * CONFIRMATION EVALUATOR — Checkpoint 4 (integration: re-root the existing axes into ONE confirmation node).
 *
 * The 5 axes built across 2A-3B are MOVED here, not rewritten — they become the S5 Confirmation node's
 * evaluators rather than standalone compiler passes:
 *   - selection / anchor  (specificity-score: a named-level primary is higher-conviction)
 *   - multi-leg           (compound enforcement: primary_plus_confluence vs all_required)
 *   - strength            (confirmation-strength: clean vs weak — re-rooted, CALLED here)
 *   - context (eligibility) stays the PRECONDITION node (evaluateContextGates, 3A) — evaluated by the runtime
 *     before arming, NOT inside the confirmation node (it gates whether to look for a setup at all).
 *
 * CP4  acceptance: a SINGLE `evaluateConfirmation()` is called by BOTH the immediate (zero-wait) and the
 * wait-state runtime paths — observational equivalence, no duplicated confirmation logic. Returns rich
 * CONFIRMATION PROVENANCE (passed / contributors / blocked_by / confidence) so every entry is explainable.
 */

import { meetsStrengthRequirement, type StrengthFeatures } from "./confirmation-strength.js";
import { predicateLevelIsNamed } from "./specificity-score.js";
import type { Confidence, ConfirmationNode } from "./state-machine-ir.js";

/** Engine-computed per-bar inputs the confirmation axes read (the real OHLC→feature step is the engine-attach). */
export interface ConfirmationBarContext {
  strength_features?: StrengthFeatures;        // for the strength axis
  legs_satisfied?: Record<number, boolean>;    // which compound legs fired this bar, by leg.order
}

export interface ConfirmationResult {
  passed: boolean;
  contributors: string[]; // axes that contributed to a PASS (explainability)
  blocked_by: string[];   // reasons for a FAIL (explainability)
  confidence: Confidence; // from the confirmation node's provenance
  evidence?: string;
}

/**
 * Evaluate the S5 confirmation node against one bar's features. UNIFIED — the only confirmation code path.
 * Pure; deterministic. If strength features are absent the strength axis abstains (the engine supplies them).
 */
export function evaluateConfirmation(node: ConfirmationNode, ctx: ConfirmationBarContext): ConfirmationResult {
  const contributors: string[] = [];
  const blocked_by: string[] = [];
  const confidence = node.provenance.confidence;
  const compound = node.compound;
  if (!compound) return { passed: false, contributors, blocked_by: ["no_confirmation_compiled"], confidence };

  const primary = compound.legs.find((l) => l.order === compound.primary_order) ?? compound.legs[0];
  const sat = ctx.legs_satisfied ?? {};

  // ── multi-leg / enforcement axis ──────────────────────────────────────────────
  if (compound.enforcement === "all_required") {
    const unmet = compound.legs.filter((l) => sat[l.order] !== true);
    if (unmet.length) blocked_by.push(...unmet.map((l) => `leg_unmet:${l.kind}`));
    else contributors.push(`multi_leg:all_required(${compound.legs.length})`);
  } else {
    // primary_plus_confluence — only the primary firing is mandatory; confluences strengthen
    if (primary && sat[primary.order] !== true) blocked_by.push(`primary_leg_unmet:${primary.kind}`);
    else if (primary) contributors.push(`primary:${primary.kind}@${primary.level_ref ?? "?"}`);
    const conf = compound.legs.filter((l) => l.order !== primary?.order && sat[l.order] === true);
    if (conf.length) contributors.push(`confluence(${conf.length})`);
  }

  // ── selection / anchor axis ──────────────────────────────────────────────────
  if (primary && predicateLevelIsNamed(primary.level_ref)) contributors.push("anchor:named_level");

  // ── strength axis (re-rooted; CALLED here, not a separate pass) ───────────────
  const req = primary?.strength_requirement;
  if (req?.required) {
    if (ctx.strength_features) {
      if (meetsStrengthRequirement(req, ctx.strength_features)) contributors.push(`strength:>=${req.min}`);
      else blocked_by.push("weak_confirmation");
    } else {
      contributors.push("strength:abstain_no_features"); // engine will supply features at signal time
    }
  }

  return { passed: blocked_by.length === 0, contributors, blocked_by, confidence, evidence: node.provenance.evidence_quote };
}
