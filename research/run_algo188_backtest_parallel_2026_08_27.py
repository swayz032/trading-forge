#!/usr/bin/env python3
"""ALGO-188 — the v2.4 backtest on the full contiguous history, run in parallel.

AUTHORISED BY ALGO-186, on ALGO-185 §4's two obligations, BOTH DISCHARGED FIRST:
  obligation 1  independence PROVEN (ALGO-187): the run-path closure is 20 modules, the only
                written module-level mutable is `_HTF_CACHE`, and it is UNREACHABLE here -
                `gold_zone_state_at` is called 0 times over full sessions while
                `levels.zone_state_at_v24` is called 23,451.
  obligation 2  determinism PROVEN by key, two separate processes and solo-vs-pool.

PARALLELISM IS NOT AN OPTIMISATION OF THE ALGORITHM. Sessions are independent; each builds its own
map from its own 40-day read and writes nothing another session reads. This is the same code on the
same inputs, N times over, so there is nothing to prove exact because nothing is approximated. The
15m-close optimisation was REFUSED (ALGO-184) precisely because it WOULD have approximated.

WINDOW, STATED WITH ITS HOLES: 2020-01-01..2026-03-08, the only contiguous block in
`data_cache/NQ/ratio_adj`. The parquet spans 2015-08..2026-03 but 48 months inside that span are
ABSENT - all of 2016, 2017 and 2019, plus most of 2015 and 2018. 2015 and 2018 are excluded because
a 40-day lookback map cannot be built across a gap.

🛑 A DEPARTURE FROM THE CANONICAL RUNNER, DECLARED RATHER THAN BURIED.
`current_mnq_strategy_v2_4_engine.run_backtest` calls `run_day`, which requires
`env["contract_by_session"]`, `env["adjustment_by_session"]` and `env["dataset_manifest"]` - a
SEALED dataset env that does not exist for this ratio-adjusted continuous series. This runner calls
`_analysis_run_day`, the layer beneath it. The difference is that `run_day` additionally
DE-ADJUSTS analysis prices back to raw per-contract prices for execution provenance. That is a
price-LABELLING step: it changes no gate, no signal, no entry, no exit and no R. The series here is
already ratio-adjusted, and there is no per-session contract map to de-adjust against. Reported as
a scope limit; if the desk wants raw per-contract prices, that needs the sealed dataset and is a
different run.

MAE, RULED IN ADVANCE BY ALGO-186 §: publish BOTH, neither alone.
  RAW      the pessimistic bound. `mae_points` is already signed-negative AND carries the exit
           bar's FULL extreme after the stop has filled, so a stop that filled at -17.25 can report
           -79.8.
  CLAMPED  min(pts, max(mae, -(stop+slip))) - the account-equity figure. Fires ONLY on stop-family
           rows.
  CONTROL  the stop-family set must contain ZERO winners. IF A WINNER APPEARS THERE THE CLAMP IS
           WRONG AND NO DRAWDOWN NUMBER IS PUBLISHED.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import time
from datetime import date
from pathlib import Path

import pandas as pd

DATA = Path("C:/Users/tonio/Projects/trading-forge/trading-forge/data_cache/NQ/ratio_adj")
TZ = "America/New_York"
START, END = "2020-01-01", "2026-03-08"
OUT = Path("research/current_mnq_strategy_v2_4_algo188_backtest_trades.json")
_ENV = {}


def _load():
    import pandas as pd
    frames = {}
    for tf, name in (("5m", "5min"), ("1m", "1min")):
        d = pd.read_parquet(DATA / f"{name}.parquet")
        d.index = pd.to_datetime(d["ts_event"], utc=True).dt.tz_convert(TZ)
        frames[tf] = d[["open", "high", "low", "close", "volume"]].sort_index()
    return frames


def _init():
    from research import current_mnq_strategy_v2_2_engine_final as old
    from research import current_mnq_strategy_v2_3_engine as prod
    f = _load()
    _ENV["env"] = old.prepare(f["5m"], f["1m"])
    _ENV["p"] = prod.Params()


def _one(day: str):
    from research.current_mnq_strategy_v2_4_engine import _analysis_run_day
    if "env" not in _ENV:
        _init()
    try:
        row = _analysis_run_day(_ENV["env"], date.fromisoformat(day), _ENV["p"])
    except Exception as exc:                      # a session that raises is REPORTED, never dropped
        return {"session": day, "_error": f"{type(exc).__name__}: {exc}"}
    if row is None:
        return {"session": day, "_no_trade": True}
    return row


def sessions() -> list[str]:
    f = _load()
    lo = pd.Timestamp(START, tz=TZ)
    hi = pd.Timestamp(END, tz=TZ) + pd.Timedelta(days=1)
    return [str(d) for d in sorted({x.date() for x in f["5m"].index if lo <= x < hi})]


def main() -> None:
    import os
    workers = max(1, (os.cpu_count() or 4) - 2)
    days = sessions()
    print(f"window {START}..{END}  sessions={len(days)}  workers={workers}", flush=True)
    t0 = time.time()
    with mp.Pool(workers, initializer=_init) as pool:
        rows = []
        for i, r in enumerate(pool.imap_unordered(_one, days, chunksize=8), 1):
            rows.append(r)
            if i % 200 == 0:
                print(f"  {i}/{len(days)}  elapsed {time.time()-t0:.0f}s", flush=True)
    wall = time.time() - t0
    OUT.write_text(json.dumps({"window": [START, END], "sessions": len(days),
                               "workers": workers, "wall_clock_s": round(wall, 1),
                               "rows": rows}, indent=1, default=str), encoding="utf-8")
    errs = [r for r in rows if r.get("_error")]
    trades = [r for r in rows if not r.get("_no_trade") and not r.get("_error")]
    print(f"\nDONE in {wall/60:.1f} min with {workers} workers")
    print(f"  sessions {len(days)}   trades {len(trades)}   no-trade {len(rows)-len(trades)-len(errs)}"
          f"   ERRORS {len(errs)}")
    if errs:
        print("  ERROR SESSIONS ARE NOT DROPPED - first 3:")
        for e in errs[:3]:
            print(f"    {e['session']}: {e['_error'][:110]}")
    print(f"  written to {OUT}")


if __name__ == "__main__":
    mp.freeze_support()
    main()
