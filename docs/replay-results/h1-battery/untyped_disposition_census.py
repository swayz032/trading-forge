#!/usr/bin/env python3
"""UNTYPED DISPOSITION CENSUS -- the earned per-condition disposition of the
26 LOAD-BEARING UNTYPED conditions on the tier-A 11 (R-218 SS1; re-sited
CENSUS-SIDE by R-293 SS1).

================================================================================
WHY THIS LIVES CENSUS-SIDE AND NOT IN THE LIVE PRODUCER
================================================================================
The obvious move -- re-type the mis-emitted conditions inside
`src/engine/extraction/spec_producer.py::_classify_family` -- was REJECTED after
empirical verification, and this generator RE-RUNS that verification so the
rejection is a measurement in the artifact rather than a remembered claim
(see `counterfactual_bind_probe` in the output).

  type=UNTYPED   -> binder returns bindable=False, reason=unknown_condition_type.
                    An HONEST unbound: the row says "I do not know what this is".
  re-typed       -> binder returns bindable=True, approximation=True for four of
                    the five target families -- a BOUND-BUT-APPROXIMATED row that
                    passes compile, degrades to an ungated pass-through, and
                    still fails Leg A(ii).
                    The fifth (ENTER) is the LEVEL-DISAGREEMENT row: approximation
                    =False at the BINDING level, and STILL a Leg A(ii) FAIL at the
                    ENFORCED level (R-260 family anchor). Both levels are measured
                    and published; the level is part of the claim (R-301 SS3).

The accounting would improve while the gate did not. That is manufacturing the
exact hollow compile the typing was ordered to STOP. Two further grounds
converge: a live re-type moves `spec_hash`, which re-keys sealed trial identity
(identity-continuity law); and an earned typing is a JUDGMENT record, and
judgment layers classify while mechanical layers nominate.

  ★ THE MINT THIS IMPLEMENTS: AN ACCOUNTING FIX LANDS AT THE ACCOUNTING LAYER.

================================================================================
WHAT THIS IS AND IS NOT
================================================================================
IS:     denominator honesty. It records, per condition, what the trader was
        actually teaching and therefore what the UNTYPED sink is standing in
        for -- so that "26 load-bearing UNTYPED" stops being an undifferentiated
        blob and becomes 11 real-teaching mis-emits + 2 non-conditions + 13
        honest gaps.
IS NOT: eligibility recovery. It recovers ZERO eligible specs and says so in
        its own top-level key, COMPUTED, not asserted (see ZERO_YIELD_*).
IS NOT: a classifier. Nothing here runs at produce time; nothing here changes
        any emitted `type`; no `spec_hash` moves.

================================================================================
READ-ONLY GUARANTEE
================================================================================
Inputs: the sealed-read phase_b extractions + tier-a-clean-strategy-receipt.json,
opened read-only. The live producer and binder are IMPORTED and CALLED, never
modified. The one counterfactual arm mutates an IN-MEMORY deepcopy of a compiled
spec dict and throws it away; the producer's emitted types are untouched.
Writes exactly one file: untyped-disposition-census.json.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

OUT = os.path.join(HERE, "untyped-disposition-census.json")

from src.engine.extraction.spec_producer import (  # noqa: E402
    UNTYPED_FAMILY,
    produce_spec_artifact,
)

# ★ R-301 §2/§3 — THE ENFORCED-LEVEL READ, IMPORTED SO IT IS MEASURED NOT ASSERTED.
# This artifact used to claim that a re-type to ENTER had "nothing downstream
# flagging it". That claimed ABSENCE is a claim exactly like a claimed presence and
# owes the same wiring-verify -- and it fails one: Leg A(ii) IS downstream and DOES
# flag it. Rather than swap one unverified sentence for another, the corrected claim
# is WIRED: `_check_concretely_bound` is the production (ii) predicate and is CALLED
# here, per family, in `counterfactual_bind_probe`. (Private by name, but it is the
# exact predicate the ruling names; calling the public Leg A entry point would drag
# certificates and countersignatures this read-only census has no business supplying.)
from src.engine.forensics.compile_fidelity import _check_concretely_bound  # noqa: E402
from src.engine.spec_family_bindings import FAMILY_META, compile_binding_plan  # noqa: E402

# ★ THE SELECTION RULE, THE BIND PREDICATE AND THE LOAD-BEARING RULE ARE
# IMPORTED, NEVER RESTATED. tier_a_compile_census.py owns "which strategies are
# the tier-A 11", "what counts as a BIND", and "which conditions are LOAD-BEARING".
# Restating any of them here would create a second instrument that could silently
# disagree with the census this artifact is a companion to.
#
# ★ R-301 §5(ii) — THE SEAM THAT WAS OPEN AND IS NOW CLOSED. The first two were
# genuinely imported; the LOAD-BEARING rule -- the one predicate that DEFINES the
# population this artifact dispositions -- was RESTATED as a literal
# (`c["role"] in ("spine", "trigger")`) in BOTH files, under prose claiming the
# predicates were imported "so this artifact cannot drift". A claimed protection
# that is not wired is the mirror of a claimed absence that is not true, and gets
# the same cure: `is_load_bearing` is now defined ONCE, in tier_a_compile_census,
# and imported here. The prose below now describes something that is real.
_spec = importlib.util.spec_from_file_location(
    "tier_a_census", os.path.join(HERE, "tier_a_compile_census.py"))
_tac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_tac)

PHASE_B = _tac.PHASE_B
RECEIPT = _tac.RECEIPT
LOAD_BEARING_ROLES = _tac.LOAD_BEARING_ROLES
is_load_bearing = _tac.is_load_bearing

# --------------------------------------------------------------------------- #
# Categories. A closed set -- the schema IS the decision boundary.
# --------------------------------------------------------------------------- #
CAT_TYPED = "DISPOSITIONED_TYPED"
CAT_DROPPED = "DROPPED_NOT_A_TAUGHT_TRADE_CONDITION"
CAT_DEIXIS = "LEFT_UNTYPED_DEIXIS"
CAT_NEWFAM = "LEFT_UNTYPED_NEW_FAMILY_DEMAND"
CATEGORIES = (CAT_TYPED, CAT_DROPPED, CAT_DEIXIS, CAT_NEWFAM)

GATE_BOUNDARIES = {
    "POPULATION_IDENTITY": (
        "Checks that the disposition table covers EXACTLY the load-bearing UNTYPED "
        "population re-derived from the corpus in this run -- no orphan row, no "
        "uncovered condition, and every covered row still UNTYPED and still "
        "load-bearing. It CANNOT tell whether a disposition is CORRECT; correctness "
        "of a judgment is what an independent grader re-derives."),
    "TAUGHT_TEXT_DRIFT": (
        "Checks that the prose each disposition was judged against is byte-identical "
        "(by hash) to the prose the corpus emits today. It catches a corpus or "
        "producer change silently re-pointing a judgment at different words. It says "
        "nothing about whether the judgment on those words was right."),
    "CATEGORY_CLOSURE": (
        "Checks that every row carries exactly one category from the closed set and "
        "that the category counts sum to the derived population. It is an internal "
        "consistency pin on the table's SHAPE, not independent evidence about the "
        "corpus -- the population count it closes against IS derived, the split "
        "across categories is the judgment being recorded."),
    "ZERO_YIELD_ARM_ACTUALLY_BIT": (
        "** THE HAZARD THIS GATE EXISTS FOR: a zero-yield result that is zero because the "
        "dispositioned arm DID NOTHING. If a stub or condition_id in the table failed to "
        "match, no re-type would be applied, the two arms would be the same compile, and "
        "the delta would be 0 -- a number that looks like the finding and is actually a "
        "no-op. So this gate requires (a) that exactly as many re-types and drops were "
        "APPLIED to spec copies as the table declares, and (b) that the mutation BIT: "
        "strictly fewer non-binding conditions in the dispositioned arm than in the "
        "baseline. (c) R-301 SS4 ADDS THE DECOMPOSITION CLOSURE: the published parts of "
        "the bite (denominator shrink + re-type flips - regressions) must SUM to the "
        "measured total, with zero collateral movement on conditions the table never "
        "touched. That third clause guards a DIFFERENT hazard from the first two -- they "
        "ask whether the arm moved at all, it asks whether the published explanation of "
        "the movement is the true one. It proves the zero is a MEASURED zero and its "
        "bite an EXPLAINED one; it does not prove any disposition is right, and it says "
        "nothing about whether zero is the right answer -- only that the arm was capable "
        "of returning a different one."),
    "EVERY_CONDITION_HAS_A_BINDING": (
        "Checks the binder emitted a binding row for every taught condition in both arms, "
        "so a missing binding cannot be silently read as 'does not bind' and quietly "
        "inflate the not-binding count. It says nothing about whether a binding is "
        "correct."),
}


def refuse_unless(ok: bool, gate: str, message: str) -> None:
    """A guard REFUSES: never `assert` (-O strips it), never exit 1 (reads as a crash)."""
    if ok:
        return
    boundary = GATE_BOUNDARIES.get(gate, "(no boundary declared -- itself a defect)")
    sys.stderr.write(
        f"\n{'=' * 78}\nGUARD REFUSED: {gate}\n{'=' * 78}\n{message}\n\n"
        f"  WHAT THIS GATE DOES NOT COVER (printed beside every verdict, red or green):\n"
        f"    {boundary}\n\nREFUSING TO PUBLISH. Exit 2 -- guard verdict, not a crash.\n")
    raise SystemExit(2)


def refuse_if_optimized() -> None:
    refuse_unless(not sys.flags.optimize, "OPTIMIZED_MODE", (
        "Invoked under `python -O`, which strips every `assert` in this process, "
        "including in the producer/binder modules this file imports. Re-run without -O."))


def _norm(t):
    return re.sub(r"\s+", " ", (t or "").strip().lower())


def _texthash(t):
    return hashlib.sha256(_norm(t).encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# THE JUDGMENT. This is the artifact's substance and it is a HUMAN-GRADE CENSUS
# CALL, not a classifier output. Each row carries the reasoning that earned it.
#
# CRITERION APPLIED THROUGHOUT -- "THE TYPE MUST PRESERVE THE TEACHING": a target
# family is nominated only when compiling to that family's primitive would keep
# the taught object rather than substitute a different one. A row whose taught
# object has no primitive anywhere in FAMILY_META is NEW-FAMILY DEMAND and stays
# UNTYPED; a row whose taught object is an unresolved on-screen pointer is DEIXIS
# and stays UNTYPED. Neither is a wiring gap that typing could close.
#
# `taught_text_sha16` is a DRIFT TRIPWIRE, not a copy of the text: the text
# itself is read live from the corpus and written to the artifact. If the corpus
# text moves under a judgment, this refuses instead of silently re-pointing it.
# --------------------------------------------------------------------------- #
DISPOSITIONS = (
    # ---------------- 11 DISPOSITIONED-TYPED (real-teaching mis-emits) --------
    {
        "stub": "0RBexa9JpIg__s0",
        "condition_id": "UNTYPED:you-need-to-identify-the-direction-of-th#0",
        "taught_text_sha16": "f541bd0368b0a9a9",
        "category": CAT_TYPED,
        "target_family": "WAIT_BIAS",
        "evidence": (
            "The taught object is DIRECTIONAL BIAS READ ON A HIGHER FRAME -- 'the "
            "direction of the trend' established on a 4-hour chart. That is verbatim "
            "the WAIT_BIAS semantic ('which way, on the higher frame'), and "
            "bias_engine.classify_institutional_regime is the family's declared "
            "primitive. The classifier scored NOTHING (unmatched) because its WAIT_BIAS "
            "stems require the literal forms 'trend is' / 'higher time frame', and this "
            "trader said 'direction of the trend' / '4 hour time frame'. The miss is "
            "vocabulary coverage, not an absent concept."),
        "fuzzy": False,
    },
    {
        "stub": "LD1FEbwXU4o__s0",
        "condition_id": "UNTYPED:you-can-identify-areas-that-have-not-bee#1",
        "taught_text_sha16": "108a370944c65bbc",
        "category": CAT_TYPED,
        "target_family": "WAIT_STRUCTURE",
        "evidence": (
            "The taught object is an UNTAPPED LIQUIDITY AREA -- a structural feature "
            "located on the chart. 'liquidity' is an explicitly declared WAIT_STRUCTURE "
            "stem. The classifier tied 1-1 (WAIT_RETEST 'tap' vs WAIT_STRUCTURE "
            "'liquidity') and honestly refused. ADJUDICATION: the 'tap' here is NEGATED "
            "-- 'areas that have NOT been tapped yet'. It is a property distinguishing "
            "which level to mark, not a retest event to wait for, so the retest evidence "
            "is spurious and WAIT_STRUCTURE wins outright."),
        "fuzzy": False,
    },
    {
        "stub": "LD1FEbwXU4o__s0",
        "condition_id": "UNTYPED:look-for-price-rapidly-approaching-a-zon#3",
        "taught_text_sha16": "aa9c2c858b8c70ba",
        "category": CAT_TYPED,
        "target_family": "WAIT_CONFIRMATION",
        "evidence": (
            "Four families tied at 1 (zone / tap / rejection / volume) -- a genuinely "
            "COMPOUND row teaching a sequence: approach a zone, volume spike, quick tap, "
            "rejection. ADJUDICATION: the DECISIVE event, the one whose absence cancels "
            "the trade, is the REJECTION printed at the zone; the zone and the tap are "
            "its location and its precondition. candle_confirmation_check is therefore "
            "the primitive that keeps the most teaching."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED. A 4-way tie on a compound row. No single family can carry all four "
            "clauses; typing it WAIT_CONFIRMATION keeps the rejection and LOSES the "
            "volume-spike and the zone identity. This row is real evidence for compound "
            "representation (sibling conditions), which is a compiler capability that "
            "does not exist. A grader could defensibly call this WAIT_STRUCTURE or "
            "WAIT_RETEST instead."),
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:firstly-the-candlestick-will-need-to-be#2",
        "taught_text_sha16": "f2675adf75bcb311",
        "category": CAT_TYPED,
        "target_family": "WAIT_BIAS",
        "evidence": (
            "The trader states the PURPOSE in the same breath as the observable: a green "
            "candlestick 'shows us that we are currently in an uptrend'. The taught "
            "object is therefore a DIRECTIONAL REGIME READ, which is the WAIT_BIAS "
            "semantic; the candle colour is the trader's proxy for it. Classifier scored "
            "nothing -- 'uptrend' is not a WAIT_BIAS stem ('trend is' / 'overall trend' "
            "are)."),
        "fuzzy": False,
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:firstly-the-candlesticks-will-need-to-be#5",
        "taught_text_sha16": "030bc83beb831c64",
        "category": CAT_TYPED,
        "target_family": "WAIT_BIAS",
        "evidence": (
            "The SHORT-side mirror of the row above, and stated even more explicitly: red "
            "candlesticks 'indicate that the trend of the market is currently bearish'. "
            "Taught object = directional regime. Same miss for the same reason "
            "('the trend of the market' is not the stem 'trend is')."),
        "fuzzy": False,
    },
    {
        "stub": "YqY0OkL5LMI__s0",
        "condition_id": "UNTYPED:it-was-a-really-solid-setup-for-a-pushba#2",
        "taught_text_sha16": "a995895a8d7df6b5",
        "category": CAT_TYPED,
        "target_family": "WAIT_STRUCTURE",
        "evidence": (
            "Inside a past-tense wrapper sits a concrete, fully specified level rule: "
            "'if it was able to start breaking out above that Friday high of day which "
            "was 18.74'. A named prior-session high WITH ITS PRICE is a structural level "
            "and a break of it is a structure event -- structure_engine is the primitive "
            "that keeps that teaching. The classifier scored zero because the stem is "
            "'high of the' and the trader said 'high of day'."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- the level-vs-narration boundary. The clause is delivered as "
            "commentary on a chart already drawn ('it WAS a really solid setup'), so a "
            "grader could route it to the DROPPED narration bucket alongside its sibling "
            "#1 in the same spec. It is kept as real teaching because, unlike that "
            "sibling, it names a threshold and a direction that a compiler could act on."),
    },
    {
        "stub": "dENM6gt8ZRg__s0",
        "condition_id": "UNTYPED:then-we-wait-for-a-breakout-a-breakout-i#1",
        "taught_text_sha16": "7574ae004de0727a",
        "category": CAT_TYPED,
        "target_family": "WAIT_STRUCTURE",
        "evidence": (
            "A RANGE BREAK with an explicit validity rule ('the candle body closes "
            "completely outside the range. Not a wick. Not a touch.'). 'range' is a "
            "declared WAIT_STRUCTURE stem and the taught object is the range boundary "
            "being taken out. The classifier tied 1-1 against WAIT_CONFIRMATION on "
            "'wick'. ADJUDICATION: 'not a wick' is an EXCLUSION clause -- the trader is "
            "ruling a wick OUT, so the wick is not the taught object at all, and "
            "WAIT_STRUCTURE wins outright."),
        "fuzzy": False,
    },
    {
        "stub": "dENM6gt8ZRg__s0",
        "condition_id": "UNTYPED:after-the-breakout-we-wait-for-a-retest#2",
        "taught_text_sha16": "e6daac0187d2bdf1",
        "category": CAT_TYPED,
        "target_family": "WAIT_RETEST",
        "evidence": (
            "The trader names the object with the family's own word and then DEFINES it "
            "('a retest is valid if the candle opened outside the range, the wick dipped "
            "inside, and the close is back outside'). retest_touch_check is the declared "
            "primitive. The classifier tied 4-way (retest / range / wick / open) purely "
            "because the trader's DEFINITION of the retest drags in three other "
            "families' stems -- the definition of a term should not outvote the term."),
        "fuzzy": False,
    },
    {
        "stub": "dENM6gt8ZRg__s0",
        "condition_id": "UNTYPED:entry-is-on-the-open-of-the-next-candle#4",
        "taught_text_sha16": "281cf0407877af01",
        "category": CAT_TYPED,
        "target_family": "ENTER",
        "evidence": (
            "This is the ENTRY ITSELF, stated as the completion of the preceding spine "
            "('entry is on the open of the next candle after the retest'), which is "
            "exactly what ENTER's spine_completion_trigger primitive represents. The "
            "classifier tied 1-1 between WAIT_SESSION ('open') and WAIT_RETEST "
            "('retest'); BOTH are spurious -- 'open' here is a CANDLE open, not a session "
            "open, and the retest is the antecedent this entry follows, not the entry."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED FOR A REASON THAT CUTS AGAINST THIS ROW'S OWN DISPOSITION: ENTER is "
            "the ONE target family in this table that binds NON-approximated AT THE "
            "BINDING LEVEL (see counterfactual_bind_probe). LEVEL QUALIFIER, REQUIRED "
            "(R-301 SS3): at the ENFORCED / Leg A(ii) level the same row reads the "
            "OPPOSITE -- _check_concretely_bound FAILS this re-type, 'bound to an "
            "approximation (proxy/pass-through, honest accounting): "
            "spine_completion_trigger', because the R-260 family anchor "
            "(FAMILY_META['ENTER'].enforced_honest_approximation()=True) convicts the "
            "family regardless of the per-binding flag. Its primitive fires on spine "
            "completion and does NOT carry the taught 'open of the NEXT candle' timing -- "
            "so a re-type here would produce a row that looks like a GENUINE bind while "
            "having discarded the bar-open semantics. CORRECTED (R-301 SS2): this note "
            "previously called that 'a worse hollow bind than the approximated kind, "
            "because nothing downstream flags it'. THE 'NOTHING DOWNSTREAM FLAGS IT' "
            "CLAUSE IS MEASURED FALSE and is struck -- Leg A(ii) IS downstream and DOES "
            "flag it. What is true is narrower and is the real reason this row is "
            "flagged: the row would be GENUINE-LOOKING at the binding level (the only "
            "counts_as_a_BIND=True re-type in this table) while convicted at the enforced "
            "level, so a reader applying the census's own bind predicate -- the predicate "
            "in the sentence above -- would be misled where the four approximated "
            "families visibly self-report. Recorded, not acted on."),
    },
    {
        "stub": "hcHuDfxdywI__s0",
        "condition_id": "UNTYPED:the-change-of-character-acted-as-an-entr#4",
        "taught_text_sha16": "d21743eaf8317084",
        "category": CAT_TYPED,
        "target_family": "WAIT_STRUCTURE",
        "evidence": (
            "'Change of character' (CHoCH) is a named MARKET-STRUCTURE event, sibling to "
            "break-of-structure, and structure_engine.compute_structure_state is the "
            "declared primitive for that class. Classifier scored zero: CHoCH is absent "
            "from the WAIT_STRUCTURE stem list even though 'break of structure' and "
            "'market structure' are present -- a coverage hole in one vocabulary, not a "
            "missing concept."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- the structure-vs-narration boundary. The sentence is phrased as "
            "retrospective interpretation ('ACTED AS an entry trigger RATHER THAN a "
            "reversal signal'), i.e. the trader explaining a past read. It is kept as "
            "real teaching because the distinction it draws (CHoCH as trigger, not as "
            "reversal) is a rule the trader applies, but a grader could route it to "
            "narration."),
    },
    {
        "stub": "st5e-YJRfKc__s1",
        "condition_id": "UNTYPED:in-this-case-price-pulled-back#1",
        "taught_text_sha16": "ca105c64cfbf494a",
        "category": CAT_TYPED,
        "target_family": "WAIT_RETEST",
        "evidence": (
            "The taught object is a PULLBACK -- price returning toward a prior level "
            "after the breakout named in the preceding condition. 'pull back' IS a "
            "declared WAIT_RETEST stem; it scored zero only because the trader inflected "
            "it as 'pulled back', and the stem matcher's inflection tail cannot reach an "
            "affix that lands INSIDE a two-token stem."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- the deixis boundary. The clause opens 'in this case', a pointer "
            "at an on-screen example. It is dispositioned as real teaching rather than "
            "deixis because the pointer scopes the EXAMPLE while the taught object "
            "('price pulled back') is fully named in the text; contrast the deixis rows, "
            "where the pointer IS the object."),
    },
    # ---------------- 2 DROPPED (metadata mis-emits) --------------------------
    {
        "stub": "LD1FEbwXU4o__s0",
        "condition_id": "UNTYPED:drop-to-the-5minut-or-the-1-minute-chart#2",
        "taught_text_sha16": "e636db757b69b71c",
        "category": CAT_DROPPED,
        "drop_disposition": (
            "AN EXECUTION-TIMEFRAME DECLARATION, NOT A TRADE CONDITION. 'Drop to the "
            "5 minute or the 1 minute chart' tells the reader WHICH CHART TO COMPILE ON. "
            "It is spec METADATA (the execution timeframe field), and nothing about it is "
            "a state of the market that could be true or false at a given bar -- so there "
            "is no predicate for any primitive to evaluate. Typing it to ANY family would "
            "manufacture a gate out of a setting. It is additionally OPTIONAL in the "
            "trader's own words ('if you're feeling a little bit risky'), which no "
            "condition slot can express. Correct home: the spec's timeframe metadata; "
            "correct disposition HERE: not a taught trade condition, remove from the "
            "load-bearing denominator."),
        "fuzzy": False,
    },
    {
        "stub": "YqY0OkL5LMI__s0",
        "condition_id": "UNTYPED:it-gapped-up-a-bit-from-the-previous-day#1",
        "taught_text_sha16": "fff72ce6877fb4c0",
        "category": CAT_DROPPED,
        "drop_disposition": (
            "PURE NARRATION. Past-tense recounting of what one specific instrument did on "
            "one specific morning ('it gapped up a bit from the previous days closed it "
            "actually opened up near that Hive day from Friday'). There is no imperative, "
            "no threshold, no rule the reader is told to apply -- the trader is reading "
            "the tape aloud to set the scene for the setup taught elsewhere in the same "
            "strategy. A narration row is not an unbound condition; it is a row that "
            "should never have entered the condition list, so it leaves the denominator "
            "rather than joining the honest-gap queue."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- narration-vs-teaching. The gap and the prior-day high it names "
            "ARE structural facts, and a grader who reads 'opened up near Friday's high' "
            "as an implied gap-and-go precondition would type it WAIT_STRUCTURE. It is "
            "dropped because the trader gives no threshold, no direction and no "
            "instruction -- contrast its sibling #2 in the same spec, which is kept as "
            "real teaching precisely because it supplies 18.74."),
    },
    # ---------------- 13 HONESTLY-UNTYPED: 5 DEIXIS ---------------------------
    {
        "stub": "pKzXxB9Blts__s0",
        "condition_id": "UNTYPED:this-needs-to-be-followed-by-a-trend-act#1",
        "taught_text_sha16": "2925095f5c2c8472",
        "category": CAT_DEIXIS,
        "referent_required": (
            "TWO unresolved pointers. (a) 'THIS needs to be followed by...' -- the "
            "antecedent setup, which exists only as the chart region the trader was "
            "pointing at. (b) 'a strong trend activity LIKE THIS ONE' -- the quantitative "
            "threshold for 'strong' is delegated entirely to an on-screen exemplar. "
            "Resolving this row needs the visual antecedent AND a measurable definition "
            "of trend strength; the prose supplies neither."),
        "evidence": (
            "Classifier scored zero on every family, correctly: there is no taught OBJECT "
            "in the text at all, only a relation between two things it does not name. "
            "Left UNTYPED on purpose -- pending the deixis-resolution lane, not pending a "
            "vocabulary fix."),
        "fuzzy": False,
    },
    {
        "stub": "pKzXxB9Blts__s0",
        "condition_id": "UNTYPED:that-means-short-from-here-short-from-he#5",
        "taught_text_sha16": "865c668f6cf0ea7a",
        "category": CAT_DEIXIS,
        "referent_required": (
            "'short from HERE' -- the entry price/level, which is the cursor position on "
            "the trader's chart. Also 'THAT means' -- the antecedent condition that "
            "licenses the short. Both referents are visual; the sentence names no level, "
            "no instrument state, and no threshold."),
        "evidence": (
            "Scored zero on every family. Note this row is an ENTRY instruction, so it is "
            "adjacent to ENTER -- but ENTER's spine_completion_trigger would fire on "
            "spine completion and silently invent the 'here' the trader never stated. "
            "Left UNTYPED: an unresolved entry level is a missing referent, not a missing "
            "family."),
        "fuzzy": False,
    },
    {
        "stub": "pKzXxB9Blts__s0",
        "condition_id": "UNTYPED:there-s-a-second-test-right-here-and-tha#7",
        "taught_text_sha16": "6310d0a456cbd499",
        "category": CAT_DEIXIS,
        "referent_required": (
            "'a second test RIGHT HERE' and 'another short from THIS PLACE' -- both the "
            "tested level and the entry location are cursor references. A 'second test' "
            "also presupposes a FIRST test that the text never identifies, so the row "
            "additionally needs the ordinal antecedent."),
        "evidence": (
            "Scored zero. The word 'test' is close to the WAIT_RETEST semantic, and a "
            "reader could be tempted to type it -- but retest_touch_check needs a LEVEL "
            "to touch, and this row's level exists only on screen. Typing it would "
            "produce a retest against a level chosen by the binder, not by the trader."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- deixis-vs-retest. This is the nearest-miss row in the table: the "
            "taught EVENT (a second test of a level) is squarely WAIT_RETEST, and only "
            "the missing referent keeps it out. If the deixis lane resolves the level, "
            "this row becomes a WAIT_RETEST candidate immediately."),
    },
    {
        "stub": "st5e-YJRfKc__s1",
        "condition_id": "UNTYPED:the-initial-breakout-took-place#0",
        "taught_text_sha16": "6c3fce398113df52",
        "category": CAT_DEIXIS,
        "referent_required": (
            "'THE initial breakout' -- a definite article with no antecedent in the "
            "condition text. What was broken (which range, which level, on which "
            "timeframe) is never stated; it is the structure the trader had already drawn "
            "on the chart. Resolving needs the broken level's identity."),
        "evidence": (
            "Scored zero on every family. The row cannot be typed WAIT_STRUCTURE the way "
            "dENM6gt8ZRg's breakout row can, because that row DEFINES its range and its "
            "validity rule while this one supplies five words of past-tense reference."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- deixis-vs-narration. 'took place' is past tense and could be read "
            "as narration and dropped. It is kept in the UNTYPED queue rather than "
            "dropped because it is the first condition of the spec's spine and the two "
            "conditions after it depend on it -- it is doing structural work in the "
            "sequence, which narration does not."),
    },
    {
        "stub": "st5e-YJRfKc__s1",
        "condition_id": "UNTYPED:then-we-re-looking-for-an-entry-back-tow#2",
        "taught_text_sha16": "20ca9c59708f4967",
        "category": CAT_DEIXIS,
        "referent_required": (
            "'THE LONG MARK' -- a named object that is never defined anywhere in the "
            "taught text. It is the trader's own on-chart annotation. Resolving needs the "
            "price (or the rule that derives it) that the long mark denotes."),
        "evidence": (
            "Scored zero. Like the 'short from here' row this is an ENTRY instruction "
            "whose entry LOCATION is the unresolved part, so ENTER would bind a trigger "
            "with no location. Left UNTYPED pending the referent."),
        "fuzzy": False,
    },
    # ---------------- 13 HONESTLY-UNTYPED: 8 NEW-FAMILY DEMAND ----------------
    {
        "stub": "ExB66jcyKxg__s0",
        "condition_id": "UNTYPED:whenever-the-candle-crosses-the-moving-a#0",
        "taught_text_sha16": "1329d5605e545549",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "MOVING-AVERAGE CROSS: a price/indicator relational primitive -- 'has the "
            "candle crossed the MA line, and in which direction'. Requires an MA series "
            "(period + type taught or defaulted) and a cross detector. No FAMILY_META "
            "family owns an indicator series: structure_engine reads structure, "
            "bias_engine reads regime, entry_quality reads confluence presence. There is "
            "no MA anywhere in the declared family universe."),
        "evidence": (
            "Classifier scored zero on all seven keyword families, which is the correct "
            "answer -- 'moving average' is not a stem in ANY of them. Typing it "
            "WAIT_CONFIRMATION on the trailing 'closes with a strong candle' would keep "
            "the confirmation half and DISCARD the cross, which is the actual trigger."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- compound row. It teaches an MA cross AND a strong-close "
            "confirmation. It is filed as new-family demand because the cross is the "
            "trigger and has no home; the confirmation half would fit an existing family "
            "and is the part a hasty typing would seize on."),
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:we-will-enter-into-a-buy-position-whenev#0",
        "taught_text_sha16": "7f651f80815c77d1",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "VWAP BAND BREAK: a VWAP series with standard-deviation bands, plus a "
            "'price closes/breaks beyond the upper band' detector. FAMILY_META has no "
            "VWAP primitive at all -- the nearest, structure_engine, computes structural "
            "levels from price action, not a volume-weighted mean and its bands."),
        "evidence": (
            "Scored zero on every family ('v-wap' is not a stem anywhere). The row also "
            "names the ENTRY, but the entry is CONDITIONED on the band break -- typing it "
            "ENTER would keep 'we buy' and discard the only thing that decides WHEN."),
        "fuzzy": False,
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:for-a-sell-position-we-will-need-for-the#1",
        "taught_text_sha16": "ce6cae6160161499",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "VWAP BAND BREAK, short side -- the exact mirror of the row above: price "
            "breaking below the LOWER VWAP band. Same absent primitive."),
        "evidence": "Scored zero on every family; same absent VWAP series.",
        "fuzzy": False,
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:secondly-the-price-must-break-above-the#3",
        "taught_text_sha16": "2c7111f688aba7eb",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "VWAP BAND BREAK -- the same upper-band break, restated by the trader as step "
            "2 of the enumerated checklist. Same absent primitive."),
        "evidence": (
            "Scored zero. The trailing sentence is rationale ('which would cause an even "
            "bigger increase in price'), not a second condition."),
        "fuzzy": False,
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:thirdly-the-point-of-control-must-be-wit#4",
        "taught_text_sha16": "f1ca0b852bd302f0",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "VOLUME-PROFILE POINT OF CONTROL, plus a CONTAINMENT test of that POC against "
            "the VWAP bands. Needs a volume-at-price distribution (POC = the price with "
            "maximum traded volume) AND the VWAP band series. Two absent primitives, "
            "neither in FAMILY_META. FILTER's confluence_factor_presence is a keyword-"
            "presence check, not a volume-profile computation, so it is not a home."),
        "evidence": (
            "Scored zero. The row's closing clause ('when all of these conditions have "
            "been met we will enter') is a spine-completion statement, which would tempt "
            "an ENTER typing -- but the load-bearing content is the POC-inside-bands "
            "test, which ENTER's trigger cannot evaluate."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- compound row carrying both a new-family test and an ENTER clause. "
            "Filed as new-family demand because the test is what gates the entry."),
    },
    {
        "stub": "YGdFksLavKE__s0",
        "condition_id": "UNTYPED:lastly-we-will-need-to-make-sure-that-th#7",
        "taught_text_sha16": "9f0897790cee248a",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "VOLUME-PROFILE POINT OF CONTROL inside the VWAP bands -- the short-side "
            "restatement of the row above. Same two absent primitives."),
        "evidence": (
            "Scored zero. Trailing 'so let's enter into the position' is again a "
            "spine-completion clause riding on the real test."),
        "fuzzy": True,
        "fuzzy_note": "FLAGGED for the same compound reason as its long-side twin.",
    },
    {
        "stub": "YqY0OkL5LMI__s0",
        "condition_id": "UNTYPED:this-had-a-double-inside-bar-set-up-on-t#0",
        "taught_text_sha16": "d6f523b47869f598",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "MULTI-BAR CANDLESTICK PATTERN DETECTOR -- specifically INSIDE BAR and its "
            "n-fold form (a bar whose range is contained by its predecessor's, twice "
            "consecutively), evaluated on a declared higher timeframe (daily). "
            "WAIT_CONFIRMATION's candle_confirmation_check evaluates a SINGLE "
            "confirming/rejecting candle at a level; it has no notion of a multi-bar "
            "containment pattern and no level to anchor to here."),
        "evidence": (
            "Scored zero on every family ('inside bar' is not a stem). This is the "
            "strategy's setup condition, not decoration -- the whole trade is named after "
            "it."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- narration-vs-demand. Phrased in the past tense about a specific "
            "chart ('THIS HAD a double inside bar'), so it shares surface form with the "
            "dropped narration row in the same spec. It is kept as a real demand because "
            "it names a REPEATABLE, mechanically detectable pattern with a stated "
            "timeframe, which narration does not."),
    },
    {
        "stub": "pKzXxB9Blts__s0",
        "condition_id": "UNTYPED:you-want-to-anchor-the-view-up-to-that-c#2",
        "taught_text_sha16": "52f350db36f37e2e",
        "category": CAT_NEWFAM,
        "demanded_primitive": (
            "ANCHORED INDICATOR PLACEMENT -- an anchor-bar selector ('the last candle of "
            "the rotation, the first candle of the sell-off') feeding an anchored series "
            "(anchored VWAP / anchored profile). Two things absent from FAMILY_META: a "
            "rotation/sell-off segmenter to find the anchor bar, and any anchored series "
            "to attach to it. No declared primitive takes an anchor argument at all."),
        "evidence": (
            "Scored zero on every family. This is an INSTRUMENT-SETUP instruction that is "
            "nevertheless load-bearing -- every later condition in this strategy is read "
            "off the anchored view -- so it is not droppable as metadata the way an "
            "execution-timeframe declaration is."),
        "fuzzy": True,
        "fuzzy_note": (
            "FLAGGED -- new-family-demand vs deixis. The row contains the pointer 'THAT "
            "candle', which is deictic; it is filed as new-family demand because the "
            "trader IMMEDIATELY self-resolves the pointer in the same sentence ('to the "
            "last candle of the rotation, which is the first candle of the sell-off'), so "
            "the referent is stated in prose -- what is missing is the primitive that "
            "could find it, not the referent."),
    },
)


def _by_key(rows):
    return {(r["stub"], r["condition_id"]): r for r in rows}


def _load_specs():
    """Compile the tier-A 11 through the LIVE producer. No mutation, no re-type."""
    receipt = json.load(open(RECEIPT, encoding="utf-8"))
    keep, _dropped = _tac.select_clean_strategies(receipt)
    specs = []
    for stub in sorted(keep):
        path = os.path.join(PHASE_B, f"{stub}.json")
        refuse_unless(os.path.exists(path), "POPULATION_IDENTITY",
                      f"extraction {stub} absent from sealed-read WD {PHASE_B}")
        doc = json.load(open(path, encoding="utf-8"))
        strategies = doc.get("strategies") or []
        refuse_unless(len(strategies) == 1, "POPULATION_IDENTITY",
                      f"{stub}: expected 1 strategy in file, found {len(strategies)}")
        art = produce_spec_artifact(strategies[0], video=stub, certificate=None,
                                    transcript_chars=0)
        specs.append((stub, art))
    return receipt, keep, specs


def _plan_index(spec):
    plan = compile_binding_plan(spec)
    return {b["condition_id"]: b for b in
            [x.to_dict() for x in plan.bindings]
            + [x.to_dict() for x in plan.invalidation_bindings]}


def _plan_objects(spec):
    """The same plan as `_plan_index`, but the BINDING OBJECTS -- `_check_concretely_bound`
    reads attributes, and the (ii) read must see the live re-derived binding, never a dict
    round-trip that could drop a field."""
    plan = compile_binding_plan(spec)
    return {b.condition_id: b for b in list(plan.bindings) + list(plan.invalidation_bindings)}


def main():  # noqa: C901
    refuse_if_optimized()
    receipt, keep, specs = _load_specs()

    # ---------------------------------------------------------------- DERIVE
    # RE-DERIVED HERE, NOT ACCEPTED FROM tier-a-compile-census.json. The only
    # thing imported from that module is the SELECTION RULE and the BIND
    # PREDICATE (definitions); every count below is recomputed from the compile.
    all_conds, lb_untyped = [], []
    per_spec = []
    for stub, art in specs:
        conds = art["spec"]["entry_conditions"] + art["spec"]["invalidations"]
        n_lb_u = 0
        for c in conds:
            load_bearing = is_load_bearing(c)  # IMPORTED rule -- never restated
            all_conds.append((stub, c, load_bearing))
            if c["type"] == UNTYPED_FAMILY and load_bearing:
                lb_untyped.append((stub, c))
                n_lb_u += 1
        per_spec.append({
            "stub": stub,
            "spec_hash": art["spec_hash"],
            "n_conditions": len(conds),
            "n_untyped": sum(1 for c in conds if c["type"] == UNTYPED_FAMILY),
            "n_load_bearing_untyped": n_lb_u,
        })

    n_total = len(all_conds)
    n_untyped = sum(1 for _s, c, _lb in all_conds if c["type"] == UNTYPED_FAMILY)
    n_typed = n_total - n_untyped
    n_lb_untyped = len(lb_untyped)

    out_of_universe = sorted({c["type"] for _s, c, _lb in all_conds
                              if c["type"] != UNTYPED_FAMILY and c["type"] not in FAMILY_META})
    refuse_unless(not out_of_universe, "POPULATION_IDENTITY",
                  f"conditions carry labels that are neither a FAMILY_META family nor "
                  f"UNTYPED: {out_of_universe}")
    refuse_unless(n_typed + n_untyped == n_total, "POPULATION_IDENTITY",
                  f"closure fails: typed {n_typed} + UNTYPED {n_untyped} != total {n_total}")

    # ------------------------------------------------- GATE: population identity
    derived_keys = {(s, c["id"]) for s, c in lb_untyped}
    table = _by_key(DISPOSITIONS)
    missing = sorted(derived_keys - set(table))
    orphan = sorted(set(table) - derived_keys)
    refuse_unless(not missing and not orphan, "POPULATION_IDENTITY",
                  f"the disposition table does not cover the re-derived population.\n"
                  f"  UNCOVERED conditions ({len(missing)}): {missing}\n"
                  f"  ORPHAN table rows  ({len(orphan)}): {orphan}")

    # ------------------------------------------------- GATE: taught-text drift
    text_by_key = {(s, c["id"]): c.get("object", "") for s, c in lb_untyped}
    conf_by_key = {(s, c["id"]): c.get("type_confidence") for s, c in lb_untyped}
    drift = [{"key": list(k), "pinned": table[k]["taught_text_sha16"],
              "live": _texthash(text_by_key[k])}
             for k in sorted(table) if _texthash(text_by_key[k]) != table[k]["taught_text_sha16"]]
    refuse_unless(not drift, "TAUGHT_TEXT_DRIFT",
                  f"the prose behind {len(drift)} disposition(s) has changed since the "
                  f"judgment was made; a judgment must not be silently re-pointed at "
                  f"different words: {json.dumps(drift, indent=2)}")

    # ------------------------------------------------- GATE: category closure
    bad_cat = sorted({r["category"] for r in DISPOSITIONS} - set(CATEGORIES))
    refuse_unless(not bad_cat, "CATEGORY_CLOSURE",
                  f"rows carry categories outside the closed set: {bad_cat}")
    cat_counts = Counter(r["category"] for r in DISPOSITIONS)
    refuse_unless(sum(cat_counts.values()) == n_lb_untyped, "CATEGORY_CLOSURE",
                  f"category counts {dict(cat_counts)} sum to {sum(cat_counts.values())}, "
                  f"which does not close on the re-derived load-bearing UNTYPED "
                  f"population {n_lb_untyped}")
    for r in DISPOSITIONS:
        cat = r["category"]
        need = {CAT_TYPED: "target_family", CAT_DROPPED: "drop_disposition",
                CAT_DEIXIS: "referent_required", CAT_NEWFAM: "demanded_primitive"}[cat]
        refuse_unless(bool(r.get(need)), "CATEGORY_CLOSURE",
                      f"{r['stub']}/{r['condition_id']} is {cat} but carries no `{need}` "
                      f"-- a category without its earned justification is a bare label")
        if cat == CAT_TYPED:
            refuse_unless(r["target_family"] in FAMILY_META, "CATEGORY_CLOSURE",
                          f"target_family {r['target_family']} is not in FAMILY_META")
        if r.get("fuzzy"):
            refuse_unless(bool(r.get("fuzzy_note")), "CATEGORY_CLOSURE",
                          f"{r['condition_id']} is flagged fuzzy with no fuzzy_note")

    # ------------------------------------- COUNTERFACTUAL BIND PROBE (MEASURED)
    # ★ The mechanism claim gets its OWN direct test. For every target family in
    # this table, take a REAL corpus condition, re-type an IN-MEMORY deepcopy, and
    # ask the PRODUCTION binder what it returns. Nothing is written back.
    probe_stub, probe_art = next((s, a) for s, a in specs
                                 if any(c["type"] == UNTYPED_FAMILY
                                        for c in a["spec"]["entry_conditions"]))
    probe = {}
    for fam in sorted({r["target_family"] for r in DISPOSITIONS if r["category"] == CAT_TYPED}
                      | {"WAIT_SESSION", UNTYPED_FAMILY}):
        sp = copy.deepcopy(probe_art["spec"])
        ids = []
        for c in sp["entry_conditions"] + sp["invalidations"]:
            if c["type"] == UNTYPED_FAMILY:
                ids.append(c["id"])
                if fam != UNTYPED_FAMILY:
                    c["type"] = fam
        objs = _plan_objects(sp)
        bo = objs.get(ids[0])
        b = bo.to_dict() if bo else {}
        # ★ R-301 §3 — THE SECOND LEVEL, MEASURED. `approximation` below is the
        # BINDING-level flag. Leg A(ii) does NOT read that flag alone: it anchors on
        # the family's ENFORCED honest accounting (R-260 §1), so the two levels can
        # DISAGREE -- and on ENTER they do. Publishing only the binding level is an
        # unqualified claim that is false at the level a reader will assume.
        ii = _check_concretely_bound(ids[0], bo) if bo else None
        probe[fam] = {
            "bindable": b.get("bindable"),
            "approximation": b.get("approximation"),
            "executed": b.get("executed"),
            "unbound_reason": b.get("reason"),
            "primitive": b.get("primitive"),
            "counts_as_a_BIND": bool(_tac.binds(b)) if b else False,
            "LEVEL_QUALIFIER__the_enforced_read_of_this_same_row": {
                "level_of_the_fields_above": (
                    "BINDING -- what compile_binding_plan stamped on this one binding"),
                "level_of_the_fields_below": (
                    "ENFORCED / Leg A(ii) -- what the shipped fidelity gate concludes, "
                    "anchored on the FAMILY's enforced honest accounting (R-260 SS1), "
                    "which is why it can and does disagree with the flag above"),
                "family_enforced_honest_approximation": (
                    FAMILY_META[fam].enforced_honest_approximation()
                    if fam in FAMILY_META else None),
                "leg_a_ii_PASSES": ii.passed if ii else None,
                "leg_a_ii_reason": ii.reason if ii else None,
            },
        }

    # ------------------------------------- ZERO-YIELD ARM (MEASURED, NOT CLAIMED)
    # BASELINE arm  : the shipped compile, untouched.
    # DISPOSITIONED : an in-memory copy where the 11 typed rows take their target
    #                 family and the 2 dropped rows leave the taught denominator.
    #                 The 13 honest gaps stay UNTYPED. This is the BEST CASE the
    #                 dispositions could possibly buy.
    def eligibility(arm):
        elig, detail = [], []
        applied = {"retypes": 0, "drops": 0, "missing_bindings": []}
        # ★ R-301 §4 -- the PER-CONDITION bind state of BOTH arms, kept so the
        # compound bite count can be DECOMPOSED rather than published as a bare total.
        # Recorded for every taught condition, including the dropped ones (whose
        # baseline state is exactly what makes the denominator shrink move the count).
        bind_map = {}
        for stub, art in specs:
            sp = copy.deepcopy(art["spec"])
            dropped_ids = set()
            if arm == "dispositioned":
                for c in sp["entry_conditions"] + sp["invalidations"]:
                    r = table.get((stub, c["id"]))
                    if not r:
                        continue
                    if r["category"] == CAT_TYPED:
                        c["type"] = r["target_family"]
                        applied["retypes"] += 1
                    elif r["category"] == CAT_DROPPED:
                        dropped_ids.add(c["id"])
                        applied["drops"] += 1
            idx = _plan_index(sp)
            for c in sp["entry_conditions"] + sp["invalidations"]:
                bind_map[(stub, c["id"])] = bool(
                    c["id"] in idx and _tac.binds(idx[c["id"]]))
            taught = [c for c in sp["entry_conditions"] + sp["invalidations"]
                      if c["id"] not in dropped_ids]
            applied["missing_bindings"] += [[stub, c["id"]] for c in taught
                                            if c["id"] not in idx]
            # A MISSING binding is NOT silently folded into "does not bind" -- it is
            # collected and refused by EVERY_CONDITION_HAS_A_BINDING below. It is
            # counted as non-binding only so this expression can complete first.
            nb = [c["id"] for c in taught
                  if c["id"] not in idx or not _tac.binds(idx[c["id"]])]
            if not nb:
                elig.append(stub)
            detail.append({"stub": stub, "n_taught_in_denominator": len(taught),
                           "n_binding": len(taught) - len(nb),
                           "n_still_not_binding": len(nb),
                           "eligible": not nb})
        return elig, detail, applied, bind_map

    base_elig, base_detail, base_applied, base_bind = eligibility("baseline")
    disp_elig, disp_detail, disp_applied, disp_bind = eligibility("dispositioned")
    yield_specs = len(disp_elig) - len(base_elig)

    # ------------------------------------------------- GATE: the arm actually bit
    missing = base_applied["missing_bindings"] + disp_applied["missing_bindings"]
    refuse_unless(not missing, "EVERY_CONDITION_HAS_A_BINDING",
                  f"the binder emitted no binding row for {len(missing)} taught "
                  f"condition(s): {missing}")
    refuse_unless(
        disp_applied["retypes"] == cat_counts.get(CAT_TYPED, 0)
        and disp_applied["drops"] == cat_counts.get(CAT_DROPPED, 0),
        "ZERO_YIELD_ARM_ACTUALLY_BIT",
        f"the dispositioned arm applied {disp_applied['retypes']} re-types and "
        f"{disp_applied['drops']} drops, but the table declares "
        f"{cat_counts.get(CAT_TYPED, 0)} and {cat_counts.get(CAT_DROPPED, 0)}. An arm "
        f"that did not apply its own dispositions would report a zero delta that means "
        f"nothing.")
    base_nb = sum(d["n_still_not_binding"] for d in base_detail)
    disp_nb = sum(d["n_still_not_binding"] for d in disp_detail)
    refuse_unless(disp_nb < base_nb, "ZERO_YIELD_ARM_ACTUALLY_BIT",
                  f"the dispositioned arm left {disp_nb} non-binding conditions against "
                  f"the baseline's {base_nb} -- the mutation did not BITE, so the zero "
                  f"delta is indistinguishable from a no-op and must not be published as "
                  f"a measurement.")

    # ----------------------------------------- R-301 §4: DECOMPOSE THE BITE
    # ★ `n_conditions_the_arm_moved` COMPOUNDS TWO MECHANISMS. Undecomposed it invites
    # the reading "N re-types bit", which is false. A compound count over heterogeneous
    # mechanisms owes its decomposition, and "every number COMPUTED or ABSENT" applies
    # to a number's PARTS as much as to its total -- so each part is derived here from
    # the per-condition bind state of both arms, never transcribed.
    moved_total = base_nb - disp_nb
    typed_keys = [(r["stub"], r["condition_id"]) for r in DISPOSITIONS
                  if r["category"] == CAT_TYPED]
    drop_keys = [(r["stub"], r["condition_id"]) for r in DISPOSITIONS
                 if r["category"] == CAT_DROPPED]
    # (a) DENOMINATOR SHRINK: a dropped condition leaves the taught denominator. It
    #     moves the count only if it was NON-BINDING in the baseline -- dropping a
    #     BINDING condition would shrink the denominator without moving this measure.
    moved_by_drop = [list(k) for k in drop_keys if not base_bind[k]]
    # (b) RE-TYPE FLIP: a re-typed condition that was non-binding and now BINDS.
    moved_by_retype_flip = [list(k) for k in typed_keys
                            if not base_bind[k] and disp_bind[k]]
    retype_moved_zero = [list(k) for k in typed_keys if base_bind[k] == disp_bind[k]]
    retype_regressed = [list(k) for k in typed_keys if base_bind[k] and not disp_bind[k]]
    # (c) COLLATERAL: any condition the table never touched whose bind state moved
    #     anyway. Expected 0; measured, because an unexplained remainder would mean the
    #     two arms differ somewhere the decomposition cannot see.
    untouched = [k for k in base_bind if k not in set(typed_keys) | set(drop_keys)]
    collateral = [list(k) for k in untouched if base_bind[k] != disp_bind[k]]
    explained = len(moved_by_drop) + len(moved_by_retype_flip) - len(retype_regressed)
    refuse_unless(
        explained == moved_total and not collateral, "ZERO_YIELD_ARM_ACTUALLY_BIT",
        f"the published decomposition does not close on the measured bite: "
        f"{len(moved_by_drop)} drop(s) + {len(moved_by_retype_flip)} re-type flip(s) "
        f"- {len(retype_regressed)} regression(s) = {explained}, against a measured "
        f"{moved_total}; collateral movement on untouched conditions: {collateral}. A "
        f"decomposition that does not sum to its total is a worse artifact than an "
        f"undecomposed total.")

    # ------------------------------------------------------------------ EMIT
    rows = []
    for k in sorted(table):
        r = table[k]
        rows.append({
            "spec_id": r["stub"],
            "condition_id": r["condition_id"],
            "taught_text": text_by_key[k],
            "taught_text_sha16": r["taught_text_sha16"],
            "producer_emitted_type": UNTYPED_FAMILY,
            "producer_type_confidence": conf_by_key[k],
            "why_the_producer_emitted_UNTYPED": (
                "unmatched -- no family produced ANY keyword evidence"
                if conf_by_key[k] == "unmatched" else
                "ambiguous -- two or more families TIED on evidence and the classifier "
                "refused to adjudicate"),
            "category": r["category"],
            "target_family": r.get("target_family"),
            "drop_disposition": r.get("drop_disposition"),
            "referent_required": r.get("referent_required"),
            "demanded_primitive": r.get("demanded_primitive"),
            "evidence_for_the_call": r.get("evidence"),
            "boundary_call_flagged": bool(r.get("fuzzy")),
            "boundary_call_note": r.get("fuzzy_note"),
            "target_family_declared_primitive": (
                FAMILY_META[r["target_family"]].primitive if r.get("target_family") else None),
            "would_this_retype_BIND": (
                probe.get(r["target_family"], {}).get("counts_as_a_BIND")
                if r.get("target_family") else None),
        })

    fam_targets = Counter(r["target_family"] for r in DISPOSITIONS
                          if r["category"] == CAT_TYPED)

    out = {
        "artifact": "untyped-disposition-census",
        "generator": "docs/replay-results/h1-battery/untyped_disposition_census.py",
        "reproduce": "python docs/replay-results/h1-battery/untyped_disposition_census.py",
        "ruling": "ADVISOR-RULINGS R-218 SS1 (chartered) re-sited CENSUS-SIDE by R-293 SS1",
        "mint_implemented": "AN ACCOUNTING FIX LANDS AT THE ACCOUNTING LAYER",

        "WHAT_THIS_ARTIFACT_IS": (
            "DENOMINATOR HONESTY. The earned, per-condition disposition of every "
            "LOAD-BEARING UNTYPED condition on the tier-A 11: what the trader was "
            "actually teaching, and therefore what the UNTYPED sink is standing in for "
            "on each row. It converts one undifferentiated blob into three populations "
            "with different owners."),
        "WHAT_THIS_ARTIFACT_IS_NOT": (
            "ELIGIBILITY RECOVERY. It recovers zero eligible specs -- see the "
            "ZERO_YIELD key, whose figure is MEASURED by re-running the production "
            "binder over a dispositioned arm, not asserted. Do not read any count here "
            "as a gain."),

        # ================= THE ZERO-YIELD STATEMENT, IN THE ARTIFACT ITSELF ====
        "ZERO_YIELD__n_specs_made_ELIGIBLE_by_these_dispositions_out_of_11": yield_specs,
        "ZERO_YIELD_STATEMENT": {
            "plainly": (
                f"THIS ARTIFACT RECOVERS {yield_specs} ELIGIBLE SPECS. Nothing here makes "
                f"any strategy compile, bind, or pass a gate that did not before. "
                f"Eligible specs BEFORE these dispositions: {len(base_elig)} of "
                f"{len(specs)}. Eligible specs AFTER applying every disposition in the "
                f"most favourable way possible: {len(disp_elig)} of {len(specs)}. "
                f"Delta: {yield_specs}."),
            "why_zero_even_for_the_11_typed_rows": (
                "Four of the five target families (WAIT_STRUCTURE, WAIT_RETEST, "
                "WAIT_CONFIRMATION, WAIT_BIAS) bind with approximation=True -- an ungated "
                "np.ones pass-through that is LOOSER than taught and therefore does NOT "
                "count as a BIND. A re-type would turn an honest unbound into a "
                "BOUND-BUT-APPROXIMATED row: the accounting improves, the gate does not. "
                "That is precisely the hollow compile this work was ordered to stop, and "
                "it is why the dispositions live here and not in the producer."),
            "the_one_family_that_binds_non_approximated_AT_THE_BINDING_LEVEL_is_a_WARNING_not_a_yield": (
                "ENTER binds with approximation=False AT THE BINDING LEVEL (MEASURED -- see "
                "counterfactual_bind_probe). ** THE LEVEL IS PART OF THE CLAIM (R-301 SS3), "
                "required and not stylistic: that False is the per-binding flag, and at the "
                "ENFORCED / Leg A(ii) level the SAME row reads the OPPOSITE -- "
                "FAMILY_META['ENTER'].enforced_honest_approximation() is True, so the shipped "
                "_check_concretely_bound FAILS the re-type with 'bound to an approximation "
                "(proxy/pass-through, honest accounting): spine_completion_trigger'. Both "
                "figures are MEASURED in this run and published side by side in the probe. "
                "** CORRECTION OF RECORD (R-301 SS2): this key previously said the re-type "
                "would pass 'with nothing downstream flagging it'. THAT WAS MEASURED FALSE. "
                "Leg A(ii) is downstream and DOES flag it, via the R-260 family anchor -- and "
                "no family in FAMILY_META reaches a (ii) PASS on this row (swept; see "
                "how_many_families_reach_a_Leg_A_ii_PASS_on_this_row). A CLAIMED ABSENCE OF A "
                "SAFEGUARD IS A CLAIM EXACTLY LIKE A CLAIMED PRESENCE and owes the same "
                "wiring-verify; that this one erred in the CONSERVATIVE direction (it made "
                "the safer census-side siting look MORE necessary) is the aggravator, not the "
                "excuse. ** WHAT IS ACTUALLY TRUE, and why the row is still a warning: its "
                "spine_completion_trigger fires on spine completion and carries none of the "
                "taught 'open of the NEXT candle' timing, so a re-type would produce a row "
                "that reads as a GENUINE bind under THIS census's own bind predicate -- "
                "counts_as_a_BIND=True, the flattering answer, the only such row in the "
                "table -- while the enforced honest accounting convicts it. The hazard is a "
                "DISAGREEMENT BETWEEN LEVELS that a binding-level reader would never see, not "
                "an absent downstream check. Exactly one row in this table targets ENTER and "
                "it is flagged for this reason."),
            "WAIT_SESSION_note": (
                "WAIT_SESSION is the only family whose bind is non-approximated AND "
                "content-checked -- but it binds only when the prose resolves to a known "
                "session zone, and the probe below shows it returning "
                "no_recognized_session_keyword on this corpus. The mission teaches no "
                "clean session names, so it is not an escape hatch either."),
            "measured_not_asserted": (
                "Both arms were produced by running compile_binding_plan (production "
                "binder, flags OFF) in this process. The dispositioned arm is an "
                "in-memory deepcopy; no producer output changed."),
            "the_zero_is_a_MEASURED_zero_not_a_NO_OP": {
                "why_this_matters": (
                    "A dispositioned arm that silently failed to apply anything would "
                    "also report a delta of 0. The arm is therefore required to BITE, and "
                    "the bite is published here: it moved condition-level binding and "
                    "STILL completed no spec."),
                "n_retypes_actually_applied_to_spec_copies": disp_applied["retypes"],
                "n_drops_actually_applied_to_spec_copies": disp_applied["drops"],
                "n_non_binding_conditions_baseline": base_nb,
                "n_non_binding_conditions_dispositioned": disp_nb,
                "n_conditions_the_arm_moved": base_nb - disp_nb,
                "DECOMPOSITION_of_n_conditions_the_arm_moved": {
                    "why_this_is_published_and_not_optional": (
                        "R-301 SS4. This total COMPOUNDS TWO MECHANISMS that have nothing "
                        "in common: conditions LEAVING the denominator, and a condition "
                        "actually starting to BIND. Left undecomposed it invites the "
                        "reading 'the re-types bit', which is FALSE -- almost all of them "
                        "moved it by exactly zero. A COMPOUND COUNT OVER HETEROGENEOUS "
                        "MECHANISMS OWES ITS DECOMPOSITION, and every part below is "
                        "COMPUTED from the per-condition bind state of both arms."),
                    "from_DENOMINATOR_SHRINK__dropped_rows_that_were_non_binding": len(
                        moved_by_drop),
                    "from_RE_TYPE_FLIP__a_condition_that_was_not_binding_and_now_BINDS": len(
                        moved_by_retype_flip),
                    "n_applied_retypes_that_moved_the_measure_by_ZERO": len(
                        retype_moved_zero),
                    "n_applied_retypes_that_REGRESSED_a_bind_to_non_binding": len(
                        retype_regressed),
                    "n_untouched_conditions_whose_bind_state_moved_anyway": len(collateral),
                    "taught_denominator_baseline_vs_dispositioned": {
                        "baseline": n_total, "dispositioned": n_total - len(drop_keys),
                        "note": (
                            "the drops are the ONLY reason these differ; the re-types "
                            "change a condition's type, never its presence")},
                    "which_rows": {
                        "the_drops_that_moved_it": moved_by_drop,
                        "the_re_types_that_flipped_to_BIND": moved_by_retype_flip},
                    "identity": (
                        f"{len(moved_by_drop)} (denominator shrink) + "
                        f"{len(moved_by_retype_flip)} (re-type flip) - "
                        f"{len(retype_regressed)} (regression) == {base_nb - disp_nb} "
                        f"(measured base_nb {base_nb} -> disp_nb {disp_nb})"),
                    "identity_is_GUARDED": (
                        "checked by the ZERO_YIELD_ARM_ACTUALLY_BIT gate, which also "
                        "refuses on any collateral movement -- a decomposition that does "
                        "not sum to its total would refuse to publish (exit 2)"),
                    "what_this_STRENGTHENS": (
                        "the R-293 census-side siting. The bite is real, so the zero is "
                        "measured and not a no-op -- but the ONE re-type that moved the "
                        "measure is the ENTER row, the very row whose bind is convicted at "
                        "the ENFORCED level (see counterfactual_bind_probe's LEVEL_QUALIFIER "
                        "block). The single 'improvement' the arm produced is an accounting "
                        "gain the fidelity gate refuses -- which is precisely the hollow "
                        "compile the typing was ordered to STOP, now visible as a number."),
                },
                "and_yet_n_specs_completed": yield_specs,
            },
        },

        "JUDGMENT_PROVENANCE": {
            "these_dispositions_are": "AN EARNED CENSUS JUDGMENT, made row by row",
            "these_dispositions_are_NOT": (
                "a classifier output. No code assigned any category below. Nothing here "
                "runs at produce time, and re-running _classify_family on these rows "
                "returns UNTYPED for all of them -- which is the point: the classifier's "
                "answer is honest and this is a different KIND of answer, made by a layer "
                "entitled to make it."),
            "criterion_applied": (
                "THE TYPE MUST PRESERVE THE TEACHING. A target family is nominated only "
                "when compiling to that family's declared primitive would keep the taught "
                "object rather than substitute a different one. Where no primitive could "
                "keep it, the row stays UNTYPED and says what is missing."),
            "doer_is_not_grader": (
                "The judgments here were made by the implementer of this artifact. They "
                "are re-derivable: every row carries its taught text, the producer's own "
                "type_confidence, and the reasoning, so a grader can disagree row by row "
                "without re-reading the corpus."),
            "boundary_calls_are_FLAGGED_not_hidden": (
                "Rows where a competent grader could land differently carry "
                "`boundary_call_flagged: true` and a note naming the alternative reading "
                "and why it lost. They are not smoothed over to make the table look "
                "cleaner than the evidence is."),
            "n_boundary_calls_flagged": sum(1 for r in DISPOSITIONS if r.get("fuzzy")),
        },

        "scope_line": (
            f"corpus = tier-A certified clean strategies (n={len(specs)} compiled of "
            f"{receipt['tier_a_clean_strategy_count']} certified clean) | extractions = "
            f"persisted sealed-read WD phase_b | producer = "
            f"src/engine/extraction/spec_producer.py READ-ONLY | binder = "
            f"compile_binding_plan, ALL FLAGS OFF | no bars, no battery, no survivor "
            f"arithmetic | dispositions are census-side records and are consumed by "
            f"NOTHING at runtime"),
        "extraction_source": PHASE_B,
        "selection_rule_source": (
            "IMPORTED from docs/replay-results/h1-battery/tier_a_compile_census.py "
            "(select_clean_strategies + binds + is_load_bearing) -- never restated, so "
            "this artifact cannot drift from the census it companions. R-301 SS5(ii): "
            "the LOAD-BEARING rule (`role in ('spine','trigger')`), the one predicate "
            "that DEFINES the dispositioned population, WAS restated as a literal in "
            "both files while this sentence claimed otherwise -- a claimed protection "
            "that was not wired. It is now defined ONCE (tier_a_compile_census."
            "is_load_bearing) and imported, so this sentence is now true of all three."),

        "DERIVATION_RE_DERIVED_IN_THIS_RUN": {
            "note": (
                "Every figure below was recomputed from the corpus in this process. "
                "Nothing was read from tier-a-compile-census.json."),
            "n_specs_compiled_over_n_specs_selected": {
                "numerator": len(specs), "denominator": len(keep),
                "question": "how many of the selected tier-A clean strategies compiled"},
            "n_taught_conditions_total": n_total,
            "n_typed_conditions_over_all_taught_conditions": {
                "numerator": n_typed, "denominator": n_total,
                "question": "how many taught conditions carry SOME FAMILY_META family"},
            "n_UNTYPED_conditions_over_all_taught_conditions": {
                "numerator": n_untyped, "denominator": n_total,
                "question": "how many taught conditions carry NO family at all"},
            "closure_identity": f"typed={n_typed} + UNTYPED={n_untyped} == total={n_total}",
            "closure_holds": n_typed + n_untyped == n_total,
            "n_LOAD_BEARING_UNTYPED_over_all_UNTYPED": {
                "numerator": n_lb_untyped, "denominator": n_untyped,
                "question": (
                    "of the conditions the producer could not type, how many sit on a "
                    "spine or trigger role -- i.e. how many actually gate a trade. THIS "
                    "NUMERATOR IS THE POPULATION THIS ARTIFACT DISPOSITIONS.")},
            "n_LOAD_BEARING_UNTYPED_over_all_taught_conditions": {
                "numerator": n_lb_untyped, "denominator": n_total,
                "question": (
                    "what share of everything these traders taught is both trade-gating "
                    "and un-typeable by the shipped classifier")},
            "load_bearing_rule": (
                f"role in {tuple(LOAD_BEARING_ROLES)} -- the tier-A census's own rule, "
                f"RENDERED FROM THE IMPORTED CONSTANT (tier_a_compile_census.LOAD_BEARING_ROLES / "
                f".is_load_bearing), not restated here; R-301 SS5(ii)"),
            "per_spec": per_spec,
        },

        "DISPOSITION_ROLLUP": {
            "population": n_lb_untyped,
            "counts_by_category_over_the_load_bearing_UNTYPED_population": {
                "numerators": {c: cat_counts.get(c, 0) for c in CATEGORIES},
                "denominator": n_lb_untyped,
                "question": (
                    "of the load-bearing conditions the producer could not type, how many "
                    "were REAL TEACHING it should have typed, how many were never trade "
                    "conditions at all, and how many are honest gaps awaiting their own "
                    "lane")},
            "DISPOSITIONED_TYPED_target_family_mix": {
                "numerators": dict(sorted(fam_targets.items())),
                "denominator": cat_counts.get(CAT_TYPED, 0),
                "question": (
                    "among the mis-emits that carry real teaching, which family would "
                    "have PRESERVED that teaching -- a record of what the classifier "
                    "should have said, NOT an instruction to make it say so")},
            "what_each_category_means": {
                CAT_TYPED: (
                    "REAL TEACHING, MIS-EMITTED. The trader taught a recognisable object "
                    "that an EXISTING FAMILY_META family owns. The producer missed it on "
                    "vocabulary coverage or refused an adjudicable tie. Owner: the "
                    "classifier-vocabulary lane. NOTE the target family is recorded, NOT "
                    "applied -- see ZERO_YIELD_STATEMENT."),
                CAT_DROPPED: (
                    "NOT A TAUGHT TRADE CONDITION. Metadata or narration that entered the "
                    "condition list by mistake. These rows should leave the load-bearing "
                    "denominator entirely -- they are not gaps to be closed, they are "
                    "over-collection by the extractor. Owner: the extraction lane."),
                CAT_DEIXIS: (
                    "HONEST GAP -- UNRESOLVED POINTER. The taught object exists only as "
                    "something the trader indicated on screen ('here', 'this', 'the long "
                    "mark'). No family can be nominated because the OBJECT is missing, "
                    "not the type. Owner: the deixis-resolution lane. LEFT UNTYPED ON "
                    "PURPOSE."),
                CAT_NEWFAM: (
                    "HONEST GAP -- NO PRIMITIVE EXISTS. The taught object is concrete and "
                    "mechanical but nothing in FAMILY_META can compute it (VWAP bands, "
                    "volume-profile POC, MA cross, multi-bar candle patterns, anchored "
                    "series). Typing it to a near neighbour would substitute a different "
                    "computation for the taught one. Owner: the new-family lane. LEFT "
                    "UNTYPED ON PURPOSE."),
            },
            "why_the_last_two_categories_STAY_UNTYPED": (
                "UNTYPED with reason=unknown_condition_type is the HONEST output for both "
                "of them: the binder fails closed and the row reads as 'not represented'. "
                "Any type at all would make it read as 'represented' -- the flattering "
                "direction. These 13 are not a backlog this artifact failed to clear; "
                "they are correctly refused pending work that does not exist yet."),
        },

        "counterfactual_bind_probe": {
            "what_this_measures": (
                "For each family this table nominates (plus WAIT_SESSION and UNTYPED as "
                "controls), what the PRODUCTION binder returns for a REAL corpus "
                "condition re-typed to that family. This is the DIRECT TEST of the "
                "mechanism claim that re-typing manufactures hollow compiles."),
            "method": (
                f"in-memory deepcopy of the compiled spec for {probe_stub}; its UNTYPED "
                f"conditions re-typed; compile_binding_plan run with flags OFF; the copy "
                f"discarded. The producer emitted nothing different and no spec_hash "
                f"moved."),
            "probe_spec": probe_stub,
            "UNTYPED_is_the_control": (
                "the UNTYPED row below is the SHIPPED state and shows an HONEST unbound "
                "(bindable=False, unknown_condition_type). Every other row is what a "
                "re-type would replace it with."),
            "results": {k: probe[k] for k in sorted(probe)},
            "reading": (
                "bindable=True with approximation=True is NOT a bind: it degrades to an "
                "ungated pass-through, so the condition stops gating anything while the "
                "row reports as bound. counts_as_a_BIND applies the tier-A census's own "
                "predicate (bindable AND NOT approximation AND executed) -- a BINDING-LEVEL "
                "predicate. THE LEVEL IS PART OF THE CLAIM (R-301 SS3): every row also "
                "carries LEVEL_QUALIFIER__the_enforced_read_of_this_same_row, which is what "
                "the shipped Leg A(ii) gate concludes about the SAME binding. Read them "
                "together. ENTER is the row where they disagree -- counts_as_a_BIND=True at "
                "the binding level, leg_a_ii_PASSES=False at the enforced level -- and that "
                "disagreement, not any absence of a downstream check, is what makes it a "
                "warning."),
            "how_many_families_reach_a_Leg_A_ii_PASS_on_this_row": sum(
                1 for p in probe.values()
                if p["LEVEL_QUALIFIER__the_enforced_read_of_this_same_row"]["leg_a_ii_PASSES"]),
        },

        "eligibility_arms": {
            "criterion": (
                "R-042 SS5 with the frozen-forensics default: a spec is ELIGIBLE iff "
                "EVERY taught condition in its denominator BINDS (bindable AND NOT "
                "approximation AND executed)"),
            "baseline": {
                "what_it_is": "the shipped compile, nothing changed",
                "n_eligible_over_n_specs": {"numerator": len(base_elig),
                                            "denominator": len(specs)},
                "eligible": sorted(base_elig),
                "per_spec": base_detail,
            },
            "dispositioned": {
                "what_it_is": (
                    "the MOST FAVOURABLE reading of this table: all 11 typed rows take "
                    "their target family, both dropped rows leave the denominator, the 13 "
                    "honest gaps stay UNTYPED. An upper bound on what these dispositions "
                    "could buy, applied in memory only."),
                "n_eligible_over_n_specs": {"numerator": len(disp_elig),
                                            "denominator": len(specs)},
                "eligible": sorted(disp_elig),
                "per_spec": disp_detail,
            },
            "delta_n_eligible_specs": yield_specs,
        },

        "LIVE_PRODUCER_UNTOUCHED": {
            "claim": (
                "no condition's emitted `type` and no `spec_hash` was changed by this "
                "packet; the dispositions are recorded here and applied NOWHERE"),
            "spec_hash_digest": {stub: art["spec_hash"] for stub, art in specs},
            "emitted_type_digest": hashlib.sha256(
                json.dumps([[stub, c["id"], c["type"]]
                            for stub, art in specs
                            for c in art["spec"]["entry_conditions"] + art["spec"]["invalidations"]],
                           sort_keys=True).encode("utf-8")).hexdigest(),
            "how_to_verify": (
                "check out the parent commit, run this generator, and compare "
                "spec_hash_digest and emitted_type_digest. Both are computed from the "
                "LIVE producer in whatever tree the generator runs in, so a producer "
                "change would move them."),
        },

        "gate_boundaries_printed_beside_every_verdict": GATE_BOUNDARIES,
        "rows": rows,
    }

    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=2, sort_keys=False, ensure_ascii=True)
        fh.write("\n")

    # ------------------------------------------------------------------ REPORT
    print("=== UNTYPED DISPOSITION CENSUS (census-side; R-218 SS1 via R-293 SS1) ===")
    print(out["scope_line"])
    print(f"\nRE-DERIVED: conditions n={n_total} across {len(specs)} specs")
    print(f"  typed={n_typed}  UNTYPED={n_untyped}  closure: {out['DERIVATION_RE_DERIVED_IN_THIS_RUN']['closure_identity']}"
          f"  -> {'HOLDS' if n_typed + n_untyped == n_total else 'FAILS'}")
    print(f"  LOAD-BEARING UNTYPED = {n_lb_untyped}  (of {n_untyped} UNTYPED, of {n_total} taught)")
    print("\n--- dispositions over the load-bearing UNTYPED population ---")
    for c in CATEGORIES:
        print(f"  {c:<40} {cat_counts.get(c, 0):>3}")
    print(f"  {'TOTAL':<40} {sum(cat_counts.values()):>3}")
    print("\n--- DISPOSITIONED_TYPED target families ---")
    for f, k in sorted(fam_targets.items()):
        print(f"  {f:<22} {k:>2}   binds? {probe[f]['counts_as_a_BIND']}  "
              f"(approximation={probe[f]['approximation']})")
    print("\n--- counterfactual bind probe (production binder, flags OFF) ---")
    print("    BINDING level ............................  | ENFORCED level (Leg A(ii))")
    for f in sorted(probe):
        p = probe[f]
        q = p["LEVEL_QUALIFIER__the_enforced_read_of_this_same_row"]
        print(f"  {f:<22} bindable={str(p['bindable']):<5} approx={str(p['approximation']):<5} "
              f"BIND={str(p['counts_as_a_BIND']):<5} | (ii) PASS={str(q['leg_a_ii_PASSES']):<5} "
              f"{p['unbound_reason'] or ''}")
    print(f"  families reaching a Leg A(ii) PASS on this row: "
          f"{out['counterfactual_bind_probe']['how_many_families_reach_a_Leg_A_ii_PASS_on_this_row']}"
          f" of {len(probe)} probed")
    print("\n--- ZERO-YIELD (measured) ---")
    print(f"  arm BIT: {disp_applied['retypes']} re-types + {disp_applied['drops']} drops "
          f"applied; non-binding conditions {base_nb} -> {disp_nb} "
          f"({base_nb - disp_nb} moved). The zero below is therefore a MEASURED zero, "
          f"not a no-op.")
    print(f"  BITE DECOMPOSED (R-301 SS4): {len(moved_by_drop)} from the DENOMINATOR SHRINK "
          f"(drops leaving, {n_total} -> {n_total - len(drop_keys)}) + "
          f"{len(moved_by_retype_flip)} RE-TYPE FLIP to BIND; "
          f"{len(retype_moved_zero)} of {disp_applied['retypes']} applied re-types moved it "
          f"by ZERO, {len(retype_regressed)} regressed, {len(collateral)} collateral.")
    print(f"  eligible BEFORE: {len(base_elig)}/{len(specs)}   "
          f"eligible AFTER all dispositions: {len(disp_elig)}/{len(specs)}   "
          f"DELTA = {yield_specs}")
    print(f"  {out['ZERO_YIELD_STATEMENT']['plainly']}")
    print(f"\nboundary calls FLAGGED: {out['JUDGMENT_PROVENANCE']['n_boundary_calls_flagged']} of {n_lb_untyped}")
    for gate, boundary in GATE_BOUNDARIES.items():
        print(f"  GATE {gate}: boundary -- {boundary}")
    print(f"\nartifact -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
