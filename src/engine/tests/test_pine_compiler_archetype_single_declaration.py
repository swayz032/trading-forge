"""Deep-Scan #18b P-1 (CRITICAL) — archetype Pine must have exactly ONE top-level
declaration.

Bug fixed: entry_indicator values prefixed 'archetype:' or 'uncatalogued:' (39
registered archetype keys — the majority of the live strategy library) used to
compile through compile_strategy() / compile_dual_artifacts() into a .pine file
containing TWO indicator()/strategy() declarations: the generic scaffold each
compiler entry point assembles, wrapped AROUND the complete, self-contained
archetype recipe text (which itself starts with //@version=5 + its own
indicator() call). TradingView rejects any script with more than one top-level
declaration — every archetype-governed strategy failed to compile, 100% of
the time, on the live execution path (TradingView Pine -> TradersPost ->
Tradovate).

The prior test suite (test_pine_compiler_archetypes.py) only asserted
substring presence (`"indicator(" in pine`), which is true even when the
string appears twice — it could not have caught this bug. This file counts
occurrences instead of checking membership, and exercises the actual
compiler ENTRY POINTS (compile_strategy, compile_dual_artifacts) rather than
the internal recipe dict directly.

Export path: src/engine/pine_compiler.py
  compile_strategy()
  compile_dual_artifacts()
  _resolve_archetype_prefix()          (new — detection helper)
  _compile_archetype_only()            (new — compile_strategy short-circuit)
  _compile_dual_archetype_only()       (new — compile_dual_artifacts short-circuit)
"""
from __future__ import annotations

import re

from src.engine.pine_compiler import compile_dual_artifacts, compile_strategy

DECLARATION_LINE_RE = re.compile(r"^(indicator|strategy|library)\s*\(")
VERSION_RE = re.compile(r"//@version=5")


def _count_declarations(pine: str) -> int:
    """Count top-level indicator()/strategy()/library() DECLARATION STATEMENTS
    in a Pine script — not mere substring occurrences of the word.

    Pine's top-level indicator()/strategy()/library() declaration is always a
    bare statement starting at column zero (no leading whitespace, no
    assignment, no comment prefix) — it is the required first executable
    statement of a script. This walks non-comment lines and matches only
    that shape, so header-comment prose that happens to mention the word
    (e.g. "// Pine v5 : indicator() only — alert-based") is correctly
    excluded. A naive `"indicator(" in pine` substring check (the ORIGINAL
    bug's blind spot — see test_pine_compiler_archetypes.py) is true even
    when the string appears twice, which is exactly why that check could
    not have caught Deep-Scan #18b P-1.
    """
    count = 0
    for raw_line in pine.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue
        if DECLARATION_LINE_RE.match(line):
            count += 1
    return count


def _archetype_strategy(
    key: str = "ict_silver_bullet_ny_am",
    gateway_mode: str | None = None,
    export_type: str = "pine_indicator",
) -> dict:
    """Minimal StrategyDSL dict for an archetype-governed strategy.

    Shape matches real graduated strategies: entry_indicator carries the
    canonical 'archetype:<key>' form; indicators[] mirrors it (as the
    graduator + pine-export-service.ts actually populate it).
    """
    config: dict = {}
    if gateway_mode is not None:
        config["gateway_mode"] = gateway_mode
    return {
        "name": f"Test Archetype {key}",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_indicator": f"archetype:{key}",
        "entry_type": "trend_follow",
        "stop_loss_atr_multiple": 1.5,
        "session_filter": "us",
        "indicators": [{"type": f"archetype:{key}"}],
        "export_type": export_type,
        "config": config,
    }


def _non_archetype_strategy() -> dict:
    """Minimal StrategyDSL dict for an ordinary (non-archetype) strategy —
    regression guard that the fix does not alter the non-archetype path."""
    return {
        "name": "Test SMA Cross Regression",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_indicator": "sma_crossover",
        "entry_long": "close > ind_sma_0",
        "entry_short": "close < ind_sma_0",
        "stop_loss_atr_multiple": 1.5,
        "take_profit_atr_multiple": 2.0,
        "session_filter": "us",
        "indicators": [{"type": "sma", "period": 20}],
        "config": {},
    }


# ─── compile_strategy() — archetype path ──────────────────────────────────────

