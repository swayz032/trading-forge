"""Wave 27 Pass 3.G3 — Phase 5 true-mini ContractSpec scaffold tests.

Tests cover:
  - Mini specs (ES/NQ/CL) exist as separate entries with contract_class="mini"
  - Mini point values are exactly 10x the corresponding micro point values
  - resolve_contract_spec("ES") with PHASE_5_ENABLED=False returns micro spec (safety default)
  - resolve_contract_spec("ES", "mini") returns true mini spec
  - PHASE_5_ENABLED=True + no class → ValueError (ambiguity block)
  - Phase 5 activation banner logs to stderr on first call when PHASE_5_ENABLED=True
  - Micro specs (MES/MNQ/MCL) unchanged from pre-Pass-3.G3 baseline (regression guard)
  - PHASE_5_ENABLED module constant defaults to False
  - Explicit contract_class="micro" for alias symbols (ES/NQ/CL) returns micro spec
  - Micro symbol with class="mini" raises informative error
  - Unknown symbol raises KeyError
  - resolve_contract_spec("MES") always returns MES micro spec
  - Tick value consistency: point_value = tick_value / tick_size for all specs
"""

from __future__ import annotations

import importlib
import os
import sys
from io import StringIO
from unittest.mock import patch

import pytest

# ─── Module reload helpers ──────────────────────────────────────────────────────
# We need to test module-level PHASE_5_ENABLED with different env vars.
# pytest reuses the already-imported module, so we reload it per test when needed.

def _import_config(phase5_enabled: bool = False):
    """Re-import src.engine.config with the given TF_PHASE_5_ENABLED value."""
    env_val = "true" if phase5_enabled else "false"
    with patch.dict(os.environ, {"TF_PHASE_5_ENABLED": env_val}):
        import src.engine.config as config_mod
        # Reload so the module-level constant picks up the patched env
        importlib.reload(config_mod)
        return config_mod


# ─── Test 1: Mini specs present ───────────────────────────────────────────────

class TestMiniSpecsPresent:
    """ES/NQ/CL must exist as true-mini entries with contract_class='mini'."""

    def test_es_mini_spec_present(self):
        """_MINI_SPECS['ES'] exists with contract_class='mini'."""
        from src.engine.config import _MINI_SPECS
        assert "ES" in _MINI_SPECS, "ES must have a dedicated mini spec"
        assert _MINI_SPECS["ES"].contract_class == "mini"

    def test_nq_mini_spec_present(self):
        """_MINI_SPECS['NQ'] exists with contract_class='mini'."""
        from src.engine.config import _MINI_SPECS
        assert "NQ" in _MINI_SPECS, "NQ must have a dedicated mini spec"
        assert _MINI_SPECS["NQ"].contract_class == "mini"

    def test_cl_mini_spec_present(self):
        """_MINI_SPECS['CL'] exists with contract_class='mini'."""
        from src.engine.config import _MINI_SPECS
        assert "CL" in _MINI_SPECS, "CL must have a dedicated mini spec"
        assert _MINI_SPECS["CL"].contract_class == "mini"

    def test_mini_specs_are_separate_from_contract_specs(self):
        """_MINI_SPECS entries are distinct objects from CONTRACT_SPECS micro aliases.

        CONTRACT_SPECS['ES'] is the micro alias; _MINI_SPECS['ES'] is the true mini.
        They must NOT be the same object (point_value differs 10x).
        """
        from src.engine.config import _MINI_SPECS, CONTRACT_SPECS
        # micro alias has micro point values
        assert CONTRACT_SPECS["ES"].point_value == 5.00
        # mini spec has the 10x value
        assert _MINI_SPECS["ES"].point_value == 50.00
        assert CONTRACT_SPECS["ES"] is not _MINI_SPECS["ES"]


# ─── Test 2: Mini point values are 10x micros ─────────────────────────────────

