#!/usr/bin/env python3
"""absence-claim-control -- make an ABSENCE claim provable, or fail LOUD.

Minted R-468 §5 (operator-ordered). REBUILT at R-470 §2 after the previous version
was REJECTED with three false-greens, of which it had closed one.

    A SEARCH THAT CANNOT SUCCEED REPORTS FAILURE, AND FAILURE READS AS FACT.

★★★★★ WHY THIS IS A REBUILD AND NOT A PATCH. The v2 guard existed to enforce
`READ THE EXECUTABLE LINE, NOT THE COMMENT`, and its POSITIVE CONTROL -- the
mechanism licensing every absence verdict it issues -- was satisfiable BY A
COMMENT. Pointed at its own .py source as the control for the Node API
`writeFileSync`, it returned `CONTROL HIT (4 matches)` and exit 0. A Python file
cannot import a Node `fs` API in principle.
  `A GUARD INHERITS EVERY WEAKNESS OF THE METHOD IT AUTOMATES.`
Automating a grep does not make the grep sound -- it makes it AUTHORITATIVE.

★★★★★ AND WHY PATTERNS ALONE CANNOT FIX IT (R-470 §1). The three defects pull in
opposite directions:
  (i)   ANY dynamic import counted for ANY capability          -- fixed in v2
  (ii)  computed member access: fs[("write"+"File"+"Sync")](p) -- ZERO literal
        occurrences of the symbol, so binding patterns to the literal name (the
        CORRECT fix for (i)) is exactly what makes (ii) invisible
  (iii) a bare textual occurrence in a comment/string counted as evidence
A literal-text search CANNOT decide capability ABSENCE under computed member
access. That is a DESIGN BOUNDARY, not a missing regex. The answer is to
FAIL CLOSED, never to write a cleverer pattern.

TWO MODES, AND EACH MAY MAKE ONLY ITS OWN CLAIM (R-470 §2.1)
  --pattern PAT              TEXT mode. May claim ONLY text presence/absence.
                             It may NEVER be reported as a capability verdict.
  --module M --symbol S      CAPABILITY mode. Syntax-aware and MODULE-QUALIFIED:
                             it asks "is symbol S of module M actually ENGAGED
                             here", not "does this string appear".

CAPABILITY MODE RULES
  * comments, docstrings and ALL string/template literals are stripped first
  * a bare identifier occurrence is NOT evidence (r"\\b{name}\\b" is GONE)
  * a same-named LOCAL function or unrelated property is NOT evidence
  * the symbol must be bound FROM the named module: static named import,
    `import * as ns` + `ns.SYM`, or destructuring an `await import(M)`/`require(M)`
  * unsupported language  -> VERDICT UNAVAILABLE, non-zero (never "admissible")
  * computed member access on a namespace bound to M -> UNDECIDABLE -> non-zero

EXIT CODES
  0  capability ENGAGED (or text PRESENT) at the control -> the absence result
     over the remainder of the enumerated surface is ADMISSIBLE
  2  control searched, capability NOT engaged / text ABSENT -> INADMISSIBLE
  3  control is not inside the enumerated surface
  4  usage error, or the surface exceeded the runtime bound
  5  --self-test: a fixture produced the wrong exit code
  8  VERDICT UNAVAILABLE -- fail-closed: unsupported language, or an undecidable
     construct at the control. NEVER reported as an admissible absence.

USAGE
  python absence_claim_control.py --module fs --symbol writeFileSync \\
      --control <file> --name "atomize-transcript.ts"
  python absence_claim_control.py --self-test
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import pathlib
import re
import sys
import time

DEFAULT_ROOT = pathlib.Path(r"C:\Users\tonio\Projects")
JS_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

PRUNE_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", ".cache", ".pytest_cache", ".mypy_cache", "coverage", "target",
    ".turbo", ".parcel-cache",
}

# DOCUMENTED RUNTIME BOUND (R-470 §2.7). MEASURED on this box: --self-test 0.3s;
# --name "atomize-transcript.ts" over 47 repos / 50 files 2.5s. The pathological
# path is an OMITTED --name, which reads every file in every repo -- the run that
# exceeded 120s twice at the desk. A bound that fails LOUD is a bound.
MAX_FILES = 20_000

ENGAGED, NOT_ENGAGED, UNDECIDABLE, UNSUPPORTED = "ENGAGED", "NOT_ENGAGED", "UNDECIDABLE", "UNSUPPORTED"


# --------------------------------------------------------------- source stripping
def strip_js_noise(src: str) -> str:
    """Replace comments and string/template literals with spaces, PRESERVING
    LENGTH so reported offsets stay meaningful. This is what makes a comment
    mention stop counting -- defect (iii)."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
        elif c == "/" and nxt == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            for _ in range(2):
                if i < n:
                    out[i] = " "
                    i += 1
        elif c in "\"'`":
            quote = c
            out[i] = " "
            i += 1
            while i < n:
                if src[i] == "\\":
                    out[i] = " "
                    if i + 1 < n:
                        out[i + 1] = " "
                    i += 2
                    continue
                if src[i] == quote:
                    out[i] = " "
                    i += 1
                    break
                if src[i] != "\n":
                    out[i] = " "
                i += 1
        else:
            i += 1
    return "".join(out)


