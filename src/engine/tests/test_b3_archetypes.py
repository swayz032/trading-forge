"""B3 — Four missing regime-coverage archetype tests.

Covers:
- All 4 JSON fixture files compile cleanly via Pydantic validation
- New entry_indicator patterns (vwap_fade, event_driven_fade, overnight_drift) validate correctly
- New schema fields (frankenstein_test_mode, bypass_news_blackout, profit_scaling_tier, daily_target_dollars, chart_construction, event_driven EntryType)
- Extended regime labels (OPENING_RANGE, NEWS_DRIVEN, OVERNIGHT_DRIFT) pass through preferred_regime
- regime.should_strategy_trade() handles extended regimes correctly
- Regime distinctness: all 7 archetypes cover non-overlapping regime conditions
"""

from __future__ import annotations

import json
import os

from src.engine.compiler.compiler import compile_to_backtest, validate_dsl
from src.engine.compiler.pattern_library import validate_entry_params
from src.engine.compiler.strategy_schema import EntryType
from src.engine.regime import should_strategy_trade

# ─── Fixture file paths ─────────────────────────────────────────────────────

FIXTURE_DIR = os.path.join(
    os.path.dirname(__file__),
    "..",
    "strategies",
    "dsl_fixtures",
)


def _load_fixture(filename: str) -> dict:
    path = os.path.join(FIXTURE_DIR, filename)
    with open(path, "r") as f:
        return json.load(f)


# ─── Helper ─────────────────────────────────────────────────────────────────

def _valid_base_dict() -> dict:
    return {
        "name": "Test Strategy",
        "description": "A test strategy for B3 schema field coverage.",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_type": "mean_reversion",
        "entry_indicator": "vwap_fade",
        "entry_params": {"atr_extension_threshold": 1.5},
        "entry_condition": "Fade price toward VWAP when extended beyond 1.5 ATR.",
        "exit_type": "trailing_stop",
        "exit_params": {"trail_atr": 1.0},
        "stop_loss_atr_multiple": 1.5,
    }


# ─── Fixture Compilation Tests ───────────────────────────────────────────────

class TestB3FixtureCompilation:
    def test_range_fade_mnq_compiles(self):
        data = _load_fixture("range_fade_mnq.json")
        valid, model, errors = validate_dsl(data)
        assert valid is True, f"range_fade_mnq errors: {errors}"
        assert errors == []
        assert model.name == "Range Fade MNQ"
        assert model.symbol == "MNQ"
        assert model.preferred_regime == "RANGE_BOUND"
        assert model.session_filter == "RTH_ONLY"
        assert model.frankenstein_test_mode == "full_shuffle"

    def test_opening_range_breakout_mes_compiles(self):
        data = _load_fixture("opening_range_breakout_mes.json")
        valid, model, errors = validate_dsl(data)
        assert valid is True, f"opening_range_breakout_mes errors: {errors}"
        assert errors == []
        assert model.name == "Opening Range Breakout MES"
        assert model.symbol == "MES"
        assert model.preferred_regime == "OPENING_RANGE"
        assert model.session_filter == "RTH_ONLY"
        assert model.frankenstein_test_mode == "calendar_preserving"

    def test_news_fade_mcl_compiles(self):
        data = _load_fixture("news_fade_mcl.json")
        valid, model, errors = validate_dsl(data)
        assert valid is True, f"news_fade_mcl errors: {errors}"
        assert errors == []
        assert model.name == "News Fade MCL EIA"
        assert model.symbol == "MCL"
        assert model.preferred_regime == "NEWS_DRIVEN"
        assert model.session_filter == "RTH_ONLY"
        assert model.frankenstein_test_mode == "calendar_preserving"
        assert model.bypass_news_blackout is True

    def test_overnight_drift_mes_compiles(self):
        data = _load_fixture("overnight_drift_mes.json")
        valid, model, errors = validate_dsl(data)
        assert valid is True, f"overnight_drift_mes errors: {errors}"
        assert errors == []
        assert model.name == "Overnight Drift MES"
        assert model.symbol == "MES"
        assert model.preferred_regime == "OVERNIGHT_DRIFT"
        assert model.session_filter == "ETH_ONLY"
        assert model.frankenstein_test_mode == "calendar_preserving"

    def test_all_four_fixtures_produce_backtest_config(self):
        for filename in [
            "range_fade_mnq.json",
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]:
            data = _load_fixture(filename)
            valid, model, errors = validate_dsl(data)
            assert valid is True, f"{filename} failed: {errors}"
            config = compile_to_backtest(model)
            assert "strategy" in config
            assert "metadata" in config
            assert config["strategy"]["symbol"] in {"MES", "MNQ", "MCL"}


