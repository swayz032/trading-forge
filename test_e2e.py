"""E2E backtest — scale test at 10, 15, 20 micro contracts on MES.

MES uses ES price data (same prices) but MES contract specs ($5/point vs $50/point).
"""
import time
from src.engine.strategies.breaker import BreakerStrategy
from src.engine.backtester import run_class_backtest
from src.engine.data_loader import load_ohlcv

# Load ES data once (MES = same prices as ES)
print("Loading ES data (MES uses same prices)...")
t0 = time.time()
data = load_ohlcv("ES", "15min", "2015-08-01", "2026-03-17")
print(f"Loaded {len(data)} bars in {time.time()-t0:.1f}s")

print("\n" + "=" * 65)
print("  MES BREAKER STRATEGY — SCALE TEST: 10 / 15 / 20 CONTRACTS")
print("  MES: $5/point, $1.25/tick, $0.62/side commission")
print("=" * 65)

for size in [10, 15, 20]:
    strat = BreakerStrategy(symbol="MES", timeframe="15min")
    t0 = time.time()
    result = run_class_backtest(
        strategy=strat,
        start_date='2015-08-01',
        end_date='2026-03-17',
        slippage_ticks=1.0,
        commission_per_side=0.62,
        fixed_contracts=size,
        data=data,  # pass pre-loaded ES data
    )
    elapsed = time.time() - t0

    trades = result.get('trades', [])
    longs = shorts = 0
    if trades:
        dirs = [t.get('Direction', '') for t in trades]
        longs = sum(1 for d in dirs if 'Long' in str(d))
        shorts = sum(1 for d in dirs if 'Short' in str(d))

    ec = result.get('equity_curve', [])
    eq_start = ec[0].get('value', 0) if ec else 0
    eq_end = ec[-1].get('value', 0) if ec else 0

    print(f"\n--- {size} MICRO CONTRACTS ---")
    print(f"Time: {elapsed:.1f}s")
    print(f"Trades: {result.get('total_trades')} ({longs} long, {shorts} short)")
    print(f"Win rate: {result.get('win_rate', 0):.1%}")
    print(f"Profit factor: {result.get('profit_factor', 0):.2f}")
    print(f"Sharpe: {result.get('sharpe_ratio', 0):.2f}")
    print(f"Total return: {result.get('total_return', 0):.1%}")
    print(f"Max drawdown: {result.get('max_drawdown', 0):.1%}")
    print(f"Avg daily PnL: ${result.get('avg_daily_pnl', 0):.2f}")
    print(f"Avg trade PnL: ${result.get('avg_trade_pnl', 0):.2f}")
    print(f"Winning days: {result.get('winning_days')} / {result.get('total_trading_days')}")
    print(f"Max consec losing days: {result.get('max_consecutive_losing_days')}")
    print(f"Tier: {result.get('tier')} | Forge: {result.get('forge_score')}")
    print(f"Equity: ${eq_start:,.0f} -> ${eq_end:,.0f}")

    if trades:
        pnl_key = next((k for k in ['PnL', 'pnl'] if k in trades[0]), None)
        if pnl_key:
            pnls = [round(t[pnl_key], 2) for t in trades[:5]]
            print(f"Sample trade PnLs: {pnls}")

    if result.get('error'):
        print(f"ERROR: {result['error']}")

print("\nDone.")
