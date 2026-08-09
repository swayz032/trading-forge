"""B1 STEP 6A — the five PARAMETER-GRAMMAR FIREBREAK proofs.

AUTHORITY: R-738 §4, verbatim — the STEP 6 acceptance suite must PROVE all five.

WHY THIS FILE EXISTS AT ALL
---------------------------
R-738 §3 decided that an opening-range duration is a source-sanctioned VARIANT,
not a parameter, so `ConditionBinding.parameters` stays `None` and the grammar
reserved to the advisor desk by R-678 §6 stays unwritten. That decision is a
CLAIM until something fails when someone breaks it.

    `A RULING THAT SAYS "WE DID NOT WRITE THE RESERVED FIELD" IS A CLAIM;
     A TEST THAT FAILS WHEN SOMEONE DOES IS A CONTROL.`
    `A RESERVATION WITH NO TEST IS A CONVENTION, AND CONVENTIONS ARE WHAT THE
     NEXT SEAT DOES NOT KNOW ABOUT.`  (R-738 §4)

ON FIREBREAK 1, AND THE SHAPE OF THE PROOF
------------------------------------------
§4 item 1 asks that `parameters` remain `None` for BOTH opening-range bindings.
This file proves the UNIVERSAL form instead: no production code anywhere
constructs a `ConditionBinding` with a `parameters=` argument, and the field's
declared default is `None`. That entails item 1 for both bindings and for every
other binding as well.

Stated plainly because a stronger proof of a different proposition is still a
different proposition: this is a claim about the WRITERS, and item 1 is a claim
about two INSTANCES. They coincide only because a field nothing writes keeps its
default — which is exactly what item 2 asserts and this file measures.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from src.engine.spec_family_bindings import ConditionBinding

REPO = Path.cwd()
PRODUCTION_ROOT = REPO / "src"
STEP_6A_MODULES = (
    "src/engine/opening_range_candidate.py",
    "src/engine/opening_range_lowering.py",
)
INDICATOR_PARAMS_TS = "src/server/lib/indicator-params.ts"
INDICATOR_PARAMS_PINNED_BLOB = "497c049adbfa532df9d27bb3f0966ba7a05767a7"
"""The blob this file had when STEP 6A began. R-738 §4 item 3 requires it
UNTOUCHED, and a pinned blob is what makes "untouched" auditable rather than
asserted."""

PARAMETER_GUARD_SUITES = (
    "src/engine/tests/test_parameter_acceptance_guard.py",
    "src/engine/tests/test_flag_off_parameterized_refusal.py",
    "src/engine/tests/test_bias_parameter_transmission.py",
    "src/engine/tests/test_bias_wired_path_parameters.py",
    "src/engine/tests/test_short_frame_parameter_acknowledgement.py",
    "src/engine/tests/test_parameter_collision.py",
)


def _production_python() -> list[Path]:
    return [
        path
        for path in PRODUCTION_ROOT.rglob("*.py")
        if "/tests/" not in path.as_posix() and "__pycache__" not in path.as_posix()
    ]


# ── firebreak 1 + 2 ──────────────────────────────────────────────────────────


def test_condition_binding_parameters_still_defaults_to_none():
    """Firebreak 1, the field half."""
    field = ConditionBinding.__dataclass_fields__["parameters"]
    assert field.default is None, (
        "ConditionBinding.parameters no longer defaults to None — the reserved "
        "field now carries a value by construction"
    )


def test_step_6a_introduces_no_production_writer_to_the_reserved_field():
    """Firebreak 2, and the one that entails firebreak 1 for every binding.

    Scoped to `ConditionBinding(...)` constructions specifically. Other types in
    this repo have their own unrelated `parameters=` fields, and convicting
    those would be measuring the neighbouring object.
    """
    construction = re.compile(r"ConditionBinding\s*\((?P<args>[^)]*)\)", re.DOTALL)
    offenders: list[str] = []
    for path in _production_python():
        text = open(path, encoding="utf-8").read()
        for match in construction.finditer(text):
            if re.search(r"\bparameters\s*=", match.group("args")):
                offenders.append(path.as_posix())
    assert offenders == [], (
        f"production code constructs ConditionBinding with parameters=: {offenders}. "
        "THE FIRST PRODUCTION WRITER OF A FIELD RESERVED FOR A FUTURE DESIGN IS "
        "THE DESIGN (R-678 §6, R-738 §2)."
    )


def test_the_writer_scan_can_actually_find_a_writer():
    """POSITIVE CONTROL for the scan above.

    An empty offender list is equally well explained by a regex that matches
    nothing. This feeds the scanner a synthetic construction and requires it to
    convict — without it, firebreak 2 is a green check with no path to red.
    """
    construction = re.compile(r"ConditionBinding\s*\((?P<args>[^)]*)\)", re.DOTALL)
    planted = "binding = ConditionBinding(condition_id='x', parameters=(('duration_minutes', 5),))"
    hits = [
        m for m in construction.finditer(planted) if re.search(r"\bparameters\s*=", m.group("args"))
    ]
    assert len(hits) == 1, "the writer scan cannot detect a writer; firebreak 2 proves nothing"


# ── firebreak 3 + 4 ──────────────────────────────────────────────────────────


def test_indicator_params_ts_is_untouched():
    """Firebreak 3. The docstring on the reserved field says the grammar must one
    day RECEIVE this emitter's shape. `WILL RECEIVE WHEN IT LANDS` IS NOT
    `USE IT NOW` (R-738 §3), so STEP 6A does not touch it."""
    blob = subprocess.run(
        ["git", "rev-parse", f"HEAD:{INDICATOR_PARAMS_TS}"],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=True,
    ).stdout.strip()
    assert blob == INDICATOR_PARAMS_PINNED_BLOB, (
        f"{INDICATOR_PARAMS_TS} changed ({blob} != {INDICATOR_PARAMS_PINNED_BLOB}) — "
        "STEP 6A may not modify the emitter the reserved grammar is specified to receive"
    )
    dirty = subprocess.run(
        ["git", "status", "--porcelain", INDICATOR_PARAMS_TS],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=True,
    ).stdout.strip()
    assert dirty == "", f"{INDICATOR_PARAMS_TS} is dirty in the working tree: {dirty!r}"


def test_no_candidate_is_routed_through_entry_params_or_param_source():
    """Firebreak 4. R-738 §3 REJECTED option C: routing the duration through the
    `indicator-params.ts` shape would widen the lane and join two previously
    separate pipelines. §4 item 4 forbids the route outright, whether or not it
    is currently reachable."""
    forbidden = ("entry_params", "param_source", "indicator-params", "indicator_params")
    for module in STEP_6A_MODULES:
        text = open(REPO / module, encoding="utf-8").read()
        # The module docstrings NAME the forbidden route in order to forbid it;
        # only executable lines are convicted.
        code = "\n".join(
            line for line in text.splitlines() if not line.lstrip().startswith(("#", '"', "'"))
        )
        for token in forbidden:
            assert token not in code, (
                f"{module} references {token!r} on an executable line — STEP 6A must not "
                "route a candidate through the reserved grammar's emitter"
            )


# ── firebreak 5 ──────────────────────────────────────────────────────────────


def test_existing_parameter_acceptance_guards_stay_green():
    """Firebreak 5, EXECUTED rather than asserted.

    Run in a child process because pytest may not be re-entered in-process. The
    baseline at STEP 6A start was `101 passed`, exit `0`, measured on this same
    file list; this control requires exit `0` and reports the child's own tail
    on failure so a regression names itself.
    """
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", *PARAMETER_GUARD_SUITES, "-q", "-p", "no:cacheprovider"],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    assert completed.returncode == 0, (
        "existing parameter-acceptance guards are no longer green:\n"
        + completed.stdout[-2000:]
        + completed.stderr[-2000:]
    )
    assert "passed" in completed.stdout
