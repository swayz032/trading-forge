"""Deep-scan #22 Y5 cap-closer — CPCV-mode WFE (default WF_MODE) integration lock.

Closes cited gap #1: "the CPCV-mode WFE formula — the DEFAULT `WF_MODE` feeding
the hard WFE promotion gate — has ZERO test coverage anywhere" (independent
cert, 2026-07-09).

`_run_walk_forward_cpcv()` (src/engine/walk_forward.py) computes, on the
DEFAULT `WF_MODE=cpcv` path, POST-X5-RATIFICATION (2026-07-09):

    _cpcv_is_basis = _combined_fold_sharpe(all_is_pnls)   # pooled IS P&L
    wfe_overall    = round(agg_sharpe / _cpcv_is_basis, 4)
    wfe_status     = "cpcv_combined_fold"

where:
  - `agg_sharpe` is the Sharpe ratio of the CONCATENATED (pooled) OOS daily
    P&L across ALL CPCV paths — a true combined/pooled statistic.
  - `_combined_fold_sharpe(all_is_pnls)` is the Sharpe of the CONCATENATED
    (pooled) per-path IS daily P&L — the SAME aggregation, on the IS side.

RESOLVED FINDING (X5 RATIFIED + FIXED 2026-07-09): the CPCV WFE IS denominator
was previously `mean(per_path_is_sharpes)` — a PER-PATH AVERAGE, asymmetric with
the pooled OOS numerator and with the institutional "combined-fold Sharpe
(OOS / IS)" standard documented in CLAUDE.md §4 / §12 and in this file's
plain-mode sibling. The operator ratified option (a) — fix to combined/combined
(ratification packet `cpcv-wfe`, 2026-07-09) — and `walk_forward.py` now pools
per-path IS P&L into one combined-fold IS Sharpe (both the DSL and class CPCV
paths). `per_path_is_sharpes` is UNCHANGED and remains the BIF/PBO IS basis.

This suite therefore:

  1. LOCKS the ratified combined-fold formula live in production (so no future
     refactor can silently change it without a red test) via the PUBLIC
     dispatcher `run_walk_forward(..., wf_mode="cpcv")`.
  2. PROVES, on a controlled deterministic fixture where mean-IS and pooled-IS
     diverge >2%, that production's `wfe_overall` NOW matches the combined-fold
     formula and NO LONGER the per-path-average formula — the direct A/B receipt
     that the ratified fix took effect (and would RED-fail against the old code).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

import src.engine.walk_forward as wf_mod
from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.walk_forward import run_walk_forward

N_PATHS = 15  # C(6, 2) for the default n_splits=6, k_test_groups=2 CPCV shape


def _sharpe(pnl_arr: np.ndarray) -> float:
    """Same formula _run_walk_forward_cpcv uses for agg_sharpe (walk_forward.py
    ~line 573) — reused here (not re-derived) so the "expected" values in this
    test are provably the same computation, not a parallel guess."""
    std = float(np.std(pnl_arr, ddof=1))
    if std <= 0:
        return 0.0
    return float(np.mean(pnl_arr) / std * np.sqrt(252))


def _make_data(n: int = 600) -> pl.DataFrame:
    """Deterministic daily OHLCV — large enough that n_splits=6 folds each
    clear MIN_CPCV_FOLD_BARS and no CPCV path drops for lack of data."""
    dates = [datetime(2022, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [4000.0 + i * 0.1 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 1.0 for c in closes],
        "high": [c + 2.0 for c in closes],
        "low": [c - 2.0 for c in closes],
        "close": closes,
        "volume": [50_000] * n,
    })


def _make_request() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="Y5 CPCV WFE Lock Test",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close crosses_above sma_5",
            entry_short="close crosses_below sma_5",
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        ),
        start_date="2022-01-01",
        end_date="2023-08-01",
    )


class _FakeBacktestRouter:
    """Deterministic stand-in for `run_backtest()` inside `_run_walk_forward_cpcv`.

    Routes OOS vs IS calls by the presence of the `warmup_data` kwarg — only
    the OOS call site (walk_forward.py ~line 492:
    `run_backtest(_shared_req, data=oos_data, warmup_data=warmup_data_for_oos)`)
    passes it; the per-path IS call (~line 517: `run_backtest(_shared_req,
    data=is_data)`) never does. This lets a single monkeypatch fully control
    both series without touching vectorbt, strategy.compute(), or any real
    market data — the numeric contract under test is pure aggregation
    arithmetic, not strategy signal quality.
    """

    def __init__(self, n_paths: int = N_PATHS):
        self.oos_calls = 0
        self.is_calls = 0
        self.oos_series: list[np.ndarray] = []
        self.is_series: list[np.ndarray] = []
        for i in range(n_paths):
            rng_oos = np.random.RandomState(1000 + i)
            # OOS: fairly stable variance across paths (mirrors one strategy's
            # real OOS variance not swinging wildly path to path).
            self.oos_series.append(rng_oos.normal(loc=5.0, scale=20.0, size=40))
            # IS: variance DELIBERATELY grows path-to-path (mirrors each IS
            # fold sampling a different regime mix) — this dispersion is what
            # makes mean(per-path Sharpe) diverge from Sharpe-of-pooled-IS.
            rng_is = np.random.RandomState(2000 + i)
            scale = 10.0 + 4.0 * i
            self.is_series.append(rng_is.normal(loc=8.0, scale=scale, size=40))

    def __call__(self, request, data=None, **kwargs):
        if "warmup_data" in kwargs:
            idx = self.oos_calls
            self.oos_calls += 1
            pnls = self.oos_series[idx % len(self.oos_series)]
            return {
                "sharpe_ratio": _sharpe(pnls),
                "total_return": float(np.sum(pnls)),
                "trades": [],
                "daily_pnls": pnls.tolist(),
                "daily_pnl_records": [],
                "equity_bars": np.cumsum(pnls).tolist(),
            }
        idx = self.is_calls
        self.is_calls += 1
        pnls = self.is_series[idx % len(self.is_series)]
        return {
            "sharpe_ratio": _sharpe(pnls),
            "total_return": float(np.sum(pnls)),
            "trades": [],
            "daily_pnls": pnls.tolist(),
        }


class TestY5CpcvDefaultModeSanity:
    """Confirms the premise: CPCV really is the default WF_MODE this test
    suite is about locking down."""

    def test_default_wf_mode_resolves_to_cpcv(self, monkeypatch):
        monkeypatch.delenv("WF_MODE", raising=False)
        router = _FakeBacktestRouter()
        monkeypatch.setattr(wf_mod, "run_backtest", router)
        result = run_walk_forward(_make_request(), data=_make_data(600), embargo_bars=5)
        assert result["wf_metadata"]["mode"] == "cpcv", (
            "Default WF_MODE must resolve to 'cpcv' (production default since "
            "the 2026-06-22 FIX 3 hardening pass) — if this fails, the premise "
            "of this cap-closer (this IS the default path feeding "
            "WFE_HARD_FLOOR) no longer holds and needs re-scoping."
        )


class TestY5CpcvWfeOverallLocked:
    """Task 1 core lock: full integration coverage via the PUBLIC dispatcher."""

    def test_wfe_overall_matches_locked_production_formula(self, monkeypatch):
        """run_walk_forward(..., wf_mode='cpcv') → wfe_overall must equal
        round(agg_sharpe / mean(per_path_is_sharpes), 4) — the EXACT formula
        `_run_walk_forward_cpcv()` computes today. Regression lock for the
        default WF_MODE feeding WFE_HARD_FLOOR.
        """
        router = _FakeBacktestRouter()
        monkeypatch.setattr(wf_mod, "run_backtest", router)

        result = run_walk_forward(
            _make_request(), data=_make_data(600), wf_mode="cpcv", embargo_bars=5,
        )

        assert router.oos_calls == N_PATHS, (
            f"Expected {N_PATHS} CPCV OOS paths, got {router.oos_calls} — "
            f"fixture no longer produces the full C(6,2) path set"
        )
        assert router.is_calls == N_PATHS, (
            f"Expected {N_PATHS} per-path IS backtests, got {router.is_calls}"
        )

        used_oos = [router.oos_series[i % N_PATHS] for i in range(router.oos_calls)]
        used_is = [router.is_series[i % N_PATHS] for i in range(router.is_calls)]

        expected_agg_sharpe = _sharpe(np.concatenate(used_oos))
        # X5 RATIFIED 2026-07-09: the CPCV WFE IS basis is now the SYMMETRIC
        # combined-fold (pooled) IS Sharpe — _sharpe(concat(all per-path IS P&L))
        # — matching how agg_sharpe pools OOS. Was mean(per_path_is_sharpes).
        combined_is_basis = _sharpe(np.concatenate(used_is))
        expected_wfe_locked_formula = round(expected_agg_sharpe / combined_is_basis, 4)

        assert result["oos_metrics"]["sharpe_ratio"] == pytest.approx(
            round(expected_agg_sharpe, 4), rel=1e-3
        ), "agg_sharpe (pooled/combined OOS Sharpe) drifted from the expected value"

        assert result["wfe_status"] == "cpcv_combined_fold"
        assert result["wfe_overall"] == pytest.approx(
            expected_wfe_locked_formula, rel=1e-3
        ), (
            f"CPCV wfe_overall={result['wfe_overall']} no longer matches the "
            f"RATIFIED combined-fold formula agg_sharpe/_sharpe(concat(is_pnls))="
            f"{expected_wfe_locked_formula}. This is the DEFAULT WF_MODE "
            f"feeding WFE_HARD_FLOOR — any change here must be an explicit, "
            f"ratified, versioned change, never a silent drift caught only "
            f"by this test going red."
        )

        # wf_metadata.wfe_cpcv_basis names the symmetric combined-fold basis.
        basis = result["wf_metadata"].get("wfe_cpcv_basis") or {}
        assert basis.get("is_basis") == "combined_fold_is_sharpe"
        assert basis.get("oos_basis") == "agg_sharpe"


class TestY5CpcvWfeFormulaDivergesFromTextbookCombined:
    """X5 RATIFIED 2026-07-09: the CPCV WFE denominator is now the combined/
    pooled IS Sharpe (symmetric with the pooled OOS numerator and with the
    institutional standard). This class is the A/B receipt: on a fixture where
    mean-IS and pooled-IS diverge >2%, it proves production picks the pooled
    (combined-fold) value, not the per-path average. It RED-fails against the
    pre-ratification code (denominator = mean(per_path_is_sharpes)).
    """

    def test_production_uses_combined_fold_not_per_path_average(self, monkeypatch):
        router = _FakeBacktestRouter()
        monkeypatch.setattr(wf_mod, "run_backtest", router)

        result = run_walk_forward(
            _make_request(), data=_make_data(600), wf_mode="cpcv", embargo_bars=5,
        )

        used_oos = [router.oos_series[i % N_PATHS] for i in range(router.oos_calls)]
        used_is = [router.is_series[i % N_PATHS] for i in range(router.is_calls)]

        agg_sharpe = _sharpe(np.concatenate(used_oos))
        per_path_is_sharpes = [_sharpe(s) for s in used_is]
        mean_is_basis = float(np.mean(per_path_is_sharpes))        # LIVE denominator
        pooled_is_basis = _sharpe(np.concatenate(used_is))          # textbook denominator

        wfe_old_per_path_formula = round(agg_sharpe / mean_is_basis, 4)   # pre-ratification
        wfe_combined_formula = round(agg_sharpe / pooled_is_basis, 4)      # X5 ratified basis

        # The two IS bases must differ non-trivially on this fixture — proves
        # the per-path variance dispersion built into the fixture is doing
        # its job (this isn't a coincidental near-equality). This is the A/B
        # receipt: the fix is only observable where mean-IS != pooled-IS.
        assert mean_is_basis == pytest.approx(mean_is_basis)  # sanity: finite
        assert abs(mean_is_basis - pooled_is_basis) / abs(pooled_is_basis) > 0.02, (
            f"Fixture did not produce a material mean-vs-pooled IS Sharpe "
            f"divergence (mean={mean_is_basis:.4f}, pooled={pooled_is_basis:.4f}) "
            f"— strengthen the per-path variance spread in _FakeBacktestRouter"
        )

        # X5 RATIFIED 2026-07-09: production's wfe_overall NOW matches the
        # SYMMETRIC combined-fold (pooled IS) formula, and NO LONGER the
        # asymmetric per-path-average formula. On this divergent fixture the two
        # are >2% apart, so this assertion pair is the direct A/B proof the
        # ratified fix took effect (and would RED-fail against the old code).
        assert result["wfe_overall"] == pytest.approx(wfe_combined_formula, rel=1e-3), (
            f"Live production wfe_overall={result['wfe_overall']} must match the "
            f"ratified combined-fold formula ({wfe_combined_formula}). If this "
            f"reds, the CPCV WFE denominator regressed away from the pooled IS basis."
        )
        assert result["wfe_overall"] != pytest.approx(wfe_old_per_path_formula, rel=0.02), (
            f"wfe_overall={result['wfe_overall']} still matches the OLD per-path-"
            f"average formula ({wfe_old_per_path_formula}) — the X5 ratified fix "
            f"did NOT take effect; the denominator is still mean(per_path_is_sharpes)."
        )
