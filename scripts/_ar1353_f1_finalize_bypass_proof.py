#!/usr/bin/env python3
"""AR-1353 F-1 fix proof: the grader's exact bypass attack (hand-written stage1/2 answers, never
emitted/ingested) must now be refused by `finalize` unless --allow-unbound-legacy is passed, and
must stamp the certificate when that flag IS used. Also proves the real bound path still works.
"""
import json
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(REPO)
PY = sys.executable
SCRIPT = "scripts/strategy_factory_prepare_and_finalize.py"


def run(*args):
    r = subprocess.run([PY, SCRIPT, *args], capture_output=True, text=True)
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        out = {"raw_stdout": r.stdout, "stderr": r.stderr}
    return r.returncode, out


VIDEO = "1HFoStW_wsc"
base = f"docs/replay-results/strategy-factory-census/extraction-vault/preps/{VIDEO}__s0"
cert_path = f"{base}.certificate.json"
real_stage1_path = f"{base}.stage1_answers.json"
real_stage2_path = f"{base}.stage2_answers.json"

with open(cert_path, "r", encoding="utf-8") as f:
    real_cert_backup = f.read()
with open(real_stage1_path, "r", encoding="utf-8") as f:
    real_stage1_backup = f.read()

results = {}

# --- ATTACK: hand-written answers, never emitted/ingested -> MUST BE REFUSED BY DEFAULT ---
hand_written = {iid: "gate-strength" for iid in json.loads(real_stage1_backup)}
with open("scratch_hand_stage1.json", "w", newline="\n") as f:
    json.dump(hand_written, f)
rc, out = run("finalize", VIDEO, "--strategy-index", "0", "--stage1", "scratch_hand_stage1.json")
results["ATTACK_refused_by_default"] = (rc != 0 and out.get("status") == "UNBOUND_ANSWERS_REFUSED", out.get("status"))

with open(cert_path, "r", encoding="utf-8") as f:
    cert_after_attack = f.read()
results["CERT_NOT_OVERWRITTEN_BY_ATTACK"] = (cert_after_attack == real_cert_backup, None)

# --- ATTACK WITH ESCAPE HATCH: must succeed but STAMP the certificate ---
rc, out = run("finalize", VIDEO, "--strategy-index", "0", "--stage1", "scratch_hand_stage1.json", "--allow-unbound-legacy")
results["ESCAPE_HATCH_succeeds"] = (rc == 0, out.get("status"))
results["ESCAPE_HATCH_stamps_unbound"] = (out.get("provenance_binding", {}).get("status") == "UNBOUND_LEGACY", out.get("provenance_binding"))
with open(cert_path, "r", encoding="utf-8") as f:
    cert_json = json.load(f)
results["CERT_FILE_ITSELF_CARRIES_STAMP"] = (cert_json.get("provenance_binding", {}).get("status") == "UNBOUND_LEGACY", cert_json.get("provenance_binding"))

# restore real cert + real stage1
with open(cert_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(real_cert_backup)
with open(real_stage1_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(real_stage1_backup)

# --- POSITIVE: the real, properly bound emit->ingest->finalize path still works ---
rc, out = run("adjudication-emit", VIDEO, "--strategy-index", "0", "--stage", "1")
assert rc == 0, out
with open(f"{base}.stage1_task_index.json") as f:
    idx = json.load(f)
good_answer = {iid: "gate-strength" for iid in idx["expected_item_ids"]}
with open("scratch_bound_stage1.json", "w", newline="\n") as f:
    json.dump(good_answer, f)
rc, out = run("adjudication-ingest", VIDEO, "--strategy-index", "0", "--stage", "1", "--raw", "scratch_bound_stage1.json")
assert rc == 0, out
rc, out = run("finalize", VIDEO, "--strategy-index", "0", "--stage1", real_stage1_path)
results["BOUND_PATH_still_works"] = (rc == 0 and out.get("provenance_binding", {}).get("status") == "BOUND", out)

# cleanup
with open(cert_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(real_cert_backup)
with open(real_stage1_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(real_stage1_backup)
for suffix in ["stage1_task.txt", "stage1_task_index.json", "stage1_raw_response.txt", "stage1_receipt.json"]:
    p = f"{base}.{suffix}"
    if os.path.exists(p):
        os.remove(p)
for f_ in ["scratch_hand_stage1.json", "scratch_bound_stage1.json"]:
    if os.path.exists(f_):
        os.remove(f_)

print(json.dumps(results, indent=2))
all_pass = all(v[0] for v in results.values())
print("\nALL CHECKS PASSED" if all_pass else "SOME CHECKS FAILED")
sys.exit(0 if all_pass else 1)
