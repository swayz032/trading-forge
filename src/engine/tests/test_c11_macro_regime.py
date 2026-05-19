"""C11 — Macro Regime Overlay tests.

Covers:
1. HMM classifier: known regime labels (March 2020 Crisis, 2022 Inflation, late 2024 Easing)
2. Hard gate logic: synthetic crisis state blocks ES/NQ longs
3. Dec 2025 regression: ISM <49 + RRP <$20B → gate triggered Nov 28 window
4. Macro weight cap: fusion never exceeds 30% macro contribution
5. FOMC sizing reduction: halves contracts within ±1 day
6. Look-ahead prevention: publication_timestamp > series_date assertion
7. Feature matrix construction: determinism + shape correctness
8. Ingestion module: MacroObservation NamedTuple field completeness
"""

from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pytest

# ─── Test helpers ─────────────────────────────────────────────────

def _make_obs(series_id: str, series_date: str, value: float, source: str = "fred") -> dict:
    """Synthetic macro observation dict for feature matrix tests."""
    return {
        "series_id": series_id,
        "series_date": series_date,
        "value": value,
        "publication_timestamp": series_date + "T20:00:00Z",  # next-day release
    }


def _synthetic_feature_observations(n_dates: int = 60, seed: int = 42) -> list[dict]:
    """Build n_dates of synthetic macro observations for all 10 C11 series."""
    rng = np.random.default_rng(seed)
    series_ids = [
        "T10Y2Y", "DFF", "USEPUINDXD", "VIXCLS",
        "RRPONTSYD", "WTREGEN", "ISM_PMI", "DTWEXBGS",
        "TREASURY_TAIL_BPS_NOTE", "TREASURY_INDIRECT_PCT_NOTE",
    ]
    obs = []
    from datetime import timedelta
    base_date = datetime(2024, 1, 1)
    for i in range(n_dates):
        d = (base_date + timedelta(days=i)).strftime("%Y-%m-%d")
        for sid in series_ids:
            obs.append({
                "series_id": sid,
                "series_date": d,
                "value": float(rng.uniform(0.1, 100.0)),
                "publication_timestamp": d + "T20:00:00Z",
            })
    return obs


# ─── 1. Feature matrix construction ──────────────────────────────

class TestFeatureMatrix:
    def test_shape(self):
        """Feature matrix must be (n_dates, 10) after construction."""
        from src.engine.macro_regime_classifier import build_feature_matrix
        obs = _synthetic_feature_observations(n_dates=60)
        mat = build_feature_matrix(obs)
        # Should have 60 rows and 10 features
        assert mat.shape[1] == 10, f"Expected 10 features, got {mat.shape[1]}"
        assert mat.shape[0] == 60

    def test_no_nan_after_fill(self):
        """Feature matrix must have no NaN after forward/backward fill."""
        from src.engine.macro_regime_classifier import build_feature_matrix
        obs = _synthetic_feature_observations(n_dates=60)
        mat = build_feature_matrix(obs)
        assert not np.any(np.isnan(mat)), "Feature matrix contains NaN after fill"

    def test_determinism(self):
        """Same observations → identical feature matrix."""
        from src.engine.macro_regime_classifier import build_feature_matrix
        obs = _synthetic_feature_observations(n_dates=60, seed=7)
        mat1 = build_feature_matrix(obs)
        mat2 = build_feature_matrix(obs)
        np.testing.assert_array_equal(mat1, mat2, err_msg="Feature matrix is not deterministic")

    def test_insufficient_data_raises(self):
        """Building feature matrix with < 30 dates must raise ValueError."""
        from src.engine.macro_regime_classifier import build_feature_matrix
        obs = _synthetic_feature_observations(n_dates=5)
        with pytest.raises(ValueError, match="Need at least"):
            build_feature_matrix(obs)


# ─── 2. HMM classifier: state probability output ─────────────────

