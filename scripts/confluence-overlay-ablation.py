#!/usr/bin/env python3
"""
Confluence-overlay ablation harness (2026-06-30, #4 two-mode backtest reporting).

Runs the SAME strategy two ways and reports the comparison so the operator can decide whether the
Trading Forge institutional confluence overlay earns its place OUT-OF-SAMPLE (not just in-sample):

  1. source_entry_only       — YouTube source entry + TF risk/exit/sizing.   (confluence overlay OFF)
  2. tf_institutional_overlay — + default confluence eligibility gate.        (confluence overlay ON)

Mode toggle = TF_CONFLUENCE_OVERLAY_DISABLED env (read by apply_eligibility_gate in backtester.py) +
the matching run_class_backtest(skip_eligibility_gate=...) flag. The env var covers ALL invocation
paths (single backtest / walk-forward / MC), so the same toggle drives a WF/DSR/PBO/MC run too.

Keep/loosen rule (GPT / Bailey-Lopez de Prado PBO+DSR, Harvey-Liu-Zhu multiple-testing): KEEP the
overlay only if it improves risk-adjusted return WITHOUT starving trades. Every added condition raises
out-of-sample overfit risk, so an overlay that only helps in-sample or blocks most winners must LOOSEN.

NOTE: this mirrors scripts/wave25_exit_engine_ab_report.py and runs the engine directly — execute it on
the tower (the vectorbt-JIT engine does not run under this sandbox). Core single-backtest verdict here;
for the full WF + DSR/PBO + MC comparison, run your walk-forward/MC path under each value of
TF_CONFLUENCE_OVERLAY_DISABLED (the env toggle is global).

Usage:
  python scripts/confluence-overlay-ablation.py --strategy-class src.engine.strategies.bounce_off_level.BounceOffLevelStrategy \
      --start 2024-01-01 --end 2025-12-31
"""
from __future__ import annotations

import argparse
import importlib
import json
import os

# Min fraction of source_entry_only trades the overlay must preserve to avoid a "starves trades" verdict.
TRADE_FLOOR_PCT = float(os.environ.get("ABLATION_TRADE_FLOOR_PCT", "0.40"))


def _run_mode(strategy_class_path: str, mode: str, start_date: str, end_date: str) -> dict:
    """Run one backtest with the confluence overlay ON or OFF. Returns the comparison-relevant scalars."""
    from src.engine.backtester import run_class_backtest

    overlay_disabled = (mode == "source_entry_only")
    # Global toggle — covers single backtest + walk-forward + MC paths.
    os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "true" if overlay_disabled else "false"

    module_path, class_name = strategy_class_path.rsplit(".", 1)
    try:
        cls = getattr(importlib.import_module(module_path), class_name)
        strategy = cls()
    except Exception as exc:  # noqa: BLE001
        return {"mode": mode, "error": f"load {strategy_class_path}: {exc}"}

    try:
        result = run_class_backtest(
            strategy=strategy,
            start_date=start_date,
            end_date=end_date,
            slippage_ticks=1.0,
            commission_per_side=0.62,
            firm_key="topstep",
            skip_eligibility_gate=overlay_disabled,   # matches the env toggle for the direct call
            max_trades_per_day=2,
            use_performance_gate=False,
        )
    except Exception as exc:  # noqa: BLE001
        return {"mode": mode, "error": f"run_class_backtest {mode}: {exc}"}

    return {
        "mode": mode,
        "error": None,
        "total_pnl": result.get("total_return"),
        "sharpe": result.get("sharpe_ratio"),
        "profit_factor": result.get("profit_factor"),
        "max_dd": result.get("max_drawdown"),
        "avg_r": result.get("avg_rr"),
        "win_rate_pct": round((result.get("win_rate") or 0.0) * 100, 1),
        "trade_count": result.get("total_trades"),
    }


def _verdict(source: dict, overlay: dict) -> dict:
    """KEEP the overlay only if it improves risk-adjusted return WITHOUT starving trades; else LOOSEN."""
    if source.get("error") or overlay.get("error"):
        return {"verdict": "INDETERMINATE", "reason": source.get("error") or overlay.get("error")}

    s_trades = source.get("trade_count") or 0
    o_trades = overlay.get("trade_count") or 0
    s_sharpe = source.get("sharpe") or 0.0
    o_sharpe = overlay.get("sharpe") or 0.0
    s_pf = source.get("profit_factor") or 0.0
    o_pf = overlay.get("profit_factor") or 0.0

    trade_floor = TRADE_FLOOR_PCT * s_trades
    starves = o_trades < trade_floor
    improves_risk_adjusted = (o_sharpe > s_sharpe) or (o_pf > s_pf)

    if starves:
        verdict, reason = "LOOSEN", (
            f"overlay starves trades: {o_trades} < {trade_floor:.1f} "
            f"({TRADE_FLOOR_PCT:.0%} of source {s_trades})"
        )
    elif improves_risk_adjusted:
        verdict, reason = "KEEP", (
            f"overlay improves risk-adjusted return (Sharpe {s_sharpe:.2f}→{o_sharpe:.2f}, "
            f"PF {s_pf:.2f}→{o_pf:.2f}) and preserves {o_trades}/{s_trades} trades"
        )
    else:
        verdict, reason = "LOOSEN", (
            f"overlay does NOT improve risk-adjusted return (Sharpe {s_sharpe:.2f}→{o_sharpe:.2f}, "
            f"PF {s_pf:.2f}→{o_pf:.2f}) — added conditions not earning their overfit cost"
        )
    return {
        "verdict": verdict,
        "reason": reason,
        "trade_retention_pct": round(100 * o_trades / s_trades, 1) if s_trades else None,
        "sharpe_delta": round(o_sharpe - s_sharpe, 4),
        "pf_delta": round(o_pf - s_pf, 4),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Confluence-overlay ablation: source_entry_only vs tf_institutional_overlay")
    ap.add_argument("--strategy-class", required=True, help="dotted path, e.g. src.engine.strategies.bounce_off_level.BounceOffLevelStrategy")
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = ap.parse_args()

    source = _run_mode(args.strategy_class, "source_entry_only", args.start, args.end)
    overlay = _run_mode(args.strategy_class, "tf_institutional_overlay", args.start, args.end)
    verdict = _verdict(source, overlay)
    report = {"strategy": args.strategy_class, "source_entry_only": source, "tf_institutional_overlay": overlay, "verdict": verdict}

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    print(f"\nCONFLUENCE-OVERLAY ABLATION — {args.strategy_class}  ({args.start} → {args.end})")
    print("=" * 78)
    cols = ["trade_count", "sharpe", "profit_factor", "avg_r", "win_rate_pct", "max_dd", "total_pnl"]
    print(f"  {'metric':<16}{'source_entry_only':>20}{'tf_institutional_overlay':>26}")
    for c in cols:
        print(f"  {c:<16}{str(source.get(c)):>20}{str(overlay.get(c)):>26}")
    print("-" * 78)
    print(f"  VERDICT: {verdict['verdict']} — {verdict['reason']}")
    print("  (Single-backtest core. For the full out-of-sample call, run your walk-forward + DSR/PBO + MC")
    print("   path under each TF_CONFLUENCE_OVERLAY_DISABLED value and compare WFE/DSR/PBO/ruin too.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
