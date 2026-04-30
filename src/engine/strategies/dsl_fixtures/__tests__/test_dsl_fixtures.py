"""
Tests for DSL strategy archetype fixtures.

Validates that all three archetype fixtures (scalper_mes, trend_mnq, heavy_mcl)
are well-formed JSON and pass the existing DSL compiler validation.

Pass 1 (TDD): these tests are written BEFORE the fixture files exist — they will
fail initially and go green once the fixtures are created.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.engine.compiler.compiler import validate_dsl, compile_to_backtest

# Fixture directory is one level up from this test file
FIXTURE_DIR = Path(__file__).parent.parent


FIXTURE_FILES = [
    "scalper_mes.json",
    "trend_mnq.json",
    "heavy_mcl.json",
]

EXPECTED_SYMBOLS = {
    "scalper_mes.json": "MES",
    "trend_mnq.json": "MNQ",
    "heavy_mcl.json": "MCL",
}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _load_fixture(filename: str) -> dict:
    path = FIXTURE_DIR / filename
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ─── Test: all fixtures exist and are valid JSON ─────────────────────────────

class TestFixtureFilesExist:
    @pytest.mark.parametrize("filename", FIXTURE_FILES)
    def test_fixture_file_exists(self, filename: str):
        path = FIXTURE_DIR / filename
        assert path.exists(), f"Fixture file not found: {path}"

    @pytest.mark.parametrize("filename", FIXTURE_FILES)
    def test_fixture_is_valid_json(self, filename: str):
        """File must parse without error — catches malformed JSON early."""
        data = _load_fixture(filename)
        assert isinstance(data, dict), f"{filename} should be a JSON object"


# ─── Test: all fixtures pass DSL compiler validation ────────────────────────

class TestFixturesPassDSLValidation:
    @pytest.mark.parametrize("filename", FIXTURE_FILES)
    def test_fixture_validates_cleanly(self, filename: str):
        """Each fixture must pass validate_dsl() with zero errors."""
        data = _load_fixture(filename)
        valid, model, errors = validate_dsl(data)
        assert valid is True, (
            f"{filename} failed DSL validation. Errors:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )
        assert model is not None
        assert errors == []

    @pytest.mark.parametrize("filename", FIXTURE_FILES)
    def test_fixture_compiles_to_backtest_config(self, filename: str):
        """Each fixture must compile to a backtest-ready config without exception."""
        data = _load_fixture(filename)
        valid, model, errors = validate_dsl(data)
        assert valid is True, f"{filename} failed validation (precondition): {errors}"
        config = compile_to_backtest(model)
        assert "strategy" in config
        assert "entry_type" in config
        assert "exit_type" in config


# ─── Test: archetypes are uncorrelated (distinct markets) ──────────────────

class TestArchetypesUncorrelated:
    def test_all_three_fixtures_use_different_markets(self):
        """MES, MNQ, MCL are uncorrelated markets (correlation < 0.3 per CLAUDE.md).
        Each fixture must target a distinct symbol — deploying all three simultaneously
        is safe from a portfolio correlation standpoint."""
        symbols = set()
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            symbols.add(data["symbol"])
        assert len(symbols) == 3, (
            f"Expected 3 distinct symbols across fixtures, got: {symbols}"
        )

    @pytest.mark.parametrize("filename,expected_symbol", EXPECTED_SYMBOLS.items())
    def test_fixture_symbol_matches_filename(self, filename: str, expected_symbol: str):
        """Fixture name encodes the symbol — sanity-check they match."""
        data = _load_fixture(filename)
        assert data["symbol"] == expected_symbol, (
            f"{filename}: expected symbol={expected_symbol}, got {data['symbol']}"
        )

    def test_all_symbols_are_supported_by_engine(self):
        """All three symbols must be in the engine's supported set (MES, MNQ, MCL)."""
        supported = {"MES", "MNQ", "MCL"}
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            assert data["symbol"] in supported, (
                f"{filename}: symbol {data['symbol']!r} not in supported set {supported}"
            )


