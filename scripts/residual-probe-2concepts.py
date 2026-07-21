#!/usr/bin/env python3
"""residual-probe-2concepts.py — DIAGNOSTIC ONLY, per docs/designs/residual-probe-2concepts-
2026-07-05.md. Read-only instrumentation script (not part of the engine, not the extractor).
Does NOT modify spec_condition_compiler.py / spec_family_bindings.py / any backtester logic.

For the 6 target instances (5m_minute_support_level x {mes,mnq,mcl}, hammer_candle_long_side x
{mes,mnq,mcl}), under TF_ROLE_DEMOTION_MODE=struct_all:
  1. Reads the compiled_spec straight from docs/designs/dri-audit-42-strategies-corpus.json
     (same corpus role-demotion-controlled-run.py already validated against these 6 rows).
  2. Builds SpecConditionStrategy via from_compiled_spec (same production factory backtester.py
     uses for compiled_spec dispatch).
  3. Loads REAL S3 5m OHLCV via the production load_ohlcv() over the full available lookback.
  4. Runs strategy.compute(df) and reads back strategy.last_per_condition_bool (the same
     per-condition boolean arrays compute() ANDs together to derive spine_satisfied) plus
     strategy.binding_plan (role/executed/approximation per condition).
  5. Computes: per-condition individual satisfaction rate, pairwise joint co-satisfaction matrix,
     the executed-spine joint rate (== mean(spine_satisfied)), and n_entry_signals (rising-edge
     count) to cross-check against the existing role-demotion checkpoint.

Usage: PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/residual-probe-2concepts.py
"""
from __future__ import annotations

import itertools
import json
import os
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.engine.data_loader import load_ohlcv  # noqa: E402
from src.engine.role_demotion_audit import get_classifications_for_video  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402

CORPUS_PATH = REPO_ROOT / "docs/designs/dri-audit-42-strategies-corpus.json"
OUT_PATH = REPO_ROOT / "docs/replay-results/residual-probe-2026-07-05.json"

TARGETS = [
    "5m_minute_support_level_mes_5m",
    "5m_minute_support_level_mnq_5m",
    "5m_minute_support_level_mcl_5m",
    "hammer_candle_long_side_mes_5m",
    "hammer_candle_long_side_mnq_5m",
    "hammer_candle_long_side_mcl_5m",
]

# Mirror the 5m lookback window used by every other 2026-07-05 experiment (fvg-experiment-
# controlled-run.py / role-demotion-controlled-run.py) for consistency with prior checkpoints.
LOOKBACK_DAYS_5M = 240
GLOBAL_END_DATE = "2026-07-01"


def _lookback_start(days: int) -> str:
    from datetime import datetime, timedelta

    end = datetime.strptime(GLOBAL_END_DATE, "%Y-%m-%d")
    start = end - timedelta(days=days)
    return start.strftime("%Y-%m-%d")


def _arr_key(a: np.ndarray) -> bytes:
    """Identity key for detecting which conditions share the literal SAME underlying boolean
    array object/values (evaluator collapse — several distinct condition_ids binding to the same
    generic primitive call)."""
    return a.tobytes()


