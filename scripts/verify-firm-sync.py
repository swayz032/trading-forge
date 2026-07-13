#!/usr/bin/env python3
"""Verify the canonical stage-aware prop-firm rule wiring.

The old verifier parsed hard-coded Python and TypeScript literals. Both are now
legacy projections generated from ``src/shared/firm-stage-rules.json``, so
parsing source text would create false drift reports. This verifier checks the
rule book, both loaders, and the read-only prop-firm route wiring directly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
RULE_BOOK_PATH = ROOT / "src" / "shared" / "firm-stage-rules.json"
PY_LOADER = ROOT / "src" / "engine" / "firm_stage_rules.py"
TS_LOADER = ROOT / "src" / "shared" / "firm-stage-rules.ts"
PY_PROJECTION = ROOT / "src" / "engine" / "firm_config.py"
TS_PROJECTION = ROOT / "src" / "shared" / "firm-config.ts"
PROP_FIRM_ROUTE = ROOT / "src" / "server" / "routes" / "prop-firm.ts"


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    def passed(message: str) -> None:
        print(f"  [PASS] {message}")

    def failed(message: str) -> None:
        errors.append(message)
        print(f"  [FAIL] {message}")

    def warned(message: str) -> None:
        warnings.append(message)
        print(f"  [WARN] {message}")

    print("=" * 70)
    print("  TRADING FORGE — STAGE-AWARE PROP FIRM SYNC VERIFICATION")
    print("=" * 70)

    try:
        rule_book: dict[str, Any] = json.loads(RULE_BOOK_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        failed(f"Missing canonical rule book: {RULE_BOOK_PATH}")
        return 1
    except json.JSONDecodeError as exc:
        failed(f"Malformed canonical rule book: {exc}")
        return 1

    firms = rule_book.get("firms")
    if not isinstance(firms, dict):
        failed("Rule book has no 'firms' object")
        return 1

    expected = {"topstep_50k", "mffu_50k"}
    if set(firms) != expected:
        failed(f"Expected active firms {sorted(expected)}, found {sorted(firms)}")
    else:
        passed("Rule book contains exactly Topstep + MFFU 50K accounts")

    for file_path, import_marker in (
        (PY_LOADER, "firm-stage-rules.json"),
        (TS_LOADER, "firm-stage-rules.json"),
        (PY_PROJECTION, "firm_stage_rules"),
        (TS_PROJECTION, "firm-stage-rules"),
        (PROP_FIRM_ROUTE, "firm-stage-rules"),
    ):
        if not file_path.exists():
            failed(f"Missing stage consumer: {file_path.relative_to(ROOT)}")
        elif import_marker not in file_path.read_text(encoding="utf-8"):
            failed(f"{file_path.relative_to(ROOT)} is not wired to canonical stage rules")
        else:
            passed(f"{file_path.relative_to(ROOT)} uses canonical stage rules")

    print("\n== RULE BOOK CHECKS ==")
    for key in sorted(expected):
        rule = firms.get(key)
        if not isinstance(rule, dict):
            failed(f"{key}: rule entry is not an object")
            continue
        missing = [stage for stage in ("evaluation", "funded", "payout", "live", "execution") if not isinstance(rule.get(stage), dict)]
        if missing:
            failed(f"{key}: missing stage(s) {', '.join(missing)}")
            continue

        evaluation = rule["evaluation"]
        funded = rule["funded"]
        payout = rule["payout"]
        if evaluation.get("account_size") != 50_000:
            failed(f"{key}: evaluation account size is {evaluation.get('account_size')}, expected 50000")
        if evaluation.get("activation_fee") != 0:
            failed(f"{key}: activation fee must be zero")
        if evaluation.get("weekend_ok") is not False:
            failed(f"{key}: weekend trading must be disabled")
        if funded.get("trailing") != "eod":
            failed(f"{key}: funded trailing must be eod for the selected plan")

        if key == "topstep_50k":
            consistency = evaluation.get("consistency")
            paths = payout.get("paths", {})
            valid = (
                evaluation.get("min_trading_days") == 2
                and isinstance(consistency, dict)
                and consistency.get("mode") == "dynamic_profit_target"
                and consistency.get("ratio") == 0.5
                and paths.get("standard", {}).get("minimum_winning_days") == 5
                and paths.get("consistency", {}).get("maximum_consistency_ratio") == 0.4
            )
            if not valid:
                failed("topstep_50k: Combine/XFA stage contract is incomplete or stale")
            else:
                passed("Topstep: 2-day dynamic Combine target and separate XFA payout paths")
        else:
            valid = (
                evaluation.get("min_trading_days") == 1
                and payout.get("minimum_qualifying_days") == 2
                and payout.get("payout_buffer") == 2100
                and payout.get("payout_cycle_days") == 2
                and payout.get("maximum_consistency_ratio") == 0.5
                and payout.get("sim_payouts_to_live") == 5
            )
            if not valid:
                failed("mffu_50k: Builder evaluation/sim-funded payout/live contract is incomplete or stale")
            else:
                passed("MFFU Builder: separate eval, sim-funded payout, and live transition rules")

    print("\n== STAGE SUMMARY ==")
    print(f"{'Firm':<11} {'Eval days':<10} {'Target':<9} {'Payout stage':<42}")
    print("-" * 76)
    for key in ("topstep_50k", "mffu_50k"):
        rule = firms.get(key, {})
        evaluation = rule.get("evaluation", {})
        payout = rule.get("payout", {})
        if key == "topstep_50k":
            payout_label = "XFA Standard 5×$150; Consistency 3 days / 40%"
        else:
            payout_label = "Builder 2 days, $2,100 buffer, 50% sim-funded"
        print(
            f"{rule.get('firm_id', key):<11} "
            f"{str(evaluation.get('min_trading_days', '?')):<10} "
            f"${str(evaluation.get('profit_target', '?')):<8} "
            f"{payout_label:<42}"
        )

    print("\n" + "=" * 70)
    if errors:
        print(f"RESULT: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    if warnings:
        print(f"RESULT: PASS with {len(warnings)} warning(s)")
    else:
        print("RESULT: PERFECT STAGE-RULE SYNC")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
