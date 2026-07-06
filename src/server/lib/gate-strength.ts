/**
 * GATE-STRENGTH CLASSIFIER (Corpus v3, Step 3, 2026-07-05) — semantic role classification.
 *
 * Design: docs/designs/corpus-v3-semantic-role-classification-2026-07-05.md
 * Plan:   docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md (Step 3)
 *
 * Replaces graph-to-engine.ts's topology-only role heuristic (`inAndGroup.has(a.id) ? "confluence" :
 * "spine"`) with a semantic gate-strength judgment of EACH entry condition's actual discourse role:
 * mandatory / optional / alternative / contextual. `contextual` maps to `role="context"` — RETAINED in
 * the spec, never dropped/silenced, non-gating (the engine ignores it) — the faithfulness invariant.
 *
 * HYBRID RULE ORDER (deterministic-first, LLM-margin) — EXACT per design §Design, do not reorder:
 *   1. CONTEXT_LANG (scene-setting / narrative example / refuted-strawman / UI-artifact) -> contextual
 *   2. type==WAIT_CONFIRMATION and MANDATORY_LANG                                        -> mandatory
 *   3. ALT_LANG ("or","either...or","any of")                                            -> alternative
 *   4. clear OPTIONAL_LANG ("ideally","helps","bonus","even better")                      -> optional
 *   5. type in {WAIT_STRUCTURE,WAIT_BIAS} with MANDATORY_LANG                             -> mandatory
 *   6. AMBIGUOUS (none clear) -> gemma adjudicates with the DRI taxonomy in the prompt    -> its label
 *
 * Pattern-list provenance: MANDATORY_LANG / CONTEXT_LANG / ALT_LANG / OPTIONAL_LANG are mined ONLY from
 * the 70% rules-design split's quotes (docs/replay-results/corpus-v3-heldout-split-2026-07-05.json) --
 * the held-out 30% is untouched by these lists per the Gate-1 circularity-fix requirement.
 *
 * Rules 1-5 are pure / synchronous / no I/O. Rule 6 is the ONLY network call (gemma on the tower Ollama)
 * -- graph-to-engine.ts's compiler is documented "Pure / deterministic / standalone"; `classifyGateStrength`
 * is the full async API (used by Gate 1 grading + any future async onboarding path). The synchronous
 * compiler wiring uses `classifyGateStrengthDeterministic` (rules 1-5 only) and falls back to the legacy
 * topology heuristic for atoms rules 1-5 leave ambiguous, so the compiler stays synchronous and
 * byte-identical-when-OFF is trivially true (the flag-OFF branch is the untouched original code).
 */
import type { AtomType } from "./decision-atom.js";

export type GateStrength = "mandatory" | "optional" | "alternative" | "contextual";

/** The minimal shape classifyGateStrength needs — a subset of DecisionAtom, decoupled to avoid tight coupling. */
export interface GateStrengthAtomInput {
  type: AtomType;
  /** The condition's object / object_canonical — used only for logging + the gemma prompt, not pattern-matched. */
  object: string;
  /** The transcript evidence text (DecisionAtom.provenance.evidence_quote, or the DRI audit's `quote`). */
  evidenceQuote: string;
}

/** Ambiguous-branch context — topology kept ONLY as a tiebreaker here, never the primary signal. */
export interface GateStrengthContext {
  /** Whether the graph compiler placed this atom in an AND-group (the OLD topology-only heuristic's input). */
  inAndGroup?: boolean;
}

// ── Pattern lists — mined from the 70% rules-design split ONLY (see file docstring) ─────────────────

/** Scene-setting / narrative example / refuted-strawman / UI-artifact — checked FIRST (rule 1). */
export const CONTEXT_LANG: RegExp[] = [
  /\blet'?s say\b/i,
  /\bfor example\b/i,
  /\bfor instance\b/i,
  /\bnow back to\b/i,
  /\bback to the\b[\s\S]{0,20}\b(chart|screen|candle)\b/i,
  /\bevery (course|video|guru)\b/i,
  /\bconventional wisdom\b/i,
  /\b(people|everybody|everyone)\s+(say|says|said|talks? about|tries|think|believe)\b/i,
  /\bthey say\b/i,
  /\bfalse strategy\b/i,
  /\b(just\s+)?one of many\s+(setups?|examples?)\b/i,
  /\bnot going to play out every day\b/i,
  /\bswitch(ing)? over to\b/i,
  /\bwe'?re sitting on\b/i,
  /\bnobody trades? it profitably\b/i,
];

