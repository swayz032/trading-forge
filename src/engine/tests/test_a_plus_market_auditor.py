"""Tests for A+ Market Auditor — Tier 3.3 (Gemini Quantum Blueprint W3b).

TDD-first: tests were written BEFORE the implementation.

Covers:
  - Property: edge_score in [0, 1] for any market
  - Property: entanglement_strength in [0, 1]
  - Edge: all markets fail threshold → observation_mode=True, winner_market=None
  - Edge: MNQ scores highest with all gates passed → winner_market="MNQ"
  - Reproducibility: same input 3x produces same edge scores within ±0.02
  - Edge: PennyLane import failure → fallback to no entanglement, scan still completes
  - Authority: no execution fields in output
  - Schema: all required keys present in market evidence dict
  - Governance: governance labels correct
"""
from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import patch

import pytest

# Ensure src is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from src.engine.a_plus_market_auditor import (
    GOVERNANCE_LABELS,
    AuditInput,
    MarketEvidence,
    AuditResult,
    compute_edge_score,
    run_cross_market_entanglement,
    run_market_audit,
    run_full_scan,
    EDGE_SCORE_WEIGHTS,
    P_TARGET_HIT_THRESHOLD,
    NOISE_SCORE_THRESHOLD,
    ENTANGLEMENT_STRENGTH_THRESHOLD,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_audit_input(
    *,
    atr_ratio: float = 1.0,
    p_target_hit: float = 0.80,
    noise_score: float | None = 0.30,
    seed: int = 42,
) -> AuditInput:
    return AuditInput(
        market="MES",
        atr_5m=2.5,
        atr_8yr_avg=2.5 / atr_ratio if atr_ratio > 0 else 2.5,
        vix=18.0,
        gap_atr=0.2,
        spread=0.05,
        p_target_hit_override=p_target_hit,
        noise_score_override=noise_score,
        seed=seed,
    )


def _make_correlation_matrix() -> dict[str, dict[str, float]]:
    """Minimal plausible 60-min rolling correlation matrix."""
    return {
        "MES": {"MES": 1.0, "MNQ": 0.82, "MCL": 0.15, "DXY": -0.30},
        "MNQ": {"MES": 0.82, "MNQ": 1.0, "MCL": 0.12, "DXY": -0.28},
        "MCL": {"MES": 0.15, "MNQ": 0.12, "MCL": 1.0, "DXY": 0.05},
        "DXY": {"MES": -0.30, "MNQ": -0.28, "MCL": 0.05, "DXY": 1.0},
    }


# ─── Property tests: edge_score and entanglement_strength ∈ [0, 1] ───────────

class TestEdgeScoreBounds:
    """edge_score must always be in [0, 1] regardless of inputs."""

    @pytest.mark.parametrize("atr_ratio,p_hit,noise", [
        (0.5, 0.5, 0.3),
        (2.0, 0.9, 0.1),
        (1.0, 0.0, 1.0),
        (0.1, 1.0, 0.0),
        (10.0, 0.75, 0.5),
    ])
    def test_edge_score_in_unit_interval(self, atr_ratio: float, p_hit: float, noise: float) -> None:
        score = compute_edge_score(
            atr_ratio=atr_ratio,
            p_target_hit=p_hit,
            noise_score=noise,
            entanglement_strength=0.5,
        )
        assert 0.0 <= score <= 1.0, f"edge_score={score} out of [0,1] for atr_ratio={atr_ratio}"

    def test_edge_score_none_noise_uses_neutral(self) -> None:
        """noise_score=None (PennyLane unavailable) → neutral 0.5 used."""
        score_with = compute_edge_score(1.0, 0.8, 0.5, 0.0)
        score_none = compute_edge_score(1.0, 0.8, None, 0.0)
        assert 0.0 <= score_none <= 1.0
        # With neutral noise (0.5), should be close to score_with
        assert abs(score_none - score_with) < 0.15  # within 15 pts

    def test_edge_score_none_entanglement_uses_neutral(self) -> None:
        score = compute_edge_score(1.0, 0.8, 0.3, None)
        assert 0.0 <= score <= 1.0

    def test_perfect_conditions_high_score(self) -> None:
        """ATR at average, high p_target, zero noise, max entanglement → high score."""
        score = compute_edge_score(1.0, 1.0, 0.0, 1.0)
        assert score >= 0.85, f"Perfect conditions should yield >=0.85, got {score}"

    def test_worst_conditions_low_score(self) -> None:
        """Very high ATR, zero p_target, max noise, zero entanglement → low score."""
        score = compute_edge_score(5.0, 0.0, 1.0, 0.0)
        assert score <= 0.15, f"Worst conditions should yield <=0.15, got {score}"


