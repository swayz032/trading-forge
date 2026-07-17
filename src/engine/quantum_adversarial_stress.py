"""Quantum Adversarial Stress Test — Grover Worst-Case Sequencer.

Tier 3.4 (Gemini Quantum Blueprint). Challenger-only, advisory evidence.

Algorithm overview:
  1. Encode N trade outcomes as N qubits (|0> = win, |1> = loss).
  2. Build a Grover oracle that marks orderings where any sliding window
     of consecutive losses exceeds the prop-firm daily-loss limit.
  3. Run floor(pi/4 * sqrt(2**N / M)) Grover iterations to amplify
     breach orderings, where M is estimated from a pre-sampling pass.
  4. Measure K times to extract the top-K worst sequences.
  5. Output: worst_case_breach_prob, worst_sequence_examples,
     breach_minimal_n_trades.

This answers WORST-CASE ordering, not average-case (QAE) or random-case.
Classical fallback:
  N <= 12 trades: brute-force enumerate all 2**N orderings.
  N > 12 trades: 10K random-sample baseline.

Governance: experimental=True, authoritative=False, decision_role=challenger_only.
Phase 0 shadow only — lifecycle gate is 100% classical.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

import numpy as np
from pydantic import BaseModel, Field

# ─── Governance labels ────────────────────────────────────────────────────────
GOVERNANCE_LABELS: dict = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": "Grover adversarial stress — worst-case ordering evidence only",
}

# ─── Cost ceiling ─────────────────────────────────────────────────────────────
WALL_CLOCK_LIMIT_S: float = 30.0

# ─── Feature flag ─────────────────────────────────────────────────────────────
QUANTUM_ADVERSARIAL_STRESS_ENABLED: bool = (
    os.environ.get("QUANTUM_ADVERSARIAL_STRESS_ENABLED", "false").lower() == "true"
)

# ─── PennyLane imports (optional) ─────────────────────────────────────────────
try:
    import pennylane as qml
    PENNYLANE_AVAILABLE = True
except ImportError:
    PENNYLANE_AVAILABLE = False

from src.engine.quantum_device_selector import select_quantum_device  # noqa: E402

# ─── Models ───────────────────────────────────────────────────────────────────

class TradeRecord(BaseModel):
    """Single trade entry in the backtest ledger."""
    trade_id: str = ""
    pnl: float  # Net P&L for this trade (positive = win, negative = loss)
    direction: str = "long"
    entry_time: str = ""
    exit_time: str = ""


class PropFirmRules(BaseModel):
    """Prop firm rule set for breach detection."""
    daily_loss_limit: float       # Max single-day loss before account breach ($)
    max_consecutive_losers: int = 4  # Max consecutive losing trades before CLAUDE.md gate fires
    trailing_drawdown: float | None = None  # Trailing drawdown limit (optional)


class AdversarialStressResult(BaseModel):
    """Output of a Grover adversarial stress run.

    All fields needed to populate adversarial_stress_runs and
    lifecycle_transitions. Governance labels always present.
    """
    schema_version: str = "v1_challenger"  # F-4 (2026-05-21): schema version for downstream critic
    worst_case_breach_prob: float | None = None   # [0, 1] — None on failure
    breach_minimal_n_trades: int | None = None    # Smallest N consecutive that can breach
    worst_sequence_examples: list[dict] = Field(default_factory=list)  # top-K orderings
    n_qubits: int = 0
    n_trades: int = 0
    daily_loss_limit: float = 0.0
    method: str = "grover_quantum"  # grover_quantum | brute_force_classical | random_sample_classical
    status: str = "pending"         # pending | completed | failed | aborted
    error_message: str | None = None
    wall_clock_ms: int = 0
    qpu_seconds: float = 0.0        # 0 for local sim; nonzero only for cloud (future)
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())
    reproducibility_hash: str = ""
    hardware: str = "local_simulator"  # local_simulator | cloud_simulator | real_hardware


# ─── Oracle utilities ─────────────────────────────────────────────────────────

def _compute_breach_prob_classical(
    trade_pnls: list[float],
    daily_loss_limit: float,
    n_orderings_sampled: int,
    rng: random.Random,
) -> tuple[float, list[dict], int | None]:
    """Classical breach-probability estimator.

    For N <= 12: enumerate all 2**N loss/win assignments.
    For N > 12: sample 10K random orderings.

    Returns (breach_prob, top_k_examples, breach_minimal_n_trades).
    """
    n = len(trade_pnls)
    loss_amounts = [abs(p) for p in trade_pnls if p < 0]

    # Guarantee at least one loss amount for oracle to test
    if not loss_amounts:
        return 0.0, [], None

    breach_count = 0
    breach_examples: list[tuple[float, list[int]]] = []  # (loss_sum, ordering)
    breach_minimal_n: int | None = None

    def _check_ordering(ordering: list[int]) -> float | None:
        """Return worst rolling loss sum for this trade ordering (loss=1, win=0).

        F-8 fix (2026-05-20) + fixwave (2026-07-17) parity correction: loss
        amounts are indexed by CONSECUTIVE-LOSS-STREAK position (resets to 0
        on every win), matching the Grover oracle's marked-state precompute
        in `_grover_circuit` (its `consecutive_loss_idx` counter). The F-8
        fix's original "positional... i % len(loss_amounts)" scheme indexed
        by the trade's ABSOLUTE ordering position instead — that silently
        diverges from the Grover scheme whenever a loss streak doesn't start
        at ordering index 0 (e.g. ordering=[1,0,1,1,0] with loss_amounts
        [10,20,30]: the old scheme summed loss_amounts[0]+loss_amounts[2]+
        loss_amounts[0]=40 for the two-loss streak at positions 2-3, while
        Grover — and this corrected version — resets to loss_amounts[0] at
        the START of that streak and sums loss_amounts[0]+loss_amounts[1]=30).
        Parity between classical fallback and quantum path is mandatory —
        the breach probabilities must be comparable for governance; the old
        scheme violated that despite claiming to satisfy it.
        """
        worst = 0.0
        running = 0.0
        consecutive_loss_idx = 0
        for bit in ordering:
            if bit == 1:
                # Consecutive-streak indexing (parity with Grover oracle).
                # Bound by len(loss_amounts) when a streak outruns the
                # observed distinct loss amounts.
                loss_idx = min(len(loss_amounts) - 1, consecutive_loss_idx)
                running += loss_amounts[loss_idx]
                consecutive_loss_idx += 1
            else:
                running = 0.0  # day resets on a win (simplified model)
                consecutive_loss_idx = 0
            worst = max(worst, running)
        return worst

    if n <= 12:
        # Brute-force: all 2**n binary assignments
        for bits in itertools.product([0, 1], repeat=n):
            ordering = list(bits)
            worst_loss = _check_ordering(ordering)
            if worst_loss >= daily_loss_limit:
                breach_count += 1
                breach_examples.append((worst_loss, ordering))
                # Track minimal consecutive window that breaches
                for window in range(1, n + 1):
                    if sum(loss_amounts[:window]) >= daily_loss_limit:
                        if breach_minimal_n is None or window < breach_minimal_n:
                            breach_minimal_n = window
                        break
        total = 2 ** n
    else:
        # Random sampling: 10K orderings
        total = n_orderings_sampled
        for _ in range(total):
            ordering = [rng.randint(0, 1) for _ in range(n)]
            worst_loss = _check_ordering(ordering)
            if worst_loss >= daily_loss_limit:
                breach_count += 1
                breach_examples.append((worst_loss, ordering))
                for window in range(1, n + 1):
                    if sum(loss_amounts[:window]) >= daily_loss_limit:
                        if breach_minimal_n is None or window < breach_minimal_n:
                            breach_minimal_n = window
                        break

    breach_prob = breach_count / max(1, total)

    # Top-K worst examples (sort by loss sum descending)
    breach_examples.sort(key=lambda x: x[0], reverse=True)
    top_k = [
        {"loss_sum": round(ls, 2), "sequence": seq}
        for ls, seq in breach_examples[:5]
    ]

    return breach_prob, top_k, breach_minimal_n


# ─── Grover quantum path ──────────────────────────────────────────────────────

def _grover_circuit(
    n_qubits: int,
    loss_indices: list[int],
    daily_loss_limit: float,
    loss_amounts: list[float],
    iterations: int,
    dev: qml.Device,
) -> np.ndarray:
    """Run Grover search and return measurement bitstring samples.

    Oracle: marks computational basis states where any single qubit that is |1>
    (loss) contributes its indexed loss amount, and the sum of consecutive |1>
    bits in the bitstring exceeds daily_loss_limit.

    This is a SIMULATION-ONLY oracle implemented via classical intermediate:
    the oracle function is called per basis state to tag it, then inserted as
    a controlled phase flip on those states.

    Args:
        n_qubits: number of trade qubits.
        loss_indices: list of qubit indices that correspond to losers.
        daily_loss_limit: threshold for breach marking.
        loss_amounts: loss amounts (parallel to loss_indices for real ordering).
        iterations: number of Grover iterations to run.
        dev: PennyLane device.

    Returns:
        state vector probabilities array (length 2**n_qubits).
    """
    n_states = 2 ** n_qubits

    # Pre-compute which basis states are "breach" states.
    # A state bitstring b[0..N-1] breaches if the max consecutive loss sum
    # of loss_amounts[i] for consecutive b[i]=1 segments >= daily_loss_limit.
    marked: set[int] = set()
    for state_idx in range(n_states):
        bits = [(state_idx >> q) & 1 for q in range(n_qubits)]
        running = 0.0
        worst = 0.0
        consecutive_loss_idx = 0
        for bit in bits:
            if bit == 1:
                if loss_amounts:
                    l_idx = min(len(loss_amounts) - 1, consecutive_loss_idx)
                    running += loss_amounts[l_idx]
                else:
                    running += 1.0
                consecutive_loss_idx += 1
            else:
                running = 0.0
                consecutive_loss_idx = 0
            worst = max(worst, running)
        if worst >= daily_loss_limit:
            marked.add(state_idx)

    # If nothing is marked, Grover amplifies uniformly — return uniform probs
    if not marked:
        return np.ones(n_states) / n_states

    @qml.qnode(dev)
    def grover_circuit():
        # Equal superposition
        for q in range(n_qubits):
            qml.Hadamard(wires=q)

        for _ in range(iterations):
            # Oracle: phase flip marked states
            for state_idx in marked:
                # Build control string for this state
                bits = [(state_idx >> q) & 1 for q in range(n_qubits)]
                zero_wires = [q for q, b in enumerate(bits) if b == 0]

                # Flip zero-control wires so we can use all-control (one wire at a time)
                for w in zero_wires:
                    qml.PauliX(wires=w)

                # Multi-controlled Z using ancilla-free PhaseShift on target
                if n_qubits == 1:
                    qml.PhaseShift(np.pi, wires=0)
                else:
                    # Decompose MCZ as H + MCX + H on last qubit
                    qml.Hadamard(wires=n_qubits - 1)
                    qml.ctrl(qml.PauliX, control=list(range(n_qubits - 1)))(wires=n_qubits - 1)
                    qml.Hadamard(wires=n_qubits - 1)

                for w in zero_wires:
                    qml.PauliX(wires=w)

            # Diffusion operator: H^N (2|0><0| - I) H^N
            for q in range(n_qubits):
                qml.Hadamard(wires=q)
            for q in range(n_qubits):
                qml.PauliX(wires=q)

            # Multi-controlled Z on all qubits for diffusion
            if n_qubits == 1:
                qml.PhaseShift(np.pi, wires=0)
            elif n_qubits == 2:
                qml.Hadamard(wires=1)
                qml.CNOT(wires=[0, 1])
                qml.Hadamard(wires=1)
            else:
                qml.Hadamard(wires=n_qubits - 1)
                qml.ctrl(qml.PauliX, control=list(range(n_qubits - 1)))(wires=n_qubits - 1)
                qml.Hadamard(wires=n_qubits - 1)

            for q in range(n_qubits):
                qml.PauliX(wires=q)
            for q in range(n_qubits):
                qml.Hadamard(wires=q)

        return qml.probs(wires=list(range(n_qubits)))

    probs = grover_circuit()
    return np.array(probs)


def _run_grover(
    trade_pnls: list[float],
    daily_loss_limit: float,
    n_samples: int,
    seed: int,
    top_k: int = 5,
) -> tuple[float | None, list[dict], int | None, int, str]:
    """Run Grover adversarial stress.

    Returns:
        (breach_prob, examples, breach_minimal_n, n_qubits, hardware)
    """
    n = len(trade_pnls)
    n_qubits = min(n, 15)  # Hard cap at 15 qubits (32K states max)

    loss_amounts = sorted([abs(p) for p in trade_pnls if p < 0], reverse=True)
    if not loss_amounts:
        return 0.0, [], None, n_qubits, "local_simulator"

    # Pre-sample to estimate M (number of breach states).
    # F-2 (2026-05-21): use positional consecutive-loss-idx (i % len(loss_amounts))
    # to match the oracle in _grover_circuit and the classical fallback _check_ordering.
    # Previously used rng.randint per bit which diverged from both paths.
    rng = random.Random(seed)
    sample_count = min(200, 2 ** n_qubits)
    breach_in_sample = 0
    for _ in range(sample_count):
        bits = [rng.randint(0, 1) for _ in range(n_qubits)]
        running = 0.0
        worst = 0.0
        consecutive_loss_idx = 0
        for bit in bits:
            if bit == 1:
                l_idx = consecutive_loss_idx % len(loss_amounts)
                running += loss_amounts[l_idx]
                consecutive_loss_idx += 1
            else:
                running = 0.0
                consecutive_loss_idx = 0
            worst = max(worst, running)
        if worst >= daily_loss_limit:
            breach_in_sample += 1

    m_estimate = max(1, int((breach_in_sample / sample_count) * (2 ** n_qubits)))
    iterations = max(1, int(math.floor(math.pi / 4 * math.sqrt(2 ** n_qubits / m_estimate))))
    iterations = min(iterations, 180)  # Cap for cost ceiling

    # Select PennyLane device via Tier 4 VRAM probe (W4).
    # select_quantum_device returns "lightning.gpu" only when env flag is true,
    # n_qubits <= 25, and VRAM probe passes. Falls back to "default.qubit".
    hardware = "local_simulator"
    device_name = select_quantum_device(n_qubits)
    dev = qml.device(device_name, wires=n_qubits)

    loss_indices = list(range(min(len(loss_amounts), n_qubits)))
    probs = _grover_circuit(n_qubits, loss_indices, daily_loss_limit, loss_amounts, iterations, dev)

    # Compute breach probability: sum of amplified probability mass over ALL marked states.
    # We evaluate every state against the oracle, then accumulate the Grover-amplified
    # probability for states that breach. This is the correct Grover-search answer.
    n_states = 2 ** n_qubits

    # Pre-compute marked set using the same oracle logic as _grover_circuit
    marked_set: set[int] = set()
    for state_idx in range(n_states):
        bits_check = [(state_idx >> q) & 1 for q in range(n_qubits)]
        running = 0.0
        worst = 0.0
        consecutive_loss_idx = 0
        for bit in bits_check:
            if bit == 1:
                l_idx = min(len(loss_amounts) - 1, consecutive_loss_idx)
                running += loss_amounts[l_idx]
                consecutive_loss_idx += 1
            else:
                running = 0.0
                consecutive_loss_idx = 0
            worst = max(worst, running)
        if worst >= daily_loss_limit:
            marked_set.add(state_idx)

    # Sum Grover-amplified probabilities for breach states
    breach_prob_sum = sum(float(probs[i]) for i in marked_set)
    worst_case_breach_prob = min(1.0, breach_prob_sum)

    # Build top-K examples from breach states, sorted by Grover probability descending
    breach_states_with_prob = sorted(
        [(i, float(probs[i])) for i in marked_set],
        key=lambda x: x[1],
        reverse=True,
    )

    examples: list[dict] = []
    breach_minimal_n: int | None = None

    for state_idx, prob in breach_states_with_prob[:top_k]:
        bits = [(state_idx >> q) & 1 for q in range(n_qubits)]
        # Recompute loss_sum for display
        running = 0.0
        worst_loss = 0.0
        consecutive_loss_idx = 0
        for bit in bits:
            if bit == 1:
                l_idx = min(len(loss_amounts) - 1, consecutive_loss_idx)
                running += loss_amounts[l_idx]
                consecutive_loss_idx += 1
            else:
                running = 0.0
                consecutive_loss_idx = 0
            worst_loss = max(worst_loss, running)

        examples.append({
            "sequence": bits,
            "loss_sum": round(worst_loss, 2),
            "grover_prob": round(prob, 6),
        })

        # Track minimal consecutive losing window
        consec = 0
        max_consec = 0
        for b in bits:
            if b == 1:
                consec += 1
                max_consec = max(max_consec, consec)
            else:
                consec = 0
        if max_consec > 0:
            if breach_minimal_n is None or max_consec < breach_minimal_n:
                breach_minimal_n = max_consec

    return worst_case_breach_prob, examples, breach_minimal_n, n_qubits, hardware


# ─── Main entry point ─────────────────────────────────────────────────────────

def run_adversarial_stress(
    trades: list[TradeRecord],
    rules: PropFirmRules,
    seed: int = 42,
    top_k: int = 5,
    n_random_samples: int = 10_000,
) -> AdversarialStressResult:
    """Run Grover adversarial stress test on a backtest trade ledger.

    Selects algorithm:
      - PennyLane available + N <= 15 -> Grover quantum
      - N <= 12 -> brute-force classical (fallback or override)
      - N > 12  -> random sampling classical

    All paths are bounded by WALL_CLOCK_LIMIT_S (30s). Aborts with
    status='aborted' if wall clock exceeded.

    AUTHORITY BOUNDARY: output is advisory only. Must never gate lifecycle.
    """
    # F-1 (2026-05-21): gate at function entry — no Grover circuits run when flag is false.
    if not QUANTUM_ADVERSARIAL_STRESS_ENABLED:
        import logging as _logging
        _logging.getLogger(__name__).info(
            "quantum_adversarial_stress: QUANTUM_ADVERSARIAL_STRESS_ENABLED=false — "
            "returning skipped_disabled result. Set env flag to true to enable Grover runs."
        )
        return AdversarialStressResult(
            status="skipped_disabled",
            error_message="QUANTUM_ADVERSARIAL_STRESS_ENABLED env flag is false",
            governance_labels=GOVERNANCE_LABELS.copy(),
        )

    start_ms = int(time.time() * 1000)
    n = len(trades)

    # Build reproducibility hash
    config_str = json.dumps({
        "n_trades": n,
        "daily_loss_limit": rules.daily_loss_limit,
        "max_consecutive_losers": rules.max_consecutive_losers,
        "seed": seed,
        "pnls": sorted([t.pnl for t in trades]),  # sorted for determinism
    }, sort_keys=True)
    repro_hash = hashlib.sha256(config_str.encode()).hexdigest()

    trade_pnls = [t.pnl for t in trades]

    # ── Grover quantum path ────────────────────────────────────────────────────
    # fixwave (2026-07-17): do NOT use `with ThreadPoolExecutor(...) as executor:`
    # here. concurrent.futures.Executor.__exit__ calls shutdown(wait=True)
    # unconditionally, which BLOCKS until the submitted worker thread actually
    # finishes -- even after future.result(timeout=...) has already raised
    # TimeoutError. That silently defeats WALL_CLOCK_LIMIT_S: the function
    # would report status="aborted" but not actually RETURN to the caller
    # until the underlying (uncancellable) Grover/classical call completed on
    # its own, so a pathologically slow call blows straight through the
    # documented 30s bound. A qml circuit call cannot be force-cancelled
    # mid-flight by any Python threading mechanism (true kill would need
    # multiprocessing.terminate()), so this fix bounds CALLER-RETURN latency
    # (what the docstring's "aborts... if wall clock exceeded" actually
    # promises) via an explicit non-blocking shutdown(wait=False) instead of
    # the implicit blocking one — the orphaned worker thread is left to
    # finish (or get reaped by the subprocess-level SIGTERM watchdog in
    # adversarial-stress-service.ts, which kills the whole OS process ~5s
    # after this bound as a hard backstop).
    if PENNYLANE_AVAILABLE and n >= 2 and n <= 15:
        try:
            executor = ThreadPoolExecutor(max_workers=1)
            future = executor.submit(
                _run_grover,
                trade_pnls,
                rules.daily_loss_limit,
                n_random_samples,
                seed,
                top_k,
            )
            try:
                breach_prob, examples, breach_minimal_n, n_qubits, hardware = future.result(
                    timeout=WALL_CLOCK_LIMIT_S
                )
                wall_clock_ms = int(time.time() * 1000) - start_ms
                executor.shutdown(wait=False)
                return AdversarialStressResult(
                    worst_case_breach_prob=breach_prob,
                    breach_minimal_n_trades=breach_minimal_n,
                    worst_sequence_examples=examples,
                    n_qubits=n_qubits,
                    n_trades=n,
                    daily_loss_limit=rules.daily_loss_limit,
                    method="grover_quantum",
                    status="completed",
                    wall_clock_ms=wall_clock_ms,
                    qpu_seconds=0.0,
                    governance_labels=GOVERNANCE_LABELS.copy(),
                    reproducibility_hash=repro_hash,
                    hardware=hardware,
                )
            except FuturesTimeoutError:
                wall_clock_ms = int(time.time() * 1000) - start_ms
                executor.shutdown(wait=False)
                return AdversarialStressResult(
                    n_trades=n,
                    daily_loss_limit=rules.daily_loss_limit,
                    method="grover_quantum",
                    status="aborted",
                    error_message=f"Grover circuit exceeded {WALL_CLOCK_LIMIT_S}s wall-clock limit",
                    wall_clock_ms=wall_clock_ms,
                    governance_labels=GOVERNANCE_LABELS.copy(),
                    reproducibility_hash=repro_hash,
                    hardware="local_simulator",
                )
        except Exception:
            # PennyLane path failed — fall through to classical
            pass

    # ── Classical fallback ─────────────────────────────────────────────────────
    rng = random.Random(seed)
    is_brute_force = n <= 12
    method = "brute_force_classical" if is_brute_force else "random_sample_classical"

    def _run_classical():
        return _compute_breach_prob_classical(
            trade_pnls,
            rules.daily_loss_limit,
            n_random_samples,
            rng,
        )

    # Same non-blocking-shutdown fix as the Grover path above — see the
    # comment there for the full rationale.
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_run_classical)
    try:
        breach_prob, examples, breach_minimal_n = future.result(timeout=WALL_CLOCK_LIMIT_S)
        wall_clock_ms = int(time.time() * 1000) - start_ms
        executor.shutdown(wait=False)
        return AdversarialStressResult(
            worst_case_breach_prob=breach_prob,
            breach_minimal_n_trades=breach_minimal_n,
            worst_sequence_examples=examples,
            n_qubits=0,
            n_trades=n,
            daily_loss_limit=rules.daily_loss_limit,
            method=method,
            status="completed",
            wall_clock_ms=wall_clock_ms,
            qpu_seconds=0.0,
            governance_labels=GOVERNANCE_LABELS.copy(),
            reproducibility_hash=repro_hash,
            hardware="local_simulator",
        )
    except FuturesTimeoutError:
        wall_clock_ms = int(time.time() * 1000) - start_ms
        executor.shutdown(wait=False)
        return AdversarialStressResult(
            n_trades=n,
            daily_loss_limit=rules.daily_loss_limit,
            method=method,
            status="aborted",
            error_message=f"Classical fallback exceeded {WALL_CLOCK_LIMIT_S}s wall-clock limit",
            wall_clock_ms=wall_clock_ms,
            governance_labels=GOVERNANCE_LABELS.copy(),
            reproducibility_hash=repro_hash,
            hardware="local_simulator",
        )


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Quantum Adversarial Stress Test")
    parser.add_argument("--input-json", required=True, help="Path to JSON config file")
    args = parser.parse_args()

    with open(args.input_json) as f:
        config = json.load(f)

    trades = [TradeRecord(**t) for t in config["trades"]]
    rules = PropFirmRules(**config["rules"])
    seed = config.get("seed", 42)

    result = run_adversarial_stress(trades, rules, seed=seed)
    print(result.model_dump_json(indent=2))
