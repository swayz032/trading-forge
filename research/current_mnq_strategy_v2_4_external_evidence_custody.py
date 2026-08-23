#!/usr/bin/env python3
"""The two files this campaign's ground truth rests on are NOT IN THE REPOSITORY.

    C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json    33,598 B
    C:/Users/tonio/Downloads/backtesting-analytics.csv           10,771 B

The first holds the TRADER LABELS -- every "the trader entered long here" that the fidelity
score is measured against. Every agreement figure, every disagreement class and every censoring
decision in the 14-case baseline is downstream of it. It lives in a Downloads folder, which is
where browsers write and where people tidy up. If it is deleted the baseline is unreproducible;
if it is edited the baseline silently changes meaning.

WHERE THE EXPECTED HASH COMES FROM, and why that is the whole design. It is read from the
COMMITTED ARTIFACT that was produced from the file -- `trader_labels_file_sha256` in the
scorecard, `custody.sha256` in the ledger reconciliation. It is NEVER re-derived from the live
file. A check that hashes a file and compares it to that same file's hash is vacuous: it passes
by construction and reports the reassurance anyway. Sourcing the expectation from the artifact
makes the committed evidence the authority, and lets this module answer the only question worth
asking -- "is the file that produced our published numbers still the file on disk?"

THIS MODULE DOES NOT COPY, MOVE OR COMMIT ANYTHING. The ledger contains the operator's real
realized P&L and the labels are his own trading decisions; pushing either to a remote is his
call to make, not a side effect of a custody check. This reports; he decides.

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
        "trader_labels",
        Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json"),
        SCORECARD,
        ("trader_labels_file_sha256",),
        "GROUND TRUTH for all 14 fidelity cases. Every agreement figure, every mismatch class "
        "and every censoring decision is downstream of this file.",
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
            "path": str(live), "in_repository": False,
            "bytes": live.stat().st_size if live.exists() else None,
            "expected_sha256": expected, "expected_from": str(artifact),
            "measured_sha256": measured, "grounds": grounds,
        })
    return out


def assert_intact(rows: list[dict] | None = None) -> list[dict]:
    """Raise unless every external evidence file still matches its committed expectation."""
    rows = rows if rows is not None else verify()
    bad = [r for r in rows if r["status"] != OK]
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
    print("NOTE, and it is not a defect this module can fix: both files sit OUTSIDE the "
          "repository, uncommitted. This check detects loss or edit; it does not prevent it. "
          "Whether either file should be preserved elsewhere is the operator's call -- the "
          "ledger holds his real realized P&L.")


if __name__ == "__main__":
    main()
