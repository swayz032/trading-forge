"""PACKET 2 spec-producer tests (ratify
`docs/designs/h1-packet2-runnable-spec-compiler-ratify-2026-07-18.md`, R-040).

Covers: determinism, the anti-fit classifier (rules from family SEMANTICS, seen
at both polarities), the house-default-exit provenance stamp (fires only on an
untaught exit), spec_hash stability, the SpecArtifact parse-required contract,
approximation metrics presence, and the inventory disposition.

The synthetic fixtures below are explicitly-labeled UNIT PROBES of the producer
mechanics (they test the classifier/stamp logic on constructed inputs); the
MEASURED behavior on the real 22 lives in run_packet2_inventory.py.
"""

from __future__ import annotations

import pytest

from src.engine.extraction.spec_producer import (
    CONF_APPROXIMATE,
    CONF_CONFIDENT,
    CONF_UNMATCHED,
    DISPOSITION_COMPILABLE,
    DISPOSITION_NON_PORTABLE,
    _classify_family,
    _untaught_exit,
    dispose_inventory,
    produce_spec_artifact,
)

_VALID_DIRECTIONS = {"long", "short", "both"}
_VALID_ROLES = {"spine", "confluence", "trigger", "invalidation"}


# ─── determinism ────────────────────────────────────────────────────────────

def test_producer_is_deterministic():
    strat = {
        "direction": "long",
        "entry_sequence": [{"action": "wait for the New York session open", "role": "precondition"}],
        "confluences": [{"description": "high volume confirms"}],
        "stop": {"description": "below the swing low", "level": None, "gestural": True},
    }
    a1 = produce_spec_artifact(strat, video="V", certificate=None, transcript_chars=10)
    a2 = produce_spec_artifact(strat, video="V", certificate=None, transcript_chars=10)
    assert a1 == a2
    assert a1["spec_hash"] == a2["spec_hash"]


# ─── anti-fit classifier: rules from family SEMANTICS, both polarities ───────

def test_classifier_session_vs_structure_polarity():
    # WAIT_SESSION semantic = a clock/calendar window.
    fam, conf = _classify_family("wait for the London session to open")
    assert fam == "WAIT_SESSION"
    # WAIT_STRUCTURE semantic = a market-structure feature.
    fam2, _c = _classify_family("price taps into the fair value gap order block")
    assert fam2 in ("WAIT_STRUCTURE", "WAIT_RETEST")  # both are structure/retest semantics


def test_classifier_unmatched_is_flagged_not_silently_confident():
    # Prose with no family keyword -> honest UNMATCHED, never a confident guess.
    fam, conf = _classify_family("just feel the vibe of the market and go")
    assert conf == CONF_UNMATCHED


def test_classifier_rules_do_not_reference_the_corpus():
    """Anti-fit guard (pin 2i): the classifier keyword tables are keyed by family
    name only and derived from family semantics -- this test documents that the
    module exposes no corpus-derived table (the 22's texts are never imported)."""
    import src.engine.extraction.spec_producer as sp

    # the only classification tables are the family-keyed semantic ones
    assert set(sp._FAMILY_KEYWORDS.keys()) <= set(__import__(
        "src.engine.spec_family_bindings", fromlist=["FAMILY_META"]).FAMILY_META.keys())


# ─── house-default-exit provenance stamp: fires ONLY on an untaught exit ─────

def test_house_default_exit_stamp_fires_on_gestural_null():
    strat = {
        "direction": "long",
        "entry_sequence": [{"action": "buy the pullback into support", "role": "precondition"}],
        "stop": {"description": "below support", "level": None, "gestural": True},
        "targets": [],
        "gestural_exit": True,
    }
    assert _untaught_exit(strat) is True
    art = produce_spec_artifact(strat, video="V", certificate=None)
    assert art["spec"]["framework_overlay"]["exit"] == "house-default (trader taught none)"


def test_house_default_exit_stamp_absent_when_exit_taught():
    strat = {
        "direction": "long",
        "entry_sequence": [{"action": "buy the pullback into support", "role": "precondition"}],
        "stop": {"description": "2 points below entry", "level": 4990.0, "gestural": False},
        "targets": [{"description": "3R target", "level": 5030.0, "gestural": False}],
        "gestural_exit": False,
    }
    assert _untaught_exit(strat) is False
    art = produce_spec_artifact(strat, video="V", certificate=None)
    assert "framework_overlay" not in art["spec"], "must NOT stamp house-default when an exit was taught"


# ─── SpecArtifact parse-required contract ───────────────────────────────────

def test_artifact_satisfies_parse_required_contract():
    strat = {
        "direction": "both",
        "entry_sequence": [
            {"action": "wait for a break of structure", "role": "precondition"},
            {"action": "enter on the retest", "role": "entry_trigger"},
        ],
        "stop": {"description": "below the low", "level": None, "gestural": True},
    }
    art = produce_spec_artifact(strat, video="VID", certificate=None)
    assert isinstance(art["video"], str) and art["video"]
    assert isinstance(art["spec_hash"], str) and art["spec_hash"]
    body = art["spec"]
    assert body["direction"] in _VALID_DIRECTIONS
    assert isinstance(body["entry_conditions"], list) and body["entry_conditions"]
    assert isinstance(body["entry_trigger_id"], str) and body["entry_trigger_id"]
    # entry_trigger_id resolves to a real condition
    ids = {c["id"] for c in body["entry_conditions"]}
    assert body["entry_trigger_id"] in ids
    for c in body["entry_conditions"]:
        assert c["role"] in _VALID_ROLES
        assert c["type"]
        assert "span" in c and "start" in c["span"] and "end" in c["span"]


