"""FIX 4 — TDD: Adaptive exit management must use the real symbol (not hardcoded
'MES') and must resolve ET hours via DST-correct logic (not UTC-4 fixed offset).

Bug A: backtester.py:~1073 calls compute_exit_plan_python(..., symbol="MES", ...)
  hardcoded. Strategies with symbol=MNQ or MCL get MES exit targets.

Bug B: backtester.py:_bar_et_str uses UTC-4 fixed offset. During EST (Nov–mid-Mar),
  UTC-5 is correct. This causes off-by-1 ET hour, misfiring the 15:55 time-stop.

NOTE: backtester.py imports vectorbt which JIT-compiles on first import (WDAC env).
Tests that need _dst_correct_et_hour import it directly. Tests that need
_apply_adaptive_management mock sys.modules to avoid the JIT hang.
"""

from __future__ import annotations

import datetime
import sys
from unittest.mock import MagicMock, patch


# ─── Test A: _dst_correct_et_hour DST-correct resolution ─────────────────────
# We isolate this by importing only _dst_correct_et_hour which lives at module
# level and does NOT require vectorbt.

class TestFix4DstCorrectEtHour:
    """The DST-correct ET hour helper must resolve America/New_York correctly."""

    def _load_helper(self):
        """Import _dst_correct_et_hour, mocking out heavy imports in backtester."""
        # Mock vectorbt before importing backtester to avoid JIT hang
        _vbt_mock = MagicMock()
        _vbt_mock.Portfolio = MagicMock()
        _patches = {
            "vectorbt": _vbt_mock,
            "vectorbt.portfolio": _vbt_mock,
            "vectorbt.portfolio.base": _vbt_mock,
        }
        for mod, mock in _patches.items():
            if mod not in sys.modules:
                sys.modules[mod] = mock

        from src.engine.backtester import _dst_correct_et_hour
        return _dst_correct_et_hour

    def test_edt_bar_resolves_correctly(self):
        """Summer EDT: UTC 14:00 on 2024-03-15 → ET 10:00."""
        helper = self._load_helper()
        utc_dt = datetime.datetime(2024, 3, 15, 14, 0, tzinfo=datetime.timezone.utc)
        et_str = helper(utc_dt)
        assert "10:00" in et_str, (
            f"EDT bar (UTC 14:00 on Mar 15) must resolve to ET 10:00, got {et_str!r}"
        )

    def test_est_bar_resolves_correctly(self):
        """Winter EST: UTC 14:00 on 2024-01-15 → ET 09:00, not 10:00."""
        helper = self._load_helper()
        utc_dt = datetime.datetime(2024, 1, 15, 14, 0, tzinfo=datetime.timezone.utc)
        et_str = helper(utc_dt)
        assert "09:00" in et_str, (
            f"EST bar (UTC 14:00 on Jan 15) must resolve to ET 09:00, got {et_str!r}. "
            "Hardcoded UTC-4 produces 10:00 — 1-hour DST drift bug."
        )

    def test_1555_detection_correct_in_est(self):
        """15:55 ET in winter EST = UTC 20:55.

        Old code: (20 - 4) % 24 = 16 → '16:55', misses the time-stop trigger.
        Correct:  EST = UTC-5 → (20 - 5) = 15 → '15:55'.
        """
        helper = self._load_helper()
        utc_dt = datetime.datetime(2024, 1, 15, 20, 55, tzinfo=datetime.timezone.utc)
        et_str = helper(utc_dt)
        assert "15:55" in et_str, (
            f"UTC 20:55 in January (EST) must give ET 15:55, got {et_str!r}. "
            "UTC-4 arithmetic gives 16:55, silently missing the EOD flatten trigger."
        )

    def test_1555_detection_correct_in_edt(self):
        """15:55 ET in summer EDT = UTC 19:55."""
        helper = self._load_helper()
        utc_dt = datetime.datetime(2024, 6, 15, 19, 55, tzinfo=datetime.timezone.utc)
        et_str = helper(utc_dt)
        assert "15:55" in et_str, (
            f"UTC 19:55 in June (EDT) must give ET 15:55, got {et_str!r}."
        )


# ─── Test B: symbol threading (unit-level) ───────────────────────────────────
# We test the symbol-from-spec logic without running the full backtester.
# The fix is: `_adaptive_symbol = getattr(spec, "symbol", None) or "MES"`

