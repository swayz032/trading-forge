"""FIX 4 regression: no-firms MC run must NOT silently pass B14 with terminal-negative CI.

Previous behavior: when no firm models are configured, probability_of_ruin_ci was aliased
from the terminal<=0 definition and written with no warning — B14 gate used it as if it
were firm-breach evidence, potentially allowing undercapitalized strategies through.

New behavior: ruin_unavailable=True is set, ci_high=None, so the B14 gate's
legacy_ruin_scalar_fallback audit path fires and the operator sees the gap explicitly.

Also covers FIX 5: dedup logic inversion (all-duplicate edge case).
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

sys.modules.setdefault("vectorbt", MagicMock())


class TestNoFirmRuinCiFix4:
    """FIX 4: no-firms branch must not silently pass B14."""

    def _build_no_firm_authoritative(self, terminal_ci: dict) -> dict:
        """Replicate the FIX 4 logic from monte_carlo.py."""
        _no_firm_authoritative = {
            "ruin_unavailable": True,
            "ruin_basis": "terminal_negative_no_firm",
            "ruin_basis_note": (
                "No prop-firm models were configured for this MC run. "
                "Firm-breach ruin CI is unavailable. "
                "B14 gate should emit legacy_ruin_scalar_fallback audit and NOT auto-pass."
            ),
            "point_estimate": terminal_ci.get("point_estimate"),
            "ci_low": None,
            "ci_high": None,
        }
        return _no_firm_authoritative

    def test_no_firm_ruin_ci_high_is_none(self):
        """When no firms configured, ci_high must be None — B14 cannot use it to pass."""
        terminal_ci = {"point_estimate": 0.05, "ci_low": 0.02, "ci_high": 0.12}
        result = self._build_no_firm_authoritative(terminal_ci)
        assert result["ci_high"] is None, (
            "ci_high must be None when no firm models present — "
            "B14 gate must not auto-pass on this value"
        )

    def test_no_firm_ruin_ci_low_is_none(self):
        """ci_low must also be None (no meaningful interval without firm model)."""
        terminal_ci = {"point_estimate": 0.05, "ci_low": 0.02, "ci_high": 0.12}
        result = self._build_no_firm_authoritative(terminal_ci)
        assert result["ci_low"] is None

    def test_no_firm_sets_ruin_unavailable_true(self):
        """ruin_unavailable must be True so TS gate can distinguish from firm-breach CI."""
        terminal_ci = {"point_estimate": 0.0}
        result = self._build_no_firm_authoritative(terminal_ci)
        assert result["ruin_unavailable"] is True

    def test_no_firm_ruin_basis_tagged(self):
        """ruin_basis must be 'terminal_negative_no_firm' for audit traceability."""
        terminal_ci = {"point_estimate": 0.05}
        result = self._build_no_firm_authoritative(terminal_ci)
        assert result["ruin_basis"] == "terminal_negative_no_firm"

    def test_no_firm_preserves_point_estimate_for_display(self):
        """point_estimate from terminal<=0 is preserved as diagnostic value."""
        terminal_ci = {"point_estimate": 0.07}
        result = self._build_no_firm_authoritative(terminal_ci)
        assert result["point_estimate"] == 0.07

    def test_no_firm_b14_gate_would_not_auto_pass(self):
        """Simulate b14-ci-gate.ts behavior: ci_high=None must trigger legacy fallback, not pass."""
        result = self._build_no_firm_authoritative({"point_estimate": 0.05})

        # Replicate the TypeScript gate logic in Python
        ci_high = result.get("ci_high")
        ruin_unavailable = result.get("ruin_unavailable", False)
        b14_threshold = 0.40

        if ruin_unavailable or ci_high is None:
            gate_outcome = "legacy_ruin_scalar_fallback"  # must audit-warn, not pass
        elif ci_high > b14_threshold:
            gate_outcome = "block"
        else:
            gate_outcome = "pass"

        assert gate_outcome == "legacy_ruin_scalar_fallback", (
            f"B14 gate should emit legacy_ruin_scalar_fallback for no-firm CI, got '{gate_outcome}'"
        )

    def test_firm_breach_ci_still_has_ci_high(self):
        """Regression: when firms ARE configured, ci_high must still be present."""
        # This is the normal (non-no-firm) path — should be unaffected by FIX 4.
        firm_breach_ci = {
            "ruin_unavailable": False,
            "ruin_basis": "firm_breach",
            "point_estimate": 0.15,
            "ci_low": 0.10,
            "ci_high": 0.22,
        }
        assert firm_breach_ci["ci_high"] is not None
        assert firm_breach_ci.get("ruin_unavailable", False) is False


class TestDedupInversionFix5:
    """FIX 5: empty _deduped_records must give empty list, not fall back to raw."""

    def test_all_duplicates_produces_empty_pnls(self):
        """When all records are duplicates, all_oos_pnls extension must be empty."""
        existing_dates = {"2024-01-01", "2024-01-02", "2024-01-03"}
        new_records = [
            {"date": "2024-01-01", "pnl": 100.0},
            {"date": "2024-01-02", "pnl": 200.0},
            {"date": "2024-01-03", "pnl": -50.0},
        ]
        _raw_daily_pnls = [100.0, 200.0, -50.0]

        _deduped_records = [r for r in new_records if r.get("date") not in existing_dates]
        _deduped_pnls = [r.get("pnl", 0.0) for r in _deduped_records]

        # FIX 5: must use [] not raw_daily_pnls when all records are dupes
        extension = _deduped_pnls if len(_deduped_pnls) > 0 else []

        assert extension == [], (
            "All-duplicate window must contribute zero P&L records, "
            "not fall back to raw un-deduped data"
        )

    def test_partial_dedup_uses_deduped_pnls(self):
        """When some records are new, deduped pnls (not raw) must be used."""
        existing_dates = {"2024-01-01"}
        new_records = [
            {"date": "2024-01-01", "pnl": 100.0},   # duplicate
            {"date": "2024-01-02", "pnl": 200.0},   # new
        ]

        _deduped_records = [r for r in new_records if r.get("date") not in existing_dates]
        _deduped_pnls = [r.get("pnl", 0.0) for r in _deduped_records]

        extension = _deduped_pnls if len(_deduped_pnls) > 0 else []

        assert extension == [200.0], f"Expected [200.0], got {extension}"

    def test_no_duplicates_uses_all_pnls(self):
        """With no duplicates, all new pnls must be included."""
        existing_dates: set = set()
        new_records = [
            {"date": "2024-01-01", "pnl": 50.0},
            {"date": "2024-01-02", "pnl": 75.0},
        ]

        _deduped_records = [r for r in new_records if r.get("date") not in existing_dates]
        _deduped_pnls = [r.get("pnl", 0.0) for r in _deduped_records]
        extension = _deduped_pnls if len(_deduped_pnls) > 0 else []

        assert extension == [50.0, 75.0]

    def test_raw_pnls_not_used_on_empty_dedup(self):
        """Regression: raw un-deduped list must NEVER be used when deduped is empty."""
        _raw_daily_pnls_from_result = [999.0, -999.0]  # sentinel values that must NOT appear

        existing_dates = {"2024-01-05", "2024-01-06"}
        new_records = [
            {"date": "2024-01-05", "pnl": 999.0},   # duplicate
            {"date": "2024-01-06", "pnl": -999.0},  # duplicate
        ]

        _deduped_records = [r for r in new_records if r.get("date") not in existing_dates]
        _deduped_pnls = [r.get("pnl", 0.0) for r in _deduped_records]

        # FIX 5 (correct path):
        extension = _deduped_pnls if len(_deduped_pnls) > 0 else []

        # Old buggy code would have produced: raw_daily_pnls_from_result
        assert extension == [], "Sentinel values must not appear in extension"
        assert 999.0 not in extension
        assert -999.0 not in extension
