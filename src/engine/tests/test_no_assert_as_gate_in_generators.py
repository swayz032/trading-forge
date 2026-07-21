"""R-229 §7: NO GATE MAY BE AN `assert` IN A PUBLISHING GENERATOR.

★ THE DEFECT THIS MAKES UNREPEATABLE. `python -O` strips every `assert` statement from the
compiled bytecode. A generator whose gates are asserts therefore runs under -O with EVERY GATE
SILENTLY ABSENT, and -- because these generators publish unconditionally after their checks --
writes an artifact that is byte-indistinguishable from a fully-guarded run. The enforcement
layer disappears and nothing in the output records that it did.

★ WHY A TEST AND NOT A REMEMBERED RULE. This trap was already on our books, written up, and
already fixed once in dual_denominator_remeasure.py -- and five gates in two sibling generators
shipped on it anyway, in the same directory, weeks later. The habit demonstrably does not
transfer between files. A rule that must be remembered at every new file is a rule that fails
at the first file whose author has not read the last one, so it is mechanical here instead.

SCOPE, and the exclusion is principled rather than convenient:
  * IN  -- entry functions (`main()`) of PUBLISHING GENERATORS: modules that write an artifact
           and whose main() decides whether that write happens.
  * OUT -- test files. pytest is assert's native habitat: it rewrites asserts for reporting,
           tests are never run under -O, and a test that vanishes under -O has no artifact to
           corrupt. Excluding them is not leniency; including them would be a category error.
  * OUT -- asserts OUTSIDE main() in generator files. Those are derivations and discrimination
           probes, not publish decisions. dual_denominator_remeasure.py's probe harness
           MEASURES its asserts by catching AssertionError; refuse_unless raises SystemExit
           (a BaseException), which would abort the probe loop instead of being scored. The
           rule is about the DECISION SITE, and that boundary is asserted below, not narrated.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATOR_DIRS = [
    REPO_ROOT / "docs" / "replay-results" / "h1-battery",
]


def _publishing_generators() -> list[Path]:
    """A PUBLISHING GENERATOR: has a main(), and writes a file somewhere in the module.

    Detected structurally rather than by a hand-kept list -- a curated list is exactly the
    thing that goes stale when someone adds the next generator, which is the failure mode
    this test exists to prevent.
    """
    out = []
    for d in GENERATOR_DIRS:
        for p in sorted(d.glob("*.py")):
            try:
                tree = ast.parse(p.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError):
                continue
            has_main = any(isinstance(n, ast.FunctionDef) and n.name == "main"
                           for n in ast.walk(tree))
            if not has_main:
                continue
            src = p.read_text(encoding="utf-8")
            writes = ("write_text" in src or "json.dump" in src
                      or 'open(' in src and '"w"' in src)
            if writes:
                out.append(p)
    return out


def _asserts_in_main(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name == "main":
            for n in ast.walk(fn):
                if isinstance(n, ast.Assert):
                    found.append((n.lineno, ast.unparse(n.test)[:100]))
    return found


def test_the_generator_census_is_not_empty():
    """★ GUARD THE GUARD. If the discovery above silently matched nothing, every test below
    would pass vacuously and report green while checking zero files -- the exact false-green
    shape this campaign exists to kill. The population is asserted non-empty first."""
    gens = _publishing_generators()
    assert gens, (
        f"no publishing generators discovered under {[str(d) for d in GENERATOR_DIRS]}. "
        "Either the directory moved or the detector broke; both make every check below "
        "vacuous, so this fails rather than passing on an empty set."
    )
    # ★ THIS FLOOR IS MEASURED, NOT CHOSEN. The first version of this line read `>= 8`, a
    # number typed from an impression of the directory's size -- and it failed immediately,
    # because the detector matches 7. A guessed floor in the guard-the-guard check is the same
    # defect the whole wave is about, committed inside the test written to prevent it. The
    # value below is the count the detector actually returned when the rule was written.
    assert len(gens) >= 7, (
        f"only {len(gens)} generators discovered ({[g.name for g in gens]}); the detector "
        "matched 7 when this rule was written. A drop means the detector stopped matching, "
        "not that the files were deleted -- check _publishing_generators before lowering this."
    )


@pytest.mark.parametrize("path", _publishing_generators(), ids=lambda p: p.name)
def test_publishing_generator_main_contains_zero_asserts(path: Path):
    """main() is the publish path. Every check there must survive -O, so none may be `assert`.

    BOUNDARY (stated as an assertion of scope, not a docstring promise): this reads main()'s
    AST only. An assert reached THROUGH a helper that main() calls is invisible here -- the
    rule enforces the primitive at the decision site, not everywhere.
    """
    offenders = _asserts_in_main(path)
    assert offenders == [], (
        f"{path.name}: main() contains {len(offenders)} `assert` statement(s), and `python -O` "
        f"strips every one of them:\n"
        + "\n".join(f"    line {ln}: assert {src}" for ln, src in offenders)
        + "\n\nA gate that -O can remove is not a gate. Convert each to `refuse_unless(...)`, "
          "which cannot be stripped and exits 2 (a verdict, distinguishable from a crash). "
          "See docs/replay-results/h1-battery/dual_denominator_remeasure.py for the pattern."
    )


@pytest.mark.parametrize("path", _publishing_generators(), ids=lambda p: p.name)
def test_generator_that_refuses_uses_exit_code_2_not_1(path: Path):
    """A refusal is a VERDICT and needs its own exit code.

    `SystemExit("msg")` and `sys.exit(1)` both exit 1 -- the code an ordinary unhandled error
    already uses -- so a caller cannot tell "this guard refused" from "this script crashed".
    Only generators that actually define refuse_unless are checked; the rest have nothing to
    get wrong here.
    """
    src = path.read_text(encoding="utf-8")
    if "def refuse_unless" not in src:
        pytest.skip(f"{path.name} defines no refuse_unless")
    tree = ast.parse(src)
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name == "refuse_unless":
            codes = []
            for n in ast.walk(fn):
                if isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call):
                    for a in n.exc.args:
                        if isinstance(a, ast.Constant):
                            codes.append(a.value)
            assert 2 in codes, (
                f"{path.name}: refuse_unless does not raise SystemExit(2). Found {codes}. "
                "Exit 1 is indistinguishable from a crash; a refusal gets code 2."
            )
            return
