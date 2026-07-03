"""Tests for corpus-level FDR control — src/engine/statistics/corpus_fdr.py.

Covers:
  - BH correctness against a hand-computed fixture (known p-vector -> known
    rejections at q=0.05 and q=0.10, verified by manual arithmetic in the
    test docstring, not copied from a remembered textbook example).
  - Sharpe haircut: monotonicity (more trials -> smaller haircut_sharpe /
    larger haircut_pct), edge cases (n_trials=1, non-positive Sharpe,
    non-finite input).
  - Family-grouping logic (per-educator BH vs corpus-wide BH).
  - Noise-floor-absent loud path (calibration_report=None / no trials yet).
  - E[FD] math with Wilson-CI propagation.
  - p-value derivation ladder (pbo_overall_p_value preferred; DSR-derived
    fallback; missing -> excluded, never fabricated).
  - Determinism (repeated calls with identical input -> byte-identical output).
  - build_corpus_report() end-to-end verdict classification.
"""

from __future__ import annotations

import math

import pytest

from src.engine.statistics.corpus_fdr import (
    benjamini_hochberg,
    build_corpus_report,
    compute_family_grouped_fdr,
    compute_sharpe_haircut,
    derive_pvalue_for_strategy,
    expected_false_discoveries,
)


# ── Benjamini-Hochberg: hand-computed fixture ──────────────────────────────────

class TestBenjaminiHochbergFixture:
    """Fixture: p = [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500]
    already sorted ascending, n=10.

    q=0.05 critical line (i/10)*0.05 = 0.005, 0.010, 0.015, 0.020, 0.025, 0.030,
    0.035, 0.040, 0.045, 0.050 for i=1..10.
    p_(i) <= critical_(i)?
      i=1: 0.001<=0.005 T   i=2: 0.005<=0.010 T   i=3: 0.010<=0.015 T
      i=4: 0.020<=0.020 T (equal counts)          i=5: 0.030<=0.025 F
      i=6: 0.040<=0.030 F  i=7: 0.050<=0.035 F    i=8: 0.100<=0.040 F
      i=9: 0.200<=0.045 F  i=10: 0.500<=0.050 F
    Largest passing i = 4 -> reject first 4 (indices 0..3 in sorted order).

    q=0.10 critical line (i/10)*0.10 = 0.01, 0.02, ..., 0.10.
      i=1..7 all pass (0.001,0.005,0.010,0.020,0.030,0.040,0.050 <= 0.01,
      0.02,0.03,0.04,0.05,0.06,0.07 respectively); i=8: 0.100<=0.08 F.
    Largest passing i = 7 -> reject first 7.
    """

    FIXTURE_P = [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500]

    def test_q_05_rejects_exactly_four(self):
        result = benjamini_hochberg(self.FIXTURE_P, q=0.05)
        assert result.num_rejected == 4
        assert result.reject_mask == [True, True, True, True, False, False, False, False, False, False]

    def test_q_10_rejects_exactly_seven(self):
        result = benjamini_hochberg(self.FIXTURE_P, q=0.10)
        assert result.num_rejected == 7
        assert result.reject_mask == [True] * 7 + [False] * 3

    def test_critical_p_at_cutoff_q05(self):
        result = benjamini_hochberg(self.FIXTURE_P, q=0.05)
        assert result.critical_p_at_cutoff == pytest.approx(0.020)

    def test_adjusted_p_values_are_monotone_non_decreasing_in_sorted_order(self):
        result = benjamini_hochberg(self.FIXTURE_P, q=0.05)
        order = sorted(range(len(self.FIXTURE_P)), key=lambda i: self.FIXTURE_P[i])
        adj_sorted = [result.adjusted_p_values[i] for i in order]
        for a, b in zip(adj_sorted, adj_sorted[1:]):
            assert b >= a - 1e-9

    def test_adjusted_p_values_in_zero_one_range(self):
        result = benjamini_hochberg(self.FIXTURE_P, q=0.05)
        for v in result.adjusted_p_values:
            assert 0.0 <= v <= 1.0

    def test_unsorted_input_order_preserved_in_output(self):
        """Shuffle the fixture; reject_mask must map back to ORIGINAL positions."""
        shuffled = [self.FIXTURE_P[3], self.FIXTURE_P[0], self.FIXTURE_P[9], self.FIXTURE_P[6]]
        # positions: 0->orig p=0.020 (rejected at q=0.05 in the full-10 fixture,
        # but BH is population-relative — with only 4 values the ranks differ).
        # Just check self-consistency: recompute critical line for n=4.
        result = benjamini_hochberg(shuffled, q=0.05)
        assert result.n == 4
        # p=0.001 (index 1 in shuffled) must always be significant when it's the min.
        min_idx = shuffled.index(min(shuffled))
        assert result.reject_mask[min_idx] is True

    def test_empty_input(self):
        result = benjamini_hochberg([], q=0.05)
        assert result.n == 0
        assert result.num_rejected == 0
        assert result.reject_mask == []
        assert result.critical_p_at_cutoff is None

    def test_no_rejections_when_all_p_large(self):
        result = benjamini_hochberg([0.9, 0.8, 0.99], q=0.05)
        assert result.num_rejected == 0
        assert result.reject_mask == [False, False, False]

    def test_all_rejected_when_all_p_tiny(self):
        result = benjamini_hochberg([1e-9, 1e-9, 1e-9], q=0.05)
        assert result.num_rejected == 3


