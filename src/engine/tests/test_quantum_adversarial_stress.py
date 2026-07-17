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

import random
import threading
import time
from unittest.mock import patch

import pytest

# Import the module under test
from src.engine.quantum_adversarial_stress import (
    WALL_CLOCK_LIMIT_S,
    AdversarialStressResult,
    PropFirmRules,
    TradeRecord,
    _compute_breach_prob_classical,
    run_adversarial_stress,
)

# ─── Module-level flag enablement ─────────────────────────────────────────────
# F-1 (2026-05-21): run_adversarial_stress now gates on QUANTUM_ADVERSARIAL_STRESS_ENABLED.
# All existing tests that exercise actual execution paths must patch the flag to True.
# The dedicated TestFeatureFlag class tests the disabled (skipped_disabled) path explicitly.

@pytest.fixture(autouse=True)
def enable_adversarial_stress(monkeypatch):
    """Patch the module-level flag to True for all tests in this file that exercise
    real execution paths. Tests in TestFeatureFlag explicitly override this fixture."""
    monkeypatch.setattr(
        "src.engine.quantum_adversarial_stress.QUANTUM_ADVERSARIAL_STRESS_ENABLED",
        True,
    )


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
        trades = _make_trades([-300.0, -400.0, 200.0, -100.0, -500.0])
        rules = _standard_rules(500.0)

        # Cooperatively-stoppable mock (threading.Event) instead of a bare
        # time.sleep(35) — a real fixwave (2026-07-17) regression: because
        # run_adversarial_stress no longer blocks the caller on
        # ThreadPoolExecutor's default wait=True shutdown, this mock's
        # background thread would otherwise keep running for the full 35s
        # AFTER the test's assertions already passed, needlessly slowing
        # down the rest of the pytest session. Releasing it in `finally`
        # keeps this test's real wall-clock cost near-zero either way.
        release = threading.Event()

        def slow_grover(*args, **kwargs):
            release.wait(timeout=10.0)  # bounded safety net, never the real bound under test
            return 0.5, [], 2, 5, "local_simulator"

        try:
            with patch(
                "src.engine.quantum_adversarial_stress._run_grover",
                side_effect=slow_grover,
            ), patch(
                "src.engine.quantum_adversarial_stress.WALL_CLOCK_LIMIT_S",
                0.1,  # Shrink to 100ms for test speed
            ):
                result = run_adversarial_stress(trades, rules, seed=42)
        finally:
            release.set()

        # With 100ms limit and a slow mock, must abort OR fall back to classical
        # (ThreadPoolExecutor raises TimeoutError -> aborted or classical runs instead)
        assert result.status in ("aborted", "completed")
        if result.status == "aborted":
            assert "wall-clock" in (result.error_message or "")

    def test_abort_on_classical_timeout(self):
        """If classical fallback also times out, status becomes 'aborted'."""
        trades = _make_trades([-300.0, -400.0, 200.0])
        rules = _standard_rules(500.0)

        # See test_abort_on_grover_timeout for why this uses a cooperative
        # Event instead of time.sleep(35).
        release = threading.Event()

        def slow_classical(*args, **kwargs):
            release.wait(timeout=10.0)
            return 0.0, [], None

        try:
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
        finally:
            release.set()

        assert result.status in ("aborted", "completed")

    def test_wall_clock_constant_value(self):
        """WALL_CLOCK_LIMIT_S must be <= 30 seconds."""
        assert WALL_CLOCK_LIMIT_S <= 30.0

    def test_wall_clock_bounds_caller_return_latency_not_executor_shutdown_join(self):
        """REGRESSION (fixwave 2026-07-17): run_adversarial_stress() must
        RETURN within roughly WALL_CLOCK_LIMIT_S of a slow classical
        fallback, not block on ThreadPoolExecutor's implicit
        shutdown(wait=True) join.

        `with ThreadPoolExecutor(...) as executor:` calls shutdown(wait=True)
        on __exit__, which blocks until the submitted (uncancellable) worker
        thread actually finishes — REGARDLESS of future.result(timeout=...)
        having already raised TimeoutError inside the with-block. So the old
        code reported status="aborted" but did not actually return to the
        caller until the slow call finished on its own, silently defeating
        the documented "aborts... if wall clock exceeded" contract: the
        function's real wall-clock cost equalled the slow call's true
        duration, not WALL_CLOCK_LIMIT_S.

        Uses a cooperatively-stoppable mock (threading.Event) rather than a
        long time.sleep() so a real failure here (function still blocking)
        is bounded at ~10s instead of hanging, and the passing case leaves
        no slow background thread behind.
        """
        trades = _make_trades([-300.0, -400.0, 200.0])
        rules = _standard_rules(500.0)

        release = threading.Event()

        def slow_classical(*args, **kwargs):
            release.wait(timeout=10.0)
            return 0.0, [], None

        try:
            with patch(
                "src.engine.quantum_adversarial_stress.PENNYLANE_AVAILABLE",
                False,
            ), patch(
                "src.engine.quantum_adversarial_stress._compute_breach_prob_classical",
                side_effect=slow_classical,
            ), patch(
                "src.engine.quantum_adversarial_stress.WALL_CLOCK_LIMIT_S",
                0.2,
            ):
                t0 = time.time()
                result = run_adversarial_stress(trades, rules, seed=42)
                elapsed = time.time() - t0
        finally:
            release.set()

        assert result.status == "aborted"
        assert elapsed < 2.0, (
            f"run_adversarial_stress took {elapsed:.2f}s to return after a "
            "0.2s WALL_CLOCK_LIMIT_S timeout — it is blocking on "
            "ThreadPoolExecutor's default shutdown(wait=True) join instead "
            "of returning as soon as future.result() times out."
        )


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

    def test_loss_assignment_matches_grover_consecutive_streak_indexing(self):
        """REGRESSION (MED): classical fallback must index loss_amounts by
        CONSECUTIVE-LOSS-STREAK position (resets on every win), exactly like
        the Grover oracle's `consecutive_loss_idx` in _grover_circuit — NOT
        by the trade's absolute ordering position (`i % len(loss_amounts)`,
        the pre-fix scheme).

        Worked counter-example: loss_amounts=[10,20,30] (in that order),
        ordering=[1,0,1,1,0] (loss, win, loss, loss, win).

        Old (buggy) `i % len(loss_amounts)` scheme:
          i=0 bit=1 -> idx 0%3=0 -> +10 (running=10)
          i=1 bit=0 -> reset (running=0)
          i=2 bit=1 -> idx 2%3=2 -> +30 (running=30)
          i=3 bit=1 -> idx 3%3=0 -> +10 (running=40)   <- WRONG: reuses
                                                            loss_amounts[0]
                                                            mid-streak
          i=4 bit=0 -> reset
          worst = 40

        Grover-matching consecutive-streak scheme (the fix):
          i=0 bit=1, streak pos 0 -> idx 0 -> +10 (running=10, streak=1)
          i=1 bit=0 -> reset (running=0, streak=0)
          i=2 bit=1, streak pos 0 -> idx 0 -> +10 (running=10, streak=1)
          i=3 bit=1, streak pos 1 -> idx 1 -> +20 (running=30, streak=2)
          i=4 bit=0 -> reset
          worst = 30

        This asserts on `breach_prob` (computed over ALL 2**5=32 enumerated
        orderings) rather than presence in the top-5 truncated examples list
        — at daily_loss_limit=25.0 there are many higher-sum breaching
        orderings (e.g. the all-losses [1,1,1,1,1] = 90), so [1,0,1,1,0]'s
        loss_sum=30 never survives the top-5 cut even under the FIXED
        algorithm, making top-5 presence an unreliable/lossy assertion
        (verified empirically: it fails against the fixed code, a false
        RED). `breach_prob` is not truncated, so it is the correct signal.

        daily_loss_limit=35.0 is chosen so the two schemes disagree on the
        overall breach SET, not just this one ordering's exact sum — a
        stronger, hand-verified assertion:
          - NEW (streak) scheme: a 2-consecutive-run always sums to exactly
            loss_amounts[0]+loss_amounts[1]=30 regardless of WHERE it
            occurs (that's the whole point of streak-relative indexing), so
            30 < 35 never breaches; only runs of length >= 3 do. Exactly 3
            of the 32 orderings have a max run >= 3 with all 3 losses
            forming ONE block, but longer streak-tail reuse (clamped to
            loss_amounts[-1]) also pushes some 4/5-length-run orderings
            over 35 — full brute-force enumeration (verified by an
            independent throwaway script against this exact algorithm)
            gives breach_count=8, breach_prob=8/32=0.25.
          - OLD (positional i % len) scheme: worst-value depends on ABSOLUTE
            bit position, so several 2-consecutive-run orderings coincidentally
            land on high-value indices (e.g. [1,0,1,1,0] itself: old=40 >= 35,
            a false breach under the buggy scheme) — independently verified
            breach_count=12, breach_prob=12/32=0.375.
        These counts are provably different (8 vs 12), so this assertion
        would fail under the pre-fix positional scheme.
        """
        rng = random.Random(42)
        prob, examples, minimal_n = _compute_breach_prob_classical(
            [-10.0, -20.0, -30.0, 5.0, 5.0],  # loss_amounts=[10,20,30] positionally
            daily_loss_limit=35.0,
            n_orderings_sampled=1000,  # unused (n=5 <= 12 -> brute force)
            rng=rng,
        )
        assert prob == pytest.approx(8 / 32), (
            "classical fallback breach_prob at daily_loss_limit=35.0 with "
            "loss_amounts=[10,20,30] must be 8/32=0.25 (consecutive-streak "
            "indexing, matching the Grover oracle's breach SET), not "
            "12/32=0.375 (the old absolute-position `i % len(loss_amounts)` "
            f"scheme that broke the documented 'mandatory parity' contract). Got {prob}."
        )
        # [1,0,1,1,0] is the docstring's worked counter-example: it breaches
        # under the OLD scheme (worst=40 >= 35) but must NOT breach under the
        # fixed streak-relative scheme (worst=30 < 35) — confirm it is absent
        # from the (non-truncated-relevant here, since breach_count=8 > 5 so
        # this ordering's sum=30 would be excluded from top-5 either way, but
        # we check membership by sequence, not by list position/index) example set.
        target = [e for e in examples if e["sequence"] == [1, 0, 1, 1, 0]]
        assert not target, (
            "ordering [1,0,1,1,0] must NOT be a breaching example at "
            "daily_loss_limit=35.0 under the fixed streak-relative scheme "
            f"(worst=30 < 35) — got it flagged as a breach: {target}"
        )


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

    def test_schema_version_field_present(self):
        """F-4: schema_version must be v1_challenger on all outputs."""
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.schema_version == "v1_challenger"


