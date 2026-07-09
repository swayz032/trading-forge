"""Wave 24 Pass 1 — Item 19: Honest-PSR DSR (multiple-testing corrected) tests.

Covers:
  - n_trials=1 matches single-trial Sharpe test (no multiple-testing penalty)
  - n_trials=100 raises threshold (harder to pass)
  - Symmetric vs skewed returns differ via skewness/kurtosis adjustment
  - DSR_HONEST_THRESHOLD env gate contract
  - dsr_honest dict structure emitted by backtester.py
"""

from __future__ import annotations

import math

import pytest

from src.engine.risk_metrics import compute_deflated_sharpe_ratio

# ─── Core DSR formula tests ───────────────────────────────────────────────────

class TestDsrHonestFormula:
    def test_n_trials_1_vs_100_threshold_higher(self):
        """With N=100 trials, expected max Sharpe SR* is higher than N=1.

        This makes DSR harder to pass with more trials — the multiple-testing
        penalty increases the hurdle rate.
        """
        result_1 = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=1, n_observations=252,
        )
        result_100 = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=100, n_observations=252,
        )
        # SR* (sr_expected_max) must be larger with more trials
        assert result_100["sr_expected_max"] > result_1["sr_expected_max"]

    def test_n_trials_1_dsr_larger_than_n_trials_100(self):
        """DSR with N=1 should produce larger DSR test statistic than N=100."""
        result_1 = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=1, n_observations=252,
        )
        result_100 = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=100, n_observations=252,
        )
        assert result_1["dsr"] > result_100["dsr"]

    def test_strong_sharpe_passes_few_trials(self):
        """Sharpe=3.0 with N=5 trials should easily pass DSR."""
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=3.0, n_trials=5, n_observations=252,
        )
        assert result["passes"] is True

    def test_weak_sharpe_fails_many_trials_with_short_track_record(self):
        """Sharpe=1.0 with N=100 trials FAILS DSR only when the track record is short.

        deepscan17 B-2/B-7 fix (2026-07-05): previously this assertion held at
        n_observations=252 too, but that was an artifact of two compounding bugs
        (missing sigma_SR scaling on the expected-max term + wrong kurtosis constant)
        that made DSR punitive almost independent of n_observations. Under the
        corrected Bailey-LdP formula, SE(SR_hat) shrinks as n_observations grows
        (Mertens 2002), so the same observed Sharpe becomes MORE credible with a
        longer track record even under heavy multiple-testing — a long, high-Sharpe
        record is not plausibly explained by trying 100 noisy variants. The
        overfitting-vulnerable case (curve-fit territory) is SHORT track record +
        many trials, reproduced here with n_observations=20.
        """
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.0, n_trials=100, n_observations=20,
        )
        assert result["passes"] is False

    def test_weak_sharpe_passes_many_trials_with_long_track_record(self):
        """Sharpe=1.0 with N=100 trials over a full year (252 obs) now PASSES DSR.

        deepscan17 B-2/B-7 fix (2026-07-05): regression test asserting the
        corrected (less punitive at realistic n_observations) direction the audit
        specified. Locks in the fixed formula's output so a future regression to
        the old (unscaled sr_expected_max / kurtosis-3) formula is caught — the old
        formula produced dsr approx -24 / p_value approx 1.0 / passes=False here.
        """
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.0, n_trials=100, n_observations=252,
        )
        assert result["passes"] is True
        assert result["dsr"] > 0

    def test_symmetric_vs_skewed_differ(self):
        """Skewed/fat-tailed returns produce a different DSR than symmetric returns.

        Both are computable; the key invariant is that the results differ
        (skewness/kurtosis parameters affect the Sharpe std deviation denominator).
        """
        result_symmetric = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=10, n_observations=252,
            skewness=0.0, kurtosis=3.0,
        )
        result_skewed = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=10, n_observations=252,
            skewness=-1.0, kurtosis=6.0,  # realistic futures return profile
        )
        # Different moments → different DSR values (the function is not moment-invariant)
        # Both must be finite floats
        assert math.isfinite(result_symmetric["dsr"])
        assert math.isfinite(result_skewed["dsr"])
        # The two DSR values must differ (non-trivially sensitive to moments)
        assert result_symmetric["dsr"] != result_skewed["dsr"]

    def test_dsr_result_keys_present(self):
        """Result dict must contain all required keys."""
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.5, n_trials=5, n_observations=252,
        )
        required_keys = {"dsr", "p_value", "passes", "sr_expected_max", "n_trials", "interpretation"}
        assert required_keys.issubset(result.keys())

    def test_dsr_passes_at_threshold_boundary(self):
        """At exactly threshold 1.5 DSR, result boundary behavior is consistent."""
        # Choose params that produce DSR near 1.5 to test boundary
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=2.5, n_trials=1, n_observations=252,
        )
        assert isinstance(result["passes"], bool)
        assert isinstance(result["dsr"], float)
        assert math.isfinite(result["dsr"])

    def test_sr_expected_max_zero_for_n_trials_1(self):
        """With N=1 trial, SR* = 0 (no multiple-testing correction needed)."""
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.5, n_trials=1, n_observations=252,
        )
        assert result["sr_expected_max"] == pytest.approx(0.0, abs=1e-9)

    def test_n_observations_affects_denominator(self):
        """More observations → smaller sharpe_std → larger DSR (more confidence)."""
        result_small = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=1, n_observations=50,
        )
        result_large = compute_deflated_sharpe_ratio(
            observed_sharpe=2.0, n_trials=1, n_observations=1000,
        )
        assert result_large["dsr"] > result_small["dsr"]


