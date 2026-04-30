"""Quantum Entropy Filter — QCNN-style VQC for microstructure noise scoring.

Tier 3.1 / W3a — Gemini Quantum Blueprint.
Challenger-only. Advisory output. No execution authority.

Architecture: Quantum Convolutional Neural Network (QCNN) on 8 qubits.
  - Conv layer 1: 8 RY rotations + 8 CNOT ring entanglers
  - Conv layer 2: 8 RY rotations + 8 CNOT ring entanglers
  - Pooling layer: measure qubits 0,2,4,6; condition RY on qubits 1,3,5,7
  - Readout: PauliZ expectation on qubit 1 → [0,1] via (1 + expval) / 2
  Total gates: 16 RY + 16 CNOT + 4 conditional RY + 1 PauliZ = 37 operations

Feature encoding: AmplitudeEmbedding (8 features → 8-qubit amplitude state).
  Each feature is z-score normalized then tanh-squashed to [-1, 1] before encoding.

Output: noise_score ∈ [0, 1]
  0 = perfectly ordered/trending microstructure
  1 = maximum disorder/chop

Threshold: QUANTUM_NOISE_THRESHOLD = 0.5 (placeholder)
  TODO: Calibrate after 30 days of skip_decisions data accumulates.
  Run on 30 days of historical wick-out events (days where price spiked +
  reversed within 1 ATR). Pick threshold maximizing precision at 80% recall.
  See CLAUDE.md § Tier 3.1 Threshold Calibration Plan.

Devices:
  - Default: default.qubit (CPU, always available)
  - GPU: lightning.gpu if QUANTUM_CUQUANTUM_GPU_ENABLED=true (W4 adds VRAM probe)

Governance: experimental=True, authoritative=False, decision_role=challenger_only
"""
from __future__ import annotations

import logging
import math
import os
import time
from typing import Any, Optional

import numpy as np

# ─── Governance Labels ────────────────────────────────────────────────────────
GOVERNANCE_LABELS: dict[str, Any] = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": (
        "Quantum entropy filter scores microstructure disorder per session. "
        "Advisory only — never authoritative. Compare with classical ATR/volume baselines."
    ),
    "tier": "3.1",
    "wave": "W3a",
}

# ─── Threshold (placeholder — calibrate after 30 days) ────────────────────────
# TODO(calibration): Replace 0.5 with empirically derived threshold.
# Method: collect 30+ days of skip_decisions.signals.quantum_noise_score rows.
# Filter to days with wick-out events (price spike + reversal within 1 ATR).
# Compute precision/recall curve; pick threshold at 80% recall.
# See CLAUDE.md § Tier 3.1 Threshold Calibration Plan.
QUANTUM_NOISE_THRESHOLD: float = 0.5

# ─── QCNN Architecture Constants ─────────────────────────────────────────────
N_QUBITS: int = 8
# Ordered feature keys. Missing keys are padded with 0.0.
FEATURE_KEYS: list[str] = [
    "atr_5m",
    "order_flow_imbalance",
    "vix",
    "gap_atr",
    "spread",
    "premarket_volume_pct",
    "consecutive_losses",
    "monthly_dd_usage",
]

# ─── Feature normalization statistics (nominal ranges, pre-calibration) ───────
# Used for z-score → tanh squash. Values based on typical futures session ranges.
# TODO(calibration): Refit these means/stds after 30 days of real data.
_FEATURE_STATS: dict[str, tuple[float, float]] = {
    "atr_5m":                  (0.5,  0.3),   # (mean, std) in ATR multiples
    "order_flow_imbalance":    (0.0,  0.3),   # imbalance ratio [-1, 1] normalized
    "vix":                     (20.0, 8.0),   # VIX points
    "gap_atr":                 (0.3,  0.4),   # overnight gap in ATR multiples
    "spread":                  (0.05, 0.04),  # bid-ask in price units
    "premarket_volume_pct":    (0.7,  0.3),   # fraction of normal volume
    "consecutive_losses":      (1.0,  1.5),   # count of losing days
    "monthly_dd_usage":        (0.3,  0.25),  # fraction of monthly DD budget used
}

# ─── Optional PennyLane ───────────────────────────────────────────────────────
_PENNYLANE_IMPORT_LOGGED: bool = False

try:
    import pennylane as qml
    PENNYLANE_AVAILABLE = True
