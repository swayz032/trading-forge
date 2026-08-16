"""LANE O1 birth gate -- `batch_locator` (AR-1234 §6).

Every acceptance control AR-1234 §6 names that is MECHANICAL is red-proofed here. The controls
that are SEMANTIC (§6.5 "no generic-disclaimer misgrounding", §6.6 "no worse than the isolated
benchmark") are deliberately absent: they are the external scorer's, and a test written by the
arm's own author asserting its own semantic quality would be exactly the self-grade
`worker-execution` §5 forbids.

Each negative assertion below carries a POSITIVE WITNESS that the checked path actually ran --
"found no leakage" is satisfied by a screen that cannot detect anything.
"""

from __future__ import annotations

import json
import os

import pytest

from src.engine.extraction import anchor_locator as al
from src.engine.extraction import batch_locator as bl

# --------------------------------------------------------------------------- #
# Fixtures -- synthetic, NOT sVkm. The module under test must never have seen a
# real source, so its birth gate must not hand it one either.
# --------------------------------------------------------------------------- #

TRANSCRIPT = (
    "welcome back to the channel today we are looking at a very simple idea. "
    "the first thing you do is mark the high and the low of that first candle. "
    "then you wait for a candle to close outside of that box before you do anything. "
    "i do want to say that nothing here is perfect and you will have losing trades. "
    "the target is always two times your risk and we do not move it."
)

CONDITIONS = [
    {"condition_ref": "entry_sequence[0].action", "condition_text": "mark the range high and low"},
    {"condition_ref": "entry_sequence[1].action", "condition_text": "wait for a close outside"},
    {"condition_ref": "targets[0].rationale", "condition_text": "fixed target at two times risk"},
]


def _rows(pairs):
    """(condition_ref, raw) -> verified rows, through the real verifier."""
    return bl.verify_trial(TRANSCRIPT, [{"condition_ref": r, "raw_output": q} for r, q in pairs])


# --------------------------------------------------------------------------- #
# 1. The brief: production rules reused verbatim, additions declared
# --------------------------------------------------------------------------- #


def test_rules_block_is_the_production_text_byte_for_byte():
    built = bl.build_batch_brief(al._SYSTEM_PROMPT)
    rules = built["reused_verbatim_from_production"]

    # POSITIVE WITNESS: the extracted block is real, non-trivial, and present in BOTH prompts.
    assert len(rules) > 200
    assert rules in al._SYSTEM_PROMPT
    assert rules in built["batch_brief"]
    # and it is the load-bearing part -- the three rules that stop invention.
    for must in ("VERBATIM", "SHORTEST contiguous span", "quote: null"):
        assert must in rules


def test_batch_brief_replaces_only_the_framing_and_the_output_contract():
    built = bl.build_batch_brief(al._SYSTEM_PROMPT)
    assert built["batch_brief"] == (
        f"{built['authored_for_batch_framing']}\n\n"
        f"{built['reused_verbatim_from_production']}\n\n"
        f"{built['authored_for_batch_output_contract']}"
    )
    # The single-condition framing MUST be gone, or the reader is told to answer one of N.
    assert "ONE extracted strategy condition" not in built["batch_brief"]
    assert "EACH condition" in built["batch_brief"]


def test_authored_additions_carry_no_domain_steer():
    """The parts I wrote must be mechanics only. A worked example, a synonym, or a hint about
    what the transcript contains would be a per-side advantage for a candidate from my own
    model family (AR-1232 §3)."""
    built = bl.build_batch_brief(al._SYSTEM_PROMPT)
    authored = (
        built["authored_for_batch_framing"] + " " + built["authored_for_batch_output_contract"]
    ).lower()
    steers = [
        "fair value", "fvg", "opening range", "breakout", "wick", "candle", "stop loss",
        "2r", "risk reward", "nine thirty", "9:30", "disclaimer",
    ]
    hits = [s for s in steers if s in authored]
    assert hits == [], f"authored brief text steers the reader: {hits}"

    # POSITIVE CONTROL: the same scan must fire on text that DOES steer, or it proves nothing.
    poisoned = authored + " look for the fair value gap after the breakout."
    assert [s for s in steers if s in poisoned], "the domain-steer scan cannot detect a steer"


