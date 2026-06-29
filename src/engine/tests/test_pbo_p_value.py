"""Tests for pbo_p_value real computation — Pass B carry-forward (Wave 27.5 Pass D.4).

F-3 (2026-06-29): TestComputePboPValue class removed — it tested the dead
compute_pbo() OOS-as-IS-proxy API (which emitted "pbo_p_value").  The Bailey
implementation in pbo_gate.compute_pbo_from_cpcv_paths emits "p_value" (no prefix).

TestBinomialTestLogic retained — it tests scipy.stats.binomtest directly and
has no dependency on the removed function.
"""

from __future__ import annotations

# ─── Binomial test direct tests ──────────────────────────────────────────────

class TestBinomialTestLogic:
    """Verify the underlying statistical logic of pbo_p_value."""

    def test_binomtest_available(self):
        """scipy.stats.binomtest must be importable."""
        from scipy.stats import binomtest
        assert callable(binomtest)

    def test_binomtest_pbo_05_n100_large_pvalue(self):
        """Directly test: binomtest(50, 100, 0.5) → p_value should be 1.0 (exact null)."""
        from scipy.stats import binomtest
        result = binomtest(50, 100, p=0.5)
        # k=50 out of n=100 → exactly the null → p_value should be 1.0
        assert result.pvalue > 0.9, f"Expected p_value near 1.0, got {result.pvalue}"

    def test_binomtest_pbo_08_n100_small_pvalue(self):
        """binomtest(80, 100, 0.5) → p_value << 0.001 (strong departure)."""
        from scipy.stats import binomtest
        result = binomtest(80, 100, p=0.5)
        assert result.pvalue < 0.001, f"Expected tiny p_value, got {result.pvalue}"

    def test_binomtest_pbo_02_n100_small_pvalue(self):
        """binomtest(20, 100, 0.5) → p_value << 0.001 (symmetric — not-overfit signal)."""
        from scipy.stats import binomtest
        result = binomtest(20, 100, p=0.5)
        assert result.pvalue < 0.001, f"Expected tiny p_value, got {result.pvalue}"
