"""TRIGGER SAFETY — the blast radius over the PINNED corpus, re-derived, not recalled.

AUTHORITY: `R-747 §6` step 3. Population NAMED and PINNED at `R-746 §4`:
`docs/replay-results/h1-battery/tier-a-compile-census.json`, blob `23f30eb0`, `11` specs.

WHY THE POPULATION IS PINNED BY BLOB
------------------------------------
`R-746 §4` refused the external read's phrase *"the measured corpus"* because this campaign
already carries THREE unreconstructable populations (`80` / `81` / `68`) that no ruling ever
named, and a fourth would be worse than none.

    `NEVER WRITE "N of M" UNLESS YOU CAN NAME ALL M FROM A COMMITTED DOC.`
    (`[unenumerated-ladder]`)

So the census blob is asserted here. If the census is regenerated, this test fails LOUDLY
rather than silently re-scoping the claim onto a different population.

WHAT THIS GUARDS AGAINST
------------------------
A semantic classification rule is a MIGRATION if it touches more than it names. The committed
artifact records a disposition for EVERY condition — `AFFECTED` or `UNAFFECTED`, with the
condition that stood it down — and this test RE-DERIVES the whole thing and requires exact
membership. A rule that quietly widens to a second condition fails here, by name.
"""

from __future__ import annotations

import json
from pathlib import Path

from src.engine.breakout_confirmation_ambiguity import (
    OUTCOME_ELIGIBLE,
    classify_breakout_confirmation_ambiguity,
)
from src.engine.extraction.spec_producer import produce_spec_artifact

CENSUS = Path("docs/replay-results/h1-battery/tier-a-compile-census.json")
CENSUS_BLOB = "23f30eb0c0fadef14ac0557910d7d6824e89eff6"
EXTRACTIONS = Path("docs/replay-results/h1-battery/tier-a-extraction-provenance")
ARTIFACT = Path("docs/replay-results/h1-battery/trigger-safety-blast-radius.json")

GOLDEN_AFFECTED = (
    "st5e-YJRfKc__s0",
    "WAIT_STRUCTURE:when-price-breaks-above-the-range-high-f#4",
)


def _git_blob(path: Path) -> str:
    """Git's own blob id for the file ON DISK, computed the way git computes it.

    Derived rather than shelling out to git, so this control works in a checkout with no
    git binary and cannot be fooled by a stale index entry.
    """
    import hashlib

    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def _derive() -> list[dict]:
    """Re-run the rule READ-ONLY over every condition of every pinned spec."""
    stubs = [s["stub"] for s in json.loads(CENSUS.read_text(encoding="utf-8"))["specs"]]
    rows: list[dict] = []
    for stub in stubs:
        doc = json.loads((EXTRACTIONS / f"{stub}.json").read_text(encoding="utf-8"))
        strategies = doc.get("strategies") or []
        assert len(strategies) == 1, f"{stub}: expected one within-video strategy"
        spec = produce_spec_artifact(
            strategies[0], video=stub, certificate=None, transcript_chars=0
        )["spec"]
        trigger_id = str(spec.get("entry_trigger_id") or "")
        has_or = any(
            c.get("type") == "OPENING_RANGE_DEFINITION" for c in spec["entry_conditions"]
        )
        for cond in spec["entry_conditions"]:
            verdict = classify_breakout_confirmation_ambiguity(
                is_entry_trigger=(cond["id"] == trigger_id),
                text=cond["object"],
                opening_range_defined_in_spec=has_or,
            )
            # KEYED ON `outcome`, NOT ON `ambiguous`. R-749 §1: two of the three outcomes
            # REFUSE, so `ambiguous` stopped meaning "affected" the moment
            # CONFIRMED_BUT_UNIMPLEMENTED existed. Reading the boolean here would file a
            # refused clearer-teacher trigger as UNAFFECTED and under-report the blast
            # radius -- an instrument that lies in the safe-looking direction.
            affected = verdict.outcome != OUTCOME_ELIGIBLE
            rows.append(
                {
                    "stub": stub,
                    "condition_id": cond["id"],
                    "disposition": "AFFECTED" if affected else "UNAFFECTED",
                    "stood_down_at": None if affected else verdict.evidence[-1][0],
                }
            )
    return rows