def test_missing_rules_block_refuses_rather_than_guesses():
    with pytest.raises(ValueError):
        bl.production_rules_block("You are a locator. Return JSON matching the schema.")


# --------------------------------------------------------------------------- #
# 2. The delegation task
# --------------------------------------------------------------------------- #


def test_task_carries_every_condition_and_the_whole_transcript():
    task = bl.build_batch_task(al._SYSTEM_PROMPT, TRANSCRIPT, CONDITIONS)
    for c in CONDITIONS:
        assert c["condition_ref"] in task
        assert c["condition_text"] in task
    assert TRANSCRIPT in task
    assert "CONDITIONS (3):" in task


def test_task_preserves_extraction_order_and_refuses_an_empty_set():
    """DISCRIMINATING FIXTURE: these refs are deliberately NOT in alphabetical order. MEASURED --
    with the module's own `CONDITIONS` (which happen to be sorted) a mutation that sorted the
    list survived this test untouched; a fixture that agrees with the mutation cannot detect it.
    Ordering matters because the reader must see the extraction's order and not one imposed by
    anything downstream of the defect under investigation (`[ranked-by-the-extractor]`)."""
    unsorted = [
        {"condition_ref": "targets[0].rationale", "condition_text": "two times risk"},
        {"condition_ref": "entry_sequence[1].action", "condition_text": "close outside"},
        {"condition_ref": "confluences[0].description", "condition_text": "keep it simple"},
    ]
    task = bl.build_batch_task(al._SYSTEM_PROMPT, TRANSCRIPT, unsorted)
    positions = [task.index(c["condition_ref"]) for c in unsorted]
    assert positions == sorted(positions), "conditions were re-ordered on the way to the reader"
    assert [c["condition_ref"] for c in unsorted] != sorted(c["condition_ref"] for c in unsorted)

    with pytest.raises(ValueError):
        bl.build_batch_task(al._SYSTEM_PROMPT, TRANSCRIPT, [])


# --------------------------------------------------------------------------- #
# 3. Leakage screen -- AR-1234 §6 control 2, with its positive witness
# --------------------------------------------------------------------------- #

FORBIDDEN = [
    ("prior_gemma_answer", "nothing here is perfect and you will have losing trades"),
    ("prior_located_quote", "mark the high and the low of that first candle"),
]


def test_clean_task_screens_clean_AND_the_screen_is_provably_live():
    task = bl.build_batch_task(al._SYSTEM_PROMPT, TRANSCRIPT, CONDITIONS)

    # A transcript legitimately contains these sentences; leakage means an ANSWER shown to the
    # reader, so screen the parts that are not the transcript.
    brief_and_conditions = task.split("TRANSCRIPT:\n")[0]
    assert bl.screen_task_for_leakage(brief_and_conditions, FORBIDDEN) == []

    # POSITIVE WITNESS -- without this, the empty list above proves nothing (`[absence-claim]`).
    live = bl.screen_is_live(brief_and_conditions, FORBIDDEN)
    assert live["live"] is True
    assert live["fired_on_control"] >= 1


def test_screen_fires_on_a_planted_answer_key():
    task = bl.build_batch_task(al._SYSTEM_PROMPT, TRANSCRIPT, CONDITIONS)
    poisoned = task.split("TRANSCRIPT:\n")[0] + (
        "\nHINT: entry_sequence[0].action was previously located at "
        "'mark the high and the low of that first candle'."
    )
    hits = bl.screen_task_for_leakage(poisoned, FORBIDDEN)
    assert [h["label"] for h in hits] == ["prior_located_quote"]


def test_screen_declares_itself_dead_when_it_has_no_needles():
    """A screen run with an empty needle list returns [] -- and must SAY it is dead rather than
    let that [] be read as clean."""
    assert bl.screen_is_live("anything at all", [])["live"] is False


# --------------------------------------------------------------------------- #
# 4. Ingest -- raw is sacred, shape is enforced
# --------------------------------------------------------------------------- #