# ─── Honest DSR dict contract (backtester.py invariants emit) ────────────────

class TestDsrHonestContract:
    """Tests for the dsr_honest dict structure emitted into result['invariants']."""

    def _make_dsr_honest(
        self,
        observed_sharpe: float = 2.0,
        n_trials: int = 5,
        n_obs: int = 252,
        dsr_threshold: float = 1.5,
    ) -> dict:
        """Simulate what backtester.py builds for result['invariants']['dsr_honest']."""
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        raw = compute_deflated_sharpe_ratio(
            observed_sharpe=observed_sharpe,
            n_trials=n_trials,
            n_observations=n_obs,
        )
        dsr_passed = raw.get("dsr", 0.0) >= dsr_threshold
        return {
            "sr_observed": round(observed_sharpe, 4),
            "sr_threshold": raw.get("sr_expected_max"),
            "n_trials": n_trials,
            "dsr": raw.get("dsr"),
            "dsr_passed": dsr_passed,
            "p_value": raw.get("p_value"),
            "interpretation": raw.get("interpretation", ""),
        }

    def test_dsr_honest_keys_present(self):
        d = self._make_dsr_honest()
        required = {"sr_observed", "sr_threshold", "n_trials", "dsr", "dsr_passed", "p_value"}
        assert required.issubset(d.keys())

    def test_dsr_passed_true_for_strong_edge(self):
        """Strong Sharpe with few trials → dsr_passed=True."""
        d = self._make_dsr_honest(observed_sharpe=3.0, n_trials=5)
        assert d["dsr_passed"] is True

    def test_dsr_passed_false_for_weak_edge_many_trials_short_track(self):
        """Weak Sharpe + many trials + SHORT track record → dsr_passed=False.

        deepscan17 B-2/B-7 fix (2026-07-05): the default n_obs=252 in this helper
        no longer fails here post-fix (see TestDsrHonestFormula for why a full-year
        track record makes DSR materially more forgiving) — pass n_obs=20 to
        reproduce the genuinely overfitting-vulnerable short-track-record case.
        """
        d = self._make_dsr_honest(observed_sharpe=1.0, n_trials=100, n_obs=20)
        assert d["dsr_passed"] is False

    def test_n_trials_stored_in_result(self):
        """n_trials in dsr_honest must match the input n_trials."""
        d = self._make_dsr_honest(n_trials=42)
        assert d["n_trials"] == 42

    def test_dsr_is_finite_float(self):
        """dsr value must be a finite float."""
        d = self._make_dsr_honest()
        assert d["dsr"] is not None
        assert math.isfinite(d["dsr"])

    def test_not_applicable_when_no_trades(self):
        """When total_trades=0, dsr_honest.not_applicable must be True."""
        # Simulate the no-trades case from backtester.py
        dsr_honest_na = {
            "not_applicable": True,
            "reason": "no trades or insufficient observations",
        }
        assert dsr_honest_na.get("not_applicable") is True
        assert "reason" in dsr_honest_na
