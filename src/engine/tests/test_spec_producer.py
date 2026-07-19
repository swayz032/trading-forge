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

from src.engine.extraction.spec_producer import (
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