class TestEntanglementStrengthBounds:
    """entanglement_strength must always be in [0, 1]."""

    def test_entanglement_strength_in_unit_interval(self) -> None:
        corr = _make_correlation_matrix()
        result = run_cross_market_entanglement(corr, seed=42)
        assert result["entanglement_strength"] is None or (
            0.0 <= result["entanglement_strength"] <= 1.0
        )

    def test_entanglement_result_schema(self) -> None:
        corr = _make_correlation_matrix()
        result = run_cross_market_entanglement(corr, seed=42)
        for key in ("lead_market", "lag_window_minutes", "entanglement_strength", "hardware", "execution_time_ms"):
            assert key in result, f"Missing key: {key}"

    def test_entanglement_hardware_label(self) -> None:
        corr = _make_correlation_matrix()
        result = run_cross_market_entanglement(corr, seed=42)
        # hardware must be explicit (local vs fallback)
        assert result["hardware"] in ("default.qubit", "fallback_classical", "fallback_unavailable")

    def test_entanglement_lead_market_valid_or_none(self) -> None:
        corr = _make_correlation_matrix()
        result = run_cross_market_entanglement(corr, seed=42)
        valid = {None, "MES", "MNQ", "MCL", "DXY"}
        assert result["lead_market"] in valid, f"Invalid lead_market: {result['lead_market']}"

    def test_entanglement_lag_window_positive_or_none(self) -> None:
        corr = _make_correlation_matrix()
        result = run_cross_market_entanglement(corr, seed=42)
        lag = result["lag_window_minutes"]
        if lag is not None:
            assert lag > 0, f"lag_window_minutes must be positive, got {lag}"


# ─── Edge: all markets fail → OBSERVATION_MODE ────────────────────────────────

class TestObservationMode:
    """When no market passes thresholds, observation_mode=True and winner=None."""

    def test_all_fail_p_target_threshold(self) -> None:
        """All markets with p_target_hit < 0.75 → observation_mode."""
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.60, noise_score_override=0.2, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.65, noise_score_override=0.2, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.70, noise_score_override=0.2, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        assert result.observation_mode is True
        assert result.winner_market is None

    def test_all_fail_noise_threshold(self) -> None:
        """All markets with noise_score > threshold → observation_mode."""
        high_noise = NOISE_SCORE_THRESHOLD + 0.1
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.85, noise_score_override=high_noise, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, noise_score_override=high_noise, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.85, noise_score_override=high_noise, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        assert result.observation_mode is True
        assert result.winner_market is None

    def test_observation_mode_result_schema(self) -> None:
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.50, noise_score_override=0.2, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.50, noise_score_override=0.2, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.50, noise_score_override=0.2, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        # All required result keys present
        assert hasattr(result, "observation_mode")
        assert hasattr(result, "winner_market")
        assert hasattr(result, "edge_scores")
        assert hasattr(result, "lead_market")
        assert hasattr(result, "entanglement_strength")
        assert hasattr(result, "governance")
        assert hasattr(result, "scan_duration_ms")
        assert hasattr(result, "hardware")


# ─── Edge: MNQ wins when it scores highest with all gates passed ──────────────

class TestWinnerSelection:
    """Winner selection picks highest edge-score market passing all gates."""

    def test_mnq_wins_when_highest_score(self) -> None:
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.77, noise_score_override=0.3, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.92, noise_score_override=0.10, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, noise_score_override=0.35, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        assert result.winner_market == "MNQ"
        assert result.observation_mode is False

    def test_winner_must_pass_p_target_threshold(self) -> None:
        """Winner is only picked if p_target_hit > P_TARGET_HIT_THRESHOLD."""
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.74, noise_score_override=0.1, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 2.0, 18.0, 0.3, 0.04, p_target_hit_override=0.74, noise_score_override=0.1, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.2, 18.0, 0.1, 0.10, p_target_hit_override=0.74, noise_score_override=0.1, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        # All just below threshold — observation mode
        assert result.observation_mode is True

    def test_winner_edge_scores_populated(self) -> None:
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, noise_score_override=0.2, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.80, noise_score_override=0.2, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.80, noise_score_override=0.2, seed=42),
        }
        corr = _make_correlation_matrix()
        result = run_full_scan(market_inputs, corr, seed=42)
        for market in ("MES", "MNQ", "MCL"):
            assert market in result.edge_scores
            mdata = result.edge_scores[market]
            assert "vol" in mdata
            assert "p_target" in mdata
            assert "noise" in mdata
            assert "entangle" in mdata
            assert "composite" in mdata
            assert 0.0 <= mdata["composite"] <= 1.0


