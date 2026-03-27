"""Re-run 5 rewritten strategies after timezone + trading day fixes.

Tests: power_of_3, london_raid, unicorn, propulsion, mitigation
"""
import sys
import os
import json

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.engine.backtester import run_class_backtest

STRATEGIES = [
    ("power_of_3", "src.engine.strategies.power_of_3", "PowerOf3Strategy"),
    ("london_raid", "src.engine.strategies.london_raid", "LondonRaidStrategy"),
    ("unicorn", "src.engine.strategies.unicorn", "UnicornStrategy"),
    ("propulsion", "src.engine.strategies.propulsion", "PropulsionStrategy"),
    ("mitigation", "src.engine.strategies.mitigation", "MitigationStrategy"),
]

START = "2024-01-01"
END = "2024-12-31"

results = []
for name, module_path, class_name in STRATEGIES:
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"  Running: {name}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    try:
        import importlib
        mod = importlib.import_module(module_path)
        cls = getattr(mod, class_name)
        strategy = cls()

        r = run_class_backtest(
            strategy=strategy,
            start_date=START,
            end_date=END,
            slippage_ticks=1.0,
            commission_per_side=0.62,  # MES micro rate
            skip_eligibility_gate=True,
        )

        total_return = r.get("total_return", 0)
        total_trades = r.get("total_trades", 0)
        win_rate = r.get("win_rate", 0)
        profit_factor = r.get("profit_factor", 0)
        sharpe = r.get("sharpe_ratio", 0)
        max_dd = r.get("max_drawdown", 0)

        # Compute avg daily P&L
        daily_pnls = r.get("daily_pnls", [])
        n_days = len(daily_pnls) if daily_pnls else 1
        avg_daily = total_return / max(n_days, 1)

        results.append({
            "strategy": name,
            "timeframe": strategy.timeframe,
            "trades": total_trades,
            "net_pnl": round(total_return, 2),
            "avg_daily": round(avg_daily, 2),
            "win_rate": round(win_rate * 100, 1) if win_rate and win_rate <= 1 else round(win_rate, 1),
            "pf": round(profit_factor, 2) if profit_factor else 0,
            "sharpe": round(sharpe, 2) if sharpe else 0,
            "max_dd": round(abs(max_dd), 2) if max_dd else 0,
        })
        print(f"  >> {name}: {total_trades} trades, ${total_return:.2f} net", file=sys.stderr)

    except Exception as e:
        import traceback
        print(f"  ERROR on {name}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        results.append({"strategy": name, "error": str(e)})

# Print results table
print(f"\n{'='*100}")
print(f"{'Strategy':<18} {'TF':<8} {'Trades':>8} {'Net P&L':>12} {'Avg/Day':>10} {'WinRate':>8} {'PF':>6} {'Sharpe':>8} {'MaxDD':>10}")
print(f"{'-'*100}")
for r in results:
    if "error" in r:
        print(f"{r['strategy']:<18} ERROR: {r['error']}")
    else:
        print(
            f"{r['strategy']:<18} {r.get('timeframe',''):<8} {r['trades']:>8} "
            f"{r['net_pnl']:>12,.2f} {r['avg_daily']:>10,.2f} "
            f"{r['win_rate']:>7.1f}% {r['pf']:>6.2f} {r['sharpe']:>8.2f} {r['max_dd']:>10,.2f}"
        )
print(f"{'='*100}")

# Also dump JSON for programmatic access
print(json.dumps(results, indent=2))
