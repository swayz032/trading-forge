#!/usr/bin/env python3
"""THE F2 ANCHOR: the frozen 5/8 comparator, pinned by PATH + SHA256. ALGO-060 §2.

WHY THIS FILE EXISTS, AND IT IS A REAL DEFECT IN THE EVIDENCE CHAIN, NOT BOOKKEEPING.

F2 asks whether the wired brain lost any agreement the FROZEN baseline had. Answering it needs
the frozen agreeing SET. Until now that set came from two places, and BOTH were wrong:

  1. `run_f4_rederive_arm_headlines.py` took `frozen_path` as a COMMAND-LINE ARGUMENT, and the
     path passed was a TRANSIENT SCRATCHPAD ARENA rebuilt by hand from a git blob. An anchor
     that lives in a temp directory is one cleanup away from unverifiable, and an anchor that
     arrives as an argument is whatever the caller says it is.
  2. `run_refusal_diagnosis_lost_four.py` TYPED the five sessions as a literal set. A typed
     population is the shape this lane has been convicted on repeatedly.

AND THE OBVIOUS CANDIDATE IS NOT AN ANCHOR. `current_mnq_strategy_v2_4_frozen_14_case_scorecard_
2026_08_21.json` is named "frozen" but is REWRITTEN BY EVERY CANONICAL RUN — seven distinct
blobs in its history; 5/8 at `39bc3985` / `8166c428` / `ea6f0940`, and 1/8 from `025b5a1e` on.
At head it holds 1/8. **No committed JSON at head held the 5/8 rows at all.** The comparator
the whole freeze decision turns on existed only in git history.

SO THE ANCHOR IS A DISTINCT, NEVER-REWRITTEN FILE: a byte copy of blob `ea6f0940` (git object
`c636eacf457ae900b8542c195faa4b6573a2cc8c`), verified by sha256 on every read. No runner writes
its path, and a test asserts that.

THE SET IS RE-DERIVED FROM ROWS, NEVER READ FROM THE HEADLINE FIELD. A headline string is a
summary, and a summary checked against another summary passes any consistent lie.
"""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

#: The anchor. Byte copy of blob ea6f0940 of the then-canonical scorecard.
ANCHOR = Path("research/current_mnq_strategy_v2_4_F2_ANCHOR_frozen_5of8_ea6f0940_IMMUTABLE.json")

#: Its identity IS this hash. Verified on every read; a mismatch is a hard refusal.
ANCHOR_SHA256 = "508123125cf389d67d3964aaa95c641b9d1e61f6059210bbc5b86a7edba310d9"

#: The git blob it was taken from, so the provenance survives without the working tree.
ANCHOR_BLOB = "c636eacf457ae900b8542c195faa4b6573a2cc8c"
ANCHOR_COMMIT = "ea6f0940"

#: The file that is NAMED frozen but is rewritten by every canonical run. Never the anchor.
LIVE_SCORECARD_NOT_THE_ANCHOR = Path(
    "research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

AGREEMENT_CLASSES = frozenset({"AGREE", "BOTH_DECLINED"})


class AnchorCustodyError(RuntimeError):
    """Raised instead of returning a comparator nobody can vouch for."""


def load() -> dict:
    """Read the anchor, verifying its sha256 FIRST. Never takes a path from a caller."""
    if not ANCHOR.exists():
        raise AnchorCustodyError(
            f"the F2 anchor is missing at {ANCHOR}. It is a byte copy of git blob "
            f"{ANCHOR_BLOB} (commit {ANCHOR_COMMIT}); restore it with "
            f"`git cat-file -p {ANCHOR_BLOB}`.")
    raw = ANCHOR.read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != ANCHOR_SHA256:
        raise AnchorCustodyError(
            f"F2 ANCHOR CUSTODY FAILURE: {ANCHOR} hashes to {got}, expected {ANCHOR_SHA256}. "
            f"The comparator the freeze decision turns on has MOVED. Nothing downstream of "
            f"this is trustworthy until it is restored from blob {ANCHOR_BLOB}.")
    return json.loads(raw.decode("utf-8"))


def agreeing_sessions() -> set[str]:
    """The frozen 5/8 agreeing SET, RE-DERIVED FROM THE ROWS.

    Not read from `aggregates.agreement_decided_cases`: that is a summary field, and a summary
    checked against another summary agrees with any internally consistent lie.
    """
    return {c["session"] for c in load()["cases"]
            if c["mismatch_class"] in AGREEMENT_CLASSES}


def decided_sessions() -> set[str]:
    return {c["session"] for c in load()["cases"]
            if not str(c["mismatch_class"]).startswith("CENSORED")}


def headline() -> str:
    return f"{len(agreeing_sessions())}/{len(decided_sessions())}"


def lost_against_anchor(agreeing: set[str]) -> list[str]:
    """What an arm LOST versus the anchor, by MEMBERSHIP. This is F2."""
    return sorted(agreeing_sessions() - set(agreeing))


__all__ = ["ANCHOR", "ANCHOR_BLOB", "ANCHOR_COMMIT", "ANCHOR_SHA256", "AGREEMENT_CLASSES",
           "AnchorCustodyError", "LIVE_SCORECARD_NOT_THE_ANCHOR", "agreeing_sessions",
           "decided_sessions", "headline", "load", "lost_against_anchor"]