def test_direction_coerced_to_valid_set():
    art = produce_spec_artifact({"direction": "sideways", "entry_sequence": [{"action": "wait for structure"}]},
                                video="V", certificate=None)
    assert art["spec"]["direction"] == "both"  # unknown -> both (fail-open to the widest, honest)


def test_approximation_metrics_present_and_named_bias():
    art = produce_spec_artifact(
        {"direction": "long", "entry_sequence": [{"action": "wait for the fair value gap"}]},
        video="V", certificate=None,
    )
    m = art["approximation_metrics"]
    for k in ("n_conditions", "classifier_approximation_rate", "binding_approximation_rate"):
        assert k in m
    assert m["bias_direction"] == "OPTIMISTIC_LOOSER_THAN_TAUGHT"


# ─── inventory disposition ──────────────────────────────────────────────────

def test_disposition_equities_l2_is_non_portable_not_failure():
    strat = {"direction": "both", "setup": "tape reading scalp",
             "entry_sequence": [{"action": "read the level 2 and time and sales for order flow"}]}
    art = produce_spec_artifact(strat, video="V", certificate=None)
    ic = {"asset_class": "equities", "notes": "order-flow / level-2 / time-and-sales scalp"}
    disp = dispose_inventory(strat, ic, art["spec"])
    assert disp["disposition"] == DISPOSITION_NON_PORTABLE


def test_disposition_tape_mechanic_in_condition_text_is_caught_F1_regression():
    """Grader finding F-1 regression lock: a level-2/tape mechanic whose signal
    lives ONLY in the strategy's condition text (NOT in a 'notes' field) AND
    whose instrument_classification uses a NON-'notes' free-text key must still
    be caught non-portable. dispose_inventory scans ALL ic string values + the
    condition text, not three hardcoded keys."""
    strat = {"direction": "both", "setup": "reversal scalp",
             "entry_sequence": [
                 {"action": "read the level two box and watch the tape for the offer refreshing"},
                 {"action": "enter when you see the prints going off at the level", "role": "entry_trigger"},
             ]}
    art = produce_spec_artifact(strat, video="V", certificate=None)
    # free-text under 'reasoning', NOT 'notes' -- the field-name-luck the fix removes
    ic = {"asset_class": "equities", "reasoning": "order-flow scalp using the level-two box"}
    disp = dispose_inventory(strat, ic, art["spec"])
    assert disp["disposition"] == DISPOSITION_NON_PORTABLE


def test_disposition_no_false_positive_on_incidental_options_word():
    """Tightening lock: 'no options greeks' prose must NOT flag a portable
    momentum mechanic as non-portable (the bare 'options' word-match bug)."""
    strat = {"direction": "long",
             "entry_sequence": [
                 {"action": "wait for a break of structure to the upside", "role": "precondition"},
                 {"action": "buy the pullback into the demand zone", "role": "entry_trigger"},
             ],
             "stop": {"description": "below the swing low", "level": None, "gestural": True}}
    art = produce_spec_artifact(strat, video="V", certificate=None)
    ic = {"asset_class": "equities", "is_options_strategy": False,
          "notes": "momentum penny stocks; no options greeks/strikes/expiry"}
    disp = dispose_inventory(strat, ic, art["spec"])
    assert disp["disposition"] == DISPOSITION_COMPILABLE, "incidental 'options' word must not false-flag"


def test_disposition_futures_structure_is_compilable():
    # A structure-driven spec: bindable spine conditions (structure/retest) + a
    # trigger -> compile_binding_plan.compiled True -> compilable-futures.
    strat = {"direction": "long",
             "entry_sequence": [
                 {"action": "wait for a break of structure to the upside", "role": "precondition"},
                 {"action": "price returns to the order block support level", "role": "precondition"},
                 {"action": "enter on the retest of the demand zone", "role": "entry_trigger"},
             ],
             "stop": {"description": "below the swing low", "level": None, "gestural": True}}
    art = produce_spec_artifact(strat, video="V", certificate=None)
    ic = {"asset_class": "futures", "notes": "ICT-style futures structure play"}
    disp = dispose_inventory(strat, ic, art["spec"])
    assert disp["disposition"] == DISPOSITION_COMPILABLE


# ─── R-210 §1 · FOUNDING-INSTANCE FIXTURES ──────────────────────────────────
#
# ★ THE FOUNDING INSTANCES ARE THE FIRST TEST CASES (R-207 §1, applied at birth).
# Every `object` string below is a VERBATIM row from one of the two corpora,
# quoted with its spec id -- NOT a synthesized stand-in. Provenance receipt:
# docs/replay-results/classifier-fix/premise-audit-arrival-paths.json, whose
# `founding_instance_probes` block located each of them by row BEFORE the fix
# was written. The pre-fix classification is recorded on every fixture, so each
# test states the defect it retires rather than just asserting a value.

from src.engine.extraction.spec_producer import (  # noqa: E402
    CONF_AMBIGUOUS,
    UNTYPED_FAMILY,
    _family_evidence,
    _spec_role,
)

# --- founding instance 1: "rth" matched inside "fu-RTH-er" -------------------

