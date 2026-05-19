"""Unit tests for critic_optimizer.py — FIX 1 (decay/drift/live-sharpe wiring).

Tests verify:
  1. EvidenceAggregator.add_decay_analysis() sets decay_penalty=1.0 for decline statuses.
  2. EvidenceAggregator.add_drift_alerts() normalizes alert count to [0,1].
  3. EvidenceAggregator.add_live_sharpe() computes proximity score correctly.
  4. run_critic_optimizer() composite score is reduced for a degraded packet vs a clean packet.
"""
from __future__ import annotations

import pytest

from src.engine.critic_optimizer import (
    EvidenceAggregator,
    CompositeObjective,
    run_critic_optimizer,
)


# ─── EvidenceAggregator.add_decay_analysis ────────────────────────────────────

class TestAddDecayAnalysis:
    def test_declining_status_sets_penalty_1(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "declining"})
        assert ev.decay_penalty == 1.0

    def test_degrading_status_sets_penalty_1(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "degrading"})
        assert ev.decay_penalty == 1.0

    def test_quarantine_sets_penalty_1(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "quarantine"})
        assert ev.decay_penalty == 1.0

    def test_retire_sets_penalty_1(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "retire"})
        assert ev.decay_penalty == 1.0

    def test_stable_status_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "stable"})
        assert ev.decay_penalty == 0.0

    def test_healthy_status_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "healthy"})
        assert ev.decay_penalty == 0.0

    def test_none_input_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis(None)
        assert ev.decay_penalty == 0.0

    def test_case_insensitive(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({"status": "DECLINING"})
        assert ev.decay_penalty == 1.0

    def test_missing_status_key_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_decay_analysis({})
        assert ev.decay_penalty == 0.0


# ─── EvidenceAggregator.add_drift_alerts ─────────────────────────────────────

class TestAddDriftAlerts:
    def test_empty_list_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts([])
        assert ev.drift_penalty == 0.0

    def test_none_sets_penalty_0(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts(None)
        assert ev.drift_penalty == 0.0

    def test_one_drift_alert_normalizes_to_one_third(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts([{"type": "drift"}])
        assert abs(ev.drift_penalty - 1 / 3.0) < 1e-6

    def test_two_drift_alerts_normalizes_to_two_thirds(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts([{"type": "drift"}, {"type": "decay"}])
        assert abs(ev.drift_penalty - 2 / 3.0) < 1e-6

    def test_three_or_more_alerts_caps_at_1(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts([
            {"type": "drift"},
            {"type": "decay"},
            {"type": "degradation"},
            {"type": "regime_change"},
        ])
        assert ev.drift_penalty == 1.0

    def test_drawdown_alert_excluded(self):
        # drawdown type is not a SIGNAL_TYPE for drift penalty
        ev = EvidenceAggregator()
        ev.add_drift_alerts([{"type": "drawdown"}])
        assert ev.drift_penalty == 0.0

    def test_regime_change_counts(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts([{"type": "regime_change"}])
        assert ev.drift_penalty > 0.0

    def test_non_dict_items_skipped_gracefully(self):
        ev = EvidenceAggregator()
        ev.add_drift_alerts(["bad", None, {"type": "drift"}])
        assert abs(ev.drift_penalty - 1 / 3.0) < 1e-6


# ─── EvidenceAggregator.add_live_sharpe ──────────────────────────────────────

class TestAddLiveSharpe:
    def test_within_half_std_returns_1(self):
        ev = EvidenceAggregator()
        # bt=2.0, std_proxy=0.5, distance=0.1 → within 0.5 std
        ev.add_live_sharpe(live_rolling_sharpe=2.1, backtest_sharpe=2.0)
        assert ev.live_sharpe_match == 1.0

    def test_exact_match_returns_1(self):
        ev = EvidenceAggregator()
        ev.add_live_sharpe(live_rolling_sharpe=2.0, backtest_sharpe=2.0)
        assert ev.live_sharpe_match == 1.0

    def test_at_2_std_returns_0(self):
        ev = EvidenceAggregator()
        # bt=2.0, std_proxy=|2.0|*0.25=0.5, distance=1.0, distance_in_std=2.0 → 0
        ev.add_live_sharpe(live_rolling_sharpe=1.0, backtest_sharpe=2.0)
        assert ev.live_sharpe_match == 0.0

    def test_beyond_2_std_returns_0(self):
        ev = EvidenceAggregator()
        ev.add_live_sharpe(live_rolling_sharpe=0.0, backtest_sharpe=2.0)
        assert ev.live_sharpe_match == 0.0

    def test_none_live_sharpe_returns_neutral(self):
        ev = EvidenceAggregator()
        ev.add_live_sharpe(live_rolling_sharpe=None, backtest_sharpe=2.0)
        assert ev.live_sharpe_match == 0.5

    def test_none_backtest_sharpe_returns_neutral(self):
        ev = EvidenceAggregator()
        ev.add_live_sharpe(live_rolling_sharpe=1.5, backtest_sharpe=None)
        assert ev.live_sharpe_match == 0.5

    def test_zero_backtest_sharpe_returns_neutral(self):
        ev = EvidenceAggregator()
        ev.add_live_sharpe(live_rolling_sharpe=1.5, backtest_sharpe=0.0)
        assert ev.live_sharpe_match == 0.5

    def test_midpoint_decay_is_between_0_and_1(self):
        ev = EvidenceAggregator()
        # bt=2.0, std_proxy=0.5, distance=0.5, distance_in_std=1.0 → linear midpoint
        ev.add_live_sharpe(live_rolling_sharpe=1.5, backtest_sharpe=2.0)
        assert 0.0 < ev.live_sharpe_match < 1.0


# ─── CompositeObjective with new weights ─────────────────────────────────────

class TestCompositeObjectiveNewWeights:
    def test_decay_penalty_reduces_score(self):
        obj = CompositeObjective()
        clean = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 0.0, "drift_penalty": 0.0, "live_sharpe_match": 1.0,
        })
        degraded = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 1.0, "drift_penalty": 0.0, "live_sharpe_match": 1.0,
        })
        assert obj.score(degraded) < obj.score(clean)

    def test_drift_penalty_reduces_score(self):
        obj = CompositeObjective()
        clean = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 0.0, "drift_penalty": 0.0, "live_sharpe_match": 1.0,
        })
        drifted = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 0.0, "drift_penalty": 1.0, "live_sharpe_match": 1.0,
        })
        assert obj.score(drifted) < obj.score(clean)

    def test_low_live_sharpe_match_reduces_score(self):
        obj = CompositeObjective()
        good_match = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 0.0, "drift_penalty": 0.0, "live_sharpe_match": 1.0,
        })
        bad_match = obj.normalize_metrics({
            "total_return": 10000, "survival_rate": 0.85, "profit_factor": 2.5,
            "avg_daily_pnl": 400, "max_drawdown": 1000, "breach_probability": 0.0,
            "param_instability": 0.0, "fragility_score": 0.0, "timing_fragility": 0.0,
            "decay_penalty": 0.0, "drift_penalty": 0.0, "live_sharpe_match": 0.0,
        })
        assert obj.score(bad_match) < obj.score(good_match)


