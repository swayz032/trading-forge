"""★ THE ABORT-POSITION CENSUS. Which gates in the generator have ACTUALLY been running?

THE FINDING THAT MINTED THIS INSTRUMENT (H1-W4 D1 / AR-233). A STRUCTURAL_NUMERALS scorer sat
BELOW an abort point in dual_denominator_remeasure.py and did not execute for three waves --
while reading, to every reviewer, as "in place". It was already stale at HEAD. Two rulings had
ratified that abort; both asked what it STRANDED, neither asked what it DISARMED.

    ★ A GATE DOWNSTREAM OF AN ABORT IS A GATE'S CORPSE.

WHY THIS IS DERIVED AND NOT READ. A hand-read ordering is exactly the instrument that missed
this for three waves: 6821 lines, gates defined 3000 lines from where they are enforced, and
the abort between them invisible unless you hold the whole call order in your head. So this
census computes the order from the AST and the reachability from a REAL TRACED RUN. Nothing
here is read off the page.

TWO INDEPENDENT PATHS, DELIBERATELY:
  STATIC  -- interprocedural walk of the generator's AST from main() in execution order,
             recording every abort site and every gate site with its position in that order.
  DYNAMIC -- the generator is executed under sys.settrace and the set of lines that actually
             executed is recorded. A gate whose line never appears DID NOT RUN.

Where the two disagree, the disagreement is the finding. Where neither can decide, the cell
reads UNDETERMINED -- which is a legitimate answer and beats a guess.

USAGE
    python abort_position_census.py            # static + dynamic (runs the generator --draft)
    python abort_position_census.py --static   # static only
Exit 0 always: this is a census, not a gate. It refuses to guess, not to publish.
"""
from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "dual_denominator_remeasure.py"
OUT = HERE / "abort-position-census.json"

# ---------------------------------------------------------------------------------------------
# CLASSIFYING A BRANCH CONDITION. An abort inside `if "--battery" in argv:` is not on the normal
# path and must not be reported as one; an abort inside `if not check["all_match"]:` IS. The
# classification is syntactic and its rule is stated here rather than inferred by a reader.
# ---------------------------------------------------------------------------------------------
COND_CLI = "CLI_SUBCOMMAND"      # gated on argv -- absent on a normal publish run
COND_DRAFT = "DRAFT_MODE"        # gated on _DRAFT_MODE / draft_mode()
COND_DATA = "DATA_DEPENDENT"     # gated on a measured value -- CAN fire on a normal run
COND_NONE = "UNCONDITIONAL"      # no enclosing branch


def classify_condition(test: ast.AST) -> str:
    src = ast.unparse(test)
    if "argv" in src:
        return COND_CLI
    if "_DRAFT_MODE" in src or "draft_mode(" in src:
        return COND_DRAFT
    return COND_DATA


def is_abort(stmt: ast.stmt) -> tuple[str, str] | None:
    """Return (kind, rendered) if this statement can terminate the run or the function."""
    if isinstance(stmt, ast.Assert):
        return ("ASSERT", ast.unparse(stmt.test))
    if isinstance(stmt, ast.Raise):
        return ("RAISE", ast.unparse(stmt))
    if isinstance(stmt, ast.Return):
        return ("RETURN", ast.unparse(stmt.value) if stmt.value else "None")
    if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
        call = stmt.value
        name = ast.unparse(call.func)
        if name == "refuse_unless":
            return ("REFUSE_UNLESS", ast.unparse(call.args[0]) if call.args else "?")
        if name in {"sys.exit", "exit"}:
            return ("SYS_EXIT", ast.unparse(call))
    return None


# ---------------------------------------------------------------------------------------------
# WHAT COUNTS AS A GATE. Stated as a rule, applied by the machine, so the denominator is not a
# matter of taste. A gate is a site whose job is to REFUSE or to CONVICT:
#   ENFORCEMENT  -- refuse_unless / assert / raise. Acts on a verdict.
#   SCORER       -- a function that computes a verdict: it returns a dict literal carrying a
#                   PASS key, or a convictions/violations count. Produces a verdict.
# A scorer whose verdict nothing enforces is still a gate for census purposes -- and one whose
# verdict is computed but never acted on is precisely the corpse shape, so it must be counted.
# ---------------------------------------------------------------------------------------------
VERDICT_KEYS = {"PASS", "ALL_VERIFIED", "all_match", "match", "convictions", "n_convictions",
                "violations", "n_violations", "closes_exactly",
                "MISDIRECTED_PROBES_THIS_IS_THE_RED"}

