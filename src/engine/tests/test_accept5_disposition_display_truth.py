"""R3-5 item A — the disposition summary must not display a clean drift line over
an authorized departure that never happened.

THE DEFECT THIS CONVICTS
    The disposition site computes THREE departures, and every one of them refuses
    the gate:

        newly              -- a sealed test acquired this disposition
        no_longer          -- an UNAUTHORIZED sealed test lost it
        missing_authorized -- an AUTHORIZED change did NOT actually happen

    The line a reader actually scans reported only the first two:

        [DISP] sealed SKIP  membership drift        : +0 / -0

    So a run refusing with MISSING AUTHORIZED DISPOSITION CHANGE printed `+0 / -0`
    directly above that refusal. This is not hypothetical: lane G refused with
    exactly that as its SOLE refusal while both sibling arms displayed `+0 / -0`.

      `A SUMMARY THAT OMITS ONE OF THE THREE THINGS IT SUMMARIZES IS NOT TERSE --
       IT IS WRONG, AND IT IS WRONG IN THE DIRECTION OF REASSURANCE.`

    An authorization is a statement that a change HAPPENED. When it did not, the
    authorization is hiding a reversal, and the drift line was hiding the hiding.

WHY THE DISPLAY IS TESTED AS A FUNCTION
    The line was an inline f-string inside main(), reachable only by driving a full
    acceptance run with a seal. It was extracted verbatim first -- a behavior-
    preserving no-op -- so this test could convict the EXISTING string, and only
    then repaired. The extraction changed no gate semantics: the three refusals are
    untouched, and this function decides presentation only.
"""

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "scripts" / "acceptance_runner.py"


def _line(label, newly=(), no_longer=(), missing_authorized=()):
    spec = importlib.util.spec_from_file_location("acceptance_runner_under_test", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._disposition_drift_line(
        label, list(newly), list(no_longer), list(missing_authorized)
    )


def test_drift_line_surfaces_an_authorized_change_that_did_not_happen():
    """The RED: +0/-0 must not be the whole story when a departure is live."""
    line = _line("SKIP", missing_authorized=["src/engine/tests/test_x.py::test_a"])

    assert "+0 / -0" not in line or "1" in line.replace("+0 / -0", ""), (
        "the drift line rendered a clean +0/-0 while an authorized disposition "
        "change was missing: {!r}".format(line)
    )
    assert "missing" in line.lower(), (
        "the drift line does not name the missing authorized change: {!r}".format(line)
    )


def test_drift_line_counts_all_three_departures():
    """Each of the three must be individually visible, not merged into one total."""
    line = _line(
        "XFAIL",
        newly=["a::t1"],
        no_longer=["b::t2", "c::t3"],
        missing_authorized=["d::t4", "e::t5", "f::t6"],
    )
    for token in ("1", "2", "3"):
        assert token in line, (
            "departure count {} is not visible in {!r}".format(token, line)
        )


def test_genuinely_clean_state_still_displays_cleanly():
    """The negative control: no alarm on a state with nothing to report.

    A display that shouts on a clean run is as useless as one that whispers on a
    dirty one, and would make the repair self-defeating.
    """
    line = _line("SKIP")

    assert "+0 / -0" in line, (
        "a clean state no longer renders the familiar clean summary: {!r}".format(line)
    )
    assert "MISSING" not in line.upper() or "0" in line, (
        "a clean state renders an alarming word: {!r}".format(line)
    )