RTH_INSIDE_FURTHER = [
    # (corpus, spec, verbatim object) -- all 5 rows the probe found, both corpora.
    ("A", "YGdFksLavKE__s0",
     "Secondly, the candlestick must close below the V-wap band. This shows us that "
     "the price might be making a bearish breakout which would cause for the price to fall further."),
    ("A", "hcHuDfxdywI__s0",
     "After the first break of structure, price performs a healthy pullback and then forms "
     "another break of structure, further confirming bullish continuation"),
    ("B", "0xygpCMwxbQ__s0",
     "taking that one step further by using an OTE I can see that this is our premium up here "
     "where I do not want to be longing and this Narrows down my discount range to my OTE right in here"),
    ("B", "0xygpCMwxbQ__s0",
     "as I move my entry closer to my stop loss my risk to reward increases however the further "
     "I go there is also the possibility that I do not get filled on this trade"),
    ("B", "4cT8WTyxhYY__s0",
     "if the liquidity grab and the entry candle were closer than 10 candles apart the drop was "
     "a lot larger compared to the Peaks further apart"),
]


@pytest.mark.parametrize("corpus,spec,text", RTH_INSIDE_FURTHER)
def test_founding_rth_no_longer_fires_inside_further(corpus, spec, text):
    """PRE-FIX: all 5 rows typed WAIT_SESSION because the 3-char stem 'rth' matched
    inside 'further' -- rows with NO session vocabulary whatsoever. POST-FIX the
    session family must draw ZERO evidence from these strings."""
    scores, _ = _family_evidence(text)
    assert "WAIT_SESSION" not in scores, (
        f"[{corpus}/{spec}] session evidence resurrected from 'further': {scores}")
    fam, _conf = _classify_family(text)
    assert fam != "WAIT_SESSION"


# --- founding instance 2: the ORB opening-range rows ------------------------

OPENING_RANGE_ROWS = [
    ("A", "YqY0OkL5LMI__s1",
     "an opening range breakout level which is the high of this first five minute candle of 3.94 cents"),
    ("A", "st5e-YJRfKc__s0",
     "We take the opening range high and the opening range low in between these time periods. "
     "And that's what forms the opening range."),
    ("A", "st5e-YJRfKc__s0",
     "this is the opening range low 616.61 in which the buyers won. Sellers were not able to "
     "break a penny below this level."),
    ("A", "st5e-YJRfKc__s0",
     "The half range represents exactly how it sounds, half of that opening range."),
    ("A", "dENM6gt8ZRg__s0",
     "The first five-minute candle forms the Opening Range. Two levels: the high and the low "
     "of that candle."),
]


@pytest.mark.parametrize("corpus,spec,text", OPENING_RANGE_ROWS)
def test_founding_opening_range_is_a_level_not_a_session(corpus, spec, text):
    """PRE-FIX: every one of these typed WAIT_SESSION via PRECEDENCE_WIN over
    WAIT_STRUCTURE -- the bare stem 'opening' fired and WAIT_SESSION sat first.
    'Opening range' is a named PRICE RANGE (a high and a low), i.e. a level
    construct. Longest-span arbitration must hand that span to WAIT_STRUCTURE."""
    fam, _conf = _classify_family(text)
    assert fam != "WAIT_SESSION", f"[{corpus}/{spec}] opening-RANGE still read as a clock window"
    assert fam in ("WAIT_STRUCTURE", UNTYPED_FAMILY), f"[{corpus}/{spec}] got {fam}"


# --- founding instance 3: the REVERSE mis-type (clock time typed STRUCTURE) --

CLOCK_TIME_ROWS = [
    ("B", "kFyD3H6I1I8__s0", "I trade every day from 9:30 to 11:00 a.m. Eastern"),
    ("B", "WEhmadJArQo__s0", "we're going to get to our desks right at 9:30 a.m. EST"),
]


@pytest.mark.parametrize("corpus,spec,text", CLOCK_TIME_ROWS)
def test_founding_clock_window_is_a_session_not_the_default_sink(corpus, spec, text):
    """PRE-FIX: these hit NO session stem (the vocabulary had no clock pattern;
    'am ' with a trailing space never matched 'a.m.') and were swallowed by
    _UNMATCHED_DEFAULT_FAMILY into WAIT_STRUCTURE. This is the reverse mis-type
    direction -- a genuine clock-time window typed as market structure."""
    scores, _ = _family_evidence(text)
    assert scores.get("WAIT_SESSION", 0) > 0, f"[{corpus}/{spec}] clock window found no session evidence"
    fam, _conf = _classify_family(text)
    assert fam == "WAIT_SESSION", f"[{corpus}/{spec}] got {fam}"


# --- founding instance 4: fibonacci anchor-vs-taught-object ------------------

FIB_ROWS = [
    ("A", "0RBexa9JpIg__s0",
     "you can only place buy trade when the market is in uptrend. Now draw the fibonacci from "
     "swing low to the recent swing high and wait for the price to touch the 50 or 61.8% line."),
    ("A", "0RBexa9JpIg__s0",
     "you can only place sell trade when the market is in downtrend. Now draw the fibonacci from "
     "swing high to the recent swing low and wait for the price to touch the 50 or 61.8% line."),
]


