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


def test_the_pytest_command_in_the_runbook_names_the_right_failure_count():
    """The runbook says "expect 7 failures". If that drifts he cannot tell normal from broken."""
    text = io.open(RUNBOOK, encoding="utf-8").read()
    claimed = re.search(r"Expect \*\*(\d+) failures\*\*", text)
    assert claimed, "the runbook must state the expected failure count"
    r = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q", "--no-header",
                        "-p", "no:cacheprovider", "--ignore", str(Path(__file__))],
                       capture_output=True, text=True, timeout=1800)
    actual = len(re.findall(r"^FAILED", r.stdout, re.M))
    assert actual == int(claimed.group(1)), (
        f"the runbook promises {claimed.group(1)} failures, the suite produces {actual}. "
        f"He uses that number to tell normal from broken - update the runbook.")


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
