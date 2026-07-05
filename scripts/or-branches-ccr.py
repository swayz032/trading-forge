#!/usr/bin/env python3
"""or-branches-ccr.py — Composition Conservation Rate (CCR) measurement for the OR-Branches
Honoring Fix (docs/designs/or-branches-honoring-fix-2026-07-05.md).

CCR = executed_OR_groups / expected_OR_groups. Expected = every `or_branches` group present in
`config.compiled_spec.spec.or_branches` across the corpus (the frozen baseline: 726 groups across
108/117 strategies — docs/replay-results/or-branches-baseline-frozen-2026-07-05.md). Executed = an
or_branch group whose compiler-recognized member set includes >=1 role=="spine" condition — i.e.
a group the gating loop would actually fold into an OR-term when TF_OR_BRANCHES_ENABLED is on. A
group with ZERO spine members (every member is confluence/trigger/invalidation-role, or the ids
don't resolve at all) is an honest non-gating group: it was never going to affect entry timing
either way, so it does not count toward the executed numerator in either mode.

This is a PURE STRUCTURAL / STATIC check (no bar data, no backtest) — compile_binding_plan() is
spec-level logic only. Matches the frozen baseline's own framing: CCR is "the primary
*engineering* success metric — semantic conservation is not noisy the way market outcomes are."

Before mode (--enabled false, or omit --enabled): must reproduce the frozen baseline's 0% exactly
(spec_condition_compiler.py's spine_satisfied never consults or_branch grouping regardless of
whether the mapping is built) — a regression guard, not just a historical number.
After mode (--enabled true): reports the post-fix conservation rate.

Reused: src.engine.spec_family_bindings.compile_binding_plan (does NOT rebuild the binding-plan
compiler). Does NOT reuse the DB export (that is a one-off read-only pull already materialized to
--specs) — see docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json.

Usage:
  PYTHONPATH=. python scripts/or-branches-ccr.py \\
      --specs docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json \\
      --out docs/replay-results/or-branches-ccr-2026-07-05.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.spec_family_bindings import compile_binding_plan  # noqa: E402


def _spec_of(entry: dict) -> dict | None:
    """Accepts either a raw spec dict (has `or_branches`/`entry_conditions` directly) or a
    wrapper {"spec": {...}, ...} (the DB export shape used by or-branches-full-corpus-specs)."""
    if "spec" in entry and isinstance(entry["spec"], dict):
        return entry["spec"]
    if "entry_conditions" in entry or "or_branches" in entry:
        return entry
    return None


def compute_ccr(specs: dict[str, dict], enabled: bool) -> dict:
    prior = os.environ.get("TF_OR_BRANCHES_ENABLED")
    # The flag itself does not change compile_binding_plan()'s spine-set membership (that mapping
    # is flag-independent structural logic) — toggling it here documents which executable MODE
    # this measurement corresponds to and guards against any future flag-dependent binding-plan
    # change silently breaking this static check without anyone noticing.
    os.environ["TF_OR_BRANCHES_ENABLED"] = "true" if enabled else "false"
    per_strategy: list[dict] = []
    total_expected = 0
    total_executed = 0
    n_with_or = 0
    try:
        for sid, entry in specs.items():
            spec = _spec_of(entry)
            if spec is None:
                continue
            or_branches = spec.get("or_branches") or []
            if not or_branches:
                continue
            n_with_or += 1

            try:
                bp = compile_binding_plan(spec)
                # b.executed=False only for EXIT_HINT (provenance-only, per spec_family_bindings
                # FAMILY_META) — such bindings never enter spec_condition_compiler.py's gating
                # loop (`if not b.executed: continue`) even when role=="spine", so they must not
                # count as a "gating-participating" member here either — matches the compiler's
                # own per_condition_bool population exactly (bindable-or-not spine conditions
                # BOTH enter per_condition_bool: real evaluator when bindable, permitted-through
                # np.ones() pass-through when not — only b.executed gates entry into the loop).
                spine_ids = {b.condition_id for b in bp.bindings if b.role == "spine" and b.executed}
            except Exception as exc:  # noqa: BLE001 — one bad spec must not kill the batch
                expected = len(or_branches)
                total_expected += expected
                per_strategy.append(
                    {"name": sid, "expected": expected, "executed": 0, "ccr": 0.0, "error": f"{type(exc).__name__}: {exc}"}
                )
                continue

            expected = len(or_branches)
            executed = 0
            if enabled:
                for group in or_branches:
                    if not isinstance(group, list):
                        continue
                    if any(str(cid) in spine_ids for cid in group):
                        executed += 1

            total_expected += expected
            total_executed += executed
            per_strategy.append(
                {
                    "name": sid,
                    "expected": expected,
                    "executed": executed,
                    "ccr": (executed / expected) if expected else None,
                }
            )
    finally:
        if prior is None:
            os.environ.pop("TF_OR_BRANCHES_ENABLED", None)
        else:
            os.environ["TF_OR_BRANCHES_ENABLED"] = prior

    ccr = (total_executed / total_expected) if total_expected else None
    return {
        "enabled": enabled,
        "n_strategies_total": len(specs),
        "n_strategies_with_or_branches": n_with_or,
        "total_expected_or_groups": total_expected,
        "total_executed_or_groups": total_executed,
        "ccr": ccr,
        "ccr_pct": (round(ccr * 100, 4) if ccr is not None else None),
        "per_strategy": per_strategy,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--specs", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    specs = json.loads(Path(args.specs).read_text(encoding="utf-8"))

    before = compute_ccr(specs, enabled=False)
    after = compute_ccr(specs, enabled=True)

    report = {"before": before, "after": after}
    print(
        json.dumps(
            {
                "n_strategies_total": before["n_strategies_total"],
                "n_strategies_with_or_branches": before["n_strategies_with_or_branches"],
                "before_ccr_pct": before["ccr_pct"],
                "before_total_expected": before["total_expected_or_groups"],
                "before_total_executed": before["total_executed_or_groups"],
                "after_ccr_pct": after["ccr_pct"],
                "after_total_expected": after["total_expected_or_groups"],
                "after_total_executed": after["total_executed_or_groups"],
            },
            indent=2,
        ),
        file=sys.stderr,
    )

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nwrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