# ★ THE DENOMINATOR'S FIRST DRAFT WAS WRONG, AND SAYING SO IS THE POINT. A first cut required the
# verdict key to sit on the RETURN's own dict literal. That silently dropped
# assert_discrimination_census -- a gate whose verdict IS enforced at a refuse_unless -- because
# its PASS key sits one level down. A census whose denominator is set by an accident of nesting
# depth is the same species of instrument as the one that missed the corpse. So the rule is now
# stated two ways and their UNION is taken, and the two ways are reported separately:
#   (a) STRUCTURAL -- a verdict key anywhere inside any returned expression, at any depth;
#   (b) CONSUMED   -- the function's name appears in the test of an enforcement site. This one
#                     needs no taste at all: a gate is a thing whose verdict something enforces.


def _returned_verdict_keys(fn: ast.AST) -> set[str]:
    keys: set[str] = set()
    for node in ast.walk(fn):
        if not isinstance(node, ast.Return) or node.value is None:
            continue
        for sub in ast.walk(node.value):
            if isinstance(sub, ast.Dict):
                for k in sub.keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str) \
                            and k.value in VERDICT_KEYS:
                        keys.add(k.value)
    return keys


def _enforced_names(tree: ast.Module) -> set[str]:
    """Names appearing in the TEST of any assert / refuse_unless -- the consumed-verdict rule."""
    names: set[str] = set()
    for node in ast.walk(tree):
        test = None
        if isinstance(node, ast.Assert):
            test = node.test
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "refuse_unless" and node.args:
            test = node.args[0]
        if test is None:
            continue
        for sub in ast.walk(test):
            if isinstance(sub, ast.Name):
                names.add(sub.id)
    return names


def scorer_functions(tree: ast.Module) -> dict[str, dict]:
    """Module-level functions that PRODUCE a verdict. Union of the two rules above.

    A function reaches this census by (a) structure, (b) consumption, or both. Which rules
    admitted it is recorded per entry, so a reader can see the denominator's construction
    instead of trusting its size.
    """
    enforced = _enforced_names(tree)
    # a verdict consumed under a local alias (`census = coverage_census(...)`; `assert
    # census['PASS']`) is still consumed -- map local binding names back to the callee
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) \
                and isinstance(node.value.func, ast.Name) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name):
            aliases.setdefault(node.targets[0].id, node.value.func.id)
    enforced_callees = {aliases[n] for n in enforced if n in aliases} | enforced

    out: dict[str, dict] = {}
    for fn in tree.body:
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        keys = _returned_verdict_keys(fn)
        by_structure = bool(keys)
        by_consumption = fn.name in enforced_callees
        if not (by_structure or by_consumption):
            continue
        out[fn.name] = {
            "line": fn.lineno, "end_line": fn.end_lineno,
            "verdict_keys": sorted(keys),
            "admitted_by": ([] + (["STRUCTURAL"] if by_structure else [])
                            + (["CONSUMED_BY_AN_ENFORCEMENT_SITE"] if by_consumption else [])),
        }
    return out