@pytest.mark.parametrize("corpus,spec,text", FIB_ROWS)
def test_TRIPWIRE_founding_fib_rows_are_a_missing_family_not_a_classifier_defect(
        corpus, spec, text):
    """★★ TRIPWIRE (house form: asserts BOTH halves of a known-broken state and
    SELF-DESTRUCTS when it is fixed, so it cannot report green either way).

    R-210 §1 pin (iv) listed the fib anchor-vs-taught-object rows as founding
    instances of THIS packet. ★ THE PREMISE AUDIT REFUTES THAT PLACEMENT. Both
    rows arrive by SOLE_HIT -- no precedence competitor, no default sink, no
    boundary hazard. NEITHER of the two ratified class defects touches them, so
    no correct version of this packet can move them, and any change that DID move
    them would be a rule authored to satisfy this test -- corpus-fitting, which
    R-040 pin 2i forbids.

    What is actually wrong is one level down: AR-199 §1 adjudicated these rows
    DOWN because the swing high/low is only the ANCHOR while the taught object is
    the 50/61.8% retracement LINE. There is NO family in FAMILY_META for a taught
    price LEVEL, so the classifier has nowhere correct to put it. That is a
    MISSING-FAMILY finding (R-210 §4's pre-registered LEVEL/ZONE prediction), not
    a classifier defect.

    BOTH HALVES:
      (a) the row still types confidently as WAIT_STRUCTURE -- the broken state;
      (b) no family in the axis carries level-object vocabulary -- the reason.
    When a LEVEL family lands, (a) flips and this test goes red, forcing the row
    to be re-adjudicated instead of silently inheriting the old label."""
    fam, conf = _classify_family(text)
    assert (fam, conf) == ("WAIT_STRUCTURE", CONF_CONFIDENT), (
        f"[{corpus}/{spec}] TRIPWIRE FIRED: this row now classifies as ({fam}, {conf}). "
        "If a LEVEL/ZONE family was added, re-adjudicate this row and retire this "
        "tripwire. If it moved for any other reason, a rule was fitted to the corpus.")
    import src.engine.extraction.spec_producer as sp
    level_family = [f for f in sp._KEYWORD_FAMILIES if "LEVEL" in f or "FIB" in f]
    assert not level_family, (
        f"TRIPWIRE FIRED: a level-object family {level_family} now exists -- the "
        "missing-family gap this row documents is closed; re-adjudicate and delete.")


# --- pin (i): order is not the tiebreaker of record -------------------------

def test_classifier_is_order_invariant():
    """★ PIN (i) MADE FALSIFIABLE. The old code chose `hits[0]`, so the axis order
    WAS the decision. If any residue of that survives, reversing the axis changes
    an answer. Re-classify every founding fixture under a REVERSED axis and
    demand identical results."""
    import src.engine.extraction.spec_producer as sp

    texts = [t for _c, _s, t in
             RTH_INSIDE_FURTHER + OPENING_RANGE_ROWS + CLOCK_TIME_ROWS + FIB_ROWS]
    before = [_classify_family(t) for t in texts]
    original = sp._KEYWORD_FAMILIES
    try:
        sp._KEYWORD_FAMILIES = tuple(reversed(original))
        after = [_classify_family(t) for t in texts]
    finally:
        sp._KEYWORD_FAMILIES = original
    assert before == after, "classification changed under a reversed family axis -- order is still load-bearing"
    assert set(original) == set(sp._KEYWORD_FAMILIES)


# --- pin (ii): the sink is gone, and UNTYPED is reachable + fails closed -----

def test_the_default_family_sink_no_longer_exists():
    """★ The CONCEPT, not just the value. A no-evidence row must never be handed
    a family that owns a real primitive."""
    import src.engine.extraction.spec_producer as sp

    assert not hasattr(sp, "_UNMATCHED_DEFAULT_FAMILY"), (
        "the default-family sink is back -- a silent default is "
        "absence-means-maximum-scope in classifier form (R-210 §1 pin ii)")
    fam, conf = _classify_family("just feel the vibe of the market and go")
    assert (fam, conf) == (UNTYPED_FAMILY, CONF_UNMATCHED)


def test_untyped_is_not_a_family_meta_member():
    """UNTYPED is the ABSENCE of a family, not a family. Giving it a FAMILY_META
    entry would give it a declared primitive -- the pointer-lie species (R-153).
    Staying out routes it through the binder's honest unknown-type path."""
    from src.engine.spec_family_bindings import FAMILY_META, compile_binding_plan

    assert UNTYPED_FAMILY not in FAMILY_META
    plan = compile_binding_plan({
        "direction": "long",
        "entry_conditions": [{"id": "UNTYPED:x#0", "type": UNTYPED_FAMILY,
                              "object": "vibes", "role": "spine"}],
        "and_groups": [["UNTYPED:x#0"]], "or_branches": [], "invalidations": [],
        "entry_trigger_id": "UNTYPED:x#0",
    })
    b = plan.bindings[0]
    assert b.bindable is False and b.reason == "unknown_condition_type"
    assert b.approximation is False, "an UNTYPED row must never bind as an np.ones pass-through"


def test_untyped_stays_on_the_spine_and_is_never_demoted():
    """Demoting UNTYPED to 'confluence' would lift spine_ratio and let
    unclassifiable specs report compiled=True -- the optimistic direction."""
    assert _spec_role("precondition", UNTYPED_FAMILY) == "spine"


def test_ambiguous_tie_fails_closed_to_untyped():
    """An unresolvable collision has an honest destination now, not a winner
    picked by list index."""
    scores, _ = _family_evidence("the london session order block")
    assert scores.get("WAIT_SESSION") == scores.get("WAIT_STRUCTURE") == 2
    fam, conf = _classify_family("the london session order block")
    assert (fam, conf) == (UNTYPED_FAMILY, CONF_AMBIGUOUS)


# --- pin (iii): boundary hygiene, both directions ---------------------------