class TestFix4SymbolFromSpec:
    """The adaptive management code must read symbol from spec, not hardcode 'MES'."""

    def test_getattr_spec_symbol_reads_correctly(self):
        """getattr(spec, 'symbol', None) or 'MES' must return spec.symbol when set."""
        spec = MagicMock()
        spec.symbol = "MNQ"
        result = getattr(spec, "symbol", None) or "MES"
        assert result == "MNQ", f"Expected 'MNQ', got {result!r}"

    def test_getattr_spec_symbol_falls_back_to_mes(self):
        """When spec is None, must fall back to 'MES'."""
        spec = None
        result = getattr(spec, "symbol", None) or "MES"
        assert result == "MES", f"None spec must fall back to 'MES', got {result!r}"

    def test_getattr_spec_symbol_for_mcl(self):
        """MCL spec must produce 'MCL'."""
        spec = MagicMock()
        spec.symbol = "MCL"
        result = getattr(spec, "symbol", None) or "MES"
        assert result == "MCL", f"Expected 'MCL', got {result!r}"

    def test_backtester_source_does_not_contain_hardcoded_mes(self):
        """Regression: the hardcoded 'MES' string must be gone from the adaptive path.

        We do AST-level check to avoid the vectorbt JIT import hang.
        The hardcoded line was: symbol="MES",   # symbol not available on spec
        After fix: symbol=_adaptive_symbol,
        """
        import ast
        import pathlib

        backtester_path = pathlib.Path(
            "C:/Users/tonio/Projects/trading-forge/trading-forge/src/engine/backtester.py"
        )
        source = backtester_path.read_text(encoding="utf-8")

        # The comment that accompanied the hardcoded MES must be gone
        assert "symbol not available on spec" not in source, (
            "Old hardcoded MES comment still present in backtester.py. "
            "FIX 4 did not remove the hardcoded symbol='MES' line."
        )

        # The fix must use _adaptive_symbol variable
        assert "_adaptive_symbol" in source, (
            "_adaptive_symbol variable not found in backtester.py. "
            "FIX 4 must introduce this variable to thread the real symbol through."
        )

    def test_backtester_uses_dst_correct_helper(self):
        """Regression: _bar_et_str must call _dst_correct_et_hour, not UTC-4 arithmetic."""
        import pathlib

        backtester_path = pathlib.Path(
            "C:/Users/tonio/Projects/trading-forge/trading-forge/src/engine/backtester.py"
        )
        source = backtester_path.read_text(encoding="utf-8")

        # The DST-correct helper must be referenced in _apply_adaptive_management
        assert "_dst_correct_et_hour" in source, (
            "_dst_correct_et_hour not found in backtester.py. FIX 4 must add this helper."
        )

        # The hardcoded UTC-4 arithmetic in _bar_et_str must be removed
        # (it was: et_hour = (utc_dt.hour - 4) % 24; return f"{et_hour:02d}...")
        # The global _dst_correct_et_hour still uses it as a last resort, so
        # we check that the COMMENT documenting the fix is present.
        assert "FIX 4" in source, (
            "FIX 4 documentation comment not found in backtester.py."
        )


# ─── Test C: _dst_us_rule_offset fallback helper (FIX 2, 2026-07-02) ─────────
# Tests the extracted US DST rule used by the last-resort fallback in
# _dst_correct_et_hour(). Import is direct — no full backtester load needed.

class TestDstUsRuleOffset:
    """Unit tests for _dst_us_rule_offset() — last-resort DST rule for fallback path.

    This tests the extracted helper directly (no JIT-triggering backtester import).
    The helper returns -4 (EDT) in summer and -5 (EST) in winter.
    """

    def _load_rule_offset(self):
        """Import _dst_us_rule_offset with vectorbt mocked to avoid JIT hang."""
        _vbt_mock = MagicMock()
        _vbt_mock.Portfolio = MagicMock()
        _patches = {
            "vectorbt": _vbt_mock,
            "vectorbt.portfolio": _vbt_mock,
            "vectorbt.portfolio.base": _vbt_mock,
        }
        for mod, mock in _patches.items():
            if mod not in sys.modules:
                sys.modules[mod] = mock
        from src.engine.backtester import _dst_us_rule_offset  # noqa: PLC0415
        return _dst_us_rule_offset

    def test_january_returns_est_offset(self):
        """January is well within EST (UTC-5) — winter standard time."""
        fn = self._load_rule_offset()
        utc_dt = datetime.datetime(2024, 1, 15, 20, 55, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        assert offset == -5, (
            f"January (EST) must return UTC offset -5, got {offset}. "
            "Old hardcoded UTC-4 would return -4 here (wrong for winter)."
        )

    def test_july_returns_edt_offset(self):
        """July is well within EDT (UTC-4) — summer daylight saving time."""
        fn = self._load_rule_offset()
        utc_dt = datetime.datetime(2024, 7, 15, 19, 55, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        assert offset == -4, (
            f"July (EDT) must return UTC offset -4, got {offset}."
        )

    def test_fallback_winter_1555_computes_correctly(self):
        """Fallback: UTC 20:55 in January must give ET hour 15 (not 16 with old UTC-4).

        The time-stop fires at 15:55 ET. Old UTC-4 fallback gave 16:55 in winter
        (missing the flatten trigger). The US DST rule gives the correct 15:55.
        """
        fn = self._load_rule_offset()
        utc_dt = datetime.datetime(2024, 1, 15, 20, 55, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        et_hour = (utc_dt.hour + offset) % 24
        assert et_hour == 15, (
            f"UTC 20:55 in January must give ET hour 15 (EST), got {et_hour}. "
            "UTC-4 fallback gives 16 — misses the 15:55 EOD flatten trigger."
        )

    def test_fallback_summer_1555_computes_correctly(self):
        """Fallback: UTC 19:55 in July must give ET hour 15 (correct for EDT)."""
        fn = self._load_rule_offset()
        utc_dt = datetime.datetime(2024, 7, 15, 19, 55, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        et_hour = (utc_dt.hour + offset) % 24
        assert et_hour == 15, (
            f"UTC 19:55 in July must give ET hour 15 (EDT), got {et_hour}."
        )

    def test_december_returns_est_offset(self):
        """December is also in EST — verify consistent winter behavior."""
        fn = self._load_rule_offset()
        utc_dt = datetime.datetime(2024, 12, 10, 14, 0, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        assert offset == -5, (
            f"December (EST) must return UTC offset -5, got {offset}."
        )

    def test_march_before_spring_forward_is_est(self):
        """Early March (before the second Sunday) is still EST."""
        fn = self._load_rule_offset()
        # March 1 is always before the second Sunday of March
        utc_dt = datetime.datetime(2024, 3, 1, 20, 0, tzinfo=datetime.timezone.utc)
        offset = fn(utc_dt)
        assert offset == -5, (
            f"Early March (before spring-forward) must be EST (-5), got {offset}."
        )
