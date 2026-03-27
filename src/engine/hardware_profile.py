"""Hardware profiler — auto-detect GPU/RAM for quantum backend selection.

Usage:
    python -m src.engine.hardware_profile
"""
from __future__ import annotations

import json
import math
import os
import platform
import subprocess
import sys
from typing import Optional

from pydantic import BaseModel, Field


class HardwareProfile(BaseModel):
    """Detected hardware capabilities."""
    platform: str
    gpu_detected: bool = False
    gpu_name: Optional[str] = None
    gpu_vram_mb: Optional[int] = None
    cuda_available: bool = False
    ram_total_mb: int = 0
    max_qubits_gpu: int = 0  # Statevector sim limit on GPU
    max_qubits_cpu: int = 0  # Statevector sim limit on CPU
    recommended_backend: str = "aer_cpu"
    wsl2_detected: bool = False
    notes: list[str] = Field(default_factory=list)


def detect_gpu() -> tuple[bool, Optional[str], Optional[int]]:
    """Detect GPU name and VRAM.

    Returns: (detected, gpu_name, vram_mb)
    """
    # Try NVIDIA SMI
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(", ")
            name = parts[0].strip()
            vram = int(float(parts[1].strip())) if len(parts) > 1 else None
            return True, name, vram
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        pass

    # Try cupy
    try:
        import cupy as cp
        device = cp.cuda.Device(0)
        name = device.attributes.get("DeviceName", f"GPU {device.id}")
        vram = device.mem_info[1] // (1024 * 1024)
        return True, str(name), int(vram)
    except Exception:
        pass

    return False, None, None


def get_max_qubits_statevector(vram_mb: Optional[int] = None) -> int:
    """Max qubits for statevector simulation on GPU.

    Statevector requires 2^n * 16 bytes (complex128).
    RTX 5060 (8GB): 2^27 * 16 = 2.15 GB -> 27 qubits safely
    RTX 4090 (24GB): 2^29 * 16 = 8.6 GB -> 29 qubits safely
    """
    if vram_mb is None:
        return 0

    # Leave 2GB headroom for CUDA overhead
    usable_mb = max(0, vram_mb - 2048)
    usable_bytes = usable_mb * 1024 * 1024

    # 2^n * 16 bytes
    if usable_bytes <= 0:
        return 0
    max_n = int(math.log2(usable_bytes / 16))
    return min(max_n, 32)  # Cap at 32


def get_max_qubits_cpu(ram_mb: Optional[int] = None) -> int:
    """Max qubits for statevector simulation on CPU.

    32GB RAM: 2^30 * 16 = 17.2 GB -> 30 qubits safely (leave RAM for OS)
    """
    if ram_mb is None:
        try:
            import psutil
            ram_mb = psutil.virtual_memory().total // (1024 * 1024)
        except ImportError:
            ram_mb = 32_000  # Assume 32GB

    # Leave 8GB for OS + other processes
    usable_mb = max(0, ram_mb - 8192)
    usable_bytes = usable_mb * 1024 * 1024

    if usable_bytes <= 0:
        return 0
    max_n = int(math.log2(usable_bytes / 16))
    return min(max_n, 34)  # Cap at 34


def select_backend(problem_size: int, prefer_gpu: bool = True) -> str:
    """Auto-select best backend for given problem size.

    Args:
        problem_size: Number of qubits needed
        prefer_gpu: Try GPU first if available

    Returns:
        Backend string: "aer_gpu" | "aer_cpu" | "tensor_network" | "cpu_only"
    """
    gpu_detected, _, vram_mb = detect_gpu()
    max_gpu = get_max_qubits_statevector(vram_mb) if gpu_detected else 0
    max_cpu = get_max_qubits_cpu()

    if prefer_gpu and gpu_detected and problem_size <= max_gpu:
        return "aer_gpu"
    elif problem_size <= max_cpu:
        return "aer_cpu"
    elif problem_size <= max_cpu + 5:  # Tensor network can handle a few more qubits
        return "tensor_network"
    else:
        return "cpu_only"


def detect_wsl2() -> bool:
    """Check if running inside WSL2."""
    if platform.system() != "Linux":
        return False
    try:
        with open("/proc/version", "r") as f:
            return "microsoft" in f.read().lower()
    except Exception:
        return False


def get_hardware_profile() -> HardwareProfile:
    """Full hardware detection."""
    profile = HardwareProfile(platform=platform.system())

    # GPU
    gpu_detected, gpu_name, vram_mb = detect_gpu()
    profile.gpu_detected = gpu_detected
    profile.gpu_name = gpu_name
    profile.gpu_vram_mb = vram_mb

    # CUDA
    try:
        import subprocess
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=5)
        profile.cuda_available = result.returncode == 0
    except Exception:
        profile.cuda_available = False

    # RAM
    try:
        import psutil
        profile.ram_total_mb = int(psutil.virtual_memory().total / (1024 * 1024))
    except ImportError:
        profile.ram_total_mb = 32_000  # Assume 32GB

    # Qubit limits
    profile.max_qubits_gpu = get_max_qubits_statevector(vram_mb) if gpu_detected else 0
    profile.max_qubits_cpu = get_max_qubits_cpu(profile.ram_total_mb)

    # WSL2
    profile.wsl2_detected = detect_wsl2()

    # Backend recommendation
    if gpu_detected and profile.cuda_available:
        profile.recommended_backend = "aer_gpu"
        profile.notes.append(f"GPU detected: {gpu_name} ({vram_mb}MB VRAM)")
        profile.notes.append(f"Max qubits (GPU statevector): {profile.max_qubits_gpu}")
    else:
        profile.recommended_backend = "aer_cpu"
        profile.notes.append("No GPU detected — using CPU simulation")

    profile.notes.append(f"Max qubits (CPU statevector): {profile.max_qubits_cpu}")
    profile.notes.append(f"RAM: {profile.ram_total_mb}MB")

    if profile.wsl2_detected:
        profile.notes.append("WSL2 detected — GPU passthrough available")

    return profile


if __name__ == "__main__":
    profile = get_hardware_profile()
    print(profile.model_dump_json(indent=2))
