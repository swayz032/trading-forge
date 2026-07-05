#!/usr/bin/env python3
"""composition-paired-delta.py — Step 3 pre-registered decision for the Composition Fidelity
Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md).

REUSES, DOES NOT REBUILD, scripts/signature-divergence.py: imports `extract_samples` and
`compute_sds` directly (via importlib — hyphenated filename) rather than reimplementing the SDS /
Wasserstein / cosine / bootstrap machinery. Same technique + same paired-bootstrap methodology as
increment 1's (uncommitted, ad hoc) paired-delta computation whose OUTPUT is preserved at
docs/replay-results/fvg-experiment-paired-delta.json — this script formalizes that pattern into a
reusable, committed instrument for increment 2 and any future increment.

METHOD: bootstrap-resample the STRATEGY SET (same N, with replacement) using the SAME resample
index array for BOTH the before and after manifests on every resample (this is what makes it a
PAIRED delta rather than two independently-bootstrapped SDS distributions) — the design's explicit
requirement ("same bootstrap resample indices both modes"). Only strategies present with >=1 trade
in BOTH manifests are paired; the self-duplicate-pair exclusion (`origin_indices`) from
signature-divergence.py's own bootstrap_sds is applied identically on both sides of each resample.

DECISION (applied ONCE, per the locked spec's Step 3 — fixed BEFORE this script is ever run against
real data):
  MIN_EFFECT = +0.20 SDS (fixed)
  SUPPORTS            : delta 90% CI entirely > +0.20
  CONCLUSIVE NEGATIVE  : delta 90% CI entirely < +0.20 (including straddling/including zero) —
                         ONLY valid when the sample-floor + gating-fidelity preconditions hold
                         (checked by the caller, e.g. a wrapper script cross-referencing
                         composition-gating-fidelity.py's n_eligible_primary_set /
                         n_families_in_primary_set — NOT re-derived here, this script only computes
                         the statistic).
  INCONCLUSIVE         : CI straddles +0.20

Usage:
  PYTHONPATH=. python scripts/composition-paired-delta.py \\
      --before docs/replay-results/composition-experiment-before-primary.json \\
      --after docs/replay-results/composition-experiment-after-primary.json \\
      --out docs/replay-results/composition-paired-delta.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

_sd_spec = importlib.util.spec_from_file_location(
    "signature_divergence", REPO_ROOT / "scripts" / "signature-divergence.py"
)
assert _sd_spec is not None and _sd_spec.loader is not None
sd = importlib.util.module_from_spec(_sd_spec)
sys.modules[_sd_spec.name] = sd  # dataclass() needs the module registered to resolve postponed annotations
_sd_spec.loader.exec_module(sd)

MIN_EFFECT: float = 0.20
DEFAULT_N_BOOT: int = 1000
DEFAULT_CI_PCT: float = 0.90
DEFAULT_SEED: int = 42

VERDICT_SUPPORTS = "SUPPORTS"
VERDICT_CONCLUSIVE_NEGATIVE_CANDIDATE = "CONCLUSIVE_NEGATIVE_CANDIDATE"
VERDICT_INCONCLUSIVE = "INCONCLUSIVE"


def paired_delta_report(
    manifest_before: dict, manifest_after: dict, n_boot: int = DEFAULT_N_BOOT, seed: int = DEFAULT_SEED, ci_pct: float = DEFAULT_CI_PCT
) -> dict:
    strategies_before = manifest_before.get("strategies", {})
    strategies_after = manifest_after.get("strategies", {})

    valid_ids = sorted(
        sid
        for sid in (set(strategies_before) & set(strategies_after))
        if strategies_before[sid].get("trades") and strategies_after[sid].get("trades")
    )

    samples_before = [sd.extract_samples(sid, strategies_before[sid]) for sid in valid_ids]
    samples_after = [sd.extract_samples(sid, strategies_after[sid]) for sid in valid_ids]
    n = len(valid_ids)

    point_before = sd.compute_sds(samples_before)
    point_after = sd.compute_sds(samples_after)
    sds_before = point_before["sds"]
    sds_after = point_after["sds"]
    point_delta = (sds_after - sds_before) if (sds_before is not None and sds_after is not None) else None

    rng = np.random.default_rng(seed)
    boot_deltas: list[float] = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n) if n > 0 else np.array([], dtype=int)
        idx_list = idx.tolist()
        resampled_before = [samples_before[k] for k in idx]
        resampled_after = [samples_after[k] for k in idx]
        res_before = sd.compute_sds(resampled_before, origin_indices=idx_list)
        res_after = sd.compute_sds(resampled_after, origin_indices=idx_list)
        if res_before["sds"] is not None and res_after["sds"] is not None:
            boot_deltas.append(res_after["sds"] - res_before["sds"])

    n_boot_valid = len(boot_deltas)
    if n_boot_valid == 0:
        return {
            "n_paired_strategies": n,
            "point_sds_before": sds_before,
            "point_sds_after": sds_after,
            "point_delta": point_delta,
            "n_boot_valid": 0,
            "delta_ci_90": [None, None],
            "delta_median": None,
            "frac_delta_positive": None,
            "ci_excludes_zero": None,
            "min_effect": MIN_EFFECT,
            "ci_entirely_above_min_effect": None,
            "ci_entirely_below_min_effect": None,
            "verdict": VERDICT_INCONCLUSIVE,
        }

    arr = np.array(boot_deltas)
    lo_pct = (1 - ci_pct) / 2 * 100
    hi_pct = 100 - lo_pct
    ci_low = float(np.percentile(arr, lo_pct))
    ci_high = float(np.percentile(arr, hi_pct))

    ci_entirely_above_min_effect = ci_low > MIN_EFFECT
    ci_entirely_below_min_effect = ci_high < MIN_EFFECT

    if ci_entirely_above_min_effect:
        verdict = VERDICT_SUPPORTS
    elif ci_entirely_below_min_effect:
        verdict = VERDICT_CONCLUSIVE_NEGATIVE_CANDIDATE
    else:
        verdict = VERDICT_INCONCLUSIVE

    return {
        "n_paired_strategies": n,
        "point_sds_before": sds_before,
        "point_sds_after": sds_after,
        "point_delta": point_delta,
        "n_boot_valid": n_boot_valid,
        "delta_ci_90": [ci_low, ci_high],
        "delta_median": float(np.median(arr)),
        "frac_delta_positive": float(np.mean(arr > 0)),
        "ci_excludes_zero": bool(ci_low > 0 or ci_high < 0),
        "min_effect": MIN_EFFECT,
        "ci_entirely_above_min_effect": ci_entirely_above_min_effect,
        "ci_entirely_below_min_effect": ci_entirely_below_min_effect,
        "verdict": verdict,
        "verdict_note": (
            "verdict is a CANDIDATE label only — CONCLUSIVE_NEGATIVE requires the sample-floor "
            "(>=15 strategies, >=5 families at gating-fidelity>=0.80) AND gating-fidelity "
            "preconditions to ALSO hold; the caller (not this script) certifies those and states "
            "the final pre-registered decision."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--n-boot", type=int, default=DEFAULT_N_BOOT)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = ap.parse_args()

    manifest_before = json.loads(Path(args.before).read_text(encoding="utf-8"))
    manifest_after = json.loads(Path(args.after).read_text(encoding="utf-8"))
    report = paired_delta_report(manifest_before, manifest_after, n_boot=args.n_boot, seed=args.seed)

    print(json.dumps(report, indent=2), file=sys.stderr)
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nwrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
