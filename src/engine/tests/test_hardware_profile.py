"""Tests for probe_vram() in hardware_profile.py — Tier 4 cuQuantum GPU.

Test categories:
  1. probe_vram returns True when sufficient VRAM available (mocked pynvml)
  2. probe_vram returns False when insufficient VRAM
  3. probe_vram returns False when pynvml not installed
  4. probe_vram falls back to nvidia-smi subprocess when pynvml unavailable
  5. probe_vram returns False when nvidia-smi also fails / no GPU
  6. probe_vram never raises — always returns bool

Authority boundary: probe_vram is a pure boolean advisory helper.
It has no execution authority and makes no decisions.
"""
from __future__ import annotations

import subprocess
import sys
from unittest.mock import MagicMock, patch, call

import pytest

from src.engine.hardware_profile import probe_vram


# ─── 1. pynvml path: sufficient VRAM ─────────────────────────────────────────

class TestProbeVramPynvmlSufficient:
    """probe_vram returns True when pynvml reports enough free VRAM."""

    def test_sufficient_vram_returns_true(self):
        """8 000 MB free, require 500 MB → True (8000 > 500 + 500 safety)."""
        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mock_pynvml.nvmlInit.return_value = None
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle
        mem_info = MagicMock()
        mem_info.free = 8_000 * 1024 * 1024  # 8 000 MB in bytes
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            result = probe_vram(500)

        assert result is True

    def test_large_circuit_sufficient(self):
        """4 200 MB free, require 4 000 MB → True (4200 > 4000 + 500 safety = False?).

        Actually 4200 < 4500 so this should be False.
        Test the boundary correctly: require 3 500 → need 4 000 free → 4 200 >= 4 000 → True.
        """
        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mem_info = MagicMock()
        mem_info.free = 4_200 * 1024 * 1024  # 4 200 MB
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            # Require 3_500 MB → needs 3_500 + 500 = 4_000 free. 4_200 >= 4_000 → True
            result = probe_vram(3_500)

        assert result is True


# ─── 2. pynvml path: insufficient VRAM ───────────────────────────────────────

class TestProbeVramPynvmlInsufficient:
    """probe_vram returns False when pynvml reports too little free VRAM."""

    def test_insufficient_vram_returns_false(self):
        """300 MB free, require 500 MB → False (300 < 500 + 500 safety)."""
        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mem_info = MagicMock()
        mem_info.free = 300 * 1024 * 1024  # 300 MB
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            result = probe_vram(500)

        assert result is False

    def test_borderline_insufficient(self):
        """Exactly at safety margin boundary: require 1000, free 1499 → False.

        Need free >= required + 500 = 1500. 1499 < 1500 → False.
        """
        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mem_info = MagicMock()
        mem_info.free = 1_499 * 1024 * 1024
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            result = probe_vram(1_000)

        assert result is False

    def test_borderline_sufficient(self):
        """Exactly at boundary: require 1000, free 1500 → True."""
        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mem_info = MagicMock()
        mem_info.free = 1_500 * 1024 * 1024
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            result = probe_vram(1_000)

        assert result is True


# ─── 3. pynvml unavailable (ImportError) ─────────────────────────────────────

class TestProbeVramPynvmlUnavailable:
    """probe_vram falls back to nvidia-smi when pynvml import fails."""

    def test_pynvml_import_error_falls_back_to_nvidia_smi_success(self):
        """When pynvml missing, nvidia-smi reports 6000 MB free → True (6000 > 500+500)."""
        nvidia_smi_output = "6000\n"

        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run") as mock_run:
                mock_proc = MagicMock()
                mock_proc.returncode = 0
                mock_proc.stdout = nvidia_smi_output
                mock_run.return_value = mock_proc

                result = probe_vram(500)

        assert result is True

    def test_pynvml_import_error_falls_back_to_nvidia_smi_insufficient(self):
        """When pynvml missing, nvidia-smi reports 200 MB free → False."""
        nvidia_smi_output = "200\n"

        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run") as mock_run:
                mock_proc = MagicMock()
                mock_proc.returncode = 0
                mock_proc.stdout = nvidia_smi_output
                mock_run.return_value = mock_proc

                result = probe_vram(500)

        assert result is False

    def test_pynvml_nvml_error_falls_back_gracefully(self):
        """NVMLError during init → fallback to nvidia-smi, returns False on smi failure."""
        mock_pynvml = MagicMock()
        # Make NVMLError a real exception subclass so it can be caught
        class _NVMLError(Exception):
            pass
        mock_pynvml.NVMLError = _NVMLError
        mock_pynvml.nvmlInit.side_effect = _NVMLError("no GPU")

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            with patch("subprocess.run") as mock_run:
                mock_proc = MagicMock()
                mock_proc.returncode = 1  # nvidia-smi also fails
                mock_proc.stdout = ""
                mock_run.return_value = mock_proc

                result = probe_vram(500)

        assert result is False