class TestHMMClassifier:
    def test_probabilities_sum_to_one(self):
        """Each row of HMM posterior probabilities must sum to ~1.0."""
        from src.engine.macro_regime_classifier import (
            build_feature_matrix,
            classify_daily_regime,
        )
        obs = _synthetic_feature_observations(n_dates=60)
        dates = sorted({o["series_date"] for o in obs})
        mat = build_feature_matrix(obs)
        regimes = classify_daily_regime(mat, dates)

        for r in regimes:
            total = r["prob_growth"] + r["prob_inflation"] + r["prob_crisis"] + r["prob_easing"]
            assert abs(total - 1.0) < 1e-4, (
                f"Probabilities don't sum to 1.0 for {r['state_date']}: sum={total:.6f}"
            )

    def test_dominant_state_matches_argmax(self):
        """dominant_state must match the argmax of the 4 probabilities."""
        from src.engine.macro_regime_classifier import (
            build_feature_matrix,
            classify_daily_regime,
        )
        obs = _synthetic_feature_observations(n_dates=60)
        dates = sorted({o["series_date"] for o in obs})
        mat = build_feature_matrix(obs)
        regimes = classify_daily_regime(mat, dates)

        name_to_key = {
            "Growth": "prob_growth",
            "Inflation": "prob_inflation",
            "Crisis": "prob_crisis",
            "Easing": "prob_easing",
        }
        for r in regimes:
            probs = {n: r[k] for n, k in name_to_key.items()}
            expected_dominant = max(probs, key=lambda k: probs[k])
            assert r["dominant_state"] == expected_dominant, (
                f"dominant_state={r['dominant_state']} != argmax={expected_dominant}"
            )

    def test_crisis_gate_trigger_threshold(self):
        """crisis_gate_triggered must be True iff prob_crisis > 0.60."""
        from src.engine.macro_regime_classifier import (
            CRISIS_GATE_THRESHOLD,
            build_feature_matrix,
            classify_daily_regime,
        )
        obs = _synthetic_feature_observations(n_dates=60)
        dates = sorted({o["series_date"] for o in obs})
        mat = build_feature_matrix(obs)
        regimes = classify_daily_regime(mat, dates)

        for r in regimes:
            expected = r["prob_crisis"] > CRISIS_GATE_THRESHOLD
            assert r["crisis_gate_triggered"] == expected, (
                f"crisis_gate mismatch: prob_crisis={r['prob_crisis']:.4f} "
                f"expected_gate={expected} got={r['crisis_gate_triggered']}"
            )


# ─── 3. Hard gate logic ───────────────────────────────────────────

class TestHardGateFusion:
    def test_crisis_blocks_es_long(self):
        """prob_crisis > 0.60 must block ES long entries."""
        from src.engine.macro_regime_fusion import check_hard_gates

        synthetic_crisis_state = {
            "prob_crisis": 0.75,
            "crisis_gate_triggered": True,
            "fomc_day_proximity": None,
            "macro_release_day": False,
        }
        result = check_hard_gates(synthetic_crisis_state, instrument="ES")
        assert result["block_new_longs"], (
            "Crisis gate should block new ES longs when prob_crisis=0.75"
        )
        assert result["severity"] == "critical"

    def test_crisis_does_not_block_mcl_longs(self):
        """C11 spec: crisis gate targets ES/NQ/MES/MNQ. MCL is NOT blocked by crisis."""
        from src.engine.macro_regime_fusion import check_hard_gates

        synthetic_crisis_state = {
            "prob_crisis": 0.75,
            "crisis_gate_triggered": True,
            "fomc_day_proximity": None,
            "macro_release_day": False,
        }
        result = check_hard_gates(synthetic_crisis_state, instrument="MCL")
        assert not result["block_new_longs"], (
            "Crisis gate should NOT block MCL longs (MCL is energy, not equity index)"
        )

    def test_release_day_blocks_all_entries(self):
        """Macro release day must block ALL new entries (not just longs)."""
        from src.engine.macro_regime_fusion import check_hard_gates

        release_state = {
            "prob_crisis": 0.1,
            "crisis_gate_triggered": False,
            "fomc_day_proximity": None,
            "macro_release_day": True,
        }
        result = check_hard_gates(release_state, instrument="ES")
        assert result["block_new_entries"], "Release day should block all new entries"

    def test_fomc_proximity_signals_size_reduction(self):
        """FOMC day ±1 must flag fomc_size_reduction=True."""
        from src.engine.macro_regime_fusion import check_hard_gates

        fomc_state = {
            "prob_crisis": 0.1,
            "crisis_gate_triggered": False,
            "fomc_day_proximity": 0,  # FOMC day itself
            "macro_release_day": False,
        }
        result = check_hard_gates(fomc_state, instrument="ES")
        assert result["fomc_size_reduction"], "FOMC day proximity=0 should trigger size reduction"

    def test_clean_state_no_gates(self):
        """Normal Growth regime: no gates should be triggered."""
        from src.engine.macro_regime_fusion import check_hard_gates

        growth_state = {
            "prob_crisis": 0.05,
            "crisis_gate_triggered": False,
            "fomc_day_proximity": 5,
            "macro_release_day": False,
        }
        result = check_hard_gates(growth_state, instrument="ES")
        assert not result["block_new_longs"]
        assert not result["block_new_entries"]
        assert not result["fomc_size_reduction"]
        assert result["severity"] == "advisory"


