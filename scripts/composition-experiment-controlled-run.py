#!/usr/bin/env python3
"""composition-experiment-controlled-run.py — THE CONTROLLED RUN for the Composition Fidelity
Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md), Phase 3 Increment 2 —
the falsification test the FVG null (increment 1) pointed to.

REUSES, DOES NOT REBUILD, the increment-1 rig (`scripts/fvg-experiment-controlled-run.py`): this
script imports that module directly (via importlib — hyphenated filename, not a valid Python
module name for a plain `import`) and calls its `simulate_measurement_trades()` UNCHANGED, so the
measurement instrument (fixed 1.5xATR stop / 3.0xATR target / 60-bar time-stop bracket, documented
there as "never claimed as edge") is byte-identical across increment 1 and increment 2 — the
locked spec's explicit comparability requirement. Also reuses `src.engine.data_loader.load_ohlcv`
(the same production loader) and the SAME timeframe -> lookback-window convention Step 0's gating
diagnostic already used for this exact corpus.

SINGLE VARIABLE: TF_COMPOSITION_BUNDLE_ENABLED + per-strategy restore_condition_ids (the strategy's
OWN gating-set condition ids from Step 0/2, restored ONLY for strategies whose gating_fidelity
reached the 0.80 primary-set threshold — scripts/composition-gating-fidelity.py's output IS the
selection input here, not re-derived). Every strategy below the threshold (or gating-not-validated)
runs with an EMPTY restore set in "after" mode too — i.e. genuinely unrestored, non-target control,
byte-identical to "before" by construction (verified below, not merely assumed).

Usage (tower, PYTHONPATH=. + AWS creds from .env):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/composition-experiment-controlled-run.py \\
      --strategies docs/designs/corpus-v2-mode-ab-strategies.json \\
      --fidelity docs/replay-results/composition-gating-fidelity.json \\
      --out-before docs/replay-results/composition-experiment-before.json \\
      --out-after docs/replay-results/composition-experiment-after.json \\
      --report-out docs/replay-results/composition-experiment-run-report.json
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


def run_one_strategy_one_mode(entry: dict, df, atr: np.ndarray, restore_ids: frozenset[str] | None) -> dict:
    """`restore_ids=None` => baseline (bundle flag irrelevant, byte-identical to shipped default).
    `restore_ids=frozenset()` (empty, non-None) => bundle flag ON but nothing targeted — the
    non-target control mode (proves the flag alone changes nothing without explicit targeting).
    `restore_ids={...}` non-empty => the strategy's own gating-set ids, bundle flag ON."""
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    prior = os.environ.get("TF_COMPOSITION_BUNDLE_ENABLED")
    os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = "true" if restore_ids is not None else "false"
    try:
        strategy = from_compiled_spec(
            compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name, restore_condition_ids=restore_ids
        )
        approximation_used = strategy.binding_plan.approximation_used
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
        trades = simulate_measurement_trades(df, entry_long, entry_short, atr)
    finally:
        if prior is None:
            os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
        else:
            os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = prior

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
    ap.add_argument("--fidelity", default="docs/replay-results/composition-gating-fidelity.json")
    ap.add_argument("--out-before", default="docs/replay-results/composition-experiment-before.json")
    ap.add_argument("--out-after", default="docs/replay-results/composition-experiment-after.json")
    ap.add_argument("--out-before-primary", default="docs/replay-results/composition-experiment-before-primary.json")
    ap.add_argument("--out-after-primary", default="docs/replay-results/composition-experiment-after-primary.json")
    ap.add_argument("--report-out", default="docs/replay-results/composition-experiment-run-report.json")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    corpus = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    fidelity = json.loads(Path(args.fidelity).read_text(encoding="utf-8"))
    fidelity_by_name = {s["name"]: s for s in fidelity["per_strategy"]}

    entries = corpus
    if args.limit:
        entries = entries[: args.limit]

    print(f"composition-experiment-controlled-run: {len(entries)} strategies total", file=sys.stderr)

    manifest_before: dict[str, dict] = {}
    manifest_after: dict[str, dict] = {}
    manifest_before_primary: dict[str, dict] = {}
    manifest_after_primary: dict[str, dict] = {}
    per_strategy_report: list[dict] = []
    data_cache: dict[tuple[str, str], Any] = {}
    non_target_violations: list[str] = []

    for idx, entry in enumerate(entries):
        strat = entry["strategy"]
        name = strat["name"]
        symbol = strat["symbol"]
        timeframe = strat["timeframe"]
        t0 = time.time()

        fid_row = fidelity_by_name.get(name, {})
        eligible = bool(fid_row.get("eligible"))
        gating_fidelity = fid_row.get("gating_fidelity")
        # Eligible (primary-set) strategies restore exactly the condition ids
        # composition-gating-fidelity.py already confirmed bind to a native bundle primitive
        # (restored_objects[]) — the same ids, not re-derived. Everyone else gets an EMPTY
        # (non-None) restore set: the bundle flag flips ON in "after" mode but nothing is
        # targeted, so their trades must come out byte-identical to "before" (the non-target
        # control, verified below rather than assumed).
        restore_ids = frozenset(o["condition_id"] for o in fid_row.get("restored_objects", [])) if eligible else frozenset()

        rec: dict[str, Any] = {
            "name": name,
            "symbol": symbol,
            "timeframe": timeframe,
            "eligible_primary_set": eligible,
            "gating_fidelity": gating_fidelity,
            "restore_set_size": len(restore_ids),
        }
        try:
            key = (symbol, timeframe)
            if key not in data_cache:
                start = _lookback_start(timeframe)
                data_cache[key] = load_ohlcv(symbol, TF_TO_LOADER.get(timeframe, timeframe), start, GLOBAL_END_DATE)
            df = data_cache[key]
            atr = compute_atr(df, ATR_PERIOD).to_numpy()

            res_before = run_one_strategy_one_mode(entry, df, atr, restore_ids=None)
            res_after = run_one_strategy_one_mode(entry, df, atr, restore_ids=restore_ids)

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
        "n_non_target_control": len(entries) - len(manifest_before_primary),
        "n_non_target_byte_identical_violations": len(non_target_violations),
        "non_target_violations": non_target_violations,
        "per_strategy": per_strategy_report,
    }
    Path(args.report_out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(
        f"\nnon-target byte-identical violations: {len(non_target_violations)} (must be 0)\n"
        f"wrote {args.out_before}, {args.out_after}, {args.out_before_primary}, {args.out_after_primary}, {args.report_out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
