"""Every refusal the operator can see must be legible to HIM. ALGO-026 section 1(b).

From 2026-08-27 he reads these strings with GPT and no Claude. A refusal he cannot act on is,
from where he sits, indistinguishable from a crash. Presentation only — a test also proves this
module changes no behaviour.
"""
from __future__ import annotations

import ast
import io

import pytest

from research import current_mnq_strategy_v2_4_refusal_legibility as R


def test_the_scan_is_not_empty():
    """A legibility audit over zero codes certifies nothing."""
    assert len(R.runtime_codes()) >= 20, R.runtime_codes()


def test_every_runtime_refusal_has_plain_english():
    """THE DELIVERABLE. Derived from source, so a new refusal without an entry fails here."""
    a = R.audit()
    assert a["MISSING_plain_english"] == [], a["MISSING_plain_english"]
    assert a["legible"] is True


def test_there_are_no_entries_for_codes_that_no_longer_exist():
    """A stale explanation is dead paperwork that hides a live gap."""
    a = R.audit()
    assert a["entries_for_codes_that_no_longer_exist"] == [], a


def test_the_code_list_is_DERIVED_not_typed():
    """A hand-typed list certifies only itself - the X-ray's tuple let a divergence through."""
    src = io.open(R.__file__, encoding="utf-8").read()
    assert "ast.walk" in src and "ast.Raise" in src
    tree = ast.parse(src)
    fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "runtime_codes"]
    assert fn, "runtime_codes must exist and must parse the source"


def test_a_new_refusal_without_an_entry_is_CAUGHT(tmp_path):
    """POSITIVE WITNESS for the guard: plant one and the audit must report it missing."""
    mod = tmp_path / "current_mnq_strategy_v2_4_broker.py"
    mod.write_text('def f():\n    raise RuntimeError("BRAND_NEW_UNEXPLAINED_REFUSAL: x")\n',
                   encoding="utf-8")
    a = R.audit(tmp_path)
    assert "BRAND_NEW_UNEXPLAINED_REFUSAL" in a["MISSING_plain_english"]
    assert a["legible"] is False


@pytest.mark.parametrize("code", sorted(R.PLAIN_ENGLISH))
def test_each_explanation_says_what_it_means_AND_what_to_do(code):
    meaning, action = R.PLAIN_ENGLISH[code]
    assert len(meaning) > 25, f"{code}: meaning too thin"
    assert len(action) > 8, f"{code}: no action for him"
    assert meaning[0].isupper() and meaning.endswith("."), f"{code}: write it as a sentence"


@pytest.mark.parametrize("code", sorted(R.PLAIN_ENGLISH))
def test_no_explanation_leaks_engineer_jargon(code):
    """The whole point. If the plain English needs a translation it is not plain English."""
    meaning, action = R.PLAIN_ENGLISH[code]
    blob = f"{meaning} {action}".lower()
    for word in R.JARGON:
        assert word.lower() not in blob, f"{code} leaks {word!r}: {blob}"


def test_the_money_refusals_tell_him_NOT_to_override():
    """Balance and position disagreements are where overriding costs real money."""
    for code in ("ACCOUNT_BALANCE_WITNESS_MISMATCH", "BROKER_BALANCE_MISSING",
                 "BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET"):
        _, action = R.PLAIN_ENGLISH[code]
        assert any(k in action.lower() for k in ("do not override", "stop", "by hand")), (
            f"{code} does not tell him to stop: {action}")


def test_it_changes_no_behaviour():
    """Presentation only. It must not import or call anything that decides."""
    tree = ast.parse(io.open(R.__file__, encoding="utf-8").read())
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            imported.add(n.module or "")
        elif isinstance(n, ast.Import):
            imported.update(a.name for a in n.names)
    for banned in ("current_mnq_strategy_v2_4_kernel", "current_mnq_strategy_v2_4_entries",
                   "current_mnq_strategy_v2_2_projectx_broker", "requests"):
        assert not any(banned in m for m in imported), f"it imports {banned}"


def test_explain_returns_none_for_an_unknown_code():
    assert R.explain("NOT_A_REAL_CODE_AT_ALL") is None
    assert R.explain("REALTIME_HEALTH_REFUSE") is not None
