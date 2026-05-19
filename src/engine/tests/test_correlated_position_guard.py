"""
Correlated Position Guard — Tier 5.3.1 (W5b)
Tests for compliance_gate.check_correlated_position_guard()

Coverage:
  1. MNQ open + try MES → BLOCKED (correlation 0.95 > 0.70)
  2. MNQ open + try MCL → ALLOWED (correlation 0.18 < 0.70)
  3. Sequential: close MNQ, then enter MES → ALLOWED (empty open_positions)
  4. Empty open_positions → guard NEVER blocks (first trade)
  5. Symmetry: MNQ→MES and MES→MNQ produce identical decisions
  6. Unknown pair → defaults to 0.0 (ALLOWED)
  7. Same-symbol open → not a correlation block
  8. Custom threshold via matrix override
  9. KILL_REASON_CORRELATED_POSITION_OPEN constant value
"""

import pytest
from src.engine.compliance.compliance_gate import (
    check_correlated_position_guard,
    KILL_REASON_CORRELATED_POSITION_OPEN,
    _pair_key,
)


# ─── Fixtures ──────────────────────────────────────────────────────────────────

STANDARD_MATRIX = {
    "correlations": {
        "MES_MNQ": 0.95,
        "MES_MYM": 0.92,
        "MNQ_MYM": 0.88,
        "MNQ_M2K": 0.85,
        "MES_M2K": 0.83,
        "MCL_MGC": 0.45,
        "MCL_MES": 0.22,
        "MCL_MNQ": 0.18,
        "MCL_M6E": 0.30,
        "MGC_MES": 0.15,
        "MGC_M6E": 0.35,
        "M6E_MES": 0.12,
        "M6E_MNQ": 0.10,
    },
    "threshold": 0.70,
}


# ─── _pair_key() helper ────────────────────────────────────────────────────────

class TestPairKey:
    def test_symmetric(self):
        assert _pair_key("MNQ", "MES") == _pair_key("MES", "MNQ")

    def test_lexicographic_order(self):
        assert _pair_key("MNQ", "MES") == "MES_MNQ"
        assert _pair_key("MES", "MNQ") == "MES_MNQ"

    def test_uppercase_normalisation(self):
        assert _pair_key("mnq", "mes") == "MES_MNQ"
        assert _pair_key("Mes", "MNQ") == "MES_MNQ"


# ─── Blocking cases ───────────────────────────────────────────────────────────

class TestCorrelatedPositionGuardBlocking:
    def test_mnq_open_blocks_mes(self):
        result = check_correlated_position_guard(
            "MES", [{"symbol": "MNQ"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is False
        assert result["reason"] == KILL_REASON_CORRELATED_POSITION_OPEN
        assert result["blocking_symbol"] == "MNQ"
        assert abs(result["blocking_correlation"] - 0.95) < 0.001
        assert result["threshold"] == 0.70

    def test_mes_open_blocks_mnq_symmetry(self):
        result = check_correlated_position_guard(
            "MNQ", [{"symbol": "MES"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is False
        assert result["blocking_symbol"] == "MES"
        assert abs(result["blocking_correlation"] - 0.95) < 0.001

    def test_mym_open_blocks_mes(self):
        result = check_correlated_position_guard(
            "MES", [{"symbol": "MYM"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is False
        assert abs(result["blocking_correlation"] - 0.92) < 0.001

    def test_first_correlated_position_wins_in_list(self):
        # MCL is 0.22 (allowed), MNQ is 0.95 (blocked) — MNQ should block
        result = check_correlated_position_guard(
            "MES",
            [{"symbol": "MCL"}, {"symbol": "MNQ"}],
            correlation_matrix=STANDARD_MATRIX,
        )
        assert result["allowed"] is False
        assert result["blocking_symbol"] == "MNQ"


# ─── Allowed cases ────────────────────────────────────────────────────────────

class TestCorrelatedPositionGuardAllowed:
    def test_mnq_open_allows_mcl(self):
        result = check_correlated_position_guard(
            "MCL", [{"symbol": "MNQ"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True
        assert result["reason"] is None
        assert result["blocking_symbol"] is None

    def test_mes_open_allows_mcl(self):
        result = check_correlated_position_guard(
            "MCL", [{"symbol": "MES"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True

    def test_empty_open_positions_always_allowed(self):
        result = check_correlated_position_guard(
            "MES", [], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True
        assert result["reason"] is None

    def test_same_symbol_not_blocked(self):
        # Same-symbol concurrency handled by a different guard
        result = check_correlated_position_guard(
            "MES", [{"symbol": "MES"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True

    def test_unknown_pair_defaults_to_zero_allowed(self):
        result = check_correlated_position_guard(
            "FAKE1", [{"symbol": "FAKE2"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True


# ─── Sequential test ──────────────────────────────────────────────────────────

class TestSequentialEntry:
    def test_allowed_after_mnq_closed(self):
        """Close MNQ → empty open_positions → MES allowed."""
        result = check_correlated_position_guard(
            "MES", [], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True

    def test_blocked_while_mnq_still_open(self):
        result = check_correlated_position_guard(
            "MES", [{"symbol": "MNQ"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is False


# ─── Symmetry guarantee ───────────────────────────────────────────────────────

class TestSymmetry:
    def test_mnq_mes_and_mes_mnq_identical(self):
        r1 = check_correlated_position_guard("MES", [{"symbol": "MNQ"}], correlation_matrix=STANDARD_MATRIX)
        r2 = check_correlated_position_guard("MNQ", [{"symbol": "MES"}], correlation_matrix=STANDARD_MATRIX)
        assert r1["allowed"] == r2["allowed"]
        assert abs(r1["blocking_correlation"] - r2["blocking_correlation"]) < 0.0001

    def test_mcl_mnq_both_allowed(self):
        r1 = check_correlated_position_guard("MCL", [{"symbol": "MNQ"}], correlation_matrix=STANDARD_MATRIX)
        r2 = check_correlated_position_guard("MNQ", [{"symbol": "MCL"}], correlation_matrix=STANDARD_MATRIX)
        assert r1["allowed"] is True
        assert r2["allowed"] is True


# ─── Custom threshold ─────────────────────────────────────────────────────────

class TestCustomThreshold:
    def test_strict_threshold_blocks_mcl_mgc(self):
        strict = {**STANDARD_MATRIX, "threshold": 0.40}
        result = check_correlated_position_guard(
            "MCL", [{"symbol": "MGC"}], correlation_matrix=strict
        )
        assert result["allowed"] is False
        assert abs(result["blocking_correlation"] - 0.45) < 0.001

    def test_default_threshold_allows_mcl_mgc(self):
        result = check_correlated_position_guard(
            "MCL", [{"symbol": "MGC"}], correlation_matrix=STANDARD_MATRIX
        )
        assert result["allowed"] is True


# ─── Constant ─────────────────────────────────────────────────────────────────

def test_kill_reason_constant():
    assert KILL_REASON_CORRELATED_POSITION_OPEN == "correlated_position_open"