def test_boundary_matching_kills_the_whole_substring_hazard_class():
    """Not just 'rth'. The hygiene audit DERIVED the full set, and its largest
    member was never in the ruling's list: 'liquid' [FILTER] firing inside
    'liquidity' [WAIT_STRUCTURE] -- 33 occurrences, invisible only because FILTER
    sat LAST under precedence and so never won a row it had corrupted."""
    for text, must_not_score in [
        ("further consolidation", "WAIT_SESSION"),      # rth
        ("a pool of liquidity below", "FILTER"),        # liquid
        ("i use metatrader for this", "FILTER"),        # atr
    ]:
        scores, _ = _family_evidence(text)
        assert must_not_score not in scores, f"{must_not_score} still fires on {text!r}: {scores}"
    # 'ifvg' must not be read as 'fvg'; it may legitimately score nothing at all.
    _s, spans = _family_evidence("price fills the ifvg")
    assert all(stem != "fvg" for *_x, stem in spans)


def test_boundary_matching_does_not_lose_inflected_hits():
    """★ THE OPPOSITE-DIRECTION REGRESSION, and the reason pin (iii) could not be
    implemented literally. A naive word-boundary reading silently DROPS ~90
    legitimate inflected hits across the two corpora. Boundary hygiene is
    ASYMMETRIC: hard boundary leading, bounded inflectional tail trailing."""
    for text, family, stem in [
        ("price taps into the demand", "WAIT_RETEST", "tap"),
        ("watch for engulfing candles", "WAIT_CONFIRMATION", "engulf"),
        ("the levels above", "WAIT_STRUCTURE", "level"),
        ("clean pullbacks only", "WAIT_RETEST", "pullback"),
        ("multiple fair value gaps", "WAIT_STRUCTURE", "fair value gap"),
        ("it gapped up", "WAIT_STRUCTURE", "gap"),
        ("equal swing highs", "WAIT_STRUCTURE", "swing high"),
    ]:
        scores, spans = _family_evidence(text)
        assert family in scores, f"{family} lost its inflected hit on {text!r}"
        assert any(s == stem for *_x, s in spans), f"stem {stem!r} did not match in {text!r}"


def test_longest_span_arbitration_gives_each_occurrence_to_one_family():
    """Pin (iii) 'disambiguated by construction' -- a general tokenizer rule, not
    a special case written for one phrase. 'kill zone' [SESSION] must consume
    'zone' [STRUCTURE] exactly the way 'opening range' consumes 'opening'."""
    scores, spans = _family_evidence("enter in the kill zone")
    assert "WAIT_STRUCTURE" not in scores, f"'zone' escaped 'kill zone': {spans}"
    scores2, _ = _family_evidence("the opening range high")
    assert "WAIT_SESSION" not in scores2, "'opening' escaped 'opening range'"


def test_weight_is_the_token_count_of_the_matched_span():
    """The module's ONE scoring constant is derived from the span itself, so
    there is no per-stem number that could be tuned against a corpus."""
    scores, _ = _family_evidence("a break of structure")
    assert scores["WAIT_STRUCTURE"] == 3
    scores2, _ = _family_evidence("a swing")
    assert scores2["WAIT_STRUCTURE"] == 1


def test_confidence_vocabulary_stays_closed():
    """schema-is-the-decision-boundary: _approximation_metrics asserts its counts
    exhaust the vocabulary, so a new value cannot vanish from the honesty rate."""
    from src.engine.extraction.spec_producer import _approximation_metrics

    m = _approximation_metrics({"entry_conditions": [], "invalidations": []},
                               [CONF_CONFIDENT, CONF_APPROXIMATE, CONF_UNMATCHED, CONF_AMBIGUOUS])
    assert m["n_confident"] + m["n_approximate"] + m["n_unmatched"] + m["n_ambiguous"] == 4


# ─── ADDENDUM FIXTURES · THE FALSE-NEGATIVE DIRECTION ───────────────────────
#
# ★ A SET DEFINED BY THE LABEL CANNOT AUDIT THE LABEL. Every fixture above tests
# rows wrongly typed WAIT_SESSION -- but that population was drawn AS "rows
# labeled WAIT_SESSION", so it is structurally blind to the opposite error:
# genuine session teachings typed as something else. These fixtures come from an
# independent blind re-adjudication of that direction.
#
# All rows verified present by direct read of
# docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/*.spec.json
# with their PRE-FIX shipped type recorded, not taken on trust.
#
# GOVERNING CRITERION (ratified): THE TYPE MUST PRESERVE THE TEACHING. A family
# is judged by COMPILE SEMANTICS -- what survives compilation under that type.
# WAIT_SESSION compiles to a session-window gate, so typing a candle-pattern row
# by its timing phrase discards the taught content and keeps only "is it before
# the open?", true every day. A typing that discards the teaching is a mis-type
# regardless of whether the timing phrase is load-bearing.


def test_addendum_pure_trading_hours_window_is_a_session():
    """★ THE CLEANEST SESSION TEACHING IN THE CORPUS, AND IT WAS NOT TYPED ONE.
    Shipped as WAIT_STRUCTURE (video kFyD3H6I1I8) -- via the unmatched-default
    sink, because the pre-fix vocabulary had no clock pattern at all and 'am '
    with a trailing space never matched 'a.m.'. Meanwhile that same video's
    opening-range and indicator-SETTINGS rows WERE typed WAIT_SESSION: the
    labelling was exactly inverted."""
    fam, conf = _classify_family("I trade every day from 9:30 to 11:00 a.m. Eastern")
    assert fam == "WAIT_SESSION", f"pure trading-hours window still not a session: {fam}"
    assert conf == CONF_CONFIDENT


