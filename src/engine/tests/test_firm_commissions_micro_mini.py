"""test_firm_commissions_micro_mini.py — Wave 27.5 Pass D.2 (paper-parity)

Tests for firm_config.py FIRM_COMMISSIONS micro + mini coverage.

Coverage:
  - FIRM_COMMISSIONS has micro entries for all active symbols (MES/MNQ/MCL)
  - FIRM_COMMISSIONS has mini entries for Phase 5 symbols (ES/NQ/CL)
  - Topstep 2026 rates match the CORRECTED canonical fee schedule (2026-06-23
    correction in firm_config.py: TopstepX/ProjectX all-in-per-side round-turn÷2
    schedule — MES/MNQ $0.62, MCL $0.77, ES/NQ $1.90, CL $2.02). The original
    $0.37 flat rate was under-costed and has been replaced.
  - MFFU 2026 rates match the CORRECTED canonical fee schedule (MES/MNQ $0.95,
    MCL $0.58, ES/NQ $2.34, CL $2.46). The original flat $0.62 rate was wrong
    (that was TopstepX's MES value, not MFFU's).
  - Mini rates are NOT a flat 10× micro multiplier — commissions don't scale
    with notional. Actual ratios are per-symbol (~3.06× for ES/MES on Topstep,
    ~2.62× for CL/MCL on Topstep) per the firm_config.py 2026-06-23 correction.
  - get_commission_per_side returns correct values for micro symbols
  - get_commission_per_side raises ValueError for unknown firm
  - get_commission_per_side raises ValueError for unknown symbol at known firm
  - Canonical values are stable across repeated lookups (no per-call drift)

FIX 3 (ds21, Deep-Scan #21 Python test-integrity cluster): this file asserted
the PRE-correction ($0.37 Topstep flat / $0.62 MFFU flat / mini=10×micro)
values. Production was corrected 2026-06-23 (see firm_config.py:21-44) to the
per-symbol authoritative fee schedule. Fixtures below were updated to match
current production; firm_config.py itself was NOT modified.
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

    def test_topstep_micro_rates_2026_corrected(self):
        """Topstep micro rates per-symbol (2026-06-23 TopstepX/ProjectX correction).

        Not a flat rate: MES/MNQ share $0.62 (RT $1.24 ÷ 2), MCL is $0.77
        (RT $1.54 ÷ 2). The old flat $0.37 assumption under-costed every
        Topstep backtest and has been replaced.
        """
        assert FIRM_COMMISSIONS["topstep_50k"]["MES"] == pytest.approx(0.62)
        assert FIRM_COMMISSIONS["topstep_50k"]["MNQ"] == pytest.approx(0.62)
        assert FIRM_COMMISSIONS["topstep_50k"]["MCL"] == pytest.approx(0.77)

    def test_mffu_micro_rates_2026_corrected(self):
        """MFFU micro rates per-symbol (2026-06-23 correction).

        Not a flat rate: MES/MNQ share $0.95 (RT $1.90 ÷ 2), MCL is $0.58
        (RT $1.16 ÷ 2). The old flat $0.62 value was actually TopstepX's MES
        rate, not MFFU's, and has been replaced.
        """
        assert FIRM_COMMISSIONS["mffu_50k"]["MES"] == pytest.approx(0.95)
        assert FIRM_COMMISSIONS["mffu_50k"]["MNQ"] == pytest.approx(0.95)
        assert FIRM_COMMISSIONS["mffu_50k"]["MCL"] == pytest.approx(0.58)

    def test_topstep_mini_rate_is_not_10x_micro(self):
        """Topstep mini rate is NOT a flat 10× micro multiplier.

        Commissions don't scale with notional (firm_config.py:24-26). ES/MES
        ratio is ~3.06×, CL/MCL ratio is ~2.62× — both far from 10×, and the
        two ratios differ from each other (per-symbol schedule, not a formula).
        """
        es_ratio = FIRM_COMMISSIONS["topstep_50k"]["ES"] / FIRM_COMMISSIONS["topstep_50k"]["MES"]
        cl_ratio = FIRM_COMMISSIONS["topstep_50k"]["CL"] / FIRM_COMMISSIONS["topstep_50k"]["MCL"]
        assert es_ratio == pytest.approx(3.0645, abs=1e-3), (
            f"topstep_50k ES/MES ratio {es_ratio} should be ~3.06x, not 10x"
        )
        assert cl_ratio == pytest.approx(2.6234, abs=1e-3), (
            f"topstep_50k CL/MCL ratio {cl_ratio} should be ~2.62x, not 10x"
        )
        assert es_ratio != pytest.approx(10.0, abs=0.5)

    def test_mffu_mini_rate_is_not_10x_micro(self):
        """MFFU mini rate is NOT a flat 10× micro multiplier (same rationale)."""
        es_ratio = FIRM_COMMISSIONS["mffu_50k"]["ES"] / FIRM_COMMISSIONS["mffu_50k"]["MES"]
        cl_ratio = FIRM_COMMISSIONS["mffu_50k"]["CL"] / FIRM_COMMISSIONS["mffu_50k"]["MCL"]
        assert es_ratio == pytest.approx(2.4632, abs=1e-3), (
            f"mffu_50k ES/MES ratio {es_ratio} should be ~2.46x, not 10x"
        )
        assert cl_ratio == pytest.approx(4.2414, abs=1e-3), (
            f"mffu_50k CL/MCL ratio {cl_ratio} should be ~4.24x, not 10x"
        )
        assert es_ratio != pytest.approx(10.0, abs=0.5)

    def test_topstep_mini_rate_1_90(self):
        assert FIRM_COMMISSIONS["topstep_50k"]["ES"] == pytest.approx(1.90)

    def test_mffu_mini_rate_2_34(self):
        assert FIRM_COMMISSIONS["mffu_50k"]["ES"] == pytest.approx(2.34)


# ─── get_commission_per_side helper ──────────────────────────────────────────

class TestGetCommissionPerSide:
    """Tests for the public helper that wraps FIRM_COMMISSIONS lookup."""

    def test_topstep_mes(self):
        assert get_commission_per_side("topstep_50k", "MES") == pytest.approx(0.62)

    def test_mffu_mes(self):
        assert get_commission_per_side("mffu_50k", "MES") == pytest.approx(0.95)

    def test_topstep_es_mini_phase5(self):
        """Phase 5 mini symbol lookup returns 1.90 for Topstep."""
        assert get_commission_per_side("topstep_50k", "ES") == pytest.approx(1.90)

    def test_mffu_es_mini_phase5(self):
        """Phase 5 mini symbol lookup returns 2.34 for MFFU."""
        assert get_commission_per_side("mffu_50k", "ES") == pytest.approx(2.34)

    def test_unknown_firm_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown firm"):
            get_commission_per_side("unknown_firm_50k", "MES")

    def test_unknown_symbol_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown symbol"):
            get_commission_per_side("topstep_50k", "RTY")

    def test_micro_topstep_stable_across_lookups(self):
        """Repeated lookups return the same canonical value (no per-call drift).

        FIX 3 (ds21): this used to assert the PRE-2026-06-23-correction value
        ($0.37) under a "backward compat" framing. The 2026-06-23 correction
        was an intentional breaking change (the old rate under-costed every
        Topstep backtest) — there is no backward-compat contract to preserve
        here, only stability of the corrected canonical value.
        """
        result = get_commission_per_side("topstep_50k", "MES")
        assert result == pytest.approx(0.62)
        assert get_commission_per_side("topstep_50k", "MES") == result

    def test_micro_mffu_stable_across_lookups(self):
        """Repeated lookups return the same canonical value (no per-call drift)."""
        result = get_commission_per_side("mffu_50k", "MES")
        assert result == pytest.approx(0.95)
        assert get_commission_per_side("mffu_50k", "MES") == result
