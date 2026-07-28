"""R-030 §4 micro-rehearsal — LIVE phase_b receipt on the SPENT 2DXQqwKSwJE."""
import importlib.util, json, os, sys

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh"
VID = "2DXQqwKSwJE"
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("h1_seal_conductor_cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py"))
cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)

print("=== LIVE run_dispatch phase_b strategy 0 (no-tools claude -p, frontier prompt) ===", flush=True)
code, text = cli.run_dispatch(WD, "phase_b", VID, 0)
print("exit:", code); print(text)
if code == 0:
    pb = json.load(open(os.path.join(WD, "phase_b", f"{VID}__s0.json"), encoding="utf-8"))
    print("--- RECEIPT (phase_b) ---")
    print("has strategies:", isinstance(pb.get("strategies"), list), "| n:", len(pb.get("strategies") or []))
    print("reader_identity present:", "reader_identity" in pb)
    print("instrument_classification present:", "instrument_classification" in pb)
