#!/usr/bin/env python3
"""composition-gating-diagnostic.py — Step 0 of the Composition Fidelity Experiment
(docs/designs/composition-fidelity-experiment-2026-07-05.md), the falsification test the FVG
null (docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md) pointed to.

BLIND TO SDS. This script runs ONLY in baseline mode (every experimental env flag unset — the
shipped-default binding plan) and answers ONE question per strategy: which conditions actually
GATE the strategy's entry timing, and what OBJECTS do they carry?

METHOD (per the locked spec Step 0):
  1. Build the strategy via `from_compiled_spec()` (spec_condition_compiler.SpecConditionStrategy)
     exactly as the FVG-experiment rig does, and run `compute(df)` on real historical OHLCV
     (`src.engine.data_loader.load_ohlcv` — the same production loader every other battery script
     uses, no reimplementation).
  2. Read `strategy.last_per_condition_bool` (diagnostic-only attribute added to
     spec_condition_compiler.py for this experiment — the SAME per-condition boolean arrays
     `compute()` ANDs together internally; zero effect on entry/exit columns) plus the emitted
     `entry_long`/`entry_short` columns (the REAL, full-AND entry bars — ground truth).
  3. Per-condition true-frequency = arr.mean() over the whole window.
  4. GATING SET = the smallest ordered subset of spine conditions (added rarest-true-first) whose
     own AND (recomputed with the SAME rising-edge trigger semantics `compute()` uses) reproduces
     >= GATING_REPRODUCE_THRESHOLD (0.95) of the strategy's REAL entry bars. Recall-only by
     design (a subset AND is, in the typical case, a superset of the full-AND's satisfied-bar set,
     so it can only OVER-produce timing candidates relative to the full AND — the question this
     experiment cares about is whether restoring THESE FEW conditions' identity is enough to move
     behavior, not whether the subset is exactly as tight as the full spec).
  5. Record which (type, object) pairs the gating set carries — this is the data-driven answer to
     "which native evaluators does Step 1 need to build," replacing guesswork with measurement.

VALIDATION (verification bar #1): per-strategy, report whether the discovered gating set actually
clears the 0.95 reproduction bar. A strategy whose full spine conditions collectively cannot reach
0.95 (pathological — e.g. a permitted-through/unbindable-only spine) is marked
`gating_set_validated=false` and EXCLUDED from Step 1's restoration target, honestly reported, not
silently forced.

Usage (tower, PYTHONPATH=. + AWS creds from .env, same data window convention as the FVG rig):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/composition-gating-diagnostic.py \\
      --strategies docs/designs/corpus-v2-mode-ab-strategies.json \\
      --out docs/replay-results/composition-gating-diagnostic.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # repo root on sys.path

from src.engine.data_loader import load_ohlcv  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402

GATING_REPRODUCE_THRESHOLD: float = 0.95

# Same timeframe -> lookback convention as scripts/fvg-experiment-controlled-run.py, so Step 0's
# per-condition frequencies are measured over the SAME window Step 3's before/after run will use
# (comparability, not a new choice).
TIMEFRAME_LOOKBACK_DAYS: dict[str, int] = {
    "1m": 120,
    "5m": 240,
    "15m": 545,
    "30m": 730,
    "1h": 900,
}
DEFAULT_LOOKBACK_DAYS: int = 545
GLOBAL_END_DATE: str = "2026-07-01"
TF_TO_LOADER: dict[str, str] = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h"}


def _lookback_start(timeframe: str) -> str:
    days = TIMEFRAME_LOOKBACK_DAYS.get(timeframe, DEFAULT_LOOKBACK_DAYS)
    end = datetime.strptime(GLOBAL_END_DATE, "%Y-%m-%d")
    start = end - timedelta(days=days)
    return start.strftime("%Y-%m-%d")


def derive_family(name: str, symbol: str | None, timeframe: str | None) -> str:
    fam = name or ""
    if symbol:
        fam = fam.replace(f"_{symbol.lower()}", "")
    if timeframe:
        fam = fam.replace(f"_{timeframe.lower()}", "")
    return fam


def _rising_edge(satisfied: np.ndarray) -> np.ndarray:
    """Exact same trigger semantics as SpecConditionStrategy.compute()'s entry_signal derivation:
    rising edge into a satisfied state (bar 0 counts as an edge if satisfied at bar 0)."""
    n = len(satisfied)
    out = np.zeros(n, dtype=bool)
    if n == 0:
        return out
    out[0] = satisfied[0]
    out[1:] = satisfied[1:] & ~satisfied[:-1]
    return out


def find_gating_set(
    spine_conditions: list[dict],
    per_condition_bool: dict[str, np.ndarray],
    real_entry_bars: np.ndarray,
    n: int,
) -> dict:
    """Greedy rarest-true-first search for the smallest AND-subset of spine conditions whose own
    rising-edge trigger reproduces >= GATING_REPRODUCE_THRESHOLD of `real_entry_bars`.

    `spine_conditions` entries: {"condition_id", "type", "object", "primitive", "approximation"}.
    Only conditions present in `per_condition_bool` (executed, i.e. not EXIT_HINT) participate —
    matches the exact set compute() ANDs together.
    """
    real_bar_idx = set(np.flatnonzero(real_entry_bars).tolist())
    n_real = len(real_bar_idx)

    candidates = [c for c in spine_conditions if c["condition_id"] in per_condition_bool]
    if n_real == 0 or not candidates:
        return {
            "validated": False,
            "reason": "no_real_entry_bars" if n_real == 0 else "no_executed_spine_conditions",
            "gating_condition_ids": [],
            "gating_objects": [],
            "reproduction_frac": None,
            "gating_set_size": 0,
            "spine_total": len(spine_conditions),
        }

    freq = {c["condition_id"]: float(per_condition_bool[c["condition_id"]].mean()) for c in candidates}
    ordered = sorted(candidates, key=lambda c: (freq[c["condition_id"]], c["condition_id"]))

    selected: list[dict] = []
    running_and = np.ones(n, dtype=bool)
    best_frac = 0.0
    for cond in ordered:
        running_and = running_and & per_condition_bool[cond["condition_id"]]
        selected.append(cond)
        edge = _rising_edge(running_and)
        sub_bar_idx = set(np.flatnonzero(edge).tolist())
        overlap = len(real_bar_idx & sub_bar_idx)
        best_frac = overlap / n_real
        if best_frac >= GATING_REPRODUCE_THRESHOLD:
            break

    return {
        "validated": best_frac >= GATING_REPRODUCE_THRESHOLD,
        "reason": None if best_frac >= GATING_REPRODUCE_THRESHOLD else "could_not_reach_threshold",
        "gating_condition_ids": [c["condition_id"] for c in selected],
        "gating_objects": [
            {"type": c["type"], "object": c["object"], "primitive": c["primitive"], "true_freq": round(freq[c["condition_id"]], 4)}
            for c in selected
        ],
        "reproduction_frac": round(best_frac, 4),
        "gating_set_size": len(selected),
        "spine_total": len(spine_conditions),
    }


def analyze_one_strategy(entry: dict, df) -> dict:
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    # Baseline mode ONLY (Step 0 is blind to any restoration flag) — explicitly clear every
    # known experimental flag so a leaked env var from a prior process never contaminates this
    # measurement.
    prior_fvg = os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
    prior_bundle = os.environ.pop("TF_COMPOSITION_BUNDLE_ENABLED", None)
    try:
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        out = strategy.compute(df)
    finally:
        if prior_fvg is not None:
            os.environ["TF_FVG_IDENTITY_ENABLED"] = prior_fvg
        if prior_bundle is not None:
            os.environ["TF_COMPOSITION_BUNDLE_ENABLED"] = prior_bundle

    n = len(df)
    entry_long = out["entry_long"].to_numpy()
    entry_short = out["entry_short"].to_numpy()
    real_entry_bars = entry_long | entry_short

    bp = strategy.binding_plan
    spine_conditions = [
        {
            "condition_id": b.condition_id,
            "type": b.type,
            "object": b.object,
            "primitive": b.primitive,
            "approximation": b.approximation,
        }
        for b in bp.bindings
        if b.role == "spine"
    ]

    gating = find_gating_set(spine_conditions, strategy.last_per_condition_bool, real_entry_bars, n)

    return {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "family": derive_family(name, symbol, timeframe),
        "n_bars": n,
        "n_real_entry_bars": int(real_entry_bars.sum()),
        "spine_total": len(spine_conditions),
        "spine_bound": bp.spine_bound,
        "approximation_used": bp.approximation_used,
        "gating": gating,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strategies", default="docs/designs/corpus-v2-mode-ab-strategies.json")
    ap.add_argument("--out", default="docs/replay-results/composition-gating-diagnostic.json")
    ap.add_argument("--limit", type=int, default=None, help="cap total strategies processed (debug)")
    args = ap.parse_args()

    entries = json.loads(Path(args.strategies).read_text(encoding="utf-8"))
    if args.limit:
        entries = entries[: args.limit]

    print(f"composition-gating-diagnostic: {len(entries)} strategies (blind to SDS, baseline mode only)", file=sys.stderr)

    per_strategy: list[dict] = []
    data_cache: dict[tuple[str, str], Any] = {}
    object_breadth: Counter = Counter()          # (type, normalized object) -> n strategies whose GATING set carries it
    object_breadth_strats: dict[tuple[str, str], set[str]] = {}

    for idx, entry in enumerate(entries):
        strat = entry["strategy"]
        name = strat["name"]
        symbol = strat["symbol"]
        timeframe = strat["timeframe"]
        t0 = time.time()
        rec: dict[str, Any] = {"name": name, "symbol": symbol, "timeframe": timeframe}
        try:
            key = (symbol, timeframe)
            if key not in data_cache:
                start = _lookback_start(timeframe)
                data_cache[key] = load_ohlcv(symbol, TF_TO_LOADER.get(timeframe, timeframe), start, GLOBAL_END_DATE)
            df = data_cache[key]
            result = analyze_one_strategy(entry, df)
            rec.update(result)
            rec["error"] = None

            if result["gating"]["validated"]:
                for obj in result["gating"]["gating_objects"]:
                    key2 = (obj["type"], obj["object"].strip().lower())
                    object_breadth[key2] += 1
                    object_breadth_strats.setdefault(key2, set()).add(name)
        except Exception as exc:  # noqa: BLE001 — one bad strategy must not kill the batch
            rec["error"] = f"{type(exc).__name__}: {exc}"
            rec["traceback"] = traceback.format_exc()[-2000:]

        rec["elapsed_seconds"] = round(time.time() - t0, 2)
        per_strategy.append(rec)
        gs = rec.get("gating", {})
        print(
            f"  [{idx + 1}/{len(entries)}] {name}: {rec.get('error') or ('validated' if gs.get('validated') else 'NOT_VALIDATED')} "
            f"gating_size={gs.get('gating_set_size')}/{gs.get('spine_total')} "
            f"reproduction={gs.get('reproduction_frac')} ({rec['elapsed_seconds']}s)",
            file=sys.stderr,
        )

    n_validated = sum(1 for r in per_strategy if r.get("gating", {}).get("validated"))
    n_errors = sum(1 for r in per_strategy if r.get("error"))

    object_ranked = sorted(
        object_breadth.items(), key=lambda kv: (-len(object_breadth_strats[kv[0]]), -kv[1])
    )

    report = {
        "n_strategies": len(entries),
        "n_validated": n_validated,
        "n_not_validated": len(entries) - n_validated - n_errors,
        "n_errors": n_errors,
        "gating_reproduce_threshold": GATING_REPRODUCE_THRESHOLD,
        "object_breadth_ranked": [
            {
                "type": t,
                "object": o,
                "n_gating_bindings": n,
                "breadth_strategies": len(object_breadth_strats[(t, o)]),
                "strategies": sorted(object_breadth_strats[(t, o)]),
            }
            for (t, o), n in object_ranked
        ],
        "per_strategy": per_strategy,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8", newline="\n")

    print(
        f"\n{n_validated}/{len(entries)} strategies validated (gating set reproduces >= "
        f"{GATING_REPRODUCE_THRESHOLD:.0%} of real entries); {n_errors} errors. wrote {args.out}",
        file=sys.stderr,
    )
    print("\nTop object breadth (gating-set membership, not just overall presence):", file=sys.stderr)
    for row in report["object_breadth_ranked"][:20]:
        print(
            f"  breadth={row['breadth_strategies']:3d} strategies  count={row['n_gating_bindings']:4d}  "
            f"[{row['type']}] '{row['object']}'",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
