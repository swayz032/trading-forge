"""H1 Tier-1 deterministic gradient detectors.

Implements the three detector families from the frozen spec
(docs/designs/h1-tier1-detector-spec-2026-07-12.md):

  - imperative          (§1.0, proven family, recap)
  - conditional-action  (§1.1, type specimen N04)
  - exclusion-contrast  (§1.2, type specimen N34)

High-precision / low-recall BY DESIGN (spec §2). An ambiguous match is a
NON-match (SILENT) and falls through to tier-2 -- tier-1 never guesses the
ambiguous middle. The two Wave-1 ambiguity classes
(walkthrough-narration-that-restates-a-gate; bias-vs-movement-expectation,
docs/designs/h1-wave1-shakedown-RESULT-2026-07-12.md Output 2) are the
fall-through surface: tier-1's surface-only patterns do not attempt them by
construction, so they route onward untouched (resolves §6 WAVE-1-FEED [D] in
the "no pre-adjust" direction -- Wave-1 confirms the boundary).

DESIGN discipline (spec §4.1): all vocabularies below were characterized from
the 143-condition rules-design set ONLY (docs/replay-results/
corpus-v3-heldout-split-2026-07-05.json rules_design_keys), never from the
type specimens. The specimens are BIRTH FIXTURES, not design inputs.

Confidence semantics (spec §5.2, §6 WAVE-1-FEED [B]): tier-1 confidence is NOT
a recall dial. A deterministic pattern match with all guards satisfied is a
binary high-confidence fire (confidence == 1.0); anything short of that is a
non-match -> fall-through. The numeric high-confidence FLOOR is a Wave-1-gated
parameter and is intentionally left UNSET here (there is no graded-confidence
path to gate) -- see `confidence_floor` on run_tier1.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Output contract (spec §5.2 / pre-reg §4 certificate schema)
# --------------------------------------------------------------------------- #

SURFACE_CLASSES = ("imperative", "conditional-action", "exclusion-contrast")

# Detector precedence: most-specific first. A higher-precedence fire suppresses
# a lower-precedence fire whose span is CONTAINED within it (the exclusion-
# contrast pattern subsumes the conditional-action "on <trigger>" match, so N34
# fires as ONE exclusion-contrast rather than tripping the §2 overlap-ambiguity
# rule). Genuine partial (non-contained) cross-class overlap -> BOTH dropped
# to fall-through (spec §2 ambiguity).
_PRECEDENCE = {"exclusion-contrast": 0, "conditional-action": 1, "imperative": 2}


@dataclass
class Tier1Detection:
    """A single fired detection (spec §5.2). Maps directly into the cert
    schema's per-condition entry (surface_class / classifying_tier /
    quote_anchor / char_span)."""

    surface_class: str
    quote_anchor: str
    char_span: Tuple[int, int]
    classifying_tier: int = 1
    confidence: float = 1.0

    def as_cert_fields(self) -> dict:
        return {
            "surface_class": self.surface_class,
            "classifying_tier": self.classifying_tier,
            "quote_anchor": self.quote_anchor,
            "char_span": [self.char_span[0], self.char_span[1]],
            "confidence": self.confidence,
        }


@dataclass
class Tier1FallThrough:
    """Emitted for a span on which NO tier-1 detector fires (spec §5.2).
    Routed to tier-2 for discourse-aware adjudication. Fall-through is the
    DEFAULT, not an error state (spec §2)."""

    char_span: Tuple[int, int]
    surface_class: str = "cannot-determine-at-tier-1"
    classifying_tier: Optional[int] = None


@dataclass
class Tier1Result:
    segment_text: str
    detections: List[Tier1Detection] = field(default_factory=list)
    fallthrough: Optional[Tier1FallThrough] = None

    @property
    def fired(self) -> bool:
        return len(self.detections) > 0


# --------------------------------------------------------------------------- #
# Vocabulary (seeds characterized from the 143 design set -- spec §4.1)
# --------------------------------------------------------------------------- #

# Unambiguous directive / entry verbs. Multi-word forms first so the alternation
# is greedy on them.
_DIRECTIVE_VERB = (
    r"(?:go\s+long|go\s+short|get\s+long|get\s+short|get\s+in|get\s+out|"
    r"sell\s+off|scale\s+in|scale\s+out|buy|sell|enter|entry|exit|fade|close)"
)

# Ambiguous verbs that only count as an ACTION when bound to a concrete trade
# object. Design evidence: "If the setups aren't ... we need to take a step
# back" (CONTEXTUAL) must stay SILENT -- "take a step back" is not a directive.
_TAKE_VERB = r"(?:take|add|grab|scale)"
_TRADE_OBJECT = (
    r"(?:puts?|calls?|profits?|positions?|shares?|contracts?|partials?|"
    r"a\s+position|the\s+position|the\s+trade|the\s+entry|the\s+setup|"
    r"the\s+short|the\s+long|the\s+order)"
)

# Trigger connectives (spec §1.1 seed). "then" alone is NOT a connective.
_CONNECTIVE = r"(?:when|if|once|after|as\s+soon\s+as|upon|the\s+moment)"

# A concrete market-condition noun the "on" connective must bind to (keeps the
# very common "on" out of "based on" / "on the chart" / "on a trending day").
_TRIGGER_NOUN = (
    r"(?:re-?test|test|tap|touch|break(?:out|down)?|close|cross(?:over)?|"
    r"pull\s?back|retrace(?:ment)?|bounce|sweep|mitigation|fill|reclaim|"
    r"tag|hold|rejection)"
)

# Intent-verb narration guard (conditional-action only). Design evidence: the
# full-context N04 sentence "We look to buy from the demand zone when it is
# retested because we expect ..." is DRI-CONTEXTUAL -> the intent construction
# "look to buy" must suppress the fire, even though a "when" clause follows.
_INTENT_VERB = (
    r"(?:look(?:ing)?|want(?:ing)?|wait(?:ing)?|hop(?:e|ing)|plan(?:ning)?|"
    r"tr(?:y|ying)|aim(?:ing)?|wish(?:ing)?|prefer(?:ring)?|expect(?:ing)?|"
    r"hoping|thinking)"
)

# Forecast / probabilistic trigger guard (spec §1.1: a conditional whose trigger
# is a FORECAST falls through -- the canonical N17 "prys waarskynlik sal
# terugtrek" case).
_FORECAST = (
    r"(?:probably|likely|perhaps|maybe|waarskynlik|tends?\s+to|"
    r"usually|typically|often|should\s+probably)"
)

# Exclusion-contrast markers (spec §1.2 seed).
_CONTRAST_MARKER = (
    r"(?:,\s*not\b|\bnot\s+on\b|\bnot\s+at\b|\brather\s+than\b|\binstead\s+of\b|"
    r"\bnever\s+on\b|\bnever\s+at\b|\band\s+not\b|\bbut\s+not\b|,?\s*\bNOT\b)"
)

# Trigger-object head noun for the exclusion-contrast poles: at least one pole
# must be a genuine trigger noun-phrase (prep + object OR contains a trigger
# noun) so "expect a lot of noise, not always clean moves" (CONTEXTUAL) and
# "they do not look at what the higher time frame is doing" stay SILENT.
_TRIGGER_PREP = r"(?:on|at|from|into|above|below|near|off\s+of|off)"

# --------------------------------------------------------------------------- #
# Compiled patterns
# --------------------------------------------------------------------------- #

_RE_ACTION_RAW = re.compile(
    rf"\b(?:{_DIRECTIVE_VERB}|{_TAKE_VERB}\s+(?:\w+\s+){{0,2}}?{_TRADE_OBJECT})\b",
    re.IGNORECASE,
)
# REMOVED 2026-07-12 (independent grader HOLD): the _NOMINAL_ARTICLE "get an entry"
# guard had ZERO effect on the 143 design set (its two cited design exemplars never
# fire either way) and its ONLY measurable effect was suppressing one held-out
# false-fire ("if you didn't get an entry over here...", a phrase present only in the
# held-out partition). That is a held-out-tuned edit, which the pre-reg (§4.3) forbids
# regardless of claimed motivation. The guard is stripped; "get an entry" narration now
# honestly false-fires as the walkthrough-narration tier-2 fall-through class it is.
# If the nominal-vs-directive distinction is genuinely needed it must be justified by
# a DESIGN-set exemplar, never by held-out observation.


class _ActionMatch:
    __slots__ = ("_s", "_e", "_g")

    def __init__(self, s: int, e: int, g: str):
        self._s, self._e, self._g = s, e, g

    def start(self) -> int:
        return self._s

    def end(self) -> int:
        return self._e

    def group(self, *_a):
        return self._g


class _ActionRe:
    """Wrapper over _RE_ACTION_RAW. (The held-out-tuned nominal-'entry'/'exit'
    guard was removed 2026-07-12 per independent grader; see comment above.)"""

    def finditer(self, text: str):
        out = []
        for m in _RE_ACTION_RAW.finditer(text):
            out.append(_ActionMatch(m.start(), m.end(), m.group(0)))
        return out

    def search(self, text: str):
        it = self.finditer(text)
        return it[0] if it else None


_RE_ACTION = _ActionRe()
# A bare take-family verb (used only to reject "take a step back": a take verb
# with NO trade object nearby is not an action).
_RE_TAKE_BARE = re.compile(rf"\b{_TAKE_VERB}\b", re.IGNORECASE)
_RE_TAKE_WITH_OBJ = re.compile(
    rf"\b{_TAKE_VERB}\s+(?:\w+\s+){{0,2}}?{_TRADE_OBJECT}\b", re.IGNORECASE
)

_RE_CONNECTIVE = re.compile(rf"\b{_CONNECTIVE}\b", re.IGNORECASE)
_RE_ON_TRIGGER = re.compile(
    rf"\bon\s+(?:the\s+|a\s+|an\s+)?(?:\w+\s+){{0,3}}?{_TRIGGER_NOUN}\b",
    re.IGNORECASE,
)
_RE_CONTRAST = re.compile(_CONTRAST_MARKER)
_RE_TRIGGER_NOUN = re.compile(rf"\b{_TRIGGER_NOUN}\b", re.IGNORECASE)
_RE_TRIGGER_PREP_OBJ = re.compile(
    rf"\b{_TRIGGER_PREP}\s+(?:the\s+|a\s+|an\s+)?\w+", re.IGNORECASE
)

# Clause-initial bare imperative (subject elided, command mood). Allow an
# optional leading negative/adverb ("don't", "never", "always").
_RE_IMPERATIVE = re.compile(
    rf"(?:^|[.;!?]\s+|,\s+)"
    rf"(?P<neg>(?:do\s+not|don['’]?t|never|always)\s+)?"
    rf"(?P<verb>{_DIRECTIVE_VERB}|wait\s+for|avoid|set\s+your\s+stop|"
    rf"place\s+your\s+stop|{_TAKE_VERB}\s+(?:\w+\s+){{0,2}}?{_TRADE_OBJECT})\b",
    re.IGNORECASE,
)

# A subject / modal / intent immediately before a position -> the clause is NOT
# a bare imperative (it is narration or an intent statement).
_RE_SUBJECT_LEAD = re.compile(
    r"(?:\b(?:i|you|we|they|he|she|it|price|the\s+\w+|"
    rf"my|our|your)\b[^.;!?]{{0,30}}?$)|(?:\b{_INTENT_VERB}\b[^.;!?]{{0,20}}?$)",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
# Guard helpers
# --------------------------------------------------------------------------- #


def _clause_bounds(text: str, pos: int) -> Tuple[int, int]:
    """Return [start, end) of the clause containing char offset `pos`, split on
    strong sentence punctuation."""
    start = 0
    for m in re.finditer(r"[.;!?]\s+", text):
        if m.end() <= pos:
            start = m.end()
        else:
            break
    end = len(text)
    m = re.search(r"[.;!?]", text[pos:])
    if m:
        end = pos + m.start() + 1
    return start, end


def _intent_governs_action(text: str, action_start: int) -> bool:
    """True if the action verb at `action_start` is grammatically governed by an
    intent verb ('looking to buy', 'want to enter', 'looking for a X to buy',
    'we're waiting for price ... to take'). This is the conditional-action
    narration guard (spec §1.1 boundary; N06/N28 + the full-context N04)."""
    cl_start, _ = _clause_bounds(text, action_start)
    pre = text[cl_start:action_start]
    # intent ... to (then) <action>   OR   intent ... <action>-ing complement
    if re.search(rf"\b{_INTENT_VERB}\b[^.;!?]*?\bto\b\s+(?:then\s+)?$", pre, re.I):
        return True
    # "looking for a <obj> to (then) buy" -- the action is the infinitival goal.
    if re.search(rf"\b{_INTENT_VERB}\s+for\b[^.;!?]*?\bto\b\s+(?:then\s+)?$", pre, re.I):
        return True
    # past-tense intent narration: "what I was looking for", "we had entered".
    if re.search(r"\b(?:i|we|you|they|he|she)\b\s+(?:was|were|had)\b[^.;!?]*?$", pre, re.I):
        return True
    return False


def _forecast_trigger(trigger_text: str) -> bool:
    """True if the trigger clause is a forecast/probabilistic expectation (spec
    §1.1: falls through to tier-2, does not fire tier-1)."""
    return bool(re.search(_FORECAST, trigger_text, re.I))


# --------------------------------------------------------------------------- #
# Detector: exclusion-contrast (spec §1.2) -- highest precedence
# --------------------------------------------------------------------------- #


def _detect_exclusion_contrast(text: str) -> Optional[Tuple[str, int, int]]:
    """Fire on an explicit negative contrast between two comparable trigger
    conditions. The contrast is load-bearing; strip it and N34 collapses to
    N06's narration class (spec §1.2). The contrast OVERRIDES the intent-verb
    guard -- narration cannot produce a clean negative contrast."""
    for m in _RE_CONTRAST.finditer(text):
        marker_start = m.start()
        # Positive pole = text before the marker within the clause.
        cl_start, cl_end = _clause_bounds(text, marker_start)
        positive_pole = text[cl_start:marker_start]
        rejected_pole = text[m.end():cl_end]

        # The positive pole must be a genuine trigger context: a directive
        # action, OR a trigger prep+object, OR a trigger noun. Guards against
        # "expect a lot of noise, not always clean moves" (no trigger context).
        pos_is_trigger = bool(
            _RE_ACTION.search(positive_pole)
            or _RE_TRIGGER_PREP_OBJ.search(positive_pole)
            or _RE_TRIGGER_NOUN.search(positive_pole)
        )
        # The rejected pole must ALSO be a comparable trigger object (prep+obj
        # or a trigger noun) -- two comparable trigger objects in opposition.
        # Guards against "do not look at what the higher time frame is doing"
        # and single-sided negations with no rejected trigger object.
        rej_is_trigger = bool(
            _RE_TRIGGER_PREP_OBJ.search(rejected_pole)
            or _RE_TRIGGER_NOUN.search(rejected_pole)
        )
        # Reject negated-state / mere-negation: "not sure", "not always",
        # "not going to", "not look".
        rej_head = rejected_pole.lstrip()
        if re.match(
            r"(?:sure|always|going\s+to|really|look\b|looking\b|that\b|"
            r"a\s+lot\b|much\b|too\b|very\b|clean\b)",
            rej_head,
            re.I,
        ):
            # Still allow if a trigger noun/prep-obj clearly follows shortly.
            if not (
                _RE_TRIGGER_PREP_OBJ.search(rej_head[:40])
                or _RE_TRIGGER_NOUN.search(rej_head[:40])
            ):
                rej_is_trigger = False

        if pos_is_trigger and rej_is_trigger:
            # Anchor = the discrimination: from the positive trigger context
            # through the rejected pole (verbatim substring of `text`).
            anchor_start = _pole_anchor_start(positive_pole, cl_start)
            anchor_end = _pole_anchor_end(rejected_pole, m.end(), cl_end)
            return (text[anchor_start:anchor_end], anchor_start, anchor_end)
    return None


def _pole_anchor_start(positive_pole: str, cl_start: int) -> int:
    """Start the anchor at the action or trigger-prep in the positive pole so
    the anchor captures the discrimination, not leading filler."""
    m = _RE_ACTION.search(positive_pole) or _RE_TRIGGER_PREP_OBJ.search(positive_pole)
    if m:
        return cl_start + m.start()
    m = _RE_TRIGGER_NOUN.search(positive_pole)
    if m:
        # back up to a preposition if one immediately precedes the noun
        return cl_start + m.start()
    return cl_start + len(positive_pole) - len(positive_pole.lstrip())


def _pole_anchor_end(rejected_pole: str, rej_abs_start: int, cl_end: int) -> int:
    """End the anchor at the end of the rejected trigger noun-phrase."""
    m = None
    for mm in _RE_TRIGGER_NOUN.finditer(rejected_pole):
        m = mm
    if m:
        return rej_abs_start + m.end()
    return cl_end


# --------------------------------------------------------------------------- #
# Detector: conditional-action (spec §1.1)
# --------------------------------------------------------------------------- #


def _detect_conditional_action(text: str) -> Optional[Tuple[str, int, int]]:
    """Fire on a directive/entry action syntactically bound to a trigger clause
    ("ACTION when/if/on TRIGGER" or the mirror). Guards: intent-narration
    (SILENT), forecast trigger (SILENT), exclusion-contrast present (defer).
    Type specimen N04."""
    actions = list(_RE_ACTION.finditer(text))
    if not actions:
        return None

    # If an exclusion-contrast binds the trigger, defer to that detector so the
    # two never overlap (keeps the §2 tie rule from nuking N34).
    contrast = _detect_exclusion_contrast(text)

    connectives = [(m.start(), m.end(), m) for m in _RE_CONNECTIVE.finditer(text)]
    on_triggers = [(m.start(), m.end(), m) for m in _RE_ON_TRIGGER.finditer(text)]

    for am in actions:
        a_start, a_end = am.start(), am.end()
        if _intent_governs_action(text, a_start):
            continue  # narration -> SILENT (N06, full-context N04)

        cl_start, cl_end = _clause_bounds(text, a_start)

        # Candidate connective bindings within the SAME clause.
        candidates = []
        for c_start, c_end, cm in connectives:
            if cl_start <= c_start < cl_end:
                candidates.append((c_start, c_end, "word"))
        for o_start, o_end, om in on_triggers:
            if cl_start <= o_start < cl_end:
                candidates.append((o_start, o_end, "on"))
        if not candidates:
            continue

        for c_start, c_end, kind in candidates:
            # Trigger clause text (what the connective introduces).
            trig_text = text[c_end:cl_end]
            if kind == "word" and not trig_text.strip():
                continue
            if _forecast_trigger(text[c_start:cl_end]):
                continue  # forecast trigger -> tier-2

            # Anchor = the connective through the trigger phrase (the gate).
            anchor_start = c_start
            if kind == "on":
                anchor_end = c_end  # _RE_ON_TRIGGER already spans "on <..> noun"
            else:
                # extend to the next trigger noun or a short bound, verbatim.
                tn = None
                for mm in _RE_TRIGGER_NOUN.finditer(text[c_end:cl_end]):
                    tn = mm
                    break
                if tn is not None:
                    anchor_end = c_end + tn.end()
                else:
                    # take the trigger clause up to a comma or ~60 chars
                    seg = text[c_end:cl_end]
                    stop = seg.find(",")
                    stop = len(seg) if stop == -1 else stop
                    anchor_end = c_end + min(stop, 60)
                    anchor_end = min(anchor_end, cl_end)

            # Defer if this fire would sit inside the exclusion-contrast span.
            if contrast is not None:
                cs, ce = contrast[1], contrast[2]
                if not (anchor_end <= cs or anchor_start >= ce):
                    return None  # overlaps a contrast -> exclusion-contrast owns it

            anchor = text[anchor_start:anchor_end].strip()
            # recompute exact span after strip
            lead = len(text[anchor_start:anchor_end]) - len(
                text[anchor_start:anchor_end].lstrip()
            )
            anchor_start += lead
            anchor_end = anchor_start + len(anchor)
            if anchor:
                return (anchor, anchor_start, anchor_end)
    return None


# --------------------------------------------------------------------------- #
# Detector: imperative (spec §1.0)
# --------------------------------------------------------------------------- #


def _detect_imperative(text: str) -> Optional[Tuple[str, int, int]]:
    """Fire on a bare directive verb in command mood (subject elided). A report
    of a past/hypothetical action ('I bought there', 'you could buy') is NOT
    imperative (spec §1.0)."""
    for m in _RE_IMPERATIVE.finditer(text):
        verb_start = m.start("verb")
        # Text preceding this clause's verb must not be a subject/intent lead.
        cl_start, cl_end = _clause_bounds(text, verb_start)
        pre = text[cl_start:verb_start]
        # The imperative must be clause-initial: only whitespace / the optional
        # negative between clause start and the verb (the neg group is captured
        # right before the verb). Anything else (a subject, a modal, an intent)
        # disqualifies.
        lead = pre.strip()
        neg = m.group("neg")
        if neg:
            lead = lead[: len(lead) - len(neg.strip())].strip() if lead.endswith(
                neg.strip()
            ) else lead
        if lead:  # something real precedes the verb -> not a bare imperative
            continue
        # take-family verbs still require a trade object (handled by the regex
        # alternative); directive verbs are inherently directional.
        verb_end = m.end("verb")
        # Extend the anchor to the end of the imperative clause phrase (verb +
        # object up to a comma or clause end, capped for a tight anchor).
        seg = text[verb_start:cl_end]
        stop = seg.find(",")
        stop = len(seg) if stop == -1 else stop
        anchor_end = verb_start + min(stop, 70)
        anchor_start = m.start("neg") if neg else verb_start
        anchor = text[anchor_start:anchor_end].strip()
        anchor_start += len(text[anchor_start:anchor_end]) - len(
            text[anchor_start:anchor_end].lstrip()
        )
        anchor_end = anchor_start + len(anchor)
        if anchor:
            return (anchor, anchor_start, anchor_end)
    return None


# --------------------------------------------------------------------------- #
# Orchestration (spec §2 fall-through + tie/overlap handling)
# --------------------------------------------------------------------------- #


def detect_tier1(
    segment_text: str,
    char_span: Optional[Tuple[int, int]] = None,
    full_transcript_sha256: Optional[str] = None,
    confidence_floor: Optional[float] = None,
) -> List[Tier1Detection]:
    """Run all tier-1 detectors on one segment. Returns the fired detections
    (possibly empty). `char_span` is the [start,end] of `segment_text` into the
    FULL transcript; when provided, emitted char_spans are globally resolvable
    (spec §5.1). `confidence_floor` is the Wave-1-gated high-confidence floor
    (spec §6 WAVE-1-FEED [B]); left None it does not gate (deterministic fires
    are binary at confidence 1.0)."""
    base = char_span[0] if char_span else 0

    raw: List[Tuple[str, int, int]] = []
    for cls, fn in (
        ("exclusion-contrast", _detect_exclusion_contrast),
        ("conditional-action", _detect_conditional_action),
        ("imperative", _detect_imperative),
    ):
        hit = fn(segment_text)
        if hit is not None:
            anchor, s, e = hit
            # claim-scoping invariant (spec §5.3 / §7.4): the anchor MUST resolve
            # verbatim in the segment. A non-resolving anchor is discarded.
            if segment_text[s:e] != anchor:
                continue
            raw.append((cls, s, e))

    # Tie / overlap resolution (spec §2). Sort by precedence; a higher-precedence
    # fire suppresses a lower-precedence fire whose span it CONTAINS. Genuine
    # partial (non-contained) cross-class overlap -> drop BOTH to fall-through.
    raw.sort(key=lambda r: _PRECEDENCE[r[0]])
    kept: List[Tuple[str, int, int]] = []
    dropped_partial: set = set()
    for cls, s, e in raw:
        conflict = False
        for kcls, ks, ke in kept:
            overlap = not (e <= ks or s >= ke)
            if not overlap:
                continue
            # Containment in EITHER direction = the same gate detected at two
            # granularities (e.g. imperative fires on the whole "buy .. when .."
            # clause that also carries a conditional-action). We process highest
            # precedence first, so `kept` is the more-specific class -> suppress
            # this (lower-precedence) fire. NOT an ambiguity.
            contained = (ks <= s and e <= ke) or (s <= ks and ke <= e)
            if contained:
                conflict = True
                break
            # partial (crossing) overlap of different classes -> genuine
            # ambiguity -> BOTH silent, fall through (spec §2).
            dropped_partial.add((kcls, ks, ke))
            conflict = True
            break
        if not conflict:
            kept.append((cls, s, e))
    kept = [k for k in kept if k not in dropped_partial]

    detections: List[Tier1Detection] = []
    for cls, s, e in kept:
        conf = 1.0
        if confidence_floor is not None and conf < confidence_floor:
            continue  # below the (Wave-1-gated) floor -> fall-through
        detections.append(
            Tier1Detection(
                surface_class=cls,
                quote_anchor=segment_text[s:e],
                char_span=(base + s, base + e),
                confidence=conf,
            )
        )
    detections.sort(key=lambda d: d.char_span[0])
    return detections


def run_tier1(
    segment_text: str,
    char_span: Optional[Tuple[int, int]] = None,
    full_transcript_sha256: Optional[str] = None,
    confidence_floor: Optional[float] = None,
) -> Tier1Result:
    """Full tier-1 pass over one segment: fired detections + an explicit
    fall-through record when nothing fires (spec §5.2 / §7.4 -- no span is
    silently dropped)."""
    dets = detect_tier1(
        segment_text, char_span, full_transcript_sha256, confidence_floor
    )
    base = char_span[0] if char_span else 0
    ft = None
    if not dets:
        ft = Tier1FallThrough(char_span=(base, base + len(segment_text)))
    return Tier1Result(segment_text=segment_text, detections=dets, fallthrough=ft)
