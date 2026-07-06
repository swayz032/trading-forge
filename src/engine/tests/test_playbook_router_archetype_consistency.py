"""H-1 archetype-classification consistency guard (Deep-Scan #18c, 2026-07-05).

The multi-TF library expansion registers each YouTube-educator concept across
several timeframes in the playbook_router strategy-family lists. The other session's
OR-branches WIP drafted this 42-entry expansion with ALL of them in CONTINUATION_STRATS,
which Deep-Scan Band A/B flagged as misclassifying 6 concept families: it would place
``manipulation_trade_*_1m`` (and 5 others) in CONTINUATION_STRATS while their 5m
sibling lives in REVERSAL_STRATS — a semantic inversion that hands those setups the
wrong bias-regime eligibility. This commit lands the expansion onto phase-0 with the
CORRECTED split (18 → REVERSAL to match their siblings, 24 stay CONTINUATION); phase-0
never carried the misclassified draft.

The invariant these tests enforce: **a given concept (stripped of its
``_<symbol>_<timeframe>`` suffix) must belong to exactly ONE archetype family.**
A concept's directional nature is intrinsic — it does not flip archetype by timeframe.
"""

import re

from src.engine.context.playbook_router import (
    CONTINUATION_STRATS,
    MEAN_REV_STRATS,
    ORB_STRATS,
    REVERSAL_STRATS,
)

_SUFFIX_RE = re.compile(r"_(mes|mnq|mcl)_(1m|5m|15m|30m|1h|4h)$")

_LISTS = {
    "CONTINUATION": CONTINUATION_STRATS,
    "REVERSAL": REVERSAL_STRATS,
    "MEAN_REV": MEAN_REV_STRATS,
    "ORB": ORB_STRATS,
}


def _concept(name: str) -> str:
    """Strip the ``_<symbol>_<timeframe>`` suffix to get the concept base."""
    return _SUFFIX_RE.sub("", name)


def test_no_concept_classified_into_multiple_archetype_lists():
    """The core H-1 invariant: no concept spans two archetype families."""
    concept_to_lists: dict[str, set[str]] = {}
    for list_name, strats in _LISTS.items():
        for entry in strats:
            concept_to_lists.setdefault(_concept(entry), set()).add(list_name)

    conflicts = {
        concept: sorted(lists)
        for concept, lists in concept_to_lists.items()
        if len(lists) > 1
    }
    assert not conflicts, (
        "H-1: concept(s) classified into multiple archetype lists "
        f"(cross-timeframe inversion): {conflicts}"
    )


def test_no_exact_duplicate_entry_across_lists():
    """No literal strategy name appears in two family lists."""
    seen: dict[str, str] = {}
    for list_name, strats in _LISTS.items():
        for entry in strats:
            assert entry not in seen, (
                f"{entry!r} duplicated across {seen.get(entry)} and {list_name}"
            )
            seen[entry] = list_name


def test_misclassified_families_are_reversal_across_all_timeframes():
    """Regression guard for the 6 families Deep-Scan #18c corrected.

    Each has a REVERSAL 5m sibling, so every timeframe variant must be REVERSAL —
    never CONTINUATION (the original expansion's bug).
    """
    cases = {
        "manipulation_trade": ("1m", "5m"),
        "jump_in_downtrend": ("1h", "5m"),
        "bos_and_fvg_or_fvg": ("15m", "5m"),
        "vwap_cross": ("15m", "5m"),
        "entry_condition": ("1h", "5m"),
        "trade_era_scale_in": ("4h", "5m"),
    }
    for concept, tfs in cases.items():
        for tf in tfs:
            for sym in ("mes", "mnq", "mcl"):
                name = f"{concept}_{sym}_{tf}"
                assert name in REVERSAL_STRATS, f"{name} must be in REVERSAL_STRATS"
                assert name not in CONTINUATION_STRATS, (
                    f"{name} must NOT be in CONTINUATION_STRATS (H-1 inversion)"
                )
