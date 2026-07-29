"""DETERMINISM TEST for the unlock-distance ranker.  AR-428 / R-451(b) as amended by R-452.

THE CONTRACT UNDER TEST
    same frozen census + same class mapping + same counterfactual
        -> BYTE-IDENTICAL ranking on every run, across >= 12 PYTHONHASHSEED values.

WHY THE FIXTURE CONTAINS A TIE  (R-452 §1 -- and the amendment is the whole point)
    `gen_ledger.py`'s defect is not "iteration order varies". Iteration order varies
    harmlessly whenever there is a strict maximum at every step. The defect is
    "iteration order varies AND there is a genuine tie AND the tie is consequential."
    On UNTIED input the broken instrument passes twelve seeds cleanly, so a test built
    on untied input is a green check with no path to red.

    The fixture below reproduces the shape of the real defect measured in AR-427 §2,
    where C5 and C7 each cleaned exactly 13 videos but led to 17 vs 19 one step later:

        v1 {C7}          v2 {C5}          v3 {C7,C9}    v4 {C7,C9}    v5 {C5,C9}

        k=1: C5 alone cleans 1, C7 alone cleans 1   <-- GENUINE TIE
        k=2: {C7,C9} cleans 3   but   {C5,C9} cleans 2   <-- CONSEQUENTIAL

    The trap is deliberately laid so the ALPHABETICALLY FIRST tied class (C5) is the
    WRONG one. A naive `sorted(tied)[0]` greedy is deterministic and still wrong, so
    this fixture has power against BOTH failure modes -- unstable order AND stable
    order that is stably suboptimal.

TESTS
    1. determinism    -- 12 seeds, byte-identical output from the SHIPPED code path.
    2. DISCRIMINATION -- the same fixture run through the RETIRED gen_ledger tie-break
                         must produce DIFFERING output across seeds. If it does not,
                         the fixture proves nothing and this file FAILS LOUDLY rather
                         than reporting a pass it did not earn.
    3. correctness    -- the exhaustive chain must find [1, 3, 5], the true optimum,
                         which the naive greedy misses.
    4. real census    -- SKIPPED unless the (uncommitted, operator-data) census is
                         present; reported as SKIPPED, never as passed.

RUN
    python test_unlock_ranker_determinism.py
    pytest  test_unlock_ranker_determinism.py -q
NOT wired into CI: further CI-lane work is forbidden to this seat (R-451 FORBIDDEN).
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import unlock_ranker_core as core  # noqa: E402

SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]     # >= 12, per R-451(b)

C5 = "C5_unsupported_temporal_or_control_flow"
C7 = "C7_malformed_extraction"
C9 = "C9_RESIDUAL_none_of_these"

# The fixture, declarative and frozen in source: video -> blocking classes.
TIED_FIXTURE = {
    "TIEvid00001": [C7],
    "TIEvid00002": [C5],
    "TIEvid00003": [C7, C9],
    "TIEvid00004": [C7, C9],
    "TIEvid00005": [C5, C9],
}
INSTRUMENTS = ["mcl", "mes", "mnq"]                 # the real 3x fan-out


def write_fixture(dirpath):
    """Materialize the fixture in the REAL census schema, so the test exercises the
    real loader (`load_frozen`) rather than a shortcut around it."""
    strategies, classified = [], []
    for video, classes in sorted(TIED_FIXTURE.items()):
        for inst in INSTRUMENTS:
            sid = f"{video}-{inst}"
            refusals = []
            for i, cls in enumerate(sorted(classes)):
                cond = f"WAIT_CONFIRMATION:cond{i}#{i}"
                refusals.append({"strategy_id": sid, "condition_id": cond,
                                 "rule_text": f"fixture text {i}", "semantic_type": "WAIT",
                                 "role": "spine", "reason": "no_recognized_session_keyword",
                                 "rule_class": "MANDATORY"})
                classified.append({"strategy_id": sid, "condition_id": cond,
                                   "video": video, "remediation_class": cls,
                                   "rule_text": f"fixture text {i}", "role": "spine",
                                   "reason": "no_recognized_session_keyword",
                                   "rule_class": "MANDATORY", "semantic_type": "WAIT"})
            strategies.append({"strategy_id": sid,
                               "name": f"fixture_spec_{video.lower()}_{inst}_5m",
                               "video": video, "refused": True, "refusals": refusals,
                               "bindings": [], "warnings": [], "lifecycle_state": "CANDIDATE"})
    census = {"backtests_total": 0, "strategies_total": len(strategies),
              "rows_with_compiled_spec": len(strategies), "strategies": strategies}
    cp = os.path.join(dirpath, "fixture_census.json")
    lp = os.path.join(dirpath, "fixture_classified.json")
    with open(cp, "w", encoding="utf-8") as fh:
        json.dump(census, fh, indent=1)
    with open(lp, "w", encoding="utf-8") as fh:
        json.dump(classified, fh, indent=1)
    return cp, lp


def emit(mode, census_path, classified_path):
    """Entry point re-executed in a subprocess under a controlled PYTHONHASHSEED."""
    videos, _ = core.load_frozen(census_path, classified_path)
    if mode == "shipped":
        payload = {"chain": core.optimal_chain(videos),
                   "alone": core.each_class_alone(videos),
                   "ranking": core.rank_specs(videos)}
    elif mode == "legacy":
        payload = {"chain": core.legacy_greedy_chain_RETIRED(videos)}
    else:
        raise SystemExit(f"unknown mode {mode}")
    sys.stdout.write(core.serialize(payload))


def run_under_seed(seed, mode, census_path, classified_path):
    env = dict(os.environ, PYTHONHASHSEED=str(seed))
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__), "--emit", mode, census_path, classified_path],
        env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError(f"emit failed (seed={seed}, mode={mode}):\n{proc.stderr}")
    return proc.stdout


# ------------------------------------------------------------------- the tests
def test_shipped_ranker_is_deterministic_on_a_tied_input():
    with tempfile.TemporaryDirectory() as td:
        cp, lp = write_fixture(td)
        outs = {s: run_under_seed(s, "shipped", cp, lp) for s in SEEDS}
        distinct = sorted(set(outs.values()))
        assert len(distinct) == 1, (
            f"RANKER IS NON-DETERMINISTIC: {len(distinct)} distinct outputs across "
            f"{len(SEEDS)} seeds. This is a FINDING -- report it, do not patch it quietly.")


def test_the_fixture_discriminates_against_the_retired_instrument():
    """R-452: a determinism test that cannot convict the known-broken instrument
    has not been shown to bite. If this ever passes, the fixture lost its tie and
    test 1 above has become vacuous."""
    with tempfile.TemporaryDirectory() as td:
        cp, lp = write_fixture(td)
        outs = {s: run_under_seed(s, "legacy", cp, lp) for s in SEEDS}
        distinct = sorted(set(outs.values()))
        assert len(distinct) > 1, (
            "FIXTURE HAS NO POWER: the retired gen_ledger tie-break produced identical "
            f"output across all {len(SEEDS)} seeds, so it contains no consequential tie "
            "and the determinism test above certifies nothing.")


def test_exhaustive_chain_beats_the_naive_greedy_on_the_fixture():
    with tempfile.TemporaryDirectory() as td:
        cp, lp = write_fixture(td)
        videos, _ = core.load_frozen(cp, lp)
        chain = [e["videos_clean"] for e in core.optimal_chain(videos)]
        assert chain == [1, 3, 5], f"expected the true optimum [1, 3, 5], got {chain}"
        # the alphabetically-first tied class is the trap, and it is really a tie
        assert core.videos_clean_under(videos, {C5}) == core.videos_clean_under(videos, {C7}) == 1
        assert core.videos_clean_under(videos, {C5, C9}) == 2
        assert core.videos_clean_under(videos, {C7, C9}) == 3


def test_canonical_spec_label_is_group_derived_not_first_row():
    names = ["long_entry_mcl_5m", "long_entry_mes_5m", "long_entry_mnq_5m"]
    label, status = core.canonical_spec_label(names)
    assert (label, status) == ("long_entry_5m", "OK"), (label, status)
    # order-independence: the label is a function of the GROUP, not of row order
    for perm in ([names[2], names[0], names[1]], [names[1], names[2], names[0]]):
        assert core.canonical_spec_label(perm) == (label, status), "label depends on row order"
    # the timeframe token is NOT removed -- it does not vary, so removing it would
    # be domain knowledge, not measurement (AR-427's hand-edit went further than this)
    assert label.endswith("_5m")


def test_label_rule_FLAGS_the_residual_cases_instead_of_stripping_silently():
    """R-453 §2: an ordered taxonomy owes a residual category, or the classifier
    must mis-file or go silent -- and both hide the finding."""
    # two varying positions -> not a clean fan-out group
    label, status = core.canonical_spec_label(
        ["a_mcl_5m", "a_mes_15m", "a_mnq_30m"])
    assert status.startswith("RESIDUAL_2_varying_token_positions"), status
    assert label == "a_mcl_5m", "residual must pass through the FULL name, not a stripped one"
    # varying token is not an instrument code
    label, status = core.canonical_spec_label(["a_v1_5m", "a_v2_5m", "a_v3_5m"])
    assert status.startswith("RESIDUAL_varying_token_not_an_instrument_code"), status
    assert label == "a_v1_5m"
    # differing token counts
    _, status = core.canonical_spec_label(["a_mcl_5m", "a_b_mes_5m"])
    assert status == "RESIDUAL_token_count_differs_across_group", status
    # a clean group is still OK -- the control, so this test can tell
    # "flags everything" from "flags the right things"
    assert core.canonical_spec_label(["a_mcl_5m", "a_mes_5m", "a_mnq_5m"])[1] == "OK"


REAL_CENSUS = os.environ.get("POP120_CENSUS")
REAL_CLASSIFIED = os.environ.get("POP120_CLASSIFIED")


def test_real_census_determinism():
    """SKIPPED unless the operator-data census is present. Reported as SKIPPED --
    never as a pass (R-451: absence from a list is not a pass)."""
    if not (REAL_CENSUS and REAL_CLASSIFIED
            and os.path.exists(REAL_CENSUS) and os.path.exists(REAL_CLASSIFIED)):
        print("SKIPPED: set POP120_CENSUS / POP120_CLASSIFIED to run against the real census")
        return "skipped"
    outs = {s: run_under_seed(s, "shipped", REAL_CENSUS, REAL_CLASSIFIED) for s in SEEDS}
    assert len(set(outs.values())) == 1, "RANKER IS NON-DETERMINISTIC ON THE REAL CENSUS"


TESTS = [test_shipped_ranker_is_deterministic_on_a_tied_input,
         test_the_fixture_discriminates_against_the_retired_instrument,
         test_exhaustive_chain_beats_the_naive_greedy_on_the_fixture,
         test_canonical_spec_label_is_group_derived_not_first_row,
         test_label_rule_FLAGS_the_residual_cases_instead_of_stripping_silently,
         test_real_census_determinism]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--emit":
        return emit(sys.argv[2], sys.argv[3], sys.argv[4])
    failed = 0
    for t in TESTS:
        try:
            res = t()
            print(f"{'SKIP' if res == 'skipped' else 'PASS'}  {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {t.__name__}\n      {exc}")
    print(f"\n{len(TESTS) - failed}/{len(TESTS)} ok, {failed} failed  "
          f"({len(SEEDS)} PYTHONHASHSEED values per determinism check)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
