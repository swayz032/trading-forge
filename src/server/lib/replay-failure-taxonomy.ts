/**
 * REPLAY FAILURE TAXONOMY — turn "Replay FAIL" into "FAIL because X" (attribution, not pass/fail).
 *
 * Operator/GPT recommendation (2026-06-28): keep a PERMANENT failure taxonomy once replay exists, so failures
 * direct engineering effort. If most failures are VISUAL_DEPENDENCY → invest in multimodal extraction; if
 * COMPILER_DEFECT → fix the compiler; if EDUCATOR_AMBIGUITY → the limit is the source, not us.
 *
 * Pre-registered BEFORE replay (same discipline as the thresholds): defining the categories + their precedence
 * in advance prevents post-hoc rationalization of any individual failure. Each class is detected by an
 * instrument that ALREADY exists — this router just composes them in a fixed order (infra/data → compiler →
 * extraction → source), mirroring the freeze-harness attribution order so a deeper cause can't be mislabeled
 * as a shallower one.
 *
 * Pure / deterministic / standalone (zero production wiring). Fires only on a FAILED replay.
 */

import type { EvidenceMode } from "./evidence-mode.js";

export type ReplayFailureClass =
  | "DATA_REPLAY_LIMIT"    // historical data cannot reproduce the demonstration (rule out FIRST — like EXECUTION_DROP)
  | "COMPILER_DEFECT"      // extracted but IR construction lost it (Gate 1.5: entry_trigger MISSING) — not executable
  | "EXTRACTION_MISS"      // a taught decision-rule was never extracted (Gate 1.75: Missed) — strategy trades wrong
  | "VISUAL_DEPENDENCY"    // transcript insufficient without chart context (evidence_mode: VISUAL_REQUIRED)
  | "FRAMEWORK_MISMATCH"   // entry reproduced, but overlay (stop/TP/sizing) semantics differ from the educator
  | "EDUCATOR_AMBIGUITY"   // extraction faithful, but the SOURCE itself is non-deterministic
  | "UNKNOWN";             // root cause unresolved — never guess; an explicit bucket, not a default-blame

export interface ReplayFailureContext {
  demonstrated_bars_available: boolean; // false → the data can't reproduce it at all
  determinism_pass: boolean;            // Gate 1.5 — false = entry_trigger MISSING / AMBIGUOUS (not executable)
  completeness_missed: boolean;         // Gate 1.75 — a taught decision-rule absent
  evidence_mode: EvidenceMode;          // evidence_mode tag of the strategy
  framework_divergence: boolean;        // overlay-owned behavior (stop/TP/sizing) diverged from the educator
  source_ambiguous: boolean;            // the source taught discretionarily ("look for momentum") — faithful but vague
}

/**
 * Classify a FAILED replay into exactly one class, in a fixed precedence so a deeper cause is never
 * mislabeled as a shallower one: data → compiler → extraction → visual → framework → source → unknown.
 */
export function classifyReplayFailure(ctx: ReplayFailureContext): { failure_class: ReplayFailureClass; directs: string } {
  let failure_class: ReplayFailureClass;
  if (!ctx.demonstrated_bars_available) failure_class = "DATA_REPLAY_LIMIT";
  else if (!ctx.determinism_pass) failure_class = "COMPILER_DEFECT";       // Gate 1.5 already said it's not executable
  else if (ctx.completeness_missed) failure_class = "EXTRACTION_MISS";     // Gate 1.75 said a rule was dropped
  else if (ctx.evidence_mode === "VISUAL_REQUIRED") failure_class = "VISUAL_DEPENDENCY"; // chart-referential logic
  else if (ctx.framework_divergence) failure_class = "FRAMEWORK_MISMATCH"; // entry fine, overlay differs
  else if (ctx.source_ambiguous) failure_class = "EDUCATOR_AMBIGUITY";     // faithful extraction of a vague source
  else failure_class = "UNKNOWN";

  const DIRECTS: Record<ReplayFailureClass, string> = {
    DATA_REPLAY_LIMIT: "improve historical data coverage / pick demonstrations with available bars — not an extraction problem",
    COMPILER_DEFECT: "fix the compiler (e.g. the P1 confirmation-compiler quarantines) — the IR wasn't executable",
    EXTRACTION_MISS: "improve recall (the coverage/repair loop) — a taught decision was dropped",
    VISUAL_DEPENDENCY: "invest in MULTIMODAL extraction (chart context) — text alone is insufficient for this strategy class",
    FRAMEWORK_MISMATCH: "reconcile framework-overlay semantics with educator intent — the edge was fine, the management wasn't",
    EDUCATOR_AMBIGUITY: "source limitation — the educator did not teach deterministically; not fixable downstream of the source",
    UNKNOWN: "unresolved — escalate to manual investigation; do NOT default-blame a layer",
  };
  return { failure_class, directs: DIRECTS[failure_class] };
}

/** Aggregate a corpus of classified failures → where the next engineering investment should go (the payoff). */
export function dominantFailureClass(classes: ReplayFailureClass[]): { dominant: ReplayFailureClass | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
  let dominant: ReplayFailureClass | null = null, max = 0;
  for (const [c, n] of Object.entries(counts)) if (n > max) { max = n; dominant = c as ReplayFailureClass; }
  return { dominant, counts };
}
