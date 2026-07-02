"""Margin expansion tests — MED #4 (Wave 27.5 Pass D.1).

Tests apply_vix_margin_expansion() pure function and the audit payload builder.
- VIX = 25 → no expansion (passthrough)
- VIX = 31 → halved (MARGIN_VIX_MULTIPLIER_30 = 0.5)
- VIX = 51 → quartered (MARGIN_VIX_MULTIPLIER_50 = 0.25)
- Env override respected via keyword args
- No VIX column → fail-open + audit
- Pure-function determinism
- Floor: result always >= 1 even when base = 1 or base = 2
"""

from __future__ import annotations

import os

os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


class TestApplyVixMarginExpansion:
    """Pure-function contract: deterministic, no I/O, no side effects."""

    def test_vix_below_threshold_no_expansion(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=20, vix_level=25.0)
        assert result == 20, "VIX=25 is below the 30 threshold — passthrough"

    def test_vix_at_threshold_no_expansion(self):
        """VIX exactly equal to threshold_30 → no expansion (strictly greater-than)."""
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=20, vix_level=30.0)
        assert result == 20, "VIX == threshold_30 is NOT above it — no expansion"

    def test_vix_above_30_halved(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=20, vix_level=31.0)
        assert result == 10, "VIX=31 → 20 × 0.5 = 10"

    def test_vix_above_30_floors_at_1(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=1, vix_level=35.0)
        assert result == 1, "Floor at 1 contract — can never trade 0"

    def test_vix_above_50_quartered(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=20, vix_level=51.0)
        assert result == 5, "VIX=51 → 20 × 0.25 = 5"

    def test_vix_above_50_floors_at_1_for_small_base(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=2, vix_level=55.0)
        # 2 × 0.25 = 0.5 → floor(0.5) = 0 → clamp to 1
        assert result == 1

    def test_env_override_threshold_respected(self):
        """Keyword override for env threshold is honoured."""
        from src.engine.margin_expansion import apply_vix_margin_expansion
        # Override threshold_30 to 20; VIX=21 should now trigger the reduction
        result = apply_vix_margin_expansion(
            base_max_contracts=20, vix_level=21.0,
            env_threshold_30=20.0, env_multiplier_30=0.5,
        )
        assert result == 10, "Custom threshold_30=20 → VIX=21 triggers halving"

    def test_env_override_multiplier_respected(self):
        """Custom multiplier is applied instead of the default 0.5."""
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(
            base_max_contracts=20, vix_level=31.0,
            env_multiplier_30=0.75,
        )
        assert result == 15, "Custom multiplier 0.75 → 20 × 0.75 = 15"

    def test_determinism_same_inputs_same_output(self):
        """Pure function: identical inputs always produce identical output."""
        from src.engine.margin_expansion import apply_vix_margin_expansion
        results = [apply_vix_margin_expansion(33, 42.0) for _ in range(10)]
        assert len(set(results)) == 1, "All calls must return the same value"

    def test_large_base_remains_large_below_threshold(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        result = apply_vix_margin_expansion(base_max_contracts=100, vix_level=15.0)
        assert result == 100

    def test_result_always_integer(self):
        from src.engine.margin_expansion import apply_vix_margin_expansion
        for vix in [10.0, 31.0, 51.0, 75.0]:
            result = apply_vix_margin_expansion(7, vix)
            assert isinstance(result, int)


class TestGetVixExpansionAudit:
    """Audit payload structure and correctness."""

    def test_no_expansion_audit_correct(self):
        from src.engine.margin_expansion import (
            apply_vix_margin_expansion,
            get_vix_expansion_audit,
        )
        base = 20
        vix = 25.0
        expanded = apply_vix_margin_expansion(base, vix)
        audit = get_vix_expansion_audit(base, expanded, vix)
        assert audit["expansion_applied"] is False
        assert audit["tier_triggered"] == "none"
        assert audit["base_max"] == 20
        assert audit["expanded_max"] == 20

    def test_elevated_30_audit(self):
        from src.engine.margin_expansion import (
            apply_vix_margin_expansion,
            get_vix_expansion_audit,
        )
        base = 20
        vix = 35.0
        expanded = apply_vix_margin_expansion(base, vix)
        audit = get_vix_expansion_audit(base, expanded, vix)
        assert audit["expansion_applied"] is True
        assert audit["tier_triggered"] == "elevated_30"
        assert audit["expanded_max"] == 10
        assert abs(audit["multiplier"] - 0.5) < 1e-6

    def test_emergency_50_audit(self):
        from src.engine.margin_expansion import (
            apply_vix_margin_expansion,
            get_vix_expansion_audit,
        )
        base = 20
        vix = 55.0
        expanded = apply_vix_margin_expansion(base, vix)
        audit = get_vix_expansion_audit(base, expanded, vix)
        assert audit["expansion_applied"] is True
        assert audit["tier_triggered"] == "emergency_50"
        assert audit["expanded_max"] == 5
        assert abs(audit["multiplier"] - 0.25) < 1e-6

    def test_audit_has_required_keys(self):
        from src.engine.margin_expansion import get_vix_expansion_audit
        audit = get_vix_expansion_audit(10, 10, 20.0)
        for key in ("vix_level", "base_max", "expanded_max", "multiplier", "tier_triggered", "expansion_applied"):
            assert key in audit, f"Missing required key: {key}"


class TestLruCacheIsolation:
    """Cache-clear test-isolation: env override → cache_clear → new value visible."""

    def test_vix_expansion_env_cache_clear_picks_up_threshold_change(self, monkeypatch):
        import src.engine.margin_expansion as me
        me._get_vix_expansion_env.cache_clear()
        t30, m30, t50, m50 = me._get_vix_expansion_env()
        assert t30 == 30.0
        assert m30 == 0.5
        assert t50 == 50.0
        assert m50 == 0.25

        monkeypatch.setenv("MARGIN_VIX_THRESHOLD_30", "25.0")
        me._get_vix_expansion_env.cache_clear()
        t30_new, _, _, _ = me._get_vix_expansion_env()
        assert t30_new == 25.0  # override visible after clear

        me._get_vix_expansion_env.cache_clear()  # restore

    def test_vix_expansion_env_stale_cache_ignores_change(self, monkeypatch):
        """Without cache_clear(), env change is NOT visible (demonstrates why clear is needed)."""
        import src.engine.margin_expansion as me
        me._get_vix_expansion_env.cache_clear()
        t30_before, _, _, _ = me._get_vix_expansion_env()  # primes cache

        monkeypatch.setenv("MARGIN_VIX_THRESHOLD_30", "99.0")
        # Without cache_clear(), still returns original value
        t30_stale, _, _, _ = me._get_vix_expansion_env()
        assert t30_stale == t30_before  # stale cache ignores env change

        me._get_vix_expansion_env.cache_clear()  # restore

    def test_vix_expansion_env_multiplier_override(self, monkeypatch):
        import src.engine.margin_expansion as me
        me._get_vix_expansion_env.cache_clear()

        monkeypatch.setenv("MARGIN_VIX_MULTIPLIER_50", "0.10")
        me._get_vix_expansion_env.cache_clear()
        _, _, _, m50_new = me._get_vix_expansion_env()
        assert m50_new == 0.10  # override visible after clear

        me._get_vix_expansion_env.cache_clear()  # restore
