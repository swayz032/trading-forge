#!/usr/bin/env python3
"""AR-1353 F-5 fix proof: the grader's ESCALATED planted-bad (identity fields rewritten to match
unit B, raw response copied from A into B's dir, but the task-sha still names A's task) must now
be caught by the new task-sha join, where the old (F-4-only) check missed it.
"""
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(REPO)
sys.path.insert(0, "scripts")
import importlib.util

spec = importlib.util.spec_from_file_location("inv", "scripts/strategy_factory_prep_provenance_inventory.py")
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)

A, B = "E8Wg6tFPYjo", "75DJN5UVQnw"
receipt_a_path = f"docs/replay-results/strategy-factory-census/extraction-vault/preps/{A}__s0.opus_batch_receipt.json"
receipt_b_path = f"docs/replay-results/strategy-factory-census/extraction-vault/preps/{B}__s0.opus_batch_receipt.json"

with open(receipt_a_path, "r", encoding="utf-8") as f:
    receipt_a = json.load(f)

# Escalated plant: A's receipt, with identity fields rewritten to claim it's B's, everything
# else (including batch_task_sha256, still A's real value) left untouched.
escalated = dict(receipt_a)
escalated["video_id"] = B
escalated["strategy_index"] = 0

plant_path = "scratch_escalated_receipt.json"
with open(plant_path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(escalated, f)

# Also need a raw response file present at B's opus-batch raw path matching escalated's claimed
# raw_response_sha256, so the F-4 checks (identity + raw hash) both PASS and only F-5's new
# task-sha join is left to catch it.
b_raw_path = f"docs/replay-results/strategy-factory-census/extraction-vault/opus-batch/{B}__s0/batch_raw_response.txt"
with open(b_raw_path, "r", encoding="utf-8") as f:
    b_raw_backup = f.read()
a_raw_path = f"docs/replay-results/strategy-factory-census/extraction-vault/opus-batch/{A}__s0/batch_raw_response.txt"
with open(a_raw_path, "r", encoding="utf-8") as f:
    a_raw_text = f.read()
with open(b_raw_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(a_raw_text)  # so raw hash matches escalated["raw_response_sha256"] (which is A's)

ok, detail = inv._validate_receipt(plant_path, B, 0, REPO)
print(json.dumps({"escalated_attack_caught": not ok, "ok": ok, "detail": detail}, indent=2))

# cleanup
with open(b_raw_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(b_raw_backup)
os.remove(plant_path)

sys.exit(0 if not ok else 1)
