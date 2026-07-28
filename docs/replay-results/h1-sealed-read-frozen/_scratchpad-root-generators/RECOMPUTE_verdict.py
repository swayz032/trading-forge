"""R-035 §5 — supply TRUE validity_inputs + recompute the sealed-12 verdict ONCE from
the SAME persisted artifacts (no re-dispatch). reverify must re-MATCH; the structural
fraction must stay 0.8182 or it is an ALARM -> HALT. FINAL verdict, read once, AR-027."""
import importlib.util, os, sys, json

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/SEALED-READ"
sys.path.insert(0, os.path.join(ROOT, "scripts")); sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)

# The TRUE validity inputs, each evidenced in h1-sealed-read-validity-provenance-2026-07-17.md.
validity_inputs = {
    "registration_pre_check": {"ok": True, "n_registered": 12,
        "evidence": "seal-gate verified manifest 4d7b3c29 at runtime; source_attrition 12/12 readable"},
    "engagement_pre_check": {"ok": True,
        "evidence": "independent doer!=grader post-hoc audit (R-035): ENGAGEMENT EVIDENCED all 8 items"},
    "frozen_scan_commit": "405af2d9",
    "driver_commit": "405af2d9",
    "epoch": "2026-07-17T20:19:00-04:00",
}
with open(os.path.join(WD, "validity_inputs.json"), "w", encoding="utf-8") as fh:
    json.dump(validity_inputs, fh, indent=2)
print("validity_inputs.json written (true values, evidenced).", flush=True)

print("=== RECOMPUTE run_stage_verdict (deterministic replay from persisted artifacts) ===", flush=True)
code, text = cli.run_stage_verdict(WD)
print("verdict exit:", code, flush=True)
print(text, flush=True)

# R-035 §5 m2: the structural fraction MUST stay 0.8182; else ALARM -> HALT (not a result).
import re
m = re.search(r"video_unit_clean_fraction:\s*([0-9.]+)", text)
frac = m.group(1) if m else "?"
if frac.startswith("0.8182") or frac == "0.8182":
    print("STRUCTURAL FRACTION UNCHANGED (0.8182) — deterministic replay confirmed.", flush=True)
else:
    print(f"!!! ALARM: structural fraction changed to {frac} != 0.8182 — HALT, NOT a result (R-035 m2).", flush=True)
print("reverify MATCH present:", "reverify: MATCH" in text, flush=True)
print("=== RECOMPUTE COMPLETE — report verbatim as AR-027 (FINAL, read once) ===", flush=True)