# ─── Test: contract count aggregate stays within prop firm limits ─────────

class TestNoOverlappingContracts:
    def test_aggregate_max_contracts_within_prop_limits(self):
        """If all three archetypes are deployed simultaneously, total max_contracts
        must not create an unacceptable aggregate position. Prop firm hard cap is
        tracked per-instrument, but total open contracts across the book should not
        exceed 30 (conservative composite ceiling for a 50K account)."""
        total = 0
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            # max_contracts is optional in the schema; default to 1 if absent
            total += data.get("max_contracts") or 1
        assert total <= 30, (
            f"Aggregate max_contracts={total} across all 3 archetypes exceeds "
            f"composite ceiling of 30 for a 50K prop account"
        )

    def test_no_fixture_exceeds_schema_max_contracts(self):
        """Schema caps max_contracts at 20 — no single archetype should hit the ceiling."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            mc = data.get("max_contracts")
            if mc is not None:
                assert mc <= 20, (
                    f"{filename}: max_contracts={mc} exceeds schema limit of 20"
                )


# ─── Test: key archetype characteristics ────────────────────────────────────

class TestArchetypeCharacteristics:
    def test_scalper_mes_has_tight_stop(self):
        """Scalper should be the tightest stop of all three archetypes."""
        scalper = _load_fixture("scalper_mes.json")
        trend = _load_fixture("trend_mnq.json")
        heavy = _load_fixture("heavy_mcl.json")
        assert scalper["stop_loss_atr_multiple"] <= trend["stop_loss_atr_multiple"]
        assert scalper["stop_loss_atr_multiple"] <= heavy["stop_loss_atr_multiple"]

    def test_scalper_mes_prefers_ranging_regime(self):
        """Scalper archetype targets range-bound / choppy conditions."""
        data = _load_fixture("scalper_mes.json")
        regime = data.get("preferred_regime", "")
        assert regime in ("RANGING", "RANGE_BOUND", "LOW_VOL"), (
            f"scalper_mes preferred_regime should be ranging/low-vol, got: {regime!r}"
        )

    def test_trend_mnq_prefers_trending_regime(self):
        """Trend-follow archetype targets directional conditions."""
        data = _load_fixture("trend_mnq.json")
        regime = data.get("preferred_regime", "")
        assert "TRENDING" in regime, (
            f"trend_mnq preferred_regime should include TRENDING, got: {regime!r}"
        )

    def test_heavy_mcl_has_wider_stop_than_scalper(self):
        """Oil archetype needs more room due to higher intraday noise."""
        scalper = _load_fixture("scalper_mes.json")
        heavy = _load_fixture("heavy_mcl.json")
        assert heavy["stop_loss_atr_multiple"] > scalper["stop_loss_atr_multiple"]

    def test_trend_mnq_uses_trailing_exit(self):
        """Trend-follow fixture must use trailing_stop exit to lock in trend profits."""
        data = _load_fixture("trend_mnq.json")
        assert data["exit_type"] == "trailing_stop", (
            f"trend_mnq should use trailing_stop exit, got: {data['exit_type']!r}"
        )

    def test_all_fixtures_have_preferred_regime(self):
        """Regime filter is mandatory per CLAUDE.md — every archetype must declare one."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            assert data.get("preferred_regime"), (
                f"{filename}: missing or empty preferred_regime (mandatory per CLAUDE.md)"
            )

    def test_all_fixtures_have_session_filter(self):
        """RTH-only filter protects against overnight gap risk and thin liquidity."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            session = data.get("session_filter")
            assert session is not None, f"{filename}: missing session_filter"
            assert session in ("RTH_ONLY", "ALL_SESSIONS"), (
                f"{filename}: unexpected session_filter {session!r}"
            )

    def test_all_fixtures_source_is_manual(self):
        """DSL fixtures are human-authored archetypes, not AI-generated."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            assert data.get("source") == "manual", (
                f"{filename}: source should be 'manual'"
            )


# ─── Test: profit_scaling_tier wired into schema (Cleanup Team D) ───────────

