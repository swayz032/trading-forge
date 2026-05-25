"""test_firm_commissions_micro_mini.py — Wave 27.5 Pass D.2 (paper-parity)

Tests for firm_config.py FIRM_COMMISSIONS micro + mini coverage.

Coverage:
  - FIRM_COMMISSIONS has micro entries for all active symbols (MES/MNQ/MCL)
  - FIRM_COMMISSIONS has mini entries for Phase 5 symbols (ES/NQ/CL)
  - Topstep 2026 rates match canonical fee schedule (micro: $0.37, mini: $3.70)
  - MFFU 2026 rates match canonical fee schedule (micro: $0.62, mini: $6.20)
  - Mini rates are exactly 10× micro rates (10:1 contract ratio)
  - get_commission_per_side returns correct values for micro symbols
  - get_commission_per_side raises ValueError for unknown firm
  - get_commission_per_side raises ValueError for unknown symbol at known firm
  - Backward compat: existing micro-only call sites unaffected
"""

import pytest
from src.engine.firm_config import FIRM_COMMISSIONS, get_commission_per_side


# ─── FIRM_COMMISSIONS dict coverage ──────────────────────────────────────────

class TestFirmCommissionsDictCoverage:
    """Verify the FIRM_COMMISSIONS dict covers both micros and minis."""

    # Active micro symbols
    MICRO_SYMBOLS = ["MES", "MNQ", "MCL"]
    # Phase 5 mini symbols
    MINI_SYMBOLS = ["ES", "NQ", "CL"]
    # Firms in scope
    FIRMS = ["topstep_50k", "mffu_50k"]

    def test_all_firms_present(self):
        for firm in self.FIRMS:
            assert firm in FIRM_COMMISSIONS, f"Missing firm: {firm}"

    def test_micro_symbols_present_for_topstep(self):
        for sym in self.MICRO_SYMBOLS:
            assert sym in FIRM_COMMISSIONS["topstep_50k"], (
                f"topstep_50k missing micro symbol: {sym}"
            )

    def test_micro_symbols_present_for_mffu(self):
        for sym in self.MICRO_SYMBOLS:
            assert sym in FIRM_COMMISSIONS["mffu_50k"], (
                f"mffu_50k missing micro symbol: {sym}"
            )

    def test_mini_symbols_present_for_topstep(self):
        """Phase 5 symbols must be present for forward-compatibility."""
        for sym in self.MINI_SYMBOLS:
            assert sym in FIRM_COMMISSIONS["topstep_50k"], (
                f"topstep_50k missing Phase 5 mini symbol: {sym}"
            )

    def test_mini_symbols_present_for_mffu(self):
        for sym in self.MINI_SYMBOLS:
            assert sym in FIRM_COMMISSIONS["mffu_50k"], (
                f"mffu_50k missing Phase 5 mini symbol: {sym}"
            )


# ─── Canonical 2026 rate verification ────────────────────────────────────────

class TestCanonical2026Rates:
    """Verify rates match the 2026 published fee schedules."""

    def test_topstep_micro_rate_0_37(self):
        """Topstep micro rate = $0.37/side (verified 2026-05-25 Topstep fee schedule)."""
        for sym in ["MES", "MNQ", "MCL"]:
            assert FIRM_COMMISSIONS["topstep_50k"][sym] == pytest.approx(0.37), (
                f"topstep_50k {sym} micro rate should be $0.37"
            )

    def test_mffu_micro_rate_0_62(self):
        """MFFU micro rate = $0.62/side (verified 2026-05-25 MFFU fee schedule)."""
        for sym in ["MES", "MNQ", "MCL"]:
            assert FIRM_COMMISSIONS["mffu_50k"][sym] == pytest.approx(0.62), (
                f"mffu_50k {sym} micro rate should be $0.62"
            )

    def test_topstep_mini_rate_is_10x_micro(self):
        """Topstep mini rate = 10× micro = $3.70/side."""
        micro = FIRM_COMMISSIONS["topstep_50k"]["MES"]
        for sym in ["ES", "NQ", "CL"]:
            mini = FIRM_COMMISSIONS["topstep_50k"][sym]
            assert mini == pytest.approx(micro * 10, abs=1e-9), (
                f"topstep_50k {sym} mini rate {mini} should be 10× micro rate {micro}"
            )

    def test_mffu_mini_rate_is_10x_micro(self):
        """MFFU mini rate = 10× micro = $6.20/side."""
        micro = FIRM_COMMISSIONS["mffu_50k"]["MES"]
        for sym in ["ES", "NQ", "CL"]:
            mini = FIRM_COMMISSIONS["mffu_50k"][sym]
            assert mini == pytest.approx(micro * 10, abs=1e-9), (
                f"mffu_50k {sym} mini rate {mini} should be 10× micro rate {micro}"
            )

    def test_topstep_mini_rate_3_70(self):
        assert FIRM_COMMISSIONS["topstep_50k"]["ES"] == pytest.approx(3.70)

    def test_mffu_mini_rate_6_20(self):
        assert FIRM_COMMISSIONS["mffu_50k"]["ES"] == pytest.approx(6.20)


# ─── get_commission_per_side helper ──────────────────────────────────────────

class TestGetCommissionPerSide:
    """Tests for the public helper that wraps FIRM_COMMISSIONS lookup."""

    def test_topstep_mes(self):
        assert get_commission_per_side("topstep_50k", "MES") == pytest.approx(0.37)

    def test_mffu_mes(self):
        assert get_commission_per_side("mffu_50k", "MES") == pytest.approx(0.62)

    def test_topstep_es_mini_phase5(self):
        """Phase 5 mini symbol lookup returns 3.70 for Topstep."""
        assert get_commission_per_side("topstep_50k", "ES") == pytest.approx(3.70)

    def test_mffu_es_mini_phase5(self):
        """Phase 5 mini symbol lookup returns 6.20 for MFFU."""
        assert get_commission_per_side("mffu_50k", "ES") == pytest.approx(6.20)

    def test_unknown_firm_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown firm"):
            get_commission_per_side("unknown_firm_50k", "MES")

    def test_unknown_symbol_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown symbol"):
            get_commission_per_side("topstep_50k", "RTY")

    def test_backward_compat_micro_topstep_unchanged(self):
        """Existing micro-only call sites should not see any rate change."""
        # Pre-D.2 expectation: Topstep MES = 0.37
        result = get_commission_per_side("topstep_50k", "MES")
        assert result == pytest.approx(0.37), (
            "Backward compat broken: topstep_50k MES rate changed"
        )

    def test_backward_compat_micro_mffu_unchanged(self):
        """Existing micro-only call sites should not see any rate change."""
        result = get_commission_per_side("mffu_50k", "MES")
        assert result == pytest.approx(0.62), (
            "Backward compat broken: mffu_50k MES rate changed"
        )
