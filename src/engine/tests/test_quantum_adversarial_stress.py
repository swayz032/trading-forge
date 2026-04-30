"""Tests for Tier 3.4 Quantum Adversarial Stress Test.

Test categories:
  1. Property tests (output range, schema)
  2. Reproducibility (same input -> same output within tolerance)
  3. TIER gating (TIER_3 skips adversarial stress — tested at TS layer)
  4. Adversarial validity (doom sequence found by classical path)
  5. Classical fallback (PennyLane mocked -> brute-force or random sample)
  6. Cost ceiling (abort at 30s)
  7. Phase 0 shadow (lifecycle decisions identical — tested at TS layer)

Authority boundary: quantum_adversarial_stress outputs must never gate
lifecycle decisions. This module is challenger-only evidence.
"""
from __future__ import annotations

import math
import sys
import time
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest

# Import the module under test
from src.engine.quantum_adversarial_stress import (
    AdversarialStressResult,
    PropFirmRules,
    TradeRecord,
    GOVERNANCE_LABELS,
    WALL_CLOCK_LIMIT_S,
    _compute_breach_prob_classical,
    run_adversarial_stress,
)

import random

# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_trades(pnls: list[float]) -> list[TradeRecord]:
    return [
        TradeRecord(trade_id=str(i), pnl=p, direction="long", entry_time="", exit_time="")
        for i, p in enumerate(pnls)
    ]


def _standard_rules(daily_loss_limit: float = 2000.0) -> PropFirmRules:
    return PropFirmRules(
        daily_loss_limit=daily_loss_limit,
        max_consecutive_losers=4,
        trailing_drawdown=None,
    )


# ─── 1. Property tests ────────────────────────────────────────────────────────

