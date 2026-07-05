"""Deep-Scan #18 A-C1 — DSR duplicate reconciliation parity tests.

cross_validation.py::deflated_sharpe_ratio() used to carry its own independent
re-derivation of the Bailey & Lopez de Prado DSR math, diverged from the
canonical risk_metrics.py::compute_deflated_sharpe_ratio() (which deepscan17
B-2/B-7 already corrected: Mertens (2002) kurtosis term (kurtosis-1)/4, and
proper Sharpe-scale benchmark subtraction). cross_validation.py's output is
what flows to backtester.py resultExtras.deflated_sharpe.dsr — consumed by
picker-metrics.ts (25% weight of the LIVE strategy-selection composite) and
the Office deploy-approvals card — while lifecycle-service.ts promotion gates
read risk_metrics.py's output directly. These tests pin the reconciliation:
cross_validation.deflated_sharpe_ratio() must now be mathematically derived
from risk_metrics.compute_deflated_sharpe_ratio(), converted to the [0,1] CDF
scale its downstream TS consumers contractually expect.
"""
from __future__ import annotations

import math

import pytest
from scipy import stats as scipy_stats

from src.engine.cross_validation import deflated_sharpe_ratio
from src.engine.risk_metrics import compute_deflated_sharpe_ratio


# ─── Contract: dsr is a [0,1] CDF value ───────────────────────────────────────

class TestCrossValidationDsrIsCdf:
    @pytest.mark.parametrize(
        "observed_sharpe,n_trials,n_observations",
        [
            (2.0, 15, 252),
            (1.5, 4, 100),
            (0.5, 30, 60),
            (-1.0, 10, 252),
            (3.0, 100, 500),
        ],
    )
    def test_dsr_in_unit_interval(self, observed_sharpe, n_trials, n_observations):
        result = deflated_sharpe_ratio(
            observed_sharpe=observed_sharpe,
            n_trials=n_trials,
            n_observations=n_observations,
        )
        assert 0.0 <= result["dsr"] <= 1.0, (
            f"deflated_sharpe_ratio()['dsr'] must be a [0,1] CDF probability "
            f"(picker-metrics.ts / deploy-approvals.ts contract) — got {result['dsr']}"
        )

    def test_significant_flag_matches_95th_percentile_of_cdf(self):
        # A very strong Sharpe with few trials should clear the 0.95 CDF bar.
        result = deflated_sharpe_ratio(observed_sharpe=4.0, n_trials=2, n_observations=252)
        assert result["dsr"] > 0.95
        assert result["significant"] is True


# ─── Parity: cross_validation delegates to the canonical risk_metrics math ────

