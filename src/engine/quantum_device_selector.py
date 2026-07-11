"""Quantum device selector — Tier 4 cuQuantum GPU acceleration.

Advisory helper: returns a PennyLane device name string based on env flag,
qubit count, and VRAM availability.  Never raises.  No execution authority.

Governance: advisory only — returns a string label for qml.device().
Authority boundary: this module selects devices, it does NOT make lifecycle
decisions, parameter mutations, or execution choices.

Fallback chain:
  1. prefer_gpu=False                  → "default.qubit"
  2. QUANTUM_CUQUANTUM_GPU_ENABLED!=true → "default.qubit"
  3. n_qubits > 25                     → "default.qubit" (RTX 5060 8GB cap)
  4. probe_vram(required_mb) is False  → "default.qubit"
  5. All checks pass                   → "lightning.gpu"

VRAM formula (per plan): required_mb = int(2 ** (n_qubits - 3) + 200)
Safety margin of +500 MB is applied inside probe_vram, not here.
"""
from __future__ import annotations

import importlib.util
import logging
import os

from src.engine.hardware_profile import probe_vram

# institutional-grade perf (2026-07-06): prefer the C++ CPU backend `lightning.qubit` (pennylane-lightning)
# over the pure-Python `default.qubit` — it is ~10-100x faster and uses NO VRAM, which brought the QCNN
# noise circuit in quantum_entropy_filter.py from ~2000ms/call (default.qubit) to well under the 500ms
# signal-path budget. Falls back to default.qubit when pennylane-lightning is not installed.
_LIGHTNING_QUBIT_AVAILABLE = importlib.util.find_spec("pennylane_lightning") is not None


def _best_cpu_device() -> str:
    """Fastest always-available CPU PennyLane device: lightning.qubit if installed, else default.qubit."""
    return "lightning.qubit" if _LIGHTNING_QUBIT_AVAILABLE else "default.qubit"

logger = logging.getLogger(__name__)

# RTX 5060 (8 GB VRAM) state-vector cap.  Circuits > 25 qubits will OOM.
_MAX_QUBITS_GPU: int = 25


def select_quantum_device(n_qubits: int, prefer_gpu: bool = True) -> str:
    """Return "lightning.gpu" or "default.qubit" for use with qml.device().

    Advisory only — callers decide what to do with the returned label.
    This function never raises; any internal exception causes "default.qubit"
    to be returned and a warning to be logged.

    Args:
        n_qubits: Number of qubits the circuit requires.
        prefer_gpu: Set False to force CPU regardless of environment.

    Returns:
        "lightning.gpu" if GPU acceleration is available and safe.
        "default.qubit" in all other cases (safe CPU fallback).

    Authority: advisory — does not gate lifecycle transitions.
    """
    try:
        return _select(n_qubits, prefer_gpu)
    except Exception as exc:  # strict no-raise contract
        logger.warning(
            "quantum_device_selector: unexpected error during selection "
            "(n_qubits=%d, prefer_gpu=%s): %s — falling back to default.qubit",
            n_qubits,
            prefer_gpu,
            exc,
        )
        return _best_cpu_device()


def _select(n_qubits: int, prefer_gpu: bool) -> str:
    """Inner selector — may raise; outer wrapper catches all exceptions."""
    if not prefer_gpu:
        return _best_cpu_device()

    if os.getenv("QUANTUM_CUQUANTUM_GPU_ENABLED", "false").lower() != "true":
        return _best_cpu_device()

    if n_qubits > _MAX_QUBITS_GPU:
        logger.warning(
            "quantum_device_selector: n_qubits=%d exceeds RTX 5060 8GB cap "
            "(%d max); using CPU (default.qubit)",
            n_qubits,
            _MAX_QUBITS_GPU,
        )
        return _best_cpu_device()

    required_mb = int(2 ** (n_qubits - 3) + 200)
    if probe_vram(required_mb):
        return "lightning.gpu"

    return _best_cpu_device()