# ── Sharpe haircut ──────────────────────────────────────────────────────────────

class TestSharpeHaircut:
    def test_single_trial_no_haircut(self):
        """n_trials=1 -> expected_max_sharpe_h0 == 0.0 -> full Sharpe survives."""
        result = compute_sharpe_haircut(observed_sharpe=1.5, n_trials=1.0)
        assert result["expected_max_sharpe_h0"] == pytest.approx(0.0, abs=1e-6)
        assert result["haircut_sharpe"] == pytest.approx(1.5, rel=1e-4)
        assert result["haircut_pct"] == pytest.approx(0.0, abs=1e-4)
        assert result["verdict"] == "survives_haircut"

    def test_non_positive_sharpe(self):
        result = compute_sharpe_haircut(observed_sharpe=0.0, n_trials=50.0)
        assert result["haircut_sharpe"] == 0.0
        assert result["haircut_pct"] is None
        assert result["verdict"] == "no_positive_edge"

        result_neg = compute_sharpe_haircut(observed_sharpe=-0.5, n_trials=50.0)
        assert result_neg["verdict"] == "no_positive_edge"

    def test_non_finite_input(self):
        result = compute_sharpe_haircut(observed_sharpe=float("nan"), n_trials=10.0)
        assert result["verdict"] == "non_finite_input"
        assert result["haircut_sharpe"] == 0.0

        result_inf = compute_sharpe_haircut(observed_sharpe=float("inf"), n_trials=10.0)
        assert result_inf["verdict"] == "non_finite_input"

    def test_monotonicity_more_trials_smaller_haircut_sharpe(self):
        """Fixed observed_sharpe; haircut_sharpe must be non-increasing in n_trials
        (more trials -> larger E[maxSR] under H0 -> more of the apparent edge is
        attributable to selection -> smaller surviving haircut_sharpe)."""
        observed = 1.2
        trial_counts = [1, 2, 5, 15, 50, 200]
        haircuts = [compute_sharpe_haircut(observed, float(n))["haircut_sharpe"] for n in trial_counts]
        for a, b in zip(haircuts, haircuts[1:]):
            assert b <= a + 1e-9, f"haircut_sharpe not monotone non-increasing: {haircuts}"

    def test_monotonicity_haircut_pct_non_decreasing(self):
        observed = 1.2
        trial_counts = [1, 2, 5, 15, 50, 200]
        pcts = [compute_sharpe_haircut(observed, float(n))["haircut_pct"] for n in trial_counts]
        for a, b in zip(pcts, pcts[1:]):
            assert b >= a - 1e-9, f"haircut_pct not monotone non-decreasing: {pcts}"

    def test_large_n_trials_can_eliminate_modest_edge(self):
        """A small observed Sharpe against a huge trial count should fully haircut."""
        result = compute_sharpe_haircut(observed_sharpe=0.15, n_trials=5000.0)
        assert result["haircut_sharpe"] == 0.0
        assert result["verdict"] == "haircut_eliminates_edge"

    def test_haircut_sharpe_never_negative(self):
        for n in [1, 10, 100, 10000]:
            result = compute_sharpe_haircut(observed_sharpe=0.3, n_trials=float(n))
            assert result["haircut_sharpe"] >= 0.0


# ── P-value derivation ladder ───────────────────────────────────────────────────

class TestDerivePvalueLadder:
    def test_prefers_pbo_overall_p_value(self):
        battery = {"pbo_overall_p_value": 0.03, "wf_metadata": {"dsr": 5.0}}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "pbo_overall_p_value"
        assert result.p_value == pytest.approx(0.03)

    def test_falls_back_to_dsr_derived(self):
        battery = {"pbo_overall_p_value": None, "wf_metadata": {"dsr": 0.0, "dsr_pass": False}}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "dsr_derived_from_test_statistic"
        # dsr=0.0 (at the mean) -> p = 1 - Phi(0) = 0.5
        assert result.p_value == pytest.approx(0.5, abs=1e-6)

    def test_dsr_positive_test_stat_gives_small_p(self):
        battery = {"wf_metadata": {"dsr": 3.0}}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "dsr_derived_from_test_statistic"
        assert result.p_value < 0.01  # z=3 -> p ~ 0.0013

    def test_missing_both_returns_none(self):
        battery = {}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "missing"
        assert result.p_value is None

    def test_dsr_unavailable_flag_skips_dsr_source(self):
        battery = {"wf_metadata": {"dsr": 3.0, "dsr_unavailable": True}}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "missing"
        assert result.p_value is None

    def test_out_of_range_pbo_p_value_falls_through(self):
        """A corrupt pbo_overall_p_value (e.g. 1.5) must not be trusted; falls to DSR."""
        battery = {"pbo_overall_p_value": 1.5, "wf_metadata": {"dsr": 2.0}}
        result = derive_pvalue_for_strategy(battery)
        assert result.source == "dsr_derived_from_test_statistic"


