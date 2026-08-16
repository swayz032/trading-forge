"""SOURCE-FIDELITY GUARD — generic clause-level inflation detector.

Authority: GPT ruling AR-1204 §6 LANE 1. Contract, verbatim:

    normalized terminology is allowed; unsupported certainty, modifiers,
    timing windows, quantities, and causal claims are not.

WHY THIS IS NOT AN EXACT-TOKEN MATCHER (AR-1204 §2, which STRUCK exactly that error):
this guard inspects **epistemic** language only — how strongly a claim is asserted,
how it is quantified, and over what temporal extent. It never inspects domain
vocabulary. A source may therefore express a domain concept through any morphology
or paraphrase it likes and this guard will not object, because it never looked at
the domain word in the first place. Absence of an exact domain token is NOT a
fidelity verdict here, by construction.

What it DOES object to is an extracted condition that is epistemically STRONGER than
the source span offered to support it:

  CERTAINTY_INFLATION      source hedges, condition determines
  UNSUPPORTED_MODIFIER     condition adds a probability/quality claim absent from source
  TIMING_WINDOW_WIDENING   source names an instant, condition spans a window
  UNSUPPORTED_QUANTITY     condition states a number the source never states
  NO_SUPPORTING_EVIDENCE   condition offered with no span at all
  EMPTY_CONDITION          nothing to check — refuse rather than pass

The lexicons below are ordinary English epistemic markers. They carry no strategy,
instrument, timeframe, venue or teacher-specific string, and a test asserts that.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["FidelityFinding", "check_condition_fidelity"]


@dataclass(frozen=True)
class FidelityFinding:
    kind: str
    clause: str
    detail: str


# --- epistemic lexicons (domain-free) -------------------------------------- #

# Verbs asserting that something is DETERMINED. Matched by stem so inflections
# (-s, -ing, -ed) are covered without an exact-token rule.
_CERTAINTY_STEMS = (
    "confirm", "guarantee", "ensure", "prove", "determine",
    "establish", "dictate", "verif", "assure", "certif",
)

# Markers that a claim is offered TENTATIVELY.
_HEDGE_PATTERNS = (
    r"\bgives?\s+(?:us|me|you)\s+an?\s+idea\b",
    r"\bidea\s+of\b",
    r"\bmay\b", r"\bmight\b", r"\bcould\b", r"\bperhaps\b",
    r"\btends?\s+to\b", r"\bprobabl\w*\b", r"\blikely\b",
    r"\bsuggests?\b", r"\bhints?\b", r"\bseems?\b", r"\bappears?\b",
    r"\bkind\s+of\b", r"\bsort\s+of\b", r"\broughly\b", r"\bgenerally\b",
)

# Probability / quality claims. Each entry is (surface pattern, stem that must be
# supported in the source for the claim to stand).
_MODIFIER_CLAIMS = (
    (r"high[-\s]?probability", "probab"),
    (r"low[-\s]?probability", "probab"),
    (r"\bprobability\b", "probab"),
    (r"\bhigh[-\s]?conviction\b", "conviction"),
    (r"\breliable\b", "reliab"),
    (r"\bguaranteed\b", "guarantee"),
    (r"\boptimal\b", "optim"),
    (r"\bhighest[-\s]?probability\b", "probab"),
    (r"\bmost\s+accurate\b", "accura"),
    (r"\bsafest\b", "safe"),
    (r"\bstrongest\b", "strong"),
    (r"\bbest\b", "best"),
    (r"\blow[-\s]?risk\b", "risk"),
    (r"\bhigh[-\s]?win\b", "win"),
)

# Temporal EXTENT quantifiers — a span of time rather than an instant.
_WINDOW_PATTERNS = (
    r"\bduring\b", r"\bthroughout\b", r"\bwithin\s+the\b",
    r"\banytime\b", r"\bany\s+time\s+(?:in|during)\b", r"\ball\s+through\b",
    r"\bacross\s+the\b",
)

# A clock instant.
_POINT_TIME = re.compile(r"\b\d{1,2}\s*[:.]\s*\d{2}\b")
# A marker that the extraction turned an instant into a named stretch of time.
_EXTENT_NOUN = re.compile(r"\b(session|window|period|hours?)\b", re.I)

_NUM_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30,
    "sixty": 60, "ninety": 90,
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _has_certainty(text: str) -> str | None:
    for stem in _CERTAINTY_STEMS:
        m = re.search(r"\b" + stem + r"\w*", text)
        if m:
            return m.group(0)
    return None


def _has_hedge(text: str) -> str | None:
    for pat in _HEDGE_PATTERNS:
        m = re.search(pat, text)
        if m:
            return m.group(0)
    return None


def _numeric_tokens(text: str) -> set[str]:
    """Numbers a reader could take from this text.

    Clock times are kept whole (a `HH:MM` never decomposes into {HH, MM}). Number-words are
    folded to digits so `one minute` supports `1m` — that folding is what stops
    this rule from degenerating into the exact-token matcher AR-1204 §2 forbids.
    """
    out: set[str] = set()
    working = text
    for m in _POINT_TIME.finditer(working):
        out.add(re.sub(r"\s*", "", m.group(0)).replace(".", ":"))
    working = _POINT_TIME.sub(" ", working)
    for m in re.finditer(r"\d+", working):
        out.add(str(int(m.group(0))))
    for word, val in _NUM_WORDS.items():
        if re.search(r"\b" + word + r"\b", working):
            out.add(str(val))
    return out


def check_condition_fidelity(
    condition_text: str,
    supporting_quotes: list[str] | tuple[str, ...],
) -> list[FidelityFinding]:
    """Return every clause-level inflation of `condition_text` relative to its
    `supporting_quotes`. Empty list == no inflation detected.

    This never asserts the condition is CORRECT — only that it does not claim more
    certainty, quality, temporal extent or quantity than its source offers.
    """
    cond = _norm(condition_text)
    if not cond:
        return [FidelityFinding("EMPTY_CONDITION", "", "condition text is empty or whitespace")]

    quotes = [_norm(q) for q in (supporting_quotes or []) if _norm(q)]
    if not quotes:
        return [FidelityFinding(
            "NO_SUPPORTING_EVIDENCE", condition_text,
            "condition was offered with no supporting source span; absence of evidence "
            "must not read as clean evidence",
        )]

    joined = " ".join(quotes)
    findings: list[FidelityFinding] = []

    # 1. CERTAINTY — condition determines where the source only hedges.
    cond_cert = _has_certainty(cond)
    if cond_cert and not _has_certainty(joined):
        hedge = _has_hedge(joined)
        if hedge:
            findings.append(FidelityFinding(
                "CERTAINTY_INFLATION", cond_cert,
                f"condition asserts {cond_cert!r} but the source only hedges ({hedge!r})",
            ))

    # 2. MODIFIER — probability/quality claim with no support in the source.
    for pattern, stem in _MODIFIER_CLAIMS:
        m = re.search(pattern, cond)
        if m and stem not in joined:
            findings.append(FidelityFinding(
                "UNSUPPORTED_MODIFIER", m.group(0),
                f"condition claims {m.group(0)!r}; no {stem!r} support in the source span",
            ))

    # 3. TIMING — an instant in the source became an extent in the condition.
    cond_window = next((m.group(0) for p in _WINDOW_PATTERNS
                        for m in [re.search(p, cond)] if m), None)
    if cond_window and _EXTENT_NOUN.search(cond) and _POINT_TIME.search(cond):
        src_has_window = any(re.search(p, joined) for p in _WINDOW_PATTERNS)
        if _POINT_TIME.search(joined) and not src_has_window:
            findings.append(FidelityFinding(
                "TIMING_WINDOW_WIDENING", cond_window,
                "source names a point in time; condition spans it into a window "
                f"({cond_window!r} + extent noun)",
            ))

    # 4. QUANTITY — a number the source never states.
    missing = _numeric_tokens(cond) - _numeric_tokens(joined)
    if missing:
        findings.append(FidelityFinding(
            "UNSUPPORTED_QUANTITY", ", ".join(sorted(missing)),
            f"condition states {sorted(missing)} which the source span does not",
        ))

    return findings
