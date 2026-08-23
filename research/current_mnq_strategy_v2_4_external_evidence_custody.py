#!/usr/bin/env python3
"""Is the evidence that produced our published numbers still the evidence on disk?

    research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json   33,598 B  IN GIT
    C:/Users/tonio/Downloads/backtesting-analytics.csv                10,771 B  NOT IN GIT

THE LABELS ARE NOW COMMITTED (2026-08-23, ALGO-020 section 4 item 4), after a field scan
confirmed the file carries no monetary field. That closes F-6: two hashes were recorded for it
and NOTHING COMPARED THEM, because they cover DIFFERENT BYTE RANGES --

    whole-file sha256       1b20b0a8...   every byte
    internal labels_sha256  11d8dec0...   {schema_version, pack_id, frozen_at, labels} only

-- so `status`, `wait_at_replay_end_count` and `capture_warnings`, THE ENTIRE CENSORING
ANNOTATION, sat outside the signed payload, unsigned and unchecked. Git custody covers the whole
byte range and does not depend on reproducing the freeze signature, which neither the grader nor
this desk could do. The Downloads original is retained as CORROBORATION only; its absence on
another machine is expected and is not a failure, though a MISMATCH still is.

THE LEDGER REMAINS OUTSIDE THE REPOSITORY, deliberately. It holds the operator's real realized
P&L and pushing it to a remote is his call, not a side effect of a custody check.

WHERE THE EXPECTED HASH COMES FROM, and why that is the whole design. It is read from the
COMMITTED ARTIFACT that was produced from the file -- never re-derived from the live file. A
check that hashes a file and compares it to that same file's hash is vacuous: it passes by
construction and prints the reassurance anyway. A test pins this by changing ONLY the artifact
and requiring the verdict to flip.

THIS MODULE COPIES, MOVES AND COMMITS NOTHING; a test enforces that by banning shutil, copy,
rename and subprocess from it.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_external_evidence_custody
"""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Verifies that external evidence still matches what the committed "
    "artifacts were produced from. Copies nothing, commits nothing, selects no strategy rule."
)

OK, MISSING, CHANGED, NO_EXPECTATION = "OK", "MISSING", "CHANGED", "NO_EXPECTATION_RECORDED"

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
RECONCILIATION = Path(
    "research/current_mnq_strategy_v2_4_trade_ledger_reconciliation_2026_08_21.json")


def _dig(doc: dict, path: tuple[str, ...]):
    cur = doc
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur if isinstance(cur, str) else None


# (label, live path, artifact holding the expectation, key path inside it, what it grounds)
EXTERNAL_EVIDENCE = (
    (
        "trader_labels_COMMITTED",
        Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json"),
        SCORECARD,
        ("trader_labels_file_sha256",),
        "GROUND TRUTH for all 14 fidelity cases. COMMITTED to git 2026-08-23 per ALGO-020 "
        "section 4 item 4, after a field scan confirmed no monetary field. Git custody now "
        "covers the WHOLE byte range including the censoring annotation, which the freeze "
        "signature did not.",
    ),
    (
        "trader_labels_external_origin",
        Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json"),
        SCORECARD,
        ("trader_labels_file_sha256",),
        "The Downloads original the committed copy was taken from. Now CORROBORATION only - "
        "the repository copy is canonical. MISSING here is not a defect.",
    ),
    (
        "trade_ledger",
        Path("C:/Users/tonio/Downloads/backtesting-analytics.csv"),
        RECONCILIATION,
        ("custody", "sha256"),
        "74 realized trades. Evidence of the trader's stop discipline and contract sizing. "
        "Disjoint from the replay corpus -- see ledger_corpus_join.",
    ),
)


def verify() -> list[dict]:
    out = []
    for label, live, artifact, key, grounds in EXTERNAL_EVIDENCE:
        expected = None
        if artifact.exists():
            try:
                expected = _dig(json.load(io.open(artifact, encoding="utf-8")), key)
            except (ValueError, OSError):
                expected = None

        if expected is None:
            status, measured = NO_EXPECTATION, None
        elif not live.exists():
            status, measured = MISSING, None
        else:
            measured = hashlib.sha256(live.read_bytes()).hexdigest()
            status = OK if measured == expected else CHANGED

        out.append({
            "label": label, "status": status,
            "in_repository": str(live).startswith("research"),
            "path": str(live),
            "bytes": live.stat().st_size if live.exists() else None,
            "expected_sha256": expected, "expected_from": str(artifact),
            "measured_sha256": measured, "grounds": grounds,
        })
    return out


def assert_intact(rows: list[dict] | None = None) -> list[dict]:
    """Raise unless every external evidence file still matches its committed expectation."""
    rows = rows if rows is not None else verify()
    # The external origin is corroboration, not custody: the repository copy is canonical, so
    # its absence on another machine is expected and is not a failure. A MISMATCH still is.
    bad = [r for r in rows if r["status"] != OK
           and not (r["label"] == "trader_labels_external_origin"
                    and r["status"] == MISSING)]
    if bad:
        lines = [f'  {r["label"]}: {r["status"]} at {r["path"]}' for r in bad]
        raise RuntimeError(
            "EXTERNAL_EVIDENCE_NOT_INTACT -- the published numbers cannot be reproduced from "
            "what is on disk:\n" + "\n".join(lines))
    return rows


def main() -> None:
    rows = verify()
    for r in rows:
        print(f'{r["label"]:16} {r["status"]:22} {r["bytes"] or "-":>8} B  {r["path"]}')
        if r["status"] == CHANGED:
            print(f'    expected {r["expected_sha256"]}')
            print(f'    measured {r["measured_sha256"]}')
    print()
    try:
        assert_intact(rows)
        print("ALL EXTERNAL EVIDENCE INTACT.")
    except RuntimeError as e:
        print(e)
    print()
    in_git = [r["label"] for r in rows if r["in_repository"]]
    outside = [r["label"] for r in rows if not r["in_repository"]]
    print(f"under git custody : {in_git}")
    print(f"outside the repo  : {outside}")
    print("The ledger stays outside deliberately - it holds the operator's real realized P&L "
          "and publishing it is his call, not a side effect of a custody check. For that file "
          "this check detects loss or edit; it does not prevent it.")


if __name__ == "__main__":
    main()