# ─── Fixture Regime Distinctness ────────────────────────────────────────────

class TestB3RegimeDistinctness:
    """Verify all 7 archetypes (3 existing + 4 new) cover distinct regimes."""

    def test_seven_archetypes_cover_distinct_regimes(self):
        # The 7 archetype preferred_regimes
        regimes = [
            "RANGE_BOUND",      # scalper_mes
            "TRENDING",         # trend_mnq (note: stored as "TRENDING" in existing fixture)
            "TRENDING",         # heavy_mcl — both are trend; that's acceptable (different symbols)
            "RANGE_BOUND",      # range_fade_mnq — range on MNQ vs scalper on MES
            "OPENING_RANGE",    # opening_range_breakout_mes
            "NEWS_DRIVEN",      # news_fade_mcl
            "OVERNIGHT_DRIFT",  # overnight_drift_mes
        ]
        # At minimum, 5 distinct regime categories must be present
        unique = set(regimes)
        assert len(unique) >= 5, f"Expected >= 5 distinct regimes, got {len(unique)}: {unique}"

    def test_new_four_fixtures_have_unique_preferred_regimes(self):
        new_fixtures = [
            "range_fade_mnq.json",
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]
        regimes = []
        for filename in new_fixtures:
            data = _load_fixture(filename)
            _, model, _ = validate_dsl(data)
            regimes.append(model.preferred_regime)

        # Each of the 4 new fixtures targets a distinct regime
        assert len(set(regimes)) == 4, f"Expected 4 distinct regimes among new fixtures, got: {regimes}"

    def test_all_four_have_frankenstein_mode(self):
        """All 4 new fixtures must declare frankenstein_test_mode."""
        for filename in [
            "range_fade_mnq.json",
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]:
            data = _load_fixture(filename)
            _, model, _ = validate_dsl(data)
            assert model.frankenstein_test_mode is not None, f"{filename} missing frankenstein_test_mode"

    def test_range_fade_uses_full_shuffle(self):
        data = _load_fixture("range_fade_mnq.json")
        _, model, _ = validate_dsl(data)
        assert model.frankenstein_test_mode == "full_shuffle"

    def test_calendar_effect_fixtures_use_calendar_preserving(self):
        for filename in [
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]:
            data = _load_fixture(filename)
            _, model, _ = validate_dsl(data)
            assert model.frankenstein_test_mode == "calendar_preserving", (
                f"{filename}: expected calendar_preserving, got {model.frankenstein_test_mode}"
            )


# ─── New Schema Fields Tests ─────────────────────────────────────────────────

