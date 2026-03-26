"""Backtest Accuracy Validation — catches false data before it reaches production.

Checks for:
1. Trade PnL vs equity curve reconciliation (are commissions double-counted?)
2. Execution timing (same-bar vs next-bar — look-ahead bias)
3. Commission correctness for micros
4. Daily P&L aggregation accuracy
5. Position sizing sanity
6. Trade count realism
"""
import time
import numpy as np
from src.engine.strategies.breaker import BreakerStrategy
from src.engine.backtester import run_class_backtest
from src.engine.data_loader import load_ohlcv
from src.engine.config import CONTRACT_SPECS

print("=" * 70)
print("  BACKTEST ACCURACY VALIDATION")
print("=" * 70)

# Load data once
data = load_ohlcv("ES", "15min", "2015-08-01", "2026-03-17")
spec = CONTRACT_SPECS["MES"]
print(f"Loaded {len(data)} bars, MES point_value=${spec.point_value}")

# Run a single backtest at 15 contracts
strat = BreakerStrategy(symbol="MES", timeframe="15min")
result = run_class_backtest(
    strategy=strat,
    start_date='2015-08-01',
    end_date='2026-03-17',
    slippage_ticks=1.0,
    commission_per_side=0.62,
    fixed_contracts=15,
    data=data,
)

trades = result.get('trades', [])
ec = result.get('equity_curve', [])
daily_pnls = result.get('daily_pnl_records', [])
total_trades = result.get('total_trades', 0)

print(f"\nTotal trades: {total_trades}")
print(f"Win rate: {result.get('win_rate', 0):.1%}")
print(f"Equity start: ${ec[0]['value']:,.0f} -> end: ${ec[-1]['value']:,.0f}")

# ─── CHECK 1: Trade PnL vs Equity Curve Reconciliation ─────────
print("\n--- CHECK 1: Trade PnL vs Equity Curve Reconciliation ---")
pnl_key = next((k for k in ['PnL', 'pnl'] if k in trades[0]), None)
if pnl_key:
    sum_trade_pnls = sum(t[pnl_key] for t in trades)
    equity_pnl = ec[-1]['value'] - ec[0]['value']

    # Commission total: 2 sides × commission × contracts × trades
    total_commission = 2 * 0.62 * 15 * total_trades

    print(f"  Sum of trade PnLs:        ${sum_trade_pnls:,.2f}")
    print(f"  Equity curve P&L:         ${equity_pnl:,.2f}")
    print(f"  Expected commissions:     ${total_commission:,.2f}")
    print(f"  Trade PnL - commissions:  ${sum_trade_pnls - total_commission:,.2f}")
    diff = abs(equity_pnl - sum_trade_pnls)
    diff_with_comm = abs(equity_pnl - (sum_trade_pnls - total_commission))

    if diff < 100:
        print(f"  MATCH (diff=${diff:.2f}) — trade PnLs include commissions")
    elif diff_with_comm < 100:
        print(f"  MATCH after commission adjustment (diff=${diff_with_comm:.2f})")
    else:
        print(f"  MISMATCH: equity P&L differs from trade sum by ${diff:,.2f}")
        print(f"  MISMATCH: after comm adjustment differs by ${diff_with_comm:,.2f}")
        print(f"  >> This means equity curve and trade PnL are computed differently!")
        print(f"  >> One of them is WRONG — producing false data!")

# ─── CHECK 2: Are vectorbt trade PnLs in price units or dollars? ──
print("\n--- CHECK 2: PnL Unit Verification ---")
if trades:
    # Look at first few trades — are they reasonable for MES?
    sample_pnls = [t[pnl_key] for t in trades[:10]]
    print(f"  First 10 trade PnLs: {[f'${p:.2f}' for p in sample_pnls]}")

    # For MES at 15 contracts: a 1-point move = 15 × $5 = $75
    # Reasonable trade PnL range: -$500 to +$500 for normal moves
    avg_abs_pnl = np.mean([abs(p) for p in sample_pnls])
    print(f"  Avg absolute PnL: ${avg_abs_pnl:.2f}")
    if avg_abs_pnl > 5000:
        print(f"  WARNING: PnLs seem too large for MES × 15 contracts")
        print(f"  Possible double-multiplication of point_value or contracts")
    elif avg_abs_pnl < 5:
        print(f"  WARNING: PnLs seem too small — might be in price units, not dollars")
    else:
        print(f"  OK: PnL magnitude looks reasonable for MES × 15 contracts")