def norm_module(m: str) -> str:
    return m[5:] if m.startswith("node:") else m


def classify_capability(path: pathlib.Path, module: str, symbol: str) -> tuple[str, str]:
    """Module-qualified engagement. Returns (state, why)."""
    if path.suffix not in JS_EXT:
        return UNSUPPORTED, (f"language {path.suffix or '(none)'} is not parsed by this guard; "
                             f"a capability verdict is REFUSED rather than guessed")
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return UNSUPPORTED, f"unreadable: {exc}"

    code = strip_js_noise(raw)
    mod = re.escape(module)
    modpat = rf"['\"](?:node:)?{mod}['\"]"
    # NOTE: quotes were stripped from `code`, so module specifiers are matched on
    # the RAW text; bindings are then confirmed against the stripped code.
    sym = re.escape(symbol)

    destructured, namespaces = False, []

    # static: import { a, b as c } from "mod"
    for m in re.finditer(rf"import\s*\{{([^}}]*)\}}\s*from\s*{modpat}", raw):
        if re.search(rf"\b{sym}\b", m.group(1)):
            destructured = True
    # static namespace: import * as ns from "mod"   |   default: import ns from "mod"
    for m in re.finditer(rf"import\s+\*\s+as\s+(\w+)\s+from\s*{modpat}", raw):
        namespaces.append(m.group(1))
    for m in re.finditer(rf"import\s+(\w+)\s*,?\s*(?:\{{[^}}]*\}}\s*)?from\s*{modpat}", raw):
        namespaces.append(m.group(1))
    # dynamic / cjs: const { a } = await import("mod") | require("mod")
    for m in re.finditer(rf"\{{([^}}]*)\}}\s*=\s*(?:await\s+import|require)\(\s*{modpat}", raw):
        if re.search(rf"\b{sym}\b", m.group(1)):
            destructured = True
    # dynamic namespace: const ns = await import("mod") | require("mod")
    for m in re.finditer(rf"(\w+)\s*=\s*(?:await\s+import|require)\(\s*{modpat}", raw):
        namespaces.append(m.group(1))

    if not destructured and not namespaces:
        return NOT_ENGAGED, (f"no binding of {module!r} found; a bare occurrence of "
                             f"{symbol!r} is NOT capability evidence")

    # A namespace reached by COMPUTED access is undecidable by text -- fail closed.
    for ns in namespaces:
        if re.search(rf"\b{re.escape(ns)}\s*\[", code):
            return UNDECIDABLE, (f"namespace {ns!r} is bound to {module!r} and reached by "
                                 f"COMPUTED member access ({ns}[...]); a literal-text search "
                                 f"cannot decide whether {symbol!r} is engaged")
    if destructured and re.search(rf"\b{sym}\b", code):
        return ENGAGED, f"{symbol!r} destructured from {module!r} and referenced in code"
    for ns in namespaces:
        if re.search(rf"\b{re.escape(ns)}\s*\.\s*{sym}\b", code):
            return ENGAGED, f"{ns}.{symbol} member access on a namespace bound to {module!r}"
    return NOT_ENGAGED, f"{module!r} is imported but {symbol!r} is not engaged from it"


