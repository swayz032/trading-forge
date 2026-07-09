"""Deep-scan #22 Track X5 — failure-injection sweep, Control #6 (MC ruin-CI
wiring: `probability_of_ruin_ci.ci_high` must reach `result["risk_metrics"]`,
not just `result["bca_confidence_intervals"]`).

Background (CLAUDE.md, MC institutional-grade hardening 2026-06-22): "B14 reads
risk_metrics.probability_of_ruin_ci.ci_high (the key the Python side now
actually populates — it previously only wrote bca_confidence_intervals, a
second silent disconnect)." The TS-side b14-ci-gate.ts fail-closed contract on
non-finite ci_high is already covered by vitest
(wave27-5-pass-b-b14-ci-gate.test.ts / b14-hardening-2026-06-22.test.ts). This
module covers the PYTHON half: does `run_monte_carlo()` actually populate
`result["risk_metrics"]["probability_of_ruin_ci"]["ci_high"]` end-to-end (not
mocked at the `compute_mc_confidence_intervals` unit level), and does a
non-finite ci_high from the CI computation propagate through unsanitized
(fail-closed posture requires the raw signal to reach the gate, not be
silently coerced to a passing value)?

Covers:
  1. Clean path: real `run_monte_carlo()` with a firm configured populates
     `result["risk_metrics"]["probability_of_ruin_ci"]["ci_high"]` as a finite
     float.
  2. Fault injection: a "B14 reader" helper (mirrors b14-ci-gate.ts's read
     path: `risk_metrics.probability_of_ruin_ci.ci_high`) is run against (a)
     the real result dict — succeeds — and (b) an old-bug-shaped copy with
     `risk_metrics["probability_of_ruin_ci"]` deleted (the pre-fix world where
     the CI only ever landed in `bca_confidence_intervals`) — the reader comes
     back None/undefined, proving the wiring (not just the CI math) is what
     the gate depends on.
  3. Non-finite ci_high propagates unsanitized: monkeypatch
     `compute_mc_confidence_intervals` to return `ci_high=nan` and confirm the
     final `result["risk_metrics"]["probability_of_ruin_ci"]["ci_high"]` is
     still non-finite (not silently clamped to a finite passing value) — the
     fail-closed contract requires the raw non-finite signal to survive to the
     gate boundary.
"""

from __future__ import annotations

import math

import numpy as np

from src.engine.config import MonteCarloRequest
from src.engine.monte_carlo import run_monte_carlo


def _make_trades(n: int = 80, mean: float = 60.0, std: float = 150.0, seed: int = 7) -> list[float]:
    rng = np.random.default_rng(seed)
    return rng.normal(mean, std, size=n).tolist()


def _make_daily_pnls(n: int = 150, mean: float = 150.0, std: float = 300.0, seed: int = 7) -> list[float]:
    rng = np.random.default_rng(seed)
    return rng.normal(mean, std, size=n).tolist()


def _run_with_firm(n_sims: int = 300) -> dict:
    trades = _make_trades()
    daily = _make_daily_pnls()
    request = MonteCarloRequest(
        backtest_id="ds22-x5-mc-ruin-ci",
        num_simulations=n_sims,
        method="trade_resample",
        use_gpu=False,
        firms=["topstep_50k"],
        seed=42,
    )
    return run_monte_carlo(request, trades, daily, equity_curve=[])


def _b14_read_ci_high(result: dict):
    """Mirrors b14-ci-gate.ts's read path exactly: risk_metrics ->
    probability_of_ruin_ci -> ci_high. Returns None if any hop is missing —
    this is the exact "undefined" failure mode the old bug produced."""
    return (
        result.get("risk_metrics", {})
        .get("probability_of_ruin_ci", {})
        .get("ci_high")
    )