def test_addendum_time_qualifier_never_owns_the_type():
    """THE TYPE MUST PRESERVE THE TEACHING, applied to the sharpest row: the
    taught object is a candle PRINTING; the 9:30 is only when. Shipped
    WAIT_CONFIRMATION, which is correct -- so this row is a REGRESSION GUARD, not
    a repair. An earlier draft of this packet scored the clock like any other
    stem and drove it to a 1-1 tie (UNTYPED), losing a correct label. The
    clock-is-last-resort rule exists because of this row."""
    text = "we're going to wait for the first candle of the day at that 9:30 time to print"
    fam, _conf = _classify_family(text)
    assert fam == "WAIT_CONFIRMATION", (
        f"the timing phrase took ownership of the type: {fam} -- compiling this as a "
        "session gate discards the taught candle behaviour entirely")


# The twins: near-identical teachings that the extractor split across families.
TWIN_PAIR_MARK_THE_RANGE = [
    ("kFyD3H6I1I8__s0", "WAIT_SESSION",
     "marking out the top and the bottom of that range from 9:30 to 9:45. That's the first "
     "15 minutes of the New York Stock Exchange open, and that is my trading range"),
    ("WEhmadJArQo__s0", "WAIT_STRUCTURE",
     "then we're going to mark out the high and the low of that first 5-minute candle that "
     "happens at 9:30 to 9:35 a.m. Eastern Standard Time"),
]


def test_addendum_mark_the_range_twins_agree():
    """PRE-FIX these near-identical teachings ('mark the high and low of the
    opening candle') sat in DIFFERENT families -- WAIT_SESSION in one video,
    WAIT_STRUCTURE in the other. Non-identical outcomes on near-identical inputs
    is the defect, independent of which answer is right."""
    outcomes = {_classify_family(t)[0] for _spec, _pre, t in TWIN_PAIR_MARK_THE_RANGE}
    assert len(outcomes) == 1, f"twins still split across families: {outcomes}"


def test_TRIPWIRE_addendum_candle_completion_twins_still_split():
    """★★ TRIPWIRE — THIS FIXTURE FAILS TO AGREE, AND THE REASON IS THE FINDING.

    Both rows teach the same thing: wait for the opening candle to COMPLETE.
      A: "...first candle of the day at that 9:30 time to PRINT"  -> WAIT_CONFIRMATION
      B: "...wait until the 9:30 to 9:45 ... candle CLOSES"       -> WAIT_SESSION
    They do not agree, and NEITHER ratified class defect (precedence, stem
    hygiene) is the cause. The cause is a VOCABULARY GAP: WAIT_CONFIRMATION
    carries 'print', 'close above', 'close below', 'closes above', 'closes
    below' -- but not a bare candle CLOSE. So row B finds no object evidence at
    all and falls to the clock.

    ★ IT IS LEFT RED-BY-CONSTRUCTION ON PURPOSE. Adding 'closes' to the
    WAIT_CONFIRMATION table would turn this green in one line, and that line
    would be a vocabulary change authored to satisfy a fixture -- a THIRD change
    class outside R-210 §1's two ratified defects, introduced under fixture
    pressure. That is the optimize-the-proxy failure, and it would also make this
    packet's before/after delta un-attributable. The gap is REPORTED, not
    patched, and this tripwire holds the evidence until a vocabulary packet is
    ratified on its own terms.

    BOTH HALVES: (a) the two rows still disagree; (b) the stated cause -- that
    WAIT_CONFIRMATION has no bare-close stem -- still holds. Fix the vocabulary
    and BOTH assertions flip, forcing this test to be retired deliberately."""
    import src.engine.extraction.spec_producer as sp

    a = _classify_family("we're going to wait for the first candle of the day at that "
                         "9:30 time to print")[0]
    b = _classify_family("We're going to wait until the 9:30 to 9:45 Eastern Standard Time "
                         "candle closes. So, it's still the first candle of the day.")[0]
    assert (a, b) == ("WAIT_CONFIRMATION", "WAIT_SESSION"), (
        f"TRIPWIRE FIRED: candle-completion twins now classify ({a}, {b}). If a bare-close "
        "stem was added to WAIT_CONFIRMATION, retire this tripwire deliberately.")
    assert not any(s.strip() in ("close", "closes", "candle close", "candle closes")
                   for s in sp._FAMILY_KEYWORDS["WAIT_CONFIRMATION"]), (
        "TRIPWIRE FIRED: WAIT_CONFIRMATION gained a bare-close stem — the documented "
        "cause of the split is gone; re-adjudicate both rows and delete this test.")


def test_TRIPWIRE_addendum_marked_range_loses_its_taught_object():
    """★★ TRIPWIRE — the twins AGREE (above) but they agree on a type that
    DISCARDS THE TEACHING, so the agreement must not be read as a clean pass.

    The taught object in both rows is a LEVEL PAIR (the high and the low of the
    opening candle). WAIT_SESSION compiles to a session-window gate and keeps
    none of it. The correct family would be a LEVEL/ZONE family -- which does not
    exist in FAMILY_META, exactly the R-210 §4 pre-registered gap. No classifier
    change available to this packet can type these rows correctly.

    Recorded so the ladder is not read as if these rows were solved."""
    for _spec, _pre, text in TWIN_PAIR_MARK_THE_RANGE:
        fam, _c = _classify_family(text)
        assert fam == "WAIT_SESSION", (
            f"TRIPWIRE FIRED: {fam} — if a LEVEL family landed, re-adjudicate these rows.")


