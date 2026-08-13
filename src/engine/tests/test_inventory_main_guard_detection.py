"""SYSTEM-INVENTORY rule (c) repair — AR-1123 §3.

THE DEFECT `[MEASURED, AR-1122 §3]`
------------------------------------
`discover_entry_points` rule (c) advertised *"Python modules with an
`if __name__ == \"__main__\"` block"* and tested `f.refs.get("__main__")`. `refs` is
built from `ast.Name` / `ast.Attribute` nodes only, and `"__main__"` is an
`ast.Constant` — so the test was UNSATISFIABLE. The reason string
*"has `__main__` guard (runnable module)"* appeared **0 times** in the generated
inventory while the sibling rules fired freely (subprocess literal ×11, package.json
×10+), so the null was a dead rule and not an empty repo.

Consequence: a genuinely runnable Python module whose only entry-point evidence is a
`__main__` guard was silently mislabeled BUILT-UNREACHABLE — in an instrument whose
whole job is answering *"is this already built and wired?"*.

🛑 FIXTURES ARE INLINE SOURCE STRINGS, ON PURPOSE
-------------------------------------------------
A fixture `.py` file containing a real `__main__` guard would, once the repair works,
BECOME A REAL ENTRY POINT and change the very population this repair is measured
against. Parsing source strings keeps the detector under test without contaminating
the tree it measures.

    `A FIXTURE THAT THE INSTRUMENT UNDER TEST WOULD ALSO MEASURE IS NOT A FIXTURE,
     IT IS A SECOND INDEPENDENT VARIABLE.`
"""

from __future__ import annotations

import ast
import importlib.util
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[3]
_SPEC = importlib.util.spec_from_file_location("system_inventory", REPO / "scripts/system_inventory.py")
system_inventory = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(system_inventory)

py_has_main_guard = system_inventory.py_has_main_guard


def _detect(source: str) -> bool:
    return py_has_main_guard(ast.parse(source))


# ── POSITIVE FIXTURES — genuine guards that MUST be detected ────────────────────────

def test_positive_canonical_guard():
    assert _detect('if __name__ == "__main__":\n    raise SystemExit(0)\n')


def test_positive_single_quoted_guard():
    assert _detect("if __name__ == '__main__':\n    pass\n")


def test_positive_reversed_comparison():
    """AR-1123 §3: accept the equivalent reversed comparison."""
    assert _detect('if "__main__" == __name__:\n    pass\n')


def test_positive_guard_after_other_top_level_code():
    assert _detect(
        'import os\n\n'
        'def main():\n'
        '    return 0\n\n'
        'if __name__ == "__main__":\n'
        '    raise SystemExit(main())\n'
    )


# ── NEGATIVE FIXTURES — must NOT be detected ────────────────────────────────────────

def test_negative_prose_and_string_data_only():
    """AR-1123 §3's required negative fixture: the text `__main__` appears in a
    docstring, a comment and string DATA, and none of it makes a module runnable."""
    source = (
        '"""This module explains the if __name__ == "__main__" convention."""\n'
        '# a comment mentioning __main__ and even if __name__ == "__main__":\n'
        'DOC = "if __name__ == \\"__main__\\":"\n'
        'NAMES = ["__main__", "__init__"]\n'
        'CONFIG = {"entry": "__main__"}\n'
    )
    assert _detect(source) is False


def test_negative_guard_nested_inside_a_function():
    """A nested guard does not make the module runnable by `python -m`, so it must
    not be counted as an entry point."""
    source = (
        'def configure():\n'
        '    if __name__ == "__main__":\n'
        '        return 1\n'
        '    return 0\n'
    )
    assert _detect(source) is False


def test_negative_wrong_operator():
    assert _detect('if __name__ != "__main__":\n    pass\n') is False


def test_negative_different_dunder():
    assert _detect('if __name__ == "__init__":\n    pass\n') is False
    assert _detect('if __file__ == "__main__":\n    pass\n') is False


def test_negative_empty_module():
    assert _detect("") is False


# ── THE REPAIR IS LIVE IN THE RULE, not merely in the helper ────────────────────────

def test_rule_c_now_fires_for_a_real_runnable_module():
    """END-TO-END: the entry-point discovery itself must now recognise a guard.

    RED before the repair — `refs.get("__main__")` could never be truthy.
    """
    guarded = system_inventory.FileInfo("src/engine/_probe_runnable.py", "py")
    guarded.has_main_guard = True

    prose_only = system_inventory.FileInfo("src/engine/_probe_prose.py", "py")
    prose_only.has_main_guard = False
    prose_only.refs = {"__main__": [3]}  # the OLD, defect-shaped signal

    a_test = system_inventory.FileInfo("src/engine/tests/test_probe.py", "py")
    a_test.has_main_guard = True

    by_path = {f.path: f for f in (guarded, prose_only, a_test)}
    prov = system_inventory.discover_entry_points(by_path, [guarded, prose_only, a_test])

    reason = "has `__main__` guard (runnable module)"
    assert reason in prov.get(guarded.path, []), "a real guard is still not discovered"
    # The old signal alone must NOT resurrect the defect.
    assert reason not in prov.get(prose_only.path, [])
    # Tests are excluded from entry points, guard or not.
    assert reason not in prov.get(a_test.path, [])