class TestMiniPointValues10xMicros:
    """ES.point_value == 10 × MES.point_value, etc. (institutional-correct)."""

    def test_es_point_value_is_10x_mes(self):
        """ES mini point value ($50) must be exactly 10x MES micro ($5)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["ES"].point_value == pytest.approx(
            _MICRO_SPECS["MES"].point_value * 10, rel=1e-9
        ), "ES.point_value must be exactly 10x MES.point_value"

    def test_nq_point_value_is_10x_mnq(self):
        """NQ mini point value ($20) must be exactly 10x MNQ micro ($2)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["NQ"].point_value == pytest.approx(
            _MICRO_SPECS["MNQ"].point_value * 10, rel=1e-9
        ), "NQ.point_value must be exactly 10x MNQ.point_value"

    def test_cl_point_value_is_10x_mcl(self):
        """CL mini point value ($1000) must be exactly 10x MCL micro ($100)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["CL"].point_value == pytest.approx(
            _MICRO_SPECS["MCL"].point_value * 10, rel=1e-9
        ), "CL.point_value must be exactly 10x MCL.point_value"

    def test_es_tick_value_is_10x_mes(self):
        """ES tick value ($12.50) must be exactly 10x MES ($1.25)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["ES"].tick_value == pytest.approx(
            _MICRO_SPECS["MES"].tick_value * 10, rel=1e-9
        )

    def test_nq_tick_value_is_10x_mnq(self):
        """NQ tick value ($5.00) must be exactly 10x MNQ ($0.50)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["NQ"].tick_value == pytest.approx(
            _MICRO_SPECS["MNQ"].tick_value * 10, rel=1e-9
        )

    def test_cl_tick_value_is_10x_mcl(self):
        """CL tick value ($10.00) must be exactly 10x MCL ($1.00)."""
        from src.engine.config import _MICRO_SPECS, _MINI_SPECS
        assert _MINI_SPECS["CL"].tick_value == pytest.approx(
            _MICRO_SPECS["MCL"].tick_value * 10, rel=1e-9
        )


# ─── Test 3: resolve_contract_spec default returns micro (Phase 5 disabled) ───

class TestResolveDefaultPhase5DisabledReturnsMicro:
    """With PHASE_5_ENABLED=False, resolve_contract_spec(X) → micro spec (safety default)."""

    def test_es_no_class_returns_micro_spec(self):
        """resolve_contract_spec('ES') with PHASE_5_ENABLED=False → micro spec (MES point values)."""
        cfg = _import_config(phase5_enabled=False)
        assert cfg.PHASE_5_ENABLED is False
        result = cfg.resolve_contract_spec("ES")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(5.00, rel=1e-9)

    def test_nq_no_class_returns_micro_spec(self):
        """resolve_contract_spec('NQ') with PHASE_5_ENABLED=False → micro spec."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("NQ")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(2.00, rel=1e-9)

    def test_cl_no_class_returns_micro_spec(self):
        """resolve_contract_spec('CL') with PHASE_5_ENABLED=False → micro spec."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("CL")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(100.00, rel=1e-9)

    def test_mes_no_class_returns_mes_spec(self):
        """resolve_contract_spec('MES') always returns MES micro spec."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("MES")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(5.00, rel=1e-9)


# ─── Test 4: Explicit class returns correct spec ───────────────────────────────

class TestResolveExplicitClassReturnsCorrect:
    """resolve_contract_spec(symbol, class) always respects the explicit class."""

    def test_es_explicit_mini_returns_mini_spec(self):
        """resolve_contract_spec('ES', 'mini') → true mini spec ($50/pt)."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("ES", "mini")
        assert result.contract_class == "mini"
        assert result.point_value == pytest.approx(50.00, rel=1e-9)

    def test_nq_explicit_mini_returns_mini_spec(self):
        """resolve_contract_spec('NQ', 'mini') → true mini spec ($20/pt)."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("NQ", "mini")
        assert result.contract_class == "mini"
        assert result.point_value == pytest.approx(20.00, rel=1e-9)

    def test_cl_explicit_mini_returns_mini_spec(self):
        """resolve_contract_spec('CL', 'mini') → true mini spec ($1000/pt)."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("CL", "mini")
        assert result.contract_class == "mini"
        assert result.point_value == pytest.approx(1000.00, rel=1e-9)

    def test_es_explicit_micro_returns_micro_spec(self):
        """resolve_contract_spec('ES', 'micro') → micro spec ($5/pt) even when Phase 5 off."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("ES", "micro")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(5.00, rel=1e-9)

    def test_mes_explicit_micro_returns_mes_spec(self):
        """resolve_contract_spec('MES', 'micro') → MES micro spec."""
        cfg = _import_config(phase5_enabled=False)
        result = cfg.resolve_contract_spec("MES", "micro")
        assert result.contract_class == "micro"
        assert result.point_value == pytest.approx(5.00, rel=1e-9)


# ─── Test 5: Phase 5 enabled + ambiguous raises ValueError ────────────────────

