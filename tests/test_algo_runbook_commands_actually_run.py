"""Every command the runbook tells the operator to type must actually run.

ALGO-026 section 1(a). After 2026-08-27 there is no Claude. The operator will type these
commands and paste the output to GPT, so a command that errors is not a cosmetic defect - it is
the difference between him getting help and getting stuck.

THIS EXISTS BECAUSE IT ALREADY HAPPENED. `..._evidence_eras` was documented in the runbook and
CRASHED with `KeyError: 'TIMEZONE_UNRESOLVED'` - its `main()` still printed a key that had been
renamed. Every unit test passed, because they all call `measure()` and none of them call
`main()`. A CLI is only proven by running the CLI.
"""
from __future__ import annotations

import io
import re
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

RUNBOOK = Path("ALGO-RUNBOOK.md")

#: Commands the runbook documents as fast and read-only. The 6-minute exam and the full test
#: suite are excluded by name below - they are covered elsewhere and would dominate this run.
SLOW_OR_COVERED_ELSEWHERE = {
    "research.run_frozen_14_case_baseline",   # ~6 min, covered by its own artifacts + tests
}


def _documented_modules() -> list[str]:
    """Every `python -m <module>` the runbook tells him to type, read FROM the runbook."""
    text = io.open(RUNBOOK, encoding="utf-8").read()
    mods = set(re.findall(r"python -m ([A-Za-z0-9_.]+)", text))
    # The runbook also lists module SUFFIXES in a table under a shared prefix.
    prefix = "current_mnq_strategy_v2_4_"
    mods |= {f"research.{m}" for m in re.findall(rf"`({prefix}[a-z0-9_]+)`", text)}
    # Drop the bare prefix. The runbook writes "python -m research." once as a TABLE HEADER
    # whose rows carry the suffixes, and that is not a command anyone types.
    return sorted(m for m in mods
                  if m.startswith("research.") and len(m.split(".")) == 2 and m.split(".")[1])


def test_the_runbook_exists_and_documents_commands():
    """A guard over an empty population proves nothing."""
    assert RUNBOOK.exists(), "the runbook is the ALGO-026 section 1(a) deliverable"
    mods = _documented_modules()
    assert len(mods) >= 5, f"only found {mods} - the extractor is probably broken"


@pytest.mark.parametrize("module", [m for m in _documented_modules()
                                    if m not in SLOW_OR_COVERED_ELSEWHERE])
def test_a_documented_command_runs_without_error(module):
    """Runs the real CLI in a subprocess, exactly as the operator would type it."""
    r = subprocess.run([sys.executable, "-m", module],
                       capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, (
        f"the runbook tells the operator to run `python -m {module}` and it EXITS "
        f"{r.returncode}.\n--- stderr ---\n{r.stderr[-1500:]}")
    assert r.stdout.strip(), f"`{module}` printed nothing - he would have nothing to paste"


def test_the_pytest_command_in_the_runbook_names_the_right_failures():
    """The runbook tells him which failures are normal. Assert the SET, never the count.

    CONVERTED FROM A COUNT TO A MEMBERSHIP ASSERTION, 2026-08-27 (ALGO-177 §ORDER-3).
    A COUNT SURVIVES A SWAP: if one expected failure starts passing while one new failure appears,
    the total is unchanged and a count-based guard stays green through a real regression. The same
    law had already been applied to the memory index and to the regression comparison on the same
    day; this was the third surface carrying it.

    The runbook ALREADY listed the seven names - the guard simply was not reading them. The data
    was there and the assertion was weaker than the documentation it checked.
    """
    text = io.open(RUNBOOK, encoding="utf-8").read()
    claimed = re.search(r"Expect \*\*(\d+) failures\*\*", text)
    assert claimed, "the runbook must state the expected failures"
    listed = {ln.strip() for ln in re.findall(r"^tests/\S+::\S+$", text, re.M)}
    assert listed, "the runbook must LIST the expected failures by node id, not only count them"
    assert len(listed) == int(claimed.group(1)), (
        f"the runbook's own count ({claimed.group(1)}) disagrees with its own list ({len(listed)}) "
        f"- fix the runbook before trusting either")

    r = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q", "--no-header",
                        "-p", "no:cacheprovider", "--ignore", str(Path(__file__))],
                       capture_output=True, text=True, timeout=1800)
    # `removeprefix` BEFORE `split`, not after: splitting first yields the literal "FAILED" and the
    # prefix strip then does nothing, so every row parses to the same token.
    actual = {ln.removeprefix("FAILED ").split(" ", 1)[0].strip()
              for ln in re.findall(r"^FAILED .*$", r.stdout, re.M)}
    # VACUITY GUARD: an empty parse would make `unexpected` empty and the new-failure assertion
    # green while saying nothing at all about the run.
    assert actual, (
        "parsed NO failing node ids from the subprocess output - the assertions below would be "
        "vacuous. First 500 chars:\n" + r.stdout[:500])
    assert all(t.startswith("tests/") or t.startswith("tests\\") for t in actual), (
        f"parsed tokens do not look like node ids: {sorted(actual)[:5]}")

    unexpected = actual - listed
    fixed = listed - actual
    assert not unexpected, (
        f"NEW failures the runbook does not list - these are the ones that matter:\n  "
        + "\n  ".join(sorted(unexpected)))
    assert not fixed, (
        f"the runbook lists failures that now PASS. Not a crisis, but the list is stale and he "
        f"would be looking for a failure that no longer happens:\n  " + "\n  ".join(sorted(fixed)))


def test_the_runbook_states_what_does_not_exist():
    """A runbook that hides its holes is worse than none - ALGO-026 wanted honest gaps."""
    text = io.open(RUNBOOK, encoding="utf-8").read()
    assert "no \"start the bot\" command" in text.lower() or \
           "no start command exists" in text.lower()
    assert "Honest gaps" in text


def test_the_runbook_carries_the_hard_gate_and_the_flatten_caveat():
    """The two things that could cost him money if he reads past them."""
    text = io.open(RUNBOOK, encoding="utf-8").read()
    assert "A FAILED CLOSE STOPS THE REST" in text, "the flatten caveat is measured, not optional"
    assert "check your positions" in text.lower()
    assert "evaluation accounts and broker-paper" in text.lower(), (
        "the gate must say it covers eval and paper, not just funded")


def test_it_does_not_tell_him_to_edit_the_frozen_labels():
    text = io.open(RUNBOOK, encoding="utf-8").read().lower()
    assert "never edit" in text and "labels_frozen" in text
