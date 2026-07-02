/**
 * SPEC SEMANTICS (2026-06-30) — the REFERENCE evaluator for EngineStrategySpec.
 *
 * Engine-side execution frontier (operator/GPT): the engine must be "just another deterministic backend for the
 * compiler". That requires the spec's meaning to be DEFINED once and implemented identically on both sides:
 * this file is the TS reference; `src/engine/spec_interpreter.py` is the byte-for-byte Python mirror; the
 * LEDGER E harness (scripts/spec-interpretation-parity.ts) proves they agree on 100% of truth assignments.
 *
 * SEMANTICS (normative — change here + Python + harness in the SAME commit):
 *   Given a spec and the set of condition ids satisfied on this bar:
 *     1. INVALIDATION VETO — if ANY invalidation id is satisfied → armed=false (setup canceled).
 *     2. OR-BRANCHES — each or_branch is ONE requirement: satisfied iff ANY member satisfied.
 *        Members of an or_branch are NOT individually required (they are alternatives).
 *     3. INDIVIDUAL REQUIREMENTS — every entry condition (spine / confluence / trigger) NOT in any or_branch
 *        must be satisfied (AND is the default; and_groups document parallelism, they don't change this).
 *     4. TRIGGER — a spec with entry_trigger_id=null can never arm.
 *     5. FRAMEWORK — the framework_overlay block is NEVER consulted (stop/TP/sizing are overlay-supplied).
 *   armed = (no invalidation satisfied) AND (all individual requirements satisfied) AND (all or-branches satisfied)
 *           AND (trigger id set).
 *   blocked_by = deterministic sorted list: unmet individual ids, plus "or:" + members.join("|") per unmet branch,
 *   plus "invalidated:" + id per satisfied invalidation, plus "no_trigger" when entry_trigger_id is null.
 *
 * Pure / deterministic / standalone.
 */
import type { EngineStrategySpec } from "./graph-to-engine.js";

export interface SpecDecision { armed: boolean; blocked_by: string[] }

export function evaluateSpec(spec: EngineStrategySpec, satisfied: ReadonlySet<string>): SpecDecision {
  const blocked: string[] = [];

  // 1. invalidation veto
  for (const inv of spec.invalidations) if (satisfied.has(inv.id)) blocked.push(`invalidated:${inv.id}`);

  // 2. or-branches: one disjunctive requirement each; members excused from individual requirement
  const inOrBranch = new Set<string>();
  for (const branch of spec.or_branches) for (const id of branch) inOrBranch.add(id);
  for (const branch of spec.or_branches) {
    if (!branch.some((id) => satisfied.has(id))) blocked.push(`or:${[...branch].sort().join("|")}`);
  }

  // 3. individual requirements (spine / confluence / trigger not inside an or-branch)
  for (const c of spec.entry_conditions) {
    if (inOrBranch.has(c.id)) continue;
    if (!satisfied.has(c.id)) blocked.push(c.id);
  }

  // 4. trigger must exist
  if (spec.entry_trigger_id === null) blocked.push("no_trigger");

  blocked.sort();
  return { armed: blocked.length === 0, blocked_by: blocked };
}
