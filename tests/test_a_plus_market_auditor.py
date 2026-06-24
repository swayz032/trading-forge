"""Tests for A+ Market Auditor — Tier 3.3 (Gemini Quantum Blueprint, W3b).

Covers:
  1. compute_edge_score produces distinct results for distinct inputs
  2. run_market_audit produces distinct composite scores when inputs differ
  3. run_full_scan does NOT always return observation_mode=True (F-5 regression test)
  4. p_target_hit_override drives distinct scores across markets
  5. vol_score is data-driven (ATR ratio matters) — not identical across markets
  6. Governance labels preserved: authoritative=False, decision_role=challenger_only
  7. run_full_scan with distinct p_target_hit overrides yields distinct edge_scores

These tests verify the F-5 fix: run_market_audit previously defaulted p_target_hit=0.5
(neutral, always below P_TARGET_HIT_THRESHOLD=0.75) so every market always failed the gate
and observation_mode was always True, making the scan meaningless. The fix requires callers
to provide real per-market p_target_hit estimates, producing distinct results.
"""
from __future__ import annotations

import math
import sys
import os

import pytest

# Ensure the project root is on the path when running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.engine.a_plus_market_auditor import (
    AuditInput,
    AuditResult,
    GOVERNANCE_LABELS,
    P_TARGET_HIT_THRESHOLD,
    compute_edge_score,
    run_full_scan,
    run_market_audit,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_corr() -> dict:
    return {
        "MES": {"MES": 1.0, "MNQ": 0.82, "MCL": 0.15, "DXY": -0.30},
        "MNQ": {"MES": 0.82, "MNQ": 1.0, "MCL": 0.12, "DXY": -0.28},
        "MCL": {"MES": 0.15, "MNQ": 0.12, "MCL": 1.0, "DXY": 0.05},
        "DXY": {"MES": -0.30, "MNQ": -0.28, "MCL": 0.05, "DXY": 1.0},
    }


def _inp(
    market: str,
    atr_5m: float = 2.5,
    atr_8yr_avg: float = 2.5,
    p_target_hit_override: float | None = None,
    noise_score_override: float | None = None,
    vix: float = 18.0,
    seed: int = 42,
) -> AuditInput:
    return AuditInput(
        market=market,
        atr_5m=atr_5m,
        atr_8yr_avg=atr_8yr_avg,
        vix=vix,
        gap_atr=0.2,
        spread=0.05,
        p_target_hit_override=p_target_hit_override,
        noise_score_override=noise_score_override,
        seed=seed,
    )


# ---------------------------------------------------------------------------
# 1. compute_edge_score — distinct results for distinct inputs
# ---------------------------------------------------------------------------

class TestComputeEdgeScore:
    def test_high_p_target_high_vol_score_beats_low(self):
        """High p_target + low atr_ratio beats low p_target + high ratio."""
        good = compute_edge_score(
            atr_ratio=1.0,        # at historical average — best vol score
            p_target_hit=0.85,    # above 0.75 threshold
            noise_score=0.2,      # quiet
            entanglement_strength=0.7,
        )
        poor = compute_edge_score(
            atr_ratio=3.0,        # elevated vol — penalized
            p_target_hit=0.5,     # neutral
            noise_score=0.6,      # noisy
            entanglement_strength=0.3,
        )
        assert good > poor, f"good={good:.4f} should exceed poor={poor:.4f}"

    def test_distinct_p_target_hit_produces_distinct_composite(self):
        """Different p_target values must produce different edge scores."""
        s1 = compute_edge_score(1.0, 0.80, None, None)
        s2 = compute_edge_score(1.0, 0.60, None, None)
        s3 = compute_edge_score(1.0, 0.40, None, None)
        assert s1 > s2 > s3, f"scores not strictly ordered: {s1:.4f} {s2:.4f} {s3:.4f}"

    def test_distinct_atr_ratio_produces_distinct_vol_score(self):
        """ATR ratio drives distinct vol contributions."""
        low_atr = compute_edge_score(0.8, 0.70, None, None)   # below avg — modest benefit
        avg_atr = compute_edge_score(1.0, 0.70, None, None)   # at average
        high_atr = compute_edge_score(2.5, 0.70, None, None)  # elevated

        # at or below average ties but high must be penalized
        assert avg_atr >= high_atr, f"avg_atr={avg_atr:.4f} should be >= high_atr={high_atr:.4f}"
        # actually at 0.8 the vol_score=1.0 same as 1.0 (because formula only penalises >1)
        # key assertion: high_atr < avg_atr
        assert high_atr < avg_atr, f"high_atr={high_atr:.4f} should be < avg_atr={avg_atr:.4f}"

    def test_neutral_none_values_give_0_5_substitution(self):
        """None noise / entangle uses neutral 0.5 — score is deterministic."""
        score_none = compute_edge_score(1.0, 0.7, None, None)
        score_explicit_neutral = compute_edge_score(1.0, 0.7, 0.5, 0.5)
        assert abs(score_none - score_explicit_neutral) < 1e-9, (
            f"None should produce same score as neutral 0.5: "
            f"none={score_none:.6f} explicit={score_explicit_neutral:.6f}"
        )

    def test_score_bounded_0_to_1(self):
        """Score is always in [0, 1]."""
        for p in [0.0, 0.25, 0.5, 0.75, 1.0]:
            for atr in [0.5, 1.0, 2.0, 5.0]:
                s = compute_edge_score(atr, p, None, None)
                assert 0.0 <= s <= 1.0, f"score out of bounds: {s:.4f} atr={atr} p={p}"