class TestResolvePhase5EnabledAmbiguousRaises:
    """PHASE_5_ENABLED=True + no class → ValueError (no implicit routing allowed)."""

    def test_es_no_class_raises_when_phase5_enabled(self):
        """ES without class in Phase 5 mode → ValueError (ambiguity block)."""
        cfg = _import_config(phase5_enabled=True)
        assert cfg.PHASE_5_ENABLED is True
        with pytest.raises(ValueError, match="contract_class"):
            cfg.resolve_contract_spec("ES")

    def test_nq_no_class_raises_when_phase5_enabled(self):
        """NQ without class in Phase 5 mode → ValueError."""
        cfg = _import_config(phase5_enabled=True)
        with pytest.raises(ValueError, match="PHASE_5_ENABLED"):
            cfg.resolve_contract_spec("NQ")

    def test_mes_no_class_raises_when_phase5_enabled(self):
        """Even micro MES without class raises ValueError when Phase 5 enabled.

        This is intentional: when Phase 5 is active EVERY call must be explicit.
        The operator must consciously choose 'micro' to continue using MES math.
        """
        cfg = _import_config(phase5_enabled=True)
        with pytest.raises(ValueError, match="PHASE_5_ENABLED"):
            cfg.resolve_contract_spec("MES")

    def test_explicit_class_still_works_when_phase5_enabled(self):
        """Even with PHASE_5_ENABLED=True, explicit class bypasses the ambiguity block."""
        cfg = _import_config(phase5_enabled=True)
        result = cfg.resolve_contract_spec("ES", "mini")
        assert result.contract_class == "mini"
        assert result.point_value == pytest.approx(50.00, rel=1e-9)


# ─── Test 6: Phase 5 activation WARN logged to stderr ─────────────────────────

class TestPhase5WarnLoggedOnEnable:
    """When PHASE_5_ENABLED=True, a WARN prints to stderr on the first call."""

    def test_phase5_warn_emitted_to_stderr_on_first_call(self):
        """Activation banner must appear on stderr when PHASE_5_ENABLED=True."""
        cfg = _import_config(phase5_enabled=True)
        # Reset the one-shot guard so we can observe the emission
        cfg._phase5_warn_emitted = False

        captured = StringIO()
        with patch("sys.stderr", captured):
            try:
                cfg.resolve_contract_spec("ES", "mini")
            except Exception:
                pass  # Error irrelevant; we're checking for the banner

        output = captured.getvalue()
        assert "PHASE_5_ENABLED" in output or "WARN" in output, (
            f"Expected Phase 5 activation banner on stderr; got: {output!r}"
        )

    def test_phase5_warn_emitted_only_once(self):
        """Second call does not repeat the banner (one-shot guard)."""
        cfg = _import_config(phase5_enabled=True)
        cfg._phase5_warn_emitted = False

        stderr_calls = []
        original_write = sys.stderr.write

        def capture_write(s):
            stderr_calls.append(s)
            return original_write(s)

        with patch.object(sys.stderr, "write", side_effect=capture_write):
            try:
                cfg.resolve_contract_spec("ES", "mini")
            except Exception:
                pass
            warn_count_after_first = sum(1 for s in stderr_calls if "PHASE_5_ENABLED" in s)

            try:
                cfg.resolve_contract_spec("NQ", "mini")
            except Exception:
                pass
            warn_count_after_second = sum(1 for s in stderr_calls if "PHASE_5_ENABLED" in s)

        # The banner should not appear again on the second call
        assert warn_count_after_second == warn_count_after_first


# ─── Test 7: Micro specs unchanged (regression guard) ─────────────────────────