def test_quotes_pass_through_byte_identical_including_whitespace():
    ugly = "  then you wait for a candle to close outside of that box  "
    rows = bl.parse_batch_return(
        {"answers": [
            {"condition_ref": "entry_sequence[0].action", "quote": ugly},
            {"condition_ref": "entry_sequence[1].action", "quote": None},
            {"condition_ref": "targets[0].rationale", "quote": "two times your risk"},
        ]},
        [c["condition_ref"] for c in CONDITIONS],
    )
    assert rows[0]["raw_output"] == ugly          # not stripped, not normalised, not repaired
    assert rows[1]["raw_output"] is None
    assert [r["condition_ref"] for r in rows] == [c["condition_ref"] for c in CONDITIONS]


@pytest.mark.parametrize("payload,why", [
    ({"answers": [{"condition_ref": "entry_sequence[0].action", "quote": "x"}]}, "missing refs"),
    ({"answers": [{"condition_ref": c["condition_ref"], "quote": "x"} for c in CONDITIONS]
                 + [{"condition_ref": "invented[9].action", "quote": "x"}]}, "extra ref"),
    ({"answers": [{"condition_ref": CONDITIONS[0]["condition_ref"], "quote": "x"}] * 2}, "duplicate"),
    ({"answers": [{"condition_ref": c["condition_ref"]} for c in CONDITIONS]}, "no quote key"),
    ({"nope": []}, "no answers list"),
])
def test_malformed_returns_are_refused_never_repaired(payload, why):
    with pytest.raises(ValueError):
        bl.parse_batch_return(payload, [c["condition_ref"] for c in CONDITIONS])


def test_an_omitted_condition_is_not_silently_converted_into_a_decline():
    """The failure mode this guards: a reader that answers 11 of 12 looks identical to one that
    declined the 12th, and a decline is a legitimate answer while a no-show is not."""
    with pytest.raises(ValueError) as exc:
        bl.parse_batch_return(
            {"answers": [{"condition_ref": c["condition_ref"], "quote": "x"} for c in CONDITIONS[:2]]},
            [c["condition_ref"] for c in CONDITIONS],
        )
    assert "targets[0].rationale" in str(exc.value)


def test_a_json_string_return_is_accepted():
    payload = json.dumps({"answers": [{"condition_ref": c["condition_ref"], "quote": None}
                                      for c in CONDITIONS]})
    assert len(bl.parse_batch_return(payload, [c["condition_ref"] for c in CONDITIONS])) == 3


# --------------------------------------------------------------------------- #
# 5. The verifier is the production one, by import
# --------------------------------------------------------------------------- #


def test_verifier_actually_CALLS_the_production_fence(monkeypatch):
    """`bl.al._verify_and_locate is al._verify_and_locate` is trivially true of any module that
    imports it and proves nothing about whether `verify_answer` uses it. MEASURED: a mutation
    replacing the call with a naive `str.find` survived that identity assertion untouched. So
    this asserts the CALL, with a spy -- a positive witness that the path ran."""
    calls = []
    real = al._verify_and_locate

    def spy(transcript, quote):
        calls.append(quote)
        return real(transcript, quote)

    monkeypatch.setattr(al, "_verify_and_locate", spy)
    bl.verify_answer(TRANSCRIPT, "close outside of that box")
    assert calls == ["close outside of that box"]


def test_the_fence_is_the_whitespace_normalising_one_not_a_raw_substring_search():
    """DISCRIMINATOR: a quote whose whitespace shape differs from the transcript's. `str.find`
    returns -1; the production fence locates it. A verifier that passes this cannot be a naive
    substring search."""
    reflowed = "close  outside\n of\tthat box"
    assert TRANSCRIPT.find(reflowed) == -1                      # the naive check fails
    out = bl.verify_answer(TRANSCRIPT, reflowed)                # the production fence does not
    assert out["outcome"] == bl.OUTCOME_LITERAL
    s, e = out["char_span"]
    assert TRANSCRIPT[s:e] == "close outside of that box"


def test_literal_quote_locates_and_returns_the_transcript_slice():
    out = bl.verify_answer(TRANSCRIPT, "close outside of that box")
    assert out["outcome"] == bl.OUTCOME_LITERAL
    s, e = out["char_span"]
    assert TRANSCRIPT[s:e] == out["quote"]        # the slice, never the reader's own string


