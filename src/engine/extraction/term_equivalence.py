"""TERM EQUIVALENCE — relevance input normalization (AR-1239 §4).

WHAT THIS IS, AND WHAT IT IS NOT
    Six worker reports in a row surfaced the same unowned gap: `evidence_relevance` compares a
    condition to a span LEXICALLY, so a faithful span whose wording the extractor normalised
    (`fair value gap` -> `FVG`, `one minute` -> `1m`) shares zero content terms and is refused.
    AR-1225 measured that false-reject and deliberately refused to invent a synonym map inside a
    source-truth gate. AR-1239 §4 assigned the ownership instead:

        TERM EQUIVALENCE OWNER = evidence-relevance INPUT NORMALIZATION
        NOT source_fidelity_guard · NOT the locator · NOT the route orchestrator

    🛑 SO THIS CHANGES WHAT COUNTS AS THE SAME CONCEPT WHEN COMPARING RELEVANCE. IT NEVER
    CHANGES SOURCE FIDELITY STRENGTH. A condition that says `confirms` still says `confirms`;
    nothing here can make an inflated claim supported, and `source_fidelity_guard` does not
    import this module. That separation is asserted by a test, not just stated here.

TWO KINDS OF EQUIVALENCE, AND ONLY TWO
    1. DETERMINISTIC MORPHOLOGY — timeframe expressions. `5m`, `5 min`, `5-minute`,
       `five minute` are the same timeframe by a RULE, not by a lookup. Rules generalise to
       sources nobody has read yet; a list only covers what someone remembered to type.
    2. EXPLICIT VERSIONED ABBREVIATIONS — a short, closed table of forms Trading Forge's own
       vocabulary already treats as one concept, each carrying where it is established.

🛑 WHAT IS FORBIDDEN HERE, IN THE FILE ITSELF SO IT CANNOT BE MISSED (AR-1239 §4)
    - NO LLM may propose an alias. Nothing in this module calls a model.
    - NO per-video aliases. The table is global and versioned; a source that needs a new alias
      needs a reviewed table change, not a run-time addition.
    - NO sVkm answer spans, no video ids, no char offsets. Red-proofed by a test.
    - AN UNKNOWN NEAR-SYNONYM DOES NOT BECOME EQUIVALENT BECAUSE IT WOULD IMPROVE A GRADE.
      That is the exact pressure this module exists under, and the answer is always no.
"""

from __future__ import annotations

import re

EQUIVALENCE_VERSION = "tf-term-equivalence-v1"

# --------------------------------------------------------------------------- #
# 1. Deterministic timeframe morphology — a RULE, not a list
# --------------------------------------------------------------------------- #

_NUM_WORDS: dict[str, int] = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30,
    "forty": 40, "forty-five": 45, "sixty": 60, "ninety": 90,
}
_NUM_WORD_ALT = "|".join(sorted(_NUM_WORDS, key=len, reverse=True))

# `5m` · `5 m` · `5min` · `5 minute` · `5-minute` · `five minute` · `five-minute`
_TF_MINUTE = re.compile(
    rf"\b(?:(\d{{1,3}})|({_NUM_WORD_ALT}))\s*[-\s]?\s*(?:m|min|mins|minute|minutes)\b",
    re.IGNORECASE,
)
_TF_HOUR = re.compile(
    rf"\b(?:(\d{{1,2}})|({_NUM_WORD_ALT}))\s*[-\s]?\s*(?:h|hr|hrs|hour|hours)\b",
    re.IGNORECASE,
)


def timeframe_tokens(text: str) -> set[str]:
    """Canonical timeframe tokens found in `text`, e.g. {'tf_min_5', 'tf_min_1'}.

    A rule rather than a table: it covers `7-minute` and `forty-five minute` without anyone
    having written them down, which is the whole reason to prefer morphology here.
    """
    out: set[str] = set()
    for rx, unit in ((_TF_MINUTE, "min"), (_TF_HOUR, "hour")):
        for m in rx.finditer(text or ""):
            digits, word = m.group(1), m.group(2)
            value = int(digits) if digits else _NUM_WORDS.get((word or "").lower())
            if value:
                out.add(f"tf_{unit}_{value}")
    return out


# --------------------------------------------------------------------------- #
# 2. Explicit, versioned abbreviations
# --------------------------------------------------------------------------- #
#
# (canonical token, {surface forms}, where the equivalence is established)
#
# 🛑 ADDING A ROW IS A REVIEWED CHANGE. The bar is that Trading Forge's own vocabulary already
# uses the forms interchangeably — not that adding it would make a condition pass.
_ABBREVIATIONS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    ("eq_fair_value_gap", ("fvg", "fvgs", "fair value gap", "fair value gaps"),
     "src/agents/kb/indicator-catalog.md + transcript-extractor KB use both forms for one concept"),
    ("eq_order_block", ("ob", "order block", "order blocks"),
     "src/engine/context/location_score.py names OB and order block as one structure"),
    ("eq_break_of_structure", ("bos", "break of structure"),
     "src/agents/kb/indicator-catalog.md"),
    ("eq_change_of_character", ("choch", "change of character"),
     "src/agents/kb/indicator-catalog.md"),
    ("eq_higher_timeframe", ("htf", "higher timeframe", "higher time frame"),
     "src/engine/context/htf_context.py"),
    ("eq_lower_timeframe", ("ltf", "lower timeframe", "lower time frame"),
     "src/agents/kb/indicator-catalog.md"),
    ("eq_opening_range", ("or", "opening range"),
     "src/engine/opening_range_* modules name the same concept"),
)

# Longest-first so `fair value gap` is consumed before the bare word `gap` can be considered.
_PHRASES: tuple[tuple[str, str], ...] = tuple(
    sorted(
        ((form, canon) for canon, forms, _ in _ABBREVIATIONS for form in forms),
        key=lambda p: len(p[0]), reverse=True,
    )
)

# Single-word forms that are ALSO ordinary English get no bare-token mapping: `or` and `ob`
# would fire on conjunctions and noise. They still match as multi-word phrases.
_AMBIGUOUS_BARE = frozenset({"or", "ob"})


def abbreviation_tokens(text: str) -> set[str]:
    low = f" {(text or '').lower()} "
    out: set[str] = set()
    for form, canon in _PHRASES:
        if " " in form:
            if re.search(rf"(?<![a-z0-9]){re.escape(form)}(?![a-z0-9])", low):
                out.add(canon)
        elif form not in _AMBIGUOUS_BARE:
            if re.search(rf"\b{re.escape(form)}\b", low):
                out.add(canon)
    return out


def equivalence_tokens(text: str) -> set[str]:
    """Canonical concept tokens for `text` — the seam relevance tokenization consumes.

    Returns ONLY canonical tokens. It never deletes a caller's original tokens, so
    normalization can raise a comparison but can never hide a word the caller was matching on.
    """
    return timeframe_tokens(text) | abbreviation_tokens(text)


def describe() -> dict:
    """Provenance for artifacts: what this version claims to know, and on whose authority."""
    return {
        "version": EQUIVALENCE_VERSION,
        "authority": "AR-1239 §4 — equivalence owned by relevance input normalization",
        "scope": "RELEVANCE COMPARISON ONLY. Never source fidelity strength.",
        "timeframe_rule": "deterministic morphology over digit/number-word + minute/hour units",
        "abbreviations": [
            {"canonical": c, "forms": list(f), "established_by": src}
            for c, f, src in _ABBREVIATIONS
        ],
        "forbidden": [
            "no LLM-proposed aliases", "no per-video aliases",
            "no source pins or answer spans", "no alias added because it improves a grade",
        ],
    }