class TestCrossValidationRiskMetricsParity:
    """cross_validation.dsr must equal norm.cdf(risk_metrics.dsr_z) for shared inputs."""

    @pytest.mark.parametrize(
        "observed_sharpe,n_trials,n_observations,skewness,kurtosis",
        [
            (2.0, 15, 252, 0.0, 3.0),
            (1.5, 4, 100, 0.0, 3.0),
            (0.8, 8, 180, -0.3, 4.5),
            (2.5, 30, 300, 0.2, 6.0),
            (-0.5, 5, 60, 0.0, 3.0),
        ],
    )
    def test_cross_validation_dsr_equals_cdf_of_canonical_z(
        self, observed_sharpe, n_trials, n_observations, skewness, kurtosis
    ):
        cv_result = deflated_sharpe_ratio(
            observed_sharpe=observed_sharpe,
            n_trials=n_trials,
            n_observations=n_observations,
            skewness=skewness,
            kurtosis=kurtosis,
        )
        canonical = compute_deflated_sharpe_ratio(
            observed_sharpe=observed_sharpe,
            n_trials=n_trials,
            n_observations=n_observations,
            skewness=skewness,
            kurtosis=kurtosis,
        )
        expected_cdf = float(scipy_stats.norm.cdf(canonical["dsr"]))
        assert cv_result["dsr"] == pytest.approx(round(expected_cdf, 4), abs=1e-4)
        # Diagnostic passthrough fields must also agree exactly.
        assert cv_result["dsr_z"] == pytest.approx(canonical["dsr"], abs=1e-9)
        assert cv_result["passes"] == canonical["passes"]
        assert cv_result["p_value"] == pytest.approx(canonical["p_value"], abs=1e-9)

    def test_no_longer_uses_stale_pre_reconciliation_formula(self):
        """Regression pin against the EXACT pre-fix cross_validation.py formula
        (the literal expression that lived at the old lines ~200-222): its
        `expected_max_sr = z_n * sqrt(1/n_observations)` used a simplified
        null-model SE approximation for the benchmark scale, instead of scaling
        by the full (skew/kurtosis-adjusted) Sharpe standard error the way
        risk_metrics.compute_deflated_sharpe_ratio() does
        (`sr_benchmark = sr_expected_max * sharpe_std`). At kurtosis=3 the two
        se_sr expressions are algebraically near-equivalent (the stale
        `1 + 0.5*SR^2 + (kurtosis-3)/4*SR^2` term reduces to the same
        `1 + (kurtosis-1)/4*SR^2` the fixed formula uses directly) — so the
        REAL numeric divergence this reconciliation closes is the
        expected-max-SR benchmark scaling (deepscan17 B-2), not the kurtosis
        term in isolation. Parameters below (sr=0.3, n_trials=50,
        n_observations=60) were chosen because they produce a >0.02 gap
        between the stale and fixed CDFs — comfortably outside rounding noise.
        """
        observed_sharpe = 0.3
        n_trials = 50
        n_observations = 60
        kurtosis = 3.0
        skewness = 0.0

        cv_result = deflated_sharpe_ratio(
            observed_sharpe=observed_sharpe,
            n_trials=n_trials,
            n_observations=n_observations,
            skewness=skewness,
            kurtosis=kurtosis,
        )

        gamma = 0.5772156649
        z_n = (1 - gamma) * scipy_stats.norm.ppf(1.0 - 1.0 / n_trials) + \
            gamma * scipy_stats.norm.ppf(1.0 - 1.0 / (n_trials * math.e))

        # STALE pre-reconciliation formula, replicated verbatim from the old
        # cross_validation.py source (expected_max_sr on a simplified
        # sqrt(1/n_observations) scale, subtracted directly from observed_sharpe).
        stale_expected_max_sr = z_n * math.sqrt(1.0 / n_observations)
        stale_se_sr = math.sqrt(
            (1 + 0.5 * observed_sharpe ** 2 - skewness * observed_sharpe +
             ((kurtosis - 3) / 4) * observed_sharpe ** 2) / n_observations
        )
        stale_dsr_value = float(
            scipy_stats.norm.cdf((observed_sharpe - stale_expected_max_sr) / stale_se_sr)
        )

        # FIXED/canonical formula (risk_metrics.compute_deflated_sharpe_ratio,
        # replicated here to avoid importing internals — the parity test above
        # already proves cv_result matches the real canonical function).
        fixed_sharpe_std = math.sqrt(
            (1 - skewness * observed_sharpe + ((kurtosis - 1) / 4) * observed_sharpe ** 2)
            / max(1, n_observations - 1)
        )
        fixed_dsr_z = (observed_sharpe - z_n * fixed_sharpe_std) / fixed_sharpe_std
        fixed_cdf = float(scipy_stats.norm.cdf(fixed_dsr_z))

        assert abs(stale_dsr_value - fixed_cdf) > 0.02, (
            "test fixture sanity check: stale and fixed formulas must diverge "
            "meaningfully at these parameters, or this regression test proves nothing"
        )
        assert cv_result["dsr"] == pytest.approx(round(fixed_cdf, 4), abs=1e-4), (
            "cross_validation.deflated_sharpe_ratio() should match the FIXED "
            "(risk_metrics-delegated) benchmark scaling"
        )
        assert cv_result["dsr"] != pytest.approx(round(stale_dsr_value, 4), abs=1e-4), (
            "cross_validation.deflated_sharpe_ratio() must NOT reproduce the "
            "stale expected_max_sr scaling any more"
        )


# ─── Untouched edge-case branches (not part of the reconciled bug) ───────────

class TestUnreconciledEdgeCasesUnchanged:
    def test_insufficient_data_branch(self):
        result = deflated_sharpe_ratio(observed_sharpe=1.0, n_trials=1, n_observations=5)
        assert result["dsr"] == 0.0
        assert result["detail"] == "insufficient data"

    def test_zero_trials_branch(self):
        result = deflated_sharpe_ratio(observed_sharpe=1.0, n_trials=0, n_observations=252)
        assert result["dsr"] == 0.0
        assert result["detail"] == "insufficient data"

    def test_single_trial_branch_unchanged(self):
        result = deflated_sharpe_ratio(observed_sharpe=1.5, n_trials=1, n_observations=252)
        expected = round(float(scipy_stats.norm.cdf(1.5 * math.sqrt(252))), 4)
        assert result["dsr"] == pytest.approx(expected, abs=1e-4)
        assert result["detail"] == "single trial — no multiple testing adjustment"


# ─── Determinism (replay equivalence) ────────────────────────────────────────

class TestDeterminism:
    def test_same_inputs_same_output(self):
        kwargs = dict(observed_sharpe=1.8, n_trials=12, n_observations=252,
                      skewness=-0.1, kurtosis=4.2)
        r1 = deflated_sharpe_ratio(**kwargs)
        r2 = deflated_sharpe_ratio(**kwargs)
        assert r1 == r2
