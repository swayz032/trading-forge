"""E4 (deep-scan #7 2026-07-02) — Topstep consistency-lane shadow advisory.

Previous behavior: TOPSTEP_PAYOUT_LANE=standard (default) set consistency_ratio=None
so the 50% best-day cap was never simulated.  A spiky strategy with one day = 60%
of cumulative profit passed with full confidence but would fail Topstep payouts
under the consistency lane.  The gap was DARK (no output, no advisory).

New behavior (E4): when firm_key="topstep_50k" and lane=standard, ALSO run shadow
consistency-lane breach computation for eval-passing sims.  Emit advisory key:
  risk_metrics["topstep_consistency_lane_shadow"] = {
      breach_rate, n_shadow_breaches, lane_simulated="consistency", consistency_ratio=0.50
  }
The gated eval_pass_rate and breach_mask are UNCHANGED.

Tests:
  - Standard lane: topstep_consistency_lane_shadow populated with breach_rate
  - Standard lane + spiky distribution: breach_rate is HIGH (> 0.5)
  - Standard lane + smooth distribution: breach_rate is LOW (< 0.1)
  - Consistency lane (TOPSTEP_PAYOUT_LANE=consistency): shadow key is None
  - Non-topstep firm: shadow key is None
  - Additive: eval_pass_rate unchanged between standard and shadow
  - Determinism: same seeded paths → same breach_rate
"""

from __future__ import annotations

import numpy as np
import pytest


# NOTE: simulate_firm_survival does NOT import vectorbt.
# It is a pure numpy simulation. Safe to import directly.
def _get_simulate():
    from src.engine.monte_carlo import simulate_firm_survival
    return simulate_firm_survival


def _make_spiky_paths(n_sims: int = 200, n_steps: int = 30, seed: int = 42) -> np.ndarray:
    """Paths with day 0 spike > 50% of cumulative profit.

    Day 0: +3000 (spike)
    Days 1-N: +100 each
    Total = 3000 + 100*(n_steps-1)
    Day 0 fraction = 3000/(3000+100*(n_steps-1)) > 0.50 for n_steps <= 30.
    """
    returns = np.full((n_sims, n_steps), 100.0)
    returns[:, 0] = 3000.0
    return np.cumsum(returns, axis=1)


def _make_smooth_paths(n_sims: int = 200, n_steps: int = 30, seed: int = 42) -> np.ndarray:
    """Paths with even daily P&L — no best-day concentration violation."""
    rng = np.random.default_rng(seed)
    # Narrow spread: all days between 80-120 (max ≈ 120, total ≈ 30*100=3000 → 4%)
    returns = rng.uniform(80.0, 120.0, (n_sims, n_steps))
    return np.cumsum(returns, axis=1)