# ── Family grouping ─────────────────────────────────────────────────────────────

class TestFamilyGrouping:
    def _make_records(self):
        return [
            {"strategy_id": "s1", "educator_id": "edu_a", "p_value": 0.001},
            {"strategy_id": "s2", "educator_id": "edu_a", "p_value": 0.02},
            {"strategy_id": "s3", "educator_id": "edu_b", "p_value": 0.9},
            {"strategy_id": "s4", "educator_id": "edu_b", "p_value": 0.8},
            {"strategy_id": "s5", "educator_id": None, "p_value": None},  # excluded
        ]

    def test_corpus_wide_excludes_missing_pvalue(self):
        records = self._make_records()
        result = compute_family_grouped_fdr(records, q=0.05)
        assert result["corpus_wide"]["n"] == 4
        assert result["corpus_wide_n_excluded_missing_pvalue"] == 1

    def test_per_family_counts(self):
        records = self._make_records()
        result = compute_family_grouped_fdr(records, q=0.05)
        assert result["per_family"]["edu_a"]["n_strategies"] == 2
        assert result["per_family"]["edu_a"]["n_with_pvalue"] == 2
        assert result["per_family"]["edu_b"]["n_strategies"] == 2
        assert result["per_family"]["__none__"]["n_strategies"] == 1
        assert result["per_family"]["__none__"]["n_with_pvalue"] == 0
        assert result["per_family"]["__none__"]["n_excluded_missing_pvalue"] == 1

    def test_educator_with_all_small_pvalues_rejected_within_family(self):
        records = self._make_records()
        result = compute_family_grouped_fdr(records, q=0.05)
        edu_a_bh = result["per_family"]["edu_a"]["bh"]
        assert edu_a_bh["num_rejected"] >= 1

    def test_educator_with_all_large_pvalues_none_rejected(self):
        records = self._make_records()
        result = compute_family_grouped_fdr(records, q=0.05)
        edu_b_bh = result["per_family"]["edu_b"]["bh"]
        assert edu_b_bh["num_rejected"] == 0


# ── E[FD] with noise-floor-absent loud path + Wilson CI propagation ────────────

class TestExpectedFalseDiscoveries:
    def test_noise_floor_not_measured_when_report_is_none(self):
        result = expected_false_discoveries(corpus_size=200, calibration_report=None)
        assert result["measured"] is False
        assert result["expected_false_discoveries"] is None
        assert "NOISE FLOOR NOT YET MEASURED" in result["message"]

    def test_noise_floor_not_measured_when_zero_trials(self):
        report = {"full_battery": {"passes": 0, "trials": 0, "rate": 0.0}}
        result = expected_false_discoveries(corpus_size=200, calibration_report=report)
        assert result["measured"] is False
        assert result["expected_false_discoveries"] is None

    def test_measured_computes_expected_fd(self):
        report = {
            "full_battery": {
                "passes": 5, "trials": 100, "rate": 0.05,
                "ci_95_lower": 0.016, "ci_95_upper": 0.113,
            },
            "n_complete": 100,
            "gate_battery_version": "2026-07-02",
        }
        result = expected_false_discoveries(corpus_size=200, calibration_report=report)
        assert result["measured"] is True
        assert result["expected_false_discoveries"] == pytest.approx(10.0)  # 0.05 * 200
        assert result["expected_false_discoveries_upper"] == pytest.approx(22.6)  # 0.113 * 200
        assert result["gate_battery_version"] == "2026-07-02"

    def test_ci_upper_scales_with_corpus_size(self):
        report = {"full_battery": {"passes": 5, "trials": 100, "rate": 0.05, "ci_95_upper": 0.10}}
        r100 = expected_false_discoveries(100, report)
        r400 = expected_false_discoveries(400, report)
        assert r400["expected_false_discoveries_upper"] == pytest.approx(
            r100["expected_false_discoveries_upper"] * 4, rel=1e-6
        )


# ── Determinism ─────────────────────────────────────────────────────────────────

