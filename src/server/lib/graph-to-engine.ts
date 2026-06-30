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
  role: "spine" | "confluence" | "trigger" | "invalidation";
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
      entry_conditions.push({ id: a.id, type: a.type, object: a.object_canonical, role: "trigger" });
    } else if (INVALIDATION.has(a.type)) {
      invalidations.push({ id: a.id, type: a.type, object: a.object_canonical, role: "invalidation" });
    } else {
      entry_conditions.push({
        id: a.id, type: a.type, object: a.object_canonical,
        role: inAndGroup.has(a.id) ? "confluence" : "spine",
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
