"""Sanity checks — 8 automated validations run after every backtest.

Each check returns PASS/FAIL with a reason. The module aggregates results
into a sanity report that's included in the backtest result schema.
"""

from __future__ import annotations

import numpy as np

from src.engine.config import CONTRACT_SPECS


def run_sanity_checks(
    result: dict,
    initial_capital: float = 50_000.0,
    is_walk_forward_aggregate: bool = False,
    symbol: str = "ES",
) -> dict:
    """Run all 8 sanity checks against a backtest result.

    Args:
        result: Backtest result dict (from run_backtest or run_class_backtest)
        initial_capital: Starting capital (default $50K)

    Returns:
        dict with status (PASS/FAIL), checks list, and summary counts
    """
    checks = []
    trades = result.get("trades", [])
    daily_pnls = result.get("daily_pnls", [])
    equity_curve = result.get("equity_curve", [])
    total_trades = result.get("total_trades", 0)
    total_trading_days = result.get("total_trading_days", 0)
    win_rate = result.get("win_rate", 0)
    max_dd = result.get("max_drawdown", 0)

    # 1. Trade Count — reasonable range
    # Intraday strategies can trade 5+ times per day. Use 5x for single runs, 10x for WF aggregates
    # (WF total_trading_days is non-overlapping OOS days but trades come from multiple windows).
    min_trades = max(1, int(total_trading_days * 0.05))
    trades_per_day_cap = 10 if is_walk_forward_aggregate else 5
    max_trades = int(total_trading_days * trades_per_day_cap) if total_trading_days > 0 else 10000
    trade_count_ok = min_trades <= total_trades <= max_trades
    checks.append({
        "name": "trade_count",
        "status": "PASS" if trade_count_ok else "FAIL",
        "detail": f"{total_trades} trades (expected {min_trades}-{max_trades})",
    })

    # 2. Win Rate — not 0% or 100% over 50+ trades, not >99% over 200+
    win_rate_ok = True
    win_rate_detail = f"win_rate={win_rate:.2%}"
    if total_trades >= 50 and (win_rate == 0.0 or win_rate == 1.0):
        win_rate_ok = False
        win_rate_detail += " — suspicious: exactly 0% or 100% over 50+ trades"
    if total_trades >= 200 and win_rate > 0.99:
        win_rate_ok = False
        win_rate_detail += " — suspicious: >99% over 200+ trades"
    checks.append({
        "name": "win_rate_sanity",
        "status": "PASS" if win_rate_ok else "FAIL",
        "detail": win_rate_detail,
    })

    # 3. Avg Trade P&L — within instrument bounds
    avg_pnl = result.get("avg_trade_pnl", 0)
    avg_pnl_ok = abs(avg_pnl) < 10_000  # No single-trade avg > $10K
    checks.append({
        "name": "avg_trade_pnl",
        "status": "PASS" if avg_pnl_ok else "FAIL",
        "detail": f"avg_trade_pnl=${avg_pnl:.2f}",
    })

    # 4. Max Drawdown — can't exceed starting capital (max_dd is now in dollars)
    # Walk-forward aggregates: drawdown can exceed capital because windows don't stop at
    # bankruptcy. Use 3x capital threshold for WF aggregates (flag extreme only).
    max_dd_dollars = abs(max_dd)
    dd_limit = initial_capital * 3 if is_walk_forward_aggregate else initial_capital
    dd_ok = max_dd_dollars <= dd_limit
    checks.append({
        "name": "max_drawdown",
        "status": "PASS" if dd_ok else "FAIL",
        "detail": f"max_dd=${max_dd_dollars:.2f} vs limit=${dd_limit:.2f}" + (" (WF aggregate)" if is_walk_forward_aggregate else ""),
    })

    # 5. Equity Monotonicity — can't be perfectly one direction
    mono_ok = True
    if len(daily_pnls) > 20:
        all_positive = all(p >= 0 for p in daily_pnls)
        all_negative = all(p <= 0 for p in daily_pnls)
        if all_positive or all_negative:
            mono_ok = False
    checks.append({
        "name": "equity_monotonicity",
        "status": "PASS" if mono_ok else "FAIL",
        "detail": "equity has both up and down days" if mono_ok else "equity is perfectly monotonic — suspicious",
    })

    # 6. Reconciliation (Golden Rule)
    # final_equity - initial_capital = sum(trade_pnls)
    trade_pnls = [float(t.get("PnL", t.get("pnl", 0))) for t in trades]
    trades_total = sum(trade_pnls) if trade_pnls else 0
    # Get equity total from equity curve if available
    equity_points = equity_curve if isinstance(equity_curve, list) else []
    if equity_points and isinstance(equity_points[0], dict):
        equity_values = [p.get("value", 0) for p in equity_points]
        equity_total = equity_values[-1] - initial_capital if equity_values else 0
    else:
        equity_total = sum(daily_pnls) if daily_pnls else 0
    recon_error = abs(equity_total - trades_total)
    # Tolerance scales with trade count: $1 base + $0.50 per trade (float rounding compounds)
    recon_tolerance = 1.0 + 0.50 * max(total_trades, 0)
    recon_ok = recon_error <= recon_tolerance
    checks.append({
        "name": "reconciliation",
        "status": "PASS" if recon_ok else "FAIL",
        "detail": f"equity_total=${equity_total:.2f}, trades_total=${trades_total:.2f}, error=${recon_error:.2f} (tolerance=${recon_tolerance:.0f})",
    })

    # 7. Trade Duration — no intraday trade > 24h (1440 min)
    duration_ok = True
    duration_detail = "all trades within bounds"
    if trades:
        for t in trades:
            entry_idx = t.get("Entry Idx", 0)
            exit_idx = t.get("Exit Idx", entry_idx)
            # Rough check: on 5min data, 288 bars = 24h
            bar_count = exit_idx - entry_idx
            if bar_count > 288:
                duration_ok = False
                duration_detail = f"trade held {bar_count} bars (>288 = ~24h on 5min)"
                break
    checks.append({
        "name": "trade_duration",
        "status": "PASS" if duration_ok else "FAIL",
        "detail": duration_detail,
    })

    # 8. Spot-Check 3 Random Trades — verify P&L math
    spot_ok = True
    spot_details = []
    point_value = CONTRACT_SPECS.get(symbol, CONTRACT_SPECS["ES"]).point_value
    if len(trades) >= 3:
        rng = np.random.RandomState(42)
        sample_indices = rng.choice(len(trades), size=min(3, len(trades)), replace=False)
        for idx in sample_indices:
            t = trades[idx]
            entry_p = float(t.get("Avg Entry Price", 0))
            exit_p = float(t.get("Avg Exit Price", 0))
            size = float(t.get("Size", 1))
            direction = str(t.get("Direction", "Long"))
            reported_pnl = float(t.get("PnL", 0))
            gross_pnl = float(t.get("GrossPnL", 0))
            slip_cost = float(t.get("SlippageCost", 0))
            comm_cost = float(t.get("CommissionCost", 0))

            # Recompute using symbol-specific point_value
            if "Short" in direction:
                expected_gross = (entry_p - exit_p) * size * point_value
            else:
                expected_gross = (exit_p - entry_p) * size * point_value
            expected_net = expected_gross - slip_cost - comm_cost

            # Allow $1 tolerance
            gross_match = abs(gross_pnl - expected_gross) < 1.0 or abs(gross_pnl) < 0.01
            net_match = abs(reported_pnl - expected_net) < 1.0

            spot_details.append({
                "trade_idx": int(idx),
                "gross_ok": gross_match,
                "net_ok": net_match,
            })
            if not net_match:
                spot_ok = False

    checks.append({
        "name": "spot_check_trades",
        "status": "PASS" if spot_ok else "FAIL",
        "detail": spot_details if spot_details else "not enough trades to spot-check",
    })

    # Aggregate
    passed = sum(1 for c in checks if c["status"] == "PASS")
    failed = sum(1 for c in checks if c["status"] == "FAIL")
    overall = "PASS" if failed == 0 else "FAIL"

    return {
        "status": overall,
        "checks_passed": passed,
        "checks_total": len(checks),
        "checks": checks,
    }
