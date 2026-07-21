#!/usr/bin/env python3
"""fvg-experiment-controlled-run.py — THE CONTROLLED RUN for the FVG Identity Dispatch
Experiment (docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md).

Builds the BEFORE (TF_FVG_IDENTITY_ENABLED unset — generic binding, shipped default) and AFTER
(TF_FVG_IDENTITY_ENABLED=true — FVG identity dispatch) trade manifests that
scripts/signature-divergence.py consumes, for the same strategy set, same data, same seed —
single variable: the FVG identity flag.

WHY A LIGHTER PATH THAN scripts/full-battery-mode-ab.py: that harness runs the FULL
institutional battery (WF/CPCV + PBO + DSR + B14 Monte Carlo) through
run_walk_forward_class() -> run_class_backtest() -> apply_eligibility_gate() -> vectorbt trade
construction. Empirically (verified against 4 real Corpus v2 strategies before committing to
this design), that full pipeline collapses to ~1 trade per strategy over a multi-year window —
the institutional overlay's max_trades_per_day cap + rollover suppression + vectorbt's
no-pyramiding sequencing intersect with this experiment's synthetic spec-condition entry
signals (many of which fire on nearly every structure_engine recompute cadence) to leave far too
few trades to build a meaningful per-strategy distribution (a distribution over n=1 sample is not
a distribution). That collapse is a REAL, pre-existing engine/overlay property — not something
this experiment's mandate covers fixing (single-variable, FVG-only, no framework changes) — so
this script deliberately does NOT run through the institutional overlay or vectorbt trade
construction. It calls `SpecConditionStrategy.compute(df)` DIRECTLY (the exact function whose
identity-preservation behavior is under test) on real historical OHLCV data (loaded via the
production `load_ohlcv()` — no reimplementation of data access), then applies ONE minimal,
symmetric, deterministic ATR bracket (documented below) purely so a "trade" has an entry time, a
holding time, and an R-outcome to measure — never a claim about real trading edge. Per the locked
spec: "The metric that decides success is behavioral separation, NOT edge. Edge is recorded,
never judged here." The measurement bracket exists ONLY to give the SDS harness real per-trade
holding-time and R-multiple variance to work with; it is IDENTICAL across every strategy and both
modes, so it cannot itself introduce or hide an FVG-identity-driven difference — the only thing
that varies between BEFORE and AFTER is which bars `compute()` decides are entries.

MEASUREMENT BRACKET (documented, fixed, NOT the institutional Style C exit — this is a
measurement instrument, not a strategy):
  stop  = MEASUREMENT_STOP_ATR_MULT (1.5) x ATR(14) at entry
  target = MEASUREMENT_TARGET_ATR_MULT (3.0) x ATR(14) at entry (= 2R given the 1.5x stop)
  time-stop = MEASUREMENT_MAX_HOLD_BARS (60) bars, whichever of stop/target/time comes first
  R = pnl_points / stop_points  (so risk_points=1.0, point_value=1.0, pnl==R directly)
  No pyramiding: once in a "trade," subsequent raw entry signals are ignored until this
  measurement position exits (mirrors the no-pyramid contract of the real engine).

CONTROLLED SET:
  - FVG-tagged: every strategy in docs/designs/corpus-v2-mode-ab-strategies.json whose compiled
    spec has at least one WAIT_STRUCTURE/FILTER condition object in the FVG family, OR whose
    entry_indicator/entry_long/entry_short marker names "fvg" (see is_fvg_tagged()).
  - Non-FVG control: a bounded, deliberately diverse subset (3 timeframes: 15m/1h/5m) of clearly
    non-FVG families, for inter-family contrast and for the byte-identical-across-modes proof
    (verification bar #3). Bounded (not the full 45) to keep this a single-conversation-turn
    runtime — every control strategy's BEFORE/AFTER entry arrays are asserted byte-identical, so
    adding more would not add new EVIDENCE about the single-variable claim, only more repetition
    of the same proof.

DATE RANGES are timeframe-scaled (shorter history for 1m/5m, longer for 15m/30m/1h) purely to
keep total wall-clock bounded for this pass — documented, not hidden. `compute()`'s own
determinism is unaffected by window length; a future full-corpus/full-history run is a mechanical
extension of this same script, not a redesign.

USAGE (tower, PYTHONPATH=. + AWS creds as for other battery scripts):
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/fvg-experiment-controlled-run.py \\
      --strategies docs/designs/corpus-v2-mode-ab-strategies.json \\
      --out-before docs/replay-results/fvg-experiment-before.json \\
      --out-after docs/replay-results/fvg-experiment-after.json \\
      --report-out docs/replay-results/fvg-experiment-run-report.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # repo root on sys.path

from src.engine.data_loader import load_ohlcv  # noqa: E402
from src.engine.indicators.core import compute_atr  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.spec_family_bindings import resolve_fvg_object  # noqa: E402

# ─── Measurement bracket constants (see module docstring) ──────────────────────────────────────
MEASUREMENT_STOP_ATR_MULT: float = 1.5
MEASUREMENT_TARGET_ATR_MULT: float = 3.0  # 2R given the 1.5x stop
MEASUREMENT_MAX_HOLD_BARS: int = 60
ATR_PERIOD: int = 14

# ─── Timeframe -> lookback window (see module docstring "DATE RANGES") ─────────────────────────
TIMEFRAME_LOOKBACK_DAYS: dict[str, int] = {
    "1m": 120,     # ~4 months
    "5m": 240,     # ~8 months
    "15m": 545,    # ~18 months
    "30m": 730,    # ~2 years
    "1h": 900,     # ~2.5 years
}
DEFAULT_LOOKBACK_DAYS: int = 545
GLOBAL_END_DATE: str = "2026-07-01"

TF_TO_LOADER: dict[str, str] = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h"}

# Bounded control-family allow-list (see module docstring "CONTROLLED SET"). Verified non-FVG
# via is_fvg_tagged() at load time (defensive — never trust a hardcoded list blindly).
CONTROL_FAMILY_ALLOWLIST: tuple[str, ...] = ("vwap_cross", "entry_condition", "ema_period", "short_entry")


def is_fvg_tagged(entry: dict) -> bool:
    """Same FVG-family recognition as spec_family_bindings.resolve_fvg_object(), applied at the
    strategy level: true if ANY condition object in the compiled spec is FVG-family, or the
    entry_indicator/entry_long/entry_short marker itself names fvg (archetype:fvg /
    archetype_dispatch:fvg — Band B's own archetype-matcher label for this concept family)."""
    strat = entry.get("strategy", {})
    entry_indicator = str(strat.get("entry_indicator") or "")
    if "fvg" in entry_indicator.lower():
        return True
    spec = entry.get("compiled_spec", {}).get("spec", {})
    for grp in spec.get("and_groups", []) or []:
        for cond in grp:
            obj = cond.split(":", 1)[1] if ":" in cond else cond
            obj = obj.rsplit("#", 1)[0] if "#" in obj else obj
            if resolve_fvg_object(obj):
                return True
    return False


def derive_family(name: str, symbol: str | None, timeframe: str | None) -> str:
    fam = name or ""
    if symbol:
        fam = fam.replace(f"_{symbol.lower()}", "")
    if timeframe:
        fam = fam.replace(f"_{timeframe.lower()}", "")
    return fam


def select_strategy_set(strategies_path: str) -> tuple[list[dict], list[dict]]:
    """Returns (fvg_entries, control_entries)."""
    data = json.loads(Path(strategies_path).read_text(encoding="utf-8"))
    fvg_entries: list[dict] = []
    control_entries: list[dict] = []
    for entry in data:
        strat = entry.get("strategy", {})
        name = strat.get("name", "")
        symbol = strat.get("symbol")
        timeframe = strat.get("timeframe")
        family = derive_family(name, symbol, timeframe)
        if is_fvg_tagged(entry):
            fvg_entries.append(entry)
        elif family in CONTROL_FAMILY_ALLOWLIST:
            control_entries.append(entry)
    return fvg_entries, control_entries


def _lookback_start(timeframe: str) -> str:
    from datetime import datetime, timedelta

    days = TIMEFRAME_LOOKBACK_DAYS.get(timeframe, DEFAULT_LOOKBACK_DAYS)
    end = datetime.strptime(GLOBAL_END_DATE, "%Y-%m-%d")
    start = end - timedelta(days=days)
    return start.strftime("%Y-%m-%d")


def simulate_measurement_trades(
    df,
    entry_long: np.ndarray,
    entry_short: np.ndarray,
    atr: np.ndarray,
) -> list[dict]:
    """Minimal, symmetric, deterministic ATR bracket applied identically regardless of mode or
    strategy — see module docstring "MEASUREMENT BRACKET". No pyramiding: skips bars while a
    measurement position is open. Never reads a bar beyond the one it is currently evaluating
    (no look-ahead) — stop/target checks at bar j use only bar j's high/low."""
    n = len(df)
    close = df["close"].to_numpy().astype(np.float64)
    high = df["high"].to_numpy().astype(np.float64)
    low = df["low"].to_numpy().astype(np.float64)
    ts_col = df["ts_event"].to_list() if "ts_event" in df.columns else [None] * n

    trades: list[dict] = []
    in_position_until = -1

    for i in range(n):
        if i <= in_position_until:
            continue
        direction = "long" if entry_long[i] else ("short" if entry_short[i] else None)
        if direction is None:
            continue
        a = atr[i]
        if a is None or (isinstance(a, float) and np.isnan(a)) or a <= 0:
            continue

        entry_price = close[i]
        stop_dist = MEASUREMENT_STOP_ATR_MULT * float(a)
        target_dist = MEASUREMENT_TARGET_ATR_MULT * float(a)
        limit = min(n - 1, i + MEASUREMENT_MAX_HOLD_BARS)

        exit_idx = None
        exit_price = None
        for j in range(i + 1, limit + 1):
            if direction == "long":
                if low[j] <= entry_price - stop_dist:
                    exit_idx, exit_price = j, entry_price - stop_dist
                    break
                if high[j] >= entry_price + target_dist:
                    exit_idx, exit_price = j, entry_price + target_dist
                    break
            else:
                if high[j] >= entry_price + stop_dist:
                    exit_idx, exit_price = j, entry_price + stop_dist
                    break
                if low[j] <= entry_price - target_dist:
                    exit_idx, exit_price = j, entry_price - target_dist
                    break

        if exit_idx is None:
            exit_idx = limit
            exit_price = close[limit]

        pnl_points = (exit_price - entry_price) if direction == "long" else (entry_price - exit_price)
        r = pnl_points / stop_dist

        trades.append(
            {
                "entry_ts": ts_col[i].isoformat() if ts_col[i] is not None else None,
                "exit_ts": ts_col[exit_idx].isoformat() if ts_col[exit_idx] is not None else None,
                "pnl": r,
                "risk_points": 1.0,
                "point_value": 1.0,
                "direction": direction,
            }
        )
        in_position_until = exit_idx

    return trades


def run_one_strategy_one_mode(entry: dict, df, atr: np.ndarray, mode_on: bool) -> dict:
    strat = entry["strategy"]
    compiled_spec = entry["compiled_spec"]
    name = strat["name"]
    symbol = strat["symbol"]
    timeframe = strat["timeframe"]

    prior = os.environ.get("TF_FVG_IDENTITY_ENABLED")
    os.environ["TF_FVG_IDENTITY_ENABLED"] = "true" if mode_on else "false"
    try:
        strategy = from_compiled_spec(compiled_spec, symbol=symbol, timeframe=timeframe, strategy_name=name)
        approximation_used = strategy.binding_plan.approximation_used
        out = strategy.compute(df)
        entry_long = out["entry_long"].to_numpy()
        entry_short = out["entry_short"].to_numpy()
        trades = simulate_measurement_trades(df, entry_long, entry_short, atr)
    finally:
        if prior is None:
            os.environ.pop("TF_FVG_IDENTITY_ENABLED", None)
        else:
            os.environ["TF_FVG_IDENTITY_ENABLED"] = prior

    return {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "family": derive_family(name, symbol, timeframe),
        "approximation_used": approximation_used,
        "n_entry_signals": int(entry_long.sum() + entry_short.sum()),
        "trades": trades,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strategies", default="docs/designs/corpus-v2-mode-ab-strategies.json")
    ap.add_argument("--out-before", default="fvg_experiment_before.json")
    ap.add_argument("--out-after", default="fvg_experiment_after.json")
    ap.add_argument("--report-out", default="fvg_experiment_run_report.json")
    ap.add_argument("--limit", type=int, default=None, help="cap total strategies processed (debug)")
    args = ap.parse_args()

    fvg_entries, control_entries = select_strategy_set(args.strategies)
    all_entries = fvg_entries + control_entries
    if args.limit:
        all_entries = all_entries[: args.limit]

    print(
        f"fvg-experiment-controlled-run: {len(fvg_entries)} FVG-tagged, {len(control_entries)} "
        f"control, {len(all_entries)} total (limit={args.limit})",
        file=sys.stderr,
    )

    manifest_before: dict[str, dict] = {}
    manifest_after: dict[str, dict] = {}
    per_strategy_report: list[dict] = []
    data_cache: dict[tuple[str, str], Any] = {}

    for idx, entry in enumerate(all_entries):
        strat = entry["strategy"]
        name = strat["name"]
        symbol = strat["symbol"]
        timeframe = strat["timeframe"]
        t0 = time.time()
        rec: dict[str, Any] = {"name": name, "symbol": symbol, "timeframe": timeframe, "is_fvg": idx < len(fvg_entries)}
        try:
            key = (symbol, timeframe)
            if key not in data_cache:
                start = _lookback_start(timeframe)
                data_cache[key] = load_ohlcv(symbol, TF_TO_LOADER.get(timeframe, timeframe), start, GLOBAL_END_DATE)
            df = data_cache[key]
            atr = compute_atr(df, ATR_PERIOD).to_numpy()

            res_before = run_one_strategy_one_mode(entry, df, atr, mode_on=False)
            res_after = run_one_strategy_one_mode(entry, df, atr, mode_on=True)

            sid = name
            manifest_before[sid] = {
                "name": name, "symbol": symbol, "timeframe": timeframe,
                "family": res_before["family"], "trades": res_before["trades"],
            }
            manifest_after[sid] = {
                "name": name, "symbol": symbol, "timeframe": timeframe,
                "family": res_after["family"], "trades": res_after["trades"],
            }
            rec.update(
                {
                    "n_bars": len(df),
                    "approximation_before": res_before["approximation_used"],
                    "approximation_after": res_after["approximation_used"],
                    "n_entry_signals_before": res_before["n_entry_signals"],
                    "n_entry_signals_after": res_after["n_entry_signals"],
                    "n_trades_before": len(res_before["trades"]),
                    "n_trades_after": len(res_after["trades"]),
                    "elapsed_seconds": round(time.time() - t0, 2),
                    "error": None,
                }
            )
        except Exception as exc:  # noqa: BLE001 — record and continue; one bad strategy must not kill the batch
            rec["error"] = f"{type(exc).__name__}: {exc}"
            rec["traceback"] = traceback.format_exc()[-2000:]
            rec["elapsed_seconds"] = round(time.time() - t0, 2)

        per_strategy_report.append(rec)
        print(
            f"  [{idx + 1}/{len(all_entries)}] {name}: {rec.get('error') or 'OK'} "
            f"({rec['elapsed_seconds']}s)",
            file=sys.stderr,
        )

    Path(args.out_before).write_text(json.dumps({"strategies": manifest_before}, default=str), encoding="utf-8")
    Path(args.out_after).write_text(json.dumps({"strategies": manifest_after}, default=str), encoding="utf-8")

    report = {
        "n_fvg_tagged": len(fvg_entries),
        "n_control": len(control_entries),
        "n_total": len(all_entries),
        "per_strategy": per_strategy_report,
    }
    Path(args.report_out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8", newline="\n")
    print(f"\nwrote {args.out_before}, {args.out_after}, {args.report_out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
