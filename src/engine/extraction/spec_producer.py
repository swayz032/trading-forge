"""H1 PACKET 2 -- runnable-spec compiler (ratify
`docs/designs/h1-packet2-runnable-spec-compiler-ratify-2026-07-18.md`, R-040).

THE ONE THING THIS MODULE DOES: turn a certified `staging_v32` extraction (+ its
fidelity certificate) into a SpecArtifact `.spec.json` body -- the runnable shape
the EXISTING onboarding back-half consumes (`spec-onboarding-service.ts`
onboardSpecArtifact -> SpecConditionStrategy -> run_class_backtest). It is the
physical H1->H2 connection (R-039 §5).

HEURISTIC-FIRST TYPE-FAMILY CLASSIFIER (R-040 pin 2a). Each prose condition is
mapped to one of the binding FAMILIES (`spec_family_bindings.FAMILY_META`).

  ★ ANTI-FIT (R-040 pin 2i): the keyword rules below are DERIVED FROM THE FAMILY
  DEFINITIONS' semantics (the `spec_family_bindings.py` FAMILY -> PRIMITIVE table
  + docs/spec-execution-semantics.md), NEVER from reading the design-pool 22's
  texts. The shakedown corpus MEASURES this heuristic; it must not AUTHOR it.
  Every keyword below is annotated with the family SEMANTIC it comes from.

  ★ NAMED OPTIMISTIC BIAS (R-040 pin 2iii): a condition whose binding is
  `approximation=True` degrades to a pass-through (`np.ones`) in
  SpecConditionStrategy -- effectively UNGATED -> the compiled spec trades
  LOOSER than taught. That error direction is OPTIMISTIC. So the producer stamps
  the per-spec approximation rate ON the artifact; every battery verdict on an
  approximated spec must carry that rate in its scope line, and a
  high-approximation spec cannot ground a survivor claim on its own.

PURE/DETERMINISTIC: no I/O beyond reading its dict args, no LLM, no randomness,
no wall-clock -- same inputs -> byte-identical artifact. `spec_hash` is a
sha256 over the canonical spec body, so the `.spec.json` transfers between
engine trees provenance-safe (R-040 §1).

EXPLICITLY OUT OF SCOPE: the extractor/certified reader (frozen -- this is
conformance in POST-PROCESSING, R-039 pin 5a); spec_condition_compiler /
spec_family_bindings / framework-overlay semantics (consumed as-is); the
survivor-forensics compile-fidelity leg (follow-on); an LLM classifier seam
(RESERVED, evidence-triggered).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from src.engine.opening_range_candidate import (
    OpeningRangeExecutionCandidate,
    expand_execution_candidates,
)
from src.engine.opening_range_definition import (
    CANONICAL_TYPE as OPENING_RANGE_DEFINITION,
)
from src.engine.opening_range_definition import classify_opening_range_definition
from src.engine.opening_range_lowering import (
    OpeningRangeLoweringResult,
    lower_opening_range_definition,
)
from src.engine.spec_family_bindings import compile_binding_plan

# --------------------------------------------------------------------------- #
# Type-family classifier -- keyword rules DERIVED FROM FAMILY SEMANTICS (anti-fit)
# --------------------------------------------------------------------------- #
#
# Each entry: FAMILY -> tuple of lowercase keyword stems that express THAT
# FAMILY'S MEANING per the spec_family_bindings FAMILY->PRIMITIVE table. The
# comment cites the family's semantic anchor. These are NOT harvested from the
# 22's transcripts (anti-fit); they are the vocabulary a family's DEFINITION
# implies.
#
# ★ THERE IS NO PRECEDENCE ORDER ANY MORE (R-210 §1 pin i). The list order of
# _KEYWORD_FAMILIES is presentation only and is asserted to be non-load-bearing
# by test_classifier_is_order_invariant. The previous header comment here
# claimed "Precedence is the list ORDER ... (most-specific first)" -- that
# comment was FALSE about its own list (index 0, WAIT_SESSION, held the LEAST
# specific stems in the file), and the claim is exactly what stopped anyone
# re-deriving it (R-211 §2(c), caption-is-a-claim in a code comment). It is
# deleted rather than reworded: the property it asserted is now MEASURED by a
# test instead of stated by prose.
#
# Assignment is by EVIDENCE STRENGTH -- see _classify_family.

_FAMILY_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    # WAIT_SESSION -> session_windows (time-of-day / killzone). Semantic: a
    # calendar/clock window. (FAMILY_META requires_session_keyword=True.)
    #
    # ★ DERIVED HYGIENE DELTAS (each from the family SEMANTIC, never the corpus):
    #  - "am "/"pm " REMOVED. The trailing space was a hand-rolled word boundary;
    #    under real boundary matching those stems become the English word "am"
    #    ("i am not counting this as a displacement"). A clock reference is
    #    matched by _CLOCK_RE below, which is what the family semantic actually
    #    means. Measured: the ONLY boundary-valid "am" hit on either corpus was
    #    the verb.
    #  - "close of" REMOVED, replaced by session-qualified forms. "close of" is
    #    ambiguous between the close of a SESSION (this family) and the close of
    #    a CANDLE (WAIT_CONFIRMATION); the family semantic is the former only.
    #    Disambiguated by construction per pin (iii). Measured: 0 occurrences on
    #    either corpus, so this delta moves NO row and is UNVERIFIABLE here --
    #    it is a construction fix, recorded as such.
    #  - "rth" KEPT: boundary matching is what makes it safe (it previously
    #    matched inside "fu-rth-er"); the stem itself was never the defect.
    #  - "open"/"opening" KEPT: bare-token opens are genuine session references
    #    ("new york open", "market open"). The LEVEL-construct reading
    #    ("opening range") is removed by longest-span arbitration against
    #    WAIT_STRUCTURE's "opening range", not by deleting the stem.
    "WAIT_SESSION": (
        "session", "killzone", "kill zone", "open", "opening",
        "session close", "market close", "close of the session",
        "close of the day", "closing bell", "opening bell",
        "morning", "afternoon", "york", "london", "asia",
        "tokyo", "rth", "globex", "o'clock", "oclock", "time of day",
        "first hour", "power hour", "cash open", "bell",
    ),
    # WAIT_BIAS / CONFIRM_DIRECTION -> bias_engine regime (directional bias /
    # HTF narrative). Semantic: which way, on the higher frame.
    "WAIT_BIAS": (
        "higher time frame", "htf", "daily bias", "overall trend", "bias is",
        "directional bias", "market direction", "trend is", "regime",
        "narrative", "expansion phase", "accumulation phase", "with the trend",
    ),
    "CONFIRM_DIRECTION": (
        "confirm the direction", "confirm direction", "in line with the trend",
        "aligned with bias", "same direction",
    ),
    # WAIT_RETEST -> retest_touch_check (return-to-level / pullback / touch).
    # Semantic: price comes BACK to a prior level.
    "WAIT_RETEST": (
        "retest", "re-test", "pullback", "pull back", "revisit", "return to",
        "returns to", "tap", "taps", "mitigation", "mitigate", "back to the",
        "comes back", "bounce off", "reject off",
    ),
    # WAIT_CONFIRMATION -> candle_confirmation_check (rejection/confirmation
    # candle print). Semantic: a confirming price ACTION at the level.
    "WAIT_CONFIRMATION": (
        "confirmation", "rejection candle", "rejection", "engulf", "engulfing",
        "pin bar", "wick", "close above", "close below", "closes above",
        "closes below", "confirm with", "reversal candle", "print",
    ),
    # WAIT_STRUCTURE / VERIFY_STRUCTURE -> structure_engine (market structure:
    # levels, BOS, FVG, order block, S/R, liquidity). Semantic: a structural
    # feature on the chart. (Broadest -- lower precedence than the above.)
    # ★ DERIVED ADDITION (pin iii, disambiguated by construction): "opening
    # range" is a named PRICE RANGE -- two levels, a high and a low -- and the
    # family definition ALREADY carries "range", "level", "high of the", "low of
    # the". It is a level construct, not a clock window, so it belongs here. As
    # a 2-token span it also outranks and SUPPRESSES WAIT_SESSION's 1-token
    # "opening" at the same position (see _classify_family's span arbitration).
    "WAIT_STRUCTURE": (
        "break of structure", "bos", "market structure", "structure",
        "order block", "fair value gap", "fvg", "imbalance", "gap",
        "support", "resistance", "supply", "demand", "liquidity", "swing high",
        "swing low", "swing", "level", "zone", "trendline", "channel", "range",
        "opening range", "high of the", "low of the", "equal highs", "equal lows",
    ),
    # FILTER -> confluence_factor_presence (a quality/confluence gate: volume,
    # catalyst, volatility, multi-TF alignment). Semantic: a go/no-go quality
    # filter, not a structural trigger.
    "FILTER": (
        "volume", "catalyst", "news", "confluence", "volatility", "atr",
        "momentum", "spread", "in play", "in-play", "multiple time frames",
        "multiple timeframes", "aligns", "liquid", "average volume", "float",
    ),
}

# The family axis. ★ THIS IS AN ENUMERATION, NOT A PRECEDENCE ORDER (pin i).
# Nothing in _classify_family reads its index; iteration order only fixes the
# order scores are accumulated in, and test_classifier_is_order_invariant proves
# a shuffled copy classifies both corpora identically.
_KEYWORD_FAMILIES: Tuple[str, ...] = (
    "WAIT_SESSION",
    "CONFIRM_DIRECTION",
    "WAIT_BIAS",
    "WAIT_RETEST",
    "WAIT_CONFIRMATION",
    "WAIT_STRUCTURE",
    "FILTER",
)

# Confidence vocabulary (schema = decision boundary; keep it a closed set).
CONF_CONFIDENT = "confident"
CONF_APPROXIMATE = "approximate"
CONF_UNMATCHED = "unmatched"
CONF_AMBIGUOUS = "ambiguous"

# ★ UNTYPED (R-210 §1 pin ii) -- the honest output when the classifier has NO
# evidence, or evidence it cannot adjudicate. It replaces the former
# `_UNMATCHED_DEFAULT_FAMILY = "WAIT_STRUCTURE"` sink.
#
# WHY A SINK WAS WORSE THAN A GAP: the default silently promoted a no-evidence
# condition into a family with a real primitive, where it bound with
# approximation=True -- an np.ones pass-through, i.e. UNGATED and LOOSER than
# taught (the R-040 pin 2iii optimistic bias). The row LOOKED typed and LOOKED
# bound. "A silent default family is absence-means-maximum-scope in classifier
# form" (R-210 §1).
#
# ★ UNTYPED IS DELIBERATELY *NOT* A MEMBER OF `spec_family_bindings.FAMILY_META`.
# It is the ABSENCE of a family, not a family, and giving it a FAMILY_META entry
# would mean giving it a declared primitive -- the pointer-lie species this
# campaign already found 9 times (R-153). Staying out of FAMILY_META routes it
# through the binder's existing, documented unknown-type path
# (`_bind_condition_dispatch` -> bindable=False, reason="unknown_condition_type"),
# which fails closed by construction. See the consumer trace in this packet's
# report for the full enumeration of readers that can now receive it.
UNTYPED_FAMILY = "UNTYPED"

# Clock-window matching for WAIT_SESSION. The family semantic is "a calendar/
# clock window", and a literal clock time is its canonical expression -- so this
# is DERIVED from the family definition, not from any corpus. It also repairs
# the reverse mis-type direction: before this, prose that named ONLY a clock
# window ("i trade every day from 9:30 to 11:00 a.m. eastern") hit no session
# stem at all and was swallowed by the default sink.
_CLOCK_RE = re.compile(
    r"(?<![a-z0-9])(?:"
    r"\d{1,2}\s*:\s*\d{2}(?:\s*(?:a\.?m\.?|p\.?m\.?))?"   # 9:30, 9:30 a.m.
    r"|\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)"                    # 4pm, 9 a.m.
    r"|\d{1,2}\s*o'?clock"                                 # 4 o'clock
    r")(?![a-z0-9])"
)

# Inflectional tail permitted after a stem. DERIVED from the morphology actually
# observed when the old bare-substring matcher was audited: plural/possessive
# (level/levels, zone/zones, swing high/swing highs), past and progressive
# (wick/wicked/wicking, engulf/engulfing, open/opened/opening), with optional
# consonant doubling (tap/tapped/tapping, gap/gapped).
#
# ★ WHY NOT A PLAIN `\b...\b`: pin (iii) says "word boundaries everywhere", and
# a naive reading of that is a REGRESSION, not a fix -- it silently DROPS ~90
# legitimate inflected hits across the two corpora. The leading boundary is what
# kills the hazards ("fu|rth|er", "liquid|ity", "meta|tr|ader", "i|fvg"); the
# trailing side needs a bounded tail, not a hard stop. Boundary hygiene is
# therefore ASYMMETRIC by derivation.
_INFLECTION = r"(?:[bdgklmnprt]?(?:s|es|ed|ing|'s))?"


def _stem_pattern(stem: str) -> re.Pattern:
    """Word-boundary-anchored matcher for one literal stem.

    `\\b` is wrong here: several stems abut non-word characters (o'clock), so the
    boundary is expressed as explicit lookarounds over the word-character class.
    Interior whitespace is relaxed to `\\s+` so a stem matches across any
    normalised spacing.
    """
    body = r"\s+".join(re.escape(tok) for tok in stem.strip().split())
    return re.compile(r"(?<![a-z0-9])" + body + _INFLECTION + r"(?![a-z0-9])")


_STEM_PATTERNS: Dict[str, Tuple[Tuple[str, re.Pattern], ...]] = {
    fam: tuple((stem, _stem_pattern(stem)) for stem in stems)
    for fam, stems in _FAMILY_KEYWORDS.items()
}

_HOUSE_DEFAULT_EXIT = "house-default (trader taught none)"


def _norm(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _slug(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", _norm(text)).strip("-")
    return (s[:maxlen] or "cond").rstrip("-")


def _family_evidence(text: str) -> Tuple[Dict[str, int], List[Tuple[int, int, str, str]]]:
    """Score every family on ONE prose condition and return (scores, spans).

    THREE RULES, each derived rather than tuned:

    1. BOUNDARY-ANCHORED MATCHING. Every stem is matched via `_stem_pattern`, so
       a stem can no longer fire from inside a longer word. This is what deletes
       the founding "rth" ⊂ "further" instance -- and, as the hygiene audit
       found, the strictly larger "liquid" [FILTER] ⊂ "liquidity" [STRUCTURE]
       collision, which was invisible only because FILTER sat LAST under the old
       precedence and so never won a row it corrupted.

    2. LONGEST-SPAN ARBITRATION -- "disambiguated by construction" (pin iii).
       An occurrence of text is evidence for AT MOST ONE family: the longest
       stem covering it. So "opening range" [WAIT_STRUCTURE] consumes the span
       that "opening" [WAIT_SESSION] would otherwise have claimed, and the
       opening-RANGE rows stop reading as clock windows. This is a general
       tokenizer rule applied to every stem pair, NOT a special case written for
       one phrase.

    3. WEIGHT = TOKEN COUNT OF THE MATCHED SPAN, SUMMED OVER DISTINCT STEMS.
       A k-token phrase is k-fold more specific evidence than a bare token. This
       is the ONE scoring constant in the module and it is derived from the span
       itself, so there is no per-stem number that could be tuned against a
       corpus (anti-fit, R-040 pin 2i). "break of structure" scores 3; "swing"
       scores 1.

       ★ DISTINCT, NOT PER-OCCURRENCE -- a stem scores ONCE however often it is
       repeated. REPETITION IS NOT EVIDENCE STRENGTH, it is verbosity. Scoring
       per-occurrence let a row like "the retest of the level, the breakout of
       the level, or the liquidity sweep of the level" score WAIT_STRUCTURE 3
       purely because the speaker said "level" three times, which would have
       replaced the old arbitrary tiebreaker (list order) with a new arbitrary
       one (word count). A family is supported by the distinct concepts present
       in the prose, not by how many times one of them was uttered.
    """
    hay = _norm(text)
    spans: List[Tuple[int, int, str, str]] = []
    for fam in _KEYWORD_FAMILIES:
        for stem, pat in _STEM_PATTERNS[fam]:
            for m in pat.finditer(hay):
                spans.append((m.start(), m.end(), fam, stem))

    # ★ RULE 4 -- A TIME QUALIFIER NEVER OWNS THE TYPE. A clock reference is
    # admitted as WAIT_SESSION evidence ONLY when no OTHER family has literal-
    # stem evidence: it is evidence of LAST RESORT, not an ordinary stem.
    #
    # WHY. Every other stem in these tables names a taught OBJECT or ACTION
    # (an order block, an engulfing candle, a retest). A clock names WHEN, never
    # WHAT. Under the ratified criterion THE TYPE MUST PRESERVE THE TEACHING,
    # typing "wait for the first candle of the day at 9:30 to print" as
    # WAIT_SESSION compiles it to a session-window gate -- true every day before
    # the open -- and discards the entire taught content (a candle printing).
    # A timing phrase therefore cannot outrank a taught object, however
    # load-bearing the timing is.
    #
    # ★ THIS IS THE WEAK HALF OF THAT CRITERION, DELIBERATELY. The full remedy is
    # that a load-bearing time qualifier SPAWNS A SIBLING condition alongside the
    # object-typed one. That is compound representation -- future compiler
    # capability, RECORDED AND NOT BUILT HERE. What this rule can do is stop the
    # qualifier from OWNING the type; what it cannot do is keep the qualifier.
    # A row whose timing is genuinely load-bearing still loses that timing, and
    # that residual is a KNOWN GAP, not a solved one.
    if any(fam != "WAIT_SESSION" for _s, _e, fam, _k in spans):
        pass  # a taught object is present; the clock stays out of the scoring
    else:
        for m in _CLOCK_RE.finditer(hay):
            spans.append((m.start(), m.end(), "WAIT_SESSION", "<clock>"))

    # Rule 2: drop any span strictly covered by a longer one (any family).
    kept: List[Tuple[int, int, str, str]] = []
    for sp in spans:
        s, e = sp[0], sp[1]
        covered = any(
            (o[0] <= s and e <= o[1]) and (o[1] - o[0]) > (e - s) for o in spans
        )
        if not covered:
            kept.append(sp)

    # Rule 3: weight per DISTINCT (family, stem); repetition adds nothing.
    best_per_stem: Dict[Tuple[str, str], int] = {}
    for s, e, fam, stem in kept:
        w = len(hay[s:e].split())
        key = (fam, stem)
        if w > best_per_stem.get(key, 0):
            best_per_stem[key] = w
    scores: Dict[str, int] = {}
    for (fam, _stem), w in best_per_stem.items():
        scores[fam] = scores.get(fam, 0) + w
    return scores, kept


def _classify_family(text: str, *, role_hint: Optional[str] = None) -> Tuple[str, str]:
    """Map ONE prose condition to a (family, type_confidence).

    ★ EVIDENCE DECIDES, NOT LIST ORDER (R-210 §1 pin i). The winner is the
    highest-scoring family under `_family_evidence`. `_KEYWORD_FAMILIES` order is
    read nowhere in this decision -- `test_classifier_is_order_invariant` proves
    that by re-classifying both corpora under a shuffled axis.

      confident  -- exactly one family produced any evidence.
      approximate-- several families scored; one won OUTRIGHT on evidence.
      ambiguous  -- the top score is TIED -> UNTYPED. The classifier can see the
                    collision but cannot adjudicate it, and says so.
      unmatched  -- no family produced any evidence -> UNTYPED.

    ★ BOTH failure modes return UNTYPED_FAMILY. There is no default family and
    no sink (pin ii): the old code returned WAIT_STRUCTURE for the no-evidence
    case, which is how 35 of tier-A's 50 WAIT_STRUCTURE rows -- 70% of that
    family -- were assigned with zero supporting evidence.
    """
    # ── B1 STEP 3 (R-730 §4, widened R-732 §2): the taught OPENING RANGE gets its
    # own explicit type BEFORE keyword scoring can collapse it into WAIT_STRUCTURE.
    #
    # WHY IT MUST RUN FIRST. `_FAMILY_KEYWORDS["WAIT_STRUCTURE"]` already contains
    # "opening range", "range", "level", "high of the" and "low of the", so the
    # scoring below reliably wins this sentence for the coarse family. That is the
    # measured defect: an opening range is a TIME-BOUNDED STATEFUL AGGREGATION THAT
    # PRODUCES LEVELS, and WAIT_STRUCTURE's evaluator emits market-structure EVENTS
    # with no field a range can live in. `A CLASSIFIER THAT PRESERVES ONE OF TWO
    # DIMENSIONS HAS NOT CLASSIFIED -- IT HAS PROJECTED.`
    #
    # WHY IT IS SAFE TO RUN FIRST. The rule is ORDERED and refuses before it
    # accepts: reference/trigger evidence blocks outright, so "break above the
    # opening-range high" -- which carries BOTH a clock and range language -- stays
    # exactly where it is. Its breakout semantics remain UNRESOLVED_SOURCE_AMBIGUITY
    # (R-725 §4) and this step may not settle them. `A CLEARER TEACHER DOES NOT
    # RESOLVE A DIFFERENT TEACHER'S SILENCE.`
    #
    # MEASURED TIGHTNESS, not asserted: across the frozen census the rule fires on
    # 2 of 99 conditions, and within the golden spec it captures 1 of the 9
    # conditions currently sitting on the wrong evaluator. The six controls and the
    # corpus blast-radius read live in
    # docs/replay-results/h1-battery/opening_range_definition_discrimination.py,
    # which imports THIS rule rather than copying it.
    #
    # CONFIDENCE IS `CONFIDENT` BY CONSTRUCTION: the rule requires two independent
    # positive limbs and no blocking evidence, which is a stronger warrant than the
    # single-family keyword hit that earns CONF_CONFIDENT below.
    is_opening_range_definition, _reason, _evidence = classify_opening_range_definition(text)
    if is_opening_range_definition:
        return OPENING_RANGE_DEFINITION, CONF_CONFIDENT

    scores, _spans = _family_evidence(text)
    if not scores:
        return UNTYPED_FAMILY, CONF_UNMATCHED
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return UNTYPED_FAMILY, CONF_AMBIGUOUS
    return ranked[0][0], (CONF_CONFIDENT if len(ranked) == 1 else CONF_APPROXIMATE)


# --------------------------------------------------------------------------- #
# Staging-shape helpers
# --------------------------------------------------------------------------- #

_TRIGGER_ROLES = {"entry_trigger", "trigger", "entry"}


def _direction(strategy: dict) -> str:
    d = _norm(strategy.get("direction"))
    return d if d in ("long", "short", "both") else "both"


def _condition_text(obj: dict) -> str:
    for k in ("action", "description", "rationale", "stop_management"):
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _untaught_exit(strategy: dict) -> bool:
    """True iff the trader taught NO concrete exit (R-039 pin c trigger): a
    gestural/null stop, empty-or-all-gestural targets, or an explicit
    gestural_exit marker."""
    if bool(strategy.get("gestural_exit")):
        return True
    stop = strategy.get("stop")
    stop_untaught = (
        stop is None
        or (isinstance(stop, dict) and (stop.get("level") is None or bool(stop.get("gestural"))))
    )
    targets = strategy.get("targets") or []
    if not isinstance(targets, list) or len(targets) == 0:
        targets_untaught = True
    else:
        targets_untaught = all(
            isinstance(t, dict) and (t.get("level") is None or bool(t.get("gestural"))) for t in targets
        )
    return bool(stop_untaught and targets_untaught)


# R-282 COUPLING — RETIRED (R-291 §1 D2), and WHY. This block used to declare the join
# below JOINTLY LOAD-BEARING with compile_fidelity's (v) 1:1 bijection, on the ground that
# `evidence` was NOT diagnostics-only: the (v) certificate-drop audit built per-condition
# [object, evidence] texts and token-matched certificate anchors against them, so a wrong
# anchor stamped as `evidence` self-matched downstream and laundered a silent drop.
# (v) NO LONGER READS `evidence` (object-only reconciliation, R-291 §1 D1) and
# `_cert_span_for` NO LONGER STAMPS the anchor into it, so BOTH ends of that coupling are
# gone. A coupling declaration must die when the coupling dies: nothing this module emits is
# consumed by the (v) drop-audit any more, and the "do not relax either half without
# re-hardening the other" instruction is withdrawn.
#
# THE DISCIPLINE STAYS, on its OWN (narrower, truthful) reason: `_cert_span_for` still stamps
# the matched certificate entry's `char_span` onto the condition, and a bare coincidental
# substring must not stamp a WRONG transcript offset as a condition's provenance span.
# `_MIN_ANCHOR_TOKENS` mirrors compile_fidelity's MIN_ANCHOR_TOKENS=2 and `_anchor_grounds`
# mirrors its `_token_boundary_contains`; both are kept producer-local ON PURPOSE — a reverse
# import (extraction<-forensics) would cycle (forensics imports this module), and hoisting into
# the STATUS_CALIBRATED detector would perturb it. This is a synonymous implementation with a
# truthful comment, not a false one.
_MIN_ANCHOR_TOKENS: int = 2


def _anchor_grounds(anchor_norm: str, hay: str) -> bool:
    """WHOLE-TOKEN-boundary containment (both operands already `_norm`'d = lowercased,
    single-spaced), the exact discipline of compile_fidelity._token_boundary_contains:
    space-pad both and test `a in t or t in a`, so a bare fragment can only match as a
    standalone token run, never inside a token. The anchor must additionally clear the
    `_MIN_ANCHOR_TOKENS` floor, so a 1-token fragment cannot ground."""
    if len(anchor_norm.split()) < _MIN_ANCHOR_TOKENS:
        return False
    a = f" {anchor_norm} "
    t = f" {hay} "
    return a in t or t in a


def _cert_span_for(text: str, cert: Optional[dict]) -> Tuple[Dict[str, int], str]:
    """Best-effort join of a staging condition to the certificate's `char_span` (the
    provenance link). Returns `(span, evidence)`.

    ★ `evidence` is ALWAYS the condition's OWN prose (R-291 §1 D2). This function used to
    return the matched certificate's `quote_anchor` as `evidence` — i.e. it copied the
    certificate's text into the spec, and the (v) drop-audit then reconciled the certificate
    against that copy of itself. With (v) object-only, that stamp has ZERO consumers, so it
    is REMOVED: the honest unmatched-branch value (the condition's own prose) is now the
    value on BOTH branches, and no certificate text is laundered into the spec record.
    An unmatched condition additionally gets span {0,0} -- honest, never fabricated.

    The join stays WHOLE-TOKEN-boundary + minimum-anchor-tokens (`_anchor_grounds`) so that a
    bare coincidental substring cannot stamp a WRONG `char_span` onto a condition. That is now
    this discipline's whole reason — see the retired-coupling note above `_MIN_ANCHOR_TOKENS`."""
    if isinstance(cert, dict):
        hay = _norm(text)
        for c in cert.get("conditions", []) or []:
            anchor_norm = _norm(c.get("quote_anchor") or "")
            if not anchor_norm or not hay:
                continue
            if _anchor_grounds(anchor_norm, hay):
                s = c.get("char_span") or [0, 0]
                return {"start": int(s[0]), "end": int(s[1])}, text
    return {"start": 0, "end": 0}, text


# --------------------------------------------------------------------------- #
# The producer
# --------------------------------------------------------------------------- #


def _entry_condition(
    idx: int, text: str, *, staging_role: str, cert: Optional[dict], structural_family: Optional[str] = None
) -> Tuple[dict, str]:
    """Build one SpecEntryCondition + return its type_confidence. `structural_
    family` (INVALIDATE/ENABLE_ENTRY) is assigned STRUCTURALLY (never keyword-
    guessed) when the caller knows the condition's structural role."""
    if structural_family is not None:
        family, conf = structural_family, CONF_CONFIDENT
    else:
        family, conf = _classify_family(text, role_hint=staging_role)
    span, evidence = _cert_span_for(text, cert)
    role = _spec_role(staging_role, family)
    cond = {
        "id": f"{family}:{_slug(text)}#{idx}",
        "type": family,
        "object": text,
        "role": role,
        "span": span,
        "evidence": evidence,
        # additive, honest -- NOT part of the parse-required contract; carried
        # so the approximation metric + survivor-forensics can read per-condition
        # classifier confidence.
        "type_confidence": conf,
        # §0 survivor-forensics default, made EXPLICIT on every produced
        # condition (pre-reg docs/designs/survivor-forensics-preregistration-
        # 2026-07-19.md lines 13-15,93): absent => load-bearing, so True is the
        # honest, auditable classification. The producer NEVER marks a condition
        # non-LB (that is the reserved (b) advisor decision, not a producer
        # heuristic); no non_lb_disposition is emitted.
        "load_bearing": True,
    }
    return cond, conf


def _spec_role(staging_role: str, family: str) -> str:
    """SpecEntryCondition.role vocabulary is {spine, confluence, trigger,
    invalidation}. Derived structurally from the staging role + family.

    ★ UNTYPED FALLS THROUGH TO "spine" DELIBERATELY (consumer-trace decision).
    The alternative -- demoting a no-evidence condition to "confluence" -- would
    remove it from the spine denominator, RAISE `spine_ratio`, and let specs
    that are full of unclassifiable prose report `compiled=True`. That is the
    optimistic direction. Keeping it on the spine keeps it load-bearing, so an
    UNTYPED-heavy spec drops below MIN_SPINE_BOUND_RATIO and is honestly
    disposed `compile-degraded`. Fail closed. Pinned by
    test_untyped_stays_on_the_spine_and_is_never_demoted.
    """
    if family == "INVALIDATE":
        return "invalidation"
    if family in ("ENABLE_ENTRY", "ENTER") or _norm(staging_role) in _TRIGGER_ROLES:
        return "trigger"
    if _norm(staging_role) == "confluence":
        return "confluence"
    return "spine"


def produce_spec_artifact(
    strategy_extraction: dict,
    *,
    video: str,
    certificate: Optional[dict] = None,
    transcript_chars: int = 0,
) -> dict:
    """Certified `staging_v32` extraction -> SpecArtifact `.spec.json` body.
    Pure/deterministic. See module docstring for the anti-fit + optimistic-bias
    contract."""
    entry_conditions: List[dict] = []
    confidences: List[str] = []
    idx = 0
    trigger_id: Optional[str] = None

    for step in strategy_extraction.get("entry_sequence") or []:
        if not isinstance(step, dict):
            continue
        text = _condition_text(step)
        if not text:
            continue
        staging_role = str(step.get("role") or "")
        is_trigger = _norm(staging_role) in _TRIGGER_ROLES
        cond, conf = _entry_condition(
            idx, text, staging_role=staging_role, cert=certificate,
            structural_family="ENABLE_ENTRY" if is_trigger else None,
        )
        entry_conditions.append(cond)
        confidences.append(conf)
        if is_trigger and trigger_id is None:
            trigger_id = cond["id"]
        idx += 1

    for conf_obj in strategy_extraction.get("confluences") or []:
        if not isinstance(conf_obj, dict):
            continue
        text = _condition_text(conf_obj)
        if not text:
            continue
        cond, conf = _entry_condition(idx, text, staging_role="confluence", cert=certificate)
        entry_conditions.append(cond)
        confidences.append(conf)
        idx += 1

    # Invalidation from the taught stop (STRUCTURAL family assignment).
    invalidations: List[dict] = []
    stop = strategy_extraction.get("stop")
    if isinstance(stop, dict):
        text = _condition_text(stop)
        if text:
            inv, _c = _entry_condition(
                idx, text, staging_role="invalidation", cert=certificate, structural_family="INVALIDATE"
            )
            invalidations.append(inv)
            idx += 1

    # entry_trigger_id: the trigger-role step, else the last spine condition,
    # else a synthesized terminal ENABLE_ENTRY so the parse-required field is
    # always a real id (never empty).
    if trigger_id is None:
        spine_ids = [c["id"] for c in entry_conditions if c["role"] in ("spine", "trigger")]
        if spine_ids:
            trigger_id = spine_ids[-1]
        else:
            synth = {
                "id": "ENABLE_ENTRY:spine-completion#trigger",
                "type": "ENABLE_ENTRY", "object": "spine completion",
                "role": "trigger", "span": {"start": 0, "end": 0},
                "evidence": "synthesized spine-completion trigger", "type_confidence": CONF_CONFIDENT,
                # §0 explicit default (see _entry_condition): load-bearing.
                "load_bearing": True,
            }
            entry_conditions.append(synth)
            trigger_id = synth["id"]

    spec_body: Dict[str, Any] = {
        "direction": _direction(strategy_extraction),
        "entry_conditions": entry_conditions,
        "and_groups": [[c["id"] for c in entry_conditions]] if entry_conditions else [],
        # or_branches: PINNED EMPTY, honestly (grader findings F-2 + its
        # residual). staging_v32's `variants[]` field is NOT a runnable
        # OR-alternative signal: across the design-pool 22 it is HETEROGENEOUS
        # -- direction-mirrors, alternate confirmation blends, timeframe
        # variants, re-entry locations, and pure risk-management variants (some
        # entries there are not entry-path alternatives at all). Only a minority
        # are mutually-substitutable entry paths. Deriving OR-branches from this
        # mixed field would FABRICATE untaught runnable structure and mistype
        # non-alternatives as alternatives. Reserved for the (b) classifier / a
        # real OR signal, same disclosure as graph_canonical_hash/ledger_d below.
        "or_branches": [],
        "invalidations": invalidations,
        "entry_trigger_id": trigger_id,
    }

    # House-default-exit provenance stamp (R-039 pin c) -- only when untaught.
    if _untaught_exit(strategy_extraction):
        spec_body["framework_overlay"] = {
            "exit": _HOUSE_DEFAULT_EXIT,
            "exit_source": "framework_overlay_style_c",
        }

    artifact = {
        "video": video,
        "spec_hash": _spec_hash(spec_body),
        "graph_canonical_hash": "",  # unproduced on this branch (R-040 §3), pinned honestly
        "ledger_d": "UNKNOWN",       # unproduced on this branch (R-040 §3)
        "transcript_chars": int(transcript_chars),
        "spec": spec_body,
        "approximation_metrics": _approximation_metrics(spec_body, confidences),
    }
    return artifact


def _spec_hash(spec_body: dict) -> str:
    canonical = json.dumps(spec_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _approximation_metrics(spec_body: dict, confidences: List[str]) -> dict:
    """Per-spec approximation metrics (R-040 pin 2ii), mandatory + on the
    artifact. TWO honest rates:
      classifier_approximation_rate -- fraction of conditions the heuristic
        typed with less-than-confident confidence (approximate|unmatched).
      binding_approximation_rate    -- fraction of EXECUTED bindable conditions
        whose binding is approximation=True (read from compile_binding_plan, the
        existing authority) -- these degrade to np.ones pass-through (the
        LOOSER-than-taught optimistic bias, R-040 pin 2iii).
    """
    n = len(confidences)
    n_confident = sum(1 for c in confidences if c == CONF_CONFIDENT)
    n_approx = sum(1 for c in confidences if c == CONF_APPROXIMATE)
    n_unmatched = sum(1 for c in confidences if c == CONF_UNMATCHED)
    n_ambiguous = sum(1 for c in confidences if c == CONF_AMBIGUOUS)
    # The confidence vocabulary is a CLOSED set and these counts must exhaust it
    # -- otherwise a new value would silently vanish from the honesty metrics
    # while still dragging the rate (schema = decision boundary).
    assert n_confident + n_approx + n_unmatched + n_ambiguous == n, (
        "confidence counts do not close on n -- an unenumerated confidence value "
        f"reached _approximation_metrics: {sorted(set(confidences))}")

    plan = compile_binding_plan(spec_body)
    exec_bindable = [b for b in plan.bindings if b.bindable and b.executed]
    n_exec = len(exec_bindable)
    n_binding_approx = sum(1 for b in exec_bindable if b.approximation)

    return {
        "n_conditions": n,
        "n_confident": n_confident,
        "n_approximate": n_approx,
        "n_unmatched": n_unmatched,
        "n_ambiguous": n_ambiguous,
        "classifier_approximation_rate": round((n - n_confident) / n, 4) if n else 0.0,
        "n_executed_bindable": n_exec,
        "n_binding_approximation": n_binding_approx,
        "binding_approximation_rate": round(n_binding_approx / n_exec, 4) if n_exec else 0.0,
        # named optimistic bias (R-040 pin 2iii) -- travels with the number.
        "bias_direction": "OPTIMISTIC_LOOSER_THAN_TAUGHT",
    }


# --------------------------------------------------------------------------- #
# Inventory disposition (R-040 §3) -- battery-compatibility, honest denominator
# --------------------------------------------------------------------------- #

DISPOSITION_COMPILABLE = "compilable-futures"
DISPOSITION_NON_PORTABLE = "non-portable-mechanic"
DISPOSITION_DEGRADED = "compile-degraded"

# Microstructure the OHLCV bar-based battery does NOT carry -- a strategy whose
# MECHANIC needs it is out-of-battery-scope, NOT a failure (operator's strategy-
# not-instrument law: the mechanic, not the label, is what can't port). Keyword
# set derived from what OHLCV lacks (order-book depth / tape), never from the 22.
# STRONG microstructure-only signals (each is unambiguous evidence the MECHANIC
# needs order-book depth / the tape -- things OHLCV bars cannot carry). Bare
# generic terms ("the offer", "the bid", "refreshing", "order flow", "options")
# are DELIBERATELY excluded: they false-positive on incidental prose ("no
# options greeks", "if you like to use order flow" as an optional confluence).
# Options detection uses the STRUCTURED instrument_classification flags
# (is_options_strategy / options_mechanic), never a substring.
_NON_PORTABLE_MECHANIC = (
    "level 2", "level-2", "level two", "level-two", "level ii", "level-two box",
    "time and sales", "time-and-sales", "the tape", "reading the tape",
    "watch the tape", "tape reading", "depth of market", " dom ", "order book",
    "market maker", "prints going off",
)


def _all_strings(obj) -> List[str]:
    """Recursively collect every string value in a nested dict/list -- so a
    free-text instrument_classification field is scanned no matter which of the
    corpus's inconsistent key names it uses (notes/reasoning/rationale/...)."""
    out: List[str] = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            out.extend(_all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_strings(v))
    return out


def dispose_inventory(strategy_extraction: dict, instrument_classification: Optional[dict], spec_body: dict) -> dict:
    """One strategy's battery-compatibility disposition (R-040 §3). Mechanical
    criteria only -- no invented approximation threshold gates the disposition;
    the approximation rate travels alongside for the measured (a)-vs-(b)
    decision.
      non-portable-mechanic -- needs L2/tape/order-flow/options microstructure
                               the OHLCV battery cannot carry (out-of-scope, not
                               a failure).
      compile-degraded      -- compile_binding_plan.compiled is False (trigger or
                               majority spine unbound -> not a runnable spec).
      compilable-futures    -- compiles + portable mechanic.
    """
    ic = instrument_classification or {}
    # Scan ALL instrument_classification free-text (any key name) AND the
    # strategy's own condition text (entry_sequence / confluences / stop /
    # targets / setup / name) -- a tape/L2 mechanic often lives ONLY in the
    # condition prose ("watch the tape", "the offer refreshing"), not in the
    # classification block (grader finding F-1). Field-name luck is not detection.
    hay_parts = _all_strings(ic)
    hay_parts.extend(_all_strings({k: strategy_extraction.get(k) for k in (
        "entry_sequence", "confluences", "stop", "targets", "setup", "name", "description",
    )}))
    hay = " ".join(_norm(x) for x in hay_parts)
    non_portable = bool(ic.get("is_options_strategy")) or bool(ic.get("options_mechanic")) or any(
        kw in f" {hay} " for kw in _NON_PORTABLE_MECHANIC
    )
    if non_portable:
        disp = DISPOSITION_NON_PORTABLE
    else:
        plan = compile_binding_plan(spec_body)
        disp = DISPOSITION_COMPILABLE if plan.compiled else DISPOSITION_DEGRADED
    return {
        "disposition": disp,
        "asset_class": ic.get("asset_class"),
        "approximation_metrics": _approximation_metrics(
            spec_body, [c.get("type_confidence", CONF_CONFIDENT) for c in spec_body.get("entry_conditions", [])]
        ),
    }


# ── B1 STEP 6 / lane S6-1 STEP 2 — THE FULL-RECORD PRODUCTION COMPILE BOUNDARY ──
#
# AUTHORITY: R-776 §4.
#
# WHY THIS EXISTS AT ALL (R-774 §4-4, measured):
# `produce_spec_artifact()` receives ONE strategy — `record["strategies"][i]` — so every
# RECORD-LEVEL fact is discarded before the compile. `instrument_classification` is one of
# them, and `lower_opening_range_definition()` reads `market_scope` out of it. No amount of
# work downstream of the old boundary could produce a source-complete opening-range
# definition, because the evidence was already gone.
#
# WHY A WRAPPER RATHER THAN A NEW PARAMETER (R-776 §3 left the choice open):
# adding a full-record parameter to `produce_spec_artifact()` would give one function two
# input contracts — a strategy AND the record that contains it — and every existing caller
# would have to be trusted to pass a consistent pair. A wrapper cannot be handed an
# inconsistent pair: it derives the strategy FROM the record it was given.
#
# 🛑 WHAT THIS IS NOT (R-776 §4, verbatim scope):
# not family registration · not resolver/dispatch · not the TS mirror · not candidate
# transport · not backtesting · not breakout semantics. It carries the LOWERED DEFINITION
# and stops. Expanding that definition into candidates is STEP 3 and is deliberately absent.
#
# 🛑 ONE LOWERER: this calls `lower_opening_range_definition()` and nothing else. There is no
# second interpretation of the taught prose here — not a regex, not a fallback, not a
# hand-built `OpeningRangeDefinition`. [MEASURED, R-776 prior-art check] this is the FIRST
# production caller of that function; it does not compete with an existing one.
# ── STEP 2.1 — THE SERIALIZATION FIREBREAK (R-777 §4) ─────────────────────────
#
# STEP 2 attached the typed lowering to the artifact under this key. R-777 §3
# confirmed BY EXECUTION that this made the artifact unserialisable on BOTH arms,
# including the refusal path, and promoted it to a firebreak before STEP 3.
#
# THE DISTINCTION, and it is the whole design:
#   PORTABLE CONTRACT = SpecArtifact  -- plain JSON, crosses into TypeScript, durable
#   IN-PROCESS STATE  = lowering, candidates, binding plan -- typed, Python-only
#
# 🛑 THE KEY IS NOW A FORBIDDEN NAME, NOT A STORAGE LOCATION. It survives only so
# the envelope can REFUSE it. `dataclasses.asdict()`-ing the lowering under this
# key is the specific repair R-777 §4-2 forbids: the TS `parseSpecArtifact()`
# rebuilds only recognised fields, so Python would believe it sent the lowering
# while TypeScript dropped it without a word.
#
#   `A HANDOFF WHERE THE SENDER BELIEVES IT SENT AND THE RECEIVER SILENTLY DROPS
#    IS WORSE THAN ONE THAT FAILS LOUDLY.`
SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY: str = "opening_range_lowering"


@dataclass(frozen=True)
class RecordCompileResult:
    """What the full-record compile boundary returns: a portable artifact PLUS the
    typed in-process state derived alongside it.

    `artifact` is the SpecArtifact exactly as the existing onboarding back-half
    expects it — plain JSON, no Python objects, unchanged in shape from what
    `produce_spec_artifact()` produces.

    `opening_range_lowering` is the authoritative lowering. It lives HERE, beside
    the artifact rather than inside it, so that moving it out of the portable
    contract does not mean losing it.

    🛑 THE INVARIANT IS ENFORCED IN `__post_init__`, NOT DOCUMENTED IN A DOCSTRING.
    An envelope carrying an artifact that still holds the typed lowering is
    UNCONSTRUCTABLE — the same principle STEP 2 used for the strategy/record pair,
    and the one R-777 §1 accepted:

        `AN INCONSISTENT PAIR YOU CANNOT CONSTRUCT NEEDS NO VALIDATION.`
    """

    artifact: Dict[str, Any]
    opening_range_lowering: OpeningRangeLoweringResult
    opening_range_candidates: Tuple[OpeningRangeExecutionCandidate, ...] = ()

    def __post_init__(self) -> None:
        if SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY in self.artifact:
            raise ValueError(
                f"the SpecArtifact carries {SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY!r}; "
                "the typed lowering belongs on this envelope, never inside the portable "
                "contract. Serialising it under an artifact key would be silently "
                "discarded by the TypeScript parser (R-777 §4)"
            )

        # STEP 3 — the refusal must survive the fan-out. A record whose source was
        # incomplete has NO definition to expand, so candidates here would be
        # invented durations wearing a valid type.
        definition = self.opening_range_lowering.definition
        if definition is None and self.opening_range_candidates:
            raise ValueError(
                f"{len(self.opening_range_candidates)} execution candidates accompany a "
                "lowering that REFUSED; a SOURCE_INCOMPLETE record cannot yield candidates, "
                "and candidates built without a definition are invented"
            )

        # And the candidates must belong to THIS lowering, not merely be well-shaped.
        # `A CORRECTLY SHAPED SIDECAR ATTACHED TO THE WRONG STRATEGY IS PLAUSIBLE, AND
        #  PLAUSIBLE IS THIS CAMPAIGN'S FAILURE MODE.`
        foreign = [c for c in self.opening_range_candidates if c.definition is not definition]
        if foreign:
            raise ValueError(
                f"{len(foreign)} candidate(s) carry a definition that is not this envelope's "
                "lowered definition; a candidate joined to the wrong source is plausible "
                "enough to survive every shape check downstream"
            )

        # 🛑 AND THE IDENTITIES MUST AGREE TOO — R-778 §4.
        # The definition check above compares the DEFINITION OBJECT and nothing else, so a
        # candidate carrying the right definition, the right variant and the WRONG
        # `source_spec_id` was constructible. That is not cosmetic: `candidate_id` and
        # `cache_identity` are computed FROM these ids, so a disagreeing pair produces a
        # STABLE, PLAUSIBLE hash for the wrong source — and a cache keyed on it would serve
        # one lesson's opening range under another lesson's name.
        #
        #   `AN IDENTITY DERIVED FROM A FIELD NOTHING VALIDATES IS A CONFIDENT ANSWER TO AN
        #    UNASKED QUESTION.`
        mismatched = [
            (c.candidate_id, c.source_spec_id, c.source_condition_id)
            for c in self.opening_range_candidates
            if c.source_spec_id != self.opening_range_lowering.source_spec_id
            or c.source_condition_id != self.opening_range_lowering.source_condition_id
        ]
        if mismatched:
            raise ValueError(
                f"{len(mismatched)} candidate(s) name a source this envelope's lowering does "
                f"not: lowering is "
                f"({self.opening_range_lowering.source_spec_id!r}, "
                f"{self.opening_range_lowering.source_condition_id!r}); "
                f"offenders {mismatched}"
            )


_LOWERING_POSITIVE_CONTROL: str = (
    "the same locators run over every certified record at this boundary, and the corpus "
    "contains records in which each required field IS located — so a field missing here is "
    "a property of THIS record, not of the reader"
)


def produce_spec_artifact_from_record(
    record: dict,
    *,
    video: str,
    certificate: Optional[dict] = None,
    transcript_chars: int = 0,
    strategy_index: int = 0,
) -> "RecordCompileResult":
    """The public production compile boundary that receives the FULL certified record.

    Produces the spec artifact for one strategy and returns it BESIDE the
    authoritative opening-range lowering, which needs record-level evidence the
    per-strategy boundary cannot see.

    Returns a `RecordCompileResult`, not the artifact: the artifact stays plain
    JSON (the portable contract) and the typed lowering rides alongside it as
    in-process state (R-777 §4).

    The lowering is attempted for EVERY record, not only for records that carry an
    `OPENING_RANGE_DEFINITION` condition. That is deliberate: `SOURCE_INCOMPLETE`
    with named missing fields is a real, useful answer for a record that never
    taught an opening range, whereas skipping the call would make "not taught" and
    "not attempted" indistinguishable downstream.

        `AN ABSENT RESULT AND A REFUSAL ARE DIFFERENT FACTS, AND ONLY ONE OF THEM
         NAMES WHAT WAS MISSING.`

    No stub id, no video id and no duration appears in this function's logic — it
    reads the record it is handed (R-776 §4 stop conditions).
    """
    strategies = record.get("strategies") or []
    if not strategies:
        raise ValueError(
            f"{video}: the certified record carries no strategies; there is nothing to "
            "compile, and inventing one is not available here"
        )
    if not 0 <= strategy_index < len(strategies):
        raise IndexError(
            f"{video}: strategy_index {strategy_index} is outside the record's "
            f"{len(strategies)} strategies"
        )

    artifact = produce_spec_artifact(
        strategies[strategy_index],
        video=video,
        certificate=certificate,
        transcript_chars=transcript_chars,
    )

    lowering = lower_opening_range_definition(
        source_spec_id=video,
        source_condition_id=_opening_range_condition_id(artifact),
        record=record,
        positive_control=_LOWERING_POSITIVE_CONTROL,
    )

    # ── STEP 3 (R-777 §5) — FAN OUT THE TAUGHT DEFINITION INTO EXECUTION CANDIDATES ──
    #
    # 🛑 NONE PRIMARY, NONE DEFAULT. `expand_execution_candidates()` takes no
    # `default_variant` and returns one candidate per taught variant IN TAUGHT ORDER.
    # Choosing among them is a decision the teacher declined to make (R-736: "the
    # teacher gave three versions, so the factory makes three bots"), and
    # `OpeningRangeDefinition.selected_duration_minutes` already RAISES to stop that
    # happening three layers down.
    #
    # 🛑 ONE IDENTITY SYSTEM. The candidates' `candidate_id` / `cache_identity` come
    # from the existing module; nothing here invents a second one. The existing hash
    # covers the whole source-owned definition plus the selected variant, which is
    # strictly stronger than keying on a duration.
    #
    # A refusal fans out to NOTHING, and the envelope enforces that rather than
    # trusting this line.
    candidates: Tuple[OpeningRangeExecutionCandidate, ...] = ()
    if lowering.definition is not None:
        candidates = expand_execution_candidates(
            source_spec_id=video,
            source_condition_id=lowering.source_condition_id,
            definition=lowering.definition,
        )

    return RecordCompileResult(
        artifact=artifact,
        opening_range_lowering=lowering,
        opening_range_candidates=candidates,
    )


def _opening_range_condition_id(artifact: dict) -> str:
    """The produced condition that carries the taught opening range, selected BY TYPE.

    Returns `""` when the record taught none — the lowering still runs and still
    refuses by name, which is what keeps "not taught" legible downstream.
    """
    spec_body = artifact.get("spec") or {}
    for condition in spec_body.get("entry_conditions") or ():
        if str(condition.get("type", "")) == "OPENING_RANGE_DEFINITION":
            return str(condition.get("id", ""))
    return ""


# 🛑 `opening_range_lowering_of(artifact)` WAS REMOVED HERE BY STEP 2.1, AND ITS
# REMOVAL IS PART OF THE REPAIR RATHER THAN TIDYING.
#
# It read the lowering back OUT of the artifact. Once the lowering moved onto the
# envelope, that accessor could only ever return `None` — and `None` was already
# its way of saying "this artifact predates the boundary". It would have answered
# "no lowering here" for every artifact ever produced, forever, and been right
# about the storage location while being catastrophically misleading about the
# fact. `[MEASURED, R-777 prior-art check]` it had no caller outside the S6 guard.
#
#   `A FUNCTION WHOSE ONLY REMAINING ANSWER IS ITS "NOT FOUND" ANSWER IS NOT DEAD
#    CODE — IT IS A DETECTOR THAT HAS QUIETLY BECOME A LIAR.`
#
# The lowering is now reached as `RecordCompileResult.opening_range_lowering`,
# which cannot be absent: it is a required field of the envelope.