def test_addendum_compound_representation_is_recorded_not_built():
    """The full remedy for a load-bearing time qualifier is that it SPAWNS A
    SIBLING condition alongside the object-typed one. That is compound
    representation -- future compiler capability, explicitly RECORDED AND NOT
    BUILT. This test pins the boundary so a later packet cannot claim it shipped
    here: one prose condition still produces exactly ONE spec condition."""
    strat = {"direction": "long", "entry_sequence": [
        {"action": "at 9:30 wait for the engulfing candle to print", "role": "entry_trigger"}]}
    art = produce_spec_artifact(strat, video="V", certificate=None)
    assert len(art["spec"]["entry_conditions"]) == 1, (
        "a prose condition produced more than one spec condition — compound "
        "representation was built; it was only supposed to be recorded")


# ─── §0 load_bearing default · EXPLICIT on every produced condition ──────────
#
# Frozen pre-reg §0 (docs/designs/survivor-forensics-preregistration-2026-07-19.md
# lines 13-15,93): a compiled condition with no `load_bearing` field is treated
# load-bearing. The producer now makes that default EXPLICIT (load_bearing=True)
# so the classification is auditable ON the artifact. The producer NEVER emits a
# non_lb_disposition and NEVER marks a condition non-LB — that is the reserved (b)
# advisor decision, not a producer heuristic.

import copy as _copy  # noqa: E402

from src.engine.extraction.spec_producer import _spec_hash  # noqa: E402
from src.engine.forensics.compile_fidelity import BLOCK, PASS, run_leg_a, run_leg_a_phase1  # noqa: E402

# ─── _cert_span_for token-boundary discipline · producer-side (v) anti-launder ──
#
# The producer stamps each condition's `evidence` via _cert_span_for. That field is
# NOT diagnostics-only: the (v) certificate-drop audit consumes [object, evidence]
# and token-matches cert anchors against it for the 1:1 bijection. Before the fix,
# _cert_span_for grounded on a BARE bidirectional substring (no token boundary, no
# token floor) — the exact pre-A2 weakness the detector already retired. A degraded
# certificate whose anchor is a coincidental >=2-token BARE (non-whole-token) substring
# of a condition's text got that WRONG anchor stamped as the condition's evidence, which
# then trivially self-token-matched downstream and LAUNDERED a silent drop → fail-open
# PASS. The fix routes _cert_span_for through whole-token-boundary + MIN_ANCHOR_TOKENS
# containment, so a coincidental fragment can no longer ground.


def _clean_countersigns_for(art, cert):
    seal = run_leg_a_phase1(art, certificate=cert)
    return {cid: {"reader_id": "fresh-reader-1", "reader_vintage": "v1",
                  "typing": True, "polarity": True, "drops": True}
            for cid in seal.countersign_required_ids}


# Two WAIT_SESSION spine preconditions (pass (ii) honestly), NO explicit trigger so the
# trigger is the last spine (no load-bearing ENABLE_ENTRY, which would fail (ii)).
_RED_STRAT = {
    "direction": "long",
    "entry_sequence": [
        {"action": "wait for the london killzone session", "role": "precondition"},
        {"action": "only trade during the am session", "role": "precondition"},
    ],
}
_S1_OBJ = "wait for the london killzone session"
_S2_OBJ = "only trade during the am session"


def test_degraded_cert_anchor_no_longer_launders_a_drop_through_evidence():
    """RED case (reversion tripwire). Certificate anchor 'am sessio' is a coincidental
    2-token BARE substring of S2's text ('...the am sessio-n') but NOT a whole-token
    subsequence of it — a degraded/orphan quote with no honest grounding for S2. Post-
    fix _cert_span_for REFUSES it: S2 keeps its honest fallback evidence (its own prose),
    the degraded anchor finds no bijection edge, the drop surfaces → BLOCK on (v).

    On REVERSION to the bare-substring predicate: 'am sessio' is stamped as S2.evidence,
    self-matches downstream, the bijection completes and run_leg_a PASSes — BOTH asserts
    below flip red. The fix is load-bearing, not defense-in-depth: it turns a live
    fail-open (PASS) into the correct BLOCK."""
    cert = {"video": "RED", "conditions": [
        {"quote_anchor": _S1_OBJ, "char_span": [0, 0]},
        {"quote_anchor": "am sessio", "char_span": [0, 0]},  # degraded: 2-token bare fragment
    ]}
    art = produce_spec_artifact(_RED_STRAT, video="RED", certificate=cert, transcript_chars=100)
    s2 = art["spec"]["entry_conditions"][1]
    assert s2["object"] == _S2_OBJ
    # the wrong anchor must NOT be stamped as evidence (would be on reversion)
    assert s2["evidence"] == _S2_OBJ, (
        f"degraded anchor stamped as evidence: {s2['evidence']!r} — bare-substring grounding "
        "resurrected (the launder is back)")
    res = run_leg_a(art, certificate=cert, countersignatures=_clean_countersigns_for(art, cert))
    assert res.verdict == BLOCK and "v" in res.checks_failed, (
        f"degraded-anchor drop was NOT surfaced: verdict={res.verdict} "
        f"checks_failed={sorted(res.checks_failed)} — (v) laundered the drop (fail-open)")