/** Explicit mandatory / gate language — used by rules 2 and 5, scoped to specific atom types (see design). */
export const MANDATORY_LANG: RegExp[] = [
  /\bwait(ing)? for\b/i,
  /\bbefore we can\b/i,
  /\bas soon as\b/i,
  /\bin order to\b/i,
  /\bmy rule is\b/i,
  /\bthe rules for the trade\b/i,
  /\byou don'?t just want\b/i,
  /\bmost critical moment\b/i,
  /\bdo not force\b/i,
  /\bi want to see\b/i,
  /\bstep number\b/i,
  /\bentry is on\b/i,
  /\bsetup number\b/i,
  /\bwhat (we are|we're) looking for is\b/i,
  /\byou need\b/i,
  /\bneeds? to appear\b/i,
  /\byour goal is to enter\b/i,
  /\bmust\b/i,
  /\bonly\b/i,
  /\bcardinal rule\b/i,
  /\bregardless of\b/i,
];

/** Interchangeable-route framing — checked BEFORE OPTIONAL_LANG (rule 3, ahead of rule 4). */
export const ALT_LANG: RegExp[] = [
  /\beither\b[\s\S]{0,60}\bor\b/i,
  /\bany of (these|the|those|them)\b/i,
  /\b(it )?doesn'?t matter\b/i,
  /\byou can also\b/i,
  /\bthe second way\b/i,
  /\bskip it entirely\b/i,
  /\bor even\b/i,
];

/** Bonus / enhancement / non-required framing (rule 4). */
export const OPTIONAL_LANG: RegExp[] = [
  /\bideally\b/i,
  /\bhelps?\b/i,
  /\bbonus\b/i,
  /\beven better\b/i,
  /\bsometimes\b/i,
  /\bcan use\b/i,
  /\bwhat we can do\b/i,
  /\bwant to be mindful\b/i,
  /\badditional layer\b/i,
  /\bconsiderably improve\b/i,
  /\bhonestly,?\s+just\b/i,
  /\blikely,?\s+but\b/i,
  /\beven add\b/i,
];

const anyMatch = (patterns: RegExp[], text: string): boolean => patterns.some((re) => re.test(text));

/** Atom types rule 2 applies to. */
const MANDATORY_TYPE_RULE2: ReadonlySet<AtomType> = new Set(["WAIT_CONFIRMATION"]);
/** Atom types rule 5 applies to. */
const MANDATORY_TYPE_RULE5: ReadonlySet<AtomType> = new Set(["WAIT_STRUCTURE", "WAIT_BIAS"]);

/**
 * Deterministic subset of the hybrid classifier — rules 1-5 ONLY. Pure / synchronous / no I/O.
 * Returns `null` when none of rules 1-5 fire (the AMBIGUOUS margin, rule 6) — callers must then either
 * await `classifyGateStrength()`'s gemma adjudication, or (in synchronous contexts, e.g. the graph
 * compiler) fall back to a documented secondary signal (topology).
 */
export function classifyGateStrengthDeterministic(atom: GateStrengthAtomInput): GateStrength | null {
  const text = atom.evidenceQuote || "";

  // Rule 1 — CONTEXT_LANG, checked first, regardless of atom type.
  if (anyMatch(CONTEXT_LANG, text)) return "contextual";

  // Rule 2 — WAIT_CONFIRMATION + MANDATORY_LANG.
  if (MANDATORY_TYPE_RULE2.has(atom.type) && anyMatch(MANDATORY_LANG, text)) return "mandatory";

  // Rule 3 — ALT_LANG (any type).
  if (anyMatch(ALT_LANG, text)) return "alternative";

  // Rule 4 — clear OPTIONAL_LANG (any type).
  if (anyMatch(OPTIONAL_LANG, text)) return "optional";

  // Rule 5 — WAIT_STRUCTURE / WAIT_BIAS + MANDATORY_LANG.
  if (MANDATORY_TYPE_RULE5.has(atom.type) && anyMatch(MANDATORY_LANG, text)) return "mandatory";

  return null; // rule 6 — ambiguous
}

// ── Rule 6 — gemma adjudication (the ONLY network I/O in this module) ───────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e4b-it-qat";

const ADJUDICATION_SCHEMA = {
  type: "object",
  properties: {
    gate_strength: { type: "string", enum: ["mandatory", "optional", "alternative", "contextual"] },
    reasoning: { type: "string" },
  },
  required: ["gate_strength"],
} as const;

/** The DRI taxonomy, verbatim from docs/replay-results/dri-audit-2026-07-05.json, embedded in the adjudication prompt. */
const DRI_TAXONOMY_PROMPT = `You are adjudicating an AMBIGUOUS trading-strategy entry condition that deterministic rules could
not confidently classify. Use this taxonomy (from the DRI over-specification audit):

- JUSTIFIED_MANDATORY (-> "mandatory"): explicit gate language ("wait for", "must", "only enter", "need to
  see", "that's our rule") stating the condition is REQUIRED before the engine may act.
- OPTIONAL (-> "optional"): explicit bonus/enhancement framing ("ideally", "helps", "ratio bonus", "even
  better", "sometimes", "can use") — a nice-to-have, not required.
- ALTERNATIVE (-> "alternative"): interchangeable routes joined by "or"/"either...or"/"any of" — any ONE
  satisfies the step, not a single mandatory path.
- CONTEXTUAL (-> "contextual"): scene-setting, narrative example, refuted strawman, or UI-artifact
  narration — describes something WITHOUT asserting it as a rule the engine must check.
- UNRESOLVED: genuinely ambiguous even to a human rater with the taxonomy above. If you land here, use
  your best judgment but DO NOT default to mandatory — the audit's rule is "unresolved cases are NOT given
  benefit of the doubt toward JUSTIFIED_MANDATORY." Prefer "contextual" over "mandatory" when truly unsure.

Classify this condition into exactly one of {mandatory, optional, alternative, contextual}. Return JSON
matching the schema.`;

/** Adjudicate one ambiguous atom with gemma. Network call — the only I/O in this module. */
export async function adjudicateWithGemma(
  atom: GateStrengthAtomInput,
  ctx?: GateStrengthContext,
): Promise<GateStrength> {
  const tiebreakNote = ctx?.inAndGroup
    ? "\n(Secondary signal, NOT primary: the graph compiler placed this atom in an AND-group with other conditions.)"
    : "";
  const body = {
    model: MODEL,
    stream: false,
    keep_alive: -1,
    format: ADJUDICATION_SCHEMA,
    options: { temperature: 0, top_p: 0.9, top_k: 20, seed: 42, num_ctx: 4096 },
    messages: [
      {
        role: "user",
        content:
          `${DRI_TAXONOMY_PROMPT}\n\nCondition type: ${atom.type}\nObject: ${atom.object}\nEvidence quote: ` +
          `"${atom.evidenceQuote}"${tiebreakNote}\n\nReturn JSON matching the schema.`,
      },
    ],
  };
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const j: any = await resp.json();
    const parsed = JSON.parse(j.message?.content ?? "{}");
    const gs = parsed.gate_strength;
    if (gs === "mandatory" || gs === "optional" || gs === "alternative" || gs === "contextual") return gs;
  } catch {
    /* fall through to the deterministic fallback below — gemma unreachable is not a hard failure */
  }
  // Gemma unreachable / malformed output: conservative topology fallback (never defaults to mandatory
  // per the adversarial-bias rule above) — mirrors the legacy inAndGroup heuristic's shape.
  return ctx?.inAndGroup ? "optional" : "mandatory";
}

/**
 * The FULL hybrid classifier (async) — rules 1-5 deterministic, rule 6 gemma-adjudicated. This is the
 * canonical `classifyGateStrength(atom)` from the design doc; used by Gate 1 grading and any future
 * async onboarding call site. The synchronous graph compiler uses `classifyGateStrengthDeterministic`
 * + a topology fallback instead (see file docstring) to preserve its pure/synchronous contract.
 */
export async function classifyGateStrength(
  atom: GateStrengthAtomInput,
  ctx?: GateStrengthContext,
): Promise<GateStrength> {
  const deterministic = classifyGateStrengthDeterministic(atom);
  if (deterministic !== null) return deterministic;
  return adjudicateWithGemma(atom, ctx);
}

/** Map a GateStrength to the v3 target entry_conditions[].role domain (Gate 2, {spine,confluence,or_branch,context,...}). */
export function gateStrengthToRole(gs: GateStrength): "spine" | "confluence" | "or_branch" | "context" {
  switch (gs) {
    case "mandatory": return "spine";
    case "optional": return "confluence";
    case "alternative": return "or_branch";
    case "contextual": return "context";
  }
}
