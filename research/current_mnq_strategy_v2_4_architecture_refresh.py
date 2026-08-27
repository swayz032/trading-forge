#!/usr/bin/env python3
"""Fail-closed architecture/gold evidence refresh for Current MNQ v2.4.

This runner never opens the clean Databento dataset and never calls run_backtest
or run_sealed. It refuses to issue a receipt until the real-user tempting
NO-TRADE gold minimum is satisfied, then executes the frozen architecture test
battery and binds the receipt to exact semantics and gold-manifest hashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_4_evidence import gold_counts, gold_manifest_hashes
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "research" / "_mnq_v24_architecture_receipt.json"

# v2.4 owns the current semantics; the small inherited subset below covers the
# production/data layers v2.4 composes directly. No credentialed/network tests.
EXPLICIT_INHERITED_TESTS = (
    "tests/test_current_mnq_strategy_v2_2_contracts.py",
    "tests/test_current_mnq_strategy_v2_2_engine_final.py",
    "tests/test_current_mnq_strategy_v2_2_gold_lifecycle.py",
    "tests/test_current_mnq_strategy_v2_3_production.py",
    "tests/test_current_mnq_strategy_v2_3_roll_tick.py",
    "tests/test_current_mnq_strategy_v2_3_signal.py",
)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _test_files() -> list[Path]:
    files = [REPO_ROOT / x for x in EXPLICIT_INHERITED_TESTS]
    files += sorted((REPO_ROOT / "tests").glob("test_current_mnq_strategy_v2_4_*.py"))
    missing = [str(p.relative_to(REPO_ROOT)) for p in files if not p.exists()]
    if missing:
        raise RuntimeError("V24_ARCHITECTURE_TEST_FILE_MISSING:" + "|".join(missing))
    # Deduplicate while preserving order.
    out: list[Path] = []
    seen: set[Path] = set()
    for p in files:
        if p not in seen:
            seen.add(p); out.append(p)
    if not out:
        raise RuntimeError("V24_ARCHITECTURE_TEST_SET_EMPTY")
    return out


class _Counter:
    def __init__(self) -> None:
        self.outcomes: dict[str, str] = {}

    def pytest_runtest_logreport(self, report) -> None:
        node = str(report.nodeid)
        if report.failed:
            self.outcomes[node] = "failed"
        elif report.when == "call" and report.skipped:
            self.outcomes.setdefault(node, "skipped")
        elif report.when == "call" and report.passed:
            self.outcomes.setdefault(node, "passed")

    def counts(self) -> tuple[int, int, int]:
        vals = list(self.outcomes.values())
        return vals.count("passed"), vals.count("failed"), vals.count("skipped")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()
    out = Path(args.output)

    print("MNQ v2.4 ARCHITECTURE/GOLD REFRESH — NO CLEAN P&L")
    print("clean dataset strategy P&L executed: NO")

    spec = load_spec()
    req = spec["evidence_policy"]
    positive, negative = gold_counts()
    min_positive = int(req["real_user_positive_gold_min"])
    min_negative = int(req["real_user_tempting_no_trade_gold_min"])

    if positive < min_positive or negative < min_negative:
        result = {
            "status": "BLOCKED_GOLD_FIDELITY",
            "clean_dataset_strategy_pnl_executed": False,
            "positive_user_gold_count": positive,
            "positive_user_gold_minimum": min_positive,
            "real_user_tempting_no_trade_gold_count": negative,
            "real_user_tempting_no_trade_gold_minimum": min_negative,
            "receipt_written": False,
            "reason": (
                "REAL_USER_TEMPTING_NO_TRADE_GOLD_MISSING"
                if negative < min_negative else "POSITIVE_USER_GOLD_INSUFFICIENT"
            ),
        }
        print(json.dumps(result, indent=2, sort_keys=True))
        raise SystemExit(2)

    before_semantics = semantics_hash()
    before_gold = gold_manifest_hashes()
    tests = _test_files()

    import pytest
    counter = _Counter()
    rc = int(pytest.main(["-q", *[str(p.relative_to(REPO_ROOT)) for p in tests]], plugins=[counter]))
    passed, failed, skipped = counter.counts()

    after_semantics = semantics_hash()
    after_gold = gold_manifest_hashes()
    if before_semantics != after_semantics:
        raise RuntimeError("V24_ARCHITECTURE_SEMANTICS_CHANGED_DURING_TEST")
    if before_gold != after_gold:
        raise RuntimeError("V24_ARCHITECTURE_GOLD_CHANGED_DURING_TEST")
    if rc != 0 or failed != 0 or passed <= 0:
        result = {
            "status": "REFUSE_ARCHITECTURE_TEST_FAILURE",
            "pytest_exit_code": rc,
            "tests": passed,
            "failures": failed,
            "skipped": skipped,
            "clean_dataset_strategy_pnl_executed": False,
            "receipt_written": False,
        }
        print("\n" + json.dumps(result, indent=2, sort_keys=True))
        raise SystemExit(3)

    receipt = {
        "schema_version": 2,
        "status": "PASS",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "semantics_sha256": before_semantics,
        "tests": passed,
        "failures": failed,
        "skipped": skipped,
        "test_files": [str(p.relative_to(REPO_ROOT)).replace("\\", "/") for p in tests],
        "test_file_sha256": {
            str(p.relative_to(REPO_ROOT)).replace("\\", "/"): _sha256(p) for p in tests
        },
        "positive_user_gold_count": positive,
        "real_user_tempting_no_trade_gold_count": negative,
        **before_gold,
        "clean_dataset_strategy_pnl_executed": False,
        "sealed_runner_executed": False,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        raise RuntimeError(f"V24_ARCHITECTURE_RECEIPT_ALREADY_EXISTS:{out}")
    out.write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print("\n" + json.dumps(receipt, indent=2, sort_keys=True))
    print(f"\nARCHITECTURE RECEIPT WRITTEN: {out}")
    print("NEXT: independent receipt audit; do not run sealed P&L yet.")


if __name__ == "__main__":
    main()
