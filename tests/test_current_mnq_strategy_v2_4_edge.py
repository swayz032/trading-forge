from __future__ import annotations

import pandas as pd

from research.current_mnq_strategy_v2_4_edge import build_edge_certificate


def _ledger(values, start="2019-06-03"):
    # One trade per business day, matching the strategy's maximum cadence.
    sessions = pd.bdate_range(start, periods=len(values))
    return pd.DataFrame({"session": sessions.date.astype(str), "net_pnl": values})


def _folds(nets=(1000.0, 800.0, 600.0, 500.0)):
    return pd.DataFrame({"fold": [1, 2, 3, 4], "net_pnl": list(nets)})


def test_robust_edge_passes_only_when_every_weakest_link_component_is_positive():
    values = [120.0 if i % 3 else -60.0 for i in range(120)]
    cert = build_edge_certificate(
        ledger=_ledger(values), score_sessions=600, folds=_folds(),
        bootstrap_lcb95=20.0,
        slippage_stress_net={"0.5": 6000.0, "1": 5000.0, "2": 3500.0},
        data_clean=True,
    )
    assert cert.certified_edge
    assert cert.robust_edge_expectancy > 0
    assert cert.detailed_removed_trades == 6
    assert cert.leave_best_month_out_expectancy > 0
    assert cert.break_even_margin > 0


def test_positive_total_pnl_can_still_fail_when_edge_depends_on_top_five_percent_winners():
    # Six monster wins make headline PnL positive; deleting the top 5% exposes
    # the negative ordinary-trade process.
    values = [3000.0] * 6 + [-100.0] * 114
    cert = build_edge_certificate(
        ledger=_ledger(values), score_sessions=600, folds=_folds(),
        bootstrap_lcb95=1.0,
        slippage_stress_net={"0.5": 6000.0, "1": 5000.0, "2": 3000.0},
        data_clean=True,
    )
    assert cert.baseline_net > 0
    assert cert.detailed_expectancy < 0
    assert not cert.certified_edge
    assert "EDGE_TOP5_WINNER_REMOVAL_NOT_POSITIVE" in cert.reasons


def test_positive_total_pnl_can_fail_when_one_month_carries_the_strategy():
    # First month is huge, every later month loses. This must not be presented as
    # durable edge just because the total is positive.
    values = [1000.0] * 20 + [-50.0] * 100
    cert = build_edge_certificate(
        ledger=_ledger(values), score_sessions=600, folds=_folds(),
        bootstrap_lcb95=1.0,
        slippage_stress_net={"0.5": 10000.0, "1": 9000.0, "2": 8000.0},
        data_clean=True,
    )
    assert cert.baseline_net > 0
    assert cert.leave_best_month_out_expectancy < 0
    assert not cert.certified_edge
    assert "EDGE_LEAVE_BEST_MONTH_OUT_NOT_POSITIVE" in cert.reasons


def test_seen_history_can_never_be_certified_as_clean_oos_edge():
    values = [150.0 if i % 3 else -50.0 for i in range(120)]
    cert = build_edge_certificate(
        ledger=_ledger(values), score_sessions=600, folds=_folds(),
        bootstrap_lcb95=20.0,
        slippage_stress_net={"0.5": 7000.0, "1": 6000.0, "2": 5000.0},
        data_clean=False,
    )
    assert cert.robust_edge_expectancy > 0
    assert not cert.certified_edge
    assert "DATA_NOT_CLEAN_OOS" in cert.reasons


def test_three_of_four_folds_is_minimum_temporal_gate():
    values = [120.0 if i % 3 else -60.0 for i in range(120)]
    cert = build_edge_certificate(
        ledger=_ledger(values), score_sessions=600,
        folds=_folds((1000.0, -100.0, -50.0, 900.0)),
        bootstrap_lcb95=20.0,
        slippage_stress_net={"0.5": 6000.0, "1": 5000.0, "2": 3500.0},
        data_clean=True,
    )
    assert cert.positive_folds == 2
    assert not cert.certified_edge
    assert "EDGE_TEMPORAL_ROBUSTNESS_FAIL" in cert.reasons