# ---------------------------------------------------------------------------
# 2. run_market_audit — distinct composites from distinct per-market inputs
# ---------------------------------------------------------------------------

class TestRunMarketAudit:
    def test_distinct_p_target_overrides_give_distinct_composites(self):
        """Two markets with different p_target_hit overrides get different scores."""
        ev_good = run_market_audit(
            _inp("MES", p_target_hit_override=0.85),
            entanglement_strength=0.7,
        )
        ev_poor = run_market_audit(
            _inp("MNQ", p_target_hit_override=0.40),
            entanglement_strength=0.7,
        )
        assert ev_good.composite_edge_score > ev_poor.composite_edge_score, (
            f"good={ev_good.composite_edge_score:.4f} poor={ev_poor.composite_edge_score:.4f}"
        )

    def test_distinct_atr_ratios_give_distinct_composites(self):
        """Different ATR ratios give different vol-score components."""
        ev_calm = run_market_audit(
            _inp("MES", atr_5m=2.5, atr_8yr_avg=2.5, p_target_hit_override=0.80),
            entanglement_strength=None,
        )
        ev_volatile = run_market_audit(
            _inp("MNQ", atr_5m=5.0, atr_8yr_avg=2.5, p_target_hit_override=0.80),
            entanglement_strength=None,
        )
        assert ev_calm.composite_edge_score > ev_volatile.composite_edge_score, (
            f"calm={ev_calm.composite_edge_score:.4f} volatile={ev_volatile.composite_edge_score:.4f}"
        )

    def test_high_p_target_passes_gate(self):
        """p_target_hit above threshold makes passes_p_target_gate=True."""
        ev = run_market_audit(
            _inp("MES", p_target_hit_override=P_TARGET_HIT_THRESHOLD + 0.05),
            entanglement_strength=None,
        )
        assert ev.passes_p_target_gate is True

    def test_low_p_target_fails_gate(self):
        """p_target_hit at exactly 0.5 (old default) must fail gate — proves F-5 regression."""
        ev = run_market_audit(
            _inp("MES", p_target_hit_override=0.5),
            entanglement_strength=None,
        )
        # 0.5 < P_TARGET_HIT_THRESHOLD (0.75) — must fail
        assert ev.passes_p_target_gate is False, (
            "p_target_hit=0.5 should NOT pass the gate (0.75 threshold) — "
            "this proves why the flat 0.5 default caused always-observation_mode"
        )


# ---------------------------------------------------------------------------
# 3. run_full_scan — F-5 regression: NOT always observation_mode=True
# ---------------------------------------------------------------------------

