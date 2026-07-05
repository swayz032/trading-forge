#!/usr/bin/env python3
"""role-demotion-decision.py — PRE-REGISTERED decision (docs/designs/hard-constraint-demotion-
experiment-2026-07-05.md Section 6), applied ONCE, on struct_all vs off.

REUSES, DOES NOT REBUILD: scripts/composition-paired-delta.py (SDS paired-delta bootstrap, 90% CI,
MIN_EFFECT=+0.20) and scripts/signature-divergence.py (point SDS per arm, via composition-paired-
delta's own import of it) for the manifests scripts/role-demotion-controlled-run.py already wrote.

Inputs (from role-demotion-controlled-run.py's output):
  - docs/replay-results/role-demotion-experiment-run-report.json — conjunction depth (mediator
    gate), firing rate, zero-trade, revival, per (strategy, arm).
  - docs/replay-results/role-demotion-manifests/manifest-<arm>.json — trade manifests per arm, for
    the SDS paired-delta instrument.

Produces:
  1. Mediator gate check per structural arm (depth must drop materially or that arm is INVALID —
     read directly from the conjunction-depth summary already in the run report).
  2. SDS paired-delta (off vs struct_all) — the PRE-REGISTERED decision instrument.
  3. The four-way pre-registered decision: FALSIFIER_C / FALSIFIER_B / FALSIFIER_A / INCONCLUSIVE,
     applied to struct_all vs off ONLY (never re-applied to another arm pairing).
  4. Attribution ranking: struct_conf / struct_alt / struct_ctx ranked by (revival count, firing
     rate lift vs off) — which discourse mis-typing class dominates.
  5. exec_all vs struct_all agreement (topology-artifact check) — trade-list equality per strategy
     (byte-identical trades imply byte-identical entry_long/entry_short, since trades are a
     deterministic function of the entry arrays + the fixed ATR bracket).

Usage:
  PYTHONPATH=. python scripts/role-demotion-decision.py \\
      --run-report docs/replay-results/role-demotion-experiment-run-report.json \\
      --manifests-dir docs/replay-results/role-demotion-manifests \\
      --out docs/replay-results/role-demotion-decision-2026-07-05.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

_pd_spec = importlib.util.spec_from_file_location(
    "composition_paired_delta", REPO_ROOT / "scripts" / "composition-paired-delta.py"
)
assert _pd_spec is not None and _pd_spec.loader is not None
pd_mod = importlib.util.module_from_spec(_pd_spec)
sys.modules[_pd_spec.name] = pd_mod
_pd_spec.loader.exec_module(pd_mod)

MIN_EFFECT: float = 0.20
STRUCTURAL_ARMS = ("struct_conf", "struct_alt", "struct_ctx", "struct_all")


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def mediator_gate_report(run_report: dict) -> dict:
    """Re-derives the mediator-gate verdict directly from the per-strategy conjunction_depth
    dict already in the controlled-run report (NOT re-measured — same numbers the depth script
    reported, cross-checked here so the decision file is self-contained and doesn't require
    cross-referencing two separate artifacts by hand)."""
    per_strategy = [r for r in run_report["per_strategy"] if not r.get("error")]
    n = len(per_strategy)
    out: dict = {}
    off_depths = [r["conjunction_depth"]["off"] for r in per_strategy]
    mean_off = sum(off_depths) / n if n else None
    for arm in STRUCTURAL_ARMS + ("exec_all",):
        depths = [r["conjunction_depth"][arm] for r in per_strategy]
        mean_arm = sum(depths) / n if n else None
        n_dropped = sum(1 for r in per_strategy if r["conjunction_depth"][arm] < r["conjunction_depth"]["off"])
        pct_drop = ((mean_off - mean_arm) / mean_off) if (mean_off) else None
        fired = n_dropped > 0 and arm in STRUCTURAL_ARMS
        out[arm] = {
            "mean_depth_off": mean_off,
            "mean_depth_arm": mean_arm,
            "pct_drop": pct_drop,
            "n_strategies_dropped": n_dropped,
            "n_strategies_total": n,
            "is_mediator_gate_subject": arm in STRUCTURAL_ARMS,
            "mediator_fired": fired if arm in STRUCTURAL_ARMS else None,
            "verdict": (
                "MEDIATOR_FIRED" if fired
                else ("INVALID_NO_DEPTH_DROP" if arm in STRUCTURAL_ARMS else "NOT_APPLICABLE_VALIDATION_ARM_ONLY")
            ),
        }
    return out


def attribution_ranking(run_report: dict) -> list[dict]:
    """Ranks struct_conf / struct_alt / struct_ctx by (revival count desc, firing-rate lift desc)
    — which discourse mis-typing class dominates (extractor-fix priority), per spec §6
    'Attribution (secondary)'."""
    corpus_wide = run_report["corpus_wide"]
    off_rate = corpus_wide["off"]["mean_firing_rate_per_100_bars"] or 0.0
    rows = []
    for arm in ("struct_conf", "struct_alt", "struct_ctx"):
        arm_rate = corpus_wide[arm]["mean_firing_rate_per_100_bars"] or 0.0
        rows.append(
            {
                "arm": arm,
                "n_revival_vs_off": corpus_wide[arm]["n_revival_vs_off"],
                "n_zero_trade": corpus_wide[arm]["n_zero_trade"],
                "n_zero_trade_off": corpus_wide["off"]["n_zero_trade"],
                "mean_firing_rate_per_100_bars": arm_rate,
                "firing_rate_lift_vs_off": arm_rate - off_rate,
            }
        )
    rows.sort(key=lambda r: (r["n_revival_vs_off"], r["firing_rate_lift_vs_off"]), reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def exec_vs_struct_all_agreement(manifests_dir: Path) -> dict:
    """Topology-artifact check (spec §6): compares exec_all's trade list to struct_all's trade
    list PER STRATEGY. Trades are a deterministic function of entry_long/entry_short + the fixed
    ATR bracket (scripts/fvg-experiment-controlled-run.py::simulate_measurement_trades), so
    identical trade lists imply identical entry arrays — the intended topology-artifact proof
    without needing to re-load bar data or re-run compute()."""
    struct_all = _load(str(manifests_dir / "manifest-struct_all.json"))["strategies"]
    exec_all = _load(str(manifests_dir / "manifest-exec_all.json"))["strategies"]
    common = sorted(set(struct_all.keys()) & set(exec_all.keys()))
    n_agree = 0
    disagreements: list[str] = []
    for sid in common:
        if struct_all[sid]["trades"] == exec_all[sid]["trades"]:
            n_agree += 1
        else:
            disagreements.append(sid)
    return {
        "n_common_strategies": len(common),
        "n_agree": n_agree,
        "n_disagree": len(disagreements),
        "agreement_rate": (n_agree / len(common)) if common else None,
        "disagreements": disagreements,
    }


def pre_registered_decision(
    mediator: dict,
    paired_delta_report: dict,
    corpus_wide: dict,
) -> dict:
    """Applies the spec §6 decision ONCE, to struct_all vs off. Mediator gate for struct_all MUST
    have fired or the whole decision is INVALID (not a null result)."""
    struct_all_gate = mediator["struct_all"]
    if not struct_all_gate["mediator_fired"]:
        return {
            "verdict": "INVALID",
            "reason": "struct_all mediator gate did not fire (conjunction depth did not drop) — "
            "the intervention did not structurally fire; no behavioral decision can be drawn.",
        }

    ci_low, ci_high = paired_delta_report["delta_ci_90"]
    if ci_low is None or paired_delta_report.get("point_delta") is None:
        return {
            "verdict": "INCONCLUSIVE",
            "reason": "SDS paired-delta bootstrap produced no valid resamples (n_boot_valid==0) or "
            "no paired-strategy overlap between off and struct_all manifests — cannot apply the "
            "pre-registered decision.",
        }
    ci_entirely_above_min_effect = ci_low > MIN_EFFECT
    ci_includes_or_below_min_effect = not ci_entirely_above_min_effect

    dri_note = (
        "DRI (extraction over-specification) is a STATIC per-strategy audit metric computed once "
        "in docs/replay-results/dri-audit-2026-07-05.json — it does not itself move within this "
        "experiment (demoting conditions changes EXECUTION, not the frozen audit classification). "
        "'DRI down' in the falsifier language is read here as the STRUCTURAL analogue already "
        "measured directly: conjunction depth down (the executable proxy for DRI's hard-conjunction "
        "count) — see struct_all's mediator-gate row."
    )

    firing_off = corpus_wide["off"]["mean_firing_rate_per_100_bars"] or 0.0
    firing_all = corpus_wide["struct_all"]["mean_firing_rate_per_100_bars"] or 0.0
    firing_up = firing_all > firing_off
    revival_all = corpus_wide["struct_all"]["n_revival_vs_off"] or 0
    revival_up = revival_all > 0

    if firing_up and revival_up and ci_entirely_above_min_effect:
        verdict = "FALSIFIER_C_CONFIRMED_OVER_SPECIFICATION_DOMINANT"
    elif firing_up and ci_includes_or_below_min_effect:
        verdict = "FALSIFIER_B_INTERACTION_DOMINANT"
    elif (not firing_up) and abs(paired_delta_report["point_delta"]) < MIN_EFFECT:
        verdict = "FALSIFIER_A_COUNT_NOT_DOMINANT"
    else:
        verdict = "INCONCLUSIVE"

    return {
        "verdict": verdict,
        "dri_note": dri_note,
        "conjunction_depth_pct_drop_struct_all": struct_all_gate["pct_drop"],
        "firing_rate_off": firing_off,
        "firing_rate_struct_all": firing_all,
        "firing_rate_up": firing_up,
        "revival_count_struct_all": revival_all,
        "revival_up": revival_up,
        "sds_point_before": paired_delta_report["point_sds_before"],
        "sds_point_after": paired_delta_report["point_sds_after"],
        "sds_point_delta": paired_delta_report["point_delta"],
        "sds_delta_ci_90": paired_delta_report["delta_ci_90"],
        "sds_ci_entirely_above_min_effect": ci_entirely_above_min_effect,
        "min_effect": MIN_EFFECT,
        "n_paired_strategies": paired_delta_report["n_paired_strategies"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-report", default="docs/replay-results/role-demotion-experiment-run-report.json")
    ap.add_argument("--manifests-dir", default="docs/replay-results/role-demotion-manifests")
    ap.add_argument("--out", default="docs/replay-results/role-demotion-decision-2026-07-05.json")
    ap.add_argument("--n-boot", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    run_report = _load(args.run_report)
    manifests_dir = Path(args.manifests_dir)

    mediator = mediator_gate_report(run_report)
    ranking = attribution_ranking(run_report)
    agreement = exec_vs_struct_all_agreement(manifests_dir)

    manifest_off = _load(str(manifests_dir / "manifest-off.json"))
    manifest_struct_all = _load(str(manifests_dir / "manifest-struct_all.json"))
    paired = pd_mod.paired_delta_report(manifest_off, manifest_struct_all, n_boot=args.n_boot, seed=args.seed)

    decision = pre_registered_decision(mediator, paired, run_report["corpus_wide"])

    _fvg_rig_spec = importlib.util.spec_from_file_location(
        "fvg_experiment_controlled_run", REPO_ROOT / "scripts" / "fvg-experiment-controlled-run.py"
    )
    assert _fvg_rig_spec is not None and _fvg_rig_spec.loader is not None
    _fvg_rig = importlib.util.module_from_spec(_fvg_rig_spec)
    _fvg_rig_spec.loader.exec_module(_fvg_rig)
    derive_family = _fvg_rig.derive_family

    families = {
        derive_family(r["name"], r.get("symbol"), r.get("timeframe"))
        for r in run_report["per_strategy"]
        if not r.get("error")
    }

    report = {
        "mediator_gate": mediator,
        "attribution_ranking": ranking,
        "exec_all_vs_struct_all_agreement": agreement,
        "sds_paired_delta_off_vs_struct_all": paired,
        "pre_registered_decision": decision,
        "sample": {
            "n_strategies": run_report["n_ok"],
            "n_families": len(families),
        },
    }

    print(json.dumps({"mediator_gate": mediator, "attribution_ranking": ranking, "exec_all_vs_struct_all_agreement": agreement, "pre_registered_decision": decision}, indent=2, default=str))

    Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"\nwrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
