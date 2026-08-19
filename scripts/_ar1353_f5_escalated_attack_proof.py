#!/usr/bin/env python3
"""AR-1353 F-5 proof, hardened for evidence preservation.

The attack must prove that a receipt/raw-response substitution cannot bypass the
load-bearing task-authority join. The old version achieved that by overwriting a
real committed provenance file and restoring it afterwards. That was unsafe: an
exception between mutation and cleanup could strand corrupted evidence in the
vault.

This version is read-only with respect to the committed corpus. It copies the
minimum real source bytes into a TemporaryDirectory, performs the exact same
attack there, and additionally proves the source corpus hashes are unchanged.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
os.chdir(REPO)
sys.path.insert(0, str(REPO / "scripts"))

spec = importlib.util.spec_from_file_location(
    "inv", REPO / "scripts/strategy_factory_prep_provenance_inventory.py"
)
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)

A, B = "E8Wg6tFPYjo", "75DJN5UVQnw"
PREPS = REPO / "docs/replay-results/strategy-factory-census/extraction-vault/preps"
OPUS = REPO / "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch"

receipt_a_path = PREPS / f"{A}__s0.opus_batch_receipt.json"
a_raw_path = OPUS / f"{A}__s0" / "batch_raw_response.txt"
b_raw_path = OPUS / f"{B}__s0" / "batch_raw_response.txt"
b_task_index_path = OPUS / f"{B}__s0" / "batch_task_index.json"
b_task_path = OPUS / f"{B}__s0" / "batch_task.txt"

SOURCE_PATHS = [
    receipt_a_path,
    a_raw_path,
    b_raw_path,
    b_task_index_path,
    b_task_path,
]


def sha256_bytes(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


before = {str(path): sha256_bytes(path) for path in SOURCE_PATHS}

with receipt_a_path.open("r", encoding="utf-8") as f:
    receipt_a = json.load(f)

# Escalated plant: A's receipt is rewritten to claim B's identity. Its raw-response
# and task hashes remain A's, so identity + raw-response checks can be made to pass
# while the deeper task-authority join must still reject it.
escalated = dict(receipt_a)
escalated["video_id"] = B
escalated["strategy_index"] = 0

with tempfile.TemporaryDirectory(prefix="ar1353-f5-proof-") as td:
    temp_repo = Path(td)
    temp_unit = (
        temp_repo
        / "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch"
        / f"{B}__s0"
    )
    temp_unit.mkdir(parents=True, exist_ok=True)

    # Make the F-4 surface pass inside the disposable fixture: B's synthetic raw
    # response receives A's real bytes, matching escalated.raw_response_sha256.
    shutil.copyfile(a_raw_path, temp_unit / "batch_raw_response.txt")

    # Preserve B's own task authority. The escalated A receipt still names A's task
    # SHA, so the task-index/task-file chain must catch the substitution.
    shutil.copyfile(b_task_index_path, temp_unit / "batch_task_index.json")
    shutil.copyfile(b_task_path, temp_unit / "batch_task.txt")

    plant_path = temp_repo / "scratch_escalated_receipt.json"
    plant_path.write_text(json.dumps(escalated), encoding="utf-8", newline="\n")

    ok, detail = inv._validate_receipt(str(plant_path), B, 0, str(temp_repo))

# Prove the real corpus was never modified by the test.
after = {str(path): sha256_bytes(path) for path in SOURCE_PATHS}
source_unchanged = before == after

result = {
    "escalated_attack_caught": not ok,
    "ok": ok,
    "detail": detail,
    "source_corpus_unchanged": source_unchanged,
    "source_hashes": after,
}
print(json.dumps(result, indent=2))

sys.exit(0 if (not ok and source_unchanged) else 1)