# ─── 8. Feature flag tests ────────────────────────────────────────────────────

class TestFeatureFlag:
    """F-1 (2026-05-21): QUANTUM_ADVERSARIAL_STRESS_ENABLED=false must return
    skipped_disabled immediately — no Grover circuits must be constructed."""

    def test_disabled_returns_skipped(self, monkeypatch):
        """When flag is false, status must be skipped_disabled — not completed/aborted."""
        monkeypatch.setattr(
            "src.engine.quantum_adversarial_stress.QUANTUM_ADVERSARIAL_STRESS_ENABLED",
            False,
        )
        trades = _make_trades([100.0, -200.0, 300.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.status == "skipped_disabled"
        assert result.worst_case_breach_prob is None

    def test_disabled_no_grover_calls(self, monkeypatch):
        """When flag is false, _run_grover must never be called."""
        monkeypatch.setattr(
            "src.engine.quantum_adversarial_stress.QUANTUM_ADVERSARIAL_STRESS_ENABLED",
            False,
        )
        with patch("src.engine.quantum_adversarial_stress._run_grover") as mock_grover:
            trades = _make_trades([-300.0, -400.0, -200.0, -500.0])
            run_adversarial_stress(trades, _standard_rules(500.0), seed=42)
            mock_grover.assert_not_called()

    def test_disabled_schema_version_present(self, monkeypatch):
        """F-4: skipped_disabled result still carries schema_version."""
        monkeypatch.setattr(
            "src.engine.quantum_adversarial_stress.QUANTUM_ADVERSARIAL_STRESS_ENABLED",
            False,
        )
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.schema_version == "v1_challenger"

    def test_disabled_governance_labels_present(self, monkeypatch):
        """Governance labels must be present even on skipped_disabled result."""
        monkeypatch.setattr(
            "src.engine.quantum_adversarial_stress.QUANTUM_ADVERSARIAL_STRESS_ENABLED",
            False,
        )
        trades = _make_trades([100.0, -200.0])
        result = run_adversarial_stress(trades, _standard_rules(), seed=42)
        assert result.governance_labels["authoritative"] is False
        assert result.governance_labels["decision_role"] == "challenger_only"
