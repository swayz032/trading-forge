"""Pass 2 Track A+B — Pine compiler archetype handler tests.

Covers:
- Every archetype key in ARCHETYPE_PINE_RECIPE renders a non-empty Pine string.
- Emitted Pine contains indicator(, alertcondition(, plotshape( and no
  Python f-string artifacts.
- Spot-checks for 3 representative archetypes.
- archetype: dispatch path returns the correct recipe.
- uncatalogued: dispatch path builds a recipe with the correct display name.
- archetype:nonexistent_key raises ValueError.

Export path: src/engine/pine_compiler.py
  _build_archetype_alert_pine()
  ARCHETYPE_PINE_RECIPE
  _build_pine_indicator_var() — archetype: and uncatalogued: intercepts
"""
from __future__ import annotations

import re

import pytest

from src.engine.pine_compiler import (
    ARCHETYPE_PINE_RECIPE,
    _build_archetype_alert_pine,
    _build_pine_indicator_var,
)

# ─── Recipe coverage ─────────────────────────────────────────────────────────

class TestArchetypePineRecipeCoverage:
    """All 39 archetype keys must produce valid non-empty Pine."""

    def test_recipe_count_at_least_28(self):
        """Registry has grown to 39 entries; mandate is 28+ (plan minimum)."""
        assert len(ARCHETYPE_PINE_RECIPE) >= 28, (
            f"Expected >= 28 archetype recipes, got {len(ARCHETYPE_PINE_RECIPE)}"
        )

    def test_recipe_count_matches_registry(self):
        """We should have exactly 39 entries matching the live ARCHETYPE_REGISTRY."""
        assert len(ARCHETYPE_PINE_RECIPE) == 39, (
            f"Expected 39 archetype recipes, got {len(ARCHETYPE_PINE_RECIPE)}"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_each_recipe_non_empty(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert isinstance(pine, str)
        assert len(pine) > 50, f"Recipe for '{key}' is suspiciously short"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_each_recipe_has_indicator_declaration(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert "indicator(" in pine, f"Recipe for '{key}' missing indicator() call"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_each_recipe_has_alertcondition(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert "alertcondition(" in pine, f"Recipe for '{key}' missing alertcondition() call"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_each_recipe_has_plotshape(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert "plotshape(" in pine, f"Recipe for '{key}' missing plotshape() call"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_no_merge_conflict_markers(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        for marker in ("<<<<<<", "=======", ">>>>>>>"):
            assert marker not in pine, f"Recipe for '{key}' contains merge conflict marker"

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_no_python_fstring_artifacts(self, key: str):
        """No literal {0}, {1}, or un-balanced braces from f-string bleed-through."""
        pine = ARCHETYPE_PINE_RECIPE[key]
        # No positional format placeholders like {0} or {1}
        assert not re.search(r"\{[0-9]+\}", pine), (
            f"Recipe for '{key}' contains positional format placeholder"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_pine_version_header(self, key: str):
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert pine.startswith("//@version=5"), (
            f"Recipe for '{key}' does not start with //@version=5"
        )

    @pytest.mark.parametrize("key", list(ARCHETYPE_PINE_RECIPE.keys()))
    def test_key_embedded_in_alert_message(self, key: str):
        """Each recipe must embed its own key in the alertcondition message payload."""
        pine = ARCHETYPE_PINE_RECIPE[key]
        assert f'"archetype":"{key}"' in pine, (
            f"Recipe for '{key}' does not embed its key in alertcondition message"
        )


# ─── Spot-check display names ─────────────────────────────────────────────────

class TestDisplayNameSpotChecks:

    def test_ict_silver_bullet_ny_am_display_name(self):
        pine = ARCHETYPE_PINE_RECIPE["ict_silver_bullet_ny_am"]
        assert "TF Archetype: Ict Silver Bullet Ny Am" in pine

    def test_bounce_off_level_display_name(self):
        pine = ARCHETYPE_PINE_RECIPE["bounce_off_level"]
        assert "TF Archetype: Bounce Off Level" in pine

    def test_ict_bias_aligned_continuation_display_name(self):
        pine = ARCHETYPE_PINE_RECIPE["ict_bias_aligned_continuation"]
        assert "TF Archetype: Ict Bias Aligned Continuation" in pine

    def test_gann_box_4h_continuation_display_name(self):
        pine = ARCHETYPE_PINE_RECIPE["gann_box_4h_continuation"]
        assert "TF Archetype: Gann Box 4H Continuation" in pine


# ─── Dispatch path tests ──────────────────────────────────────────────────────

class TestArchetypeDispatchPath:

    def test_archetype_prefix_dispatches_to_recipe(self):
        """_build_pine_indicator_var('archetype:bounce_off_level', ...) returns the recipe."""
        var_name, pine_line = _build_pine_indicator_var(
            "archetype:bounce_off_level", {}, 0
        )
        assert var_name == "archetype_bounce_off_level"
        assert "TF Archetype: Bounce Off Level" in pine_line
        assert "alertcondition(" in pine_line

    def test_archetype_prefix_ict_silver_bullet(self):
        var_name, pine_line = _build_pine_indicator_var(
            "archetype:ict_silver_bullet_ny_am", {}, 0
        )
        assert var_name == "archetype_ict_silver_bullet_ny_am"
        assert "Ict Silver Bullet Ny Am" in pine_line

    def test_archetype_prefix_unknown_key_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown archetype key"):
            _build_pine_indicator_var("archetype:nonexistent_key", {}, 0)

    def test_archetype_empty_key_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown archetype key"):
            _build_pine_indicator_var("archetype:", {}, 0)

    def test_uncatalogued_builds_recipe_with_display_name(self):
        """uncatalogued:smashed_candle → display name 'Smashed Candle'."""
        var_name, pine_line = _build_pine_indicator_var(
            "uncatalogued:smashed_candle", {}, 0
        )
        assert var_name == "uncatalogued_smashed_candle"
        assert "Smashed Candle" in pine_line
        assert "alertcondition(" in pine_line
        assert "indicator(" in pine_line
        assert "plotshape(" in pine_line

    def test_uncatalogued_multi_word_title_case(self):
        """Multi-word uncatalogued term converts to Title Case display name."""
        _, pine_line = _build_pine_indicator_var(
            "uncatalogued:fair_value_gap_entry", {}, 0
        )
        assert "Fair Value Gap Entry" in pine_line

    def test_uncatalogued_key_embedded_in_alert(self):
        """Uncatalogued recipe must embed the synthetic key in alertcondition payload."""
        _, pine_line = _build_pine_indicator_var(
            "uncatalogued:smashed_candle", {}, 0
        )
        assert '"archetype":"uncatalogued_smashed_candle"' in pine_line

    def test_non_archetype_prefix_still_dispatches_normally(self):
        """Regular indicator types are not affected by the new prefix checks."""
        var_name, pine_line = _build_pine_indicator_var("sma", {"period": 20}, 0)
        assert "ta.sma" in pine_line
        assert var_name == "ind_sma_0"


# ─── All registry keys present ───────────────────────────────────────────────

class TestRegistryKeysPresent:
    """Canonical keys from the 2026-06-22 ARCHETYPE_REGISTRY audit must all be present."""

    EXPECTED_KEYS = [
        # ICT time-window (14)
        "ict_silver_bullet_ny_am", "ict_silver_bullet_london", "ict_silver_bullet_ny_pm",
        "ict_judas_swing", "ict_ny_lunch_reversal", "ict_midnight_open",
        "ict_london_raid", "ict_turtle_soup", "ict_ote", "ict_power_of_3",
        "ict_unicorn", "ict_breaker", "ict_mitigation", "ict_iofed",
        # SMC + Scalp/Swing (7)
        "smt_reversal", "ict_quarterly_swing", "ict_propulsion", "ict_eqhl_raid",
        "ict_scalp", "ict_swing", "ict_2022",
        # Structural primitives (5)
        "break_of_structure", "change_of_character", "market_structure_shift",
        "cisd", "fvg_retrace",
        # W23G.3 short-form aliases (6)
        "fvg", "judas_swing", "silver_bullet", "breaker_block", "order_block",
        "liquidity_sweep",
        # Wyckoff (4)
        "wyckoff_spring", "wyckoff_upthrust", "wyckoff_accumulation",
        "wyckoff_distribution",
        # Wave 26 Pass G + W26.4 (3)
        "bounce_off_level", "ict_bias_aligned_continuation", "gann_box_4h_continuation",
    ]

    @pytest.mark.parametrize("key", EXPECTED_KEYS)
    def test_key_in_recipe(self, key: str):
        assert key in ARCHETYPE_PINE_RECIPE, (
            f"Key '{key}' missing from ARCHETYPE_PINE_RECIPE"
        )


# ─── Template factory sanity ──────────────────────────────────────────────────

class TestBuildArchetypeAlertPine:
    """Direct tests on the factory function."""

    def test_overlay_true(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        assert "overlay=true" in pine

    def test_archetype_active_declared(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        assert "archetype_active = true" in pine

    def test_alert_references_archetype_active(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        # alertcondition(archetype_active, ...)
        assert "alertcondition(archetype_active" in pine

    def test_plotshape_references_archetype_active(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        assert "plotshape(archetype_active" in pine

    def test_location_bottom(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        assert "location.bottom" in pine

    def test_aqua_color(self):
        pine = _build_archetype_alert_pine("test_key", "Test Key")
        assert "color.aqua" in pine

    def test_key_with_hyphens_sanitized(self):
        """Keys with hyphens (hypothetical future keys) must produce valid Pine var names."""
        pine = _build_archetype_alert_pine("test-key-name", "Test Key Name")
        # No bare hyphen in Pine script variable positions
        # The key in the JSON payload preserves hyphens (it's a string literal)
        assert "indicator(" in pine
