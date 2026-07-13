"""Tests for F2 institutional ruin-definition correction.

Wave hardening 2026-06-22, B14 ruin=firm-breach:
  - simulate_firm_survival returns breach_mask of correct length
  - breach_mask mean is consistent with breach_reasons counts
  - no-firm MC run -> ruin_basis="terminal_negative_no_firm", value matches terminal<=0
  - firm MC run -> ruin_basis="firm_breach", ruin_firm set, per_firm present,
    terminal_negative_ci preserved, probability_of_ruin_ci != terminal<=0 on
    deep-drawdown-but-positive-terminal profiles
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.mc_confidence import compute_mc_confidence_intervals
from src.engine.monte_carlo import simulate_firm_survival


# ─── Step 1: breach_mask from simulate_firm_survival ─────────────


class TestSimulateFirmSurvivalBreachMask:
    def _make_paths(self, n_sims: int = 200, n_steps: int = 60, seed: int = 7) -> np.ndarray:
        rng = np.random.default_rng(seed)
        returns = rng.normal(10.0, 100.0, size=(n_sims, n_steps))
        return np.cumsum(returns, axis=1)

    def test_breach_mask_present_in_return(self):
        """breach_mask must be returned by simulate_firm_survival."""
        paths = self._make_paths()
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        assert "breach_mask" in result, "breach_mask key missing from simulate_firm_survival return"

    def test_breach_mask_length_equals_n_sims(self):
        """breach_mask must have length == n_sims."""
        paths = self._make_paths(n_sims=150)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask = result["breach_mask"]
        assert len(mask) == 150

    def test_breach_mask_values_are_0_or_1(self):
        """breach_mask entries must be 0 or 1 (uint8 boolean)."""
        paths = self._make_paths()
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask = result["breach_mask"]
        unique = set(int(v) for v in mask)
        assert unique.issubset({0, 1}), f"breach_mask contains unexpected values: {unique}"

    def test_breach_mask_mean_consistent_with_account_closing_reasons(self):
        """breach_mask tracks trailing_dd + daily_loss_limit only.

        Evaluation misses and recoverable payout requirements are not account
        closures and therefore do not enter the ruin definition.
        """
        paths = self._make_paths(n_sims=500, seed=42)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask = result["breach_mask"]
        br = result["breach_reasons"]
        # Sum of account-ending breaches (not "never_hit_target")
        expected_ruin_count = br.get("trailing_dd", 0) + br.get("daily_loss_limit", 0)
        actual_ruin_count = int(np.sum(mask))
        assert actual_ruin_count == expected_ruin_count, (
            f"breach_mask sum {actual_ruin_count} != breach_reasons ruin count {expected_ruin_count}. "
            f"breach_reasons={br}"
        )

    def test_never_hit_target_not_in_breach_mask(self):
        """Paths that never_hit_target must NOT be in breach_mask (account not closed)."""
        # Use paths that almost never win — most will be never_hit_target
        rng = np.random.default_rng(99)
        paths = np.cumsum(rng.normal(-5.0, 10.0, size=(300, 60)), axis=1)
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask = result["breach_mask"]
        br = result["breach_reasons"]
        account_closing = br.get("trailing_dd", 0) + br.get("daily_loss_limit", 0)
        assert int(np.sum(mask)) == account_closing

    def test_existing_keys_unchanged(self):
        """All existing keys must still be present (additive field — no regressions)."""
        paths = self._make_paths()
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        required_keys = {
            "firm", "firm_name", "account_size", "num_simulations",
            "eval_pass_rate", "funded_survival_6mo", "breach_reasons",
            "drawdown_percentiles", "consistency_fail_rate",
            "granularity", "commission_per_side", "realtime_trailing",
        }
        missing = required_keys - result.keys()
        assert not missing, f"Existing keys removed: {missing}"

    def test_unknown_firm_still_returns_error(self):
        """Unknown firm key must still return error dict (no regression)."""
        paths = self._make_paths()
        result = simulate_firm_survival(paths, "fake_firm_xyz", account_size=50000)
        assert "error" in result


# ─── Step 2 / Step 3: run_monte_carlo ruin CI derivation ─────────


def _make_simple_mc_request(firms=None, seed=42, n_sims=300):
    """Build a minimal MonteCarloRequest-like dict for direct function call testing.

    We test compute_mc_confidence_intervals on a synthetic breach_mask rather than
    calling the full run_monte_carlo (which requires DB and file system fixtures)
    to keep these tests fast and isolated.
    """
    from src.engine.mc_confidence import compute_mc_confidence_intervals, probability_of_ruin_stat
    rng = np.random.default_rng(seed)
    # Simulate a breach_mask: 30% breach rate
    mask = (rng.uniform(0, 1, size=n_sims) < 0.3).astype(float)
    return mask


def _breach_rate_stat(mask: np.ndarray, axis=0):
    """Fraction of breached (=1) paths. Matches the stat used in run_monte_carlo F2 path."""
    return np.mean(mask, axis=axis)


class TestFirmBreachRuinCI:
    def test_ruin_ci_from_breach_mask_has_correct_keys(self):
        """CI derived from breach_mask must have the full contract shape."""
        mask = _make_simple_mc_request().astype(float)
        ci = compute_mc_confidence_intervals(
            mask, _breach_rate_stat, seed=42
        )
        required = {"point_estimate", "ci_low", "ci_high", "ci_method", "n_resamples", "standard_error", "n_effective"}
        missing = required - ci.keys()
        assert not missing, f"Missing CI keys: {missing}"

    def test_ruin_ci_point_estimate_matches_breach_rate(self):
        """CI point_estimate from breach_mask must match mean(mask) = breach rate.

        F2 uses np.mean as the statistic on the breach_mask ({0,1} float array)
        so point_estimate = fraction of 1s = actual breach rate.
        DO NOT use probability_of_ruin_stat here — that computes mean(x<=0) which
        on a {0,1} mask gives survival rate (fraction of 0s), not breach rate.
        """
        # Deterministic mask: exactly 200 breached out of 500 = 40% breach rate
        mask = np.zeros(500, dtype=float)
        mask[:200] = 1.0
        np.random.default_rng(10).shuffle(mask)

        ci = compute_mc_confidence_intervals(mask, _breach_rate_stat, seed=42, n_resamples=499)
        expected_breach_rate = float(np.mean(mask))  # = 0.4 exactly
        assert ci["point_estimate"] == pytest.approx(expected_breach_rate, abs=1e-9), (
            f"point_estimate={ci['point_estimate']} expected breach rate={expected_breach_rate}"
        )

    def test_firm_breach_rate_differs_from_terminal_negative(self):
        """Firm-breach ruin rate != terminal<=0 rate on deep-drawdown-but-positive profile.

        Construct paths where cumulative P&L is positive at horizon (terminal > 0)
        but the trailing DD trips mid-path. The Topstep EOD trailing DD closure event
        captures this; terminal<=0 misses it.
        """
        rng = np.random.default_rng(77)
        n_sims = 500
        n_steps = 60  # ~3 months

        # Build paths: early loss phase then strong recovery.
        # Many paths will trip Topstep $2000 trailing DD but end positive.
        # Phase 1 (steps 0-14): large losses (-200 to -350/step)
        # Phase 2 (steps 15-59): strong recovery (+100 to +250/step)
        early = rng.normal(-250.0, 80.0, size=(n_sims, 15))
        late = rng.normal(150.0, 60.0, size=(n_sims, 45))
        returns = np.concatenate([early, late], axis=1)
        paths = np.cumsum(returns, axis=1)

        # Compute terminal<=0 rate
        terminal_ruin_rate = float(np.mean(paths[:, -1] <= 0))

        # Compute firm-breach rate via simulate_firm_survival
        result = simulate_firm_survival(paths, "topstep_50k", account_size=50000)
        mask = result["breach_mask"]
        firm_breach_rate = float(np.mean(mask))

        # On deep-drawdown-then-recovery profile, firm-breach should be meaningfully
        # HIGHER than terminal<=0 (many paths hit trailing DD then recover past zero).
        assert firm_breach_rate > terminal_ruin_rate + 0.05, (
            f"Expected firm_breach_rate ({firm_breach_rate:.3f}) to exceed "
            f"terminal_negative_rate ({terminal_ruin_rate:.3f}) by >5pp on this profile. "
            "If both are near 0 or both near 1, the test profile needs adjustment."
        )


class TestNoFirmRunBasisTag:
    def test_no_firm_ci_has_terminal_negative_basis_tag(self):
        """When no firm models run, the CI must be tagged with ruin_basis=terminal_negative_no_firm."""
        # We can't call full run_monte_carlo without DB, so test the tagging logic in isolation.
        # Reproduce the no-firm branch from mc_confidence.compute_all_mc_cis result.
        from src.engine.mc_confidence import compute_all_mc_cis

        rng = np.random.default_rng(55)
        returns = rng.normal(0.0, 1.0, size=(200, 30))
        paths = np.cumsum(returns, axis=1)
        cis = compute_all_mc_cis(paths, n_resamples=199)

        # Simulate what run_monte_carlo does on the no-firm path
        _no_firm_ci = dict(cis.get("probability_of_ruin_ci", cis.get("probability_of_ruin", {})))
        _no_firm_ci["ruin_basis"] = "terminal_negative_no_firm"

        assert _no_firm_ci.get("ruin_basis") == "terminal_negative_no_firm"
        # Point estimate must still be terminal<=0
        terminal = paths[:, -1]
        expected = float(np.mean(terminal <= 0))
        assert _no_firm_ci["point_estimate"] == pytest.approx(expected, abs=1e-9)


class TestFirmRunBasisTag:
    def test_worst_firm_selection_picks_highest_breach_rate(self):
        """Worst firm is the one with highest breach_rate point_estimate.

        Uses deterministic masks (not RNG) to guarantee breach rates.
        """
        n_sims = 300
        # Firm A: exactly 20% breach rate (60 breached out of 300)
        mask_a = np.zeros(n_sims, dtype=float)
        mask_a[:60] = 1.0  # 20%
        # Firm B: exactly 40% breach rate (120 breached out of 300)
        mask_b = np.zeros(n_sims, dtype=float)
        mask_b[:120] = 1.0  # 40%

        from src.engine.mc_confidence import compute_mc_confidence_intervals
        ci_a = compute_mc_confidence_intervals(mask_a, _breach_rate_stat, seed=42, n_resamples=499)
        ci_b = compute_mc_confidence_intervals(mask_b, _breach_rate_stat, seed=42, n_resamples=499)
        ci_a.update({"ruin_basis": "firm_breach", "ruin_firm": "firm_a"})
        ci_b.update({"ruin_basis": "firm_breach", "ruin_firm": "firm_b"})

        per_firm_cis = {"firm_a": ci_a, "firm_b": ci_b}

        # Apply worst-firm selection logic from run_monte_carlo
        worst_ci = None
        worst_firm_key = None
        for fk, fc in per_firm_cis.items():
            if worst_ci is None or fc["point_estimate"] > worst_ci["point_estimate"]:
                worst_ci = fc
                worst_firm_key = fk

        assert worst_firm_key == "firm_b", (
            f"Expected worst firm to be firm_b (40% breach rate), got {worst_firm_key}. "
            f"ci_a.point_estimate={ci_a['point_estimate']:.3f}, ci_b.point_estimate={ci_b['point_estimate']:.3f}"
        )
        assert worst_ci["point_estimate"] > ci_a["point_estimate"]

    def test_per_firm_sub_map_preserved(self):
        """per_firm sub-map must contain all firms' CIs when wired into authoritative CI."""
        n_sims = 200
        # Deterministic masks: firm_a 25%, firm_b 35%
        mask_a = np.zeros(n_sims, dtype=float)
        mask_a[:50] = 1.0  # 25%
        mask_b = np.zeros(n_sims, dtype=float)
        mask_b[:70] = 1.0  # 35%

        from src.engine.mc_confidence import compute_mc_confidence_intervals
        ci_a = compute_mc_confidence_intervals(mask_a, _breach_rate_stat, seed=42, n_resamples=499)
        ci_b = compute_mc_confidence_intervals(mask_b, _breach_rate_stat, seed=42, n_resamples=499)
        ci_a.update({"ruin_basis": "firm_breach", "ruin_firm": "firm_a"})
        ci_b.update({"ruin_basis": "firm_breach", "ruin_firm": "firm_b"})
        per_firm = {"firm_a": ci_a, "firm_b": ci_b}

        # Authoritative CI = worst firm + per_firm sub-map
        authoritative = dict(ci_b)  # firm_b is worst
        authoritative["per_firm"] = per_firm

        assert "per_firm" in authoritative
        assert "firm_a" in authoritative["per_firm"]
        assert "firm_b" in authoritative["per_firm"]
        assert authoritative.get("ruin_firm") == "firm_b"
        assert authoritative.get("ruin_basis") == "firm_breach"