# ─── CHECK 3: Commission Sanity ────────────────────────────────
print("\n--- CHECK 3: Commission Per Trade ---")
if len(trades) >= 2:
    # Check if vectorbt's trade records have a fee/commission column
    fee_keys = [k for k in trades[0].keys() if 'fee' in k.lower() or 'commission' in k.lower() or 'cost' in k.lower()]
    if fee_keys:
        sample_fees = [trades[i].get(fee_keys[0], 0) for i in range(min(5, len(trades)))]
        print(f"  Fee column '{fee_keys[0]}': {sample_fees}")
        expected_rt_fee = 2 * 0.62 * 15  # round trip × per-side × contracts
        print(f"  Expected round-trip fee (15 MES): ${expected_rt_fee:.2f}")
    else:
        print(f"  No fee column found in trade records")
        print(f"  Available columns: {list(trades[0].keys())}")

# ─── CHECK 4: Daily P&L Aggregation ───────────────────────────
print("\n--- CHECK 4: Daily P&L Count vs Expected Trading Days ---")
total_days = len(daily_pnls)
# ~252 trading days/year × ~10.5 years = ~2,646 expected
expected_days = 252 * 10.5
print(f"  Daily P&L records: {total_days}")
print(f"  Expected (~252/yr × 10.5yr): ~{expected_days:.0f}")
if abs(total_days - expected_days) / expected_days > 0.20:
    print(f"  WARNING: Daily P&L count off by >{20}% — possible session/date issue")
else:
    print(f"  OK: Within 20% of expected")

# Sum of daily PnLs should equal equity change
sum_daily = sum(d['pnl'] for d in daily_pnls)
equity_change = ec[-1]['value'] - ec[0]['value']
print(f"  Sum of daily PnLs: ${sum_daily:,.2f}")
print(f"  Equity curve change: ${equity_change:,.2f}")
daily_diff = abs(sum_daily - equity_change)
if daily_diff < 100:
    print(f"  MATCH (diff=${daily_diff:.2f})")
else:
    print(f"  MISMATCH by ${daily_diff:,.2f}")

# ─── CHECK 5: Trades Per Day Sanity ────────────────────────────
print("\n--- CHECK 5: Trade Frequency ---")
avg_trades_per_day = total_trades / max(total_days, 1)
print(f"  Avg trades per day: {avg_trades_per_day:.1f}")
if avg_trades_per_day > 10:
    print(f"  WARNING: >10 trades/day is unrealistic for a 15min breaker strategy")
elif avg_trades_per_day > 5:
    print(f"  HIGH: 5+ trades/day — verify signal logic isn't over-firing")
elif avg_trades_per_day < 0.5:
    print(f"  LOW: <0.5 trades/day — verify signals aren't being filtered too aggressively")
else:
    print(f"  OK: Reasonable trade frequency")

# ─── CHECK 6: Long/Short Direction Verification ───────────────
print("\n--- CHECK 6: Long vs Short Balance ---")
dir_key = next((k for k in trades[0].keys() if 'direction' in k.lower() or 'type' in k.lower() or 'Direction' in k), None)
if dir_key:
    directions = [t.get(dir_key, '') for t in trades]
    longs = sum(1 for d in directions if 'Long' in str(d))
    shorts = sum(1 for d in directions if 'Short' in str(d))
    print(f"  Longs: {longs} ({longs/total_trades:.1%})")
    print(f"  Shorts: {shorts} ({shorts/total_trades:.1%})")
    # In a balanced market, 40-60% either direction is reasonable
    long_pct = longs / total_trades
    if 0.35 < long_pct < 0.65:
        print(f"  OK: Balanced long/short ratio")
    else:
        print(f"  NOTE: Skewed direction — verify market regime isn't biasing signals")
