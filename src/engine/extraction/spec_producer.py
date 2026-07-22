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
from typing import Any, Dict, List, Optional, Tuple

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


# (v) drop-audit anchor discipline, PRODUCER-LOCAL copy. `evidence` (stamped below)
# is NOT diagnostics-only: the A2-hardened (v) certificate-drop audit in
# `compile_fidelity._check_no_certificate_drops` consumes it (it builds per-condition
# [object, evidence] texts and token-matches cert anchors against them for the 1:1
# bijection). So the join here MUST use the same whole-token-boundary + minimum-anchor
# discipline the consumer uses, or a bare-substring false-match would stamp a WRONG
# anchor as `evidence`, which then trivially self-matches downstream and launders a
# silent drop (fail-open). `_MIN_ANCHOR_TOKENS` mirrors compile_fidelity's
# MIN_ANCHOR_TOKENS=2 and `_anchor_grounds` mirrors its `_token_boundary_contains`;
# both are kept producer-local ON PURPOSE — a reverse import (extraction<-forensics)
# would cycle (forensics imports this module), and hoisting into the STATUS_CALIBRATED
# detector would perturb it. This is a synonymous implementation with a truthful
# comment, not a false one.
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
    """Best-effort join of a staging condition to the certificate's own
    quote_anchor/char_span (the provenance link). An unmatched condition gets
    span {0,0} + its own prose as evidence -- honest, never fabricated. The join is
    WHOLE-TOKEN-boundary + minimum-anchor-tokens (see `_anchor_grounds`; R-282 COUPLING
    INVARIANT — this producer-side token-boundary is JOINTLY LOAD-BEARING with
    compile_fidelity's (v) 1:1 bijection distinctness: the whole-token wrong-slot launder
    is closed only by BOTH. This stamp can still create a spurious cross-edge, but only
    onto an already-object-matched condition; it is the bijection's distinctness
    (`matched == n_taught`) that convicts a genuinely dropped condition. Weaken (v) back
    toward a flattened-pool membership test and this stamp launders AGAIN even with the
    token-boundary here — do not relax either half without re-hardening the other): a bare
    coincidental substring must NOT ground, because the stamped `evidence` is consumed
    by the (v) drop-audit's 1:1 bijection (a wrong stamp would launder a silent drop)."""
    if isinstance(cert, dict):
        hay = _norm(text)
        for c in cert.get("conditions", []) or []:
            anchor = c.get("quote_anchor") or ""
            anchor_norm = _norm(anchor)
            if not anchor_norm or not hay:
                continue
            if _anchor_grounds(anchor_norm, hay):
                s = c.get("char_span") or [0, 0]
                return {"start": int(s[0]), "end": int(s[1])}, anchor
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
