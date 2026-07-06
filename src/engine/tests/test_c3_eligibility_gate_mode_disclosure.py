"""C-3 fix regression tests — eligibility gate mode disclosure (deep-scan #18c,
2026-07-05).

FINDING: apply_eligibility_gate() computes gate_stats["mode"] (one of
source_entry_only / passthrough_htf_unavailable / passthrough_strategy_unregistered
/ tf_institutional_overlay) + gate_stats["passthrough_reason"], but the MAIN
backtest path (run_backtest() in backtester.py) captured the per-side gate_stats
returned from apply_eligibility_gate() ONLY to extract "structural_stop_map" —
"mode" was computed and then silently discarded before it ever reached the
persisted backtest result. A strategy transitioning from
passthrough_strategy_unregistered -> tf_institutional_overlay (e.g. after being
added to playbook_router.ALL_STRATS, as the H-1 multi-TF expansion did for 42
strategies) therefore produced NO queryable record distinguishing the two runs
on the backtests row — prior passthrough backtests were silently
non-comparable to new gated ones.

FIX: a new pure helper, _build_eligibility_gate_mode_disclosure(), assembles
{"long": <mode>, "long_passthrough_reason": <str|None>, "short": <mode>,
 "short_passthrough_reason": <str|None>} from the raw long/short gate_stats
blobs. run_backtest() calls it once after the eligibility-gate block and
writes the result into result["eligibility_gate_mode"] (additive key).
backtest-service.ts::buildResultExtras() persists it into
backtests.result_extras JSONB via the extraKeys allowlist.

These tests pin:
  1. apply_eligibility_gate() sets mode="tf_institutional_overlay" for a
     strategy registered in playbook_router.ALL_STRATS (with htf_cache
     available) — even with zero entry signals, proving the mode stamp
     happens unconditionally on the "gate genuinely ran" path, not only when
     signals are present.
  2. apply_eligibility_gate() sets mode="passthrough_strategy_unregistered"
     for a strategy NOT in ALL_STRATS, with the human-readable
     passthrough_reason naming the strategy.
  3. _build_eligibility_gate_mode_disclosure() end-to-end: feeding the raw
     gate_stats from (1) and (2) into the helper reproduces exactly what
     run_backtest() would persist to result["eligibility_gate_mode"] — this
     is the "surfacing" logic under test, exercised without invoking the
     full vectorbt-backed run_backtest() (bare backtester.py import is fast;
     see test_h5_structural_stop_parity.py header for the historical vectorbt
     import-hang caveat and why it does not apply to gate-level helpers).
  4. Schema stability: None inputs (gate never ran on that side) produce an
     all-None disclosure dict rather than raising.
  5. Asymmetric long/short disclosure: when long is gated
     (tf_institutional_overlay) and short is passthrough
     (passthrough_strategy_unregistered), both are recorded distinctly in the
     same disclosure dict — proving the fix does not collapse per-side signal.
"""
from __future__ import annotations

import os

import numpy as np
import polars as pl

# Allow fixed_contracts=1 in test configs (repo-wide test convention).
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


def _flat_df(n: int = 10) -> pl.DataFrame:
    """Minimal DataFrame satisfying apply_eligibility_gate()'s column reads
    for the early-return paths under test (close + atr_14 only — no signal
    ever reaches compute_structural_stop / compute_targets in these tests
    because entries are all False or the gate returns before that point)."""
    return pl.DataFrame({
        "close": [4400.0 + i for i in range(n)],
        "atr_14": [4.0] * n,
    })


# ──────────────────────────────────────────────────────────────────────────────
# 1 + 2. apply_eligibility_gate() mode stamping — registered vs unregistered
# ──────────────────────────────────────────────────────────────────────────────

class TestApplyEligibilityGateModeStamping:
    def test_registered_strategy_stamps_tf_institutional_overlay(self):
        """A strategy present in playbook_router.ALL_STRATS, with a non-empty
        htf_cache, reaches the "gate genuinely ran" stamp — even with zero
        entry signals (the function returns early right after stamping mode,
        once it sees no True entries, so this exercises the stamp without
        needing the full 7-layer per-bar pipeline)."""
        from src.engine.backtester import apply_eligibility_gate
        from src.engine.context.playbook_router import ALL_STRATS

        registered_name = ALL_STRATS[0]  # "ote" — stable, first entry
        n = 10
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)  # no signals — short-circuits after mode stamp
        exits = np.zeros(n, dtype=bool)

        _, _, gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name=registered_name,
        )
        assert gate_stats["mode"] == "tf_institutional_overlay"
        assert gate_stats["total"] == 0
        assert gate_stats.get("passthrough_reason") is None

    def test_unregistered_strategy_stamps_passthrough(self):
        """A strategy_name absent from playbook_router.ALL_STRATS short-circuits
        to passthrough_strategy_unregistered with a human-readable reason
        naming the offending strategy — BEFORE the tf_institutional_overlay
        stamp ever happens (HONESTY FIX, Band B 2026-07-02)."""
        from src.engine.backtester import apply_eligibility_gate

        n = 5
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)
        entries[2] = True
        exits = np.zeros(n, dtype=bool)

        _, filtered_exits, gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name="totally_unregistered_strategy_xyz",
        )
        assert gate_stats["mode"] == "passthrough_strategy_unregistered"
        assert "totally_unregistered_strategy_xyz" in gate_stats["passthrough_reason"]
        # Passthrough: signal passes through unfiltered (bypass, not filter).
        assert bool(entries[2]) is True


