"""Tests for quantum_device_selector.py — Tier 4 cuQuantum GPU acceleration.

Test categories:
  1. Isolation — selector makes no lifecycle decisions, returns string label only
  2. Default behavior — env flag false → always "default.qubit"
  3. GPU path — env flag true + VRAM available → "lightning.gpu"
  4. Qubit cap — n_qubits > 25 → "default.qubit" + warning (5060 8GB cap)
  5. prefer_gpu=False override → always "default.qubit"
  6. VRAM insufficient — env flag true but probe_vram returns False → "default.qubit"
  7. Schema stability — return value is always a plain str

Authority boundary: select_quantum_device is advisory only.
It returns a string device label for use with qml.device().
It has no lifecycle authority, no execution authority, no param mutation.
"""
from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

from src.engine.quantum_device_selector import select_quantum_device


# ─── 1. Default behavior: env flag false ─────────────────────────────────────

class TestDefaultQubit:
    """When QUANTUM_CUQUANTUM_GPU_ENABLED is false, always return default.qubit."""

    def test_env_flag_false_returns_default_qubit(self):
        """Base case: no env var set → default.qubit."""
        with patch.dict("os.environ", {}, clear=False):
            # Ensure flag is absent / false
            import os
            os.environ.pop("QUANTUM_CUQUANTUM_GPU_ENABLED", None)
            result = select_quantum_device(8)
        assert result == "default.qubit"

    def test_env_flag_explicitly_false_returns_default_qubit(self):
        """Explicit QUANTUM_CUQUANTUM_GPU_ENABLED=false → default.qubit."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "false"}):
            result = select_quantum_device(8)
        assert result == "default.qubit"

    def test_env_flag_false_any_qubit_count(self):
        """Flag false regardless of qubit count → default.qubit."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "false"}):
            for n in [1, 8, 12, 20, 24, 25, 26, 30]:
                assert select_quantum_device(n) == "default.qubit"

    def test_env_flag_mixed_case_false(self):
        """Flag value is case-insensitive — FALSE, False, false all treated as false."""
        for val in ("FALSE", "False", "0", "no"):
            with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": val}):
                result = select_quantum_device(8)
            assert result == "default.qubit", f"Expected default.qubit for flag={val!r}"


# ─── 2. GPU path: env flag true + VRAM available ─────────────────────────────

class TestGpuPath:
    """When flag is true and VRAM probe passes, return lightning.gpu."""

    def test_gpu_path_returns_lightning_gpu(self):
        """Flag true + probe_vram returns True → lightning.gpu."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=True,
            ):
                result = select_quantum_device(8)
        assert result == "lightning.gpu"

    def test_gpu_path_at_qubit_cap_boundary(self):
        """n_qubits=25 is exactly at the cap (inclusive) — GPU path allowed."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=True,
            ):
                result = select_quantum_device(25)
        assert result == "lightning.gpu"

    def test_vram_formula_correct_for_8_qubits(self):
        """For n=8, required_mb = 2**(8-3) + 200 = 32 + 200 = 232."""
        captured_args: list[int] = []

        def recording_probe(required_mb: int) -> bool:
            captured_args.append(required_mb)
            return True

        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                side_effect=recording_probe,
            ):
                select_quantum_device(8)

        assert len(captured_args) == 1
        assert captured_args[0] == 232  # int(2**(8-3) + 200) = 232

    def test_vram_formula_correct_for_16_qubits(self):
        """For n=16, required_mb = 2**(16-3) + 200 = 8192 + 200 = 8392."""
        captured_args: list[int] = []

        def recording_probe(required_mb: int) -> bool:
            captured_args.append(required_mb)
            return True

        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                side_effect=recording_probe,
            ):
                select_quantum_device(16)

        assert captured_args[0] == 8392  # int(2**(16-3) + 200) = 8392


# ─── 3. Qubit cap: n_qubits > 25 ─────────────────────────────────────────────

