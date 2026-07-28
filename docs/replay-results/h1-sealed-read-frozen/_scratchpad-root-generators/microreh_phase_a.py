"""R-030 §4 micro-rehearsal — LIVE phase_a receipt on the SPENT video 2DXQqwKSwJE.

Runs the REAL run_dispatch (no-tools embedded-content claude -p) once, on the real
enumerator prompt + real transcript, and verifies the ingested draw round-trips the
identity guard. SPENT design-pool video only — NEVER the sealed 12.
"""
import importlib.util
import json
import os
import subprocess
import sys

ROOT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
WD = r"C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/d96dba1d-d874-4c26-8026-7ec19a8674ae/scratchpad/microreh"
VID = "2DXQqwKSwJE"

if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location(
    "h1_seal_conductor_cli", os.path.join(ROOT, "scripts", "h1_seal_conductor_cli.py")
)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

os.makedirs(os.path.join(WD, "transcripts"), exist_ok=True)
tx_path = os.path.join(WD, "transcripts", f"{VID}.txt")

# Fetch the spent transcript once (reuse if already on disk).
if not (os.path.exists(tx_path) and open(tx_path, encoding="utf-8").read().strip()):
    print("fetching transcript via bridge...", flush=True)
    proc = subprocess.run(
        ["npx", "tsx", os.path.join(ROOT, "scripts", "h1-fetch-one.ts")],
        input=json.dumps({"video_id": VID}), capture_output=True, text=True, cwd=ROOT, timeout=200,
    )
    line = [ln for ln in (proc.stdout or "").splitlines() if ln.strip().startswith("{")]
    if not line:
        print("FETCH FAILED:", (proc.stderr or proc.stdout or "")[:300]); sys.exit(1)
    d = json.loads(line[-1])
    open(tx_path, "w", encoding="utf-8").write(d["transcript"])
    print(f"transcript fetched: {d.get('char_count')} chars", flush=True)
else:
    print("transcript reused from disk", flush=True)

print("=== LIVE run_dispatch phase_a draw 0 (no-tools claude -p) ===", flush=True)
code, text = cli.run_dispatch(WD, "phase_a", VID, 0)
print("exit:", code)
print(text)
if code == 0:
    draw = json.load(open(os.path.join(WD, "phase_a", VID, "draw_0.json"), encoding="utf-8"))
    ri = cli.certified_reader_identity()
    print("--- RECEIPT (phase_a) ---")
    print("count:", draw.get("count"), "| strategy_refs:", draw.get("strategy_refs"))
    print("reader_identity.model_id matches frozen:", draw["reader_identity"]["model_id"] == ri["model_id"])
    print("attempts record:", json.load(open(os.path.join(WD, "attempts", f"phase_a__{VID}__d0.json"), encoding="utf-8"))["attempts"])