def test_honest_cert_anchor_grounds_and_passes_leg_a_discriminating_control():
    """DISCRIMINATING HONEST CONTROL (anti-vacuity). Same spec, but S2's certificate
    anchor is the HONEST whole-token 'only trade during the am session'. _cert_span_for
    grounds it (unchanged by the token-boundary fix — honest anchors are whole-token),
    stamps it as evidence, the 1:1 bijection completes and run_leg_a PASSes. This proves
    the RED BLOCK above fires on the DEGRADED anchor specifically, not because the audit
    blocks everything — and it stays GREEN across the reversion (so it discriminates the
    fix rather than merely tripping on it)."""
    cert = {"video": "GRN", "conditions": [
        {"quote_anchor": _S1_OBJ, "char_span": [0, 0]},
        {"quote_anchor": _S2_OBJ, "char_span": [0, 0]},  # honest whole-token anchor
    ]}
    art = produce_spec_artifact(_RED_STRAT, video="GRN", certificate=cert, transcript_chars=100)
    s2 = art["spec"]["entry_conditions"][1]
    assert s2["evidence"] == _S2_OBJ  # honest anchor grounds and is stamped
    res = run_leg_a(art, certificate=cert, countersignatures=_clean_countersigns_for(art, cert))
    assert res.verdict == PASS, (
        f"honest control did not pass: verdict={res.verdict} checks_failed={sorted(res.checks_failed)} "
        "— the (v) audit would be vacuously blocking")


def test_every_produced_condition_is_explicitly_load_bearing_true():
    """Every produced taught condition — entry_conditions (spine, trigger,
    confluence), the taught-stop invalidation, AND the synthesized terminal
    ENABLE_ENTRY trigger — must carry `load_bearing is True` (the §0 default made
    explicit). is True, not just truthy: the field is the literal default."""
    # Stream 1: spine + explicit trigger + confluence + taught-stop invalidation.
    strat = {
        "direction": "long",
        "entry_sequence": [
            {"action": "wait for a break of structure to the upside", "role": "precondition"},
            {"action": "enter on the retest of the demand zone", "role": "entry_trigger"},
        ],
        "confluences": [{"description": "high volume confirms the move"}],
        "stop": {"description": "below the swing low", "level": None, "gestural": True},
    }
    art = produce_spec_artifact(strat, video="V", certificate=None)
    body = art["spec"]
    rows = list(body["entry_conditions"]) + list(body.get("invalidations") or [])
    assert len(body["entry_conditions"]) >= 3 and body.get("invalidations"), (
        "fixture must exercise spine, trigger, confluence AND invalidation streams")
    for c in rows:
        assert c["load_bearing"] is True, f"condition {c['id']} missing explicit load_bearing=True"

    # Stream 2: the SYNTHESIZED terminal trigger (no trigger role, no spine → synth).
    synth_strat = {"direction": "long", "confluences": [{"description": "volume rising"}]}
    synth_art = produce_spec_artifact(synth_strat, video="V", certificate=None)
    synth = [c for c in synth_art["spec"]["entry_conditions"]
             if c["id"] == "ENABLE_ENTRY:spine-completion#trigger"]
    assert synth, "expected a synthesized spine-completion trigger in this fixture"
    assert synth[0]["load_bearing"] is True, "synthesized trigger missing explicit load_bearing=True"


def test_detector_per_row_verdict_identical_explicit_true_vs_field_absent():
    """The §0 no-op guarantee at the detector: a spec with explicit
    `load_bearing: True` on every condition yields IDENTICAL per-row Leg-A
    verdicts to the same spec with the field ABSENT (the detector defaults
    absent→true, so explicit-true is indistinguishable). Hash-bearing fields are
    excluded; the injected copy is re-stamped so (vi.a) stays in lockstep."""
    strat = {
        "direction": "long",
        "entry_sequence": [
            {"action": "wait for a break of structure to the upside", "role": "precondition"},
            {"action": "price returns to the order block support level", "role": "precondition"},
            {"action": "enter on the retest of the demand zone", "role": "entry_trigger"},
        ],
        "confluences": [{"description": "high volume confirms"}],
        "stop": {"description": "below the swing low", "level": None, "gestural": True},
    }
    explicit = produce_spec_artifact(strat, video="V", certificate=None)
    # every produced condition already carries explicit load_bearing=True
    assert all(c["load_bearing"] is True
               for c in explicit["spec"]["entry_conditions"] + (explicit["spec"].get("invalidations") or []))

    absent = _copy.deepcopy(explicit)
    for c in absent["spec"]["entry_conditions"] + (absent["spec"].get("invalidations") or []):
        c.pop("load_bearing", None)
    absent["spec_hash"] = _spec_hash(absent["spec"])  # re-stamp so (vi.a) verifies in lockstep

    def _row_surface(art):
        seal = run_leg_a_phase1(art, certificate=None)
        return {
            "automated_verdict": seal.automated_verdict,
            "checks_failed": sorted(seal.checks_failed),
            "rows": [
                {"id": r.condition_id, "load_bearing": r.load_bearing,
                 "ii_applicable": r.ii_applicable, "row_verdict": r.row_verdict,
                 "fail_codes": sorted(r.fail_codes)}
                for r in seal.rows
            ],
        }

    assert _row_surface(explicit) == _row_surface(absent), (
        "explicit load_bearing=True changed the Leg-A per-row verdict vs field-absent — "
        "the §0 default is NOT a detector no-op")