class TestCompileStrategyArchetypeSingleDeclaration:

    def test_archetype_default_export_produces_single_indicator_declaration(self):
        strategy = _archetype_strategy()
        result = compile_strategy(strategy)

        assert result.exportability.exportable is True
        pine_artifacts = [a for a in result.artifacts if a.artifact_type != "alerts_json"]
        assert len(pine_artifacts) == 1, (
            f"Expected exactly 1 Pine artifact for an archetype strategy, got "
            f"{len(pine_artifacts)}: {[a.artifact_type for a in pine_artifacts]}"
        )
        pine = pine_artifacts[0].content
        assert _count_declarations(pine) == 1, (
            f"Archetype Pine has {_count_declarations(pine)} top-level "
            f"indicator()/strategy()/library() declarations — TradingView "
            f"rejects any script with more than one. Content:\n{pine}"
        )
        assert len(VERSION_RE.findall(pine)) == 1, (
            "Archetype Pine must have exactly one //@version=5 header"
        )

    def test_archetype_tf_gateway_produces_single_declaration(self):
        strategy = _archetype_strategy(gateway_mode="tf_gateway")
        result = compile_strategy(strategy)

        pine_artifacts = [a for a in result.artifacts if a.artifact_type != "alerts_json"]
        assert len(pine_artifacts) == 1
        pine = pine_artifacts[0].content
        assert _count_declarations(pine) == 1
        assert "archetype_signal" in pine

    def test_archetype_alert_only_export_type_emits_no_pine_file(self):
        """export_type='alert_only' skips the Pine file entirely (existing contract)."""
        strategy = _archetype_strategy(export_type="alert_only")
        result = compile_strategy(strategy)

        pine_artifacts = [a for a in result.artifacts if a.artifact_type != "alerts_json"]
        assert len(pine_artifacts) == 0
        alerts_artifacts = [a for a in result.artifacts if a.artifact_type == "alerts_json"]
        assert len(alerts_artifacts) == 1

    def test_archetype_uncatalogued_prefix_single_declaration(self):
        strategy = {
            "name": "Test Uncatalogued Term",
            "symbol": "MNQ",
            "timeframe": "5m",
            "direction": "both",
            "entry_indicator": "uncatalogued:smashed_candle",
            "stop_loss_atr_multiple": 1.5,
            "indicators": [{"type": "uncatalogued:smashed_candle"}],
            "config": {},
        }
        result = compile_strategy(strategy)

        pine_artifacts = [a for a in result.artifacts if a.artifact_type != "alerts_json"]
        assert len(pine_artifacts) == 1
        assert _count_declarations(pine_artifacts[0].content) == 1


# ─── compile_dual_artifacts() — archetype path (THE live execution path) ─────

class TestCompileDualArtifactsArchetypeSingleDeclaration:

    def test_archetype_dual_artifacts_indicator_has_single_declaration(self):
        strategy = _archetype_strategy()
        result = compile_dual_artifacts(strategy)

        assert result.exportable is True
        assert result.indicator_artifact is not None, (
            "Archetype strategy must produce an indicator_artifact"
        )
        pine = result.indicator_artifact.content
        assert _count_declarations(pine) == 1, (
            f"Archetype dual-artifact indicator Pine has "
            f"{_count_declarations(pine)} top-level declarations — this is "
            f"the Deep-Scan #18b P-1 bug (nested indicator()/strategy() -> "
            f"invalid Pine, 100% TradingView compile failure). Content:\n{pine}"
        )
        assert len(VERSION_RE.findall(pine)) == 1

    def test_archetype_dual_artifacts_no_fabricated_strategy_artifact(self):
        """No strategy_artifact is fabricated for archetypes — explicit
        degradation (documented in degradation_notes), not fake equivalence."""
        strategy = _archetype_strategy()
        result = compile_dual_artifacts(strategy)

        assert result.strategy_artifact is None
        assert any(
            "archetype_strategy_alert_only" in note for note in result.degradation_notes
        )

    def test_archetype_dual_artifacts_with_tf_gateway_and_credentials(self):
        """The live production path: gateway_mode=tf_gateway + compile-time
        credential substitution, exercised through compile_dual_artifacts()
        exactly as pine-export-service.ts invokes it."""
        strategy = _archetype_strategy(gateway_mode="tf_gateway")
        result = compile_dual_artifacts(
            strategy,
            account_id="acct-test-123",
            live_order_token="tok-test-456",
        )

        assert result.indicator_artifact is not None
        pine = result.indicator_artifact.content
        assert _count_declarations(pine) == 1
        assert "acct-test-123" in pine
        assert "tok-test-456" in pine
        assert "<account-id-placeholder>" not in pine
        assert "<live-order-token-placeholder>" not in pine

    def test_archetype_dual_artifacts_alerts_json_present(self):
        strategy = _archetype_strategy()
        result = compile_dual_artifacts(strategy)

        assert result.alerts_artifact is not None
        import json
        alerts = json.loads(result.alerts_artifact.content)
        assert alerts["archetype"] == "ict_silver_bullet_ny_am"


# ─── Regression guard — non-archetype path is unchanged ───────────────────────

class TestNonArchetypeRegressionGuard:
    """The fix must not alter ordinary indicator compilation."""

    def test_non_archetype_compile_strategy_single_declaration(self):
        strategy = _non_archetype_strategy()
        result = compile_strategy(strategy)

        assert result.exportability.exportable is True
        pine_artifacts = [a for a in result.artifacts if a.artifact_type != "alerts_json"]
        assert len(pine_artifacts) >= 1
        for artifact in pine_artifacts:
            assert _count_declarations(artifact.content) == 1, (
                f"Non-archetype artifact '{artifact.artifact_type}' has "
                f"{_count_declarations(artifact.content)} declarations — regression"
            )

    def test_non_archetype_compile_dual_artifacts_both_valid(self):
        strategy = _non_archetype_strategy()
        result = compile_dual_artifacts(strategy)

        assert result.exportable is True
        assert result.indicator_artifact is not None
        assert result.strategy_artifact is not None, (
            "Non-archetype strategies must still receive a strategy_artifact — "
            "regression check for the P-1 fix scope"
        )
        assert _count_declarations(result.indicator_artifact.content) == 1
        assert _count_declarations(result.strategy_artifact.content) == 1
        # No archetype degradation note should appear on a non-archetype strategy.
        assert not any(
            "archetype_strategy_alert_only" in note for note in result.degradation_notes
        )