class TestCiHighReachesTopLevelRiskMetrics:
    def test_probability_of_ruin_ci_populated_with_firm(self):
        result = _run_with_firm()
        assert "risk_metrics" in result, "run_monte_carlo() must emit a risk_metrics dict"
        assert "probability_of_ruin_ci" in result["risk_metrics"], (
            "probability_of_ruin_ci missing from result['risk_metrics'] — B14 "
            "gate reads this exact path and would silently grandfather-pass."
        )
        ci = result["risk_metrics"]["probability_of_ruin_ci"]
        ci_high = ci.get("ci_high")
        assert ci_high is not None, "ci_high must be populated when a firm is configured"
        assert math.isfinite(ci_high), f"ci_high must be finite for a normal MC run, got {ci_high}"
        assert ci.get("ruin_basis") == "firm_breach", (
            f"With firms=['topstep_50k'] configured, ruin_basis must be 'firm_breach', "
            f"got {ci.get('ruin_basis')!r}"
        )

    def test_bca_confidence_intervals_also_carries_the_same_key(self):
        """Additive contract: bca_confidence_intervals must ALSO carry
        probability_of_ruin_ci (existing diagnostic consumers), but this is
        NOT a substitute for the risk_metrics copy — see the fault-injection
        test below for why."""
        result = _run_with_firm()
        assert "probability_of_ruin_ci" in result.get("bca_confidence_intervals", {})


class TestFaultInjectionOldBugShapeFailsTheB14Read:
    """RED-proof: reconstruct the pre-fix result shape (CI present ONLY under
    bca_confidence_intervals) and show the B14 read path returns None on it,
    while the CURRENT wiring returns a real value on the real result."""

    def test_real_result_b14_read_succeeds(self):
        result = _run_with_firm()
        ci_high = _b14_read_ci_high(result)
        assert ci_high is not None
        assert math.isfinite(ci_high)

    def test_old_bug_shaped_copy_b14_read_returns_none(self):
        result = _run_with_firm()
        # Reconstruct the OLD (pre-2026-06-22) bug: the CI existed ONLY inside
        # bca_confidence_intervals, never copied into the top-level
        # risk_metrics dict the B14 gate actually reads.
        faulty_result = dict(result)
        faulty_result["risk_metrics"] = dict(result["risk_metrics"])
        faulty_result["risk_metrics"].pop("probability_of_ruin_ci", None)
        # bca_confidence_intervals keeps its copy — this is exactly what made
        # the old bug invisible in ad-hoc inspection: "the data is right
        # there" (under the wrong key).
        assert "probability_of_ruin_ci" in faulty_result.get("bca_confidence_intervals", {})

        ci_high = _b14_read_ci_high(faulty_result)
        assert ci_high is None, (
            "FAULT-INJECTION DID NOT REPRODUCE THE BUG: the old-bug-shaped "
            "result (risk_metrics.probability_of_ruin_ci removed) must make "
            "the B14 read path return None (undefined) — if it still resolves "
            "to a value here, the fixture failed to simulate the disconnect "
            "the original bug caused."
        )


class TestNonFiniteCiHighPropagatesUnsanitized:
    """Fail-closed contract: a non-finite ci_high from the CI computation must
    survive to result['risk_metrics']['probability_of_ruin_ci']['ci_high']
    unsanitized — the gate (TS side, already covered by vitest) is what turns
    non-finite into a hard block; the Python layer must not quietly clean it
    up into a finite, passing value first."""

    def test_nan_ci_high_from_ci_computation_reaches_result_unsanitized(self, monkeypatch):
        import src.engine.mc_confidence as mc_conf_mod

        _real_fn = mc_conf_mod.compute_mc_confidence_intervals

        def _fault_ci(data, statistic_fn, confidence_level=0.95, method="BCa", n_resamples=9999, seed=42):
            result = _real_fn(
                data, statistic_fn, confidence_level=confidence_level,
                method=method, n_resamples=n_resamples, seed=seed,
            )
            result["ci_high"] = float("nan")
            return result

        monkeypatch.setattr(mc_conf_mod, "compute_mc_confidence_intervals", _fault_ci)

        result = _run_with_firm()
        ci = result["risk_metrics"].get("probability_of_ruin_ci", {})
        ci_high = ci.get("ci_high")
        assert ci_high is not None, "ci_high key must still be present (not silently dropped)"
        assert not math.isfinite(ci_high), (
            f"FAIL-CLOSED CONTRACT VIOLATED: a non-finite ci_high from the CI "
            f"computation must propagate through to result['risk_metrics']"
            f"['probability_of_ruin_ci']['ci_high'] unsanitized — instead got "
            f"a finite value {ci_high}, which would silently PASS the B14 gate "
            f"instead of hard-blocking on 'b14.ruin_estimate_non_finite_fail_closed'."
        )
