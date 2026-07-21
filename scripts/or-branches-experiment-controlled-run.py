#!/usr/bin/env python3
"""or-branches-experiment-controlled-run.py — THE CONTROLLED RUN for the OR-Branches Honoring Fix
falsification test (docs/designs/or-branches-honoring-fix-2026-07-05.md, execution-order step 4;
decision thresholds pre-registered in docs/designs/composition-fidelity-experiment-2026-07-05.md).

REUSES, DOES NOT REBUILD: imports `simulate_measurement_trades` + the timeframe/lookback
constants + `derive_family` directly from `scripts/fvg-experiment-controlled-run.py` (via
importlib, same technique `composition-experiment-controlled-run.py` already uses) — so the
measurement instrument (fixed 1.5xATR stop / 3.0xATR target / 60-bar time-stop bracket,
"documented, never claimed as edge") and the data loading path (`src.engine.data_loader.load_ohlcv`)
are BYTE-IDENTICAL across increment 1, increment 2, and this OR-branches re-run — the same
comparability requirement the locked spec restates for this pass ("Reused instruments... Same
execution instrument as increment 1... so before/after and increment-1/increment-2 are
comparable").

SINGLE VARIABLE: TF_OR_BRANCHES_ENABLED. Unlike the increment-2 bundle experiment (which needed a
per-strategy `restore_condition_ids` target set derived from a separate gating-fidelity pass),
or_branches honoring needs NO per-strategy targeting — `spec.or_branches` is already present on
every compiled spec; the flag alone decides whether the compiler honors it. "Eligible" (primary
set) here is a pure STRUCTURAL check (no bar data needed): a strategy is eligible iff >=1 of its
`or_branches` groups has >=1 role=="spine" AND executed (non-EXIT_HINT) member — i.e. the fix
could structurally change that strategy's entry-gating math. Every other strategy (no or_branches
at all, or every or_branch group is confluence/trigger/invalidation-role-only) is the non-target
control: byte-identical entries before/after by construction, verified below rather than assumed.

Usage (tower, PYTHONPATH=. + AWS creds from .env):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/or-branches-experiment-controlled-run.py \\
      --strategies docs/designs/corpus-v2-mode-ab-strategies.json \\
      --out-before docs/replay-results/or-branches-experiment-before.json \\
      --out-after docs/replay-results/or-branches-experiment-after.json \\
      --out-before-primary docs/replay-results/or-branches-experiment-before-primary.json \\
      --out-after-primary docs/replay-results/or-branches-experiment-after-primary.json \\
      --report-out docs/replay-results/or-branches-experiment-run-report.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.data_loader import load_ohlcv  # noqa: E402
from src.engine.indicators.core import compute_atr  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.spec_family_bindings import compile_binding_plan  # noqa: E402

# ─── Reuse (not rebuild) the increment-1 rig's measurement bracket + constants ─────────────────
_fvg_rig_spec = importlib.util.spec_from_file_location(
    "fvg_experiment_controlled_run", REPO_ROOT / "scripts" / "fvg-experiment-controlled-run.py"
)
assert _fvg_rig_spec is not None and _fvg_rig_spec.loader is not None
_fvg_rig = importlib.util.module_from_spec(_fvg_rig_spec)
_fvg_rig_spec.loader.exec_module(_fvg_rig)

simulate_measurement_trades = _fvg_rig.simulate_measurement_trades
TIMEFRAME_LOOKBACK_DAYS = _fvg_rig.TIMEFRAME_LOOKBACK_DAYS
DEFAULT_LOOKBACK_DAYS = _fvg_rig.DEFAULT_LOOKBACK_DAYS
GLOBAL_END_DATE = _fvg_rig.GLOBAL_END_DATE
TF_TO_LOADER = _fvg_rig.TF_TO_LOADER
ATR_PERIOD = _fvg_rig.ATR_PERIOD
derive_family = _fvg_rig.derive_family


def _lookback_start(timeframe: str) -> str:
    from datetime import datetime, timedelta

    days = TIMEFRAME_LOOKBACK_DAYS.get(timeframe, DEFAULT_LOOKBACK_DAYS)
    end = datetime.strptime(GLOBAL_END_DATE, "%Y-%m-%d")
    start = end - timedelta(days=days)
    return start.strftime("%Y-%m-%d")


def is_or_branches_eligible(spec: dict) -> tuple[bool, int, int]:
    """Pure structural eligibility check (no bar data) — see module docstring. Returns
    (eligible, n_or_groups, n_or_groups_with_spine_member)."""
    or_branches = spec.get("or_branches") or []
    if not or_branches:
        return False, 0, 0
    try:
        bp = compile_binding_plan(spec)
    except Exception:  # noqa: BLE001
        return False, len(or_branches), 0
    spine_ids = {b.condition_id for b in bp.bindings if b.role == "spine" and b.executed}
    n_affecting = sum(
        1 for grp in or_branches if isinstance(grp, list) and any(str(cid) in spine_ids for cid in grp)
    )
    return (n_affecting > 0), len(or_branches), n_affecting


def run_one_strategy_one_mode(entry: dict, df, atr: np.ndarray, enabled: bool) -> dict:
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    prior = os.environ.get("TF_OR_BRANCHES_ENABLED")
    os.environ["TF_OR_BRANCHES_ENABLED"] = "true" if enabled else "false"
    try:
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        approximation_used = strategy.binding_plan.approximation_used
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
        trades = simulate_measurement_trades(df, entry_long, entry_short, atr)
    finally:
        if prior is None:
            os.environ.pop("TF_OR_BRANCHES_ENABLED", None)
        else:
            os.environ["TF_OR_BRANCHES_ENABLED"] = prior

    return {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "family": derive_family(name, symbol, timeframe),
        "approximation_used": approximation_used,
        "n_entry_signals": int(entry_long.sum() + entry_short.sum()),
        "trades": trades,
        "entry_long": entry_long,
        "entry_short": entry_short,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strategies", default="docs/designs/corpus-v2-mode-ab-strategies.json")
    ap.add_argument("--out-before", default="docs/replay-results/or-branches-experiment-before.json")
    ap.add_argument("--out-after", default="docs/replay-results/or-branches-experiment-after.json")
    ap.add_argument("--out-before-primary", default="docs/replay-results/or-branches-experiment-before-primary.json")
    ap.add_argument("--out-after-primary", default="docs/replay-results/or-branches-experiment-after-primary.json")
    ap.add_argument("--report-out", default="docs/replay-results/or-branches-experiment-run-report.json")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    corpus = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    entries = corpus
    if args.limit:
        entries = entries[: args.limit]

    print(f"or-branches-experiment-controlled-run: {len(entries)} strategies total", file=sys.stderr)

    manifest_before: dict[str, dict] = {}
    manifest_after: dict[str, dict] = {}
    manifest_before_primary: dict[str, dict] = {}
    manifest_after_primary: dict[str, dict] = {}
    per_strategy_report: list[dict] = []
    data_cache: dict[tuple[str, str], Any] = {}
    non_target_violations: list[str] = []
    families_primary: set[str] = set()

    for idx, entry in enumerate(entries):
        strat = entry["strategy"]
        name = strat["name"]
        symbol = strat["symbol"]
        timeframe = strat["timeframe"]
        t0 = time.time()

        spec = entry["compiled_spec"]["spec"]
        eligible, n_or_groups, n_or_groups_spine = is_or_branches_eligible(spec)

        rec: dict[str, Any] = {
            "name": name,
            "symbol": symbol,
            "timeframe": timeframe,
            "eligible_primary_set": eligible,
            "n_or_groups": n_or_groups,
            "n_or_groups_spine_affecting": n_or_groups_spine,
        }
        try:
            key = (symbol, timeframe)
            if key not in data_cache:
                start = _lookback_start(timeframe)
                data_cache[key] = load_ohlcv(symbol, TF_TO_LOADER.get(timeframe, timeframe), start, GLOBAL_END_DATE)
            df = data_cache[key]
            atr = compute_atr(df, ATR_PERIOD).to_numpy()

            res_before = run_one_strategy_one_mode(entry, df, atr, enabled=False)
            res_after = run_one_strategy_one_mode(entry, df, atr, enabled=True)

            if not eligible:
                same = (
                    res_before["entry_long"].tolist() == res_after["entry_long"].tolist()
                    and res_before["entry_short"].tolist() == res_after["entry_short"].tolist()
                )
                if not same:
                    non_target_violations.append(name)

            sid = name
            manifest_before[sid] = {"name": name, "symbol": symbol, "timeframe": timeframe, "family": res_before["family"], "trades": res_before["trades"]}
            manifest_after[sid] = {"name": name, "symbol": symbol, "timeframe": timeframe, "family": res_after["family"], "trades": res_after["trades"]}
            if eligible:
                manifest_before_primary[sid] = manifest_before[sid]
                manifest_after_primary[sid] = manifest_after[sid]
                families_primary.add(res_before["family"])

            rec.update(
                {
                    "n_bars": len(df),
                    "approximation_before": res_before["approximation_used"],
                    "approximation_after": res_after["approximation_used"],
                    "n_entry_signals_before": res_before["n_entry_signals"],
                    "n_entry_signals_after": res_after["n_entry_signals"],
                    "n_trades_before": len(res_before["trades"]),
                    "n_trades_after": len(res_after["trades"]),
                    "byte_identical_verified": (not eligible),
                    "byte_identical_holds": (not eligible) and name not in non_target_violations,
                    "elapsed_seconds": round(time.time() - t0, 2),
                    "error": None,
                }
            )
        except Exception as exc:  # noqa: BLE001 — one bad strategy must not kill the batch
            rec["error"] = f"{type(exc).__name__}: {exc}"
            rec["traceback"] = traceback.format_exc()[-2000:]
            rec["elapsed_seconds"] = round(time.time() - t0, 2)

        per_strategy_report.append(rec)
        print(
            f"  [{idx + 1}/{len(entries)}] {name}: {'PRIMARY' if eligible else 'control'} "
            f"{rec.get('error') or 'OK'} ({rec['elapsed_seconds']}s)",
            file=sys.stderr,
        )

    Path(args.out_before).write_text(json.dumps({"strategies": manifest_before}, default=str), encoding="utf-8")
    Path(args.out_after).write_text(json.dumps({"strategies": manifest_after}, default=str), encoding="utf-8")
    Path(args.out_before_primary).write_text(json.dumps({"strategies": manifest_before_primary}, default=str), encoding="utf-8")
    Path(args.out_after_primary).write_text(json.dumps({"strategies": manifest_after_primary}, default=str), encoding="utf-8")

    report = {
        "n_total": len(entries),
        "n_primary_set": len(manifest_before_primary),
        "n_families_primary_set": len(families_primary),
        "families_primary_set": sorted(families_primary),
        "n_non_target_control": len(entries) - len(manifest_before_primary),
        "n_non_target_byte_identical_violations": len(non_target_violations),
        "non_target_violations": non_target_violations,
        "per_strategy": per_strategy_report,
    }
    Path(args.report_out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8", newline="\n")
    print(
        f"\nprimary set: {len(manifest_before_primary)} strategies / {len(families_primary)} families\n"
        f"non-target byte-identical violations: {len(non_target_violations)} (must be 0)\n"
        f"wrote {args.out_before}, {args.out_after}, {args.out_before_primary}, {args.out_after_primary}, {args.report_out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