class TestQubitCap:
    """n_qubits > 25 exceeds RTX 5060 8GB cap — always fall back to CPU."""

    def test_26_qubits_returns_default_qubit(self):
        """n_qubits=26 → default.qubit even if env flag is true."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=True,
            ):
                result = select_quantum_device(26)
        assert result == "default.qubit"

    def test_30_qubits_returns_default_qubit(self):
        """n_qubits=30 → default.qubit."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=True,
            ):
                result = select_quantum_device(30)
        assert result == "default.qubit"

    def test_over_cap_emits_warning(self, caplog):
        """n_qubits > 25 → warning logged with qubit count."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch("src.engine.quantum_device_selector.probe_vram", return_value=True):
                with caplog.at_level(logging.WARNING, logger="src.engine.quantum_device_selector"):
                    select_quantum_device(30)
        assert any("30" in r.message and "5060" in r.message for r in caplog.records)

    def test_probe_vram_not_called_over_cap(self):
        """probe_vram must NOT be called when n_qubits > 25 (short-circuit)."""
        probe_call_count = []

        def counting_probe(required_mb: int) -> bool:
            probe_call_count.append(required_mb)
            return True

        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                side_effect=counting_probe,
            ):
                select_quantum_device(26)

        assert len(probe_call_count) == 0, "probe_vram should not be called when over qubit cap"


# ─── 4. prefer_gpu=False override ────────────────────────────────────────────

class TestPreferGpuFalse:
    """prefer_gpu=False forces CPU regardless of env flag or VRAM."""

    def test_prefer_gpu_false_returns_default_qubit(self):
        """prefer_gpu=False → default.qubit even if env flag is true."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch("src.engine.quantum_device_selector.probe_vram", return_value=True):
                result = select_quantum_device(8, prefer_gpu=False)
        assert result == "default.qubit"

    def test_prefer_gpu_false_skips_vram_probe(self):
        """prefer_gpu=False → probe_vram never called."""
        probe_calls: list = []

        def counting_probe(required_mb: int) -> bool:
            probe_calls.append(required_mb)
            return True

        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                side_effect=counting_probe,
            ):
                select_quantum_device(8, prefer_gpu=False)

        assert len(probe_calls) == 0


# ─── 5. VRAM insufficient ────────────────────────────────────────────────────

class TestVramInsufficient:
    """Env flag true but probe_vram returns False → fall back to CPU."""

    def test_insufficient_vram_returns_default_qubit(self):
        """probe_vram=False → default.qubit."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=False,
            ):
                result = select_quantum_device(8)
        assert result == "default.qubit"

    def test_insufficient_vram_returns_default_qubit_large_circuit(self):
        """probe_vram=False for a larger circuit → still default.qubit."""
        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch(
                "src.engine.quantum_device_selector.probe_vram",
                return_value=False,
            ):
                result = select_quantum_device(20)
        assert result == "default.qubit"


# ─── 6. Schema stability ─────────────────────────────────────────────────────

class TestSchemaStability:
    """Return value is always a plain str — never None, never raises."""

    @pytest.mark.parametrize("n_qubits,prefer_gpu,flag,probe_val,expected", [
        (8,  True,  "false", None,  "default.qubit"),
        (8,  True,  "true",  True,  "lightning.gpu"),
        (8,  True,  "true",  False, "default.qubit"),
        (8,  False, "true",  True,  "default.qubit"),
        (30, True,  "true",  True,  "default.qubit"),
        (25, True,  "true",  True,  "lightning.gpu"),
        (26, True,  "true",  True,  "default.qubit"),
    ])
    def test_always_returns_str(self, n_qubits, prefer_gpu, flag, probe_val, expected):
        """Output is always str, never None, never raises."""
        probe_mock = None if probe_val is None else (lambda _: probe_val)
        env = {"QUANTUM_CUQUANTUM_GPU_ENABLED": flag}
        if probe_mock is not None:
            with patch.dict("os.environ", env):
                with patch("src.engine.quantum_device_selector.probe_vram", side_effect=probe_mock):
                    result = select_quantum_device(n_qubits, prefer_gpu=prefer_gpu)
        else:
            with patch.dict("os.environ", env):
                result = select_quantum_device(n_qubits, prefer_gpu=prefer_gpu)
        assert isinstance(result, str)
        assert result == expected

    def test_never_raises_on_probe_exception(self):
        """If probe_vram raises unexpectedly, selector must not propagate exception."""
        def raising_probe(_: int) -> bool:
            raise RuntimeError("simulated pynvml crash")

        with patch.dict("os.environ", {"QUANTUM_CUQUANTUM_GPU_ENABLED": "true"}):
            with patch("src.engine.quantum_device_selector.probe_vram", side_effect=raising_probe):
                # Must not raise — must return a safe fallback
                result = select_quantum_device(8)
        assert result == "default.qubit"


# ─── 7. Isolation / authority boundary ───────────────────────────────────────

class TestIsolation:
    """Challenger isolation: selector has no side effects, no execution authority."""

    def test_selector_returns_string_not_device_object(self):
        """Result is a str label, not a PennyLane device object."""
        result = select_quantum_device(8)
        assert isinstance(result, str)
        assert not hasattr(result, "execute")  # sanity — it's not a qml.Device

    def test_selector_is_pure_no_state_mutation(self):
        """Calling twice with same args produces same result (no hidden state)."""
        env = {"QUANTUM_CUQUANTUM_GPU_ENABLED": "false"}
        with patch.dict("os.environ", env):
            r1 = select_quantum_device(8)
            r2 = select_quantum_device(8)
        assert r1 == r2