def probe_one(entry: dict) -> dict:
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]
    video = compiled_spec.get("video")

    prior = os.environ.get("TF_ROLE_DEMOTION_MODE")
    os.environ["TF_ROLE_DEMOTION_MODE"] = "struct_all"
    try:
        start = _lookback_start(LOOKBACK_DAYS_5M)
        df = load_ohlcv(symbol, timeframe, start, GLOBAL_END_DATE)
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        conjunction_depth = strategy.conjunction_depth()
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
        per_cond = dict(strategy.last_per_condition_bool)
        binding_plan = strategy.binding_plan
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_MODE", None)
        else:
            os.environ["TF_ROLE_DEMOTION_MODE"] = prior

    n_bars = len(df)
    n_signals = int(entry_long.sum() + entry_short.sum())

    # All spine bindings (role=="spine" per the RAW binding plan, i.e. pre-struct_all role
    # rewrite for OPTIONAL -- compile_binding_plan already applied struct_all when it built
    # binding_plan above, so role=="spine" here IS the post-demotion spine, and .executed
    # reflects CONTEXTUAL force_unexecuted too).
    spine_bindings = [b for b in binding_plan.bindings if b.role == "spine"]
    executed_spine = [b for b in spine_bindings if b.executed]

    demotion_classifications = get_classifications_for_video(
        video, [str(c.get("id", "")) for c in (strategy.spec.get("entry_conditions") or [])]
    ) if video else {}

    # Per-condition individual satisfaction rate, restricted to conditions that actually entered
    # the gating loop (per_cond) -- i.e. executed AND bindable-with-a-real-array (unbound
    # pass-throughs are np.ones, rate=1.0 by construction, reported honestly as such).
    per_condition_report = []
    array_identity: dict[bytes, list[str]] = {}
    for b in executed_spine:
        arr = per_cond.get(b.condition_id)
        if arr is None:
            continue
        rate = float(arr.mean())
        key = _arr_key(arr)
        array_identity.setdefault(key, []).append(b.condition_id)
        cls = demotion_classifications.get(b.condition_id)
        per_condition_report.append(
            {
                "condition_id": b.condition_id,
                "type": b.type,
                "object": b.object,
                "primitive": b.primitive,
                "approximation": b.approximation,
                "dri_classification": cls,
                "individual_satisfaction_rate": round(rate, 6),
            }
        )

    # Distinct-evaluator groups (conditions sharing the literal same array = collapsed to one
    # generic primitive regardless of how many transcript-distinct concepts they represent).
    collapse_groups = [
        {"condition_ids": ids, "n_conditions": len(ids), "shared_satisfaction_rate": round(float(np.frombuffer(k, dtype=bool).mean()), 6)}
        for k, ids in array_identity.items()
        if len(ids) > 1
    ]

    # Pairwise joint (co-)satisfaction across the DISTINCT executed arrays only (dedupe by
    # array identity so a 4-way collapse doesn't produce C(4,2)=6 redundant identical rows).
    distinct_ids = [ids[0] for ids in array_identity.values()]
    pairwise = []
    for a_id, b_id in itertools.combinations(distinct_ids, 2):
        a = per_cond[a_id]
        b = per_cond[b_id]
        joint = float((a & b).mean())
        pairwise.append(
            {
                "a": a_id,
                "b": b_id,
                "a_individual_rate": round(float(a.mean()), 6),
                "b_individual_rate": round(float(b.mean()), 6),
                "joint_rate": round(joint, 6),
                "never_cosatisfied_despite_both_individually_true": bool(
                    joint == 0.0 and a.mean() > 0.0 and b.mean() > 0.0
                ),
            }
        )

    # Full executed-spine joint rate (== mean(spine_satisfied) pre-OR-merge would be, since for
    # these two concepts under struct_all there is no active demotion OR-group with >1 real
    # member -- see narrative). Computed directly as AND of every executed array.
    if per_cond:
        joint_all = np.ones(n_bars, dtype=bool)
        for arr in per_cond.values():
            joint_all &= arr
        joint_all_rate = float(joint_all.mean())
    else:
        joint_all_rate = 1.0  # empty spine => vacuously true every bar

    return {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "video": video,
        "n_bars": n_bars,
        "conjunction_depth_struct_all": conjunction_depth,
        "n_spine_role_conditions_total": len(spine_bindings),
        "n_spine_role_conditions_executed": len(executed_spine),
        "n_entry_signals": n_signals,
        "zero_trade": n_signals == 0,
        "per_condition": per_condition_report,
        "evaluator_collapse_groups": collapse_groups,
        "pairwise_co_satisfaction": pairwise,
        "joint_rate_all_executed_conditions": round(joint_all_rate, 6),
    }


def main() -> int:
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    by_name = {e["strategy"]["name"]: e for e in corpus}

    results = {}
    for t in TARGETS:
        entry = by_name.get(t)
        if entry is None:
            results[t] = {"error": "not_found_in_corpus"}
            continue
        print(f"probing {t} ...", file=sys.stderr)
        try:
            results[t] = probe_one(entry)
        except Exception as exc:  # noqa: BLE001
            import traceback

            results[t] = {"error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()[-3000:]}
        print(f"  done: {results[t].get('error') or 'OK'}", file=sys.stderr)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"results": results}, indent=2, default=str), encoding="utf-8", newline="\n")
    print(f"wrote {OUT_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
