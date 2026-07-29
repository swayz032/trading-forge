"""ORDER-DEPENDENT SELECTION SWEEP.  AR-429 / R-452 §2.

`gen_ledger.py` was one INSTANCE. The species is ORDER-DEPENDENT SELECTION, and
standing law is to fix the class, not the instance.

THIS IS A MECHANICAL LAYER AND IT ONLY NOMINATES. A hit is a candidate for a
human read, never a finding — publishing nominations as findings is a convicted
shape here. The AR classifies; this file counts.

PATTERNS NOMINATED (R-452 §2's list):
  P1  iteration over a SET-valued local, or over .keys()/.values()/.items(),
      where the loop body SELECTS (assigns a best/first/chosen value)
  P2  a manual max/min loop -- `if best is None or x > best` -- which resolves a
      tie by keeping whichever candidate iteration happened to reach first
  P3  filesystem order treated as meaningful: glob/listdir/iterdir/rglob not
      wrapped in sorted()
  P4  randomness with no seed set anywhere in the file
  P5  `[0]` taken from an expression that was not sorted -- first-encountered-wins
  P6  max()/min() over a set/dict expression (ties broken by iteration order)

USAGE
    python order_dependence_sweep.py <root> [<root> ...]
"""

import ast
import json
import os
import sys

SELECTION_NAMES = ("best", "chosen", "pick", "picked", "winner", "selected",
                   "top", "champion", "first")
FS_CALLS = ("glob", "iglob", "listdir", "iterdir", "rglob", "scandir", "walk")
# receivers whose `walk`/`glob` is NOT a filesystem read (ast.walk is a deterministic
# tree traversal). Excluding these is a correction to the detector, not to the finding.
NON_FS_RECEIVERS = ("ast", "cst", "libcst", "_ast")
# calls whose [0] is deterministic by construction -- string/path surgery, not selection
DETERMINISTIC_INDEXABLE = ("split", "rsplit", "partition", "rpartition", "splitext",
                           "splitlines", "split_once", "groups", "match", "findall",
                           "most_common", "sorted", "split_ext", "rel_to", "as_posix")
RANDOM_MODULES = ("random", "np.random", "numpy.random")
SEED_CALLS = ("seed", "default_rng", "RandomState", "manual_seed")