# ─── 4. nvidia-smi subprocess path ───────────────────────────────────────────

class TestProbeVramNvidiaSmi:
    """probe_vram subprocess fallback path."""

    def test_nvidia_smi_sufficient(self):
        """nvidia-smi returns 7500 MB free, require 200 → True."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run") as mock_run:
                mock_proc = MagicMock()
                mock_proc.returncode = 0
                mock_proc.stdout = "7500\n"
                mock_run.return_value = mock_proc

                result = probe_vram(200)

        assert result is True

    def test_nvidia_smi_not_found(self):
        """FileNotFoundError from nvidia-smi → returns False (no GPU assumed)."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run", side_effect=FileNotFoundError):
                result = probe_vram(500)

        assert result is False

    def test_nvidia_smi_timeout(self):
        """subprocess.TimeoutExpired → returns False."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch(
                "subprocess.run",
                side_effect=subprocess.TimeoutExpired(cmd="nvidia-smi", timeout=5),
            ):
                result = probe_vram(500)

        assert result is False

    def test_nvidia_smi_bad_output(self):
        """nvidia-smi returns non-numeric output → returns False."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run") as mock_run:
                mock_proc = MagicMock()
                mock_proc.returncode = 0
                mock_proc.stdout = "N/A\n"
                mock_run.return_value = mock_proc

                result = probe_vram(500)

        assert result is False


# ─── 5. Never raises ─────────────────────────────────────────────────────────

class TestProbeVramNeverRaises:
    """probe_vram must always return bool, never raise."""

    def test_does_not_raise_on_unexpected_exception(self):
        """Even a truly unexpected error returns False, never propagates."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run", side_effect=RuntimeError("chaos")):
                result = probe_vram(100)

        assert isinstance(result, bool)
        assert result is False

    def test_returns_bool_type(self):
        """Return value is always strict bool, not truthy int."""
        with patch.dict(sys.modules, {"pynvml": None}):
            with patch("subprocess.run", side_effect=FileNotFoundError):
                result = probe_vram(0)

        assert type(result) is bool


# ─── 6. VRAM formula verification ────────────────────────────────────────────

class TestProbeVramFormula:
    """Verify the plan's VRAM formula gives correct safety margin behaviour."""

    @pytest.mark.parametrize("n_qubits,expected_required_mb", [
        (8,  200 + 32),      # 2**(8-3) + 200 = 32 + 200 = 232
        (15, 200 + 4096),    # 2**(15-3) + 200 = 4096 + 200 = 4296
        (20, 200 + 131072),  # 2**(20-3) + 200
        (25, 200 + 4194304), # 2**(25-3) + 200 — ~4GB, fits 8GB with headroom
    ])
    def test_vram_formula_matches_plan(self, n_qubits, expected_required_mb):
        """Caller is responsible for computing required_mb per plan formula.

        This test verifies probe_vram correctly interprets required_mb units (MB).
        Provide free = required + 500 → expect True (just enough headroom).
        """
        free_mb = expected_required_mb + 500

        mock_pynvml = MagicMock()
        mock_pynvml.NVMLError = Exception
        mock_handle = MagicMock()
        mem_info = MagicMock()
        mem_info.free = free_mb * 1024 * 1024
        mock_pynvml.nvmlDeviceGetMemoryInfo.return_value = mem_info
        mock_pynvml.nvmlDeviceGetHandleByIndex.return_value = mock_handle

        with patch.dict(sys.modules, {"pynvml": mock_pynvml}):
            result = probe_vram(expected_required_mb)

        assert result is True, (
            f"n_qubits={n_qubits}: free={free_mb}MB, required={expected_required_mb}MB "
            f"(+500 safety={expected_required_mb+500}MB) — should be True"
        )