class TestProfitScalingTierWired:
    """ProfitScalingTier shipped via Pydantic schema (replaces former _pending tag).

    See `src/engine/compiler/strategy_schema.py::ProfitScalingTier` and CLAUDE.md
    'Profit-Based Position Scaling (W5a / Tier 5.4)'."""

    def test_pending_tag_no_longer_present(self):
        """The placeholder tag must be removed once the field exists."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            tags = data.get("tags", [])
            assert "profit_scaling_tier_pending" not in tags, (
                f"{filename}: 'profit_scaling_tier_pending' tag must be removed — the "
                f"profit_scaling_tier field now exists in the DSL schema"
            )

    def test_profit_scaling_tier_field_present(self):
        """Every archetype fixture must now declare the actual field."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            tier = data.get("profit_scaling_tier")
            assert tier is not None, (
                f"{filename}: profit_scaling_tier field is missing — fixtures must "
                f"emit the wired schema field"
            )
            assert isinstance(tier, dict), f"{filename}: profit_scaling_tier must be an object"
            assert tier.get("increment") == 2, (
                f"{filename}: profit_scaling_tier.increment should be 2 per CLAUDE.md "
                f"Gemini blueprint (every $3K -> +2 micro contracts)"
            )
            assert tier.get("threshold") == 3000, (
                f"{filename}: profit_scaling_tier.threshold should be 3000 per blueprint"
            )

    def test_profit_scaling_tier_passes_dsl_validation(self):
        """The wired schema must accept the fixture-declared field without error."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            valid, model, errors = validate_dsl(data)
            assert valid is True, (
                f"{filename}: validation failed after profit_scaling_tier add. "
                f"Errors: {errors}"
            )
            assert model is not None
            assert model.profit_scaling_tier is not None, (
                f"{filename}: parsed model.profit_scaling_tier should be set"
            )
            assert model.profit_scaling_tier.increment == 2
            assert model.profit_scaling_tier.threshold == 3000.0


class TestProfitScalingTierSchema:
    """ProfitScalingTier Pydantic model contract — direct validation tests."""

    def test_defaults_match_blueprint(self):
        from src.engine.compiler.strategy_schema import ProfitScalingTier
        tier = ProfitScalingTier()
        assert tier.increment == 2
        assert tier.threshold == 3000.0

    def test_extra_fields_forbidden(self):
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import ProfitScalingTier
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=2, threshold=3000, account_pnl_total=500)

    def test_increment_must_be_positive(self):
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import ProfitScalingTier
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=0, threshold=3000)
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=-1, threshold=3000)

    def test_threshold_must_be_positive(self):
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import ProfitScalingTier
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=2, threshold=0)
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=2, threshold=-100.0)

    def test_increment_upper_bound(self):
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import ProfitScalingTier
        ProfitScalingTier(increment=10, threshold=3000)  # ok
        with pytest.raises(ValidationError):
            ProfitScalingTier(increment=11, threshold=3000)

    def test_dsl_extra_forbid_still_blocks_unknown_root_keys(self):
        """Adding profit_scaling_tier must not weaken extra='forbid' on StrategyDSL."""
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import StrategyDSL
        bad = _load_fixture("scalper_mes.json")
        bad["totally_unknown_field"] = True
        with pytest.raises(ValidationError):
            StrategyDSL(**bad)

    def test_daily_target_dollars_optional_and_non_negative(self):
        from pydantic import ValidationError
        from src.engine.compiler.strategy_schema import StrategyDSL
        base = _load_fixture("scalper_mes.json")

        # Optional → omission is valid (and remove existing field if any)
        base.pop("daily_target_dollars", None)
        StrategyDSL(**base)

        # Setting it should validate
        with_target = {**base, "daily_target_dollars": 250.0}
        m = StrategyDSL(**with_target)
        assert m.daily_target_dollars == 250.0

        # Negative must be rejected
        with pytest.raises(ValidationError):
            StrategyDSL(**{**base, "daily_target_dollars": -1.0})
