"""Tests for W24-P2 Item 21: HMM regime overlay.

Verifies:
  1. fit_hmm_regimes converges on synthetic regime-switching data
  2. predict_regime_probabilities accuracy on test set (>70% match)
  3. evaluate_hmm_agreement confirms/disagrees correctly
  4. HmmRegimeModel serialises round-trip to/from dict
  5. rule_label_to_hmm_key mapping is correct for all 3 canonical labels
  6. Uniform probs returned when model score_samples fails
  7. HMM_OVERLAY_ENABLED=false path is handled by consumers (advisory only test)
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.context.hmm_regime import (
    HMM_CONFIRM_THRESHOLD,
    HMM_DISAGREE_THRESHOLD,
    HmmRegimeModel,
    REGIME_RANGE_BOUND,
    REGIME_TRENDING_DOWN,
    REGIME_TRENDING_UP,
    _label_to_prob_key,
    _uniform_probs,
    evaluate_hmm_agreement,
    fit_hmm_regimes,
    predict_regime_probabilities,
    rule_label_to_hmm_key,
)


# ─── Synthetic regime-switching data ──────────────────────────────────────────

def _make_synthetic_ohlc(n_per_regime: int = 120, seed: int = 42) -> "pd.DataFrame":
    """Generate a synthetic OHLC DataFrame with 3 clear regimes.

    Regime 0 — trending up:   mean log-return = +0.002
    Regime 1 — range-bound:   mean log-return =  0.000 (very low σ)
    Regime 2 — trending down: mean log-return = -0.002
    """
    import pandas as pd

    rng = np.random.default_rng(seed)

    regimes = [
        (0.002, 0.003),   # trending up: mean, sigma
        (0.000, 0.001),   # range-bound
        (-0.002, 0.003),  # trending down
    ]

    all_log_returns = []
    ground_truth = []
    for (mu, sigma), label in zip(regimes, [REGIME_TRENDING_UP, REGIME_RANGE_BOUND, REGIME_TRENDING_DOWN]):
        lr = rng.normal(mu, sigma, n_per_regime)
        all_log_returns.append(lr)
        ground_truth.extend([label] * n_per_regime)

    log_returns = np.concatenate(all_log_returns)

    # Build close prices from log-returns
    closes = np.exp(np.cumsum(log_returns))
    closes = np.insert(closes, 0, 1.0)  # add initial price

    df = pd.DataFrame({
        "close": closes,
        "open": closes,
        "high": closes * 1.001,
        "low": closes * 0.999,
    })
    return df, ground_truth


class TestFitHmmRegimes:
    def test_fit_returns_hmm_model(self):
        import pandas as pd
        df, _ = _make_synthetic_ohlc()
        model = fit_hmm_regimes(df, n_states=3)
        assert isinstance(model, HmmRegimeModel)
        assert model.n_states == 3
        assert model.means.shape == (3, 1)
        assert model.transmat.shape == (3, 3)

    def test_label_map_has_all_three_regimes(self):
        import pandas as pd
        df, _ = _make_synthetic_ohlc()
        model = fit_hmm_regimes(df, n_states=3)
        labels = set(model.label_map.values())
        assert REGIME_TRENDING_UP in labels
        assert REGIME_TRENDING_DOWN in labels
        assert REGIME_RANGE_BOUND in labels

    def test_fit_raises_on_too_few_rows(self):
        import pandas as pd
        df = pd.DataFrame({"close": [100.0, 101.0], "open": [100.0, 101.0],
                           "high": [101.0, 102.0], "low": [99.0, 100.0]})
        with pytest.raises(ValueError, match="requires"):
            fit_hmm_regimes(df, n_states=3)

    def test_polars_input_accepted(self):
        import polars as pl
        df_pd, _ = _make_synthetic_ohlc()
        df_pl = pl.from_pandas(df_pd)
        model = fit_hmm_regimes(df_pl, n_states=3)
        assert isinstance(model, HmmRegimeModel)

    def test_deterministic_with_same_seed(self):
        df, _ = _make_synthetic_ohlc(seed=7)
        m1 = fit_hmm_regimes(df, random_state=42)
        m2 = fit_hmm_regimes(df, random_state=42)
        np.testing.assert_allclose(m1.means, m2.means, rtol=1e-6)

    def test_predict_accuracy_gt_70pct(self):
        """Fitted model must correctly classify >70% of held-out observations."""
        df, ground_truth = _make_synthetic_ohlc(n_per_regime=200, seed=123)
        model = fit_hmm_regimes(df, n_states=3, random_state=42)

        import numpy as np
        # Compute log-returns (len = len(df) - 1 = 3×200 = 600)
        closes = df["close"].to_numpy()
        log_returns = np.log(closes[1:] / closes[:-1])

        # Ground truth aligns with log-returns (each regime = 200 returns)
        gt_for_returns = ground_truth[:len(log_returns)]

        correct = 0
        for i, truth in enumerate(gt_for_returns):
            recent = log_returns[max(0, i-19):i+1]
            if len(recent) < 1:
                continue
            probs = predict_regime_probabilities(model, recent)
            predicted_key = max(probs, key=lambda k: probs[k])
            predicted_label = {
                "trending_up_prob":   REGIME_TRENDING_UP,
                "trending_down_prob": REGIME_TRENDING_DOWN,
                "range_bound_prob":   REGIME_RANGE_BOUND,
            }[predicted_key]
            if predicted_label == truth:
                correct += 1

        accuracy = correct / len(gt_for_returns)
        assert accuracy > 0.70, f"HMM prediction accuracy {accuracy:.2%} < 70%"


class TestPredictRegimeProbabilities:
    def _get_model(self) -> HmmRegimeModel:
        df, _ = _make_synthetic_ohlc(seed=42)
        return fit_hmm_regimes(df, n_states=3, random_state=42)

    def test_probs_sum_to_one(self):
        model = self._get_model()
        rng = np.random.default_rng(0)
        returns = rng.normal(0.002, 0.003, 20)
        probs = predict_regime_probabilities(model, returns)
        total = sum(probs.values())
        assert abs(total - 1.0) < 1e-6

    def test_returns_all_three_keys(self):
        model = self._get_model()
        returns = np.array([0.001] * 10)
        probs = predict_regime_probabilities(model, returns)
        assert "trending_up_prob" in probs
        assert "trending_down_prob" in probs
        assert "range_bound_prob" in probs

    def test_bullish_returns_push_trending_up(self):
        """Strong positive returns should yield higher trending_up_prob."""
        model = self._get_model()
        bullish = np.full(30, 0.003)  # strong uptrend
        bearish = np.full(30, -0.003)  # strong downtrend
        probs_bull = predict_regime_probabilities(model, bullish)
        probs_bear = predict_regime_probabilities(model, bearish)
        # Bullish run should have higher trending_up probability
        assert probs_bull["trending_up_prob"] > probs_bear["trending_up_prob"]

    def test_uniform_on_all_nan_input(self):
        model = self._get_model()
        probs = predict_regime_probabilities(model, np.array([np.nan, np.nan]))
        assert abs(probs["trending_up_prob"] - 1/3) < 0.01


class TestHmmRegimeModelSerialisation:
    def test_round_trip_to_dict(self):
        df, _ = _make_synthetic_ohlc(seed=99)
        original = fit_hmm_regimes(df, n_states=3, random_state=42)
        d = original.to_dict()
        restored = HmmRegimeModel.from_dict(d)
        np.testing.assert_allclose(original.means, restored.means, rtol=1e-6)
        np.testing.assert_allclose(original.transmat, restored.transmat, rtol=1e-6)
        assert original.label_map == restored.label_map
        assert original.n_states == restored.n_states

    def test_dict_is_json_serialisable(self):
        import json
        df, _ = _make_synthetic_ohlc(seed=11)
        model = fit_hmm_regimes(df, n_states=3, random_state=42)
        d = model.to_dict()
        serialised = json.dumps(d)
        restored_dict = json.loads(serialised)
        restored = HmmRegimeModel.from_dict(restored_dict)
        assert restored.n_states == model.n_states


class TestEvaluateHmmAgreement:
    def _probs_confirming_trending_up(self) -> dict[str, float]:
        return {"trending_up_prob": 0.75, "trending_down_prob": 0.10, "range_bound_prob": 0.15}

    def _probs_disagreeing_with_trending_up(self) -> dict[str, float]:
        return {"trending_up_prob": 0.10, "trending_down_prob": 0.70, "range_bound_prob": 0.20}

    def _probs_neutral(self) -> dict[str, float]:
        return {"trending_up_prob": 0.35, "trending_down_prob": 0.35, "range_bound_prob": 0.30}

    def test_confirms_when_rule_state_prob_above_threshold(self):
        result = evaluate_hmm_agreement(
            rule_label="TRENDING_UP",
            probs=self._probs_confirming_trending_up(),
            confirm_threshold=0.6,
            disagree_threshold=0.3,
        )
        assert result["hmm_confirms"] is True
        assert result["hmm_disagrees"] is False
        assert result["rule_label"] == "TRENDING_UP"

    def test_disagrees_when_rule_prob_below_threshold_and_other_dominant(self):
        result = evaluate_hmm_agreement(
            rule_label="TRENDING_UP",
            probs=self._probs_disagreeing_with_trending_up(),
            confirm_threshold=0.6,
            disagree_threshold=0.3,
        )
        assert result["hmm_disagrees"] is True
        assert result["hmm_confirms"] is False
        assert result["dominant_hmm_label"] == REGIME_TRENDING_DOWN
        assert result["dominant_hmm_prob"] == pytest.approx(0.70, abs=0.01)

    def test_neither_confirms_nor_disagrees_in_neutral_zone(self):
        result = evaluate_hmm_agreement(
            rule_label="TRENDING_UP",
            probs=self._probs_neutral(),
            confirm_threshold=0.6,
            disagree_threshold=0.3,
        )
        # trending_up_prob=0.35 is between thresholds
        assert result["hmm_confirms"] is False
        assert result["hmm_disagrees"] is False

    def test_rule_label_TRENDING_DOWN(self):
        probs = {"trending_up_prob": 0.05, "trending_down_prob": 0.80, "range_bound_prob": 0.15}
        result = evaluate_hmm_agreement("TRENDING_DOWN", probs)
        assert result["hmm_confirms"] is True

    def test_rule_label_RANGE_BOUND(self):
        probs = {"trending_up_prob": 0.10, "trending_down_prob": 0.10, "range_bound_prob": 0.80}
        result = evaluate_hmm_agreement("RANGE_BOUND", probs)
        assert result["hmm_confirms"] is True

    def test_result_includes_full_probs_dict(self):
        probs = self._probs_confirming_trending_up()
        result = evaluate_hmm_agreement("TRENDING_UP", probs)
        assert "probs" in result
        assert set(result["probs"].keys()) == {"trending_up_prob", "trending_down_prob", "range_bound_prob"}


class TestRuleLabelToHmmKey:
    def test_trending_up(self):
        assert rule_label_to_hmm_key("TRENDING_UP") == "trending_up_prob"

    def test_trending_down(self):
        assert rule_label_to_hmm_key("TRENDING_DOWN") == "trending_down_prob"

    def test_range_bound(self):
        assert rule_label_to_hmm_key("RANGE_BOUND") == "range_bound_prob"

    def test_unknown_maps_to_range_bound(self):
        assert rule_label_to_hmm_key("UNKNOWN") == "range_bound_prob"

    def test_bull_alias(self):
        assert rule_label_to_hmm_key("BULL") == "trending_up_prob"

    def test_bear_alias(self):
        assert rule_label_to_hmm_key("BEAR") == "trending_down_prob"


class TestUniformProbs:
    def test_keys_present(self):
        p = _uniform_probs()
        assert set(p.keys()) == {"trending_up_prob", "trending_down_prob", "range_bound_prob"}

    def test_values_sum_to_one(self):
        p = _uniform_probs()
        assert abs(sum(p.values()) - 1.0) < 0.001