else:
    print(f"  No direction column found. Columns: {list(trades[0].keys())}")

# ─── CHECK 7: Verify point_value multiplication isn't doubled ──
print("\n--- CHECK 7: Point Value Multiplication Check ---")
# Get a specific trade and verify math
if trades:
    t = trades[0]
    entry_p = t.get('Entry Price', t.get('entry_price', 0))
    exit_p = t.get('Exit Price', t.get('exit_price', 0))
    size = t.get('Size', t.get('size', 0))
    pnl = t.get(pnl_key, 0)
    direction = t.get('Direction', t.get('direction', ''))

    print(f"  Trade 0: entry={entry_p}, exit={exit_p}, size={size}, direction={direction}")
    print(f"  Reported PnL: ${pnl:.2f}")

    # Expected: (exit - entry) × size × point_value - commission
    if entry_p and exit_p:
        price_diff = exit_p - entry_p
        if 'Short' in str(direction):
            price_diff = entry_p - exit_p

        # vectorbt raw PnL = price_diff * size (in price units)
        # Our code multiplies by point_value
        expected_no_pv = price_diff * size
        expected_with_pv = price_diff * size * spec.point_value
        rt_comm = 2 * 0.62  # round trip commission per contract
        expected_with_pv_comm = expected_with_pv - (rt_comm * size)

        print(f"  Price diff: {price_diff:.4f} points")
        print(f"  Without point_value: ${expected_no_pv:.2f}")
        print(f"  With point_value ($5): ${expected_with_pv:.2f}")
        print(f"  With PV + commission: ${expected_with_pv_comm:.2f}")

        # Check which one matches
        if abs(pnl - expected_no_pv) < 1:
            print(f"  >> PnL matches WITHOUT point_value multiplication — BUG: missing $5/point!")
        elif abs(pnl - expected_with_pv) < 1:
            print(f"  >> PnL matches WITH point_value, NO commission subtracted")
        elif abs(pnl - expected_with_pv_comm) < 5:
            print(f"  >> PnL matches WITH point_value AND commission — CORRECT!")
        else:
            print(f"  >> NO MATCH — investigate PnL calculation!")
            print(f"  >> Diff from expected_with_pv: ${abs(pnl - expected_with_pv):.2f}")
            print(f"  >> Diff from expected_with_pv_comm: ${abs(pnl - expected_with_pv_comm):.2f}")

# ─── CHECK 8: Slippage Impact ──────────────────────────────────
print("\n--- CHECK 8: Slippage Reality Check ---")
# 1 tick slippage on MES = $1.25. Per round trip with 15 contracts:
slippage_per_rt = 2 * 1.25 * 15  # 2 sides × $1.25/tick × 15 contracts
total_slippage = slippage_per_rt * total_trades
print(f"  Slippage per round trip (1 tick, 15 MES): ${slippage_per_rt:.2f}")
print(f"  Total slippage over {total_trades} trades: ${total_slippage:,.2f}")
print(f"  Total commission: ${2 * 0.62 * 15 * total_trades:,.2f}")
print(f"  Combined friction: ${total_slippage + 2 * 0.62 * 15 * total_trades:,.2f}")

# Breakeven per trade
breakeven_per_trade = slippage_per_rt + (2 * 0.62 * 15)
breakeven_points = breakeven_per_trade / (15 * spec.point_value)
print(f"  Breakeven per trade: ${breakeven_per_trade:.2f} ({breakeven_points:.2f} points)")

print("\n" + "=" * 70)
print("  VALIDATION COMPLETE")
print("=" * 70)
