/**
 * GRAPH → ENGINE HANDOFF (2026-06-30) — translate the validated Decision Graph into the contract the
 * Python/Databento backtest engine consumes, preserving EXACTLY the source-owned executable strategy.
 *
 * The engine must receive ONLY source-owned entry logic (setup / trigger / confluences / invalidation /
 * direction / session / timeframe / symbol / ordered flow) with its AND/OR structure intact. Framework-owned
 * risk (stop / take-profit / sizing) is NOT a strategy condition — the framework overlay supplies it, so it is
 * carried as a labelled `framework_overlay` block, never as a required entry condition.
 *
 * Trust comes from Ledger D (handoff-conservation.ts): this translation is verified to lose no source node,
 * add no condition, and keep AND=AND / OR=OR / framework-never-required. Pure / deterministic / standalone.
 */
import type { AtomType, DecisionAtom } from "./decision-atom.js";
import type { CompiledGraph } from "./graph-compiler.js";
import { classifyGateStrengthDeterministic, gateStrengthToRole } from "./gate-strength.js";

// FRAMEWORK = risk objects the overlay OWNS (must never become a required source-owned entry condition).
// Mirrors predicate-compression.ts FRAMEWORK so the boundary is the same one compression classified out.
const FRAMEWORK =
  /\b(risk|reward|r ?: ?r|profit|target|stop ?loss|sizing|position size|lot|pips?|take ?profit)\b/i;
const ENTRY_ACTION = /\b(enter|entry|take (the )?trade|go long|go short|buy|sell)\b/i;

const TERMINAL: ReadonlySet<AtomType> = new Set(["ENTER", "ENABLE_ENTRY"]);
const INVALIDATION: ReadonlySet<AtomType> = new Set(["INVALIDATE", "EXCEPTION", "RESET"]);

/** A source-owned condition the engine must evaluate, traced back to its graph atom. */
export interface EngineCondition {
  id: string;            // === the graph atom id (traceability for Ledger D invariant 2)
  type: AtomType;        // source atom type (setup/structure/confirmation/…)
  object: string;        // object_canonical — the discriminating concept
  /**
   * "context" is Corpus v3's semantic-role addition (TF_SEMANTIC_ROLE_CLASSIFIER, default OFF) — a
   * condition the gate-strength classifier judged CONTEXTUAL (scene-setting / narrative / refuted
   * strawman). RETAINED here, never dropped — non-gating, engine-ignored — so the provenance receipt
   * survives and a future re-audit can re-adjudicate the margin WITHOUT re-running extraction.
   * "or_branch" is the classifier's ALTERNATIVE label (distinct from the topology-derived `or_branches`
   * group array below, which is unchanged and still edge/grammar-derived).
   */
  role: "spine" | "confluence" | "or_branch" | "context" | "trigger" | "invalidation";
  /** Transcript provenance (Ledger G execution traceability: trade → condition → clause). Additive/optional. */
  span?: { start: number; end: number };
  evidence?: string;
}

/** The minimal, source-faithful contract handed to the Databento engine. Framework risk is labelled, not required. */
export interface EngineStrategySpec {
  direction: "long" | "short" | "both";
  entry_conditions: EngineCondition[]; // every source-owned non-terminal/non-invalidation node
  and_groups: string[][];              // condition-id groups that must ALL hold (parallel confluence)
  or_branches: string[][];             // condition-id sets where ANY holds (alternative routes)
  invalidations: EngineCondition[];    // setup-cancel conditions (S2-S5 → S0), NOT entry gates
  entry_trigger_id: string | null;     // the reachable ENTER / ENABLE_ENTRY terminal
  framework_overlay: {                 // overlay-supplied — NEVER a required entry condition
    stop: "framework_owned";
    take_profit: "framework_owned";
    sizing: "framework_owned";
  };
}

export const isFrameworkObject = (a: Pick<DecisionAtom, "object" | "object_canonical">): boolean =>
  FRAMEWORK.test(a.object) || FRAMEWORK.test(a.object_canonical);