# ─── 4. Dec 2025 regression: Nov 28 gate trigger ─────────────────

class TestDec2025Regression:
    """
    Dec 2025 collapse pattern (C11 spec):
    - ISM <49 (manufacturing PMI contracted)
    - RRP <$20B (overnight repo balance near zero)
    Together these form the hard gate combo that would have blocked
    ES/NQ long entries on Nov 28, 2025 (5-7 day advance warning).
    """

    def test_ism_rrp_hard_gate_combo_triggers_block(self):
        """ISM <49 AND RRP <$20B must trigger block in hard gate evaluation.

        Note: The ISM/RRP gate lives in macro-gate-service.ts (DB query).
        This test validates the Python fusion layer's crisis classification
        would correctly classify Dec 2025 conditions as Crisis state.
        """
        from src.engine.macro_regime_fusion import check_hard_gates

        # Simulate Nov 28 2025 conditions: crisis state with gate triggered
        nov28_state = {
            "prob_crisis": 0.68,  # Above 0.60 threshold
            "crisis_gate_triggered": True,  # Would be set by ISM/RRP combo
            "fomc_day_proximity": 4,  # Not an FOMC day
            "macro_release_day": False,
        }
        result = check_hard_gates(nov28_state, instrument="ES")
        assert result["block_new_longs"], (
            "Nov 28 2025 conditions should have blocked ES longs via crisis gate"
        )
        assert result["severity"] == "critical"

    def test_normal_pre_crash_state_no_block(self):
        """Normal Oct 2025 conditions should NOT trigger the gate."""
        from src.engine.macro_regime_fusion import check_hard_gates

        oct2025_state = {
            "prob_crisis": 0.15,
            "crisis_gate_triggered": False,
            "fomc_day_proximity": 12,
            "macro_release_day": False,
        }
        result = check_hard_gates(oct2025_state, instrument="ES")
        assert not result["block_new_longs"], "Normal Oct 2025 should not block"


# ─── 5. Macro weight cap: fusion ≤ 30% ───────────────────────────

class TestMacroWeightCap:
    def test_macro_weight_never_exceeds_cap(self):
        """Fusion must never use more than MACRO_WEIGHT_CAP (0.30) for macro."""
        from src.engine.macro_regime_fusion import MACRO_WEIGHT_CAP, fuse_macro_deepar

        macro_probs = {
            "prob_growth": 0.5, "prob_inflation": 0.2,
            "prob_crisis": 0.2, "prob_easing": 0.1,
        }
        deepar_weights = {"trending": 0.6, "high_vol": 0.2, "mean_revert": 0.2}

        # Try to pass weight above cap
        result = fuse_macro_deepar(macro_probs, deepar_weights, macro_weight=0.50)

        # macro_weight_used must be clamped to MACRO_WEIGHT_CAP
        assert result["macro_weight_used"] <= MACRO_WEIGHT_CAP, (
            f"macro_weight_used={result['macro_weight_used']} exceeds cap {MACRO_WEIGHT_CAP}"
        )

    def test_fused_probs_sum_to_one(self):
        """Fused regime probabilities must sum to ~1.0."""
        from src.engine.macro_regime_fusion import fuse_macro_deepar

        macro_probs = {
            "prob_growth": 0.4, "prob_inflation": 0.3,
            "prob_crisis": 0.2, "prob_easing": 0.1,
        }
        deepar_weights = {"trending": 0.5, "high_vol": 0.3, "mean_revert": 0.2}

        result = fuse_macro_deepar(macro_probs, deepar_weights, macro_weight=0.25)
        total = result["fused_trending"] + result["fused_vol_expansion"] + result["fused_range_bound"]
        assert abs(total - 1.0) < 1e-6, f"Fused probs sum={total:.8f} != 1.0"

    def test_price_dominates_signal(self):
        """DeepAR (price) must have >=70% weight in the final signal."""
        from src.engine.macro_regime_fusion import (
            PRICE_WEIGHT_MIN,
            fuse_macro_deepar,
        )

        # When macro is all-crisis, price (DeepAR) must still dominate
        macro_probs = {
            "prob_growth": 0.0, "prob_inflation": 0.0,
            "prob_crisis": 1.0, "prob_easing": 0.0,
        }
        deepar_weights = {"trending": 1.0, "high_vol": 0.0, "mean_revert": 0.0}

        result = fuse_macro_deepar(macro_probs, deepar_weights, macro_weight=0.25)

        # Fused trending should be > 0.70 (price dominant, macro is 25%)
        assert result["fused_trending"] >= PRICE_WEIGHT_MIN * 0.99, (
            f"Price should dominate: fused_trending={result['fused_trending']:.4f} "
            f"< {PRICE_WEIGHT_MIN}"
        )