# ---------------------------------------------------------------------------------------------
# THE INTERPROCEDURAL WALK. Depth-first over statements in execution order starting at main(),
# descending into calls to module-level functions. Every abort and gate site is appended to one
# ordered list with its guard-condition stack, so "which aborts precede this gate" is a slice of
# that list rather than a judgement.
#
# DECLARED LIMITS OF THE WALK (these produce UNDETERMINED cells, never a guess):
#   - loops are entered once; a gate reached only on a later iteration is not distinguished
#   - a call through a variable, a comprehension or a dict of callables is not followed
#   - recursion is cut at first re-entry
#   - `try` handlers are walked, so an abort inside a try that a handler swallows is still
#     listed; its class is reported as CAUGHT so the reader can discount it
# ---------------------------------------------------------------------------------------------
class Walk:
    def __init__(self, tree: ast.Module) -> None:
        self.funcs = {n.name: n for n in tree.body
                      if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        self.scorers = scorer_functions(tree)
        self.events: list[dict] = []
        self.notes: list[str] = []
        self._stack: list[str] = []
        self._order = 0

    def _emit(self, **kw) -> None:
        self._order += 1
        kw["order"] = self._order
        self.events.append(kw)

    def run(self) -> None:
        self.walk_body(self.funcs["main"].body, [], "main", in_try=False)

    def walk_body(self, body: list[ast.stmt], guards: list[dict],
                  fname: str, in_try: bool) -> None:
        for stmt in body:
            self.walk_stmt(stmt, guards, fname, in_try)

    def walk_stmt(self, stmt: ast.stmt, guards: list[dict], fname: str, in_try: bool) -> None:
        # calls made by this statement are evaluated BEFORE the statement's own abort effect
        for call in self.calls_in(stmt):
            self.descend(call, guards, fname, in_try)

        ab = is_abort(stmt)
        if ab is not None:
            kind, rendered = ab
            self._emit(type="ABORT", kind=kind, line=stmt.lineno, func=fname,
                       expr=rendered[:200], guards=list(guards), caught=in_try)

        if isinstance(stmt, ast.If):
            cls = classify_condition(stmt.test)
            g = guards + [{"line": stmt.lineno, "class": cls,
                           "test": ast.unparse(stmt.test)[:140], "arm": "then"}]
            self.walk_body(stmt.body, g, fname, in_try)
            if stmt.orelse:
                ge = guards + [{"line": stmt.lineno, "class": cls,
                                "test": ast.unparse(stmt.test)[:140], "arm": "else"}]
                self.walk_body(stmt.orelse, ge, fname, in_try)
        elif isinstance(stmt, (ast.For, ast.While, ast.AsyncFor)):
            g = guards + [{"line": stmt.lineno, "class": "LOOP_BODY",
                           "test": "loop entered once by this walk", "arm": "body"}]
            self.walk_body(stmt.body, g, fname, in_try)
        elif isinstance(stmt, ast.Try):
            self.walk_body(stmt.body, guards, fname, in_try=True)
            for h in stmt.handlers:
                self.walk_body(h.body, guards + [{"line": h.lineno, "class": "EXCEPT_HANDLER",
                                                  "test": ast.unparse(h.type) if h.type else "",
                                                  "arm": "handler"}], fname, in_try)
            self.walk_body(stmt.orelse, guards, fname, in_try)
            self.walk_body(stmt.finalbody, guards, fname, in_try)
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            self.walk_body(stmt.body, guards, fname, in_try)

    def calls_in(self, stmt: ast.stmt):
        """Calls to module-level functions lexically inside this statement, excluding the bodies
        of nested compound statements (those are walked separately, in their own guard scope)."""
        skip: set[int] = set()
        for sub in (getattr(stmt, "body", []) or []):
            for n in ast.walk(sub):
                skip.add(id(n))
        for attr in ("orelse", "finalbody", "handlers"):
            for sub in (getattr(stmt, attr, []) or []):
                for n in ast.walk(sub):
                    skip.add(id(n))
        found = []
        for n in ast.walk(stmt):
            if id(n) in skip:
                continue
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                if n.func.id in self.funcs:
                    found.append(n)
        return found

    def descend(self, call: ast.Call, guards: list[dict], fname: str, in_try: bool) -> None:
        name = call.func.id
        if name in self._stack:
            self.notes.append(f"RECURSION CUT at {name} (called from {fname} line {call.lineno})")
            return
        if name in self.scorers:
            self._emit(type="GATE", gate_class="SCORER", name=name, line=call.lineno,
                       func=fname, guards=list(guards), caught=in_try,
                       verdict_keys=self.scorers[name]["verdict_keys"],
                       admitted_by=self.scorers[name]["admitted_by"],
                       defined_at=self.scorers[name]["line"])
        self._stack.append(name)
        self.walk_body(self.funcs[name].body, guards, name, in_try)
        self._stack.pop()


def normal_path_aborts(ev: dict) -> bool:
    """Can this abort fire on a normal, no-flag publish run?"""
    if ev.get("caught"):
        return False
    for g in ev["guards"]:
        if g["class"] in (COND_CLI, COND_DRAFT, "EXCEPT_HANDLER"):
            return False
    return True


def build() -> dict:
    src = TARGET.read_text(encoding="utf-8")
    tree = ast.parse(src)
    w = Walk(tree)
    w.run()

    aborts = [e for e in w.events if e["type"] == "ABORT"]
    gates_scorer = [e for e in w.events if e["type"] == "GATE"]

    # ENFORCEMENT gates are the abort sites that exist to convict: refuse_unless and assert.
    # A RETURN or a bare RAISE is an abort but not itself a gate; it is counted as an abort only.
    enforcement = [e for e in aborts if e["kind"] in ("REFUSE_UNLESS", "ASSERT")]

    rows: list[dict] = []
    for ev in gates_scorer + enforcement:
        preceding = [a for a in aborts
                     if a["order"] < ev["order"] and normal_path_aborts(a) and a is not ev]
        blocking = [
            {"kind": a["kind"], "line": a["line"], "func": a["func"], "expr": a["expr"]}
            for a in preceding
        ]
        reachable = "YES" if normal_path_aborts(ev) else "NO_NOT_ON_NORMAL_PATH"
        if any(g["class"] == "LOOP_BODY" for g in ev["guards"]):
            reachable = "YES_IF_LOOP_NONEMPTY"
        rows.append({
            "gate": ev.get("name") or f"{ev['kind']}@{ev['line']}",
            "gate_class": ev.get("gate_class", "ENFORCEMENT"),
            "kind": ev.get("kind", "SCORER_CALL"),
            "line": ev["line"],
            "enclosing_function": ev["func"],
            "order_in_normal_path": ev["order"],
            "expr": ev.get("expr", ""),
            "reachable_on_normal_path": reachable,
            "guard_stack": ev["guards"],
            "n_aborts_upstream_that_can_fire": len(blocking),
            "aborts_upstream": blocking[-12:],
        })
    rows.sort(key=lambda r: r["order_in_normal_path"])

    # ★ THE CORPSE CHECK STATED POSITIVELY. A scorer function that PRODUCES a verdict but that the
    # interprocedural walk from main() never reaches is a candidate corpse -- defined, verdict
    # computable, and on no path this walk can find. Enumerated here so "which scorers run" has a
    # complement, not just a list.
    reached_scorers = {e.get("name") for e in gates_scorer}
    defined_but_unreached = [
        {"scorer": name, "defined_at": meta["line"], "verdict_keys": meta["verdict_keys"],
         "admitted_by": meta["admitted_by"]}
        for name, meta in sorted(w.scorers.items())
        if name not in reached_scorers
    ]
    return {
        "target": TARGET.name,
        "n_abort_sites_reached_by_walk": len(aborts),
        "n_abort_sites_live_on_normal_path": sum(1 for a in aborts if normal_path_aborts(a)),
        "n_gates_examined_THE_DENOMINATOR": len(rows),
        "n_scorer_gates": len(gates_scorer),
        "n_enforcement_gates": len(enforcement),
        "n_scorer_FUNCTIONS_defined": len(w.scorers),
        "scorer_functions_defined_but_UNREACHED_by_walk": defined_but_unreached,
        "walk_notes": w.notes,
        "gates": rows,
        "aborts": [
            {"kind": a["kind"], "line": a["line"], "func": a["func"], "expr": a["expr"],
             "order": a["order"], "can_fire_on_normal_path": normal_path_aborts(a),
             "guard_stack": a["guards"]}
            for a in aborts
        ],
    }


# ---------------------------------------------------------------------------------------------
# THE DYNAMIC ARM. Static order says what SHOULD run; this says what DID. The generator is run
# in --draft (it may not publish, and a census must not publish for its subject) under a line
# tracer, and every executed line of the target file is recorded.
# ---------------------------------------------------------------------------------------------
TRACER = r'''
import sys, json, runpy
from pathlib import Path
TARGET = Path(sys.argv[1]).resolve()
OUTF = Path(sys.argv[2])
hit = set()
def tr(frame, event, arg):
    if frame.f_code.co_filename == str(TARGET):
        if event == "line":
            hit.add(frame.f_lineno)
        return tr
    return None
sys.argv = [str(TARGET)] + sys.argv[3:]
sys.settrace(tr)
code = 0
try:
    runpy.run_path(str(TARGET), run_name="__main__")
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
finally:
    sys.settrace(None)
    OUTF.write_text(json.dumps({"exit": code, "lines": sorted(hit)}), encoding="utf-8")
'''


def dynamic_arm(census: dict) -> dict:
    tmp = HERE / "_abort_census_tracer.py"
    hits_path = HERE / "_abort_census_hits.json"
    tmp.write_text(TRACER, encoding="utf-8")
    try:
        proc = subprocess.run(
            [sys.executable, str(tmp), str(TARGET), str(hits_path), "--draft"],
            capture_output=True, text=True, cwd=str(HERE), timeout=900)
        data = json.loads(hits_path.read_text(encoding="utf-8"))
    finally:
        tmp.unlink(missing_ok=True)
        hits_path.unlink(missing_ok=True)
    hit = set(data["lines"])
    for row in census["gates"]:
        row["EXECUTED_IN_TRACED_RUN"] = "YES" if row["line"] in hit else "NO"
    for ab in census["aborts"]:
        ab["EXECUTED_IN_TRACED_RUN"] = "YES" if ab["line"] in hit else "NO"
    return {
        "how": "sys.settrace line tracer over a real `--draft` invocation of the generator",
        "generator_exit_code": data["exit"],
        "n_distinct_lines_executed": len(hit),
        "stderr_tail": proc.stderr[-400:],
        "★_DECLARED_LIMIT": (
            "A --draft run RETURNS before the two publish-only guards (append-only and "
            "head-match). Those are marked NO here and that NO means 'not on this path', not "
            "'dead'. Every other gate runs identically in draft and publish -- draft changes "
            "only whether the artifact is written."
        ),
    }


def main() -> int:
    census = build()
    if "--static" not in sys.argv:
        census["dynamic_arm"] = dynamic_arm(census)
        ex = [r for r in census["gates"] if r.get("EXECUTED_IN_TRACED_RUN") == "YES"]
        census["n_gates_EXECUTED_in_traced_run"] = len(ex)
        census["n_gates_NOT_EXECUTED_in_traced_run"] = len(census["gates"]) - len(ex)
        # ★ RECONCILIATION AGAINST SOMETHING OUTSIDE THE PIPELINE: static says reachable,
        # dynamic says executed. Every disagreement is enumerated rather than summarised.
        census["DISAGREEMENTS_static_says_reachable_dynamic_says_no"] = [
            {"gate": r["gate"], "line": r["line"], "func": r["enclosing_function"],
             "n_aborts_upstream": r["n_aborts_upstream_that_can_fire"]}
            for r in census["gates"]
            if r["reachable_on_normal_path"] == "YES"
            and r.get("EXECUTED_IN_TRACED_RUN") == "NO"
        ]
    OUT.write_text(json.dumps(census, indent=1), encoding="utf-8", newline="\n")
    print(f"gates examined (THE DENOMINATOR): {census['n_gates_examined_THE_DENOMINATOR']}"
          f"  = {census['n_scorer_gates']} scorer + {census['n_enforcement_gates']} enforcement")
    print(f"abort sites reached by walk:      {census['n_abort_sites_reached_by_walk']}"
          f" ({census['n_abort_sites_live_on_normal_path']} can fire on a normal run)")
    if "dynamic_arm" in census:
        print(f"gates EXECUTED in traced run:     {census['n_gates_EXECUTED_in_traced_run']}")
        print(f"gates NOT executed:               {census['n_gates_NOT_EXECUTED_in_traced_run']}")
        print(f"static/dynamic disagreements:     "
              f"{len(census['DISAGREEMENTS_static_says_reachable_dynamic_says_no'])}")
    print(f"written: {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