# ─── Reproducibility ─────────────────────────────────────────────────────────

class TestReproducibility:
    """Same input 3x must produce same edge scores within ±0.02."""

    def test_edge_scores_reproducible(self) -> None:
        corr = _make_correlation_matrix()
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, noise_score_override=0.3, seed=99),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, noise_score_override=0.25, seed=99),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, noise_score_override=0.35, seed=99),
        }
        results = [run_full_scan(market_inputs, corr, seed=99) for _ in range(3)]
        for market in ("MES", "MNQ", "MCL"):
            scores = [r.edge_scores[market]["composite"] for r in results]
            max_delta = max(scores) - min(scores)
            assert max_delta <= 0.02, (
                f"{market} reproducibility failed: scores={scores}, delta={max_delta:.4f}"
            )

    def test_entanglement_reproducible(self) -> None:
        corr = _make_correlation_matrix()
        results = [run_cross_market_entanglement(corr, seed=77) for _ in range(3)]
        strengths = [r["entanglement_strength"] for r in results if r["entanglement_strength"] is not None]
        if len(strengths) >= 2:
            delta = max(strengths) - min(strengths)
            assert delta <= 0.02, f"Entanglement not reproducible: {strengths}"


# ─── PennyLane fallback ───────────────────────────────────────────────────────

class TestPennyLaneFallback:
    """PennyLane unavailable → fallback, scan still completes with classical-only edge score."""

    def test_scan_completes_without_pennylane(self) -> None:
        with patch("src.engine.a_plus_market_auditor.PENNYLANE_AVAILABLE", False):
            corr = _make_correlation_matrix()
            market_inputs = {
                "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, seed=42),
                "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, seed=42),
                "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, seed=42),
            }
            result = run_full_scan(market_inputs, corr, seed=42)
            # Must complete without error
            assert result is not None
            # Edge scores must still be populated
            assert len(result.edge_scores) == 3
            # entanglement_strength should be None (PennyLane unavailable)
            assert result.entanglement_strength is None or isinstance(result.entanglement_strength, float)

    def test_entanglement_fallback_without_pennylane(self) -> None:
        with patch("src.engine.a_plus_market_auditor.PENNYLANE_AVAILABLE", False):
            corr = _make_correlation_matrix()
            result = run_cross_market_entanglement(corr, seed=42)
            assert result["entanglement_strength"] is None
            assert result["hardware"] == "fallback_unavailable"
            assert result["lead_market"] is None

    def test_noise_fallback_without_pennylane(self) -> None:
        """With no PennyLane, noise_score_override=None uses neutral score → scan completes."""
        with patch("src.engine.a_plus_market_auditor.PENNYLANE_AVAILABLE", False):
            corr = _make_correlation_matrix()
            market_inputs = {
                "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, noise_score_override=None, seed=42),
                "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, noise_score_override=None, seed=42),
                "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, noise_score_override=None, seed=42),
            }
            result = run_full_scan(market_inputs, corr, seed=42)
            assert result is not None
            for market in ("MES", "MNQ", "MCL"):
                assert 0.0 <= result.edge_scores[market]["composite"] <= 1.0


# ─── Authority boundary tests ─────────────────────────────────────────────────

class TestAuthorityBoundaries:
    """Challenger module must not carry execution authority in its outputs."""

    def test_governance_labels_challenger_only(self) -> None:
        assert GOVERNANCE_LABELS["authoritative"] is False
        assert GOVERNANCE_LABELS["experimental"] is True
        assert GOVERNANCE_LABELS["decision_role"] == "challenger_only"

    def test_result_has_governance(self) -> None:
        corr = _make_correlation_matrix()
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, seed=42),
        }
        result = run_full_scan(market_inputs, corr, seed=42)
        assert result.governance["authoritative"] is False
        assert result.governance["decision_role"] == "challenger_only"

    def test_result_has_no_order_fields(self) -> None:
        """AuditResult must not contain any field names suggesting execution authority."""
        forbidden = {"order", "execute", "position", "entry", "exit", "buy", "sell", "quantity", "contracts"}
        corr = _make_correlation_matrix()
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, seed=42),
        }
        result = run_full_scan(market_inputs, corr, seed=42)
        for field in result.__dict__:
            assert field.lower() not in forbidden, f"Execution field found in result: {field}"


# ─── Schema regression ────────────────────────────────────────────────────────