except ImportError:
    PENNYLANE_AVAILABLE = False

logger = logging.getLogger(__name__)

# ─── Feature Preparation ──────────────────────────────────────────────────────


def _normalize_features(raw: dict[str, float]) -> Optional[np.ndarray]:
    """Z-score normalize then tanh-squash each feature to approximately [-1, 1].

    Returns an 8-element array, or None if any value is NaN or Inf.
    Missing keys are padded to 0.0 (their nominal mean → z=0 → tanh(0)=0).
    """
    vec = np.zeros(N_QUBITS, dtype=np.float64)
    for i, key in enumerate(FEATURE_KEYS):
        val = float(raw.get(key, 0.0))
        if not math.isfinite(val):
            return None
        mean, std = _FEATURE_STATS.get(key, (0.0, 1.0))
        # Clamp extreme values before tanh: z-score, then squash
        z = (val - mean) / (std if std > 0 else 1.0)
        vec[i] = math.tanh(z)

    # AmplitudeEmbedding requires a state of length 2^N_QUBITS (256 for 8 qubits).
    # Pad the 8-feature vector to 256 by repeating it cyclically, then normalize.
    state_size = 2 ** N_QUBITS  # 256
    padded = np.resize(vec, state_size).astype(np.float64)  # repeats vec cyclically
    norm = float(np.linalg.norm(padded))
    if norm < 1e-8:
        # All features at their mean → uniform state → mild noise
        padded = np.ones(state_size, dtype=np.float64) / math.sqrt(state_size)
    # AmplitudeEmbedding normalize=True handles the final normalization
    return padded


# ─── QCNN Circuit Builder ─────────────────────────────────────────────────────


def _build_qcnn_circuit(features: np.ndarray, params: np.ndarray, dev: Any) -> float:
    """Build and execute QCNN circuit. Returns PauliZ expectation on qubit 1.

    Circuit structure:
      [AmplitudeEmbedding] → [Conv1: RY ring + CNOT ring] →
      [Conv2: RY ring + CNOT ring] → [Pooling: measure+condition on alternates] →
      [Readout: PauliZ on qubit 1]

    params shape: (36,) — 8 RY conv1 + 8 RY conv2 + 4 conditional RY + 16 CNOT phases (no params for CNOT)
    Actually: params = [conv1_ry(0..7), conv2_ry(0..7), pool_ry(0..3)] → shape (20,)
    """
    @qml.qnode(dev, diff_method="backprop")
    def circuit(features_vec: np.ndarray, params_vec: np.ndarray) -> float:
        # ── Amplitude Encoding ──────────────────────────────────────────────
        qml.AmplitudeEmbedding(features=features_vec, wires=range(N_QUBITS), normalize=True)

        # ── Convolutional Layer 1 ───────────────────────────────────────────
        # 8 parameterized RY rotations
        for i in range(N_QUBITS):
            qml.RY(params_vec[i], wires=i)
        # CNOT ring entangler: q0→q1, q1→q2, ..., q7→q0
        for i in range(N_QUBITS):
            qml.CNOT(wires=[i, (i + 1) % N_QUBITS])

        # ── Convolutional Layer 2 ───────────────────────────────────────────
        # 8 more parameterized RY rotations (params 8..15)
        for i in range(N_QUBITS):
            qml.RY(params_vec[N_QUBITS + i], wires=i)
        # CNOT ring entangler (same topology, second pass)
        for i in range(N_QUBITS):
            qml.CNOT(wires=[i, (i + 1) % N_QUBITS])

        # ── Pooling Layer ───────────────────────────────────────────────────
        # Measure qubits 0, 2, 4, 6 (control qubits).
        # Condition RY on qubits 1, 3, 5, 7 (target qubits).
        # Implementation: use classically-controlled RY (mid-circuit measurement).
        # PennyLane supports this via qml.measure + qml.cond.
        pool_params_offset = 2 * N_QUBITS  # 16
        pool_pairs = [(0, 1), (2, 3), (4, 5), (6, 7)]
        for pi, (ctrl_wire, tgt_wire) in enumerate(pool_pairs):
            m_result = qml.measure(ctrl_wire)
            qml.cond(m_result, qml.RY)(
                params_vec[pool_params_offset + pi], wires=tgt_wire
            )

        # ── Readout ─────────────────────────────────────────────────────────
        # PauliZ expectation on the first surviving qubit (wire 1)
        return qml.expval(qml.PauliZ(1))

    return float(circuit(features_vec=features, params_vec=params))


