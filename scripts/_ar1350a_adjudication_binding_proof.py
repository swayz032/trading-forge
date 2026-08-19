#!/usr/bin/env python3
"""AR-1350A SS4/SS8.A negative controls (one-shot proof artifact, not a permanent test).
Uses real committed tier3_packet.json files (E8Wg6tFPYjo__s0, 75DJN5UVQnw__s0) -- no synthetic
fixtures. Every control listed in AR-1350A SS4 is exercised, plus a positive control proving the
clean path still succeeds.
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
        out = {"raw_stdout": r.stdout}
    return r.returncode, out


results = {}

# The positive control below will overwrite the REAL committed E8Wg6tFPYjo__s0.stage1_answers.json
# with synthetic test data via the real ingest path -- back it up now (plain file I/O, not git)
# and restore it at cleanup, so this proof script never leaves production data clobbered.
real_e8_answers_path = "docs/replay-results/strategy-factory-census/extraction-vault/preps/E8Wg6tFPYjo__s0.stage1_answers.json"
with open(real_e8_answers_path, "r", encoding="utf-8") as f:
    real_e8_answers_backup = f.read()

# --- setup: emit stage-1 tasks for two real units ---
rc, out = run("adjudication-emit", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1")
assert rc == 0, out
rc, out = run("adjudication-emit", "75DJN5UVQnw", "--strategy-index", "0", "--stage", "1")
assert rc == 0, out

with open("docs/replay-results/strategy-factory-census/extraction-vault/preps/E8Wg6tFPYjo__s0.stage1_task_index.json") as f:
    e8_index = json.load(f)
with open("docs/replay-results/strategy-factory-census/extraction-vault/preps/75DJN5UVQnw__s0.stage1_task_index.json") as f:
    v1_index = json.load(f)

# a well-formed, VALID stage-1 answer for E8's own expected item set
e8_good_answer = {iid: ("gate-strength" if i % 2 == 0 else "context") for i, iid in enumerate(e8_index["expected_item_ids"])}
# a well-formed, VALID stage-1 answer for VIDEO 1's own expected item set (different ids)
v1_good_answer = {iid: ("gate-strength" if i % 2 == 0 else "context") for i, iid in enumerate(v1_index["expected_item_ids"])}

with open("scratch_e8_good.json", "w", newline="\n") as f:
    json.dump(e8_good_answer, f)
with open("scratch_v1_good.json", "w", newline="\n") as f:
    json.dump(v1_good_answer, f)

# --- POSITIVE CONTROL: clean ingest for the unit it was actually emitted for -> MUST PASS ---
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_e8_good.json")
results["POSITIVE_clean_ingest"] = (rc == 0 and out.get("status") == "INGESTED", out.get("status"))

# --- CONTROL 1: ingest Unit A's (video1) response AS Unit B (E8) -> MUST FAIL ---
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_v1_good.json")
results["1_cross_unit_ingest"] = (rc != 0 and out.get("status") == "ITEM_ID_SET_MISMATCH", out.get("status"))

# --- CONTROL 2: mutate the Tier-3 packet AFTER emission -> MUST FAIL ---
packet_path = "docs/replay-results/strategy-factory-census/extraction-vault/preps/E8Wg6tFPYjo__s0.tier3_packet.json"
with open(packet_path, "r", encoding="utf-8") as f:
    original_packet_bytes = f.read()
with open(packet_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(original_packet_bytes + " ")  # trivial mutation
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_e8_good.json")
results["2_packet_mutated"] = (rc != 0 and out.get("status") == "PACKET_MUTATED_SINCE_EMIT", out.get("status"))
with open(packet_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(original_packet_bytes)  # restore

# --- CONTROL 3: mutate the task hash (edit task.txt directly, packet untouched) -> MUST FAIL ---
task_path = "docs/replay-results/strategy-factory-census/extraction-vault/preps/E8Wg6tFPYjo__s0.stage1_task.txt"
with open(task_path, "r", encoding="utf-8") as f:
    original_task_bytes = f.read()
with open(task_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(original_task_bytes + " ")
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_e8_good.json")
results["3_task_mutated"] = (rc != 0 and out.get("status") == "TASK_MUTATED_SINCE_EMIT", out.get("status"))
with open(task_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(original_task_bytes)  # restore

# --- CONTROL 4: missing answer ID -> MUST FAIL ---
missing = dict(e8_good_answer)
missing.pop(next(iter(missing)))
with open("scratch_missing.json", "w", newline="\n") as f:
    json.dump(missing, f)
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_missing.json")
results["4_missing_id"] = (rc != 0 and out.get("status") == "ITEM_ID_SET_MISMATCH" and out.get("missing"), out.get("status"))

# --- CONTROL 5: extra answer ID -> MUST FAIL ---
extra = dict(e8_good_answer)
extra["NOT-A-REAL-ITEM-ID"] = "context"
with open("scratch_extra.json", "w", newline="\n") as f:
    json.dump(extra, f)
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_extra.json")
results["5_extra_id"] = (rc != 0 and out.get("status") == "ITEM_ID_SET_MISMATCH" and out.get("extra"), out.get("status"))

# --- CONTROL 6: wrong answer ID (one id swapped for a plausible-but-wrong one) -> MUST FAIL ---
wrong = dict(e8_good_answer)
some_id = next(iter(wrong))
wrong["totally-different-item-id"] = wrong.pop(some_id)
with open("scratch_wrong.json", "w", newline="\n") as f:
    json.dump(wrong, f)
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "1", "--raw", "scratch_wrong.json")
results["6_wrong_id"] = (rc != 0 and out.get("status") == "ITEM_ID_SET_MISMATCH", out.get("status"))

# --- CONTROL 7: wrong stage identity (ingest a stage-1 emit under --stage 2) -> MUST FAIL ---
rc, out = run("adjudication-ingest", "E8Wg6tFPYjo", "--strategy-index", "0", "--stage", "2", "--raw", "scratch_e8_good.json")
results["7_wrong_stage_identity"] = (rc != 0 and out.get("status") in ("STAGE_IDENTITY_MISMATCH", "NO_TIER3_PACKET", "NOT_EMITTED"), out.get("status"))

print(json.dumps(results, indent=2))
all_pass = all(v[0] for v in results.values())
print("\nALL CONTROLS PASSED" if all_pass else "SOME CONTROLS FAILED")

# cleanup scratch + generated artifacts
for f in [
    "scratch_e8_good.json", "scratch_v1_good.json", "scratch_missing.json",
    "scratch_extra.json", "scratch_wrong.json",
]:
    if os.path.exists(f):
        os.remove(f)
for video, sidx in [("E8Wg6tFPYjo", 0), ("75DJN5UVQnw", 0)]:
    base = f"docs/replay-results/strategy-factory-census/extraction-vault/preps/{video}__s{sidx}"
    for suffix in ["stage1_task.txt", "stage1_task_index.json", "stage1_raw_response.txt",
                   "stage1_receipt.json"]:
        p = f"{base}.{suffix}"
        if os.path.exists(p):
            os.remove(p)

# restore the real E8Wg6tFPYjo stage1_answers.json (plain file I/O, not git) -- the positive
# control's real ingest call overwrote it with synthetic test data above.
with open(real_e8_answers_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(real_e8_answers_backup)

sys.exit(0 if all_pass else 1)