# ──────────────────────────────────────────────────────────────────────────────
# 3, 4, 5. _build_eligibility_gate_mode_disclosure() — the surfacing helper
# ──────────────────────────────────────────────────────────────────────────────

class TestBuildEligibilityGateModeDisclosure:
    def test_registered_strategy_run_records_tf_institutional_overlay(self):
        """End-to-end: feed the real gate_stats produced by a registered-
        strategy apply_eligibility_gate() call into the surfacing helper and
        confirm result["eligibility_gate_mode"]["long"] would read
        "tf_institutional_overlay" — this is the exact fix under test."""
        from src.engine.backtester import (
            _build_eligibility_gate_mode_disclosure,
            apply_eligibility_gate,
        )
        from src.engine.context.playbook_router import ALL_STRATS

        registered_name = ALL_STRATS[0]
        n = 10
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)
        exits = np.zeros(n, dtype=bool)

        _, _, long_gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name=registered_name,
        )
        disclosure = _build_eligibility_gate_mode_disclosure(long_gate_stats, None)
        assert disclosure["long"] == "tf_institutional_overlay"
        assert disclosure["long_passthrough_reason"] is None
        assert disclosure["short"] is None
        assert disclosure["short_passthrough_reason"] is None

    def test_unregistered_strategy_run_records_passthrough(self):
        """End-to-end: feed the real gate_stats produced by an unregistered-
        strategy apply_eligibility_gate() call into the surfacing helper and
        confirm result["eligibility_gate_mode"]["long"] would read
        "passthrough_strategy_unregistered" with the reason preserved."""
        from src.engine.backtester import (
            _build_eligibility_gate_mode_disclosure,
            apply_eligibility_gate,
        )

        n = 5
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)
        entries[1] = True
        exits = np.zeros(n, dtype=bool)

        _, _, long_gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name="another_unregistered_strategy",
        )
        disclosure = _build_eligibility_gate_mode_disclosure(long_gate_stats, None)
        assert disclosure["long"] == "passthrough_strategy_unregistered"
        assert "another_unregistered_strategy" in disclosure["long_passthrough_reason"]

    def test_asymmetric_long_short_both_recorded_distinctly(self):
        """Long registered + gated, short unregistered + passthrough — both
        sides must be recorded distinctly in the same disclosure dict (the
        fix must not collapse per-side signal into a single flag)."""
        from src.engine.backtester import (
            _build_eligibility_gate_mode_disclosure,
            apply_eligibility_gate,
        )
        from src.engine.context.playbook_router import ALL_STRATS

        n = 10
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)
        exits = np.zeros(n, dtype=bool)

        _, _, long_gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name=ALL_STRATS[0],
        )
        _, _, short_gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="short", symbol="MES",
            htf_cache={"2026-01-05": object()},
            strategy_name="unregistered_short_side_strategy",
        )
        disclosure = _build_eligibility_gate_mode_disclosure(long_gate_stats, short_gate_stats)
        assert disclosure["long"] == "tf_institutional_overlay"
        assert disclosure["short"] == "passthrough_strategy_unregistered"
        assert disclosure["long"] != disclosure["short"]
        assert "unregistered_short_side_strategy" in disclosure["short_passthrough_reason"]

    def test_both_sides_none_yields_all_none_disclosure(self):
        """use_eligibility_gate=False (or any path where the gate never ran on
        either side) must produce a well-shaped, all-None dict — never raise."""
        from src.engine.backtester import _build_eligibility_gate_mode_disclosure

        disclosure = _build_eligibility_gate_mode_disclosure(None, None)
        assert disclosure == {
            "long": None, "long_passthrough_reason": None,
            "short": None, "short_passthrough_reason": None,
        }

    def test_default_arguments_match_explicit_none(self):
        """Calling with no arguments at all (both default to None) must match
        the explicit-None call — confirms the default parameter wiring."""
        from src.engine.backtester import _build_eligibility_gate_mode_disclosure

        assert _build_eligibility_gate_mode_disclosure() == _build_eligibility_gate_mode_disclosure(None, None)

    def test_htf_unavailable_passthrough_surfaces_correctly(self):
        """Sibling passthrough mode (htf_cache unavailable, deep-scan #10) must
        also surface through the same helper — proving the fix is general,
        not special-cased to the strategy-unregistered path alone."""
        from src.engine.backtester import (
            _build_eligibility_gate_mode_disclosure,
            apply_eligibility_gate,
        )

        n = 5
        df = _flat_df(n)
        entries = np.zeros(n, dtype=bool)
        exits = np.zeros(n, dtype=bool)

        _, _, long_gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache=None,
        )
        disclosure = _build_eligibility_gate_mode_disclosure(long_gate_stats, None)
        assert disclosure["long"] == "passthrough_htf_unavailable"
        assert disclosure["long_passthrough_reason"] == "htf_cache_none_or_empty"