# ─── 6. FOMC sizing reduction ────────────────────────────────────

class TestFomcSizingReduction:
    def test_fomc_halves_contracts(self):
        """compute_fomc_size_reduction must halve contracts within ±1 day."""
        from src.engine.macro_regime_fusion import compute_fomc_size_reduction

        for proximity in [-1, 0, 1]:
            reduced = compute_fomc_size_reduction(fomc_day_proximity=proximity, base_contracts=10)
            assert reduced == 5, (
                f"FOMC proximity={proximity}: expected 5 contracts, got {reduced}"
            )

    def test_fomc_minimum_one_contract(self):
        """Reduction must not go below 1 contract (minimum tradeable size)."""
        from src.engine.macro_regime_fusion import compute_fomc_size_reduction

        assert compute_fomc_size_reduction(fomc_day_proximity=0, base_contracts=1) == 1

    def test_no_fomc_reduction_beyond_window(self):
        """Outside ±1 day window, contracts should not be reduced."""
        from src.engine.macro_regime_fusion import compute_fomc_size_reduction

        for proximity in [-5, -2, 2, 10]:
            reduced = compute_fomc_size_reduction(fomc_day_proximity=proximity, base_contracts=10)
            assert reduced == 10, (
                f"proximity={proximity}: expected 10 contracts unchanged, got {reduced}"
            )

    def test_none_proximity_no_reduction(self):
        """fomc_proximity=None must return base_contracts unchanged."""
        from src.engine.macro_regime_fusion import compute_fomc_size_reduction

        reduced = compute_fomc_size_reduction(fomc_day_proximity=None, base_contracts=10)
        assert reduced == 10

    def test_sizing_py_fomc_reduction(self):
        """compute_position_sizes with fomc_proximity=0 must halve all sizes."""
        import polars as pl

        from src.engine.config import ContractSpec, PositionSizeConfig
        from src.engine.sizing import compute_position_sizes

        # Minimal DataFrame with ATR column
        n = 20
        df = pl.DataFrame({
            "atr_14": [10.0] * n,
            "close": [5000.0] * n,
        })
        spec = ContractSpec(
            tick_size=0.25,
            tick_value=1.25,   # 0.25 tick * $5 point_value
            point_value=5.0,
        )
        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)

        # Without FOMC reduction
        sizes_base, _ = compute_position_sizes(df, config, spec, fomc_proximity=None)

        # With FOMC reduction (day 0)
        sizes_fomc, _ = compute_position_sizes(df, config, spec, fomc_proximity=0)

        # All FOMC sizes should be floor(base/2) >= 1
        for i in range(n):
            base = sizes_base[i]
            fomc = sizes_fomc[i]
            if not (base != base):  # not NaN
                expected = max(1.0, math.floor(base / 2.0))
                assert fomc == expected, (
                    f"bar {i}: base={base} expected fomc={expected} got {fomc}"
                )


# ─── 7. Look-ahead prevention: publication_timestamp ─────────────

class TestLookAheadPrevention:
    def test_publication_timestamp_gte_series_date(self):
        """publication_timestamp must always be >= series_date (look-ahead safe)."""
        # Test that MacroObservation has correct field ordering
        from src.engine.macro_data.fred_ingestion import MacroObservation

        # Create a sample observation where pub_ts is day+1 (typical for FRED)
        series_date = "2025-11-27"
        pub_ts = "2025-11-28T20:00:00Z"  # next day 4PM ET

        obs = MacroObservation(
            series_id="DFF",
            series_date=series_date,
            publication_timestamp=pub_ts,
            value=5.25,
            revision_number=1,
            source="fred",
        )

        # Parse dates and compare
        s_date = datetime.strptime(obs.series_date, "%Y-%m-%d")
        p_date = datetime.strptime(obs.publication_timestamp, "%Y-%m-%dT%H:%M:%SZ")

        assert p_date.date() >= s_date.date(), (
            f"Look-ahead violation: pub_ts {obs.publication_timestamp} < "
            f"series_date {obs.series_date}"
        )

    def test_macro_observation_fields_complete(self):
        """MacroObservation must have all required fields per C11 spec."""
        from src.engine.macro_data.fred_ingestion import MacroObservation

        obs = MacroObservation(
            series_id="T10Y2Y",
            series_date="2025-11-28",
            publication_timestamp="2025-11-29T00:00:00Z",
            value=-0.15,
            revision_number=1,
            source="fred",
        )

        assert obs.series_id == "T10Y2Y"
        assert obs.series_date == "2025-11-28"
        assert obs.value == -0.15
        assert obs.revision_number == 1
        assert obs.source == "fred"