def test_the_pinned_population_is_the_one_that_was_ruled():
    """The census blob, asserted. A different population is a different claim."""
    assert CENSUS.exists(), "the pinned tier-A census is missing; the population is unnamed"
    assert _git_blob(CENSUS) == CENSUS_BLOB, (
        "the tier-A census has changed blob. This test's AFFECTED/UNAFFECTED membership was "
        f"derived against {CENSUS_BLOB}; re-deriving it against a different population would "
        "silently re-scope the claim (R-746 §4, [population-no-instrument])."
    )


def test_every_condition_is_dispositioned_with_no_silent_drops():
    """`n_affected + n_unaffected` must exhaust the scanned population.

    An unenumerated remainder is how a blast-radius claim becomes unfalsifiable: a condition
    that is neither AFFECTED nor UNAFFECTED has simply not been looked at, and a report that
    omits it reads as coverage.
    """
    committed = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    rows = committed["conditions"]
    assert len(rows) == committed["n_conditions"]
    assert committed["n_affected"] + committed["n_unaffected"] == committed["n_conditions"]
    assert committed["n_not_measured"] == 0
    assert all(r["disposition"] in ("AFFECTED", "UNAFFECTED") for r in rows)


def test_blast_radius_re_derives_to_exactly_the_committed_membership():
    """RE-DERIVED, never compared against a recalled number.

    `A HAND-COPIED EXPECTED VALUE IS A FABRICATED SAFETY CLAIM` (`[hardcoded-test]`), so the
    committed artifact is checked against a fresh run of the real rule over the real specs.
    """
    committed = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    derived = _derive()

    def key(rows):
        return sorted((r["stub"], r["condition_id"], r["disposition"]) for r in rows)

    assert key(derived) == key(committed["conditions"]), (
        "the blast radius no longer matches its committed artifact. If the change is "
        "INTENDED, regenerate the artifact and commit the diff deliberately — a silent "
        "widening is exactly what this file exists to make loud."
    )


def test_exactly_one_condition_in_the_whole_corpus_is_affected():
    """THE CLAIM THAT MATTERS, stated as membership rather than as a count.

    A count can be reproduced by a different condition. Naming the member is what makes this
    a blast-radius proof instead of an arithmetic coincidence.
    """
    derived = _derive()
    affected = [(r["stub"], r["condition_id"]) for r in derived if r["disposition"] == "AFFECTED"]
    assert affected == [GOLDEN_AFFECTED], (
        f"the rule touches {affected} — expected exactly the golden breakout trigger. "
        "A classifier that touches more than it names is a migration wearing a fix's name."
    )


def test_the_other_opening_range_member_is_untouched():
    """DISCRIMINATION, and it is the sharpest one available in the frozen population.

    `dENM6gt8ZRg__s0` is the OTHER opening-range member — it carries an opening-range
    definition, so it passes condition (2) — and its trigger is still UNAFFECTED because it
    does not express a crossing relationship with the range boundary. Two members of the same
    family, opposite outcomes, decided by the sentence rather than by identity.
    """
    derived = _derive()
    rows = [r for r in derived if r["stub"] == "dENM6gt8ZRg__s0"]
    assert rows, "the second opening-range member vanished from the population"
    assert all(r["disposition"] == "UNAFFECTED" for r in rows)


def test_unaffected_conditions_record_which_condition_stood_them_down():
    """An UNAFFECTED verdict owes its reason, or it cannot be audited.

    Without this, "93 unaffected" is indistinguishable from a rule that returned False for
    93 different wrong reasons — including a crash swallowed into a default.
    """
    committed = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    unaffected = [r for r in committed["conditions"] if r["disposition"] == "UNAFFECTED"]
    assert unaffected
    valid = {
        "is_entry_trigger",
        "opening_range_defined_in_spec",
        "references_boundary",
        "crossing_relationship",
        "confirmation_specified",
    }
    for row in unaffected:
        assert row["stood_down_at"] in valid, (
            f"{row['condition_id']} stood down at {row['stood_down_at']!r}, which is not one "
            "of the four semantic conditions — the evidence trail is broken"
        )