class TestRunFullScan:
    def test_not_always_observation_mode_when_one_market_has_good_p_target(self):
        """With a real p_target_hit above threshold, at least one market can win.

        This is the F-5 regression test. The old default (p_target_hit=0.5) made
        every market fail the 0.75 gate → observation_mode always True.
        With overrides providing a realistic high value, a winner can emerge.
        """
        market_inputs = {
            "MES": _inp("MES", atr_5m=2.5, atr_8yr_avg=2.5, p_target_hit_override=0.82),
            "MNQ": _inp("MNQ", atr_5m=4.0, atr_8yr_avg=4.0, p_target_hit_override=0.65),
            "MCL": _inp("MCL", atr_5m=0.3, atr_8yr_avg=0.3, p_target_hit_override=0.50),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        # MES has p_target_hit=0.82 > 0.75 threshold — should be winner
        assert result.winner_market is not None, (
            "winner_market should be non-null when one market has p_target_hit > 0.75; "
            "got observation_mode=True — F-5 regression"
        )
        assert result.observation_mode is False
        assert result.winner_market == "MES"

    def test_all_low_p_target_stays_observation_mode(self):
        """When no market exceeds threshold, observation_mode=True is correct behavior."""
        market_inputs = {
            "MES": _inp("MES", p_target_hit_override=0.5),
            "MNQ": _inp("MNQ", p_target_hit_override=0.4),
            "MCL": _inp("MCL", p_target_hit_override=0.3),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        assert result.observation_mode is True
        assert result.winner_market is None

    def test_distinct_edge_scores_across_markets(self):
        """With different inputs, edge scores should differ across markets."""
        market_inputs = {
            "MES": _inp("MES", atr_5m=2.5, atr_8yr_avg=2.5, p_target_hit_override=0.82),
            "MNQ": _inp("MNQ", atr_5m=5.0, atr_8yr_avg=2.5, p_target_hit_override=0.60),  # vol elevated
            "MCL": _inp("MCL", atr_5m=0.3, atr_8yr_avg=0.3, p_target_hit_override=0.50),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        scores = {sym: d["composite"] for sym, d in result.edge_scores.items()}
        # Scores are not all identical
        unique_scores = set(round(s, 4) for s in scores.values())
        assert len(unique_scores) > 1, (
            f"All markets have identical edge scores {scores} — "
            "this means inputs are not differentiated (F-4/F-5 regression)"
        )

    def test_governance_labels_preserved(self):
        """AuditResult must carry authoritative=False, decision_role=challenger_only."""
        market_inputs = {
            "MES": _inp("MES", p_target_hit_override=0.80),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        assert result.governance.get("authoritative") is False
        assert result.governance.get("decision_role") == "challenger_only"

    def test_hardware_field_present(self):
        """AuditResult.hardware must be a non-empty string."""
        market_inputs = {
            "MES": _inp("MES", p_target_hit_override=0.80),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        assert isinstance(result.hardware, str)
        assert len(result.hardware) > 0

    def test_seed_propagated_to_result(self):
        """AuditResult.seed must match the seed passed to run_full_scan."""
        market_inputs = {
            "MES": _inp("MES", p_target_hit_override=0.80),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=99)
        assert result.seed == 99

    def test_three_distinct_markets_have_three_edge_score_entries(self):
        """edge_scores dict must have one entry per market input."""
        market_inputs = {
            "MES": _inp("MES", p_target_hit_override=0.82),
            "MNQ": _inp("MNQ", p_target_hit_override=0.70),
            "MCL": _inp("MCL", p_target_hit_override=0.55),
        }
        result = run_full_scan(market_inputs, _default_corr(), seed=42)
        assert set(result.edge_scores.keys()) == {"MES", "MNQ", "MCL"}


# ---------------------------------------------------------------------------
# 4. Governance module-level constants
# ---------------------------------------------------------------------------

class TestGovernanceConstants:
    def test_governance_labels_not_authoritative(self):
        assert GOVERNANCE_LABELS["authoritative"] is False

    def test_governance_labels_challenger_only(self):
        assert GOVERNANCE_LABELS["decision_role"] == "challenger_only"

    def test_p_target_hit_threshold_is_0_75(self):
        """The threshold must remain at 0.75 — default 0.5 was below it (F-5)."""
        assert P_TARGET_HIT_THRESHOLD == 0.75
