#!/usr/bin/env python3
"""GPT engineering RED proof for AR-1354 F-5.

The current locator provenance inventory claims batch_task_sha256 is verified, but
_validate_receipt() only performs that join when BOTH the receipt field and task-index
file exist. Missing authority anchors therefore fall through to PASS.

This proof must be RED against the vulnerable implementation and GREEN only after
_validate_receipt() fails closed when either anchor is absent.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "scripts" / "strategy_factory_prep_provenance_inventory.py"

spec = importlib.util.spec_from_file_location("inventory", MODULE_PATH)
inv = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(inv)

VIDEO = "75DJN5UVQnw"
STRATEGY_INDEX = 0
REL = Path("docs/replay-results/strategy-factory-census/extraction-vault")
RECEIPT_REL = REL / "preps" / f"{VIDEO}__s0.opus_batch_receipt.json"
RAW_REL = REL / "opus-batch" / f"{VIDEO}__s0" / "batch_raw_response.txt"
TASK_INDEX_REL = REL / "opus-batch" / f"{VIDEO}__s0" / "batch_task_index.json"

with tempfile.TemporaryDirectory(prefix="gpt-ar1354-red-") as td:
    root = Path(td)
    for rel in (RECEIPT_REL, RAW_REL, TASK_INDEX_REL):
        src = REPO / rel
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    receipt_path = root / RECEIPT_REL
    task_index_path = root / TASK_INDEX_REL

    # Positive sanity check: untouched real artifacts should validate.
    ok_baseline, baseline_detail = inv._validate_receipt(
        str(receipt_path), VIDEO, STRATEGY_INDEX, str(root)
    )

    # Attack 1: strip the receipt's task-hash anchor entirely.
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt.pop("batch_task_sha256", None)
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8", newline="\n")
    ok_missing_field, missing_field_detail = inv._validate_receipt(
        str(receipt_path), VIDEO, STRATEGY_INDEX, str(root)
    )

    # Restore receipt, then Attack 2: remove this unit's task-index anchor entirely.
    shutil.copy2(REPO / RECEIPT_REL, receipt_path)
    task_index_path.unlink()
    ok_missing_index, missing_index_detail = inv._validate_receipt(
        str(receipt_path), VIDEO, STRATEGY_INDEX, str(root)
    )

result = {
    "baseline_real_artifacts_pass": ok_baseline,
    "attack_missing_batch_task_sha256_was_refused": not ok_missing_field,
    "attack_missing_task_index_was_refused": not ok_missing_index,
    "details": {
        "baseline": baseline_detail,
        "missing_batch_task_sha256": missing_field_detail,
        "missing_task_index": missing_index_detail,
    },
}
print(json.dumps(result, indent=2))

# Expected secure behavior: baseline PASS; both stripped-anchor attacks FAIL.
secure = ok_baseline and (not ok_missing_field) and (not ok_missing_index)
if secure:
    print("GREEN: task provenance join fails closed when either anchor is absent")
    raise SystemExit(0)

print("RED: locator provenance validator is fail-open when a task anchor is absent")
raise SystemExit(1)
