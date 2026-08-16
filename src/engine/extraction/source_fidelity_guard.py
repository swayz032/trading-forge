"""SOURCE-FIDELITY DETECTOR — generic clause-level inflation screen.

🛑 STATUS, STATED ON THE ARTIFACT RATHER THAN BESIDE IT (AR-1206 §2, §2.4):
THIS IS A DETECTOR, NOT A CERTIFICATION GATE.

  * `findings == []` means ONLY "this heuristic detected no inflation".
    It NEVER means "source fidelity certified", and it may not be used to
    weaken or clear any existing red certificate.
  * As of this writing nothing in the grading path calls it — SYSTEM-INVENTORY
    records it as `not reachable from any measured entry point`. It is a
    standalone helper with tests, not an end-to-end birth gate.
  * It is a CHEAP DETERMINISTIC SCREEN, deliberately not a semantic oracle. The
    clause-attachment rule below can still be fooled by an unrelated marker that
    happens to sit in a same-topic clause. Known and accepted; that is why the
    output is advisory.

Authority: GPT rulings AR-1204 §6 LANE 1 (contract) and AR-1206 §2 (hardening).
Contract:

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

# Risk/benefit claims — AR-1239 §3.1. A condition asserting that doing the thing REDUCES
# risk, or is safer, is claiming a benefit the source has to actually offer. Split into a
# (verb, object) pair so `minimizes entry risk` matches while `risk` alone does not: the bare
# noun appears in almost every trading sentence and would fire on everything.
_RISK_BENEFIT_VERBS = r"(?:minimi[sz]\w*|reduc\w*|lower\w*|limit\w*|decreas\w*|mitigat\w*|cut\w*)"
_RISK_BENEFIT_OBJECTS = r"(?:risk|exposure|drawdown|loss(?:es)?|danger)"
_RISK_BENEFIT_PATTERNS = (
    rf"\b{_RISK_BENEFIT_VERBS}\s+(?:the\s+|your\s+|our\s+|entry\s+|trade\s+)*{_RISK_BENEFIT_OBJECTS}\b",
    r"\bsafer\b", r"\bmore\s+secure\b", r"\bprotects?\s+(?:you|us|the\s+trade|capital)\b",
    r"\bless\s+risky\b",
)
# What must appear, clause-attached, in the SOURCE for such a claim to stand.
_RISK_BENEFIT_SUPPORT = (
    rf"(?:{_RISK_BENEFIT_VERBS}|safer|less\s+risky|protect\w*|secure\w*|{_RISK_BENEFIT_OBJECTS})"
)

# Causal assertions. AR-1206 §2.1: the declared contract named causal claims and the
# first implementation did not check them. It does now.
_CAUSAL_PATTERNS = (
    r"\bcause[sd]?\b", r"\bcausing\b", r"\bbecause\b", r"\bleads?\s+to\b",
    r"\bled\s+to\b", r"\bresults?\s+in\b", r"\bresulting\s+in\b",
    r"\bdue\s+to\b", r"\btherefore\b", r"\bmakes?\s+it\b", r"\bdrives?\b",
)

# Clause separators. AR-1206 §2.2: support must bind to the PROPOSITION, so the unit
# of attachment is a clause, not the whole joined evidence window.
_CLAUSE_SPLIT = re.compile(r"[.!?;]|\b(?:but|however|although|whereas|while)\b")

_STOPWORDS = frozenset("""
a an the this that these those of to in on at for with by from as is are was were be been
being it its we you i he she they them our your their and or if then so not no do does did
can could will would should must have has had there here what which who when how why all
any some just going go get got me my us out up down over under into about
""".split())


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


def _content_words(text: str, exclude: frozenset[str] = frozenset()) -> set[str]:
    """Meaning-bearing tokens: what a clause is ABOUT."""
    toks = re.findall(r"[a-z0-9]+", text.lower())
    return {t for t in toks if len(t) >= 3 and t not in _STOPWORDS and t not in exclude}


def _clauses(text: str) -> list[str]:
    return [c.strip() for c in _CLAUSE_SPLIT.split(text) if c and c.strip()]


def _attached_support(
    quotes: list[str],
    marker_pattern: str,
    condition_topic: set[str],
) -> str | None:
    """Return the supporting marker ONLY if it sits in a clause that is about the same
    thing as the condition.

    AR-1206 §2.2 is the reason this exists: `stem in joined_quotes` let ANY occurrence
    anywhere in the evidence window silence a finding — `you're probably wondering`
    licensing `high-probability` on a trading rule. Support must attach to the
    proposition, so a clause qualifies only if it shares a content word with the
    condition (the condition's own marker tokens excluded, so a marker cannot license
    itself).

    Deliberately a cheap deterministic screen, not a semantic oracle: it can still be
    fooled by a same-topic clause, and it is documented as a screen for that reason.
    """
    for quote in quotes:
        for clause in _clauses(quote):
            if not re.search(marker_pattern, clause):
                continue
            if _content_words(clause) & condition_topic:
                return re.search(marker_pattern, clause).group(0)
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
    #    Support must be CLAUSE-ATTACHED (AR-1206 §2.2): a certainty verb about some
    #    other proposition may not suppress this finding.
    cond_cert = _has_certainty(cond)
    if cond_cert:
        cert_pattern = r"\b(?:" + "|".join(_CERTAINTY_STEMS) + r")\w*"
        topic = _content_words(cond, exclude=_content_words(cond_cert))
        if not _attached_support(quotes, cert_pattern, topic):
            hedge = _has_hedge(joined)
            if hedge:
                findings.append(FidelityFinding(
                    "CERTAINTY_INFLATION", cond_cert,
                    f"condition asserts {cond_cert!r}; the source offers no certainty "
                    f"attached to this proposition, only a hedge ({hedge!r})",
                ))
            else:
                # AR-1239 §3.1. THE GAP THIS CLOSES, MEASURED: with no hedge in the source the
                # old code emitted NOTHING, so a condition asserting certainty against a source
                # that is simply SILENT passed clean. That is how "confirms the FVG structure"
                # survived every gate.
                #
                # 🛑 IT IS A SEPARATE, WEAKER VERDICT ON PURPOSE. `CERTAINTY_INFLATION` means the
                # source actively hedged and the condition overrode it. This means the source said
                # nothing either way. Collapsing them would let silence borrow the authority of a
                # contradiction — and §3.1 explicitly forbids labelling source silence as
                # CERTAINTY_INFLATION.
                findings.append(FidelityFinding(
                    "UNSUPPORTED_CERTAINTY", cond_cert,
                    f"condition asserts {cond_cert!r}; the source span carries no support for "
                    "that certainty attached to this proposition. UNSUPPORTED, NOT DISPROVEN — "
                    "the source is silent here, which is not evidence of the opposite",
                ))

    # 2. MODIFIER — probability/quality claim with no CLAUSE-ATTACHED support.
    for pattern, stem in _MODIFIER_CLAIMS:
        m = re.search(pattern, cond)
        if not m:
            continue
        topic = _content_words(cond, exclude=_content_words(m.group(0)))
        if not _attached_support(quotes, stem, topic):
            findings.append(FidelityFinding(
                "UNSUPPORTED_MODIFIER", m.group(0),
                f"condition claims {m.group(0)!r}; no {stem!r} support attached to this "
                "proposition in the source span",
            ))

    # 5. CAUSAL — condition asserts causation the source never states (AR-1206 §2.1).
    cond_causal = next((m.group(0) for p in _CAUSAL_PATTERNS
                        for m in [re.search(p, cond)] if m), None)
    if cond_causal:
        causal_any = r"(?:" + "|".join(_CAUSAL_PATTERNS) + r")"
        topic = _content_words(cond, exclude=_content_words(cond_causal))
        if not _attached_support(quotes, causal_any, topic):
            findings.append(FidelityFinding(
                "CAUSAL_INFLATION", cond_causal,
                f"condition asserts causation ({cond_causal!r}); the source states no "
                "causal relation attached to this proposition",
            ))

    # 5b. RISK / BENEFIT — condition claims the action reduces risk (AR-1239 §3.1).
    cond_risk = next((m.group(0) for p in _RISK_BENEFIT_PATTERNS
                      for m in [re.search(p, cond)] if m), None)
    if cond_risk:
        topic = _content_words(cond, exclude=_content_words(cond_risk))
        if not _attached_support(quotes, _RISK_BENEFIT_SUPPORT, topic):
            findings.append(FidelityFinding(
                "UNSUPPORTED_RISK_BENEFIT", cond_risk,
                f"condition claims a risk/safety benefit ({cond_risk!r}); the source span "
                "carries no support for that benefit attached to this proposition. "
                "UNSUPPORTED, NOT DISPROVEN — the source may simply not discuss it",
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