const directionOf = (atoms: DecisionAtom[]): "long" | "short" | "both" => {
  const txt = atoms.map((a) => a.object_canonical).join(" ");
  const hasLong = /\b(long|buy|bullish|upside)\b/i.test(txt);
  const hasShort = /\b(short|sell|bearish|downside)\b/i.test(txt);
  return hasLong && hasShort ? "both" : hasShort ? "short" : "long";
};

/**
 * TF_SEMANTIC_ROLE_CLASSIFIER (Corpus v3, Step 3, default OFF) — read live so tests can flip it without
 * re-importing the module. Byte-identical-when-OFF: `resolveConditionRole` below runs the EXACT original
 * `inAndGroup.has(a.id) ? "confluence" : "spine"` expression whenever the flag is unset/false.
 */
const semanticRoleClassifierEnabled = (): boolean => process.env.TF_SEMANTIC_ROLE_CLASSIFIER === "true";

/**
 * Resolve a non-terminal/non-invalidation atom's `role`. Flag OFF (default) -> the ORIGINAL topology-only
 * heuristic, untouched. Flag ON -> the gate-strength deterministic rules 1-5 (see gate-strength.ts); atoms
 * rules 1-5 leave AMBIGUOUS fall back to the same topology heuristic (the compiler is documented
 * "Pure / deterministic / standalone" — full gemma adjudication (rule 6) is the async
 * `classifyGateStrength()` API used by Gate 1 grading and any future async onboarding path, not this
 * synchronous compiler).
 */
function resolveConditionRole(a: DecisionAtom, inAndGroup: Set<string>): EngineCondition["role"] {
  if (!semanticRoleClassifierEnabled()) return inAndGroup.has(a.id) ? "confluence" : "spine";
  const gs = classifyGateStrengthDeterministic({
    type: a.type,
    object: a.object_canonical,
    evidenceQuote: a.provenance.evidence_quote ?? "",
  });
  if (gs !== null) return gateStrengthToRole(gs);
  return inAndGroup.has(a.id) ? "confluence" : "spine";
}

/**
 * Translate a compiled Decision Graph into the engine strategy spec.
 *
 * Every source-owned atom becomes a condition (spine / confluence / trigger / invalidation); the graph's
 * AND-groups and OR-branches carry over verbatim (by atom id); framework-owned objects are EXCLUDED from
 * entry conditions and represented only by the labelled overlay block.
 */
export function compileToEngineSpec(graph: CompiledGraph): EngineStrategySpec {
  const sourceAtoms = graph.atoms.filter((a) => !isFrameworkObject(a));
  const inAndGroup = new Set(graph.andGroups.flat());

  const entry_conditions: EngineCondition[] = [];
  const invalidations: EngineCondition[] = [];
  let entry_trigger_id: string | null = null;

  for (const a of sourceAtoms) {
    if (TERMINAL.has(a.type) || ENTRY_ACTION.test(a.object_canonical)) {
      // first reachable terminal becomes the trigger; any others fold in as triggers too
      if (entry_trigger_id === null && graph.reachable.has(a.id)) entry_trigger_id = a.id;
      entry_conditions.push({ id: a.id, type: a.type, object: a.object_canonical, role: "trigger", span: a.provenance.transcript_span, evidence: a.provenance.evidence_quote });
    } else if (INVALIDATION.has(a.type)) {
      invalidations.push({ id: a.id, type: a.type, object: a.object_canonical, role: "invalidation", span: a.provenance.transcript_span, evidence: a.provenance.evidence_quote });
    } else {
      entry_conditions.push({
        id: a.id, type: a.type, object: a.object_canonical,
        role: resolveConditionRole(a, inAndGroup),
        span: a.provenance.transcript_span, evidence: a.provenance.evidence_quote,
      });
    }
  }
  // fallback: if no reachable terminal, take the last trigger-ish condition (engine still needs an entry point)
  if (entry_trigger_id === null) {
    const t = entry_conditions.find((c) => c.role === "trigger");
    entry_trigger_id = t ? t.id : null;
  }

  return {
    direction: directionOf(sourceAtoms),
    entry_conditions,
    and_groups: graph.andGroups.map((g) => [...g]),
    or_branches: graph.orBranches.map((b) => [...b]),
    invalidations,
    entry_trigger_id,
    framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
  };
}
