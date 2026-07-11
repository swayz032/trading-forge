"""quantum_backend_status.py — honest report of which quantum backends ACTUALLY execute.

Quantum is CHALLENGER-ONLY (advisory; it never gates trading or promotion). This probe exists because a
missing optional library (qiskit_aer / pennylane / neal) or an unset IBM-cloud gate silently degrades
"quantum" to CLASSICAL fallback — and nothing surfaced that to the operator, so it *looked* like IBM-cloud
quantum was running when it wasn't. This makes the real state loud + on-demand.

Three independent stacks, three different libraries:
  - Monte-Carlo IAE (quantum_mc.py)     needs qiskit_aer (local sim) OR a live IBM-cloud token+gates.
  - RL agent VQC (quantum_rl_agent.py)  needs pennylane.
  - SQA / QUBO timing (qubo_trade_timing.py) needs dwave/neal.

Run: python -m src.engine.quantum_backend_status   (prints JSON + a one-line summary; exit 0 always).
"""
from __future__ import annotations

import json
import os


def _can_import(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def quantum_backend_status() -> dict:
    qiskit_aer = _can_import("qiskit_aer")
    pennylane = _can_import("pennylane")
    neal = _can_import("neal")

    ibm_token = bool(os.environ.get("IBM_QUANTUM_TOKEN"))
    ibm_cloud_on = (os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower() == "true")
    ibm_opt_in = (os.environ.get("QUANTUM_RL_IBM_CLOUD_OPT_IN", "").lower() == "true")
    ibm_cloud_active = ibm_token and ibm_cloud_on and ibm_opt_in

    mc = "ibm_cloud_qpu" if ibm_cloud_active else ("local_qiskit_sim" if qiskit_aer else "classical_fallback")
    rl = "pennylane_vqc" if pennylane else "classical_fallback"
    sqa = "dwave_neal_sqa" if neal else "classical_fallback"

    any_real = (mc != "classical_fallback") or pennylane or neal
    return {
        "monte_carlo_backend": mc,
        "rl_agent_backend": rl,
        "sqa_qubo_backend": sqa,
        "ibm_cloud_active": ibm_cloud_active,
        "libs_installed": {"qiskit_aer": qiskit_aer, "pennylane": pennylane, "dwave_neal": neal},
        "any_quantum_executing": any_real,
        "summary": _summary(mc, rl, sqa, any_real),
    }


def _summary(mc: str, rl: str, sqa: str, any_real: bool) -> str:
    if not any_real:
        return (
            "QUANTUM BACKEND: ALL CLASSICAL FALLBACK — no quantum circuits execute. "
            "MC needs `pip install qiskit-aer` (local sim, no cloud cost) or an IBM-cloud token+gates; "
            "RL needs `pip install pennylane`; SQA needs `pip install dwave-ocean-sdk`. "
            "Challenger-only — does NOT affect trading; results are honestly labeled backend='classical'."
        )
    return f"QUANTUM BACKEND: mc={mc} · rl={rl} · sqa={sqa}"


if __name__ == "__main__":
    status = quantum_backend_status()
    print(json.dumps(status, indent=2))
    print(status["summary"])
