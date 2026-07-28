"""PACKET 2 round-trip DoD (R-039 §5d / R-040 §1) — the witnessed physical
H1->H2 connection. Runs INSIDE the pinned 404a3396 worktree (imports that tree's
engine). Reads the hash-stamped .spec.json produced on the h1-wave4 branch,
compiles it via from_compiled_spec, and runs run_class_backtest on synthetic MES
bars. Reports a real result (trades, or an honest zero + reason) per named spec.
"""
import json
import os
import sys
from datetime import UTC, datetime, timedelta

WT = r"C:/Users/tonio/Projects/wt-dod-404a3396"
SPECS_DIR = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712/docs/replay-results/h1-scripts/claude-rung-v32/packet2_dod_specs"
sys.path.insert(0, WT)  # import the 404a3396 engine, NOT the h1-wave4 branch

import numpy as np  # noqa: E402
import polars as pl  # noqa: E402

from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.backtester import run_class_backtest  # noqa: E402

print("engine tree:", WT)
print("HEAD:", open(os.path.join(WT, ".git")).read().strip() if os.path.exists(os.path.join(WT, ".git")) else "(worktree)")


def synth_bars(n=2400, seed=7):
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    close = 5000 + np.cumsum(rng.normal(0, 1.5, n))
    high = close + rng.uniform(0.25, 2.0, n)
    low = close - rng.uniform(0.25, 2.0, n)
    open_ = close + rng.normal(0, 0.4, n)
    vol = rng.integers(500, 3000, n)
    return pl.DataFrame({
        "ts_event": ts,
        "open": open_.astype(np.float64), "high": high.astype(np.float64),
        "low": low.astype(np.float64), "close": close.astype(np.float64),
        "volume": vol.astype(np.int64),
    })


bars = synth_bars()
start_date = bars["ts_event"][0].strftime("%Y-%m-%d")
end_date = bars["ts_event"][-1].strftime("%Y-%m-%d")
print(f"synthetic bars: {len(bars)} rows, {start_date} .. {end_date}\n")

results = []
for stub in ["-igpOZs8LsM__s0", "4cT8WTyxhYY__s0"]:
    art = json.load(open(os.path.join(SPECS_DIR, stub + ".spec.json"), encoding="utf-8"))
    print(f"=== {stub}  spec_hash={art['spec_hash'][:16]}  n_cond={len(art['spec']['entry_conditions'])} ===")
    try:
        strat = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
        res = run_class_backtest(
            strat, start_date, end_date, data=bars,
            skip_eligibility_gate=True, use_performance_gate=False,
        )
        # res is typically a dict with metrics; surface trade count + a couple fields
        n_trades = None
        for k in ("num_trades", "total_trades", "trades", "n_trades"):
            if isinstance(res, dict) and k in res:
                v = res[k]
                n_trades = len(v) if isinstance(v, list) else v
                break
        keys = list(res.keys())[:12] if isinstance(res, dict) else type(res).__name__
        print(f"  RAN. result type={type(res).__name__}  n_trades={n_trades}  keys={keys}")
        metrics = {k: res[k] for k in ("total_return", "sharpe_ratio", "max_drawdown", "win_rate",
                                       "profit_factor", "total_trades") if isinstance(res, dict) and k in res}
        results.append({"spec": stub, "spec_hash": art["spec_hash"], "ran": True,
                        "n_trades": n_trades, "binding_approximation_rate": art["approximation_metrics"]["binding_approximation_rate"],
                        "metrics": metrics})
    except Exception as e:
        import traceback
        print("  ERROR:", repr(e))
        traceback.print_exc()
        results.append({"spec": stub, "spec_hash": art["spec_hash"], "ran": False, "error": repr(e)})
    print()

ran_all = all(r["ran"] for r in results)
receipt = {
    "artifact": "h1-packet2-roundtrip-dod",
    "packet": "h1-packet2-runnable-spec-compiler-ratify-2026-07-18 (R-040)",
    "engine_sha": "404a33963728e58c6dd12bf7d0d0c894ae6818b0",
    "engine_sha_short": "404a3396",
    "worktree": WT,
    "ancestry_note": "404a3396 is NOT an ancestor of the h1-wave4 HEAD (verified) -> dedicated worktree, epoch law; .spec.json transferred as spec_hash-stamped files",
    "sizing_note": "TF_ALLOW_FIXED_1=true (engine-sanctioned unit-scope switch); synthetic MES 5m bars, not production data",
    "bars": {"rows": len(bars), "start": start_date, "end": end_date, "synthetic": True},
    "round_trip_witnessed": ran_all,
    "specs": results,
}
recpath = os.path.join(SPECS_DIR, "packet2-roundtrip-dod-receipt.json")
json.dump(receipt, open(recpath, "w", encoding="utf-8"), indent=2)
print("=== DoD SUMMARY ===")
print(json.dumps(receipt, indent=2))
print("receipt ->", recpath)
print("ROUND-TRIP WITNESSED:", ran_all)
sys.exit(0 if ran_all else 1)
