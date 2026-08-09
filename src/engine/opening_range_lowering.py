"""B1 STEP 6A — lowering a frozen extraction record into a typed OPENING RANGE.

AUTHORITY: R-738 §5 (the lowering must consume ONLY explicit source evidence),
R-740 §4 (the refusal contract), §5 (exactly two outcomes), §6-2 (market scope
verbatim), §6-3 (read the COMMITTED provenance path), §7.

TWO OUTCOMES AND NOTHING BETWEEN THEM
-------------------------------------
`READY`             a complete `OpeningRangeDefinition`; expansion permitted.
`SOURCE_INCOMPLETE` no definition at all; the missing fields are named, the
                    evidence that WAS found is recorded, and expansion is
                    FORBIDDEN.

There is deliberately no third shape — no definition carrying a placeholder, an
empty string or an inferred trading-day rule.

    `A CONSTRAINT THE TYPE SYSTEM ENFORCES IS NOT A CONSTRAINT ANYONE HAS TO
     REMEMBER.`  (R-740 §5)

WHAT MAY NOT BE INFERRED (R-740 §4, verbatim prohibition)
---------------------------------------------------------
No value may be recovered from: the phrase "market open" · a session-start
anchor · the word "first" · ANOTHER SPEC'S RECORD · common opening-range
practice · engine calendar-date behaviour · futures or equity session
conventions.

    `THOSE MAY MAKE DAILY RESET SEEM OBVIOUS. THEY DO NOT MAKE IT SOURCE-TAUGHT.`
    `A CLEARER TEACHER DOES NOT RESOLVE A DIFFERENT TEACHER'S SILENCE.`

Every locator below therefore reads ONE record and returns the VERBATIM span it
matched, or nothing. A locator that finds no span makes its field missing; it
never substitutes. The failure direction is refusal, which is the safe one:
a weak locator produces a REPORTABLE false refusal, never a fabricated value.

NO SPEC OR VIDEO ID APPEARS ANYWHERE IN THIS MODULE
---------------------------------------------------
R-738 §9. The rules are general; identities arrive as DATA. That is also what
makes the two frozen members discriminating evidence rather than a lookup: one
record satisfies these rules and the other does not, and this module cannot tell
which is which by name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)

COMMITTED_PROVENANCE_DIR: str = "docs/replay-results/h1-battery/tier-a-extraction-provenance"
"""R-740 §6-3. The frozen census names a temp scratchpad belonging to a dead
session; this committed directory is `sha256`-identical for both frozen members,
and the hash equality is what licenses the substitution — not a guess."""

REASON_TRADING_DAY_RULE_MISSING: str = "opening_range_trading_day_rule_missing_from_source"

REQUIRED_SOURCE_FIELDS: tuple[str, ...] = (
    "session_start_local",
    "source_timezone",
    "variants",
    "construction_meaning",
    "market_scope",
    "trading_day_rule",
)
"""The six source-owned facts R-738 §5 requires. Enumerated as a constant so a
refusal can report against a NAMED population rather than an implicit one."""


class OpeningRangeLoweringDisposition(StrEnum):
    READY = "READY"
    SOURCE_INCOMPLETE = "SOURCE_INCOMPLETE"


# ── bounded, auditable text locators ─────────────────────────────────────────

_SPELLED_MINUTES: dict[str, int] = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fifteen": 15,
    "twenty": 20, "thirty": 30, "sixty": 60,
}
"""DELIBERATELY BOUNDED. An unlisted spelled number does not match, so the
field goes MISSING and the lowering REFUSES — which is reportable. Extending
this map to "cover more cases" would trade a visible refusal for a silent guess."""

_DURATION_RE = re.compile(
    r"\b(?:(\d{1,3})|(" + "|".join(_SPELLED_MINUTES) + r"))[\s‐-―-]*minute\b",
    re.IGNORECASE,
)
_CLOCK_RE = re.compile(r"\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?", re.IGNORECASE)

_ZONE_TOKENS: tuple[tuple[str, str], ...] = (
    ("new york", "America/New_York"),
    ("eastern", "America/New_York"),
    ("pacific", "America/Los_Angeles"),
    ("central", "America/Chicago"),
    ("mountain", "America/Denver"),
    ("london", "Europe/London"),
)
"""IANA zones only — never a fixed UTC offset, which is wrong for half the year
and silently so. Bounded for the same reason as `_SPELLED_MINUTES`."""

_CONSTRUCTION_RE = re.compile(
    r"\bhigh\b.{0,80}?\blow\b|\blow\b.{0,80}?\bhigh\b", re.IGNORECASE | re.DOTALL
)
_TRADING_DAY_RE = re.compile(
    r"\b(?:every\s+(?:single\s+)?trading\s+day|each\s+trading\s+day|every\s+day"
    r"|each\s+day|daily\s+reset|resets?\s+(?:each|every)\s+(?:day|session))\b",
    re.IGNORECASE,
)


def _duration_minutes(text: str) -> int | None:
    match = _DURATION_RE.search(text)
    if match is None:
        return None
    if match.group(1) is not None:
        return int(match.group(1))
    return _SPELLED_MINUTES[match.group(2).lower()]


def _timezone_in(text: str) -> tuple[str, ...]:
    """Every DISTINCT IANA zone named in one span. Returns all of them, because
    two different zones in the same span is CONTRADICTORY evidence, and the
    caller must be able to see that rather than receive the first hit."""
    found: list[str] = []
    lowered = text.lower()
    for token, zone in _ZONE_TOKENS:
        if token in lowered and zone not in found:
            found.append(zone)
    return tuple(found)


def _clock(text: str) -> str | None:
    match = _CLOCK_RE.search(text)
    if match is None:
        return None
    hour, minute = int(match.group(1)), match.group(2)
    meridiem = (match.group(3) or "").lower().replace(".", "")
    if meridiem == "pm" and hour != 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute}"


# ── the record's taught spans, in one place ──────────────────────────────────


def _taught_spans(strategy: dict) -> tuple[str, ...]:
    """Every verbatim taught sentence in the strategy, in record order.

    Reads the entry sequence and the confluences. Stops, targets and the
    strategy name are deliberately excluded: they are framework-owned risk
    surfaces, and the opening-range definition may not be lowered from them.
    """
    spans: list[str] = []
    for step in strategy.get("entry_sequence") or ():
        text = step.get("action")
        if text:
            spans.append(text)
    for item in strategy.get("confluences") or ():
        text = item.get("description")
        if text:
            spans.append(text)
    return tuple(spans)


def _taught_variants(strategy: dict) -> tuple[tuple[OpeningRangeVariant, str], ...]:
    """The taught alternatives, each with the verbatim span it came from.

    TWO SHAPES, both real and both present in the frozen population:
      1. a STRUCTURED `variants` array carrying `variant_label` + `description`;
      2. a SINGLE window stated inline in a range-construction sentence.

    Shape 2 exists because a teacher who offers exactly one window has no
    alternatives to enumerate. Refusing shape 2 would report a teacher's
    completeness as incompleteness — a false refusal is still a wrong answer.
    """
    structured = strategy.get("variants")
    if structured:
        out: list[tuple[OpeningRangeVariant, str]] = []
        for entry in structured:
            label = entry.get("variant_label")
            span = entry.get("description") or ""
            minutes = _duration_minutes(label or "") or _duration_minutes(span)
            if label is None or minutes is None:
                continue
            out.append(
                (
                    OpeningRangeVariant(
                        variant_label=label, duration_minutes=minutes, source_quote=span
                    ),
                    span,
                )
            )
        return tuple(out)

    for span in _taught_spans(strategy):
        if not _CONSTRUCTION_RE.search(span):
            continue
        minutes = _duration_minutes(span)
        if minutes is None:
            continue
        return (
            (
                OpeningRangeVariant(
                    variant_label=f"{minutes}-minute opening range",
                    duration_minutes=minutes,
                    source_quote=span,
                ),
                span,
            ),
        )
    return ()


# ── the refusal and result contracts (R-740 §4/§5) ───────────────────────────


@dataclass(frozen=True)
class OpeningRangeSourceRefusal:
    """An EXACT, evidence-backed statement that the teacher's source is
    incomplete for faithful multi-session execution.

    R-740 §4 forbids classifying this as an extraction failure, a vocabulary
    failure, a missing engine primitive or a parameter-schema mismatch. It is
    none of those: the reader read correctly and the teacher did not say.

    `positive_control` is the field that makes this trustworthy rather than
    merely negative:
        `A REFUSAL THAT DOES NOT CARRY ITS OWN POSITIVE CONTROL IS
         INDISTINGUISHABLE FROM A BROKEN READER.`
    """

    source_spec_id: str
    source_condition_id: str
    missing_fields: tuple[str, ...]
    internal_reason: str
    evidence_found: tuple[tuple[str, str], ...]
    positive_control: str
    extraction_dropped_no_source_statement: bool

    def __post_init__(self) -> None:
        if not self.missing_fields:
            raise ValueError(
                "a SOURCE_INCOMPLETE refusal must name at least one missing field; "
                "an unnamed refusal is indistinguishable from a crash"
            )
        unknown = [f for f in self.missing_fields if f not in REQUIRED_SOURCE_FIELDS]
        if unknown:
            raise ValueError(
                f"refusal names fields outside the required population: {unknown}; "
                f"the population is {list(REQUIRED_SOURCE_FIELDS)}"
            )
        if not self.positive_control:
            raise ValueError(
                "a refusal must carry a positive control proving the locator CAN "
                "detect the missing field elsewhere, or it cannot be told apart "
                "from a broken reader"
            )


@dataclass(frozen=True)
class OpeningRangeLoweringResult:
    disposition: OpeningRangeLoweringDisposition
    source_spec_id: str
    source_condition_id: str
    definition: OpeningRangeDefinition | None = None
    refusal: OpeningRangeSourceRefusal | None = None

    def __post_init__(self) -> None:
        ready = self.disposition is OpeningRangeLoweringDisposition.READY
        if ready and (self.definition is None or self.refusal is not None):
            raise ValueError("READY must carry a definition and no refusal")
        if not ready and (self.refusal is None or self.definition is not None):
            raise ValueError("SOURCE_INCOMPLETE must carry a refusal and NO definition")


def lower_opening_range_definition(
    source_spec_id: str,
    source_condition_id: str,
    record: dict,
    *,
    positive_control: str,
) -> OpeningRangeLoweringResult:
    """Lower ONE frozen extraction record into a definition, or refuse exactly.

    `positive_control` is REQUIRED, not optional: it is the caller's statement of
    how it knows the locators can detect a field that this record lacks. Making
    it a mandatory argument means a refusal cannot be produced without one.
    """
    strategies = record.get("strategies") or ()
    strategy = strategies[0] if strategies else {}
    classification = record.get("instrument_classification") or {}
    spans = _taught_spans(strategy)

    found: dict[str, tuple[str, str]] = {}

    variants = _taught_variants(strategy)
    if variants:
        found["variants"] = (
            ", ".join(f"{v.variant_label}={v.duration_minutes}m" for v, _ in variants),
            " | ".join(span for _, span in variants),
        )

    # Session start and timezone must come from the SAME span. A zone named in
    # a different sentence describes a different thing — the golden record says
    # "9:30 a.m. Eastern" in its window sentence and "the Pacific Standard chart"
    # in its breakout sentence, and those are the chart and the clock, not two
    # answers to one question.
    anchor_spans = [span for _, span in variants]
    anchor = classification.get("market_open_anchor")
    if anchor:
        anchor_spans.append(anchor)
    anchor_spans.extend(spans)
    for span in anchor_spans:
        clock = _clock(span)
        zones = _timezone_in(span)
        if clock is not None and len(zones) == 1:
            found.setdefault("session_start_local", (clock, span))
            found.setdefault("source_timezone", (zones[0], span))
            break
        if clock is not None:
            found.setdefault("session_start_local", (clock, span))

    for span in spans:
        if _CONSTRUCTION_RE.search(span):
            found.setdefault("construction_meaning", (span, span))
            break

    if classification:
        # Rendered VERBATIM and in full, never compressed to a tidier label.
        # R-740 §6-2: one frozen member's demonstrated scope is genuinely
        # multi-asset on a New-York-open anchor, and flattening that to
        # "US equities" would be a fidelity claim nobody audits.
        rendered = "; ".join(
            f"{key}: {', '.join(str(v) for v in value) if isinstance(value, list) else value}"
            for key, value in sorted(classification.items())
            if value
        )
        if rendered:
            found.setdefault("market_scope", (rendered, rendered))

    for span in spans:
        match = _TRADING_DAY_RE.search(span)
        if match:
            found.setdefault("trading_day_rule", (span, span))
            break

    missing = tuple(field for field in REQUIRED_SOURCE_FIELDS if field not in found)
    if missing:
        reason = (
            REASON_TRADING_DAY_RULE_MISSING
            if missing == ("trading_day_rule",)
            else "opening_range_source_fields_missing:" + ",".join(missing)
        )
        return OpeningRangeLoweringResult(
            disposition=OpeningRangeLoweringDisposition.SOURCE_INCOMPLETE,
            source_spec_id=source_spec_id,
            source_condition_id=source_condition_id,
            refusal=OpeningRangeSourceRefusal(
                source_spec_id=source_spec_id,
                source_condition_id=source_condition_id,
                missing_fields=missing,
                internal_reason=reason,
                evidence_found=tuple(
                    (field, span) for field, (_value, span) in sorted(found.items())
                ),
                positive_control=positive_control,
                extraction_dropped_no_source_statement=True,
            ),
        )

    definition = OpeningRangeDefinition(
        session_start_local=found["session_start_local"][0],
        source_timezone=found["source_timezone"][0],
        variants=tuple(v for v, _ in variants),
        market_scope=found["market_scope"][0],
        trading_day_rule=found["trading_day_rule"][0],
        provenance=OpeningRangeProvenance(
            source_quote=found["construction_meaning"][0],
            condition_id=source_condition_id,
        ),
    )
    return OpeningRangeLoweringResult(
        disposition=OpeningRangeLoweringDisposition.READY,
        source_spec_id=source_spec_id,
        source_condition_id=source_condition_id,
        definition=definition,
    )
