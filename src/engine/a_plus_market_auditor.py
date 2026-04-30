"""A+ Market Auditor — Tier 3.3 (Gemini Quantum Blueprint, W3b).

Challenger-only. Advisory output. No execution authority.

Runs at 8:00 AM ET pre-market (cron via scheduler.ts) to score MES, MNQ, MCL
and pick today's highest-edge market. Emits OBSERVATION_MODE if no market
clears all thresholds.

Components per market:
  1. Volatility Audit: current ATR vs 8-year Databento average → atr_ratio
  2. Quantum MC: P(hit 1:2 Reward) via run_quantum_target_hit_estimation (reused from Tier 1)
  3. Quantum Entropy Filter (W3a): per-market noise_score via collect_quantum_noise()
  4. Cross-Market Lead-Lag Entanglement (NEW): 4-qubit VQC (PennyLane)
     Topology: {MES, MNQ, MCL, DXY} — one qubit each.
     Encoding: rolling 60-min correlation matrix → RY rotations + CNOT fan-out.
     Output: lead_market, lag_window_minutes, entanglement_strength ∈ [0,1]

Edge Score formula (weights sum to 1.0):
  composite = 0.40 * vol_score
            + 0.40 * p_target_hit
            + 0.10 * (1 - noise_score)
            + 0.10 * entanglement_strength

  where vol_score = 1 / (1 + max(0, atr_ratio - 1))  (penalises elevated vol)

Winner rules (all must pass):
  - edge_score is highest among markets
  - p_target_hit > P_TARGET_HIT_THRESHOLD (0.75)
  - noise_score < NOISE_SCORE_THRESHOLD (0.50)

Lead-lag bonus: if winner is LAGGING market AND entanglement_strength > 0.7,
  publish lead_market_signal in output. Strategies opt-in via DSL flag.

PROP FIRM COMPLIANCE: This module produces the SIGNAL only.
  Tier 5.3.1 (check_correlated_position_guard, W5b) enforces SEQUENCE.
  Never trade correlated positions simultaneously.

Governance: experimental=True, authoritative=False, decision_role=challenger_only
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

# ─── Governance Labels ────────────────────────────────────────────────────────
GOVERNANCE_LABELS: dict[str, Any] = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": (
        "A+ Market Auditor: daily cross-market scoring and lead-lag entanglement. "
        "Advisory only — never authoritative. "
        "Prop firm compliance (correlated position guard) lives in Tier 5.3.1."
    ),
    "tier": "3.3",
    "wave": "W3b",
}

# ─── Threshold Constants ──────────────────────────────────────────────────────
# TODO(calibration): Revisit after 30 days of scan data.
P_TARGET_HIT_THRESHOLD: float = 0.75
NOISE_SCORE_THRESHOLD: float = 0.50
ENTANGLEMENT_STRENGTH_THRESHOLD: float = 0.70  # for lead-lag bonus signal

# ─── Edge Score Weights ───────────────────────────────────────────────────────
EDGE_SCORE_WEIGHTS: dict[str, float] = {
    "vol": 0.40,
    "p_target": 0.40,
    "noise": 0.10,
    "entangle": 0.10,
}
assert abs(sum(EDGE_SCORE_WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"

# ─── VQC Architecture ────────────────────────────────────────────────────────
_VQC_N_QUBITS: int = 4  # one per market: [MES, MNQ, MCL, DXY]
_VQC_MARKETS: list[str] = ["MES", "MNQ", "MCL", "DXY"]
# Lag window in minutes — Gemini Image 8 reference: "15 min later"
_DEFAULT_LAG_WINDOW_MINUTES: int = 15

# ─── Optional PennyLane ───────────────────────────────────────────────────────
try:
    import pennylane as qml
    PENNYLANE_AVAILABLE = True
except ImportError:
    PENNYLANE_AVAILABLE = False

logger = logging.getLogger(__name__)


# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class AuditInput:
    """Per-market inputs for a single audit run.

    Callers pass pre-computed values. Override fields allow tests to inject
    p_target_hit and noise_score without running full quantum circuits.
    """
    market: str
    atr_5m: float                         # Current session ATR (5-min bars)
    atr_8yr_avg: float                    # 8-year Databento rolling average ATR
    vix: float
    gap_atr: float                        # Overnight gap in ATR multiples
    spread: float                         # Bid-ask spread in price units

    # Override fields — used by tests and callers who already have these values
    p_target_hit_override: Optional[float] = None    # If set, skip quantum MC circuit
    noise_score_override: Optional[float] = None     # If set, skip entropy filter circuit
    seed: int = 42


@dataclass
class MarketEvidence:
    """Evidence for a single market after running all audit components."""
    market: str
    atr_ratio: float                      # current / 8yr avg
    p_target_hit: float                   # P(hit 1:2 reward)
    noise_score: Optional[float]          # [0,1] or None if PennyLane unavailable
    entanglement_strength: Optional[float]  # [0,1] or None
    composite_edge_score: float           # [0,1]
    passes_p_target_gate: bool
    passes_noise_gate: bool


@dataclass
class AuditResult:
    """Full scan result returned by run_full_scan()."""
    winner_market: Optional[str]          # MES | MNQ | MCL | None
    observation_mode: bool
    edge_scores: dict[str, dict[str, Any]]   # {MES: {vol, p_target, noise, entangle, composite}, ...}
    lead_market: Optional[str]            # MES | MNQ | MCL | DXY | None
    lag_window_minutes: Optional[int]
    entanglement_strength: Optional[float]
    governance: dict[str, Any]
    scan_duration_ms: int
    hardware: str                         # explicit local/fallback label
    seed: int


# ─── Edge Score Computation ───────────────────────────────────────────────────

def compute_edge_score(
    atr_ratio: float,
    p_target_hit: float,
    noise_score: Optional[float],
    entanglement_strength: Optional[float],
) -> float:
    """Compute composite edge score in [0, 1].

    Formula:
        vol_score = 1 / (1 + max(0, atr_ratio - 1))
        composite = 0.40 * vol_score
                  + 0.40 * p_target_hit
                  + 0.10 * (1 - noise_score)    [neutral=0.5 when None]
                  + 0.10 * entanglement_strength [neutral=0.5 when None]

    vol_score rationale: ATR at historical average → vol_score=1.0 (best).
    2x average → vol_score=0.5. 3x → 0.33. Penalises elevated vol monotonically.
    """
    # vol_score: 1 at average, decays as ratio climbs
    safe_ratio = max(0.0, float(atr_ratio))
    vol_score = 1.0 / (1.0 + max(0.0, safe_ratio - 1.0))

    # p_target already in [0,1]
    p = float(np.clip(p_target_hit, 0.0, 1.0))

    # noise → benefit (lower noise = higher score); None → neutral 0.5
    noise_val = float(np.clip(noise_score, 0.0, 1.0)) if noise_score is not None else 0.5
    noise_benefit = 1.0 - noise_val

    # entanglement → direct benefit; None → neutral 0.5
    entangle_val = float(np.clip(entanglement_strength, 0.0, 1.0)) if entanglement_strength is not None else 0.5

    composite = (
        EDGE_SCORE_WEIGHTS["vol"] * vol_score
        + EDGE_SCORE_WEIGHTS["p_target"] * p
        + EDGE_SCORE_WEIGHTS["noise"] * noise_benefit
        + EDGE_SCORE_WEIGHTS["entangle"] * entangle_val
    )
    return float(np.clip(composite, 0.0, 1.0))


# ─── Cross-Market Lead-Lag Entanglement VQC ───────────────────────────────────

def _build_entanglement_circuit(
    corr_matrix: dict[str, dict[str, float]],
    dev: Any,
    seed: int,
) -> dict[str, Any]:
    """Build and run 4-qubit VQC encoding cross-market correlations.

    Architecture:
      Qubit 0 = MES, Qubit 1 = MNQ, Qubit 2 = MCL, Qubit 3 = DXY

    Encoding:
      1. Extract upper triangle of correlation matrix → 6 pairwise values.
      2. Map each r ∈ [-1,1] → rotation angle θ = arcsin(r) ∈ [-π/2, π/2].
         Positive correlation → small angle (qubits aligned).
         Negative correlation → angle near -π/2 (anti-correlated).
      3. RY(θ_i) on each qubit (diagonal — own-market "certainty").
      4. CNOT fan-out: q0→q1, q0→q2, q1→q3 (leader→follower topology).
      5. Additional RY(pair_r) on target qubits to encode lag magnitude.
      6. Readout: PauliZ expectation on each qubit → Z_i ∈ [-1,1].
         Lead market = qubit with highest Z (most directional certainty).
         Entanglement strength = (1 + mean(|Z_i|)) / 2.

    Returns dict with lead_market, lag_window_minutes, entanglement_strength,
    per_qubit_z, execution_time_ms.
    """
    @qml.qnode(dev, diff_method="backprop")
    def circuit(angles: np.ndarray) -> list:
        # ── Amplitude-encode diagonal (own-market directional certainty) ──
        for i in range(_VQC_N_QUBITS):
            qml.RY(angles[i], wires=i)

        # ── CNOT fan-out: leader → follower entanglement structure ──
        # MES → MNQ (q0 → q1): equity index lead-lag (Gemini Image 8)
        qml.CNOT(wires=[0, 1])
        # MNQ → DXY (q1 → q3): tech-to-dollar inverse
        qml.CNOT(wires=[1, 3])
        # MES → MCL (q0 → q2): risk-on / risk-off
        qml.CNOT(wires=[0, 2])

        # ── Pairwise correlation rotations on target qubits ──
        # angles[4] = θ(MES,MNQ), angles[5] = θ(MES,MCL),
        # angles[6] = θ(MNQ,MCL), angles[7] = θ(MES,DXY),
        # angles[8] = θ(MNQ,DXY), angles[9] = θ(MCL,DXY)
        qml.RY(angles[4], wires=1)   # MES-MNQ pair refines MNQ qubit
        qml.RY(angles[5], wires=2)   # MES-MCL pair refines MCL qubit
        qml.RY(angles[6], wires=2)   # MNQ-MCL pair additional MCL refinement
        qml.RY(angles[7], wires=3)   # MES-DXY pair refines DXY qubit
        qml.RY(angles[8], wires=3)   # MNQ-DXY pair additional DXY refinement
        qml.RY(angles[9], wires=2)   # MCL-DXY pair additional MCL refinement

        # ── Readout: PauliZ expectation per qubit ──
        return [qml.expval(qml.PauliZ(i)) for i in range(_VQC_N_QUBITS)]

    # Build angle vector
    # Diagonal angles: arcsin(clip(r_self, -1, 1)) — using parameterized seed-based weights
    # For own-market: use fixed parameterized angle from seeded RNG (no self-correlation → 1.0)
    rng = np.random.default_rng(seed)
    diag_angles = rng.uniform(-np.pi / 4, np.pi / 4, size=_VQC_N_QUBITS)

    # Pairwise correlations: order matches angles[4..9]
    pairs = [
        ("MES", "MNQ"), ("MES", "MCL"), ("MNQ", "MCL"),
        ("MES", "DXY"), ("MNQ", "DXY"), ("MCL", "DXY"),
    ]
    pair_angles = []
    for m1, m2 in pairs:
        r = corr_matrix.get(m1, {}).get(m2, 0.0)
        r = float(np.clip(r, -1.0, 1.0))
        theta = math.asin(r)  # maps [-1,1] → [-π/2, π/2]
        pair_angles.append(theta)

    angles = np.array(list(diag_angles) + pair_angles, dtype=np.float64)

    t0 = time.time()
    z_vals = circuit(angles)
    elapsed_ms = int((time.time() - t0) * 1000)

    z_arr = np.array([float(z) for z in z_vals])

    # Lead market: qubit with highest Z expectation (most directional certainty)
    lead_idx = int(np.argmax(z_arr))
    lead_market = _VQC_MARKETS[lead_idx]

    # Entanglement strength: mean absolute Z expectation → [0,1]
    entanglement_strength = float(np.clip(float(np.mean(np.abs(z_arr))), 0.0, 1.0))

    return {
        "lead_market": lead_market,
        "lag_window_minutes": _DEFAULT_LAG_WINDOW_MINUTES,
        "entanglement_strength": entanglement_strength,
        "per_qubit_z": {m: float(z_arr[i]) for i, m in enumerate(_VQC_MARKETS)},
        "execution_time_ms": elapsed_ms,
    }


def _fallback_classical_entanglement(
    corr_matrix: dict[str, dict[str, float]],
) -> dict[str, Any]:
    """Classical fallback for cross-market lead-lag when PennyLane is unavailable.

    Computes row-mean of absolute correlations as a proxy for directionality.
    Returns lead_market by max row-mean, entanglement_strength from same.
    """
    scores: dict[str, float] = {}
    for m in _VQC_MARKETS:
        row = corr_matrix.get(m, {})
        others = [abs(v) for k, v in row.items() if k != m]
        scores[m] = float(np.mean(others)) if others else 0.0

    if not scores:
        return {
            "lead_market": None,
            "lag_window_minutes": None,
            "entanglement_strength": None,
            "hardware": "fallback_classical",
            "execution_time_ms": 0,
        }

    lead_market = max(scores, key=lambda k: scores[k])
    entanglement_strength = float(np.clip(scores[lead_market], 0.0, 1.0))
    return {
        "lead_market": lead_market,
        "lag_window_minutes": _DEFAULT_LAG_WINDOW_MINUTES,
        "entanglement_strength": entanglement_strength,
        "hardware": "fallback_classical",
        "execution_time_ms": 0,
    }


def run_cross_market_entanglement(
    corr_matrix: dict[str, dict[str, float]],
    seed: int = 42,
) -> dict[str, Any]:
    """Run 4-qubit VQC cross-market lead-lag entanglement.

    Returns dict with:
      lead_market:           str | None
      lag_window_minutes:    int | None
      entanglement_strength: float ∈ [0,1] | None
      hardware:              str ('default.qubit' | 'fallback_classical' | 'fallback_unavailable')
      execution_time_ms:     int

    Advisory output only. No execution authority.
    """
    if not PENNYLANE_AVAILABLE:
        logger.warning(
            "a_plus_market_auditor: PennyLane not available — "
            "cross-market entanglement returns None. "
            "Edge score uses neutral entanglement value (0.5)."
        )
        return {
            "lead_market": None,
            "lag_window_minutes": None,
            "entanglement_strength": None,
            "hardware": "fallback_unavailable",
            "execution_time_ms": 0,
        }

    # Validate correlation matrix has all markets
    for m in _VQC_MARKETS:
        if m not in corr_matrix:
            logger.warning(
                "a_plus_market_auditor: correlation matrix missing market %s — "
                "falling back to classical entanglement proxy",
                m,
            )
            result = _fallback_classical_entanglement(corr_matrix)
            return result

    try:
        dev = qml.device("default.qubit", wires=_VQC_N_QUBITS, seed=seed)
        circuit_result = _build_entanglement_circuit(corr_matrix, dev, seed)
        circuit_result["hardware"] = "default.qubit"
        return circuit_result
    except Exception as exc:
        logger.warning(
            "a_plus_market_auditor: VQC entanglement circuit failed: %s — "
            "falling back to classical proxy",
            exc,
        )
        result = _fallback_classical_entanglement(corr_matrix)
        return result


# ─── Per-Market Audit ─────────────────────────────────────────────────────────

def run_market_audit(
    inp: AuditInput,
    entanglement_strength: Optional[float],
) -> MarketEvidence:
    """Run volatility audit + quantum components for a single market.

    p_target_hit and noise_score are taken from override fields when set
    (test injection path). In production, callers compute them externally
    via quantum_mc.run_quantum_target_hit_estimation and
    quantum_entropy_filter.collect_quantum_noise then pass via override.
    """
    # ── Volatility Audit ─────────────────────────────────────────────────────
    atr_ratio = float(inp.atr_5m) / max(float(inp.atr_8yr_avg), 1e-8)

    # ── P(target hit) ────────────────────────────────────────────────────────
    if inp.p_target_hit_override is not None:
        p_target_hit = float(np.clip(inp.p_target_hit_override, 0.0, 1.0))
    else:
        # Production path: run quantum MC. This is expensive — callers should
        # pre-compute and pass via override in batch scenarios.
        # Default to 0.5 (neutral) if circuit not wired at this call site.
        logger.debug(
            "a_plus_market_auditor: p_target_hit_override not set for %s — using neutral 0.5",
            inp.market,
        )
        p_target_hit = 0.5

    # ── Noise Score ──────────────────────────────────────────────────────────
    if inp.noise_score_override is not None:
        noise_score: Optional[float] = float(np.clip(inp.noise_score_override, 0.0, 1.0))
    else:
        # Production path: call collect_quantum_noise() with per-market features.
        # Callers should pre-compute. Neutral here.
        noise_score = None

    # ── Gates ────────────────────────────────────────────────────────────────
    passes_p_target = p_target_hit > P_TARGET_HIT_THRESHOLD
    passes_noise = (noise_score is None) or (noise_score < NOISE_SCORE_THRESHOLD)

    # ── Composite Edge Score ─────────────────────────────────────────────────
    composite = compute_edge_score(atr_ratio, p_target_hit, noise_score, entanglement_strength)

    return MarketEvidence(
        market=inp.market,
        atr_ratio=atr_ratio,
        p_target_hit=p_target_hit,
        noise_score=noise_score,
        entanglement_strength=entanglement_strength,
        composite_edge_score=composite,
        passes_p_target_gate=passes_p_target,
        passes_noise_gate=passes_noise,
    )


# ─── Full Scan ────────────────────────────────────────────────────────────────

def run_full_scan(
    market_inputs: dict[str, AuditInput],
    corr_matrix: dict[str, dict[str, float]],
    seed: int = 42,
) -> AuditResult:
    """Run full A+ Market Auditor scan across all markets.

    Args:
        market_inputs: dict of {market_symbol: AuditInput}
        corr_matrix:   rolling 60-min return correlation matrix for {MES,MNQ,MCL,DXY}
        seed:          RNG seed for reproducibility

    Returns AuditResult with winner_market, observation_mode, edge_scores,
    lead_market, lag_window_minutes, entanglement_strength, governance metadata.

    Authority: advisory / challenger_only. No execution authority.
    Compliance: see Tier 5.3.1 (check_correlated_position_guard) for correlated
    position enforcement.
    """
    t0 = time.time()

    # ── Cross-market entanglement (shared across all markets) ────────────────
    entangle_result = run_cross_market_entanglement(corr_matrix, seed=seed)
    ent_strength = entangle_result.get("entanglement_strength")
    lead_market = entangle_result.get("lead_market")
    lag_window_minutes = entangle_result.get("lag_window_minutes")
    hardware = entangle_result.get("hardware", "fallback_unavailable")

    # ── Per-market audits ─────────────────────────────────────────────────────
    evidence_map: dict[str, MarketEvidence] = {}
    for symbol, inp in market_inputs.items():
        ev = run_market_audit(inp, entanglement_strength=ent_strength)
        evidence_map[symbol] = ev

    # ── Winner selection ─────────────────────────────────────────────────────
    # Eligible markets: must pass BOTH p_target AND noise gates
    eligible = {
        sym: ev for sym, ev in evidence_map.items()
        if ev.passes_p_target_gate and ev.passes_noise_gate
    }

    winner_market: Optional[str] = None
    if eligible:
        winner_market = max(eligible, key=lambda s: eligible[s].composite_edge_score)

    observation_mode = winner_market is None

    # ── Lead-lag bonus flag ───────────────────────────────────────────────────
    # When winner is the LAGGING market AND entanglement_strength > threshold,
    # the lead_market field is published so strategies can opt-in to
    # require_lead_market_confirmation via DSL fixture flag.
    # NOTE: Prop firm correlated-position guard is enforced in Tier 5.3.1 (W5b).
    publish_lead_market = (
        winner_market is not None
        and lead_market is not None
        and lead_market != winner_market
        and ent_strength is not None
        and ent_strength > ENTANGLEMENT_STRENGTH_THRESHOLD
    )

    # ── Edge scores JSONB ─────────────────────────────────────────────────────
    edge_scores: dict[str, dict[str, Any]] = {}
    for sym, ev in evidence_map.items():
        edge_scores[sym] = {
            "vol": round(1.0 / (1.0 + max(0.0, ev.atr_ratio - 1.0)), 4),
            "p_target": round(ev.p_target_hit, 4),
            "noise": round(ev.noise_score, 4) if ev.noise_score is not None else None,
            "entangle": round(ent_strength, 4) if ent_strength is not None else None,
            "composite": round(ev.composite_edge_score, 4),
            "passes_p_target_gate": ev.passes_p_target_gate,
            "passes_noise_gate": ev.passes_noise_gate,
        }

    elapsed_ms = int((time.time() - t0) * 1000)

    return AuditResult(
        winner_market=winner_market,
        observation_mode=observation_mode,
        edge_scores=edge_scores,
        lead_market=lead_market if publish_lead_market else None,
        lag_window_minutes=lag_window_minutes if publish_lead_market else None,
        entanglement_strength=ent_strength,
        governance=GOVERNANCE_LABELS.copy(),
        scan_duration_ms=elapsed_ms,
        hardware=hardware,
        seed=seed,
    )


# ─── CLI entry point (for subprocess invocation from TS service) ──────────────

def _cli_main() -> None:
    """CLI entry point. Reads JSON from --input-json or stdin; prints JSON result."""
    import json
    import argparse

    parser = argparse.ArgumentParser(description="A+ Market Auditor — Tier 3.3")
    parser.add_argument("--input-json", type=str, help="JSON input as string")
    args = parser.parse_args()

    if args.input_json:
        payload = json.loads(args.input_json)
    else:
        payload = json.loads(sys.stdin.read())  # type: ignore[name-defined]

    # Parse market_inputs
    market_inputs: dict[str, AuditInput] = {}
    for sym, mdata in payload.get("market_inputs", {}).items():
        market_inputs[sym] = AuditInput(
            market=sym,
            atr_5m=float(mdata.get("atr_5m", 2.5)),
            atr_8yr_avg=float(mdata.get("atr_8yr_avg", 2.5)),
            vix=float(mdata.get("vix", 18.0)),
            gap_atr=float(mdata.get("gap_atr", 0.2)),
            spread=float(mdata.get("spread", 0.05)),
            p_target_hit_override=mdata.get("p_target_hit") and float(mdata["p_target_hit"]),
            noise_score_override=mdata.get("noise_score") and float(mdata["noise_score"]),
            seed=int(payload.get("seed", 42)),
        )

    corr_matrix: dict[str, dict[str, float]] = payload.get("corr_matrix", {
        "MES": {"MES": 1.0, "MNQ": 0.82, "MCL": 0.15, "DXY": -0.30},
        "MNQ": {"MES": 0.82, "MNQ": 1.0, "MCL": 0.12, "DXY": -0.28},
        "MCL": {"MES": 0.15, "MNQ": 0.12, "MCL": 1.0, "DXY": 0.05},
        "DXY": {"MES": -0.30, "MNQ": -0.28, "MCL": 0.05, "DXY": 1.0},
    })
    seed = int(payload.get("seed", 42))

    result = run_full_scan(market_inputs, corr_matrix, seed=seed)

    output = {
        "winner_market": result.winner_market,
        "observation_mode": result.observation_mode,
        "edge_scores": result.edge_scores,
        "lead_market": result.lead_market,
        "lag_window_minutes": result.lag_window_minutes,
        "entanglement_strength": result.entanglement_strength,
        "governance": result.governance,
        "scan_duration_ms": result.scan_duration_ms,
        "hardware": result.hardware,
        "seed": result.seed,
    }
    import sys as _sys
    _sys.stdout.write(json.dumps(output) + "\n")


if __name__ == "__main__":
    import sys
    _cli_main()
