"""Tests for the strategy validation system — static + runtime validators."""

import polars as pl
import pytest
from datetime import datetime, timedelta

from src.engine.validation import (
    ConceptSpec,
    TimeWindow,
    ValidationResult,
    load_spec,
    validate_static_from_code,
    validate_runtime,
    STRATEGY_CONCEPT_MAP,
    list_specs,
)


# ─── Test Helpers ─────────────────────────────────────────────────

def _make_code_with_imports(*imports: str) -> str:
    """Generate minimal Python code with specified imports."""
    lines = []
    for imp in imports:
        lines.append(f"from some.module import {imp}")
    lines.append("class FakeStrategy:")
    lines.append("    pass")
    return "\n".join(lines)


def _make_sb_style_code() -> str:
    """Generate code that looks like a valid Silver Bullet strategy."""
    return """
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import is_silver_bullet_nyam, is_silver_bullet_nypm, is_silver_bullet_london

class SilverBulletStrategy:
    def compute(self, df):
        fvgs = detect_fvg(df)
        nyam = is_silver_bullet_nyam(df["ts_event"])
        # hours 10, 14, 3
        if hour == 10 or hour == 14 or hour == 3:
            pass
"""


def _make_wrong_sb_code() -> str:
    """Generate code that wrongly uses wide killzones (old broken version)."""
    return """
from src.engine.indicators.price_delivery import detect_fvg
from src.engine.indicators.sessions import is_nyam_killzone, is_london_killzone

class SilverBulletStrategy:
    def compute(self, df):
        fvgs = detect_fvg(df)
        nyam = is_nyam_killzone(df["ts_event"])
"""


def _make_smt_rsi_code() -> str:
    """Generate code that wrongly uses RSI for SMT (old broken version)."""
    return """
from src.engine.indicators.core import compute_rsi
from src.engine.indicators.market_structure import detect_mss

class SMTReversalStrategy:
    def compute(self, df):
        rsi = compute_rsi(df["close"], 14)
"""


def _make_signal_df(n=100, entry_pct=0.05, window_hours=(10,)):
    """Create a DataFrame with signals in specific time windows."""
    base_time = datetime(2024, 3, 15, 0, 0)
    dates = [base_time + timedelta(minutes=i * 5) for i in range(n)]
    entry_long = [False] * n
    entry_short = [False] * n

    for i in range(n):
        h = dates[i].hour
        if h in window_hours and i % int(1 / entry_pct) == 0:
            entry_long[i] = True

    return pl.DataFrame({
        "ts_event": dates,
        "open": [100.0] * n,
        "high": [101.0] * n,
        "low": [99.0] * n,
        "close": [100.5] * n,
        "volume": [1000] * n,
        "entry_long": entry_long,
        "entry_short": entry_short,
        "exit_long": [False] * n,
        "exit_short": [False] * n,
    })


# ─── Spec Loading Tests ──────────────────────────────────────────

class TestSpecLoading:
    def test_load_known_spec(self):
        spec = load_spec("silver_bullet")
        assert spec.concept == "silver_bullet"
        assert len(spec.required_time_windows) == 3
        assert "detect_fvg" in spec.required_imports

    def test_load_nonexistent_spec_raises(self):
        with pytest.raises(FileNotFoundError):
            load_spec("nonexistent_concept")

    def test_list_specs_returns_all(self):
        specs = list_specs()
        assert "silver_bullet" in specs
        assert "smt_reversal" in specs
        assert len(specs) >= 10

    def test_strategy_concept_map_complete(self):
        for concept in ["silver_bullet", "smt_reversal", "judas_swing", "ict_2022"]:
            assert concept in STRATEGY_CONCEPT_MAP.values()


# ─── Static Validator Tests ───────────────────────────────────────

class TestStaticValidator:
    def test_correct_sb_passes(self):
        spec = load_spec("silver_bullet")
        result = validate_static_from_code(_make_sb_style_code(), spec)
        assert result.passed, f"Should pass: {result.errors}"

    def test_wrong_sb_uses_wide_killzone_fails(self):
        spec = load_spec("silver_bullet")
        result = validate_static_from_code(_make_wrong_sb_code(), spec)
        assert not result.passed
        assert any("is_nyam_killzone" in e for e in result.errors)

    def test_smt_using_rsi_fails(self):
        spec = load_spec("smt_reversal")
        result = validate_static_from_code(_make_smt_rsi_code(), spec)
        assert not result.passed
        assert any("compute_rsi" in e or "smt_divergence" in e for e in result.errors)

    def test_missing_required_import_fails(self):
        spec = ConceptSpec(
            concept="test",
            required_imports=["detect_fvg", "detect_mss"],
        )
        code = _make_code_with_imports("detect_fvg")
        result = validate_static_from_code(code, spec)
        assert not result.passed
        assert any("detect_mss" in e for e in result.errors)

    def test_forbidden_import_fails(self):
        spec = ConceptSpec(
            concept="test",
            forbidden_imports=["compute_rsi"],
        )
        code = _make_code_with_imports("compute_rsi")
        result = validate_static_from_code(code, spec)
        assert not result.passed
        assert any("compute_rsi" in e for e in result.errors)

    def test_syntax_error_fails(self):
        spec = ConceptSpec(concept="test")
        result = validate_static_from_code("def broken(:", spec)
        assert not result.passed
        assert any("Syntax" in e for e in result.errors)


# ─── Runtime Validator Tests ──────────────────────────────────────

class TestRuntimeValidator:
    def test_signals_in_correct_window_passes(self):
        spec = load_spec("silver_bullet")
        # Signals only at hour 10 (Silver Bullet NY AM window)
        df = _make_signal_df(n=200, entry_pct=0.1, window_hours=(10,))
        result = validate_runtime(df, spec)
        assert result.passed, f"Should pass: {result.errors}"

    def test_signals_outside_window_fails(self):
        spec = load_spec("silver_bullet")
        spec.runtime_assertions = ["all_entries_in_windows"]
        # Signals at hour 8 (outside SB windows)
        df = _make_signal_df(n=200, entry_pct=0.1, window_hours=(8,))
        result = validate_runtime(df, spec)
        assert not result.passed
        assert any("outside" in e.lower() for e in result.errors)

    def test_zero_signals_fails(self):
        spec = ConceptSpec(
            concept="test",
            runtime_assertions=["signal_count_nonzero"],
        )
        df = _make_signal_df(n=100, entry_pct=0.0, window_hours=())
        # Override to have zero entries
        df = df.with_columns([
            pl.lit(False).alias("entry_long"),
            pl.lit(False).alias("entry_short"),
        ])
        result = validate_runtime(df, spec)
        assert not result.passed
        assert any("Zero" in e for e in result.errors)

    def test_excessive_signal_density_fails(self):
        spec = ConceptSpec(
            concept="test",
            runtime_assertions=["signal_density_reasonable"],
        )
        # Every bar has a signal = 100% density
        n = 100
        df = pl.DataFrame({
            "entry_long": [True] * n,
            "entry_short": [False] * n,
            "exit_long": [False] * n,
            "exit_short": [False] * n,
        })
        result = validate_runtime(df, spec)
        assert not result.passed
        assert any("density" in e.lower() for e in result.errors)
