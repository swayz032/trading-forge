"""The TopstepX adapter exists, is wired, and its kill switch is untested. Pin all three.

ALGO-025 section 2 item 1 applied prior-art law: assess and reuse the existing ProjectX
adapter rather than authoring a new one, and MEASURE its working state rather than assuming
it. These tests hold the measurement, and the one that matters is that not a single
safety-critical method is exercised.
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


def test_NOT_ONE_safety_critical_method_is_exercised():
    """THE FINDING. flatten / cancel / position-read is what stops a runaway bot.

    ALGO-025 section 2 item 3 names a dead-man switch and EOD flatten discipline as PART OF
    THE PRODUCT. If this test ever goes green by someone adding coverage, that is progress and
    the assertion should be inverted deliberately - not deleted.
    """
    a = _a()
    assert a["safety_critical_exercised"] == [], a["safety_critical_exercised"]
    assert set(a["safety_critical_UNEXERCISED"]) >= {
        "flatten", "cancel_all", "cancel_order", "get_open_position"}, a


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