def test_a_paraphrase_fails_the_fence_and_an_abstention_is_distinct_from_a_failure():
    assert bl.verify_answer(TRANSCRIPT, "mark the top and bottom of candle one")["outcome"] == \
        bl.OUTCOME_NOT_LITERAL
    assert bl.verify_answer(TRANSCRIPT, None)["outcome"] == bl.OUTCOME_ABSTAINED


# --------------------------------------------------------------------------- #
# 6. Stability -- and the vacuous-green red-proof
# --------------------------------------------------------------------------- #


def test_one_trial_reports_UNTESTED_and_never_a_perfect_score():
    t1 = _rows([("a", "close outside of that box")])
    st = bl.stability([t1])
    assert st["summary"]["status"].startswith("UNTESTED")
    assert st["per_condition"]["a"]["identical_across_trials"] is None
    assert "identical_across_trials" not in st["summary"]


def test_two_identical_trials_measure_stable_and_two_differing_trials_measure_unstable():
    same = bl.stability([_rows([("a", "close outside of that box")]),
                         _rows([("a", "close outside of that box")])])
    assert same["summary"] == {"status": "MEASURED", "conditions_measured": 1,
                               "identical_across_trials": 1}

    differ = bl.stability([_rows([("a", "close outside of that box")]),
                           _rows([("a", "two times your risk")])])
    assert differ["summary"]["identical_across_trials"] == 0
    assert differ["per_condition"]["a"]["distinct_spans"] == 2


# --------------------------------------------------------------------------- #
# 7. Parity comparison -- mechanical only
# --------------------------------------------------------------------------- #


def test_every_agreement_class_is_reachable():
    batch = _rows([
        ("same", "close outside of that box"),
        ("overlap", "wait for a candle to close outside of that box"),
        ("different", "two times your risk"),
        ("only_batch", "the first thing you do is mark"),
        ("only_ref", None),
        ("neither", None),
    ])
    reference = _rows([
        ("same", "close outside of that box"),
        ("overlap", "close outside of that box"),
        ("different", "mark the high and the low"),
        ("only_batch", None),
        ("only_ref", "two times your risk"),
        ("neither", None),
    ])
    got = {r["condition_ref"]: r["agreement"] for r in
           bl.compare_to_reference(batch, reference)["rows"]}
    assert got == {
        "same": bl.AGREE_SAME_SPAN,
        "overlap": bl.AGREE_OVERLAP,
        "different": bl.AGREE_DIFFERENT,
        "only_batch": bl.AGREE_ONLY_BATCH,
        "only_ref": bl.AGREE_ONLY_REFERENCE,
        "neither": bl.AGREE_NEITHER,
    }


def test_comparison_emits_both_quotes_so_the_scorer_judges_on_words_not_on_my_verdict():
    batch = _rows([("x", "two times your risk")])
    reference = _rows([("x", "mark the high and the low")])
    row = bl.compare_to_reference(batch, reference)["rows"][0]
    assert row["batch_quote"] and row["reference_quotes"][0]
    assert row["batch_quote"] != row["reference_quotes"][0]
    # and it names who owns the judgment it is refusing to make
    assert "external scorer" in bl.compare_to_reference(batch, reference)["semantic_owner"]


# --------------------------------------------------------------------------- #
# 8. AR-1234 §6 control 10 -- no source-specific answer logic in the module
# --------------------------------------------------------------------------- #

_SOURCE_SPECIFIC = [
    "sVkmZklJDHI",
    "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc",
    "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823",
    "19546",          # the known mis-grounded disclaimer span (AR-1223)
    "14488",          # the real 2R teaching span
    "not perfect",    # the disclaimer's own words
]


def test_module_contains_no_video_pin_no_answer_span_and_no_source_words():
    path = os.path.join(os.path.dirname(bl.__file__), "batch_locator.py")
    with open(path, encoding="utf-8") as fh:
        body = fh.read()
    hits = [n for n in _SOURCE_SPECIFIC if n in body]
    assert hits == [], f"source-specific material in a source-agnostic module: {hits}"

    # POSITIVE CONTROL -- a scanner that cannot find a planted pin proves nothing about a clean
    # file. This one must fire (`[absence-claim]`: the live control in the same surface).
    planted = body + "\nVIDEO = 'sVkmZklJDHI'  # planted\n"
    assert [n for n in _SOURCE_SPECIFIC if n in planted], "the pin scanner cannot detect a pin"