# ─── run_critic_optimizer end-to-end score reduction test ────────────────────

class TestRunCriticOptimizerDecayDriftLiveSharpe:
    """FIX 1 integration: degraded packet scores lower than clean packet."""

    BASE_CONFIG = {
        "strategy_config": {"indicators": [{"type": "ema", "period": 20}]},
        "backtest_metrics": {
            "total_return": 12000,
            "survival_rate": 0.82,
            "profit_factor": 2.2,
            "avg_daily_pnl": 380,
            "max_drawdown": 1100,
            "sharpe_ratio": 2.0,
        },
        "walk_forward": {
            "param_stability": {
                "ema_period": {
                    "mean": 20.0, "std": 1.5, "range": 4.0, "n_windows": 4,
                    "robust_min": 18.5, "robust_max": 21.5,
                }
            }
        },
        "mc_result": {"survival_rate": 0.82, "probabilityOfRuin": 0.18, "breach_probability": None},
        "quantum_mc_result": None,
        "sqa_result": None,
        "qubo_timing": None,
        "tensor_prediction": None,
        "rl_result": None,
        "deepar_evidence": None,
        "param_ranges": [{"name": "ema_period", "min_val": 10, "max_val": 40, "n_bits": 4}],
        "max_candidates": 3,
        "pennylane_enabled": False,
        "historical_runs": [],
    }

    def test_degraded_packet_scores_lower_than_clean(self):
        import copy

        clean_config = copy.deepcopy(self.BASE_CONFIG)
        clean_config["decay_analysis"] = {"status": "stable"}
        clean_config["drift_alerts"] = []
        clean_config["live_rolling_sharpe"] = 1.9  # close to backtest 2.0

        degraded_config = copy.deepcopy(self.BASE_CONFIG)
        degraded_config["decay_analysis"] = {"status": "declining"}
        degraded_config["drift_alerts"] = [
            {"type": "drift", "severity": "critical"},
            {"type": "decay", "severity": "warning"},
            {"type": "regime_change", "severity": "warning"},
        ]
        degraded_config["live_rolling_sharpe"] = 0.3  # far below backtest 2.0

        clean_result = run_critic_optimizer(clean_config)
        degraded_result = run_critic_optimizer(degraded_config)

        clean_score = clean_result["parent_composite_score"]
        degraded_score = degraded_result["parent_composite_score"]

        assert degraded_score < clean_score, (
            f"Expected degraded score ({degraded_score:.4f}) < clean score ({clean_score:.4f})"
        )

    def test_degraded_evidence_summary_exposes_new_fields(self):
        import copy
        config = copy.deepcopy(self.BASE_CONFIG)
        config["decay_analysis"] = {"status": "declining"}
        config["drift_alerts"] = [{"type": "drift"}]
        config["live_rolling_sharpe"] = 0.5

        result = run_critic_optimizer(config)
        summary = result["evidence_summary"]

        assert "decay_penalty" in summary
        assert "drift_penalty" in summary
        assert "live_sharpe_match" in summary
        assert summary["decay_penalty"] == 1.0
        assert summary["drift_penalty"] > 0.0
        assert 0.0 <= summary["live_sharpe_match"] <= 1.0
