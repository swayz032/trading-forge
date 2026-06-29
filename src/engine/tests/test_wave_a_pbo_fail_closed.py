"""FIX 2 regression: PBO computation failure must fail-CLOSED (pbo_pass=False).

F-3 (2026-06-29): TestPboFailClosed removed — it patched and imported
risk_metrics.compute_pbo which no longer exists (replaced by Bailey rank-based
implementation in pbo_gate.compute_pbo_from_cpcv_paths).

Exception-path behavior for the Bailey PBO block in walk_forward.py:
  - Exception in compute_pbo_from_cpcv_paths → pbo_gate_result = None
  - pbo_pass = None (TS gate treats null as fail-closed by convention)
  - No audit action emitted for exceptions (logged to stderr)

New exception coverage lives in: test_f3_invariant_pbo_bailey.py
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest

sys.modules.setdefault("vectorbt", MagicMock())


# ── F-3 tombstone — all tests in this class were removed ─────────────────────

class TestPboFailClosed:
    """F-3 (2026-06-29): compute_pbo() removed; tests superseded."""

    @pytest.mark.skip(reason="F-3: compute_pbo removed; exception-path tests superseded by test_f3_invariant_pbo_bailey.py")
    def test_pbo_exception_sets_pbo_pass_false(self):
        pass  # superseded

    @pytest.mark.skip(reason="F-3: compute_pbo removed")
    def test_pbo_exception_emits_audit_action(self):
        pass  # superseded

    @pytest.mark.skip(reason="F-3: compute_pbo removed")
    def test_pbo_exception_sets_worst_case_pbo_value(self):
        pass  # superseded

    @pytest.mark.skip(reason="F-3: compute_pbo removed")
    def test_pbo_exception_records_error_type(self):
        pass  # superseded

    @pytest.mark.skip(reason="F-3: compute_pbo removed")
    def test_pbo_success_path_still_sets_pbo_pass_true_when_below_threshold(self):
        pass  # superseded
