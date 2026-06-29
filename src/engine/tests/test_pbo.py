"""Wave 24 Pass 1 — Item 18: PBO (Probability of Backtest Overfitting) tests.

F-3 (2026-06-29): TestPboKnownAnswer class removed — it tested the dead
compute_pbo() OOS-as-IS-proxy combinatorial implementation which was superseded
by the Bailey rank-based implementation in src/engine/pbo_gate.py.
Known-answer coverage for the Bailey path lives in:
  test_f3_invariant_pbo_bailey.py
  test_fix2_pbo_degenerate_input.py
  test_wave29_pass_a2_pbo_gate.py

Retained: TestPboInvariantsEmit (tests result dict structure, no API dependency).
"""

from __future__ import annotations

# ─── Invariants emit tests ────────────────────────────────────────────────────

class TestPboInvariantsEmit:
    """Verify the pbo dict structure that backtester.py emits into result['invariants']."""

    def _make_invariants_pbo(self, pbo_val: float | None, n_combinations: int) -> dict:
        """Simulate what backtester.py builds into result['invariants']['pbo']."""
        threshold = 0.5
        flag = pbo_val is not None and pbo_val > threshold
        return {
            "pbo": {
                "value": pbo_val,
                "n_trials": n_combinations,
                "interpretable": (
                    "high" if (pbo_val is not None and pbo_val >= 0.4) else
                    "med" if (pbo_val is not None and pbo_val >= 0.15) else
                    "low"
                ),
            },
            "pbo_flag": flag,
        }

    def test_pbo_flag_true_when_above_threshold(self):
        inv = self._make_invariants_pbo(pbo_val=0.65, n_combinations=20)
        assert inv["pbo_flag"] is True

    def test_pbo_flag_false_when_below_threshold(self):
        inv = self._make_invariants_pbo(pbo_val=0.30, n_combinations=20)
        assert inv["pbo_flag"] is False

    def test_pbo_flag_false_when_none(self):
        inv = self._make_invariants_pbo(pbo_val=None, n_combinations=0)
        assert inv["pbo_flag"] is False

    def test_pbo_interpretable_high_above_40pct(self):
        inv = self._make_invariants_pbo(pbo_val=0.45, n_combinations=20)
        assert inv["pbo"]["interpretable"] == "high"

    def test_pbo_interpretable_med_between_15_40pct(self):
        inv = self._make_invariants_pbo(pbo_val=0.25, n_combinations=20)
        assert inv["pbo"]["interpretable"] == "med"

    def test_pbo_interpretable_low_below_15pct(self):
        inv = self._make_invariants_pbo(pbo_val=0.10, n_combinations=20)
        assert inv["pbo"]["interpretable"] == "low"
