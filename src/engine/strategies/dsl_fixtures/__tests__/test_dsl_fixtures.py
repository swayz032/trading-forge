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


# ─── Test: profit_scaling_tier annotation (Team A coordination) ─────────────

class TestProfitScalingTierAnnotation:
    def test_profit_scaling_tier_documented_in_fixture_tags(self):
        """profit_scaling_tier is not yet in the DSL schema (follow-up for Team A).
        Fixtures must carry 'profit_scaling_tier_pending' in tags so downstream
        systems know the field will be wired once Team A ships it."""
        for filename in FIXTURE_FILES:
            data = _load_fixture(filename)
            tags = data.get("tags", [])
            assert "profit_scaling_tier_pending" in tags, (
                f"{filename}: tags must include 'profit_scaling_tier_pending' to signal "
                f"that profit_scaling_tier wiring is deferred to Team A schema extension"
            )
