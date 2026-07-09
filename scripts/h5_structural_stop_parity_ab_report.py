"""H5 admission-stop-parity A/B harness (deep-scan #15, 2026-07-03).

FINDING (see src/engine/backtester.py::_resolve_stop_risk_points docstring for
full detail): the backtest trade-management loops recomputed
risk_points = min(ceiling, atr_at_entry * atr_stop_multiplier) at 5 sites,
independently of the STRUCTURAL stop (sweep_wick > order_block > FVG >
swing_point, ceiling-checked) that apply_eligibility_gate() actually used to
admit the trade. The fix threads that structural distance forward so the
management loop uses the SAME stop that justified admission, gated behind
BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED (default true).

WHAT THIS HARNESS MEASURES
--------------------------
This is a FOCUSED isolation harness, not a full end-to-end strategy backtest.
It exercises the REAL production functions on BOTH sides of the fix:
  - src.engine.context.structural_stops.compute_structural_stop()  (unchanged)
  - src.engine.backtester._apply_trade_management()                (the fix)
  - src.engine.backtester._resolve_stop_risk_points()               (the fix)

on a synthetic-but-realistic MES 5-min bar series with genuine structural
levels (order blocks / swing points / sweep wicks), so the P&L/Sharpe/trade-
count delta reported below isolates the STOP-MODEL change specifically —
uncontaminated by unrelated per-run noise (data source availability, strategy
DSL routing, LLM-derived entries, etc.). It is fully self-contained
(deterministic, seeded, no S3/network/live-server dependency) so it runs the
same way in CI, on the tower, or in an isolated agent sandbox.

This does NOT replace re-running real production backtests with the flag
toggled (`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED=false` vs the new default
`true`) on real historical strategies — that is the actual re-baseline the
operator authorized, and this harness's job is to give an honest a-priori
estimate of magnitude before committing to that (potentially expensive)
re-run, plus a fast regression check that never depends on data availability.

USAGE
-----
    python -m scripts.h5_structural_stop_parity_ab_report
    python -m scripts.h5_structural_stop_parity_ab_report --n-trades 500 --seed 7
    python -m scripts.h5_structural_stop_parity_ab_report --symbol MNQ

Writes docs/replay-results/<ISO>-h5-structural-stop-parity-ab-report.md and
prints the summary to stdout. Exit code 0 always (report-only; this harness
does not gate anything — see CLAUDE.md §12 for the actual production gates).
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Belt-and-suspenders: this harness must never accidentally pick up an
# operator's local override that would make the A/B comparison meaningless.
os.environ.pop("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", None)
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


SYMBOL_POINT_VALUE = {"MES": 5.00, "MNQ": 2.00, "MCL": 100.00}
SYMBOL_TICK_SIZE = {"MES": 0.25, "MNQ": 0.25, "MCL": 0.01}
SYMBOL_BASE_PRICE = {"MES": 5000.0, "MNQ": 18000.0, "MCL": 75.0}
SYMBOL_ATR = {"MES": 6.0, "MNQ": 30.0, "MCL": 0.35}


def _generate_synthetic_bars(symbol: str, n_bars: int, seed: int) -> tuple[np.ndarray, ...]:
    """Deterministic synthetic OHLCV series with realistic intrabar noise.

    Not a strategy backtest — just a plausible 5-min bar series (bounded
    random walk + per-bar noise) long enough to host n_bars/20-ish trades
    with genuine structural pullback/swing structure for compute_structural_stop
    to key off of.
    """
    rng = np.random.default_rng(seed)
    base = SYMBOL_BASE_PRICE[symbol]
    atr = SYMBOL_ATR[symbol]
    tick = SYMBOL_TICK_SIZE[symbol]

    # Random-walk close series with mean-reverting drift to stay bounded.
    steps = rng.normal(loc=0.0, scale=atr * 0.15, size=n_bars)
    close = base + np.cumsum(steps)
    # Gentle mean reversion to keep the series bounded over long runs.
    close = close - np.cumsum((close - base) * 0.002)

    open_ = np.empty(n_bars)
    open_[0] = close[0]
    open_[1:] = close[:-1]

    intrabar_range = np.abs(rng.normal(loc=atr * 0.6, scale=atr * 0.2, size=n_bars))
    intrabar_range = np.clip(intrabar_range, tick * 4, atr * 3.0)
    high = np.maximum(open_, close) + intrabar_range * rng.uniform(0.2, 0.6, size=n_bars)
    low = np.minimum(open_, close) - intrabar_range * rng.uniform(0.2, 0.6, size=n_bars)

    atr_series = np.full(n_bars, atr) * rng.uniform(0.8, 1.2, size=n_bars)

    return open_, high, low, close, atr_series


def _build_admitted_trades(
    symbol: str, open_np, high_np, low_np, close_np, atr_np,
    n_trades: int, seed: int,
) -> tuple[pd.DataFrame, dict]:
    """Synthesize N admitted TAKE/REDUCE trades with REAL compute_structural_stop()
    output, mirroring exactly what apply_eligibility_gate() would have recorded.

    Half the trades get a structural level TIGHTER than the legacy ATR-clamp
    fallback (the H5 bug's blind spot) and half get one comparable to/wider
    than it (so the A/B delta reflects a realistic mix, not a cherry-picked
    worst case).
    """
    from src.engine.backtester import _get_stop_ceiling_for_symbol
    from src.engine.context.structural_stops import compute_structural_stop

    rng = np.random.default_rng(seed + 1)
    point_value = SYMBOL_POINT_VALUE[symbol]
    tick = SYMBOL_TICK_SIZE[symbol]
    ceiling = _get_stop_ceiling_for_symbol(symbol)
    n_bars = len(close_np)

    hold_bars = 12  # ~1 hour on 5-min bars
    # Signal bars spaced out so trades don't overlap and stay in-range.
    max_signal_bar = n_bars - hold_bars - 2
    signal_bars = np.linspace(1, max_signal_bar, n_trades, dtype=int)

    rows = []
    structural_map: dict = {"long": {}, "short": {}}

    for i, signal_bar in enumerate(signal_bars):
        is_short = bool(rng.integers(0, 2))
        direction = "short" if is_short else "long"
        entry_price = float(close_np[signal_bar])
        atr_here = float(atr_np[signal_bar])

        # Realistic structural level: alternate tight (order-block/sweep,
        # inside recent noise) vs wide (further swing point).
        tight = (i % 2 == 0)
        offset = atr_here * (rng.uniform(0.3, 0.7) if tight else rng.uniform(1.3, 2.2))
        if direction == "long":
            structural_level = entry_price - offset
            stop_plan = compute_structural_stop(
                direction="long", entry_price=entry_price, point_value=point_value,
                atr=atr_here, tick_size=tick, symbol=symbol,
                nearest_ob_below=structural_level if tight else None,
                nearest_swing_low=structural_level if not tight else None,
                max_stop_points=ceiling,
            )
        else:
            structural_level = entry_price + offset
            stop_plan = compute_structural_stop(
                direction="short", entry_price=entry_price, point_value=point_value,
                atr=atr_here, tick_size=tick, symbol=symbol,
                nearest_ob_above=structural_level if tight else None,
                nearest_swing_high=structural_level if not tight else None,
                max_stop_points=ceiling,
            )

        if stop_plan.skip_trade:
            # Ceiling-exceeded — apply_eligibility_gate would SKIP this signal
            # entirely (never becomes a trade). Not counted.
            continue

        entry_idx = int(signal_bar) + 1  # next-bar-fill convention
        exit_idx = min(entry_idx + hold_bars, n_bars - 1)

        structural_map[direction][int(signal_bar)] = {
            "distance": abs(entry_price - stop_plan.stop_price),
            "stop_price": stop_plan.stop_price,
            "stop_reason": stop_plan.stop_reason,
        }

        rows.append({
            "Avg Entry Price": entry_price,
            "Avg Exit Price": float(close_np[exit_idx]),  # vectorbt-style baseline exit
            "Size": 1.0,
            "Direction": "Short" if is_short else "Long",
            "Entry Idx": entry_idx,
            "Exit Idx": exit_idx,
        })

    return pd.DataFrame(rows), structural_map


def _sharpe(pnls: list[float]) -> float:
    if len(pnls) < 2:
        return 0.0
    mean = statistics.mean(pnls)
    stdev = statistics.pstdev(pnls)
    if stdev == 0:
        return 0.0
    return round((mean / stdev) * (len(pnls) ** 0.5), 4)


def run_ab(symbol: str, n_trades: int, seed: int, n_bars: int) -> dict:
    from src.engine.backtester import _apply_trade_management
    from src.engine.config import ContractSpec

    point_value = SYMBOL_POINT_VALUE[symbol]
    tick = SYMBOL_TICK_SIZE[symbol]
    spec = ContractSpec(tick_size=tick, tick_value=point_value * tick, point_value=point_value)

    open_np, high_np, low_np, close_np, atr_np = _generate_synthetic_bars(symbol, n_bars, seed)
    df = pl.DataFrame({
        "open": open_np.tolist(), "high": high_np.tolist(),
        "low": low_np.tolist(), "close": close_np.tolist(),
        "atr_14": atr_np.tolist(),
    })

    records, structural_map = _build_admitted_trades(
        symbol, open_np, high_np, low_np, close_np, atr_np, n_trades, seed,
    )
    if len(records) == 0:
        raise RuntimeError("No admitted trades synthesized — widen ceiling or n_trades")

    def _pnl(mgmt_row: dict, direction: str) -> float:
        entry_p = mgmt_row["entry_price"]
        exit_p = mgmt_row["exit_price"]
        gross_points = (exit_p - entry_p) if direction == "Long" else (entry_p - exit_p)
        return gross_points * point_value  # size=1 contract; isolates the stop-model delta

    # ─── OLD arm: legacy ATR-clamp (flag OFF) ──────────────────────────
    os.environ["BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED"] = "false"
    managed_old = _apply_trade_management(
        records, high_np, low_np, close_np, atr_np,
        spec, None, df, open_np=open_np,
        structural_stop_map=structural_map,
    )

    # ─── NEW arm: structural admission stop (flag ON, default) ─────────
    os.environ["BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED"] = "true"
    managed_new = _apply_trade_management(
        records, high_np, low_np, close_np, atr_np,
        spec, None, df, open_np=open_np,
        structural_stop_map=structural_map,
    )
    os.environ.pop("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", None)

    directions = records["Direction"].tolist()
    pnls_old = [_pnl(m, d) for m, d in zip(managed_old, directions, strict=True)]
    pnls_new = [_pnl(m, d) for m, d in zip(managed_new, directions, strict=True)]

    affected = [
        i for i in range(len(managed_old))
        if abs(managed_old[i]["risk_points"] - managed_new[i]["risk_points"]) > 1e-9
    ]

    per_trade_rows = []
    for i in range(min(20, len(managed_old))):
        per_trade_rows.append({
            "trade_i": i,
            "direction": directions[i],
            "old_risk_points": managed_old[i]["risk_points"],
            "new_risk_points": managed_new[i]["risk_points"],
            "old_stop_basis": managed_old[i]["stop_basis"],
            "new_stop_basis": managed_new[i]["stop_basis"],
            "old_exit_reason": managed_old[i]["exit_reason"],
            "new_exit_reason": managed_new[i]["exit_reason"],
            "old_pnl": round(pnls_old[i], 2),
            "new_pnl": round(pnls_new[i], 2),
            "pnl_delta": round(pnls_new[i] - pnls_old[i], 2),
        })

    return {
        "symbol": symbol,
        "n_trades": len(managed_old),
        "n_affected_trades": len(affected),
        "pct_affected": round(100.0 * len(affected) / len(managed_old), 1),
        "total_pnl_old": round(sum(pnls_old), 2),
        "total_pnl_new": round(sum(pnls_new), 2),
        "total_pnl_delta": round(sum(pnls_new) - sum(pnls_old), 2),
        "sharpe_old": _sharpe(pnls_old),
        "sharpe_new": _sharpe(pnls_new),
        "avg_risk_points_old": round(statistics.mean(m["risk_points"] for m in managed_old), 3),
        "avg_risk_points_new": round(statistics.mean(m["risk_points"] for m in managed_new), 3),
        "stop_loss_count_old": sum(1 for m in managed_old if m["exit_reason"] in ("stop_loss", "trailing_stop")),
        "stop_loss_count_new": sum(1 for m in managed_new if m["exit_reason"] in ("stop_loss", "trailing_stop")),
        "per_trade_sample": per_trade_rows,
    }


def _write_report(result: dict) -> Path:
    out_dir = REPO_ROOT / "docs" / "replay-results"
    out_dir.mkdir(parents=True, exist_ok=True)
    iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")  # noqa: UP017 — py312 datetime.UTC not used repo-wide yet
    out_path = out_dir / f"{iso}-h5-structural-stop-parity-ab-report.md"

    lines = [
        "# H5 Structural-Stop-Parity A/B Report (deep-scan #15, 2026-07-03)",
        "",
        f"Generated: {iso}",
        f"Symbol: {result['symbol']}",
        f"Trades synthesized: {result['n_trades']}",
        "",
        "## Isolation-harness caveat",
        "",
        "This report isolates the STOP-MODEL delta on a synthetic-but-real-code-path",
        "series (see script docstring). It is NOT a full production strategy backtest.",
        "Use it to gauge re-baseline magnitude before re-running real historical",
        "backtests with the flag toggled.",
        "",
        "## Summary",
        "",
        f"- Trades with a DIFFERENT risk_points under the fix: "
        f"{result['n_affected_trades']} / {result['n_trades']} "
        f"({result['pct_affected']}%)",
        f"- Total P&L (old ATR-clamp): ${result['total_pnl_old']:,.2f}",
        f"- Total P&L (new structural): ${result['total_pnl_new']:,.2f}",
        f"- Total P&L delta: ${result['total_pnl_delta']:,.2f}",
        f"- Sharpe-like ratio (old): {result['sharpe_old']}",
        f"- Sharpe-like ratio (new): {result['sharpe_new']}",
        f"- Avg risk_points (old): {result['avg_risk_points_old']}",
        f"- Avg risk_points (new): {result['avg_risk_points_new']}",
        f"- Stop/trail exits (old): {result['stop_loss_count_old']}",
        f"- Stop/trail exits (new): {result['stop_loss_count_new']}",
        "",
        "## Per-trade sample (first 20)",
        "",
        "| # | dir | old risk_pts | new risk_pts | old basis | new basis | old exit | new exit | old P&L | new P&L | delta |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in result["per_trade_sample"]:
        lines.append(
            f"| {r['trade_i']} | {r['direction']} | {r['old_risk_points']} | {r['new_risk_points']} | "
            f"{r['old_stop_basis']} | {r['new_stop_basis']} | {r['old_exit_reason']} | {r['new_exit_reason']} | "
            f"{r['old_pnl']} | {r['new_pnl']} | {r['pnl_delta']} |"
        )
    lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MES", choices=list(SYMBOL_POINT_VALUE.keys()))
    parser.add_argument("--n-trades", type=int, default=200)
    parser.add_argument("--n-bars", type=int, default=4000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--json", action="store_true", help="print raw JSON instead of the summary")
    args = parser.parse_args()

    result = run_ab(args.symbol, args.n_trades, args.seed, args.n_bars)
    report_path = _write_report(result)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"H5 structural-stop-parity A/B report ({args.symbol}, seed={args.seed})")
        print(f"  Trades synthesized:        {result['n_trades']}")
        print(f"  Trades with a changed stop: {result['n_affected_trades']} "
              f"({result['pct_affected']}%)")
        print(f"  Total P&L  old -> new:     ${result['total_pnl_old']:,.2f} -> "
              f"${result['total_pnl_new']:,.2f}  (delta ${result['total_pnl_delta']:,.2f})")
        print(f"  Sharpe-like old -> new:    {result['sharpe_old']} -> {result['sharpe_new']}")
        print(f"  Avg risk_points old -> new: {result['avg_risk_points_old']} -> "
              f"{result['avg_risk_points_new']}")
        print(f"  Stop/trail exits old -> new: {result['stop_loss_count_old']} -> "
              f"{result['stop_loss_count_new']}")
        print(f"  Report written to: {report_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
