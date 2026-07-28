"""INDEPENDENT ablation re-run for -igpOZs8LsM__s0: OFF vs ON, timed, trade-counted.
Not reusing run_dod_remeasure.py -- calling run_class_backtest directly."""
import json, os, sys, time

WT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
SPECS = os.path.join(WT, "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs")
sys.path.insert(0, WT)
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")

from src.engine.backtester import run_class_backtest
from src.engine.spec_condition_compiler import from_compiled_spec

START, END = "2022-01-01", "2023-06-30"
stub = "-igpOZs8LsM__s0"
art = json.load(open(os.path.join(SPECS, f"{stub}.spec.json"), encoding="utf-8"))

for label, flagval in [("OFF", None), ("ON", "1")]:
    if flagval is None:
        os.environ.pop("TF_WIRE1_HTF_COLUMNS", None)
    else:
        os.environ["TF_WIRE1_HTF_COLUMNS"] = flagval
    strat = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
    t0 = time.time()
    res = run_class_backtest(strategy=strat, start_date=START, end_date=END)
    dt = time.time() - t0
    print(f"=== {label} === trades={res.get('total_trades')} pf={res.get('profit_factor')} secs={dt:.1f}")
