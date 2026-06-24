"""Pass 2 Track B — Exportability scorer archetype prefix tests.

Covers:
- entry_indicator='archetype:<key>' → band='alert_only', score>=60, exportable=True.
- entry_indicator='uncatalogued:<term>' → same.
- entry_indicator='ema_crossover' (parametric) → behavior unchanged from pre-Pass-2.
- ICT_NO_PINE_INDICATORS raw names score >= old band (removed -30 deduction).

Export path: src/engine/exportability.py score_exportability()
"""
from __future__ import annotations

from src.engine.exportability import ExportabilityResult, score_exportability

# ─── archetype: prefix fast-path ─────────────────────────────────────────────

class TestArchetypePrefixFastPath:

    def test_archetype_silver_bullet_band(self):
        result = score_exportability({"entry_indicator": "archetype:silver_bullet"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True

    def test_archetype_bounce_off_level_band(self):
        result = score_exportability({"entry_indicator": "archetype:bounce_off_level"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True

    def test_archetype_ict_silver_bullet_ny_am(self):
        result = score_exportability({"entry_indicator": "archetype:ict_silver_bullet_ny_am"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True
        assert result.faithful is True

    def test_archetype_order_block(self):
        """archetype:order_block (canonical form) → alert_only, no -30 deduction."""
        result = score_exportability({"entry_indicator": "archetype:order_block"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True

    def test_archetype_fvg_retrace(self):
        result = score_exportability({"entry_indicator": "archetype:fvg_retrace"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True

    def test_archetype_gann_box_4h_continuation(self):
        result = score_exportability({"entry_indicator": "archetype:gann_box_4h_continuation"})
        assert result.band == "alert_only"
        assert result.score == 60.0

    def test_archetype_score_exactly_60(self):
        """The structural alert-only band score must be exactly 60."""
        result = score_exportability({"entry_indicator": "archetype:wyckoff_spring"})
        assert result.score == 60.0

    def test_archetype_deductions_empty(self):
        """No deductions for archetype: prefix — the alert-only band is by design."""
        result = score_exportability({"entry_indicator": "archetype:ict_breaker"})
        assert result.deductions == []

    def test_archetype_has_recommendation(self):
        """Recommendation should explain the alert-only Pine contract."""
        result = score_exportability({"entry_indicator": "archetype:ict_power_of_3"})
        assert len(result.recommendations) >= 1
        assert any("alert-only" in r.lower() or "archetype" in r.lower()
                   for r in result.recommendations)

    def test_archetype_via_indicators_list(self):
        """Prefix detection also fires when entry_indicator is absent but indicators[0] has it."""
        result = score_exportability({
            "indicators": [{"type": "archetype:smt_reversal"}]
        })
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True


# ─── uncatalogued: prefix fast-path ──────────────────────────────────────────

class TestUncataloguedPrefixFastPath:

    def test_uncatalogued_smashed_candle(self):
        result = score_exportability({"entry_indicator": "uncatalogued:smashed_candle"})
        assert result.band == "alert_only"
        assert result.score >= 60
        assert result.exportable is True

    def test_uncatalogued_score_60(self):
        result = score_exportability({"entry_indicator": "uncatalogued:smashed_candle"})
        assert result.score == 60.0

    def test_uncatalogued_faithful_true(self):
        """Uncatalogued is alert-only passive marker — faithful=True (it is what it claims)."""
        result = score_exportability({"entry_indicator": "uncatalogued:smashed_candle"})
        assert result.faithful is True

    def test_uncatalogued_deductions_empty(self):
        result = score_exportability({"entry_indicator": "uncatalogued:my_custom_setup"})
        assert result.deductions == []

    def test_uncatalogued_has_recommendation(self):
        result = score_exportability({"entry_indicator": "uncatalogued:fake_term"})
        assert len(result.recommendations) >= 1

    def test_uncatalogued_multi_word_term(self):
        result = score_exportability({"entry_indicator": "uncatalogued:fair_value_gap_entry"})
        assert result.band == "alert_only"
        assert result.score >= 60


# ─── Parametric indicators unchanged ─────────────────────────────────────────

class TestParametricIndicatorsUnchanged:
    """Pre-Pass-2 behavior for non-archetype indicators must be preserved."""

    def test_ema_crossover_still_works(self):
        result = score_exportability({"entry_indicator": "ema_crossover"})
        # ema_crossover → base_type='ema' → NATIVE_PINE_INDICATORS → score stays high
        assert result.score >= 70
        assert result.exportable is True
        assert result.band in ("clean", "reducible")

    def test_sma_parametric(self):
        result = score_exportability({"entry_indicator": "sma", "entry_params": {"period": 20}})
        assert result.score >= 70
        assert result.exportable is True

    def test_rsi_parametric(self):
        result = score_exportability({"entry_indicator": "rsi"})
        assert result.score >= 70
        assert result.exportable is True

    def test_ml_signal_still_unexportable(self):
        result = score_exportability({"entry_indicator": "ml_signal"})
        assert result.exportable is False

    def test_unknown_indicator_still_penalized(self):
        """Unknown indicator (not in any map) still gets the large deduction."""
        result = score_exportability({"entry_indicator": "some_totally_unknown_indicator"})
        # base_type 'some' is not in NATIVE_PINE_INDICATORS → -50 deduction
        assert result.score <= 50


# ─── ICT_NO_PINE_INDICATORS deduction removed ────────────────────────────────

class TestICTNoPineDeductionGone:
    """The -30 deduction for raw ICT names must be gone (Pass 2 Track B)."""

    def test_order_block_raw_scores_above_old_alert_only_floor(self):
        """order_block raw → previously scored 70 (one -30 deduction from 100).
        After Pass 2, the deduction is -5 advisory only → scores >= 70.
        'scores >= old band' means score >= 70 (old reducible floor).
        """
        result = score_exportability({"entry_indicator": "order_block"})
        assert result.score >= 70, (
            f"order_block raw score {result.score} is below the old 70 band floor. "
            "The -30 ICT deduction should be gone."
        )

    def test_fvg_raw_no_hard_block(self):
        result = score_exportability({"entry_indicator": "fvg"})
        # Should NOT produce do_not_export with one raw ICT indicator
        assert result.band != "do_not_export", (
            "Single raw 'fvg' should not produce do_not_export after removing -30 deduction"
        )

    def test_breaker_block_raw_exportable(self):
        result = score_exportability({"entry_indicator": "breaker_block"})
        assert result.exportable is True, (
            "breaker_block raw should be exportable after removing -30 deduction"
        )

    def test_liquidity_sweep_raw_score_reasonable(self):
        result = score_exportability({"entry_indicator": "liquidity_sweep"})
        assert result.score >= 70, (
            f"liquidity_sweep raw score {result.score} should be >= 70 after removing -30 deduction"
        )

    def test_two_ict_raw_indicators_no_longer_force_do_not_export(self):
        """Previously two ICT indicators → score 40 (do_not_export).
        After Pass 2, two -5 advisory deductions → score ~90 (reducible or clean).
        """
        result = score_exportability({
            "indicators": [
                {"type": "order_block"},
                {"type": "fvg"},
            ]
        })
        assert result.score >= 50, (
            f"Two raw ICT indicators produced score {result.score}; expected >= 50 after pass 2"
        )
        assert result.exportable is True, (
            "Two raw ICT indicators should be exportable after removing -30 deduction"
        )

    def test_ict_raw_has_recommendation_not_deduction(self):
        """Raw ICT names now produce a recommendation (prefer archetype: form), not a deduction."""
        result = score_exportability({"entry_indicator": "order_block"})
        # Deductions should NOT mention -30 / 'no Pine equivalent' for order_block
        for d in result.deductions:
            assert "no Pine equivalent" not in d or "order_block" not in d, (
                "order_block should not produce 'no Pine equivalent' deduction after Pass 2"
            )
        # Should have a recommendation about the archetype: form
        assert any("archetype" in r.lower() for r in result.recommendations), (
            "Raw ICT indicator should recommend using archetype: form"
        )


# ─── Faithful flag behavior ───────────────────────────────────────────────────

class TestFaithfulFlagBehavior:

    def test_archetype_faithful_true(self):
        """Alert-only archetype export is exactly what it claims — faithful=True."""
        result = score_exportability({"entry_indicator": "archetype:ict_judas_swing"})
        assert result.faithful is True

    def test_style_c_exits_still_faithful_false(self):
        """Style C exit semantics are NOT expressible in Pine — faithful=False preserved."""
        result = score_exportability({
            "entry_indicator": "ema_crossover",
            "exit_params": {"style": "c", "partials": [0.33, 0.33, 0.34]},
        })
        assert result.faithful is False
        assert result.exportable is False

    def test_archetype_prefix_fast_path_takes_priority_over_confluence_gate(self):
        """The archetype: prefix fast-path returns alert_only=True before confluence checks.

        When entry_indicator starts with 'archetype:', the scorer returns immediately with
        the structural alert-only band.  The confluence gate check (use_weighted_scoring=True)
        is reached only for NON-archetype strategies.  Alert-only Pine cannot express
        confluence gating anyway, but faithful=True here because the Pine is exactly what
        it claims: a passive marker + alertcondition with no execution logic.

        Non-archetype + weighted confluence still produces faithful=False (tested above).
        """
        result = score_exportability({
            "entry_indicator": "archetype:ict_ote",
            "entry_quality": {"use_weighted_scoring": True},
        })
        # Fast-path: archetype prefix returns before confluence check fires
        assert result.band == "alert_only"
        assert result.score == 60.0
        assert result.exportable is True
        # faithful=True because alert-only Pine is exactly what it claims (passive marker)
        assert result.faithful is True


# ─── ExportabilityResult shape ────────────────────────────────────────────────

class TestResultShape:

    def test_archetype_result_has_all_fields(self):
        result = score_exportability({"entry_indicator": "archetype:ict_swing"})
        assert isinstance(result, ExportabilityResult)
        assert isinstance(result.score, float)
        assert isinstance(result.band, str)
        assert isinstance(result.exportable, bool)
        assert isinstance(result.faithful, bool)
        assert isinstance(result.deductions, list)
        assert isinstance(result.recommendations, list)
        assert isinstance(result.indicator_scores, dict)

    def test_archetype_indicator_scores_keyed_by_entry_indicator(self):
        result = score_exportability({"entry_indicator": "archetype:ict_scalp"})
        assert "archetype:ict_scalp" in result.indicator_scores
        assert result.indicator_scores["archetype:ict_scalp"] == 60.0
