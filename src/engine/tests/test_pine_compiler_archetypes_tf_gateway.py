"""Pass 4.5 Track A — TF-gateway archetype Pine recipe tests (F-2 close).

Covers:
  - Every key in ARCHETYPE_PINE_RECIPE_TF_GATEWAY renders a non-empty Pine string
    containing all canonical TF-gateway payload fields.
  - action="archetype_signal" is the locked contract — no direction-specific names.
  - Archetype key is embedded as "archetype":"<key>" in the payload.
  - Backward-compat: gateway_mode=None / 'direct' produces the pre-Pass-4.5
    generic-signal payload (byte-identical to ARCHETYPE_PINE_RECIPE output).
  - Invalid gateway_mode raises ValueError immediately.
  - gateway_mode='tf_gateway' for unknown archetype key raises ValueError.
  - Spot-checks: silver_bullet, bounce_off_level, ict_bias_aligned_continuation.
  - End-to-end via _build_pine_indicator_var: reads gateway_mode from strategy config.
  - Count parity: ARCHETYPE_PINE_RECIPE_TF_GATEWAY length == ARCHETYPE_PINE_RECIPE length.

Export path: src/engine/pine_compiler.py
  _build_archetype_alert_pine(gateway_mode='tf_gateway')
  ARCHETYPE_PINE_RECIPE_TF_GATEWAY
  _build_pine_indicator_var(strategy={'config': {'gateway_mode': 'tf_gateway'}})

F-2 design contract (LOCKED):
  action="archetype_signal" (NOT enter_long / exit_long).
  Python engine (archetype_evaluator.py, Track C) resolves direction server-side.
  Track B (/api/live-order) accepts action="archetype_signal" and dispatches.
"""
from __future__ import annotations

import re

import pytest

from src.engine.pine_compiler import (
    ARCHETYPE_PINE_RECIPE,
    ARCHETYPE_PINE_RECIPE_TF_GATEWAY,
    _build_archetype_alert_pine,
    _build_pine_indicator_var,
)

# Canonical TF-gateway payload fields that MUST appear in every TF-gateway recipe.
# These match live-order.ts liveOrderPayloadSchema §archetype_signal mode.
TF_GATEWAY_REQUIRED_FIELDS = (
    "account_id",
    "strategy_id",
    "live_order_token",
    "timestamp_ms",
    "bar_timestamp",
    "archetype",
    "action",
    "ticker",
)

# Generic-signal payload fields present in the pre-Pass-4.5 (direct/None) recipes.
GENERIC_SIGNAL_FIELDS = (
    "strategyId",
    "archetype",
    "bar_timestamp",
    "action",
)

# ─── Count parity ─────────────────────────────────────────────────────────────


class TestRecipeCountParity:
    """ARCHETYPE_PINE_RECIPE_TF_GATEWAY must have identical count to ARCHETYPE_PINE_RECIPE."""

    def test_tf_gateway_count_equals_base_count(self):
        assert len(ARCHETYPE_PINE_RECIPE_TF_GATEWAY) == len(ARCHETYPE_PINE_RECIPE), (
            f"Count mismatch: ARCHETYPE_PINE_RECIPE_TF_GATEWAY has "
            f"{len(ARCHETYPE_PINE_RECIPE_TF_GATEWAY)} entries, "
            f"ARCHETYPE_PINE_RECIPE has {len(ARCHETYPE_PINE_RECIPE)} entries."
        )

    def test_tf_gateway_count_equals_39(self):
        """Canonical count is 39 matching ARCHETYPE_REGISTRY as of 2026-06-22."""
        assert len(ARCHETYPE_PINE_RECIPE_TF_GATEWAY) == 39, (
            f"Expected 39 TF-gateway recipes, got {len(ARCHETYPE_PINE_RECIPE_TF_GATEWAY)}"
        )

    def test_tf_gateway_keys_identical_to_base(self):
        """Every key in base map must appear in TF-gateway map and vice versa."""
        assert set(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()) == set(ARCHETYPE_PINE_RECIPE.keys()), (
            f"Key sets differ. In base only: "
            f"{set(ARCHETYPE_PINE_RECIPE.keys()) - set(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys())}. "
            f"In TF-gateway only: "
            f"{set(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()) - set(ARCHETYPE_PINE_RECIPE.keys())}."
        )


# ─── TF-gateway payload field presence ───────────────────────────────────────