# ------------------------------------------------------------------ surface walk
def enumerate_repos(root: pathlib.Path) -> dict[pathlib.Path, str]:
    repos: dict[pathlib.Path, str] = {}
    for depth in ("*/.git", "*/*/.git"):
        try:
            for git in root.glob(depth):
                p = git.parent
                repos[p.resolve()] = p.name if depth == "*/.git" else f"{p.parent.name}/{p.name}"
        except OSError:
            pass
    return repos


def owning_repo(path: pathlib.Path, repos: dict[pathlib.Path, str]) -> str:
    best, best_len = "<NO REPO -- outside every git tree>", -1
    rp = path.resolve()
    for root, name in repos.items():
        try:
            rp.relative_to(root)
        except ValueError:
            continue
        if len(str(root)) > best_len:
            best, best_len = name, len(str(root))
    return best


def collect_files(surfaces: list[pathlib.Path], name_glob: str) -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for s in surfaces:
        if s.is_file():
            out.append(s)
            continue
        for dirpath, dirnames, filenames in os.walk(s):
            dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
            for fn in filenames:
                if name_glob == "*" or fnmatch.fnmatch(fn, name_glob):
                    out.append(pathlib.Path(dirpath) / fn)
    return out


def run_check(control: pathlib.Path, surfaces: list[pathlib.Path], name_glob: str,
              root: pathlib.Path, *, module: str | None = None, symbol: str | None = None,
              patterns: list[str] | None = None, verbose: bool = True,
              max_files: int = MAX_FILES) -> int:
    t0 = time.monotonic()
    files = collect_files(surfaces, name_glob)
    if len(files) > max_files:
        if verbose:
            print("\n" + "!" * 74)
            print(f"REFUSING TO RUN -- exit 4: surface is {len(files)} files (bound {max_files}).")
            print("An unbounded surface is how this guard became unusable. Narrow")
            print("--name/--surface, or raise --max-files deliberately.")
            print("!" * 74)
        return 4
    repos = enumerate_repos(root)
    mode = "CAPABILITY (module-qualified, syntax-aware)" if module else "TEXT (may claim ONLY text presence/absence)"

    results: dict[pathlib.Path, tuple[str, str]] = {}
    if module:
        for p in files:
            results[p.resolve()] = classify_capability(p, module, symbol or "")
    else:
        pats = [re.compile(p, re.MULTILINE) for p in (patterns or [])]
        for p in files:
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            n = sum(len(x.findall(text)) for x in pats)
            results[p.resolve()] = ((ENGAGED, f"{n} text match(es)") if n
                                    else (NOT_ENGAGED, "no text match"))
    elapsed = time.monotonic() - t0

    if verbose:
        print("=" * 74)
        print("ABSENCE-CLAIM CONTROL  (R-468 §5; REBUILT per R-470 §2)")
        print("=" * 74)
        print(f"mode    : {mode}")
        if module:
            print(f"query   : symbol {symbol!r} of module {norm_module(module)!r}")
            print("          a bare occurrence is NOT evidence; comments and strings are stripped")
        else:
            for p in (patterns or []):
                print(f"pattern : {p}")
            print("          TEXT MODE MAY NOT BE REPORTED AS A CAPABILITY VERDICT")
        print(f"control : {control}")
        print(f"surface : {len(files)} files matching {name_glob!r}")
        print(f"repos   : {len(repos)} enumerated under {root}")
        print(f"ELAPSED : {elapsed:.1f}s   (measured, not asserted)")
        if name_glob != "*":
            print(f"\n--- ENUMERATED SURFACE: every copy of {name_glob!r}, with owning repo ---")
            for p in sorted(files):
                st = results.get(p.resolve(), (UNSUPPORTED, ""))[0]
                tag = {ENGAGED: "ENGAGED ", NOT_ENGAGED: "   .    ",
                       UNDECIDABLE: "UNDECID ", UNSUPPORTED: "UNSUPP  "}[st]
                try:
                    size = p.stat().st_size
                except OSError:
                    size = -1
                print(f"  {tag}{size:>8}  [{owning_repo(p, repos)}]  {p}")
        n_eng = sum(1 for v in results.values() if v[0] == ENGAGED)
        n_und = sum(1 for v in results.values() if v[0] == UNDECIDABLE)
        print(f"\n--- RESULT: {n_eng} ENGAGED, {n_und} UNDECIDABLE, of {len(files)} files ---")

    ctrl = control.resolve()
    if ctrl not in {f.resolve() for f in files}:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 3: the POSITIVE CONTROL IS NOT IN THE SURFACE.")
            print("The search never looked where the thing is known to be.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 3

    state, why = results[ctrl]
    if state == UNSUPPORTED:
        if verbose:
            print("\n" + "!" * 74)
            print("VERDICT UNAVAILABLE -- exit 8 (FAIL CLOSED)")
            print(f"  {why}")
            print("A regex fallback MAY NOT issue a capability verdict. No absence")
            print("claim may cite this run.")
            print("!" * 74)
        return 8
    if state == UNDECIDABLE:
        if verbose:
            print("\n" + "!" * 74)
            print("VERDICT UNAVAILABLE -- exit 8 (FAIL CLOSED, UNDECIDABLE)")
            print(f"  {why}")
            print("This is R-470 §1(ii): a literal-text search cannot decide capability")
            print("absence under computed member access. Failing closed is the answer;")
            print("a cleverer pattern is not.")
            print("!" * 74)
        return 8
    if state == NOT_ENGAGED:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 2: the POSITIVE CONTROL was examined and the")
            print("capability is NOT ENGAGED there, so the search cannot find the thing")
            print("even where it is supposed to be. ANY absence conclusion is INADMISSIBLE.")
            print(f"  {why}")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 2

    if verbose:
        print("\n" + "-" * 74)
        print(f"CONTROL ENGAGED -- {why}")
        print("The search is CAPABLE. An absence over the remainder of the surface")
        print("above is ADMISSIBLE, and must be cited together with that surface.")
        print("-" * 74)
    return 0


# ---------------------------------------------- PERMANENT FIXTURES (R-470 §2.6)
FIX_DIR = pathlib.Path(__file__).resolve().parent / "absence-fixtures"
SELF_SRC = pathlib.Path(__file__).resolve()

FIXTURES = [
    ("comment-only mention", "comment_only.ts", 2,
     "defect (iii): a comment satisfied the v2 positive control"),
    ("string-literal-only mention", "string_only.ts", 2,
     "a string literal is not an engagement"),
    ("same-named LOCAL function, no import", "local_fn.ts", 2,
     "an unrelated local of the same name is not the module's API"),
    ("unrelated dynamic import", "unrelated_dynamic.ts", 2,
     "defect (i): v2 counted ANY dynamic import for ANY capability"),
    ("COMPUTED member access on a bound namespace", "computed_access.ts", 8,
     "defect (ii): zero literal occurrences; a name-bound repair makes this "
     "invisible, so the guard must FAIL CLOSED rather than green it"),
    ("genuine STATIC named import", "genuine_static.ts", 0,
     "the passing control -- without it, 'always red' looks like 'discriminates'"),
    ("genuine DYNAMIC destructured import", "genuine_dynamic.ts", 0,
     "dynamic reach must still be detected when it is module-qualified"),
    ("WRONG SURFACE (control outside it)", None, 3,
     "AR-461's wrong object: searching one tree, concluding about the program"),
    ("UNSUPPORTED LANGUAGE: this guard's own .py as control", None, 8,
     "R-470 §1(iii) verbatim: a Python file cannot import a Node fs API in "
     "principle, and v2 returned CONTROL HIT (4 matches) / exit 0"),
]


def self_test() -> int:
    print("=" * 74)
    print("PERMANENT FIXTURES -- each asserts a REQUIRED exit code (R-470 §2.6)")
    print("=" * 74)
    failures = []
    for label, fname, want, why in FIXTURES:
        if fname:
            ctrl, surfaces, glob = FIX_DIR / fname, [FIX_DIR], fname
        elif label.startswith("WRONG SURFACE"):
            ctrl, surfaces, glob = FIX_DIR / "genuine_static.ts", [FIX_DIR / "nonexistent"], "*.ts"
        else:
            ctrl, surfaces, glob = SELF_SRC, [SELF_SRC.parent], SELF_SRC.name
        got = run_check(ctrl, surfaces, glob, DEFAULT_ROOT,
                        module="fs", symbol="writeFileSync", verbose=False)
        ok = got == want
        print(f"\n[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"       required exit {want}, got {got}")
        print(f"       why: {why}")
        if not ok:
            failures.append((label, want, got))
    print("\n" + "=" * 74)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} fixture(s) deviated:")
        for label, want, got in failures:
            print(f"  {label}: wanted {want}, got {got}")
        print("=" * 74)
        return 5
    print(f"SELF-TEST PASSED -- {len(FIXTURES)} fixtures, and they DISCRIMINATE across")
    print("FOUR outcomes: 0 engaged (2 cases) · 2 not-engaged (4 cases) ·")
    print("3 wrong surface · 8 fail-closed (undecidable + unsupported language).")
    print("A suite with no passing control cannot tell 'catches breakage' from")
    print("'always red'; a suite with no fail-closed case cannot tell 'decided")
    print("absent' from 'could not decide'.")
    print("=" * 74)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove a search is CAPABLE before believing its absence.")
    ap.add_argument("--pattern", action="append", default=[], help="TEXT mode regex (repeatable)")
    ap.add_argument("--module", help="CAPABILITY mode: the module the symbol must come from")
    ap.add_argument("--symbol", help="CAPABILITY mode: the symbol that must be engaged")
    ap.add_argument("--control", help="POSITIVE-CONTROL path that MUST be engaged")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--name", default="*", help="filename glob limiting the surface")
    ap.add_argument("--surface", action="append", default=[])
    ap.add_argument("--max-files", type=int, default=MAX_FILES)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    if not a.control:
        print("USAGE ERROR: --control is required (or --self-test)", file=sys.stderr)
        return 4
    if bool(a.module) != bool(a.symbol):
        print("USAGE ERROR: --module and --symbol must be given together", file=sys.stderr)
        return 4
    if not a.module and not a.pattern:
        print("USAGE ERROR: give --module/--symbol (capability) or --pattern (text)", file=sys.stderr)
        return 4
    if a.module and a.pattern:
        print("USAGE ERROR: modes are separate -- a text pattern may not back a "
              "capability verdict (R-470 §2.1)", file=sys.stderr)
        return 4
    control = pathlib.Path(a.control)
    if not control.is_file():
        print(f"USAGE ERROR: control is not a readable file: {control}", file=sys.stderr)
        return 4

    root = pathlib.Path(a.root)
    surfaces = [pathlib.Path(s) for s in (a.surface or [str(root)])]
    return run_check(control, surfaces, a.name, root, module=a.module, symbol=a.symbol,
                     patterns=a.pattern, max_files=a.max_files)


if __name__ == "__main__":
    sys.exit(main())
