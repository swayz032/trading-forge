#!/usr/bin/env python3
"""Execution-bounded MAE and drawdown metrics for v2.2.

The old research metric used the entire high/low of the stop-trigger minute before
checking the stop, which can include price movement after the position should have
already exited. This module never uses post-exit movement on a stop bar.
"""
from __future__ import annotations
import pandas as pd

POINT_VALUE=2.0
CONTRACTS=15
ROUND_TRIP_FEE=1.22*15


def trade_mae_points(row, one: pd.DataFrame) -> float:
    et=pd.Timestamp(row.entry_time); xt=pd.Timestamp(row.exit_time)
    q=one[(one.index>=et)&(one.index<=xt)&(one.index.date==et.date())]
    if q.empty: return 0.0
    is_long=str(row.side)=='LONG'; entry=float(row.entry); adverse=0.0
    for ts,b in q.iterrows():
        is_exit_bar=(ts==xt)
        if is_exit_bar and 'STOP' in str(row.exit_reason):
            # Once stop fills, subsequent movement within this minute is no longer
            # unrealized P&L. The fill itself is the adverse bound for the exit bar.
            excursion=float(row.exit_price)-entry if is_long else entry-float(row.exit_price)
        else:
            excursion=float(b.low)-entry if is_long else entry-float(b.high)
        adverse=min(adverse,excursion)
        if is_exit_bar: break
    return float(adverse)


def ledger_mae(ledger: pd.DataFrame, one: pd.DataFrame) -> pd.DataFrame:
    x=ledger.copy()
    if x.empty:
        x['bounded_mae_points']=[]; return x
    x['bounded_mae_points']=[trade_mae_points(r,one) for r in x.itertuples()]
    x['bounded_mae_cash']=x.bounded_mae_points*POINT_VALUE*CONTRACTS
    return x


def mae_aware_drawdown(ledger: pd.DataFrame, one: pd.DataFrame) -> dict:
    x=ledger_mae(ledger,one)
    if x.empty: return {'mae_aware_drawdown':0.0,'worst_trade_mae_cash':0.0}
    running=0.0; peak=0.0; worst=0.0
    for r in x.itertuples():
        intralow=running+float(r.bounded_mae_cash)-ROUND_TRIP_FEE
        worst=min(worst,intralow-peak)
        running+=float(r.net_pnl); peak=max(peak,running); worst=min(worst,running-peak)
    return {'mae_aware_drawdown':float(worst),'worst_trade_mae_cash':float(x.bounded_mae_cash.min()),
            'method':'1m_execution_bounded_no_post_stop_bar_excursion'}