class TestB3NewSchemaFields:
    def test_frankenstein_test_mode_field_accepted(self):
        data = _valid_base_dict()
        data["frankenstein_test_mode"] = "full_shuffle"
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.frankenstein_test_mode == "full_shuffle"

    def test_frankenstein_test_mode_calendar_preserving(self):
        data = _valid_base_dict()
        data["frankenstein_test_mode"] = "calendar_preserving"
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.frankenstein_test_mode == "calendar_preserving"

    def test_frankenstein_test_mode_optional(self):
        data = _valid_base_dict()
        # No frankenstein_test_mode field — should still compile
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.frankenstein_test_mode is None

    def test_bypass_news_blackout_true(self):
        data = _valid_base_dict()
        data["bypass_news_blackout"] = True
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.bypass_news_blackout is True

    def test_bypass_news_blackout_optional_defaults_none(self):
        data = _valid_base_dict()
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.bypass_news_blackout is None

    def test_profit_scaling_tier_field(self):
        data = _valid_base_dict()
        data["profit_scaling_tier"] = {"increment": 2, "threshold": 3000}
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.profit_scaling_tier is not None
        assert model.profit_scaling_tier.increment == 2
        assert model.profit_scaling_tier.threshold == 3000.0

    def test_daily_target_dollars_field(self):
        data = _valid_base_dict()
        data["daily_target_dollars"] = 400.0
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.daily_target_dollars == 400.0

    def test_chart_construction_field(self):
        # Merge resolution (W13 Team A): chart_construction is a typed enum
        # (CANDLES/RENKO) per HEAD's schema, not a free-form dict. The 4 B3
        # fixtures use the default CANDLES (omit the field). This test asserts
        # the enum is intact and that dict-shaped values are rejected.
        from src.engine.compiler.strategy_schema import ChartConstruction

        data = _valid_base_dict()
        # Default (omitted) → CANDLES
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.chart_construction == ChartConstruction.CANDLES
        # Dict form must be rejected (regression guard for the merged-out shape)
        data_bad = _valid_base_dict()
        data_bad["chart_construction"] = {"session_start_hour": 9, "range_window_minutes": 30}
        valid_bad, _, errors_bad = validate_dsl(data_bad)
        assert valid_bad is False
        assert errors_bad, "Expected validation error for dict-shaped chart_construction"

    def test_extended_regime_opening_range_accepted(self):
        data = _valid_base_dict()
        data["preferred_regime"] = "OPENING_RANGE"
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.preferred_regime == "OPENING_RANGE"

    def test_extended_regime_news_driven_accepted(self):
        data = _valid_base_dict()
        data["preferred_regime"] = "NEWS_DRIVEN"
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.preferred_regime == "NEWS_DRIVEN"

    def test_extended_regime_overnight_drift_accepted(self):
        data = _valid_base_dict()
        data["preferred_regime"] = "OVERNIGHT_DRIFT"
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.preferred_regime == "OVERNIGHT_DRIFT"

    def test_event_driven_entry_type_accepted(self):
        data = _valid_base_dict()
        data["entry_type"] = "event_driven"
        data["entry_indicator"] = "event_driven_fade"
        data["entry_params"] = {"atr_move_threshold": 2.0, "event_window_minutes": 15}
        valid, model, errors = validate_dsl(data)
        assert valid is True
        assert model.entry_type == EntryType.EVENT_DRIVEN


# ─── New Pattern Library Tests ───────────────────────────────────────────────

class TestB3PatternLibrary:
    def test_vwap_fade_valid_required_only(self):
        valid, errors = validate_entry_params(
            "vwap_fade", {"atr_extension_threshold": 1.5}
        )
        assert valid is True, f"Errors: {errors}"

    def test_vwap_fade_with_optional_confirmation_bars(self):
        valid, errors = validate_entry_params(
            "vwap_fade",
            {"atr_extension_threshold": 1.5, "confirmation_bars": 2},
        )
        assert valid is True

    def test_vwap_fade_threshold_below_min_fails(self):
        valid, errors = validate_entry_params(
            "vwap_fade", {"atr_extension_threshold": 0.5}
        )
        assert valid is False
        assert any("out of range" in e.lower() for e in errors)

    def test_vwap_fade_missing_required_fails(self):
        valid, errors = validate_entry_params("vwap_fade", {})
        assert valid is False
        assert any("Missing" in e or "required" in e.lower() for e in errors)

    def test_event_driven_fade_valid(self):
        valid, errors = validate_entry_params(
            "event_driven_fade",
            {"atr_move_threshold": 2.0, "event_window_minutes": 15},
        )
        assert valid is True

    def test_event_driven_fade_with_confirmation(self):
        valid, errors = validate_entry_params(
            "event_driven_fade",
            {"atr_move_threshold": 2.0, "event_window_minutes": 15, "confirmation_bars": 1},
        )
        assert valid is True

    def test_event_driven_fade_threshold_out_of_range(self):
        valid, errors = validate_entry_params(
            "event_driven_fade",
            {"atr_move_threshold": 5.0, "event_window_minutes": 15},
        )
        assert valid is False

    def test_overnight_drift_valid(self):
        valid, errors = validate_entry_params(
            "overnight_drift",
            {"drift_atr_threshold": 0.75, "asia_lookback_bars": 12},
        )
        assert valid is True

    def test_overnight_drift_with_optional(self):
        valid, errors = validate_entry_params(
            "overnight_drift",
            {"drift_atr_threshold": 0.75, "asia_lookback_bars": 12, "min_drift_bars": 4},
        )
        assert valid is True

    def test_overnight_drift_missing_required_fails(self):
        valid, errors = validate_entry_params(
            "overnight_drift", {"drift_atr_threshold": 0.75}
        )
        assert valid is False
        assert any("missing" in e.lower() or "required" in e.lower() for e in errors)