class TestMicroSpecsUnchanged:
    """MES/MNQ/MCL specs must be byte-identical to pre-Pass-3.G3 baseline."""

    def test_mes_point_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MES"].point_value == pytest.approx(5.00, rel=1e-9)

    def test_mes_tick_size_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MES"].tick_size == pytest.approx(0.25, rel=1e-9)

    def test_mes_tick_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MES"].tick_value == pytest.approx(1.25, rel=1e-9)

    def test_mnq_point_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MNQ"].point_value == pytest.approx(2.00, rel=1e-9)

    def test_mnq_tick_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MNQ"].tick_value == pytest.approx(0.50, rel=1e-9)

    def test_mcl_point_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MCL"].point_value == pytest.approx(100.00, rel=1e-9)

    def test_mcl_tick_value_unchanged(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["MCL"].tick_value == pytest.approx(1.00, rel=1e-9)

    def test_es_alias_still_micro_in_contract_specs(self):
        """CONTRACT_SPECS['ES'] must still return micro spec (S3 data-path backward compat)."""
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["ES"].point_value == pytest.approx(5.00, rel=1e-9)
        assert CONTRACT_SPECS["ES"].contract_class == "micro"

    def test_nq_alias_still_micro_in_contract_specs(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["NQ"].point_value == pytest.approx(2.00, rel=1e-9)
        assert CONTRACT_SPECS["NQ"].contract_class == "micro"

    def test_cl_alias_still_micro_in_contract_specs(self):
        from src.engine.config import CONTRACT_SPECS
        assert CONTRACT_SPECS["CL"].point_value == pytest.approx(100.00, rel=1e-9)
        assert CONTRACT_SPECS["CL"].contract_class == "micro"


# ─── Test 8: PHASE_5_ENABLED default is False ─────────────────────────────────

class TestPhase5EnabledConstantDefaultFalse:
    """PHASE_5_ENABLED must be False when TF_PHASE_5_ENABLED is not set."""

    def test_phase5_enabled_defaults_false_when_env_unset(self):
        """Without TF_PHASE_5_ENABLED in env, PHASE_5_ENABLED must be False."""
        env_without_flag = {k: v for k, v in os.environ.items() if k != "TF_PHASE_5_ENABLED"}
        with patch.dict(os.environ, env_without_flag, clear=True):
            import src.engine.config as config_mod
            importlib.reload(config_mod)
            assert config_mod.PHASE_5_ENABLED is False

    def test_phase5_enabled_true_when_env_set_true(self):
        """TF_PHASE_5_ENABLED=true sets PHASE_5_ENABLED to True."""
        with patch.dict(os.environ, {"TF_PHASE_5_ENABLED": "true"}):
            import src.engine.config as config_mod
            importlib.reload(config_mod)
            assert config_mod.PHASE_5_ENABLED is True

    def test_phase5_enabled_case_insensitive_TRUE(self):
        """TF_PHASE_5_ENABLED=TRUE (uppercase) also sets PHASE_5_ENABLED=True."""
        with patch.dict(os.environ, {"TF_PHASE_5_ENABLED": "TRUE"}):
            import src.engine.config as config_mod
            importlib.reload(config_mod)
            assert config_mod.PHASE_5_ENABLED is True


# ─── Test 9: Error cases ───────────────────────────────────────────────────────

class TestResolveContractSpecErrorCases:
    """Edge case error handling for resolve_contract_spec."""

    def test_unknown_symbol_raises_key_error(self):
        """resolve_contract_spec with completely unknown symbol raises KeyError."""
        cfg = _import_config(phase5_enabled=False)
        with pytest.raises(KeyError, match="Unknown"):
            cfg.resolve_contract_spec("RTY")

    def test_invalid_contract_class_raises_value_error(self):
        """resolve_contract_spec with invalid class raises ValueError."""
        cfg = _import_config(phase5_enabled=False)
        with pytest.raises(ValueError, match="Invalid contract_class"):
            cfg.resolve_contract_spec("ES", "invalid_class")  # type: ignore[arg-type]

    def test_micro_symbol_with_mini_class_raises(self):
        """resolve_contract_spec('MES', 'mini') raises ValueError (mismatched pairing)."""
        cfg = _import_config(phase5_enabled=False)
        with pytest.raises((ValueError, KeyError)):
            cfg.resolve_contract_spec("MES", "mini")

    def test_mnq_with_mini_class_raises(self):
        """resolve_contract_spec('MNQ', 'mini') raises ValueError (mismatched pairing)."""
        cfg = _import_config(phase5_enabled=False)
        with pytest.raises((ValueError, KeyError)):
            cfg.resolve_contract_spec("MNQ", "mini")


# ─── Test 10: Tick value consistency ──────────────────────────────────────────

class TestTickValueConsistency:
    """For all specs: tick_value == point_value * tick_size (CME contract math)."""

    def test_mes_tick_value_consistent(self):
        """MES: tick_value = point_value × tick_size."""
        from src.engine.config import _MICRO_SPECS
        s = _MICRO_SPECS["MES"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)

    def test_mnq_tick_value_consistent(self):
        from src.engine.config import _MICRO_SPECS
        s = _MICRO_SPECS["MNQ"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)

    def test_mcl_tick_value_consistent(self):
        from src.engine.config import _MICRO_SPECS
        s = _MICRO_SPECS["MCL"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)

    def test_es_mini_tick_value_consistent(self):
        """ES mini: tick_value = point_value × tick_size ($50 × 0.25 = $12.50)."""
        from src.engine.config import _MINI_SPECS
        s = _MINI_SPECS["ES"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)

    def test_nq_mini_tick_value_consistent(self):
        """NQ mini: tick_value = point_value × tick_size ($20 × 0.25 = $5.00)."""
        from src.engine.config import _MINI_SPECS
        s = _MINI_SPECS["NQ"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)

    def test_cl_mini_tick_value_consistent(self):
        """CL mini: tick_value = point_value × tick_size ($1000 × 0.01 = $10.00)."""
        from src.engine.config import _MINI_SPECS
        s = _MINI_SPECS["CL"]
        assert s.tick_value == pytest.approx(s.point_value * s.tick_size, rel=1e-9)
