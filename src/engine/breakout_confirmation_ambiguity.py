"""Trigger safety — the taught breakout whose CONFIRMATION the source never specifies.

AUTHORITY: `R-746 §3` (the four semantic conditions), `R-747 §4` / `§6`.

THE DEFECT THIS REFUSES
-----------------------
`AR-842 §2` measured the golden strategy's entry trigger — *"when price breaks above
the range high"* — bound to `structure_engine.compute_structure_state`, whose own
handler docstring says *"the specific structural OBJECT text … is not checked — only
generic BOS/CHoCH/MSS activity."* Nothing in the executable path reads the taught
sentence. `AR-843` then measured that the trigger is NON-DISCRIMINATING on the
deterministic fixture: present or absent, the strategy enters on the same bars.

    `A POINTER TO A SEMANTICALLY UNRELATED PRIMITIVE IS NOT A BOUND TRIGGER.`
    (`R-746 §3`)

WHAT IS UNRESOLVED — AND WHAT IS NOT
------------------------------------
★★★ **THE TEACHER IS NOT SILENT ABOUT DIRECTION.** *"above the range high"* teaches
the direction explicitly, and reporting this as an absent direction would ERASE what
the teacher DID say. What the source does not supply is WHICH CONFIRMATION makes the
break real: a touch · a wick penetration · an intrabar cross · a candle close beyond
the level · some other rule. Those produce materially different entries, and none may
be selected silently.

    `PARTIALLY SPECIFIED IS A THIRD SILENCE.` — `TWO DIFFERENT SILENCES DESERVE TWO
    DIFFERENT NAMES` (`R-741 §2`) applied one level finer: this is neither ABSENT nor
    CONTRADICTORY, and calling it either loses information the teacher provided.

FOUR CONDITIONS, ALL REQUIRED
-----------------------------
1. it is the ENTRY TRIGGER
2. it references an ALREADY-CONSTRUCTED opening-range boundary
3. it expresses an ENTRY/CROSSING relationship with that boundary
4. the source does NOT specify the confirmation semantics

`ALL` is load-bearing. Any three of these describe conditions that must keep working:
an ordinary structure trigger (fails 2), a non-trigger sentence mentioning the range
(fails 1), a trigger that says *"closes above the range high"* (fails 4 — the teacher
DID specify, so it must NOT be labelled ambiguous).

NO STRATEGY IDENTITY IN THIS MODULE
-----------------------------------
🛑 `R-747 §6`: no video id, no strategy id, no condition id appears in this rule, and
a test asserts it. The refusal must follow from what the SENTENCE says, so that two
frozen members are discriminating evidence rather than a lookup table.

VOCABULARIES ARE DELIBERATELY BOUNDED
-------------------------------------
Same discipline as `opening_range_lowering._SPELLED_MINUTES`: an unlisted phrasing does
NOT match, so the trigger stays on its existing route and nothing is silently refused.
Extending a list to "cover more cases" trades a visible miss for an invisible one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

REASON_BREAKOUT_CONFIRMATION_UNRESOLVED: str = (
    "opening_range_breakout_confirmation_unresolved_from_source"
)
"""The exact refusal reason `R-746 §3` ordered."""

AMBIGUITY_BREAKOUT_CONFIRMATION: str = "breakout_confirmation_semantics"
"""Names WHICH question the source left open — not "the trigger is ambiguous", which
would leave a reader unable to tell what to go and look for in the video."""

DISPOSITION_SOURCE_AMBIGUOUS: str = "SOURCE_AMBIGUOUS"

# ── (2) an already-constructed opening-range boundary ────────────────────────
_BOUNDARY_RE = re.compile(
    r"\b(?:(?:opening[\s-]+)?range)\s+(?:high|low)\b"
    r"|\b(?:high|low)\s+of\s+the\s+(?:opening[\s-]+)?range\b"
    r"|\bopening[\s-]+range\s+(?:boundary|level|extreme)\b",
    re.IGNORECASE,
)

# ── (3) an entry / crossing relationship WITH that boundary ──────────────────
_CROSSING_RE = re.compile(
    r"\b(?:break(?:s|ing)?|breaks?\s+out|cross(?:es|ing)?|trades?\s+(?:through|above|below)"
    r"|takes?\s+out|penetrat(?:es|ing)|move(?:s|d)?\s+(?:above|below)|push(?:es|ing)\s+"
    r"(?:above|below)|clears?)\b",
    re.IGNORECASE,
)

# ── (4) EXPLICIT confirmation semantics — presence of ANY of these means the
#        teacher DID specify, and this rule must stand down ───────────────────
_CONFIRMATION_RE = re.compile(
    r"\bclos(?:e|es|ed|ing)\b"           # "closes above the range high"
    r"|\bcandle\s+clos\w*"
    r"|\bbody\s+(?:clos\w*|above|below)"
    r"|\bwick(?:s|ed)?\b"
    r"|\bretest(?:s|ed|ing)?\b"
    r"|\bconfirm(?:s|ed|ation)\b"
    r"|\bon\s+a\s+(?:\d+\s*(?:m|min|minute|h|hour)\w*\s+)?clos\w*"
    r"|\bfull\s+candle\b"
    r"|\btick(?:s)?\s+(?:above|below|through)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BreakoutAmbiguityVerdict:
    """The classifier's answer, with the evidence that produced it.

    `evidence` is carried so a refusal can be audited against the video without
    re-running the classifier — `A REFUSAL THAT DOES NOT SHOW ITS EVIDENCE IS
    INDISTINGUISHABLE FROM A BROKEN READER` (`opening_range_lowering`).
    """

    ambiguous: bool
    reason: str | None
    ambiguity: str | None
    evidence: tuple[tuple[str, str], ...]
    """`(condition_name, matched_span)` for every condition that fired, and
    `(condition_name, "")` for the one that did not."""


def classify_breakout_confirmation_ambiguity(
    *,
    is_entry_trigger: bool,
    text: str,
    opening_range_defined_in_spec: bool,
) -> BreakoutAmbiguityVerdict:
    """Apply the four semantic conditions. ALL must hold.

    `opening_range_defined_in_spec` is the caller's answer to *"is there an
    already-constructed opening-range boundary in this spec at all"*. A trigger that
    names a range high in a spec that never builds one is a different defect
    (a dangling reference) and this rule deliberately does not claim it.
    """
    evidence: list[tuple[str, str]] = []

    if not is_entry_trigger:
        return BreakoutAmbiguityVerdict(False, None, None, (("is_entry_trigger", ""),))
    evidence.append(("is_entry_trigger", "yes"))

    if not opening_range_defined_in_spec:
        return BreakoutAmbiguityVerdict(
            False, None, None, (*evidence, ("opening_range_defined_in_spec", ""))
        )
    evidence.append(("opening_range_defined_in_spec", "yes"))

    boundary = _BOUNDARY_RE.search(text or "")
    if boundary is None:
        return BreakoutAmbiguityVerdict(False, None, None, (*evidence, ("references_boundary", "")))
    evidence.append(("references_boundary", boundary.group(0)))

    crossing = _CROSSING_RE.search(text or "")
    if crossing is None:
        return BreakoutAmbiguityVerdict(
            False, None, None, (*evidence, ("crossing_relationship", ""))
        )
    evidence.append(("crossing_relationship", crossing.group(0)))

    # (4) INVERTED ON PURPOSE: the presence of explicit confirmation language means the
    # source DID specify, so the rule stands down. This is the branch that stops the
    # classifier from swallowing a clearer teacher, and it is the one the discrimination
    # controls exercise hardest.
    confirmation = _CONFIRMATION_RE.search(text or "")
    if confirmation is not None:
        return BreakoutAmbiguityVerdict(
            False, None, None, (*evidence, ("confirmation_specified", confirmation.group(0)))
        )
    evidence.append(("confirmation_specified", ""))

    return BreakoutAmbiguityVerdict(
        ambiguous=True,
        reason=REASON_BREAKOUT_CONFIRMATION_UNRESOLVED,
        ambiguity=AMBIGUITY_BREAKOUT_CONFIRMATION,
        evidence=tuple(evidence),
    )
