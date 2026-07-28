"""INDEPENDENT re-derivation of the BEFORE binding-approximation rate for the
4 extreme specs, using compile_binding_plan directly -- NOT run_dod_remeasure.py.
This checks the raw binding records match the doer's n_exec / n_approx / n_struct / n_bias."""
import json, os, sys

WT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
SPECS = os.path.join(WT, "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs")
sys.path.insert(0, WT)

from src.engine.spec_family_bindings import compile_binding_plan

WIRED_STRUCTURE = {"WAIT_STRUCTURE", "VERIFY_STRUCTURE"}
WIRED_BIAS = {"WAIT_BIAS", "CONFIRM_DIRECTION"}

TARGETS = ["E9MzEC_yNoM__s0", "_LS6qcSlDCs__s0", "0xygpCMwxbQ__s0", "4cT8WTyxhYY__s0"]

for stub in TARGETS:
    path = os.path.join(SPECS, f"{stub}.spec.json")
    art = json.load(open(path, encoding="utf-8"))
    bp = compile_binding_plan(art["spec"])

    executed = [b for b in bp.bindings if getattr(b, "executed", False)]
    approx = [b for b in executed if getattr(b, "approximation", False)]
    n_exec, n_approx = len(executed), len(approx)
    before = round(n_approx / n_exec, 4) if n_exec else None

    n_struct = sum(1 for b in approx if b.type in WIRED_STRUCTURE)
    n_bias = sum(1 for b in approx if b.type in WIRED_BIAS)

    # dump the raw records for the approx bindings, by type
    approx_types = [(b.condition_id, b.type, b.role, b.approximation) for b in approx]

    print(f"=== {stub} ===")
    print(f"  n_exec={n_exec} n_approx={n_approx} before={before}")
    print(f"  n_struct_wired={n_struct} n_bias_wired={n_bias}")
    print(f"  approx bindings (id, type, role):")
    for row in approx_types:
        print(f"    {row}")
    # also list ALL bindings (executed or not) with type, to see if any
    # WIRED_STRUCTURE/WIRED_BIAS bindings exist that are NOT bindable/executed
    # (silent-fail-to-credit check)
    all_wired = [b for b in bp.bindings if b.type in (WIRED_STRUCTURE | WIRED_BIAS)]
    print(f"  ALL bindings of wired types (bindable={{b.bindable}} executed={{b.executed}} approx={{b.approximation}}):")
    for b in all_wired:
        print(f"    id={b.condition_id} type={b.type} role={b.role} bindable={b.bindable} executed={b.executed} approx={b.approximation}")
    print()
