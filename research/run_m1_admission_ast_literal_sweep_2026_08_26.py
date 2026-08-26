"""M1 step 1b - AST sweep of the ADMISSION CALL PATH for bare numeric literals.

ALGO-111 section 5, and the instrument behind the law ALGO-111 minted from ALGO-110:

    DERIVING FROM THE DECLARING SURFACE IS NOT DERIVING FROM THE CODE.

`run_m1_admission_magnitude_provenance_2026_08_26.py` walks the loaded `key_level_semantics.json`
and finds TEN magnitudes. That is the right authority for what the SPEC DECLARES and it is not
the same question as what NUMBERS DECIDE ADMISSION. It missed `0.20`, `0.80`, `0.05` and `0.30`
in the established-zone band (`engine.py:490-496`) because those never reached a declaring
surface at all - they are literals in engine code. Ten is a FLOOR.

This sweep asks the other question: starting at the admission entry point and following calls,
WHAT NUMBER IS WRITTEN ANYWHERE ON THIS PATH?

WHAT IT DOES NOT DO, stated up front so no one reads it as complete either:

  * Calls are resolved BY NAME within a fixed module set. There is no type inference, so a call
    through an alias, a dict of handlers, or a method on an object is NOT followed. This is a
    lower bound on the call path, hence a lower bound on the literals.
  * It reports every literal and RULES ON NONE. `2` in `(h + lo) / 2` is a midpoint and carries
    no freedom; `0.62` is a threshold and carries all of it. Only reading tells them apart, and
    the reading is the work - the same discipline as the provenance scan, which reported
    "6 of 10 cited" when every hit was noise.

POSITIVE CONTROL. An absence claim from a search that cannot find anything is worthless. This
sweep must independently rediscover magnitudes already known to be on the path - the established
band's `0.20 / 0.80 / 0.05` and the exceptional band's `4.0` tick floor. If the control misses,
the sweep is dead and its output is void.

No PnL, realized outcome, winner/loser label or clean-edge result participates in this scan.
"""
from __future__ import annotations

import ast
import io
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent

#: The admission surface: where a location is built, and the engine it delegates zone
#: construction to. Globbed rather than listed would sweep the whole repo; this is the path
#: ALGO-102/110 named, and naming it is a scope choice that belongs in the report.
MODULES = {
    "current_mnq_strategy_v2_4_levels.py",
    "current_mnq_strategy_v2_2_engine.py",
}

#: Where admission starts. `levels.py:225`, which calls `core.build_zones` at :229.
ROOTS = ("build_entry_locations_v24",)

#: The control: literals that ARE on this path, established independently (ALGO-110 section 3).
CONTROL = {
    ("current_mnq_strategy_v2_2_engine.py", 0.20),
    ("current_mnq_strategy_v2_2_engine.py", 0.80),
    ("current_mnq_strategy_v2_2_engine.py", 0.05),
    ("current_mnq_strategy_v2_4_levels.py", 4.0),
}


def parse(name: str):
    src = io.open(HERE / name, encoding="utf-8").read()
    return src, ast.parse(src)


def function_table() -> dict:
    """Every function in the module set, by name. A name collision keeps both."""
    table = {}
    for name in sorted(MODULES):
        src, tree = parse(name)
        lines = src.split("\n")
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                table.setdefault(node.name, []).append((name, node, lines))
    return table


def called_names(node) -> set:
    """Names this function calls - bare `f()` and attribute `mod.f()` alike."""
    out = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                out.add(f.id)
            elif isinstance(f, ast.Attribute):
                out.add(f.attr)
    return out


def reachable(table: dict) -> list:
    """Transitive closure from ROOTS. Lower bound - see the module docstring."""
    seen, order, stack = set(), [], list(ROOTS)
    while stack:
        fn = stack.pop()
        if fn in seen or fn not in table:
            continue
        seen.add(fn)
        for entry in table[fn]:
            order.append((fn, entry))
            stack.extend(called_names(entry[1]))
    return order


def literals_in(node, lines: list) -> list:
    """Every numeric constant in a function body, with the source line that carries it."""
    out = []
    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) \
                and not isinstance(n.value, bool):
            text = lines[n.lineno - 1].strip() if 0 < n.lineno <= len(lines) else ""
            out.append({"value": n.value, "line": n.lineno, "source": text[:110]})
    return out


def main() -> int:
    table = function_table()
    order = reachable(table)

    print("=" * 80)
    print("M1 STEP 1b - AST LITERAL SWEEP OF THE ADMISSION CALL PATH")
    print("=" * 80)
    print("roots   : " + ", ".join(ROOTS))
    print("modules : " + ", ".join(sorted(MODULES)))
    print("functions reached: " + str(len(order))
          + "   (lower bound - name resolution only, no type inference)")
    print()

    rows, seen_pairs = [], set()
    for fn, (mod, node, lines) in order:
        for lit in literals_in(node, lines):
            rows.append({"function": fn, "module": mod, **lit})
            seen_pairs.add((mod, float(lit["value"])))

    # ---- POSITIVE CONTROL, before any absence is trusted ---------------------------------
    missed = sorted(c for c in CONTROL if c not in seen_pairs)
    print("POSITIVE CONTROL - literals independently known to be on this path:")
    for mod, val in sorted(CONTROL):
        hit = (mod, val) in seen_pairs
        print(f"  {'FOUND  ' if hit else '*MISS* '} {val:<6} in {mod}")
    if missed:
        print()
        print("*** CONTROL FAILED - the sweep does not reach known admission literals. ***")
        print("*** Its output is VOID. Fix the traversal before reading anything below. ***")
        return 2
    print("  -> control LIVE; the traversal reaches the admission band code.")
    print()

    # ---- the sweep ------------------------------------------------------------------------
    by_fn = {}
    for r in rows:
        by_fn.setdefault((r["module"], r["function"]), []).append(r)

    print(f"NUMERIC LITERALS ON THE PATH: {len(rows)} across {len(by_fn)} functions")
    print("-" * 80)
    for (mod, fn) in sorted(by_fn):
        print(f"  {mod}::{fn}")
        for r in sorted(by_fn[(mod, fn)], key=lambda x: x["line"]):
            print(f"      {mod.split('_')[-1]}:{r['line']:<5} {str(r['value']):<8} {r['source']}")
    print("-" * 80)

    distinct = sorted({float(r["value"]) for r in rows})
    print(f"{len(distinct)} distinct values: {distinct}")
    print()
    print("READ THIS CORRECTLY. THIS INSTRUMENT RULES ON NOTHING. A `2` in `(h + lo) / 2` is a")
    print("midpoint with no freedom in it; a `0.62` is a threshold with all of it. Separating")
    print("them is READING, not counting - and the count above is a LOWER BOUND, because calls")
    print("are resolved by name only. The provenance scan reported '6 of 10 cited' when every")
    print("hit was noise; the lesson transfers exactly.")

    out = HERE / "current_mnq_strategy_v2_4_m1_admission_ast_literals_2026_08_26.json"
    io.open(out, "w", encoding="utf-8", newline="").write(json.dumps({
        "roots": list(ROOTS),
        "modules": sorted(MODULES),
        "functions_reached": [f"{m}::{f}" for f, (m, _n, _l) in order],
        "positive_control": {"required": [[m, v] for m, v in sorted(CONTROL)], "all_found": True},
        "literals": rows,
        "distinct_values": distinct,
        "reader_note": "LOWER BOUND. Name-resolved call graph, no type inference. Rules on "
                       "nothing: a midpoint divisor and a threshold look identical here.",
    }, indent=1))
    print(f"\nwrote {out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
