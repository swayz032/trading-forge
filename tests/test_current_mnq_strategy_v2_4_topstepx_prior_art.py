"""The TopstepX adapter exists, is wired, and its kill switch is now proven offline.

ALGO-025 section 2 item 1 applied prior-art law: assess and reuse the existing ProjectX
adapter rather than authoring a new one, and MEASURE its working state rather than assuming
it. The measurement first found NOT ONE safety-critical method exercised. ALGO-026 section 1(c)
made closing that the first task of the operator self-sufficiency pack, and it is closed --
coverage went 2/13 to 10/13 and safety-critical unexercised is empty.

These tests hold the measurement in its current state. The safety assertion was INVERTED
deliberately when the hole closed, not deleted, so a regression turns it red again.
"""
from __future__ import annotations

import ast
import io
import os

import pytest

from research import current_mnq_strategy_v2_4_topstepx_prior_art as A


def _a():
    return A.assess()


def test_the_prior_art_exists():
    """If this ever fails, a new adapter genuinely would be needed - check before writing one."""
    s = _a()["surface"]
    assert s["broker"]["exists"] is True
    assert s["history"]["exists"] is True


def test_it_is_already_wired_into_the_v24_family():
    """The ruling assumed prior art; it is further along than that - v2.4 already imports it."""
    importers = _a()["surface"]["broker"]["importers_in_v2_family"]
    assert "current_mnq_strategy_v2_4_shadow_runtime.py" in importers, importers


def test_every_safety_critical_method_is_now_exercised():
    """The finding is CLOSED, and the assertion was inverted deliberately rather than deleted.

    It first measured NOT ONE safety-critical method covered. ALGO-026 section 1(c) made that
    the first task of the self-sufficiency pack, and the broker-safety-core test file closed
    it. If coverage ever regresses this goes red again, which is the whole point of deriving
    the finding from the measurement rather than freezing it in prose.
    """
    a = _a()
    assert a["safety_critical_UNEXERCISED"] == [], a["safety_critical_UNEXERCISED"]
    assert a["kill_switch_proven_offline"] is True
    assert set(a["safety_critical_exercised"]) >= {
        "flatten", "cancel_all", "cancel_order", "get_open_position"}, a


def test_discovery_is_by_import_not_by_filename():
    """It globbed test_*projectx*.py and could not see the file that closed the finding."""
    files = _a()["test_files_discovered_by_import"]
    assert "test_current_mnq_strategy_v2_4_broker_safety_core.py" in files, files
    assert len(files) >= 3, files


def test_the_coverage_detector_CAN_find_a_covered_method():
    """POSITIVE WITNESS. "nothing is covered" must not be a property of a broken detector."""
    a = _a()
    assert a["public_methods_touched_by_a_test"] >= 1, (
        "the detector found zero covered methods anywhere - it is probably broken, and the "
        "safety finding above would then be meaningless")
    assert a["public_methods_total"] > a["public_methods_touched_by_a_test"]


def test_the_safety_set_is_a_subset_of_what_actually_exists():
    """A safety list naming methods the adapter does not have would inflate the finding."""
    a = _a()
    defined = set()
    for s in a["surface"].values():
        if s.get("exists"):
            for ms in s["covered_methods"].values():
                defined |= set(ms)
            for ms in s["unexercised_methods"].values():
                defined |= set(ms)
    missing = set(a["safety_critical_UNEXERCISED"]) - defined
    assert not missing, f"safety list names methods that do not exist: {sorted(missing)}"


def test_the_hard_gate_travels_with_the_assessment():
    """"It exists and is wired" must never be read as "we may connect it"."""
    g = _a()["HARD_GATE"]
    assert "NOTHING connects" in g
    assert "ZERO authority" in g


def test_it_opens_no_connection_and_holds_no_credential():
    """Checked on the AST. The module names requests and env vars in prose, deliberately."""
    tree = ast.parse(io.open(A.__file__, encoding="utf-8").read())
    imported, called = set(), set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imported.update(x.name.split(".")[0] for x in n.names)
        elif isinstance(n, ast.ImportFrom):
            imported.add((n.module or "").split(".")[0])
        elif isinstance(n, ast.Call):
            nm = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if nm:
                called.add(nm)
    for banned in ("requests", "urllib", "http", "socket"):
        assert banned not in imported, f"the assessment imports {banned}"
    for banned in ("getenv", "post", "get_json", "request"):
        assert banned not in called, f"the assessment calls {banned}()"


def test_the_credentials_are_absent_in_this_environment():
    """Belt and braces: even if something tried, there is nothing to authenticate with."""
    for k in A.assess()["credentials_from"]:
        if os.environ.get(k):
            pytest.skip(f"{k} is set in this environment - cannot prove the negative here")
    assert True


def test_what_the_tests_establish_is_scoped_honestly():
    """Offline request-shaping is not evidence the venue accepts the request."""
    a = _a()
    assert "REQUEST SHAPING ONLY" in a["what_the_tests_establish"]
    assert "cannot and do not prove" in a["what_the_tests_establish"]
