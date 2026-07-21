#!/usr/bin/env python3
"""
OVERLAY ATTRIBUTION (2026-07-02) — GPT's per-layer funnel + operator's A+ retention + daily-band metrics.

The corpus sweep showed the overlay is a consistent RISK-SHAPER (Sharpe up, DD down, retention 35%). This tool
answers the question that actually decides the verdict, per the operator's 1-2-A+-trades/day / 14-24-pts-per-day
mission: **WHICH trades did the overlay remove — mediocre ones (good) or A+ winners (bad)?**

Method (no extra replay needed): Mode A already TOOK every trade the overlay later rejects, so the removed set's
counterfactual P&L = Mode A trades minus Mode B trades (matched by entry timestamp). Per-layer attribution joins
Mode B's gate `skipped_signals` (bar_idx, first-rejecting reason — additive instrumentation 2026-07-02) to the
Mode A trades entered on those bars.

Outputs, per strategy:
  1. PER-LAYER TABLE: reason -> {rejected, joined counterfactual trades, avg P&L if taken, missed winners,
     missed losers, missed A+ (favorable >= APLUS_POINTS pts)}
  2. A+ RETENTION: of Mode A's A+ trades (>= APLUS_POINTS pts profit @1 lot), how many did Mode B keep?
  3. DAILY-BAND METRICS (operator's daily lens, both modes): % days in +14..+24 pts band, % > +24, % flat/no-trade,
     % losing, avg losing day, worst day, max consecutive losing days.

Usage (tower, with AWS creds + TF_ALLOW_FIXED_1=true + DATA_CACHE_TTL_SECONDS + PYTHONPATH=.):
  python scripts/overlay-attribution.py --strategy-class src.engine.strategies.mitigation.MitigationStrategy \
      --start 2023-01-01 --end 2025-12-01
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import statistics

MES_POINT_VALUE = 5.0
APLUS_POINTS = float(os.environ.get("APLUS_POINTS", "14"))   # operator: 14-24 pt daily target; A+ = >=14pt winner
BAND_LO_PTS, BAND_HI_PTS = 14.0, 24.0


def run_mode(strategy_class_path: str, overlay_on: bool, start: str, end: str) -> dict:
    from src.engine.backtester import run_class_backtest
    os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "false" if overlay_on else "true"
    module_path, class_name = strategy_class_path.rsplit(".", 1)
    cls = getattr(importlib.import_module(module_path), class_name)
    return run_class_backtest(
        strategy=cls(), start_date=start, end_date=end,
        slippage_ticks=1.0, commission_per_side=0.62, firm_key="topstep_50k",
        skip_eligibility_gate=not overlay_on, max_trades_per_day=2, use_performance_gate=False,
    )


def entry_key(t: dict) -> str:
    return str(t.get("Entry Timestamp") or t.get("entry_time") or t.get("Entry Idx") or "")


def pts(t: dict) -> float:
    return float(t.get("PnL", t.get("pnl", 0.0)) or 0.0) / MES_POINT_VALUE  # fixed 1 contract


def daily_band_metrics(daily_pnls: list, label: str) -> dict:
    """Operator's daily lens (P&L in dollars @1 lot -> points)."""
    days = [float(x) / MES_POINT_VALUE for x in (daily_pnls or [])]
    n = len(days)
    if not n:
        return {"mode": label, "days": 0}
    losing = [d for d in days if d < 0]
    flat = sum(1 for d in days if d == 0)
    worst = min(days)
    max_consec = cur = 0
    for d in days:
        cur = cur + 1 if d < 0 else 0
        max_consec = max(max_consec, cur)
    return {
        "mode": label, "days": n,
        "pct_days_in_14_24_band": round(100 * sum(1 for d in days if BAND_LO_PTS <= d <= BAND_HI_PTS) / n, 1),
        "pct_days_above_24": round(100 * sum(1 for d in days if d > BAND_HI_PTS) / n, 1),
        "pct_flat_or_no_trade": round(100 * flat / n, 1),
        "pct_losing_days": round(100 * len(losing) / n, 1),
        "avg_losing_day_pts": round(statistics.mean(losing), 2) if losing else 0.0,
        "worst_day_pts": round(worst, 2),
        "max_consecutive_losing_days": max_consec,
        "avg_day_pts": round(statistics.mean(days), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy-class", required=True)
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2025-12-01")
    ap.add_argument("--out", default="docs/designs/overlay-attribution-2026-07-02.json")
    args = ap.parse_args()

    a = run_mode(args.strategy_class, overlay_on=False, start=args.start, end=args.end)  # Mode A: source only
    b = run_mode(args.strategy_class, overlay_on=True, start=args.start, end=args.end)   # Mode B: + overlay

    a_trades, b_trades = a.get("trades", []), b.get("trades", [])
    b_keys = {entry_key(t) for t in b_trades}
    removed = [t for t in a_trades if entry_key(t) not in b_keys]
    kept = [t for t in a_trades if entry_key(t) in b_keys]

    # ── A+ retention (the operator's real metric) ──
    a_aplus = [t for t in a_trades if pts(t) >= APLUS_POINTS]
    kept_aplus = [t for t in a_aplus if entry_key(t) in b_keys]
    removed_winners = [t for t in removed if pts(t) > 0]
    removed_losers = [t for t in removed if pts(t) <= 0]
    removed_aplus = [t for t in removed if pts(t) >= APLUS_POINTS]

    # ── per-layer attribution: join Mode B's skipped_signals -> Mode A trades by entry bar idx ──
    gs = b.get("gate_stats", {})
    skipped = (gs.get("long", {}).get("skipped_signals", []) or []) + (gs.get("short", {}).get("skipped_signals", []) or [])
    a_by_idx = {}
    for t in a_trades:
        try:
            a_by_idx[int(float(t.get("Entry Idx", t.get("entry_idx", -1))))] = t
        except (TypeError, ValueError):
            pass
    layers: dict = {}
    for srec in skipped:
        reason = srec["reason"][:60]
        L = layers.setdefault(reason, {"rejected_signals": 0, "joined_trades": 0, "pnls_pts": []})
        L["rejected_signals"] += 1
        for off in (0, 1, 2):  # +1-bar entry convention: signal bar -> entry within next bars
            t = a_by_idx.get(srec["bar_idx"] + off)
            if t is not None:
                L["joined_trades"] += 1
                L["pnls_pts"].append(pts(t))
                break
    layer_table = []
    for reason, L in sorted(layers.items(), key=lambda kv: -kv[1]["rejected_signals"]):
        p = L["pnls_pts"]
        layer_table.append({
            "layer_reason": reason,
            "rejected_signals": L["rejected_signals"],
            "counterfactual_trades_joined": L["joined_trades"],
            "avg_pnl_if_taken_pts": round(statistics.mean(p), 2) if p else None,
            "missed_winners": sum(1 for x in p if x > 0),
            "missed_losers": sum(1 for x in p if x <= 0),
            "missed_aplus": sum(1 for x in p if x >= APLUS_POINTS),
        })

    report = {
        "strategy": args.strategy_class, "window": f"{args.start}..{args.end}",
        "aplus_definition_pts": APLUS_POINTS,
        "mode_a": {"trades": len(a_trades), "sharpe": a.get("sharpe_ratio"), "max_dd": a.get("max_drawdown")},
        "mode_b": {"trades": len(b_trades), "sharpe": b.get("sharpe_ratio"), "max_dd": b.get("max_drawdown")},
        "aplus_retention": {
            "aplus_in_source": len(a_aplus),
            "aplus_kept_by_overlay": len(kept_aplus),
            "aplus_retention_pct": round(100 * len(kept_aplus) / len(a_aplus), 1) if a_aplus else None,
            "aplus_REMOVED_by_overlay": len(removed_aplus),
        },
        "removed_set": {
            "removed_trades": len(removed),
            "missed_winners": len(removed_winners),
            "missed_losers": len(removed_losers),
            "removed_avg_pnl_pts": round(statistics.mean([pts(t) for t in removed]), 2) if removed else None,
            "removed_total_pnl_pts": round(sum(pts(t) for t in removed), 2),
            "kept_avg_pnl_pts": round(statistics.mean([pts(t) for t in kept]), 2) if kept else None,
        },
        "per_layer": layer_table,
        "daily_bands": [daily_band_metrics(a.get("daily_pnls"), "Mode A (source only)"),
                        daily_band_metrics(b.get("daily_pnls"), "Mode B (+overlay)")],
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump(report, open(args.out, "w", encoding="utf-8", newline="\n"), indent=1)
    print(json.dumps(report, indent=1))
    print(f"\nfull report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
