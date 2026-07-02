"""
SPEC INTERPRETER (2026-06-30) — Python mirror of the EngineStrategySpec reference semantics.

The engine-side half of the "engine is just another deterministic backend for the compiler" contract
(operator/GPT). The NORMATIVE semantics live in src/server/lib/spec-semantics.ts — this module implements them
byte-for-byte, and scripts/spec-interpretation-parity.ts (LEDGER E) proves both sides agree on 100% of truth
assignments. Change semantics in TS + here + the harness in the SAME commit.

Semantics (same numbering as the TS reference):
  1. INVALIDATION VETO — any satisfied invalidation -> armed=False.
  2. OR-BRANCHES — each branch is one requirement: satisfied iff ANY member satisfied; members are NOT
     individually required.
  3. INDIVIDUAL REQUIREMENTS — every entry condition not inside an or_branch must be satisfied.
  4. TRIGGER — entry_trigger_id=None can never arm.
  5. FRAMEWORK — framework_overlay is never consulted.

STDLIB-ONLY on purpose: importable under pytest collection on the tower (no vectorbt / polars / numpy pull).
Pure / deterministic.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set


def evaluate_spec(spec: Dict[str, Any], satisfied: Iterable[str]) -> Dict[str, Any]:
    """Evaluate an EngineStrategySpec against the set of condition ids satisfied on this bar.

    Returns {"armed": bool, "blocked_by": sorted list} — identical encoding to the TS reference:
    unmet ids, "or:" + sorted members joined "|", "invalidated:" + id, "no_trigger".
    """
    sat: Set[str] = set(satisfied)
    blocked: List[str] = []

    # 1. invalidation veto
    for inv in spec.get("invalidations", []):
        if inv["id"] in sat:
            blocked.append(f"invalidated:{inv['id']}")

    # 2. or-branches: one disjunctive requirement each; members excused from individual requirement
    in_or_branch: Set[str] = set()
    for branch in spec.get("or_branches", []):
        in_or_branch.update(branch)
    for branch in spec.get("or_branches", []):
        if not any(m in sat for m in branch):
            blocked.append("or:" + "|".join(sorted(branch)))

    # 3. individual requirements (spine / confluence / trigger not inside an or-branch)
    for cond in spec.get("entry_conditions", []):
        if cond["id"] in in_or_branch:
            continue
        if cond["id"] not in sat:
            blocked.append(cond["id"])

    # 4. trigger must exist
    if spec.get("entry_trigger_id") is None:
        blocked.append("no_trigger")

    blocked.sort()
    return {"armed": len(blocked) == 0, "blocked_by": blocked}
