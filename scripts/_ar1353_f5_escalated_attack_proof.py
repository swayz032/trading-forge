#!/usr/bin/env python3
"""AR-1353 F-5 fix proof: the grader's ESCALATED planted-bad (identity fields rewritten to match
unit B, raw response copied from A into B's dir, but the task-sha still names A's task) must now
be caught by the new task-sha join, where the old (F-4-only) check missed it.
"""
import hashlib
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

# Also need a raw response file present at B's opus-batch raw path matching escalated's claimed
# raw_response_sha256, so the F-4 checks (identity + raw hash) both PASS and only F-5's new
# task-sha join is left to catch it. This mutates a REAL committed evidence file in place, so
# AR-1354A SS6.A requires the mutate/run/restore sequence to be exception-safe: a failure between
# the write and the restore must not strand real provenance evidence with another unit's bytes.
b_raw_path = f"docs/replay-results/strategy-factory-census/extraction-vault/opus-batch/{B}__s0/batch_raw_response.txt"
a_raw_path = f"docs/replay-results/strategy-factory-census/extraction-vault/opus-batch/{A}__s0/batch_raw_response.txt"

with open(b_raw_path, "r", encoding="utf-8") as f:
    b_raw_backup = f.read()
b_raw_backup_sha256 = hashlib.sha256(b_raw_backup.encode("utf-8")).hexdigest()

with open(a_raw_path, "r", encoding="utf-8") as f:
    a_raw_text = f.read()

ok, detail = None, None
try:
    with open(plant_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(escalated, f)

    with open(b_raw_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(a_raw_text)  # so raw hash matches escalated["raw_response_sha256"] (which is A's)

    ok, detail = inv._validate_receipt(plant_path, B, 0, REPO)
finally:
    # Restore unconditionally, even if the validator call above raised.
    with open(b_raw_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(b_raw_backup)
    if os.path.exists(plant_path):
        os.remove(plant_path)

    # Positive witness the restore actually worked -- writing bytes back is not proof they landed.
    with open(b_raw_path, "r", encoding="utf-8") as f:
        restored_sha256 = hashlib.sha256(f.read().encode("utf-8")).hexdigest()
    if restored_sha256 != b_raw_backup_sha256:
        raise RuntimeError(
            f"EVIDENCE CORRUPTION: {b_raw_path} did not restore cleanly -- "
            f"expected sha256={b_raw_backup_sha256}, got {restored_sha256}"
        )

print(json.dumps({"escalated_attack_caught": not ok, "ok": ok, "detail": detail}, indent=2))

sys.exit(0 if not ok else 1)
