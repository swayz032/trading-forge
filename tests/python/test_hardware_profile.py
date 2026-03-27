"""Tests for hardware profiler."""
import pytest
from src.engine.hardware_profile import (
    get_hardware_profile, detect_gpu, detect_wsl2,
    get_max_qubits_statevector, get_max_qubits_cpu,
    select_backend, HardwareProfile,
)


class TestHardwareProfile:
    def test_profile_returns_model(self):
        profile = get_hardware_profile()
        assert isinstance(profile, HardwareProfile)
        assert profile.platform != ""
        assert profile.ram_total_mb > 0

    def test_detect_gpu_returns_tuple(self):
        detected, name, vram = detect_gpu()
        assert isinstance(detected, bool)

    def test_max_qubits_gpu_zero_without_vram(self):
        assert get_max_qubits_statevector(None) == 0
        assert get_max_qubits_statevector(0) == 0

    def test_max_qubits_gpu_with_8gb(self):
        qubits = get_max_qubits_statevector(8192)  # 8GB
        assert 25 <= qubits <= 29  # Should be ~27

    def test_max_qubits_cpu(self):
        qubits = get_max_qubits_cpu(32000)  # 32GB
        assert qubits >= 28

    def test_select_backend_small_problem(self):
        backend = select_backend(10, prefer_gpu=False)
        assert backend in ("aer_cpu", "aer_gpu", "tensor_network", "cpu_only")

    def test_select_backend_large_problem(self):
        backend = select_backend(40, prefer_gpu=False)
        assert backend in ("tensor_network", "cpu_only")

    def test_wsl2_detection(self):
        result = detect_wsl2()
        assert isinstance(result, bool)

    def test_profile_has_notes(self):
        profile = get_hardware_profile()
        assert len(profile.notes) > 0
