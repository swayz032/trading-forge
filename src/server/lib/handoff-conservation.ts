/**
 * LEDGER D — GRAPH→ENGINE HANDOFF CONSERVATION (2026-06-30, operator/GPT).
 *
 * The fourth conservation ledger (after A transcript / B decision / C graph). It proves the translation from
 * the validated Decision Graph to the engine strategy spec is LOSSLESS and FAITHFUL — the single check that
 * makes the Databento hand-off trustworthy. Five invariants (GPT):
 *
 *   1. no source-owned node lost      — every source atom appears as an engine condition
 *   2. no new condition added         — every engine condition traces back to a graph atom
 *   3. AND remains AND                — every graph AND-group survives as an engine and_group (same ids)
 *   4. OR remains OR                  — every graph OR-branch survives as an engine or_branch (same ids)
 *   5. framework-owned never required — no engine entry condition is a framework risk object
 *
 * Pure / deterministic / standalone. A failure localizes the exact violating ids (not just "lost something").
 */
import type { CompiledGraph } from "./graph-compiler.js";
import { compileToEngineSpec, isFrameworkObject, type EngineStrategySpec } from "./graph-to-engine.js";

export interface LedgerDInvariant { name: string; ok: boolean; offenders: string[] }
export interface LedgerDResult { ok: boolean; invariants: LedgerDInvariant[]; spec: EngineStrategySpec }

export function ledgerD(graph: CompiledGraph): LedgerDResult {
  const spec = compileToEngineSpec(graph);

  const sourceAtomIds = new Set(graph.atoms.filter((a) => !isFrameworkObject(a)).map((a) => a.id));
  const specConditionIds = new Set<string>([
    ...spec.entry_conditions.map((c) => c.id),
    ...spec.invalidations.map((c) => c.id),
  ]);
  const allAtomIds = new Set(graph.atoms.map((a) => a.id));

  // 1. no source-owned node lost
  const lost = [...sourceAtomIds].filter((id) => !specConditionIds.has(id));

  // 2. no new condition added (every emitted condition traces to a real graph atom)
  const added = [...specConditionIds].filter((id) => !allAtomIds.has(id));

  // 3. AND remains AND — each graph and-group must be a subset of SOME engine and_group
  const andGroupSets = spec.and_groups.map((g) => new Set(g));
  const andViolations = graph.andGroups
    .filter((g) => !andGroupSets.some((sg) => g.every((id) => sg.has(id))))
    .map((g) => g.join("+"));

  // 4. OR remains OR — each graph or-branch must be a subset of SOME engine or_branch
  const orBranchSets = spec.or_branches.map((b) => new Set(b));
  const orViolations = graph.orBranches
    .filter((b) => !orBranchSets.some((sb) => b.every((id) => sb.has(id))))
    .map((b) => b.join("|"));

  // 5. framework-owned never a required entry condition
  const atomById = new Map(graph.atoms.map((a) => [a.id, a]));
  const frameworkRequired = spec.entry_conditions
    .filter((c) => { const a = atomById.get(c.id); return a ? isFrameworkObject(a) : false; })
    .map((c) => `${c.id}:${c.object}`);

  const invariants: LedgerDInvariant[] = [
    { name: "no_source_node_lost", ok: lost.length === 0, offenders: lost },
    { name: "no_condition_added", ok: added.length === 0, offenders: added },
    { name: "and_remains_and", ok: andViolations.length === 0, offenders: andViolations },
    { name: "or_remains_or", ok: orViolations.length === 0, offenders: orViolations },
    { name: "framework_never_required", ok: frameworkRequired.length === 0, offenders: frameworkRequired },
  ];

  return { ok: invariants.every((i) => i.ok), invariants, spec };
}

export function ledgerDOrThrow(graph: CompiledGraph): LedgerDResult {
  const r = ledgerD(graph);
  if (!r.ok) {
    const failed = r.invariants.filter((i) => !i.ok).map((i) => `${i.name}[${i.offenders.join(",")}]`).join("; ");
    throw new Error(`Ledger D handoff conservation FAILED: ${failed}`);
  }
  return r;
}
