"""Semantic-fidelity tests for Pine exportability scoring.

These tests enforce the FAIL-LOUD mandate: strategies whose validated logic
cannot be faithfully reproduced in Pine must be refused, not silently degraded.

Three semantic kill-switch classes:
  1. Style C / adaptive exits  — partials, runner trail, BE+1, 33/33/34
  2. Weighted confluence gating — 11-factor weighted scoring (use_weighted_scoring=True)
  3. Multi-TF gating           — daily_tf / htf_tf / itf_tf set on the strategy

All three emit explicit human-readable reasons.  A simple indicator-only strategy
with a plain stop/TP must still export cleanly (exportable=True, faithful=True).

Server-side execution note: DEPLOYED strategies execute via broker-router
(server-mediated execution).  Pine is a visual-only aid for those.  These
refusals are by design — see pine-export-service.ts checkExportability().
"""
import pytest
from src.engine.exportability import score_exportability, ExportabilityResult


# ─── SIMPLE FAITHFUL STRATEGY ─────────────────────────────────────────────────

class TestSimpleFaithful:
    """A plain indicator + fixed-stop/TP strategy MUST still export faithful=True."""

    def test_simple_strategy_faithful(self):
        """SMA cross + atr_multiple exit = faithful Pine export."""
        strategy = {
            "name": "SMA Cross Simple",
            "entry_indicator": "sma_crossover",
            "indicators": [
                {"type": "sma", "period": 20},
                {"type": "sma", "period": 50},
            ],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "direction": "both",
        }
        result = score_exportability(strategy)
        assert result.exportable is True, "Simple strategy must export"
        assert result.faithful is True, "Simple strategy must be faithful"
        # Should not contain semantic-fidelity refusal reasons
        combined = " ".join(result.deductions)
        assert "Style C" not in combined
        assert "server-side" not in combined.lower() or result.faithful is True

    def test_fixed_target_exit_faithful(self):
        """RSI + fixed_target exit = faithful Pine export."""
        strategy = {
            "name": "RSI Fixed Target",
            "entry_indicator": "rsi",
            "indicators": [{"type": "rsi", "period": 14}],
            "entry_params": {"period": 14, "oversold": 30, "overbought": 70},
            "exit_type": "fixed_target",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.exportable is True
        assert result.faithful is True

    def test_result_has_faithful_field(self):
        """ExportabilityResult must expose a faithful: bool field."""
        strategy = {"name": "test", "entry_params": {}, "exit_type": "fixed_target"}
        result = score_exportability(strategy)
        assert isinstance(result, ExportabilityResult)
        assert hasattr(result, "faithful")
        assert isinstance(result.faithful, bool)


# ─── STYLE C / PARTIALS — MUST REFUSE ─────────────────────────────────────────

class TestStyleCPartials:
    """Style C 33/33/34 + runner trail + BE+1 cannot be expressed in Pine.

    The Pine compiler emits strategy.exit() with a single stop/target.
    It cannot express partial closes, runner trailing, or BE+1 mechanics.
    These strategies must refuse with a clear reason.
    """

    def test_style_c_partials_array_not_faithful(self):
        """exit_params with partials array → faithful=False, exportable=False."""
        strategy = {
            "name": "Style C Runner",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 9}, {"type": "sma", "period": 21}],
            "entry_params": {"fast": 9, "slow": 21},
            "exit_type": "atr_multiple",
            "exit_params": {
                "style": "c",
                "partials": [
                    {"pct": 33, "target_r": 1.0},
                    {"pct": 33, "target_r": 2.0},
                    {"pct": 34, "runner": True},
                ],
            },
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False, "Style C partials cannot be faithfully expressed in Pine"
        assert result.exportable is False, "Not exportable when not faithful"
        combined = " ".join(result.deductions)
        # Must emit a human-readable reason mentioning Style C or runner trail
        assert any(
            phrase in combined
            for phrase in ("Style C", "runner trail", "partial", "server-side", "33/33")
        ), f"Expected Style C / runner trail reason in deductions, got: {combined}"

    def test_style_c_via_exit_style_field_not_faithful(self):
        """exit_params.style='c' shorthand → faithful=False."""
        strategy = {
            "name": "Style C Short",
            "entry_indicator": "ema",
            "indicators": [{"type": "ema", "period": 20}],
            "entry_params": {"period": 20},
            "exit_type": "atr_multiple",
            "exit_params": {"style": "c"},
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_adaptive_exit_style_not_faithful(self):
        """exit_plan_config.exit_style='adaptive' → faithful=False."""
        strategy = {
            "name": "Adaptive Exit",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "exit_plan_config": {"exit_style": "adaptive"},
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False, "Adaptive exit cannot be faithfully expressed in Pine"
        assert result.exportable is False
        combined = " ".join(result.deductions)
        assert any(
            phrase in combined
            for phrase in ("adaptive", "server-side", "exit_style")
        ), f"Expected adaptive exit reason in deductions, got: {combined}"

    def test_runner_trail_field_not_faithful(self):
        """exit_params.runner_trail=True (explicit field) → faithful=False."""
        strategy = {
            "name": "Runner Trail",
            "entry_indicator": "ema",
            "indicators": [{"type": "ema", "period": 9}],
            "entry_params": {"period": 9},
            "exit_type": "atr_multiple",
            "exit_params": {"runner_trail": True},
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_move_stop_to_be_plus1_not_faithful(self):
        """exit_params.move_stop_to_be=True → faithful=False (BE+1 not Pine-expressible)."""
        strategy = {
            "name": "BE Plus 1",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}, {"type": "sma", "period": 50}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "exit_params": {"move_stop_to_be": True},
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_deduction_message_mentions_server_side_execution(self):
        """Style C refusal message must mention server-side execution context."""
        strategy = {
            "name": "Style C with Server Note",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 9}],
            "entry_params": {"fast": 9, "slow": 21},
            "exit_type": "atr_multiple",
            "exit_params": {"style": "c", "partials": [{"pct": 33, "target_r": 1.0}]},
            "direction": "long",
        }
        result = score_exportability(strategy)
        combined = " ".join(result.deductions).lower()
        assert "server" in combined, (
            "Deduction must explain strategy executes server-side via broker-router"
        )


# ─── CONFLUENCE / MULTI-TF GATING — MUST REFUSE ───────────────────────────────

class TestConfluenceGating:
    """11-factor weighted confluence scoring cannot be expressed in Pine.

    Pine fires on the raw indicator.  A strategy requiring weighted confluence
    passes (min_factors_satisfied) is materially different from the exported Pine.
    """

    def test_weighted_confluence_not_faithful(self):
        """use_weighted_scoring=True → faithful=False, exportable=False."""
        strategy = {
            "name": "Weighted Confluence",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}, {"type": "sma", "period": 50}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "entry_quality": {
                "use_weighted_scoring": True,
                "min_factors_satisfied": 7,
                "confluence_factors": [
                    "market_structure_aligned",
                    "killzone_active",
                    "vwap_alignment",
                ],
            },
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False, (
            "11-factor weighted confluence cannot be expressed in Pine"
        )
        assert result.exportable is False
        combined = " ".join(result.deductions)
        assert any(
            phrase in combined
            for phrase in ("confluence", "weighted", "factor", "server-side")
        ), f"Expected confluence reason in deductions, got: {combined}"

    def test_min_factors_without_weighted_scoring_also_refused(self):
        """min_factors_satisfied set → confluence gating → not faithful."""
        strategy = {
            "name": "Factor Gate No Weighted",
            "entry_indicator": "ema",
            "indicators": [{"type": "ema", "period": 20}],
            "entry_params": {"period": 20},
            "exit_type": "atr_multiple",
            "entry_quality": {
                "use_weighted_scoring": False,
                "min_factors_satisfied": 5,
                "confluence_factors": ["killzone_active", "regime_match", "vwap_alignment"],
            },
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False


class TestMultiTFGating:
    """Multi-timeframe (5-TF) alignment gating cannot be expressed in Pine.

    The Pine compiler emits indicator logic for a single chart timeframe.
    Strategies requiring daily_tf / htf_tf / itf_tf alignment fire on materially
    different conditions than the exported Pine.
    """

    def test_daily_tf_declared_not_faithful(self):
        """daily_tf declared → multi-TF gating → faithful=False."""
        strategy = {
            "name": "5-TF Strategy",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "daily_tf": "1D",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False, "Multi-TF strategy cannot be faithfully expressed in Pine"
        assert result.exportable is False
        combined = " ".join(result.deductions)
        assert any(
            phrase in combined
            for phrase in ("multi-TF", "timeframe", "daily_tf", "server-side", "HTF")
        ), f"Expected multi-TF reason in deductions, got: {combined}"

    def test_htf_tf_declared_not_faithful(self):
        """htf_tf declared → multi-TF gating → faithful=False."""
        strategy = {
            "name": "HTF Strategy",
            "entry_indicator": "ema",
            "indicators": [{"type": "ema", "period": 50}],
            "entry_params": {"period": 50},
            "exit_type": "atr_multiple",
            "htf_tf": "4H",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_itf_tf_declared_not_faithful(self):
        """itf_tf declared → multi-TF gating → faithful=False."""
        strategy = {
            "name": "ITF Strategy",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 9}],
            "entry_params": {"period": 9},
            "exit_type": "atr_multiple",
            "itf_tf": "15",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_multiple_tf_all_refused(self):
        """All TF fields set → still refused once, not deducted multiple times."""
        strategy = {
            "name": "Full MTF",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "daily_tf": "1D",
            "htf_tf": "4H",
            "itf_tf": "15",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False
        # Should have exactly one multi-TF deduction (not three)
        mtf_deductions = [d for d in result.deductions if "timeframe" in d.lower() or "multi-TF" in d or "daily_tf" in d.lower() or "htf_tf" in d.lower() or "itf_tf" in d.lower()]
        assert len(mtf_deductions) == 1, (
            f"Expected exactly one multi-TF deduction, got {len(mtf_deductions)}: {mtf_deductions}"
        )


# ─── REGIME / BIAS GATING — MUST REFUSE ───────────────────────────────────────

class TestRegimeGating:
    """Regime gating (not just regime tagging) cannot be expressed in Pine."""

    def test_regime_gating_required_not_faithful(self):
        """entry_quality.regime_required=True → faithful=False."""
        strategy = {
            "name": "Regime Gated",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "entry_quality": {
                "use_weighted_scoring": False,
                "regime_required": True,
            },
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False

    def test_preferred_regime_soft_advisory_only(self):
        """preferred_regime without gating stays as advisory (not a hard refusal).

        This was the pre-existing behavior: preferred_regime deducts -5 and adds
        a recommendation that it can be approximated.  It must remain exportable=True
        for the simple-strategy faithful path.
        """
        strategy = {
            "name": "SMA with Regime Hint",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}, {"type": "sma", "period": 50}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "preferred_regime": "trending",
            "direction": "long",
        }
        result = score_exportability(strategy)
        # preferred_regime alone (no entry_quality.regime_required) is advisory only
        # Score is deducted -5 but strategy stays exportable
        assert result.exportable is True
        assert result.score < 100  # deduction applied


# ─── COMBINED: MULTIPLE INEXPRESSIBLE FEATURES ─────────────────────────────────

class TestCombinedInexpressible:
    """When a strategy has multiple inexpressible features, it must be refused once."""

    def test_style_c_plus_confluence_refused(self):
        """Style C + confluence gating → refused (both inexpressible)."""
        strategy = {
            "name": "Complex Validated Strategy",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 9}, {"type": "sma", "period": 21}],
            "entry_params": {"fast": 9, "slow": 21},
            "exit_type": "atr_multiple",
            "exit_params": {
                "style": "c",
                "partials": [
                    {"pct": 33, "target_r": 1.0},
                    {"pct": 33, "target_r": 2.0},
                    {"pct": 34, "runner": True},
                ],
            },
            "entry_quality": {
                "use_weighted_scoring": True,
                "min_factors_satisfied": 7,
            },
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False
        # Both reasons should appear in deductions
        combined = " ".join(result.deductions).lower()
        has_exit_reason = any(
            phrase in combined for phrase in ("style c", "runner", "partial", "33/33")
        )
        has_confluence_reason = any(
            phrase in combined for phrase in ("confluence", "weighted", "factor")
        )
        assert has_exit_reason, f"Missing exit reason in: {combined}"
        assert has_confluence_reason, f"Missing confluence reason in: {combined}"

    def test_style_c_plus_multi_tf_refused(self):
        """Style C + multi-TF → refused (both inexpressible)."""
        strategy = {
            "name": "Style C + MTF",
            "entry_indicator": "ema",
            "indicators": [{"type": "ema", "period": 20}],
            "entry_params": {"period": 20},
            "exit_type": "atr_multiple",
            "exit_params": {"style": "c"},
            "daily_tf": "1D",
            "direction": "long",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False


# ─── SCORE INVARIANTS ─────────────────────────────────────────────────────────

class TestScoreInvariants:
    """Score invariants after adding semantic checks."""

    def test_faithful_false_implies_exportable_false(self):
        """When faithful=False, exportable must also be False."""
        strategy = {
            "name": "Invariant Test",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}],
            "entry_params": {},
            "exit_type": "atr_multiple",
            "exit_params": {"style": "c"},
        }
        result = score_exportability(strategy)
        if not result.faithful:
            assert result.exportable is False, (
                "faithful=False must imply exportable=False"
            )

    def test_exportable_true_implies_faithful_true(self):
        """When exportable=True (simple strategy), faithful must also be True."""
        strategy = {
            "name": "Faithful Invariant",
            "entry_indicator": "sma_crossover",
            "indicators": [{"type": "sma", "period": 20}, {"type": "sma", "period": 50}],
            "entry_params": {"fast": 20, "slow": 50},
            "exit_type": "atr_multiple",
            "direction": "both",
        }
        result = score_exportability(strategy)
        assert result.exportable is True
        assert result.faithful is True

    def test_score_zero_on_inexpressible(self):
        """Score is clamped to 0 when multiple inexpressible features accumulate."""
        strategy = {
            "name": "Zero Score",
            "entry_indicator": "ml_signal",
            "indicators": [{"type": "ml_signal"}],
            "entry_params": {},
            "exit_type": "atr_multiple",
            "exit_params": {"style": "c"},
            "entry_quality": {"use_weighted_scoring": True},
            "daily_tf": "1D",
        }
        result = score_exportability(strategy)
        assert result.faithful is False
        assert result.exportable is False
        assert result.score == 0.0, f"Expected score 0, got {result.score}"
