#!/usr/bin/env python3
"""ALGO-188 report — reads the backtest artifact and reports against ALGO-186 §6 exactly.

EVERY FIELD §6 NAMES, and nothing selected after the fact:
  window with its holes · trade count · win rate · FULL R-DISTRIBUTION not just the mean ·
  total P&L · BOTH MAE figures · sessions with no trade · wall-clock and worker count.

🛑 THE MAE RULE, PRE-REGISTERED BY ALGO-186 AND IMPLEMENTED HERE, NOT INVENTED HERE:
  RAW      the pessimistic bound. `mae_points` is already signed-negative AND carries the exit
           bar's FULL extreme after the stop has filled - a stop that filled at -17.25 can report
           -79.8. Publishing raw alone overstates drawdown enormously.
  CLAMPED  min(pts, max(mae, -(stop+slip))) - the account-equity figure. Fires ONLY on stop-family
           rows, because on a non-stop row there is no fill to clamp against.
  BOTH, NEVER ONE.
  CONTROL  the stop-family set must contain ZERO winners. IF A WINNER APPEARS THERE, THE CLAMP IS
           WRONG AND NO DRAWDOWN NUMBER IS PUBLISHED AT ALL. That is a refusal, not a caveat.

The R-distribution is reported as full deciles plus the raw histogram, because a mean over a
bimodal stop/target distribution describes neither mode.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd

ART = Path("research/current_mnq_strategy_v2_4_algo188_backtest_trades.json")
STOP_POINTS = 17.25
SLIP = 0.25                      # one tick; the executable-stop convention already in the engine
POINT_VALUE, CONTRACTS = 2.0, 15


def main() -> None:
    d = json.load(io.open(ART, encoding="utf-8"))
    rows = d["rows"]
    errs = [r for r in rows if r.get("_error")]
    no_trade = [r for r in rows if r.get("_no_trade")]
    trades = [r for r in rows if not r.get("_no_trade") and not r.get("_error")]

    print("=" * 78)
    print("ALGO-188 - v2.4 BACKTEST ON THE FULL CONTIGUOUS HISTORY")
    print("=" * 78)
    print(f"WINDOW           {d['window'][0]}..{d['window'][1]}")
    print( "  HOLES          48 months absent inside the parquet's span: ALL of 2016, 2017, 2019,")
    print( "                 plus most of 2015 and 2018. Excluded because a 40-day lookback map")
    print( "                 cannot be built across a gap. This is NOT a clean 2015-2026 run.")
    print(f"SESSIONS         {d['sessions']}")
    print(f"WORKERS          {d['workers']}")
    print(f"WALL-CLOCK       {d['wall_clock_s']/60:.1f} min")
    print(f"TRADES           {len(trades)}")
    print(f"NO-TRADE         {len(no_trade)}")
    print(f"ERRORS           {len(errs)}   <- recorded, never dropped")
    for e in errs[:5]:
        print(f"    {e['session']}: {str(e['_error'])[:100]}")
    if not trades:
        print("\nNO TRADES. Nothing further is reportable and no branch is claimed.")
        return

    df = pd.DataFrame(trades)
    r = pd.to_numeric(df["r"], errors="coerce").dropna()
    net = pd.to_numeric(df.get("net_pnl"), errors="coerce")
    mae = pd.to_numeric(df.get("mae_points"), errors="coerce")
    reason = df.get("exit_reason").astype(str)

    wins = (r > 0).sum()
    print(f"\nWIN RATE         {100*wins/len(r):.1f}%   ({wins}/{len(r)})")
    print(f"TOTAL P&L        ${net.sum():,.0f}   at {CONTRACTS} MNQ, ${POINT_VALUE}/pt")
    print(f"  per trade      ${net.mean():,.2f}")

    print("\nFULL R-DISTRIBUTION (a mean over a bimodal stop/target distribution describes neither)")
    print(f"  n {len(r)}   mean {r.mean():+.3f}   median {r.median():+.3f}   std {r.std():.3f}")
    q = r.quantile([0.0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.0])
    print("  deciles: " + "  ".join(f"p{int(k*100)}={v:+.2f}" for k, v in q.items()))
    bins = [-99, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 99]
    print("  histogram:")
    for lo, hi in zip(bins, bins[1:]):
        c = int(((r > lo) & (r <= hi)).sum())
        if c:
            print(f"    ({lo:>5} , {hi:>5} ]  {c:5d}  {'#' * min(60, c * 60 // max(1,len(r)))}")

    print(f"\nEXIT REASONS: {reason.value_counts().to_dict()}")

    # ── MAE, both figures, with the control that gates them ──
    stop_family = reason.str.contains("STOP", case=False, na=False)
    stop_winners = int(((r > 0) & stop_family).sum())
    print(f"\nMAE - BOTH FIGURES, PER ALGO-186")
    print(f"  stop-family rows          {int(stop_family.sum())}")
    print(f"  CONTROL - winners in it   {stop_winners}   (must be 0)")
    if stop_winners:
        print("  🛑 CONTROL FAILED. A winner appears in the stop family, so the clamp's premise is")
        print("     wrong. NO DRAWDOWN NUMBER IS PUBLISHED. This is a refusal, not a caveat.")
        return
    pts = r * STOP_POINTS
    clamped = mae.copy()
    floor = -(STOP_POINTS + SLIP)
    clamped[stop_family] = pts[stop_family].combine(
        mae[stop_family].clip(lower=floor), min)
    print(f"  RAW      worst {mae.min():.2f} pts   mean {mae.mean():.2f}")
    print(f"  CLAMPED  worst {clamped.min():.2f} pts   mean {clamped.mean():.2f}")
    print(f"  the two differ on {int((mae != clamped).sum())} rows")
    print(f"  NOTE: STOP_POINTS = {STOP_POINTS}, so every stop realises a fixed loss and the")
    print( "        one-bullet daily cap is STRUCTURAL. A raw-MAE figure destroys that fact.")

    eq, peak, mdd = 0.0, 0.0, 0.0
    for v in net.fillna(0):
        eq += v
        peak = max(peak, eq)
        mdd = min(mdd, eq - peak)
    print(f"\nEQUITY   final ${eq:,.0f}   max drawdown ${mdd:,.0f}")


if __name__ == "__main__":
    main()