class TestTfGatewayPayloadFields:
    """Every TF-gateway recipe must contain all canonical payload fields."""

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_non_empty(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert isinstance(pine, str)
        assert len(pine) > 50, f"TF-gateway recipe for '{key}' is suspiciously short"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_has_indicator_declaration(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert "indicator(" in pine, f"TF-gateway recipe for '{key}' missing indicator() call"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_has_alertcondition(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert "alertcondition(" in pine, f"TF-gateway recipe for '{key}' missing alertcondition()"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_has_plotshape(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert "plotshape(" in pine, f"TF-gateway recipe for '{key}' missing plotshape()"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_pine_version_header(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert pine.startswith("//@version=5"), (
            f"TF-gateway recipe for '{key}' does not start with //@version=5"
        )

    @pytest.mark.parametrize("field", TF_GATEWAY_REQUIRED_FIELDS)
    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_required_field_present(self, key: str, field: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert f'"{field}"' in pine, (
            f"TF-gateway recipe for '{key}' is missing required field '{field}'"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_action_is_archetype_signal(self, key: str):
        """action must be 'archetype_signal' — LOCKED F-2 contract."""
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert '"action":"archetype_signal"' in pine, (
            f"TF-gateway recipe for '{key}' does not contain "
            "locked action 'archetype_signal'. "
            "This is the F-2 close contract — direction-specific names are forbidden."
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_archetype_key_embedded(self, key: str):
        """Each recipe must embed its own key in the alertcondition payload."""
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert f'"archetype":"{key}"' in pine, (
            f"TF-gateway recipe for '{key}' does not embed its key in alertcondition message"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_no_python_fstring_artifacts(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert not re.search(r"\{[0-9]+\}", pine), (
            f"TF-gateway recipe for '{key}' contains positional format placeholder"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_no_merge_conflict_markers(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        for marker in ("<<<<<<", "=======", ">>>>>>>"):
            assert marker not in pine, (
                f"TF-gateway recipe for '{key}' contains merge conflict marker"
            )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE_TF_GATEWAY.keys()))
    def test_placeholder_present(self, key: str):
        """Operator-substituted placeholders must be present."""
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        assert "<account-id-placeholder>" in pine, (
            f"TF-gateway recipe for '{key}' missing <account-id-placeholder>"
        )
        assert "<live-order-token-placeholder>" in pine, (
            f"TF-gateway recipe for '{key}' missing <live-order-token-placeholder>"
        )


# ─── Backward-compatibility: generic-signal payload ──────────────────────────


class TestBackwardCompatGenericSignal:
    """gateway_mode=None and 'direct' must produce the pre-Pass-4.5 generic-signal payload.

    The output must be byte-identical to ARCHETYPE_PINE_RECIPE (no TF-gateway fields).
    """

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_none_gateway_mode_identical_to_base_recipe(self, key: str):
        """_build_archetype_alert_pine with gateway_mode=None == ARCHETYPE_PINE_RECIPE[key]."""
        display_name = key.replace("_", " ").title()
        # Reconstruct display name properly — same logic as _ARCHETYPE_ENTRIES
        # Use the base recipe as the source of truth for exact display name
        base = ARCHETYPE_PINE_RECIPE[key]
        result = _build_archetype_alert_pine(key, display_name, gateway_mode=None)
        # Must have generic-signal fields
        assert '"action":"signal"' in result, (
            f"gateway_mode=None recipe for '{key}' does not contain generic action 'signal'"
        )
        assert f'"archetype":"{key}"' in result, (
            f"gateway_mode=None recipe for '{key}' does not embed archetype key"
        )
        # Must NOT have TF-gateway fields
        assert "account_id" not in result, (
            f"gateway_mode=None recipe for '{key}' unexpectedly contains 'account_id'"
        )
        assert "live_order_token" not in result, (
            f"gateway_mode=None recipe for '{key}' unexpectedly contains 'live_order_token'"
        )
        assert "archetype_signal" not in result, (
            f"gateway_mode=None recipe for '{key}' unexpectedly contains 'archetype_signal'"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_direct_gateway_mode_identical_to_none(self, key: str):
        """gateway_mode='direct' must produce the same output as gateway_mode=None."""
        display_name = key.replace("_", " ").title()
        result_none = _build_archetype_alert_pine(key, display_name, gateway_mode=None)
        result_direct = _build_archetype_alert_pine(key, display_name, gateway_mode="direct")
        assert result_none == result_direct, (
            f"gateway_mode='direct' and gateway_mode=None produce different output for '{key}'"
        )


# ─── Invalid gateway_mode raises ValueError ────────────────────────────────────


class TestInvalidGatewayModeRaisesError:
    """Any unrecognized gateway_mode must raise ValueError immediately."""

    @pytest.mark.parametrize("bad_mode", [
        "live",
        "tf-gateway",  # hyphen instead of underscore
        "TF_GATEWAY",  # wrong case
        "broker_direct",
        "",
        "traderspost",
    ])
    def test_invalid_mode_raises_value_error(self, bad_mode: str):
        with pytest.raises(ValueError, match="Invalid gateway_mode"):
            _build_archetype_alert_pine("silver_bullet", "Silver Bullet", gateway_mode=bad_mode)

    def test_unknown_archetype_key_tf_gateway_raises_value_error(self):
        """gateway_mode='tf_gateway' for unknown archetype key must raise ValueError."""
        from src.engine.pine_compiler import (
            _VALID_ARCHETYPE_GATEWAY_MODES,  # noqa: PLC0415
        )
        assert "tf_gateway" in _VALID_ARCHETYPE_GATEWAY_MODES  # sanity
        with pytest.raises(ValueError, match="Unknown archetype"):
            _build_pine_indicator_var(
                "archetype:nonexistent_archetype_xyzzy",
                {},
                0,
                strategy={"config": {"gateway_mode": "tf_gateway"}},
            )


# ─── Spot-checks ──────────────────────────────────────────────────────────────


class TestSpotChecks:
    """Spot-check specific archetype keys for correctness."""

    def test_silver_bullet_contains_archetype_key(self):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY["silver_bullet"]
        assert '"archetype":"silver_bullet"' in pine, (
            "silver_bullet TF-gateway recipe does not embed its key"
        )

    def test_silver_bullet_action_is_archetype_signal(self):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY["silver_bullet"]
        assert '"action":"archetype_signal"' in pine, (
            "silver_bullet TF-gateway recipe does not use 'archetype_signal' action"
        )

    def test_silver_bullet_no_direction_specific_action(self):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY["silver_bullet"]
        # Direction-specific actions are forbidden — locked F-2 contract
        assert '"action":"enter_long"' not in pine
        assert '"action":"enter_short"' not in pine
        assert '"action":"exit_long"' not in pine
        assert '"action":"exit_short"' not in pine

    def test_bounce_off_level_action_archetype_signal(self):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY["bounce_off_level"]
        assert '"action":"archetype_signal"' in pine

    def test_ict_bias_aligned_continuation_action_archetype_signal(self):
        pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY["ict_bias_aligned_continuation"]
        assert '"action":"archetype_signal"' in pine

    def test_three_distinct_archetypes_emit_archetype_signal(self):
        """silver_bullet, bounce_off_level, ict_bias_aligned_continuation all use archetype_signal."""
        for key in ("silver_bullet", "bounce_off_level", "ict_bias_aligned_continuation"):
            pine = ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
            assert '"action":"archetype_signal"' in pine, (
                f"'{key}' TF-gateway recipe does not use locked action 'archetype_signal'"
            )


# ─── End-to-end via _build_pine_indicator_var ─────────────────────────────────


class TestBuildPineIndicatorVarEndToEnd:
    """_build_pine_indicator_var with strategy config reads gateway_mode correctly."""

    def test_tf_gateway_returns_tf_gateway_recipe(self):
        """strategy.config.gateway_mode='tf_gateway' → returns TF-gateway recipe."""
        strategy = {"config": {"gateway_mode": "tf_gateway"}}
        var_name, pine = _build_pine_indicator_var(
            "archetype:silver_bullet", {}, 0, strategy=strategy
        )
        assert var_name == "archetype_silver_bullet"
        assert pine == ARCHETYPE_PINE_RECIPE_TF_GATEWAY["silver_bullet"]
        assert '"action":"archetype_signal"' in pine

    def test_none_config_returns_base_recipe(self):
        """strategy with no gateway_mode in config → returns base (backward-compat) recipe."""
        strategy = {"config": {}}
        var_name, pine = _build_pine_indicator_var(
            "archetype:silver_bullet", {}, 0, strategy=strategy
        )
        assert var_name == "archetype_silver_bullet"
        assert pine == ARCHETYPE_PINE_RECIPE["silver_bullet"]
        assert '"action":"signal"' in pine

    def test_no_strategy_arg_returns_base_recipe(self):
        """No strategy arg (legacy callers) → returns base (backward-compat) recipe."""
        var_name, pine = _build_pine_indicator_var(
            "archetype:silver_bullet", {}, 0
        )
        assert var_name == "archetype_silver_bullet"
        assert pine == ARCHETYPE_PINE_RECIPE["silver_bullet"]

    def test_direct_gateway_mode_returns_base_recipe(self):
        """gateway_mode='direct' → returns base (backward-compat) recipe."""
        strategy = {"config": {"gateway_mode": "direct"}}
        var_name, pine = _build_pine_indicator_var(
            "archetype:bounce_off_level", {}, 0, strategy=strategy
        )
        assert pine == ARCHETYPE_PINE_RECIPE["bounce_off_level"]

    def test_tf_gateway_unknown_key_raises_value_error(self):
        """tf_gateway mode with unknown archetype key raises ValueError."""
        strategy = {"config": {"gateway_mode": "tf_gateway"}}
        with pytest.raises(ValueError, match="Unknown archetype"):
            _build_pine_indicator_var("archetype:ghost_key", {}, 0, strategy=strategy)

    def test_uncatalogued_tf_gateway_mode(self):
        """uncatalogued: prefix also threads gateway_mode through."""
        strategy = {"config": {"gateway_mode": "tf_gateway"}}
        var_name, pine = _build_pine_indicator_var(
            "uncatalogued:smashed_candle", {}, 0, strategy=strategy
        )
        assert var_name == "uncatalogued_smashed_candle"
        # TF-gateway uncatalogued must contain archetype_signal action
        assert '"action":"archetype_signal"' in pine
        # Must contain the synthetic key
        assert '"archetype":"uncatalogued_smashed_candle"' in pine

    def test_uncatalogued_no_gateway_mode(self):
        """uncatalogued: with no gateway_mode → generic-signal backward-compat."""
        var_name, pine = _build_pine_indicator_var(
            "uncatalogued:smashed_candle", {}, 0
        )
        assert '"action":"signal"' in pine
        assert '"action":"archetype_signal"' not in pine

    def test_tf_gateway_all_archetype_keys_resolve(self):
        """All 39 keys from ARCHETYPE_PINE_RECIPE resolve cleanly in tf_gateway mode."""
        strategy = {"config": {"gateway_mode": "tf_gateway"}}
        for key in ARCHETYPE_PINE_RECIPE:
            var_name, pine = _build_pine_indicator_var(
                f"archetype:{key}", {}, 0, strategy=strategy
            )
            assert f"archetype_{key}" == var_name
            assert '"action":"archetype_signal"' in pine, (
                f"Key '{key}' did not produce archetype_signal action in tf_gateway mode"
            )

    def test_regular_indicator_unaffected(self):
        """Regular indicator types are not affected by the new gateway_mode parameter."""
        strategy = {"config": {"gateway_mode": "tf_gateway"}}
        var_name, pine = _build_pine_indicator_var("sma", {"period": 20}, 0, strategy=strategy)
        assert "ta.sma" in pine
        assert var_name == "ind_sma_0"


# ─── Factory function direct tests ───────────────────────────────────────────


class TestBuildArchetypeAlertPineTfGateway:
    """Direct tests on _build_archetype_alert_pine with gateway_mode='tf_gateway'."""

    def test_overlay_true(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "overlay=true" in pine

    def test_archetype_active_declared(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "archetype_active = true" in pine

    def test_alert_references_archetype_active(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "alertcondition(archetype_active" in pine

    def test_plotshape_references_archetype_active(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "plotshape(archetype_active" in pine

    def test_action_is_archetype_signal(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert '"action":"archetype_signal"' in pine

    def test_timenow_placeholder_present(self):
        """Pine {{timenow}} placeholder must appear for timestamp_ms field."""
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        # {{timenow}} renders as literal {{timenow}} in the Pine string (TradingView resolves it)
        assert "timenow" in pine

    def test_time_placeholder_present(self):
        """Pine {{time}} placeholder must appear for bar_timestamp field."""
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "time" in pine

    def test_pine_version_header(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert pine.startswith("//@version=5")

    def test_gateway_mode_none_produces_original_signal_action(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode=None)
        assert '"action":"signal"' in pine

    def test_gateway_mode_direct_produces_original_signal_action(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="direct")
        assert '"action":"signal"' in pine

    def test_gateway_mode_invalid_raises_immediately(self):
        with pytest.raises(ValueError, match="Invalid gateway_mode"):
            _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="invalid")

    def test_tf_gateway_display_includes_gw_suffix(self):
        """TF-gateway indicator title includes [GW] suffix to distinguish in TV."""
        pine = _build_archetype_alert_pine("test_key", "Test Key", gateway_mode="tf_gateway")
        assert "[GW]" in pine or "TF Archetype [GW]" in pine