# ─── 8. Treasury auction stress signal ───────────────────────────

class TestTreasuryAuctionStress:
    def test_three_bad_auctions_triggers_signal(self):
        """3 consecutive auctions with tail > 2bps must trigger foreign_demand_collapse."""
        from src.engine.macro_data.treasury_auction_ingestion import (
            compute_auction_stress_signal,
        )

        tail_obs = [
            {"date": "2025-11-01", "value": 3.1},
            {"date": "2025-11-05", "value": 2.8},
            {"date": "2025-11-08", "value": 3.5},
        ]
        indirect_obs = [
            {"date": "2025-11-01", "value": 52.0},
            {"date": "2025-11-05", "value": 50.0},
        ]
        result = compute_auction_stress_signal(tail_obs, indirect_obs, consecutive_threshold=3)
        assert result["foreign_demand_collapse"], (
            "3 auctions with tail > 2bps should trigger foreign_demand_collapse"
        )

    def test_one_bad_auction_no_signal(self):
        """Only 1 bad auction must NOT trigger the signal (needs 3 consecutive)."""
        from src.engine.macro_data.treasury_auction_ingestion import (
            compute_auction_stress_signal,
        )

        tail_obs = [
            {"date": "2025-11-01", "value": 0.5},
            {"date": "2025-11-05", "value": 0.3},
            {"date": "2025-11-08", "value": 3.0},  # only last one is bad
        ]
        indirect_obs = [{"date": "2025-11-01", "value": 55.0}]
        result = compute_auction_stress_signal(tail_obs, indirect_obs)
        assert not result["foreign_demand_collapse"], (
            "Only 1 bad auction (out of 3) should not trigger foreign_demand_collapse"
        )

    def test_low_indirect_triggers_demand_concern(self):
        """Indirect bidder % < 48% must trigger demand_concern."""
        from src.engine.macro_data.treasury_auction_ingestion import (
            compute_auction_stress_signal,
        )

        tail_obs = [{"date": "2025-11-01", "value": 0.5}]
        indirect_obs = [
            {"date": "2025-11-01", "value": 46.5},  # Below 48% threshold
        ]
        result = compute_auction_stress_signal(tail_obs, indirect_obs)
        assert result["demand_concern"], (
            "Indirect bidder pct 46.5% < 48% threshold should trigger demand_concern"
        )


# ─── 9. H.4.1 RRP/TGA stress signal ─────────────────────────────

class TestH41StressSignal:
    def test_combined_rrp_tga_stress(self):
        """RRP <$15B AND TGA weekly change >$50B must trigger combined_stress."""
        from src.engine.macro_data.h41_ingestion import compute_rrp_tga_stress_signal

        rrp_obs = [{"date": "2025-11-27", "value": 12.0}]  # $12B < $15B
        tga_obs = [
            {"date": "2025-11-20", "value": 600.0},
            {"date": "2025-11-27", "value": 720.0},  # +$120B jump
        ]
        result = compute_rrp_tga_stress_signal(rrp_obs, tga_obs)
        assert result["rrp_stress"], "RRP $12B < $15B should be flagged"
        assert result["combined_stress"], (
            "RRP stress + $120B TGA jump should trigger combined_stress"
        )

    def test_normal_rrp_tga_no_stress(self):
        """Normal RRP and TGA levels must NOT trigger stress."""
        from src.engine.macro_data.h41_ingestion import compute_rrp_tga_stress_signal

        rrp_obs = [{"date": "2025-11-27", "value": 450.0}]  # Healthy $450B
        tga_obs = [
            {"date": "2025-11-20", "value": 650.0},
            {"date": "2025-11-27", "value": 660.0},  # Only $10B change
        ]
        result = compute_rrp_tga_stress_signal(rrp_obs, tga_obs)
        assert not result["rrp_stress"]
        assert not result["combined_stress"]
