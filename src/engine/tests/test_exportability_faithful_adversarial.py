"""deep-scan Accuracy failure-injection (A-4): score_exportability's `faithful` flag must be False
for a strategy whose logic Pine cannot reproduce (Style C exits / 11-factor confluence gating /
multi-TF AND-gating), and True for a plain single-signal strategy.

The Deep-Scan #21 fix made `faithful` honest (was silently True even when Pine dropped features). The
existing suite trusts the code's own comment; this feeds fabricated known-bad configs and asserts the
detector actually flips — the 'confirm the detector catches it' discipline.
"""
from src.engine.exportability import score_exportability


class TestExportabilityFaithfulAdversarial:
    def test_style_c_exit_is_not_faithful_and_not_exportable(self):
        # Style C 33/33/34 partials + runner trail + BE+1 cannot be reproduced by strategy.exit().
        r = score_exportability({"exit_params": {"style": "style_c", "runner_trail": True, "move_stop_to_be": True}})
        assert r.faithful is False
        assert r.exportable is False  # faithful=False implies exportable=False on the main path

    def test_adaptive_exit_is_not_faithful(self):
        r = score_exportability({"exit_plan_config": {"exit_style": "adaptive"}})
        assert r.faithful is False

    def test_weighted_confluence_gating_is_not_faithful(self):
        # 11-factor weighted scoring / min_factors / regime_required — Pine fires on raw signal alone.
        assert score_exportability({"entry_quality": {"use_weighted_scoring": True}}).faithful is False
        assert score_exportability({"entry_quality": {"min_factors_satisfied": 3}}).faithful is False
        assert score_exportability({"entry_quality": {"regime_required": True}}).faithful is False

    def test_multi_tf_gating_is_not_faithful(self):
        # HTF alignment fields require top-down timeframe AND-gating Pine cannot express.
        assert score_exportability({"daily_tf": "1D", "htf_tf": "4h"}).faithful is False

    def test_trailing_stop_exit_is_not_faithful(self):
        # PINE-1 (2026-07-11 instrument ledger): exit_type='trailing_stop' degrades to a
        # static ATR stop in BOTH exported Pine artifacts (pine_compiler.py never emits
        # trail_offset/trail_points). Previously this only cost -20 score, leaving
        # faithful=True and exportable=True (score~80, 'reducible' band) — silently
        # passing the TESTING->PAPER faithful gate despite a real behavioral divergence
        # from the internal engine's genuine trailing-stop management.
        r = score_exportability({"exit_type": "trailing_stop"})
        assert r.faithful is False
        assert r.exportable is False  # faithful=False implies exportable=False on the main path
        assert r.score == 0.0

    def test_plain_single_signal_strategy_is_faithful(self):
        # A plain indicator strategy with no Style C / confluence / multi-TF is faithfully exportable.
        r = score_exportability(
            {"entry_indicator": "ema_crossover", "indicators": [{"type": "ema_crossover", "params": {"fast": 9, "slow": 21}}]}
        )
        assert r.faithful is True
        assert r.exportable is True  # non-tautology: the SAME function passes the clean case

    def test_faithful_flag_separates_inexpressible_from_plain(self):
        """Core non-tautology: the same scorer flips faithful for inexpressible logic but not plain."""
        inexpressible = score_exportability({"exit_params": {"style": "style_c"}}).faithful
        plain = score_exportability({"entry_indicator": "ema_crossover"}).faithful
        assert inexpressible is False and plain is True
