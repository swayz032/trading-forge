"""Deepscan17 B-9 (dormant) — adaptive chandelier trail must use a
regime-aware multiplier, matching TS adaptive-exit-engine.ts.

BACKGROUND: TS adaptive-exit-engine.ts (Wave 26 Pass L Tweak 1) uses 2.5x ATR
for the chandelier trail when regime is TRENDING_UP/TRENDING_DOWN/EXPANSION
(StratBase 2026-02: PF 1.56 @ 2.5x vs PF 1.44 @ 2.0x), 2.0x otherwise
(env STOP_CHANDELIER_MULTIPLIER_TRENDING). `_apply_adaptive_management`'s
chandelier branch (backtester.py) hardcoded 2.0x unconditionally, ignoring
`regime_default` (already in scope in that function) — a TS<->Python parity
gap.

STATUS: dormant under the CURRENT default regime->method routing table
(`_get_runner_trail_method` in src/engine/exits/adaptive_exits.py — a
forbidden-to-edit file for this fix wave) — chandelier is only reached for
HIGH_VOL_MACRO by default; trending regimes route to anchored_vwap. The fix
activates the moment that routing (or a future per-strategy override) maps a
trending regime to chandelier, so TS and Python stay byte-identical when that
happens rather than silently diverging.

Given the exit-plan's TP1/TP2 liquidity-mapped price levels make it fragile
to hand-construct a bar sequence that reliably drives execution all the way
into the chandelier update block (a full run through compute_exit_plan_python
+ the per-bar loop), these tests instead directly verify the exact
multiplier-selection logic added to the chandelier branch — mirroring the
TestFix1CpcvWfeFromPerPathIs / TestB3WarmupRestrictionPureLogic pattern
already used elsewhere in this suite for testing extracted production logic
without full bar-simulation — plus a source-presence check tying the
replicated logic to the actual function.

Run targeted:
    python -m pytest src/engine/tests/test_deepscan17_b9_chandelier_regime_multiplier.py -v
"""

from __future__ import annotations

import math


def _select_chandelier_multiplier(regime_default: str, env_override: str | None = None) -> float:
    """Exact replication of the selection logic added to
    _apply_adaptive_management's chandelier branch (backtester.py)."""
    is_trending_regime = regime_default in ("TRENDING_UP", "TRENDING_DOWN", "EXPANSION")
    if is_trending_regime:
        try:
            val = float(env_override) if env_override is not None else 2.5
            if not math.isfinite(val):
                val = 2.5
        except (TypeError, ValueError):
            val = 2.5
    else:
        val = 2.0
    return val


class TestB9ChandelierMultiplierSelection:
    def test_trending_up_uses_2_5x_default(self):
        assert _select_chandelier_multiplier("TRENDING_UP") == 2.5

    def test_trending_down_uses_2_5x_default(self):
        assert _select_chandelier_multiplier("TRENDING_DOWN") == 2.5

    def test_expansion_uses_2_5x_default(self):
        assert _select_chandelier_multiplier("EXPANSION") == 2.5

    def test_range_bound_uses_2_0x_default(self):
        assert _select_chandelier_multiplier("RANGE_BOUND") == 2.0

    def test_high_vol_macro_uses_2_0x_default(self):
        """HIGH_VOL_MACRO is the regime that DEFAULT-routes to chandelier —
        must stay at the pre-fix 2.0x (byte-identical for the currently-live
        default routing path)."""
        assert _select_chandelier_multiplier("HIGH_VOL_MACRO") == 2.0

    def test_unknown_regime_uses_2_0x_default(self):
        assert _select_chandelier_multiplier("UNKNOWN") == 2.0
        assert _select_chandelier_multiplier(None) == 2.0

    def test_env_override_respected_for_trending_regime(self):
        assert _select_chandelier_multiplier("TRENDING_UP", env_override="3.0") == 3.0

    def test_env_override_ignored_for_non_trending_regime(self):
        """The env override only applies to trending regimes — matches TS's
        `isTrendingRegime` gate on CHANDELIER_MULTIPLIER_TRENDING."""
        assert _select_chandelier_multiplier("RANGE_BOUND", env_override="3.0") == 2.0

    def test_malformed_env_override_falls_back_to_2_5(self):
        assert _select_chandelier_multiplier("TRENDING_UP", env_override="not_a_number") == 2.5

    def test_non_finite_env_override_falls_back_to_2_5(self):
        assert _select_chandelier_multiplier("TRENDING_UP", env_override="nan") == 2.5
        assert _select_chandelier_multiplier("TRENDING_UP", env_override="inf") == 2.5


class TestB9SourceContract:
    """Ties the pure-logic replication above to the actual function body —
    fails if the fix is ever reverted or the regime-string/env-var names
    drift out of parity with adaptive-exit-engine.ts."""

    def test_chandelier_branch_is_regime_aware(self):
        import inspect

        import src.engine.backtester as bt

        src = inspect.getsource(bt._apply_adaptive_management)
        chandelier_idx = src.index('elif runner_method == "chandelier":')
        chandelier_block = src[chandelier_idx:chandelier_idx + 1500]

        assert "STOP_CHANDELIER_MULTIPLIER_TRENDING" in chandelier_block, (
            "B-9 REGRESSION: chandelier branch no longer reads the TS-parity "
            "env var STOP_CHANDELIER_MULTIPLIER_TRENDING"
        )
        assert '"TRENDING_UP"' in chandelier_block and '"EXPANSION"' in chandelier_block, (
            "B-9 REGRESSION: chandelier branch no longer checks for the "
            "trending regime set matching TS's isTrendingRegime"
        )
        assert "regime_default" in chandelier_block, (
            "B-9 REGRESSION: chandelier branch no longer consults regime_default"
        )
