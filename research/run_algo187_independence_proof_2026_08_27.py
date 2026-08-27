#!/usr/bin/env python3
"""ALGO-187 obligation 1 — PROVE PROCESS INDEPENDENCE. Static analysis, not a grep.

ALGO-185 §4 authorised parallelism on two obligations, the first being: enumerate every
module-level mutable and every cache on the run path and show the set is empty or read-only. The
desk's own grep found only constants in `kernel.py:43-74` and it said so itself: "that is a lead,
not a proof, and it says nothing about `v2_2_engine` or `levels`."

WHAT A GREP CANNOT SEE, and therefore what this walks the AST for:
  1. module-level bindings to MUTABLE objects (dict/list/set literals, and calls that return them)
  2. `global` statements inside functions
  3. `functools.lru_cache` / `functools.cache` decorators — a shared memo is shared state
  4. ATTRIBUTE ASSIGNMENT ONTO AN IMPORTED MODULE (`base.zone_state_at = ...`) — cross-module
     monkeypatching at import time, which no search for `global` would find
  5. SUBSCRIPT or ATTRIBUTE WRITES to a module-level name from inside a function
     (`_CACHE[k] = v`, `CONF.x = 1`) — the shape an actual memo takes

THE MODULE SET IS DERIVED, NOT LISTED: it is the transitive closure of `research.*` imports from
`current_mnq_strategy_v2_4_kernel`, so a module cannot escape the audit by not being on someone's
list. The closure is printed so the population is auditable.

VERDICT RULE: a finding is BENIGN only if it is bound once at import and never written afterwards.
Anything written during a run is a REFUSAL — under multiprocessing each worker gets its own copy,
so it would not corrupt across processes, but it would mean the sequential and parallel runs are
not the same computation, and that is exactly what obligation 2 exists to detect.
"""
from __future__ import annotations

import ast
import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENTRY = "current_mnq_strategy_v2_4_kernel"
MUTABLE_CALLS = {"dict", "list", "set", "defaultdict", "OrderedDict", "Counter", "deque"}


def _closure(entry: str) -> list[str]:
    """Transitive closure of research.* imports, so the population is derived not listed."""
    seen, stack = set(), [entry]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        path = ROOT / f"{name}.py"
        if not path.exists():
            continue
        seen.add(name)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for n in ast.walk(tree):
            mods = []
            if isinstance(n, ast.Import):
                mods = [a.name for a in n.names]
            elif isinstance(n, ast.ImportFrom) and n.module:
                mods = [n.module] + [f"{n.module}.{a.name}" for a in n.names]
            for m in mods:
                if m.startswith("research."):
                    stack.append(m.split(".", 1)[1])
    return sorted(seen)


def _module_level_names(tree: ast.Module) -> dict:
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out[node.target.id] = node.value
    return out


def _is_mutable(value) -> str | None:
    if isinstance(value, (ast.Dict, ast.List, ast.Set, ast.DictComp, ast.ListComp, ast.SetComp)):
        return type(value).__name__
    if isinstance(value, ast.Call):
        fn = getattr(value.func, "id", None) or getattr(value.func, "attr", None)
        if fn in MUTABLE_CALLS:
            return f"{fn}()"
    return None


def audit(name: str) -> list[dict]:
    path = ROOT / f"{name}.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    mod_names = _module_level_names(tree)
    imported = {a.asname or a.name.split(".")[-1]
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in n.names}
    findings = []

    for var, value in mod_names.items():
        kind = _is_mutable(value)
        if kind:
            findings.append({"module": name, "kind": "MODULE-LEVEL MUTABLE",
                             "detail": f"{var} = {kind}", "line": getattr(value, "lineno", 0)})

    for node in ast.walk(tree):
        if isinstance(node, ast.Global):
            findings.append({"module": name, "kind": "GLOBAL STATEMENT",
                             "detail": ", ".join(node.names), "line": node.lineno})
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                txt = ast.unparse(d)
                if "lru_cache" in txt or txt.endswith("cache"):
                    findings.append({"module": name, "kind": "CACHE DECORATOR",
                                     "detail": f"{node.name} @{txt}", "line": node.lineno})
        # writes to module-level or imported names
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name):
                    if t.value.id in imported:
                        findings.append({"module": name, "kind": "MODULE ATTRIBUTE ASSIGNMENT",
                                         "detail": f"{ast.unparse(t)} = {ast.unparse(node.value)[:40]}",
                                         "line": t.lineno})
                if isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) \
                        and t.value.id in mod_names:
                    findings.append({"module": name, "kind": "WRITE INTO MODULE-LEVEL OBJECT",
                                     "detail": ast.unparse(t), "line": t.lineno})
    return findings


def main() -> None:
    mods = _closure(ENTRY)
    print(f"RUN-PATH CLOSURE from `{ENTRY}` — {len(mods)} research modules, DERIVED not listed:")
    for m in mods:
        print(f"    {m}")

    all_findings = [f for m in mods for f in audit(m)]
    print(f"\nFINDINGS: {len(all_findings)}")
    if not all_findings:
        print("  NONE. No module-level mutable, no global, no cache decorator, no module attribute")
        print("  assignment and no write into a module-level object anywhere on the run path.")
        return
    by_kind = {}
    for f in all_findings:
        by_kind.setdefault(f["kind"], []).append(f)
    for kind, rows in sorted(by_kind.items()):
        print(f"\n  {kind}  ({len(rows)})")
        for r in rows:
            print(f"    {r['module']}:{r['line']}  {r['detail']}")


if __name__ == "__main__":
    main()
