"""REPO-WIDE ASSERT-GATE CENSUS: load-bearing gates implemented as bare `assert` on run-entry
paths of instrument / guard / generator files.

★ THE DEFECT. `python -O` strips every `assert` statement from the compiled bytecode. A
generator whose gates are asserts therefore runs under -O with EVERY GATE SILENTLY ABSENT and
publishes an artifact byte-indistinguishable from a fully-guarded run. The enforcement layer
disappears and nothing in the output records that it did.

★ WHY THIS CENSUS EXISTS WHEN ONE ALREADY DID. `src/engine/tests/test_no_assert_as_gate_in_
generators.py` enumerates "publishing generators in docs/replay-results/h1-battery/" and
checks `main()` only. THAT CENSUS WAS ONLY AS WIDE AS ITS DIRECTORY, AND ONLY AS DEEP AS ONE
FUNCTION. The governing class is wider on BOTH axes, and the founding instance proves it:

    dual_denominator_remeasure.py:3813
        assert total_flipped <= 6, "CEILING BREACHED: ..."

That file IS in the scanned directory and the rule still did not see this gate, because the
assert lives in `_build_artifact_body` -- a HELPER main() calls, not main() itself. A CEILING
gate, on the very quantity a whole wave concerns, in a file that had already been fixed once
for this exact defect and which carries ~18 `refuse_unless` calls right beside it.

SO THE RUN-ENTRY PATH IS DEFINED TRANSITIVELY: the entry function plus every function in the
module reachable from it by direct call. A gate does not stop being a gate by being one frame
deeper, and a boundary drawn at `main()` is a boundary drawn where the tooling was easy.

SCOPE, and each exclusion is by principle rather than convenience:
  * IN  -- every .py in the repo (outside vendored/build dirs) that has an entry point AND
           writes a file: instruments, guards, generators.
  * OUT -- TEST FILES. pytest is assert's native habitat: it rewrites asserts for reporting,
           tests never run under -O, and a test that vanishes under -O has no artifact to
           corrupt. Excluding them is not leniency; including them would be a category error.
  * OUT -- functions NOT reachable from an entry point. Those are derivations and probes, not
           publish decisions. dual_denominator_remeasure.py's probe harness MEASURES its own
           asserts by catching AssertionError; refuse_unless raises SystemExit (a
           BaseException) which would abort the probe loop instead of being scored.
"""
from __future__ import annotations

import ast
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "assert-gate-census.json"

SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".mypy_cache",
             ".pytest_cache", "dist", "build", ".next", ".ruff_cache", "site-packages"}

ENTRY_NAMES = {"main"}


def refuse_unless(condition: bool, message: str) -> None:
    """A GATE THAT `python -O` CANNOT REMOVE, exiting 2 -- a verdict, not a crash."""
    if not condition:
        sys.stderr.write(f"REFUSED: {message}\n")
        raise SystemExit(2)


def _is_test_file(rel: str) -> bool:
    parts = rel.split("/")
    return ("tests" in parts or "__tests__" in parts
            or parts[-1].startswith("test_") or parts[-1].endswith("_test.py")
            or parts[-1] == "conftest.py")


def _writes_a_file(tree: ast.AST) -> bool:
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            f = n.func
            name = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
            if name in ("write_text", "write_bytes", "writerow", "writerows"):
                return True
            if name == "dump" and isinstance(f, ast.Attribute) and \
                    isinstance(f.value, ast.Name) and f.value.id in ("json", "pickle", "yaml"):
                return True
            if name in ("open", "fdopen"):
                mode = None
                if len(n.args) >= 2 and isinstance(n.args[1], ast.Constant):
                    mode = n.args[1].value
                for k in n.keywords:
                    if k.arg == "mode" and isinstance(k.value, ast.Constant):
                        mode = k.value.value
                if isinstance(mode, str) and any(c in mode for c in ("w", "a", "x", "+")):
                    return True
    return False


def _functions(tree: ast.AST) -> dict[str, ast.AST]:
    out = {}
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.setdefault(n.name, n)
    return out


def _called_names(fn: ast.AST) -> set[str]:
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                out.add(f.id)
            elif isinstance(f, ast.Attribute):
                out.add(f.attr)
    return out


def _run_entry_closure(tree: ast.AST) -> tuple[list[str], dict[str, ast.AST]]:
    """Entry functions plus every module function transitively reachable from them.

    ★ THIS IS THE WIDENING. A gate one frame below main() is still on the publish path.
    """
    funcs = _functions(tree)
    entries = [n for n in funcs if n in ENTRY_NAMES]
    seen: list[str] = []
    stack = list(entries)
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in funcs:
            continue
        seen.append(cur)
        for callee in _called_names(funcs[cur]):
            if callee in funcs and callee not in seen:
                stack.append(callee)
    return seen, funcs