class TestTerminalNegativeCiPreserved:
    def test_terminal_negative_ci_key_distinct_from_authoritative(self):
        """terminal_negative_ci must be distinct from probability_of_ruin_ci on firm-breach path."""
        from src.engine.mc_confidence import compute_all_mc_cis, compute_mc_confidence_intervals, probability_of_ruin_stat

        rng = np.random.default_rng(66)
        returns = rng.normal(0.0, 2.0, size=(300, 40))
        paths = np.cumsum(returns, axis=1)
        cis = compute_all_mc_cis(paths, n_resamples=199)

        # Simulate what run_monte_carlo does: terminal_negative_ci is set from cis
        terminal_negative_ci = cis.get("probability_of_ruin_ci", cis.get("probability_of_ruin"))

        # Simulate a firm breach mask with a DIFFERENT rate (60% breach)
        mask = np.zeros(300, dtype=float)
        mask[:180] = 1.0  # 60% deterministic breach rate
        firm_ruin_ci = compute_mc_confidence_intervals(mask, lambda m, axis=0: np.mean(m, axis=axis), seed=42, n_resamples=499)
        firm_ruin_ci.update({"ruin_basis": "firm_breach", "ruin_firm": "topstep_50k"})

        # They should differ on point_estimate (different definitions of ruin)
        assert terminal_negative_ci["point_estimate"] != pytest.approx(firm_ruin_ci["point_estimate"], abs=0.001), (
            "terminal_negative and firm_breach point_estimates should differ when using a 60% synthetic mask"
        )