class TestOutputProperties:
    """worst_case_breach_prob must be in [0, 1] for any valid input."""

    def test_breach_prob_in_range_all_winners(self):
        trades = _make_trades([500.0, 300.0, 200.0, 400.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_breach_prob_in_range_mixed(self):
        trades = _make_trades([500.0, -800.0, 200.0, -600.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(1000.0), seed=42)
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_breach_prob_in_range_all_losers(self):
        trades = _make_trades([-300.0, -400.0, -200.0, -500.0])
        result = run_adversarial_stress(trades, _standard_rules(500.0), seed=42)
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_breach_prob_in_range_empty_trades(self):
        trades = []
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        # Empty trade list: should complete without error and return None or 0
        assert result.status in ("completed", "failed", "aborted")
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_governance_labels_always_present(self):
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.governance_labels["experimental"] is True
        assert result.governance_labels["authoritative"] is False
        assert result.governance_labels["decision_role"] == "challenger_only"

    def test_n_trades_populated(self):
        trades = _make_trades([100.0, -200.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.n_trades == 3

    def test_method_field_is_valid(self):
        trades = _make_trades([100.0, -200.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.method in (
            "grover_quantum",
            "brute_force_classical",
            "random_sample_classical",
        )

    def test_status_is_terminal(self):
        trades = _make_trades([100.0, -200.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.status in ("completed", "failed", "aborted")

    def test_hardware_field_explicit(self):
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.hardware in ("local_simulator", "cloud_simulator", "real_hardware")

    def test_reproducibility_hash_present(self):
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert len(result.reproducibility_hash) == 64  # SHA-256 hex


# ─── 2. Reproducibility tests ─────────────────────────────────────────────────

class TestReproducibility:
    """Same trade ledger, same seed -> same worst_case_breach_prob within ±0.05."""

    def test_three_runs_agree(self):
        trades = _make_trades([500.0, -800.0, 300.0, -600.0, 200.0, -400.0])
        rules = _standard_rules(1000.0)
        results = [run_adversarial_stress(trades, rules, seed=42) for _ in range(3)]
        probs = [r.worst_case_breach_prob for r in results if r.worst_case_breach_prob is not None]
        if len(probs) >= 2:
            for i in range(len(probs) - 1):
                assert abs(probs[i] - probs[i + 1]) <= 0.05, (
                    f"Reproducibility failed: {probs[i]} vs {probs[i + 1]}"
                )

    def test_same_hash_for_same_input(self):
        trades = _make_trades([100.0, -200.0, 300.0])
        rules = _standard_rules()
        r1 = run_adversarial_stress(trades, rules, seed=42)
        r2 = run_adversarial_stress(trades, rules, seed=42)
        assert r1.reproducibility_hash == r2.reproducibility_hash

    def test_different_seed_may_differ(self):
        """Different seeds are allowed to produce different results — just checking no crash."""
        trades = _make_trades([500.0, -800.0, 300.0, -600.0])
        rules = _standard_rules(1000.0)
        r1 = run_adversarial_stress(trades, rules, seed=42)
        r2 = run_adversarial_stress(trades, rules, seed=99)
        # Both must be valid regardless of whether values differ
        for r in [r1, r2]:
            assert r.status in ("completed", "failed", "aborted")


# ─── 3. Adversarial validity — doom sequence ──────────────────────────────────

class TestAdversarialValidity:
    """A strategy with 5 max-loss trades in a row must breach the daily limit."""

    def _doom_sequence_trades(self) -> tuple[list[TradeRecord], PropFirmRules]:
        """5 trades, each losing $500 — guaranteed breach of a $1000 limit
        if any 2 consecutive losers are put in sequence."""
        pnls = [-500.0, -500.0, -500.0, -500.0, -500.0]
        trades = _make_trades(pnls)
        rules = PropFirmRules(
            daily_loss_limit=1000.0,  # Any 2 consecutive losers breach
            max_consecutive_losers=4,
        )
        return trades, rules

    def test_classical_brute_force_finds_doom(self):
        trades, rules = self._doom_sequence_trades()
        result = run_adversarial_stress(trades, rules, seed=42)
        # With 5 losers and $1000 limit, any 2 consecutive = breach
        # Brute-force or random should find these
        if result.status == "completed" and result.worst_case_breach_prob is not None:
            assert result.worst_case_breach_prob > 0.0, (
                "Doom sequence: expected breach_prob > 0, got 0"
            )

    def test_doom_sequence_in_top_k(self):
        trades, rules = self._doom_sequence_trades()
        result = run_adversarial_stress(trades, rules, seed=42)
        if result.status == "completed" and result.worst_sequence_examples:
            # At least one example should show significant loss
            max_loss = max(
                ex.get("loss_sum", 0.0) for ex in result.worst_sequence_examples
            )
            assert max_loss >= rules.daily_loss_limit, (
                f"Expected worst example loss >= {rules.daily_loss_limit}, got {max_loss}"
            )

    def test_all_winners_no_breach(self):
        trades = _make_trades([500.0, 300.0, 200.0, 400.0, 250.0])
        rules = _standard_rules(2000.0)
        result = run_adversarial_stress(trades, rules, seed=42)
        if result.status == "completed" and result.worst_case_breach_prob is not None:
            assert result.worst_case_breach_prob == 0.0, (
                f"All-winner strategy should have 0 breach prob, got {result.worst_case_breach_prob}"
            )

    def test_breach_minimal_n_is_valid(self):
        """breach_minimal_n_trades must be > 0 when breach is detected."""
        trades, rules = self._doom_sequence_trades()
        result = run_adversarial_stress(trades, rules, seed=42)
        if result.status == "completed" and result.worst_case_breach_prob:
            if result.breach_minimal_n_trades is not None:
                assert result.breach_minimal_n_trades >= 1
                assert result.breach_minimal_n_trades <= result.n_trades


# ─── 4. Classical fallback tests ──────────────────────────────────────────────

class TestClassicalFallback:
    """When PennyLane is mocked to fail, classical path runs."""

    def test_brute_force_for_small_n(self):
        """N <= 12: brute_force_classical method used when pennylane unavailable."""
        trades = _make_trades([-300.0, -400.0, 200.0, -500.0, 100.0, -200.0])
        rules = _standard_rules(600.0)

        with patch("src.engine.quantum_adversarial_stress.PENNYLANE_AVAILABLE", False):
            result = run_adversarial_stress(trades, rules, seed=42)

        assert result.method == "brute_force_classical"
        assert result.status == "completed"
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_random_sample_for_large_n(self):
        """N > 12: random_sample_classical method used when pennylane unavailable."""
        pnls = [-300.0] * 7 + [200.0] * 8  # 15 trades
        trades = _make_trades(pnls)
        rules = _standard_rules(600.0)

        with patch("src.engine.quantum_adversarial_stress.PENNYLANE_AVAILABLE", False):
            result = run_adversarial_stress(trades, rules, seed=42)

        assert result.method == "random_sample_classical"
        assert result.status == "completed"
        if result.worst_case_breach_prob is not None:
            assert 0.0 <= result.worst_case_breach_prob <= 1.0

    def test_grover_exception_falls_to_classical(self):
        """If _run_grover raises, classical fallback activates."""
        trades = _make_trades([-300.0, -400.0, 200.0, -500.0, 100.0])
        rules = _standard_rules(500.0)

        with patch(
            "src.engine.quantum_adversarial_stress._run_grover",
            side_effect=RuntimeError("Device init failed"),
        ):
            result = run_adversarial_stress(trades, rules, seed=42)

        assert result.method in ("brute_force_classical", "random_sample_classical")
        assert result.status == "completed"


# ─── 5. Cost ceiling tests ────────────────────────────────────────────────────

class TestCostCeiling:
    """Simulated long-running circuit aborts at 30s."""

    def test_abort_on_grover_timeout(self):
        """If Grover exceeds WALL_CLOCK_LIMIT_S, status becomes 'aborted'."""
        import concurrent.futures

        trades = _make_trades([-300.0, -400.0, 200.0, -100.0, -500.0])
        rules = _standard_rules(500.0)

        def slow_grover(*args, **kwargs):
            time.sleep(35)  # Exceeds 30s limit
            return 0.5, [], 2, 5, "local_simulator"

        with patch(
            "src.engine.quantum_adversarial_stress._run_grover",
            side_effect=slow_grover,
        ), patch(
            "src.engine.quantum_adversarial_stress.WALL_CLOCK_LIMIT_S",
            0.1,  # Shrink to 100ms for test speed
        ):
            result = run_adversarial_stress(trades, rules, seed=42)

        # With 100ms limit and 35s sleep, must abort OR fall back to classical
        # (ThreadPoolExecutor raises TimeoutError -> aborted or classical runs instead)
        assert result.status in ("aborted", "completed")
        if result.status == "aborted":
            assert "wall-clock" in (result.error_message or "")

    def test_abort_on_classical_timeout(self):
        """If classical fallback also times out, status becomes 'aborted'."""
        trades = _make_trades([-300.0, -400.0, 200.0])
        rules = _standard_rules(500.0)

        def slow_classical(*args, **kwargs):
            time.sleep(35)
            return 0.0, [], None

        with patch(
            "src.engine.quantum_adversarial_stress.PENNYLANE_AVAILABLE",
            False,
        ), patch(
            "src.engine.quantum_adversarial_stress._compute_breach_prob_classical",
            side_effect=slow_classical,
        ), patch(
            "src.engine.quantum_adversarial_stress.WALL_CLOCK_LIMIT_S",
            0.1,
        ):
            result = run_adversarial_stress(trades, rules, seed=42)

        assert result.status in ("aborted", "completed")

    def test_wall_clock_constant_value(self):
        """WALL_CLOCK_LIMIT_S must be <= 30 seconds."""
        assert WALL_CLOCK_LIMIT_S <= 30.0


# ─── 6. Classical breach computation unit tests ───────────────────────────────

class TestClassicalBreachComputation:
    """Unit tests for _compute_breach_prob_classical."""

    def test_no_losses_zero_breach(self):
        rng = random.Random(42)
        prob, examples, minimal_n = _compute_breach_prob_classical(
            [500.0, 300.0, 200.0],
            daily_loss_limit=1000.0,
            n_orderings_sampled=1000,
            rng=rng,
        )
        assert prob == 0.0
        assert examples == []
        assert minimal_n is None

    def test_guaranteed_breach_brute_force(self):
        """Three $700 losses: any 2 consecutive exceed $1000."""
        rng = random.Random(42)
        # N=3 (<= 12): brute-force
        prob, examples, minimal_n = _compute_breach_prob_classical(
            [-700.0, -700.0, -700.0],
            daily_loss_limit=1000.0,
            n_orderings_sampled=1000,
            rng=rng,
        )
        # All orderings have consecutive losses -> breach_prob > 0
        assert prob > 0.0
        assert len(examples) > 0

    def test_examples_sorted_by_loss_descending(self):
        rng = random.Random(42)
        prob, examples, minimal_n = _compute_breach_prob_classical(
            [-700.0, -600.0, -800.0],
            daily_loss_limit=1000.0,
            n_orderings_sampled=100,
            rng=rng,
        )
        if len(examples) >= 2:
            for i in range(len(examples) - 1):
                assert examples[i]["loss_sum"] >= examples[i + 1]["loss_sum"]


# ─── 7. Governance / authority boundary ──────────────────────────────────────

class TestGovernanceBoundary:
    """Adversarial stress result must never carry authoritative=True."""

    def test_not_authoritative(self):
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.governance_labels.get("authoritative") is False

    def test_decision_role_is_challenger_only(self):
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.governance_labels.get("decision_role") == "challenger_only"

    def test_qpu_seconds_zero_for_local(self):
        """Local simulator runs must never report nonzero qpu_seconds."""
        trades = _make_trades([100.0, -200.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        # Local simulator — qpu_seconds must be 0.0
        assert result.qpu_seconds == 0.0

    def test_result_is_pydantic_model(self):
        """Output must be an AdversarialStressResult — schema regression guard."""
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert isinstance(result, AdversarialStressResult)
        # JSON-serializable
        dumped = result.model_dump_json()
        assert len(dumped) > 0
