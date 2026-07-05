#!/usr/bin/env python3
"""role-demotion-conjunction-depth.py — Hard-Constraint Demotion Experiment
(docs/designs/hard-constraint-demotion-experiment-2026-07-05.md) Section 4 MEDIATOR GATE.

Measures conjunction depth (SpecConditionStrategy.conjunction_depth() — the number of distinct
AND-connected terms in the EXECUTED spine, after OR-merging) per strategy, per arm
{off, struct_conf, struct_alt, struct_ctx, struct_all, exec_all}, on the SAME 42-strategy /
14-family corpus (docs/designs/dri-audit-42-strategies-corpus.json, ×3-symbol fan-out over exactly
the 14 videos in the DRI audit — docs/replay-results/dri-audit-2026-07-05.json).

PURE STRUCTURAL / STATIC — no bar data, no backtest (mirrors scripts/or-branches-ccr.py's own
framing: this is the *engineering* mediator check, not a noisy market-outcome measurement). Reused:
src.engine.spec_family_bindings (compile_binding_plan via SpecConditionStrategy's own construction)
and src.engine.role_demotion_audit (the classification loader) — no new evaluators, no new binding
logic; this script only INSTANTIATES SpecConditionStrategy once per (strategy, arm) and reads its
already-implemented conjunction_depth().

MEDIATOR GATE PER SPEC SECTION 6/8: "mean conjunction depth MUST drop materially or the
intervention didn't fire -> INVALID, not a null result." This script reports per-arm mean depth
before/after AND flags, per strategy, whether depth actually moved -- so a downstream analysis can
say INVALID for a specific arm/strategy combination rather than silently averaging over
no-op cases (see struct_alt's honest singleton-no-op limitation, documented in
spec_condition_compiler.py's module docstring and covered by
src/engine/tests/test_role_demotion.py::test_struct_alt_singleton_alternative_is_honest_no_op_on_depth).

exec_all is measured for completeness/reporting but is NEVER subject to the mediator gate — by
design its conjunction_depth() equals "off" (execution-masking preserves structure; see
SpecConditionStrategy._apply_exec_all_masking's docstring). The script explicitly labels exec_all's
row as "not_a_mediator_gate_subject" rather than reporting a misleading 0% drop as if it were a
failed intervention.

Usage:
  PYTHONPATH=. python scripts/role-demotion-conjunction-depth.py \\
      --strategies docs/designs/dri-audit-42-strategies-corpus.json \\
      --out docs/replay-results/role-demotion-conjunction-depth-2026-07-05.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from statistics import mean

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.spec_condition_compiler import SpecConditionStrategy  # noqa: E402
from src.engine.spec_family_bindings import ROLE_DEMOTION_MODES  # noqa: E402

# "off" is the baseline every arm is compared against; it is not itself an "arm" in the §6 sense
# but is included here as the reference row. exec_all is measured but flagged non-gated (see
# module docstring). Order matches the spec's own arm listing (§3).
ARMS: tuple[str, ...] = ("off", "struct_conf", "struct_alt", "struct_ctx", "struct_all", "exec_all")
STRUCTURAL_ARMS: frozenset[str] = frozenset({"struct_conf", "struct_alt", "struct_ctx", "struct_all"})


def _strategy_id(entry: dict) -> str:
    strat = entry.get("strategy", {})
    return str(strat.get("name") or entry.get("compiled_spec", {}).get("spec_hash", "unknown"))


def _family_of(entry: dict) -> str:
    return str(entry.get("compiled_spec", {}).get("video", "unknown"))


def _build_strategy(entry: dict, arm: str) -> SpecConditionStrategy:
    prior = os.environ.get("TF_ROLE_DEMOTION_MODE")
    os.environ["TF_ROLE_DEMOTION_MODE"] = arm
    try:
        strat_cfg = entry.get("strategy", {})
        compiled_spec = entry["compiled_spec"]
        return SpecConditionStrategy(
            compiled_spec=compiled_spec,
            symbol=str(strat_cfg.get("symbol", "MES")),
            timeframe=str(strat_cfg.get("timeframe", "5m")),
            strategy_name=strat_cfg.get("name"),
        )
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_MODE", None)
        else:
            os.environ["TF_ROLE_DEMOTION_MODE"] = prior


def measure(strategies: list[dict]) -> dict:
    per_strategy: list[dict] = []
    depths_by_arm: dict[str, list[int]] = {arm: [] for arm in ARMS}

    for entry in strategies:
        sid = _strategy_id(entry)
        family = _family_of(entry)
        row: dict = {"name": sid, "family_video": family, "symbol": entry.get("strategy", {}).get("symbol"), "depths": {}}
        try:
            for arm in ARMS:
                strat = _build_strategy(entry, arm)
                depth = strat.conjunction_depth()
                row["depths"][arm] = depth
                depths_by_arm[arm].append(depth)
        except Exception as exc:  # noqa: BLE001 — one bad spec must not kill the batch
            row["error"] = f"{type(exc).__name__}: {exc}"
        per_strategy.append(row)

    off_depths = {r["name"]: r["depths"]["off"] for r in per_strategy if "off" in r.get("depths", {})}

    arm_summaries: dict[str, dict] = {}
    for arm in ARMS:
        vals = depths_by_arm[arm]
        mean_depth = mean(vals) if vals else None
        arm_summaries[arm] = {
            "mean_depth": mean_depth,
            "n_strategies": len(vals),
        }
        if arm == "off":
            continue
        deltas = []
        n_dropped = 0
        n_unchanged = 0
        n_increased = 0
        for r in per_strategy:
            if "off" not in r.get("depths", {}) or arm not in r.get("depths", {}):
                continue
            d_off = r["depths"]["off"]
            d_arm = r["depths"][arm]
            delta = d_arm - d_off
            deltas.append(delta)
            if delta < 0:
                n_dropped += 1
            elif delta == 0:
                n_unchanged += 1
            else:
                n_increased += 1
        mean_delta = mean(deltas) if deltas else None
        mean_off = arm_summaries["off"]["mean_depth"]
        pct_drop = (
            (mean_off - mean_depth) / mean_off if (mean_off not in (None, 0) and mean_depth is not None) else None
        )
        arm_summaries[arm].update(
            {
                "mean_delta_vs_off": mean_delta,
                "n_strategies_depth_dropped": n_dropped,
                "n_strategies_depth_unchanged": n_unchanged,
                "n_strategies_depth_increased": n_increased,
                "mean_pct_drop_vs_off": pct_drop,
                "is_mediator_gate_subject": arm in STRUCTURAL_ARMS,
                "mediator_gate_note": (
                    None
                    if arm in STRUCTURAL_ARMS
                    else "exec_all preserves structure BY DESIGN — never a mediator-gate subject; "
                    "reported here for the topology-artifact cross-check only (spec §6/§8)."
                ),
            }
        )

    return {
        "n_strategies": len(strategies),
        "n_families": len({r["family_video"] for r in per_strategy}),
        "arms": arm_summaries,
        "per_strategy": per_strategy,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strategies", default="docs/designs/dri-audit-42-strategies-corpus.json")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    os.environ.setdefault("TF_ALLOW_FIXED_1", "true")
    strategies = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    report = measure(strategies)

    print(
        json.dumps(
            {
                "n_strategies": report["n_strategies"],
                "n_families": report["n_families"],
                "arm_summaries": {
                    arm: {k: v for k, v in summary.items() if k != "per_strategy"}
                    for arm, summary in report["arms"].items()
                },
            },
            indent=2,
            default=str,
        ),
        file=sys.stderr,
    )

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nwrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
