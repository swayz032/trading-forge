from types import SimpleNamespace
import pandas as pd
from research import current_mnq_strategy_v2_2_risk_metrics as r


def t(s): return pd.Timestamp(s,tz='America/New_York')


def test_stop_bar_does_not_count_post_exit_low():
    row=SimpleNamespace(entry_time=str(t('2026-03-25 10:00')),exit_time=str(t('2026-03-25 10:00')),side='LONG',entry=100.0,exit_price=82.5,exit_reason='STOP',net_pnl=-543.3)
    one=pd.DataFrame({'open':[100.0],'high':[101.0],'low':[60.0],'close':[70.0]},index=[t('2026-03-25 10:00')])
    assert r.trade_mae_points(row,one)==-17.5


def test_pre_exit_bar_adverse_excursion_is_counted():
    row=SimpleNamespace(entry_time=str(t('2026-03-25 10:00')),exit_time=str(t('2026-03-25 10:01')),side='LONG',entry=100.0,exit_price=110.0,exit_reason='TARGET_TRADETHROUGH',net_pnl=281.7)
    one=pd.DataFrame({'open':[100,105],'high':[106,111],'low':[95,104],'close':[105,110]},index=[t('2026-03-25 10:00'),t('2026-03-25 10:01')])
    assert r.trade_mae_points(row,one)==-5.0
