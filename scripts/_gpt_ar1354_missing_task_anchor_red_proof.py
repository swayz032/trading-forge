#!/usr/bin/env python3
"""GPT engineering adversarial proof for AR-1354 F-5 / AR-1352A.

Secure behavior requires a complete durable locator task-authority chain:
receipt identity + raw response hash + receipt task hash + task-index identity/hash + actual task hash.
Every missing, malformed, cross-unit, or mutated task anchor must fail closed.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
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
UNIT_REL = REL / "opus-batch" / f"{VIDEO}__s0"
RAW_REL = UNIT_REL / "batch_raw_response.txt"
TASK_REL = UNIT_REL / "batch_task.txt"
TASK_INDEX_REL = UNIT_REL / "batch_task_index.json"


def fresh_root() -> tuple[tempfile.TemporaryDirectory, Path]:
    td = tempfile.TemporaryDirectory(prefix="gpt-ar1354-task-authority-")
    root = Path(td.name)
    for rel in (RECEIPT_REL, RAW_REL, TASK_REL, TASK_INDEX_REL):
        src = REPO / rel
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return td, root


def validate(root: Path) -> tuple[bool, str]:
    return inv._validate_receipt(
        str(root / RECEIPT_REL), VIDEO, STRATEGY_INDEX, str(root)
    )


results: dict[str, dict] = {}

# Positive sanity check: untouched real artifacts must validate.
td, root = fresh_root()
try:
    ok, detail = validate(root)
    results["baseline_real_artifacts_pass"] = {"pass": ok, "detail": detail}
finally:
    td.cleanup()

# Attack 1: strip receipt task SHA.
td, root = fresh_root()
try:
    receipt_path = root / RECEIPT_REL
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt.pop("batch_task_sha256", None)
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8", newline="\n")
    ok, detail = validate(root)
    results["missing_receipt_task_sha_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 2: delete task index.
td, root = fresh_root()
try:
    (root / TASK_INDEX_REL).unlink()
    ok, detail = validate(root)
    results["missing_task_index_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 3: malformed task index.
td, root = fresh_root()
try:
    (root / TASK_INDEX_REL).write_text("{not-json", encoding="utf-8", newline="\n")
    ok, detail = validate(root)
    results["malformed_task_index_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 4: remove task SHA from task index.
td, root = fresh_root()
try:
    p = root / TASK_INDEX_REL
    idx = json.loads(p.read_text(encoding="utf-8"))
    idx.pop("task_sha256", None)
    p.write_text(json.dumps(idx, indent=2), encoding="utf-8", newline="\n")
    ok, detail = validate(root)
    results["missing_index_task_sha_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 5: rewrite task-index identity to another unit while preserving matching hash.
td, root = fresh_root()
try:
    p = root / TASK_INDEX_REL
    idx = json.loads(p.read_text(encoding="utf-8"))
    idx["video_id"] = "WRONG_UNIT"
    p.write_text(json.dumps(idx, indent=2), encoding="utf-8", newline="\n")
    ok, detail = validate(root)
    results["task_index_identity_mismatch_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 6: delete actual emitted task while receipt/index remain.
td, root = fresh_root()
try:
    (root / TASK_REL).unlink()
    ok, detail = validate(root)
    results["missing_actual_task_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

# Attack 7: mutate actual emitted task while receipt/index remain unchanged.
td, root = fresh_root()
try:
    p = root / TASK_REL
    p.write_text(p.read_text(encoding="utf-8") + "\nMUTATION", encoding="utf-8", newline="\n")
    ok, detail = validate(root)
    results["mutated_actual_task_refused"] = {"pass": not ok, "detail": detail}
finally:
    td.cleanup()

print(json.dumps(results, indent=2))
secure = all(item["pass"] for item in results.values())
if secure:
    print("GREEN: locator task authority is bound and fails closed across all tested anchor attacks")
    raise SystemExit(0)

print("RED: locator task authority still has a fail-open or broken positive path")
raise SystemExit(1)