class TestOutputSchema:
    """AuditResult schema must stay stable — all expected keys always present."""

    def _run(self) -> AuditResult:
        corr = _make_correlation_matrix()
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, noise_score_override=0.3, seed=42),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, noise_score_override=0.25, seed=42),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, noise_score_override=0.35, seed=42),
        }
        return run_full_scan(market_inputs, corr, seed=42)

    def test_top_level_keys(self) -> None:
        result = self._run()
        required = {
            "winner_market", "observation_mode", "edge_scores",
            "lead_market", "lag_window_minutes", "entanglement_strength",
            "governance", "scan_duration_ms", "hardware", "seed",
        }
        actual = set(result.__dict__.keys())
        missing = required - actual
        assert not missing, f"Missing keys in AuditResult: {missing}"

    def test_edge_scores_market_keys(self) -> None:
        result = self._run()
        for market in ("MES", "MNQ", "MCL"):
            assert market in result.edge_scores
            mdata = result.edge_scores[market]
            assert "vol" in mdata
            assert "p_target" in mdata
            assert "noise" in mdata
            assert "entangle" in mdata
            assert "composite" in mdata

    def test_scan_duration_ms_positive(self) -> None:
        result = self._run()
        assert result.scan_duration_ms >= 0

    def test_hardware_explicit(self) -> None:
        result = self._run()
        assert result.hardware in ("default.qubit", "fallback_classical", "fallback_unavailable")

    def test_seed_propagated(self) -> None:
        corr = _make_correlation_matrix()
        market_inputs = {
            "MES": AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, seed=77),
            "MNQ": AuditInput("MNQ", 4.0, 4.0, 18.0, 0.3, 0.04, p_target_hit_override=0.85, seed=77),
            "MCL": AuditInput("MCL", 0.3, 0.3, 18.0, 0.1, 0.10, p_target_hit_override=0.78, seed=77),
        }
        result = run_full_scan(market_inputs, corr, seed=77)
        assert result.seed == 77


# ─── Edge score formula constants ────────────────────────────────────────────

class TestEdgeScoreFormula:
    """EDGE_SCORE_WEIGHTS must sum to 1.0 within tolerance."""

    def test_weights_sum_to_one(self) -> None:
        total = sum(EDGE_SCORE_WEIGHTS.values())
        assert abs(total - 1.0) < 1e-9, f"Weights do not sum to 1.0: {total}"

    def test_threshold_constants_exist(self) -> None:
        assert 0.5 < P_TARGET_HIT_THRESHOLD < 1.0
        assert 0.0 < NOISE_SCORE_THRESHOLD < 1.0
        assert 0.0 < ENTANGLEMENT_STRENGTH_THRESHOLD < 1.0


# ─── run_market_audit unit test ───────────────────────────────────────────────

class TestRunMarketAudit:
    """run_market_audit returns MarketEvidence with correct bounds."""

    def test_market_evidence_schema(self) -> None:
        inp = AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05, p_target_hit_override=0.80, noise_score_override=0.3, seed=42)
        ev = run_market_audit(inp, entanglement_strength=0.6)
        assert hasattr(ev, "market")
        assert hasattr(ev, "atr_ratio")
        assert hasattr(ev, "p_target_hit")
        assert hasattr(ev, "noise_score")
        assert hasattr(ev, "entanglement_strength")
        assert hasattr(ev, "composite_edge_score")
        assert 0.0 <= ev.composite_edge_score <= 1.0

    def test_atr_ratio_computed_correctly(self) -> None:
        inp = AuditInput("MES", atr_5m=4.0, atr_8yr_avg=2.0, vix=18.0, gap_atr=0.2, spread=0.05,
                         p_target_hit_override=0.80, noise_score_override=0.3, seed=42)
        ev = run_market_audit(inp, entanglement_strength=0.5)
        # atr_ratio = current / avg = 4.0 / 2.0 = 2.0 → elevated vol
        assert abs(ev.atr_ratio - 2.0) < 0.01

    def test_passes_gates_when_all_thresholds_met(self) -> None:
        inp = AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05,
                         p_target_hit_override=0.80, noise_score_override=0.30, seed=42)
        ev = run_market_audit(inp, entanglement_strength=0.5)
        assert ev.passes_p_target_gate is True
        assert ev.passes_noise_gate is True

    def test_fails_gates_when_below_thresholds(self) -> None:
        inp = AuditInput("MES", 2.5, 2.5, 18.0, 0.2, 0.05,
                         p_target_hit_override=0.60, noise_score_override=0.80, seed=42)
        ev = run_market_audit(inp, entanglement_strength=0.5)
        assert ev.passes_p_target_gate is False
        assert ev.passes_noise_gate is False