class TestDeterminism:
    def test_bh_deterministic_across_repeated_calls(self):
        p = [0.01, 0.5, 0.001, 0.2, 0.03, 0.11]
        r1 = benjamini_hochberg(p, q=0.05)
        r2 = benjamini_hochberg(p, q=0.05)
        assert r1.reject_mask == r2.reject_mask
        assert r1.adjusted_p_values == r2.adjusted_p_values

    def test_haircut_deterministic_across_repeated_calls(self):
        r1 = compute_sharpe_haircut(1.3, 42.0)
        r2 = compute_sharpe_haircut(1.3, 42.0)
        assert r1 == r2

    def test_probit_bisection_deterministic(self):
        """Internal probit() bisection must not drift between calls (replay safety)."""
        from src.engine.statistics.corpus_fdr import _probit
        vals1 = [_probit(p) for p in [0.01, 0.25, 0.5, 0.75, 0.99]]
        vals2 = [_probit(p) for p in [0.01, 0.25, 0.5, 0.75, 0.99]]
        assert vals1 == vals2

    def test_probit_matches_known_z_scores(self):
        """Sanity-check probit() against well-known critical values."""
        from src.engine.statistics.corpus_fdr import _probit
        assert _probit(0.975) == pytest.approx(1.959964, abs=1e-3)
        assert _probit(0.5) == pytest.approx(0.0, abs=1e-9)
        assert _probit(0.025) == pytest.approx(-1.959964, abs=1e-3)


# ── build_corpus_report end-to-end ──────────────────────────────────────────────

class TestBuildCorpusReport:
    def _fixture_records(self):
        return [
            {
                "strategy_id": "strong_edge",
                "educator_id": "edu_a",
                "gate_verdict": "passed_all_gates",
                "battery_output": {"pbo_overall_p_value": 0.001},
                "observed_sharpe": 1.8,
                "mrp_regime_breakdown": {"RISK_ON": 1.5, "RISK_OFF": 0.9},
            },
            {
                "strategy_id": "marginal_pass",
                "educator_id": "edu_a",
                "gate_verdict": "passed_all_gates",
                "battery_output": {"pbo_overall_p_value": 0.45},
                "observed_sharpe": 0.9,
                "mrp_regime_breakdown": None,
            },
            {
                "strategy_id": "failed_strategy",
                "educator_id": "edu_b",
                "gate_verdict": "failed",
                "battery_output": {"pbo_overall_p_value": 0.6},
                "observed_sharpe": 0.2,
                "mrp_regime_breakdown": None,
            },
            {
                "strategy_id": "no_evidence",
                "educator_id": "edu_b",
                "gate_verdict": "passed_all_gates",
                "battery_output": {},
                "observed_sharpe": None,
                "mrp_regime_breakdown": None,
            },
        ]

    def test_corpus_size_and_missing_pvalue_count(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        assert report["corpus_size"] == 4
        assert report["n_missing_pvalue"] == 1
        assert report["n_with_pvalue"] == 3

    def test_strong_edge_is_passed_not_noise_floor(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        row = next(r for r in report["per_strategy"] if r["strategy_id"] == "strong_edge")
        assert row["p_value_source"] == "pbo_overall_p_value"
        assert row["corpus_verdict"] == "passed"

    def test_failed_strategy_is_failed_regardless_of_pvalue(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        row = next(r for r in report["per_strategy"] if r["strategy_id"] == "failed_strategy")
        assert row["corpus_verdict"] == "failed"

    def test_no_evidence_strategy_excluded_from_bh_but_still_reported(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        row = next(r for r in report["per_strategy"] if r["strategy_id"] == "no_evidence")
        assert row["p_value"] is None
        assert row["p_value_source"] == "missing"
        assert row["bh_significant_at_q_promotion"] is None

    def test_headline_flags_noise_floor_when_unmeasured(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        assert "NOISE FLOOR NOT YET MEASURED" in report["headline"]
        assert report["excess_over_chance"] is None

    def test_headline_computes_excess_when_measured(self):
        calib = {"full_battery": {"passes": 1, "trials": 20, "rate": 0.05, "ci_95_upper": 0.20}}
        report = build_corpus_report(self._fixture_records(), calibration_report=calib)
        assert "expected by chance" in report["headline"]
        assert report["excess_over_chance"] is not None

    def test_regime_breakdown_gap_always_present(self):
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        row = next(r for r in report["per_strategy"] if r["strategy_id"] == "strong_edge")
        assert row["regime_breakdown"]["macro_regime_breakdown"] == {"RISK_ON": 1.5, "RISK_OFF": 0.9}
        assert row["regime_breakdown"]["institutional_5class_breakdown"] is None
        assert "institutional_5class_gap" in row["regime_breakdown"]

    def test_report_is_json_serializable(self):
        import json
        report = build_corpus_report(self._fixture_records(), calibration_report=None)
        # Should not raise — everything must be plain dict/list/str/float/bool/None.
        json.dumps(report)
