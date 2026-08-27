#!/usr/bin/env python3
"""Robust edge certificate for Current MNQ v2.4.

This module does NOT search parameters and does NOT select a best variant. It
attacks one frozen ledger four ways and defines edge by the weakest surviving
expectancy:

    E* = min(
        moving-block-bootstrap 95% lower confidence bound of mean trade,
        highest declared friction/slippage stress expectancy,
        expectancy after deleting the top 5% winning trades,
        expectancy after deleting the single best calendar month,
    )

Certified historical edge requires E* > 0 plus sample, chronology and break-even
margin gates. This is intentionally harder than merely asking whether total PnL
or profit factor is positive.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

EDGE_SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_edge_semantics.json")


def load_edge_spec(path: str | Path = EDGE_SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


@dataclass(frozen=True)
class EdgeCertificate:
    trades: int
    score_sessions: int
    baseline_net: float
    baseline_expectancy: float
    win_rate: float
    avg_net_win: float
    avg_net_loss_abs: float
    break_even_win_rate: float | None
    break_even_margin: float | None
    bootstrap_lcb95: float | None
    highest_slippage_points: float | None
    highest_slippage_net: float | None
    highest_slippage_expectancy: float | None
    detailed_fraction: float
    detailed_removed_trades: int
    detailed_net: float | None
    detailed_expectancy: float | None
    best_month: str | None
    best_month_net: float | None
    leave_best_month_out_trades: int
    leave_best_month_out_net: float | None
    leave_best_month_out_expectancy: float | None
    chronological_folds: int
    positive_folds: int
    robust_edge_expectancy: float | None
    robust_edge_multiple_of_avg_loss: float | None
    data_clean: bool
    sample_ok: bool
    temporal_ok: bool
    expectancy_ok: bool
    cost_ok: bool
    outlier_ok: bool
    concentration_ok: bool
    break_even_ok: bool
    certified_edge: bool
    reasons: tuple[str, ...]

    def to_dict(self) -> dict:
        return asdict(self)


def _finite(x) -> bool:
    return x is not None and np.isfinite(float(x))


def _net_series(ledger: pd.DataFrame) -> pd.Series:
    if "net_pnl" not in ledger.columns:
        raise RuntimeError("EDGE_LEDGER_NET_PNL_MISSING")
    x = pd.to_numeric(ledger["net_pnl"], errors="coerce")
    if x.isna().any() or not np.isfinite(x.to_numpy(float)).all():
        raise RuntimeError("EDGE_LEDGER_NET_PNL_NONFINITE")
    return x.astype(float)


def _session_series(ledger: pd.DataFrame) -> pd.Series:
    if "session" not in ledger.columns:
        raise RuntimeError("EDGE_LEDGER_SESSION_MISSING")
    x = pd.to_datetime(ledger["session"], errors="coerce")
    if x.isna().any():
        raise RuntimeError("EDGE_LEDGER_SESSION_INVALID")
    return x


def _highest_stress(slippage_stress_net: dict[str, float], trades: int):
    if not slippage_stress_net or trades <= 0:
        return None, None, None
    parsed = []
    for key, value in slippage_stress_net.items():
        try:
            pts = float(key); net = float(value)
        except Exception as exc:
            raise RuntimeError(f"EDGE_SLIPPAGE_STRESS_INVALID:{key}") from exc
        if not np.isfinite(pts) or not np.isfinite(net):
            raise RuntimeError(f"EDGE_SLIPPAGE_STRESS_NONFINITE:{key}")
        parsed.append((pts, net))
    pts, net = max(parsed, key=lambda x: x[0])
    return float(pts), float(net), float(net / trades)


def _detail_top_winners(ledger: pd.DataFrame, fraction: float):
    n = len(ledger)
    if n == 0:
        return 0, None, None
    if not (0.0 < fraction < 1.0):
        raise RuntimeError("EDGE_DETAIL_FRACTION_INVALID")
    pnl = _net_series(ledger)
    winners = ledger[pnl > 0].copy()
    if winners.empty:
        return 0, float(pnl.sum()), float(pnl.mean())
    remove_n = min(len(winners), max(1, int(math.ceil(n * fraction))))
    top_idx = winners.assign(_net=pd.to_numeric(winners.net_pnl)).nlargest(remove_n, "_net").index
    remain = ledger.drop(index=top_idx)
    if remain.empty:
        return remove_n, None, None
    x = _net_series(remain)
    return int(remove_n), float(x.sum()), float(x.mean())


def _leave_best_month_out(ledger: pd.DataFrame):
    if ledger.empty:
        return None, None, 0, None, None
    sessions = _session_series(ledger)
    work = ledger.copy()
    work["_month"] = sessions.dt.to_period("M").astype(str)
    monthly = work.groupby("_month", sort=True)["net_pnl"].sum().astype(float)
    if monthly.empty:
        return None, None, 0, None, None
    # Deterministic tie break: earliest month among equal best nets.
    max_net = float(monthly.max())
    best_month = sorted(monthly[monthly == max_net].index.tolist())[0]
    remain = work[work["_month"] != best_month]
    if remain.empty:
        return best_month, max_net, 0, None, None
    x = _net_series(remain)
    return best_month, max_net, int(len(remain)), float(x.sum()), float(x.mean())


def _payoff_math(pnl: pd.Series):
    n = len(pnl)
    if n == 0:
        return 0.0, 0.0, 0.0, None, None
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    wr = float((pnl > 0).mean())
    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss_abs = float(-losses.mean()) if len(losses) else 0.0
    if avg_win <= 0 or avg_loss_abs <= 0:
        return wr, avg_win, avg_loss_abs, None, None
    be = float(avg_loss_abs / (avg_win + avg_loss_abs))
    return wr, avg_win, avg_loss_abs, be, float(wr - be)


def build_edge_certificate(*, ledger: pd.DataFrame, score_sessions: int,
                           folds: pd.DataFrame,
                           bootstrap_lcb95: float | None,
                           slippage_stress_net: dict[str, float],
                           data_clean: bool,
                           edge_spec: dict | None = None) -> EdgeCertificate:
    spec = edge_spec or load_edge_spec()
    gates = spec["gates"]
    pnl = _net_series(ledger) if len(ledger) else pd.Series(dtype=float)
    n = int(len(ledger))
    baseline_net = float(pnl.sum()) if n else 0.0
    baseline_expectancy = float(pnl.mean()) if n else 0.0
    wr, avg_win, avg_loss_abs, be_wr, be_margin = _payoff_math(pnl)

    stress_pts, stress_net, stress_exp = _highest_stress(slippage_stress_net, n)
    detail_fraction = float(gates["top_winner_fraction_removed"])
    detail_n, detail_net, detail_exp = _detail_top_winners(ledger, detail_fraction)
    best_month, best_month_net, month_n, month_net, month_exp = _leave_best_month_out(ledger)

    folds_n = int(len(folds))
    if folds_n and "net_pnl" not in folds.columns:
        raise RuntimeError("EDGE_FOLDS_NET_PNL_MISSING")
    positive_folds = int((pd.to_numeric(folds.net_pnl, errors="coerce") > 0).sum()) if folds_n else 0

    robust_components = [bootstrap_lcb95, stress_exp, detail_exp, month_exp]
    robust = float(min(float(x) for x in robust_components)) if all(_finite(x) for x in robust_components) else None
    robust_multiple = (
        float(robust / avg_loss_abs)
        if _finite(robust) and avg_loss_abs > 0 else None
    )

    sample_ok = n >= int(gates["minimum_trades"]) and int(score_sessions) >= int(gates["minimum_score_sessions"])
    temporal_ok = (
        folds_n == int(gates["chronological_folds"])
        and positive_folds >= int(gates["minimum_positive_folds"])
    )
    expectancy_ok = _finite(bootstrap_lcb95) and float(bootstrap_lcb95) > 0
    cost_ok = _finite(stress_exp) and float(stress_exp) > 0
    outlier_ok = _finite(detail_exp) and float(detail_exp) > 0
    concentration_ok = _finite(month_exp) and float(month_exp) > 0
    break_even_ok = _finite(be_margin) and float(be_margin) > 0

    reasons = []
    if not data_clean: reasons.append("DATA_NOT_CLEAN_OOS")
    if not sample_ok: reasons.append("EDGE_SAMPLE_TOO_SMALL")
    if not temporal_ok: reasons.append("EDGE_TEMPORAL_ROBUSTNESS_FAIL")
    if not expectancy_ok: reasons.append("EDGE_BOOTSTRAP_LCB95_NOT_POSITIVE")
    if not cost_ok: reasons.append("EDGE_MAX_COST_STRESS_NOT_POSITIVE")
    if not outlier_ok: reasons.append("EDGE_TOP5_WINNER_REMOVAL_NOT_POSITIVE")
    if not concentration_ok: reasons.append("EDGE_LEAVE_BEST_MONTH_OUT_NOT_POSITIVE")
    if not break_even_ok: reasons.append("EDGE_BREAK_EVEN_MARGIN_NOT_POSITIVE")
    if robust is None or robust <= 0: reasons.append("ROBUST_EDGE_EXPECTANCY_NOT_POSITIVE")

    certified = not reasons
    return EdgeCertificate(
        trades=n, score_sessions=int(score_sessions), baseline_net=baseline_net,
        baseline_expectancy=baseline_expectancy, win_rate=wr, avg_net_win=avg_win,
        avg_net_loss_abs=avg_loss_abs, break_even_win_rate=be_wr,
        break_even_margin=be_margin, bootstrap_lcb95=(float(bootstrap_lcb95) if _finite(bootstrap_lcb95) else None),
        highest_slippage_points=stress_pts, highest_slippage_net=stress_net,
        highest_slippage_expectancy=stress_exp, detailed_fraction=detail_fraction,
        detailed_removed_trades=detail_n, detailed_net=detail_net,
        detailed_expectancy=detail_exp, best_month=best_month,
        best_month_net=best_month_net, leave_best_month_out_trades=month_n,
        leave_best_month_out_net=month_net, leave_best_month_out_expectancy=month_exp,
        chronological_folds=folds_n, positive_folds=positive_folds,
        robust_edge_expectancy=robust, robust_edge_multiple_of_avg_loss=robust_multiple,
        data_clean=bool(data_clean), sample_ok=sample_ok, temporal_ok=temporal_ok,
        expectancy_ok=expectancy_ok, cost_ok=cost_ok, outlier_ok=outlier_ok,
        concentration_ok=concentration_ok, break_even_ok=break_even_ok,
        certified_edge=certified, reasons=tuple(reasons),
    )