# ─── Public API ───────────────────────────────────────────────────────────────


def collect_quantum_noise(
    features: dict[str, float],
    seed: int = 42,
) -> Optional[float]:
    """Run QCNN entropy filter and return noise_score in [0, 1], or None.

    Args:
        features: Dict of pre-session feature values. Missing keys padded to 0.0.
        seed:     RNG seed for reproducible weight initialization.

    Returns:
        float in [0, 1] if PennyLane available and features are valid.
        None if:
          - PennyLane is unavailable (PENNYLANE_AVAILABLE is False)
          - features dict is empty
          - any feature is NaN or Inf
          - circuit execution fails
    """
    global _PENNYLANE_IMPORT_LOGGED

    if not features:
        return None

    if not PENNYLANE_AVAILABLE:
        if not _PENNYLANE_IMPORT_LOGGED:
            logger.warning(
                "quantum_entropy_filter: PennyLane not available — "
                "returning None (classical skip engine path unchanged). "
                "Install with: pip install pennylane"
            )
            _PENNYLANE_IMPORT_LOGGED = True
        return None

    # Normalize features
    feature_vec = _normalize_features(features)
    if feature_vec is None:
        logger.warning("quantum_entropy_filter: non-finite feature value — returning None")
        return None

    try:
        # Select device: GPU only if env flag + W4 VRAM probe (not yet wired)
        # For W3a: always use default.qubit (CPU)
        device_name = "default.qubit"
        if os.getenv("QUANTUM_CUQUANTUM_GPU_ENABLED") == "true":
            # W4 will add VRAM probe here. For now, log and stay on CPU.
            logger.debug(
                "quantum_entropy_filter: QUANTUM_CUQUANTUM_GPU_ENABLED=true but "
                "VRAM probe not yet implemented (W4). Using default.qubit."
            )

        dev = qml.device(device_name, wires=N_QUBITS, seed=seed)

        # Initialize parameters with fixed seed for reproducibility
        # params shape: [conv1_ry(0..7), conv2_ry(0..7), pool_ry(0..3)] = 20 params
        n_params = 2 * N_QUBITS + 4  # 20
        rng = np.random.default_rng(seed)
        params = rng.uniform(-np.pi, np.pi, size=n_params)

        # Execute QCNN circuit
        expval = _build_qcnn_circuit(feature_vec, params, dev)

        # Map PauliZ expectation from [-1, 1] to [0, 1]
        noise_score = (1.0 + expval) / 2.0
        # Clamp to [0, 1] for floating point edge cases
        noise_score = float(np.clip(noise_score, 0.0, 1.0))

        return noise_score

    except Exception as exc:
        logger.warning("quantum_entropy_filter: circuit execution failed: %s", exc)
        return None


def run_quantum_entropy_filter(
    features: dict[str, float],
    seed: int = 42,
) -> dict[str, Any]:
    """Run entropy filter and return full evidence dict with provenance metadata.

    This is the full evidence packaging function for downstream critic consumption.
    The simpler collect_quantum_noise() is used by premarket_analyzer.py.

    Returns:
        Dict with keys:
          noise_score:        float | None — the primary signal
          execution_time_ms:  int
          hardware:           str — 'default.qubit' | 'fallback_unavailable'
          seed:               int
          n_qubits:           int
          n_params:           int
          features_used:      list[str]
          governance:         dict — challenger_only labels
          pennylane_available: bool
    """
    t0 = time.time()

    noise_score = collect_quantum_noise(features, seed=seed)

    elapsed_ms = int((time.time() - t0) * 1000)
    hardware = "default.qubit" if PENNYLANE_AVAILABLE else "fallback_unavailable"

    return {
        "noise_score": noise_score,
        "execution_time_ms": elapsed_ms,
        "hardware": hardware,
        "seed": seed,
        "n_qubits": N_QUBITS,
        "n_params": 2 * N_QUBITS + 4,
        "features_used": [k for k in FEATURE_KEYS if k in features],
        "governance": GOVERNANCE_LABELS.copy(),
        "pennylane_available": PENNYLANE_AVAILABLE,
        "threshold": QUANTUM_NOISE_THRESHOLD,
    }