class Nominator(ast.NodeVisitor):
    def __init__(self, path, src):
        self.path = path
        self.lines = src.splitlines()
        self.hits = []
        self.set_locals = set()
        self.has_seed = False

    def line(self, node):
        try:
            return self.lines[node.lineno - 1].strip()
        except IndexError:
            return ""

    def add(self, node, pattern, note):
        self.hits.append({"file": self.path, "line": node.lineno,
                          "pattern": pattern, "note": note, "src": self.line(node)})

    # --- learn which locals hold a set -------------------------------------
    @staticmethod
    def _is_set_expr(value):
        if isinstance(value, (ast.Set, ast.SetComp)):
            return True
        if isinstance(value, ast.Call):
            f = value.func
            if isinstance(f, ast.Name) and f.id in ("set", "frozenset"):
                return True
        return False

    def _bind(self, target, value):
        """Register set-valued locals. Handles TUPLE UNPACKING.

        ★ This is why the control probe initially failed. `gen_ledger.py` writes
          `chosen, rem, step = [], set(CLASSES), 0`
        and the first version of this visitor only looked at `ast.Name` targets, so
        `rem` was never learned as a set and the `for c in rem:` selection loop below
        it was never nominated. The sweep returned 0 hits on the one instrument
        already PROVEN broken -- a null result with no path to red. Fixed here, and
        the control probe is now part of the sweep's own acceptance.
        """
        if isinstance(target, ast.Tuple) and isinstance(value, ast.Tuple):
            for t, v in zip(target.elts, value.elts):
                self._bind(t, v)
            return
        if isinstance(target, ast.Name) and self._is_set_expr(value):
            self.set_locals.add(target.id)

    def visit_Assign(self, node):
        if isinstance(node.value, ast.Call):
            f = node.value.func
            if isinstance(f, ast.Attribute) and f.attr in SEED_CALLS:
                self.has_seed = True
        for t in node.targets:
            self._bind(t, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self._bind(node.target, node.value)
        self.generic_visit(node)

    def visit_Call(self, node):
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
        if name in SEED_CALLS:
            self.has_seed = True
        # P3 filesystem order -- the RECEIVER decides. `ast.walk` is a deterministic
        # tree traversal, not a directory read; flagging it was a detector defect
        # that produced 53 of the first run's 71 nominations.
        if name in FS_CALLS:
            recv = ""
            if isinstance(f, ast.Attribute):
                r = f.value
                recv = r.id if isinstance(r, ast.Name) else getattr(getattr(r, "func", None), "id", "")
            if recv not in NON_FS_RECEIVERS:
                self.add(node, "P3_filesystem_order",
                         f"{recv + '.' if recv else ''}{name}() not wrapped in sorted()"
                         if "sorted" not in self.line(node)
                         else f"{name}() inside sorted() -- likely OK")
        # P6 max/min over a set/dict
        if name in ("max", "min") and node.args:
            a = node.args[0]
            if isinstance(a, (ast.Set, ast.SetComp, ast.DictComp)) or (
                    isinstance(a, ast.Name) and a.id in self.set_locals):
                if not any(k.arg == "key" for k in node.keywords):
                    self.add(node, "P6_extremum_over_unordered",
                             f"{name}() over a set/dict with no key= -- ties break by iteration order")
        # P5 first-encountered-wins:  <call>(...)[0] handled in Subscript
        self.generic_visit(node)

    def visit_Subscript(self, node):
        # P5  x[0] where x is an UNORDERED collection.
        # `"a.b".split(".")[0]` is deterministic string surgery, not selection --
        # flagging it produced 14 of the second run's 40 nominations, all noise.
        idx = node.slice
        if not (isinstance(idx, ast.Constant) and idx.value == 0):
            return self.generic_visit(node)
        val = node.value
        risky, why = False, ""
        if isinstance(val, ast.Name) and val.id in self.set_locals:
            risky, why = True, f"index [0] of set-valued local `{val.id}`"
        elif isinstance(val, ast.Call):
            f = val.func
            fname = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
            if fname in DETERMINISTIC_INDEXABLE:
                risky = False
            elif fname in ("keys", "values", "items"):
                risky, why = True, f"index [0] of .{fname}() -- dict order, not a rank"
            elif fname in FS_CALLS:
                risky, why = True, f"index [0] of {fname}() -- filesystem order, not a rank"
            elif fname in ("list", "tuple") and val.args and isinstance(val.args[0], (ast.Set, ast.SetComp)):
                risky, why = True, "index [0] of list(<set>) -- set order, not a rank"
        if risky and "sorted(" not in self.line(node):
            self.add(node, "P5_first_encountered_wins", why)
        self.generic_visit(node)

    def visit_For(self, node):
        it = node.iter
        unordered = False
        what = ""
        if isinstance(it, ast.Name) and it.id in self.set_locals:
            unordered, what = True, f"set-valued local `{it.id}`"
        if isinstance(it, (ast.Set, ast.SetComp)):
            unordered, what = True, "a set literal/comprehension"
        if isinstance(it, ast.Call) and isinstance(it.func, ast.Attribute) \
                and it.func.attr in ("keys", "values", "items"):
            unordered, what = True, f".{it.func.attr}() without sorted()"
        if unordered:
            body = ast.dump(ast.Module(body=node.body, type_ignores=[]))
            selects = any(n in body.lower() for n in SELECTION_NAMES)
            manual_max = "Compare" in body and ("Gt" in body or "Lt" in body)
            if selects or manual_max:
                self.add(node, "P1_unordered_iteration_that_selects",
                         f"iterates {what}; body assigns/compares a selection variable")
            if manual_max and selects:
                self.add(node, "P2_manual_max_first_wins",
                         "manual max/min over unordered iteration -- first max wins")
        self.generic_visit(node)


def scan_file(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            src = fh.read()
        tree = ast.parse(src)
    except SyntaxError as exc:
        return [{"file": path, "line": 0, "pattern": "PARSE_ERROR",
                 "note": str(exc), "src": ""}], False
    n = Nominator(path, src)
    n.visit(tree)
    uses_random = any(m.split(".")[0] in src for m in RANDOM_MODULES) and "random." in src
    if uses_random and not n.has_seed:
        n.hits.append({"file": path, "line": 0, "pattern": "P4_unseeded_randomness",
                       "note": "random used with no seed call in file", "src": ""})
    return n.hits, True


# The known-broken instrument, reduced to its defect. The sweep MUST nominate this,
# or a null result over the real surface means nothing (R-452 §1; AR-429 §4).
CONTROL_BROKEN = '''
def pick(byvid, CLASSES):
    chosen, rem, step = [], set(CLASSES), 0
    while rem:
        best = None
        for c in rem:
            cand = set(chosen) | {c}
            u = sum(1 for v, s in byvid.items() if s <= cand)
            if best is None or u > best[1]:
                best = (c, u)
        chosen.append(best[0]); rem.discard(best[0]); step += 1
    return chosen
'''
# A deterministic instrument of the same shape. The sweep must NOT nominate this,
# or it flags everything and cannot tell a defect from a control.
CONTROL_CLEAN = '''
def pick(byvid, CLASSES):
    chosen, remaining = [], sorted(CLASSES)
    while remaining:
        scored = sorted((sum(1 for s in byvid.values() if s <= set(chosen) | {c}), c)
                        for c in remaining)
        best = scored[-1][1]
        chosen.append(best); remaining.remove(best)
    return chosen
'''


def self_test():
    """DISCRIMINATION PROOF for the sweep itself: RED on the known defect, GREEN on
    a clean instrument of the same shape."""
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as td:
        for label, src, want in (("BROKEN", CONTROL_BROKEN, True),
                                 ("CLEAN", CONTROL_CLEAN, False)):
            p = os.path.join(td, f"control_{label.lower()}.py")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(src)
            hits, _ = scan_file(p)
            sel = [h for h in hits if h["pattern"].startswith(("P1", "P2"))]
            got = bool(sel)
            status = "PASS" if got == want else "FAIL"
            ok &= (got == want)
            print(f"  {status}  control {label:6s} -> {len(sel)} selection nomination(s), "
                  f"expected {'>=1' if want else '0'}")
    print(f"\nSELF-TEST {'PASSED -- the sweep discriminates' if ok else 'FAILED -- a null result from this sweep is worthless'}")
    return 0 if ok else 1


def main():
    if sys.argv[1:2] == ["--self-test"]:
        return self_test()
    roots = sys.argv[1:] or ["."]
    # `--set <file.json>` sweeps an EXPLICIT registered list (R-455 §2: audit only
    # instruments that produced a published decision or enforce a live gate, and
    # then CLOSE the sweep). A bounded surface is the point, not a limitation.
    if roots[0] == "--set":
        with open(roots[1], encoding="utf-8") as fh:
            listed = json.load(fh)
        files = sorted(listed["registered"] if isinstance(listed, dict) else listed)
        roots = [f"--set {roots[1]} ({len(files)} registered instruments)"]
    else:
        files = []
        for root in roots:
            if os.path.isfile(root):
                files.append(root.replace("\\", "/"))
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
                for fn in sorted(filenames):
                    if fn.endswith(".py"):
                        files.append(os.path.join(dirpath, fn).replace("\\", "/"))
    hits, parsed = [], 0
    for path in sorted(files):
        h, ok = scan_file(path)
        parsed += 1 if ok else 0
        hits.extend(h)

    print("=" * 78)
    print("SURFACE (published beside the count -- a census is bounded by its surface)")
    print("=" * 78)
    for r in roots:
        print(f"  root: {r}")
    print(f"  python files walked : {len(files)}")
    print(f"  parsed successfully : {parsed}")
    print(f"  parse failures      : {len(files) - parsed}")
    print(f"  NOMINATIONS         : {len(hits)}  (candidates for a human read, NOT findings)")

    by_pat = {}
    for h in hits:
        by_pat.setdefault(h["pattern"], []).append(h)
    print("\nby pattern:")
    for p in sorted(by_pat):
        print(f"  {p:38s} {len(by_pat[p]):3d}")
    by_file = {}
    for h in hits:
        by_file.setdefault(h["file"], []).append(h)
    print(f"\nfiles with >=1 nomination: {len(by_file)} of {len(files)}")

    print("\n" + "=" * 78)
    print("NOMINATIONS")
    print("=" * 78)
    for path in sorted(by_file):
        print(f"\n--- {path}")
        for h in sorted(by_file[path], key=lambda x: (x["line"], x["pattern"])):
            print(f"  :{h['line']:<5d} {h['pattern']:36s} {h['note']}")
            if h["src"]:
                print(f"         | {h['src'][:100]}")

    with open("order-dependence-sweep-2026-07-29.json", "w", encoding="utf-8") as fh:
        json.dump({"surface": {"roots": roots, "files_walked": len(files),
                               "parsed": parsed, "parse_failures": len(files) - parsed},
                   "nominations": sorted(hits, key=lambda h: (h["file"], h["line"]))},
                  fh, indent=1, sort_keys=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