def _scan(path: Path, rel: str) -> dict | None:
    try:
        src = path.read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(src)
    except SyntaxError:
        return None
    funcs = _functions(tree)
    if not any(n in funcs for n in ENTRY_NAMES):
        return None
    if not _writes_a_file(tree):
        return None
    reach, funcs = _run_entry_closure(tree)
    asserts = []
    for name in reach:
        for n in ast.walk(funcs[name]):
            if isinstance(n, ast.Assert):
                asserts.append({
                    "function": name,
                    "line": n.lineno,
                    "depth": "entry" if name in ENTRY_NAMES else "reachable_from_entry",
                    "predicate": ast.unparse(n.test)[:200],
                    "message": (ast.unparse(n.msg)[:200] if n.msg else None),
                })
    return {
        "file": rel,
        "entry_functions": sorted(n for n in funcs if n in ENTRY_NAMES),
        "n_functions_in_module": len(funcs),
        "n_functions_on_run_entry_path": len(reach),
        "defines_refuse_unless": "refuse_unless" in funcs,
        "n_refuse_unless_calls": sum(
            1 for n in ast.walk(tree) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name) and n.func.id == "refuse_unless"),
        "asserts_on_run_entry_path": sorted(asserts, key=lambda a: a["line"]),
        "n_asserts_on_run_entry_path": len(asserts),
    }


def main() -> None:
    py_files, examined, gens = [], 0, []
    for p in sorted(REPO_ROOT.rglob("*.py")):
        if any(s in p.parts for s in SKIP_DIRS):
            continue
        py_files.append(p)
    refuse_unless(len(py_files) > 100,
                  f"only {len(py_files)} python files discovered; the walker is broken and "
                  "every denominator below would be false")

    n_test_files = 0
    for p in py_files:
        rel = p.relative_to(REPO_ROOT).as_posix()
        if _is_test_file(rel):
            n_test_files += 1
            continue
        examined += 1
        r = _scan(p, rel)
        if r is not None:
            gens.append(r)

    refuse_unless(bool(gens),
                  "zero instrument/guard/generator files discovered; the detector matched "
                  "nothing and a census of an empty set is a false green")

    offenders = [g for g in gens if g["n_asserts_on_run_entry_path"]]
    by_depth = Counter(a["depth"] for g in gens for a in g["asserts_on_run_entry_path"])

    out = {
        "artifact": "assert-gate-census",
        "generator": "docs/replay-results/h1-battery/assert_gate_census.py",
        "scope_line": (
            f"corpus = every .py in the repo outside {sorted(SKIP_DIRS)} "
            f"({len(py_files)} files; {n_test_files} test files EXCLUDED BY CATEGORY -- pytest "
            f"is assert's habitat; {examined} non-test files examined) · a file qualifies when "
            "it has an entry function AND writes a file · run-entry path = entry function PLUS "
            "every module function transitively reachable from it by direct call"),
        "denominator_python_files": len(py_files),
        "denominator_test_files_excluded": n_test_files,
        "denominator_non_test_files_examined": examined,
        "denominator_instrument_guard_generator_files": len(gens),
        "n_files_with_asserts_on_run_entry_path": len(offenders),
        "n_asserts_on_run_entry_path": sum(g["n_asserts_on_run_entry_path"] for g in gens),
        "asserts_by_depth": dict(by_depth),
        "WHY_DEPTH_MATTERS": (
            "`entry` asserts are what a main()-only rule can see. `reachable_from_entry` "
            "asserts are the ones it CANNOT -- and the founding instance of this census, the "
            "CEILING gate at dual_denominator_remeasure.py:3813, is one of them. It sits in "
            "_build_artifact_body, a helper main() calls, inside a directory an existing rule "
            "already scanned. Depth is published so the widening is auditable, not asserted."),
        "offenders": sorted(offenders, key=lambda g: -g["n_asserts_on_run_entry_path"]),
        "all_instrument_files": sorted(gens, key=lambda g: g["file"]),
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(f"wrote {OUT}")
    print(f"  python files                    : {len(py_files)}")
    print(f"  test files excluded by category : {n_test_files}")
    print(f"  non-test files examined         : {examined}")
    print(f"  instrument/guard/generator files: {len(gens)}")
    print(f"  files with run-entry asserts    : {len(offenders)}")
    print(f"  asserts on run-entry paths      : {sum(g['n_asserts_on_run_entry_path'] for g in gens)}")
    for k, v in sorted(by_depth.items()):
        print(f"      {k:<24}: {v}")


if __name__ == "__main__":
    main()