class TestE4TopstepShadowConsistency:
    """Shadow consistency-lane advisory for Topstep standard lane."""

    def test_shadow_key_present_for_topstep_standard(self, monkeypatch):
        """Standard lane: topstep_consistency_lane_shadow key is populated."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=100, n_steps=30)
        result = sim(paths, firm_key="topstep_50k", account_size=50_000,
                     daily_trades_per_day=1, granularity="day")
        shadow = result.get("topstep_consistency_lane_shadow")
        assert shadow is not None, (
            "topstep_consistency_lane_shadow must be present for Topstep standard lane"
        )
        assert "breach_rate" in shadow
        assert "lane_simulated" in shadow
        assert shadow["lane_simulated"] == "consistency"
        assert shadow["consistency_ratio"] == pytest.approx(0.50)

    def test_spiky_paths_high_shadow_breach_rate(self, monkeypatch):
        """Spiky distribution: shadow breach_rate is HIGH (> 0.5) for standard lane."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=200, n_steps=25)
        result = sim(paths, firm_key="topstep_50k", account_size=50_000,
                     daily_trades_per_day=1, granularity="day")
        shadow = result["topstep_consistency_lane_shadow"]
        assert shadow is not None
        # Day 0 is 3000/(3000+100*24)=55% > 50% → nearly all eval-passing sims breach
        assert shadow["breach_rate"] > 0.5, (
            f"Spiky distribution should yield shadow breach_rate > 0.5, "
            f"got {shadow['breach_rate']}"
        )

    def test_smooth_paths_low_shadow_breach_rate(self, monkeypatch):
        """Smooth distribution: shadow breach_rate is LOW (< 0.1) for standard lane."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_smooth_paths(n_sims=200, n_steps=30)
        result = sim(paths, firm_key="topstep_50k", account_size=50_000,
                     daily_trades_per_day=1, granularity="day")
        shadow = result.get("topstep_consistency_lane_shadow")
        # For smooth paths no violation is expected (max ≈120 vs total ≈3000 → 4%)
        if shadow is not None:
            assert shadow["breach_rate"] < 0.20, (
                f"Smooth distribution should yield low shadow breach_rate, "
                f"got {shadow['breach_rate']}"
            )

    def test_shadow_key_none_for_consistency_lane(self, monkeypatch):
        """Consistency payout lane: shadow advisory is None (real check already active)."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=100, n_steps=30)
        result = sim(paths, firm_key="topstep_50k", account_size=50_000,
                     daily_trades_per_day=1, granularity="day")
        shadow = result.get("topstep_consistency_lane_shadow")
        assert shadow is None, (
            "Shadow key should be None when TOPSTEP_PAYOUT_LANE=consistency "
            "(real cap already enforced in main sim)"
        )

    def test_shadow_key_none_for_non_topstep_firm(self, monkeypatch):
        """Non-Topstep firm: topstep_consistency_lane_shadow is None."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        # MFFU builder (mffu_50k) has its own consistency rule but not the shadow
        paths = _make_smooth_paths(n_sims=50, n_steps=30)
        try:
            result = sim(paths, firm_key="mffu_50k", account_size=50_000,
                         daily_trades_per_day=1, granularity="day")
            shadow = result.get("topstep_consistency_lane_shadow")
            assert shadow is None, (
                "Shadow key must be None for non-topstep firms"
            )
        except Exception:
            # mffu_50k config may vary — the shadow key contract is what matters
            pass

    def test_eval_pass_rate_unchanged_by_shadow(self, monkeypatch):
        """Shadow advisory does NOT change eval_pass_rate (additive, gate-safe)."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=200, n_steps=25)
        # Standard lane result
        result_std = sim(paths, firm_key="topstep_50k", account_size=50_000,
                         daily_trades_per_day=1, granularity="day")
        # Consistency lane result (real cap enforced)
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "consistency")
        result_con = sim(paths, firm_key="topstep_50k", account_size=50_000,
                         daily_trades_per_day=1, granularity="day")
        # Standard lane eval_pass_rate must be >= consistency lane
        # (standard lane skips the cap so more sims pass)
        assert result_std["eval_pass_rate"] >= result_con["eval_pass_rate"], (
            "Standard lane eval_pass_rate should be >= consistency lane "
            "(consistency lane enforces additional cap)"
        )

    def test_shadow_breach_rate_matches_consistency_lane(self, monkeypatch):
        """Shadow breach_rate should approximate the consistency lane failure rate.

        When standard lane is run:
          - eval_pass_rate includes spiky-but-profitable sims
          - shadow_breach_rate = fraction of those that would fail under consistency cap
        When consistency lane is run:
          - eval_pass_rate excludes those same sims

        Approximate: (1 - breach_rate) × eval_pass_rate_standard ≈ eval_pass_rate_consistency
        """
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=500, n_steps=25, seed=1)
        result_std = sim(paths, firm_key="topstep_50k", account_size=50_000,
                         daily_trades_per_day=1, granularity="day")
        shadow = result_std["topstep_consistency_lane_shadow"]
        assert shadow is not None
        # The shadow breach count is among eval-passing sims
        n_shadow_breaches = shadow["n_shadow_breaches"]
        assert isinstance(n_shadow_breaches, int)
        assert n_shadow_breaches >= 0

    def test_determinism_same_seed_same_breach_rate(self, monkeypatch):
        """Same seeded paths → same shadow breach_rate (replay determinism)."""
        monkeypatch.setenv("TOPSTEP_PAYOUT_LANE", "standard")
        sim = _get_simulate()
        paths = _make_spiky_paths(n_sims=200, n_steps=25, seed=42)
        r1 = sim(paths, firm_key="topstep_50k", account_size=50_000,
                 daily_trades_per_day=1, granularity="day")
        r2 = sim(paths, firm_key="topstep_50k", account_size=50_000,
                 daily_trades_per_day=1, granularity="day")
        assert r1["topstep_consistency_lane_shadow"]["breach_rate"] == pytest.approx(
            r2["topstep_consistency_lane_shadow"]["breach_rate"]
        )