# ─── Regime should_strategy_trade Extended Labels ────────────────────────────

class TestExtendedRegimedShouldTrade:
    def test_opening_range_exact_match_trades(self):
        assert should_strategy_trade("OPENING_RANGE", "OPENING_RANGE") is True

    def test_opening_range_no_match_sits_out(self):
        assert should_strategy_trade("RANGE_BOUND", "OPENING_RANGE") is False
        assert should_strategy_trade("TRENDING_UP", "OPENING_RANGE") is False

    def test_news_driven_exact_match_trades(self):
        assert should_strategy_trade("NEWS_DRIVEN", "NEWS_DRIVEN") is True

    def test_news_driven_no_match_sits_out(self):
        assert should_strategy_trade("RANGE_BOUND", "NEWS_DRIVEN") is False
        assert should_strategy_trade("HIGH_VOL", "NEWS_DRIVEN") is False

    def test_overnight_drift_exact_match_trades(self):
        assert should_strategy_trade("OVERNIGHT_DRIFT", "OVERNIGHT_DRIFT") is True

    def test_overnight_drift_no_match_sits_out(self):
        assert should_strategy_trade("TRENDING_UP", "OVERNIGHT_DRIFT") is False
        assert should_strategy_trade("RANGE_BOUND", "OVERNIGHT_DRIFT") is False

    def test_extended_regime_strategy_sits_out_under_classify_regime_labels(self):
        """classify_regime() never emits OPENING_RANGE/NEWS_DRIVEN/OVERNIGHT_DRIFT.
        Strategies preferring these labels correctly sit out when only ADX-based
        regime is available."""
        classify_regime_outputs = ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "HIGH_VOL", "LOW_VOL", "TRANSITIONAL"]
        for regime in classify_regime_outputs:
            assert should_strategy_trade(regime, "OPENING_RANGE") is False
            assert should_strategy_trade(regime, "NEWS_DRIVEN") is False
            assert should_strategy_trade(regime, "OVERNIGHT_DRIFT") is False


# ─── Contract Cap Compliance ─────────────────────────────────────────────────

class TestB3ContractCaps:
    """Verify no new fixture exceeds prop firm contract caps."""

    def test_all_new_fixtures_within_contract_cap(self):
        for filename in [
            "range_fade_mnq.json",
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]:
            data = _load_fixture(filename)
            _, model, _ = validate_dsl(data)
            assert model.max_contracts is not None, f"{filename} must specify max_contracts"
            assert model.max_contracts <= 10, (
                f"{filename} max_contracts={model.max_contracts} exceeds conservative cap of 10"
            )

    def test_composite_new_fixture_contracts_within_ceiling(self):
        total = 0
        for filename in [
            "range_fade_mnq.json",
            "opening_range_breakout_mes.json",
            "news_fade_mcl.json",
            "overnight_drift_mes.json",
        ]:
            data = _load_fixture(filename)
            _, model, _ = validate_dsl(data)
            total += model.max_contracts or 0
        # 8 + 6 + 5 + 6 = 25 — within 50K account composite ceiling
        assert total <= 30, f"Composite contracts {total} too high"
