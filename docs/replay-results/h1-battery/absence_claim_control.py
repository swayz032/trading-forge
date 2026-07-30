#!/usr/bin/env python3
"""absence-claim-control -- make an ABSENCE claim provable, or fail LOUD.

Minted R-468 §5 (operator-ordered). Rebuilt R-470 §2. **Repaired again R-471 §4.**

    A SEARCH THAT CANNOT SUCCEED REPORTS FAILURE, AND FAILURE READS AS FACT.

★★★★★ WHAT THIS TOOL IS. A CONSERVATIVE BINDING ANALYSIS that FAILS CLOSED.
  It is NOT "syntax-aware" -- that caption was withdrawn at R-471 §4.7 because it
  claimed a property the tool did not have, and it was the instrument's headline.
  `A CAPTION IS A CLAIM.` What it actually decides is: is symbol S, bound from
  module M, REFERENCED at an executable site outside its own declaration -- and
  when it cannot decide that soundly, it REFUSES A VERDICT.

★★★★★ THE DEFECT THAT FORCED THIS REPAIR (R-471 §1), stated so it cannot recur
  quietly. v3 computed MODULE PROVENANCE over the RAW text (so string quotes on
  the module specifier would survive) and EXECUTABLE USE over the STRIPPED text.
  It then ANDed two facts that were never about the same binding:
      // import { writeFileSync } from "fs";      <-- provenance, from a COMMENT
      export function writeFileSync(p, d) {...}   <-- "usage", an UNRELATED LOCAL
  ...returned `1 ENGAGED`, "destructured from 'fs' and referenced in code", exit 0.
  The verdict string asserted an import that did not exist. v3's own source carried
  a NOTE admitting the two-text problem -- noticed, written down, and shipped.
      `MODULE PROVENANCE AND EXECUTABLE USE MUST RESOLVE TO THE SAME BINDING.`
  And separately: an UNUSED import greened, because the reference search saw the
  identifier INSIDE ITS OWN IMPORT DECLARATION.
      `PROVING PRESENCE IS NOT PROVING USE.` Any "is X used" check must exclude
      the site that DECLARES X.

★★★★★ AND THE METHOD LESSON, WHICH COST TWO FALSE CLOSURES:
      `ISOLATED FIXTURES DO NOT ESTABLISH CLOSURE UNDER COMPOSITION.`
  Nine fixtures each genuinely passed while a PAIR of the negative cases greened.
  This suite therefore ships TWO COMPOSED fixtures, and any future guard that ANDs
  two signals owes composed cases as well as singletons.

TWO MODES, EACH MAY MAKE ONLY ITS OWN CLAIM (R-470 §2.1)
  --pattern PAT            TEXT mode: may claim ONLY text presence/absence.
  --module M --symbol S    BINDING mode: module-qualified engagement.
  The modes may not be combined; a text pattern may never back a binding verdict.

EXIT CODES
  0  ENGAGED at the control -> absence over the rest of the surface is ADMISSIBLE
  2  control examined, NOT engaged -> any absence conclusion is INADMISSIBLE
  3  control is not inside the enumerated surface
  4  usage error, or surface exceeded the runtime bound
  5  --self-test: a fixture missed its PRE-REGISTERED exit code
  8  VERDICT UNAVAILABLE (fail closed): unsupported language, computed member
     access on a bound namespace, or a local shadow of the imported name.
     NEVER reported as an admissible absence.
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
# DOCUMENTED RUNTIME BOUND (R-470 §2.7). MEASURED: --self-test ~0.4s; a
# --name-limited query over 47 repos / 50 files ~2.6s. The pathological path is an
# OMITTED --name, which reads every file in every repo.
MAX_FILES = 20_000

ENGAGED, NOT_ENGAGED, UNDECIDABLE, UNSUPPORTED = "ENGAGED", "NOT_ENGAGED", "UNDECIDABLE", "UNSUPPORTED"


def norm_module(m: str) -> str:
    """`fs` and `node:fs` are the SAME module identity. Used for MATCHING, not
    display -- R-471 §4.6; v3 defined this and then only printed with it."""
    return m[5:] if m.startswith("node:") else m


def split_texts(src: str) -> tuple[str, str]:
    """ONE pass, TWO length-preserving views -- the whole point of the repair.

      no_comments : comments blanked, STRING LITERALS PRESERVED. Bindings are
                    resolved ONLY here, so a commented-out import creates NOTHING.
      code        : comments blanked AND string-literal CONTENT blanked, but
                    template `${...}` EXPRESSIONS PRESERVED, because an executable
                    call inside an interpolation is executable code and deleting
                    it produced a FALSE ABSENCE (R-471 §1, relayed case).
    """
    n = len(src)
    nc, cd = list(src), list(src)
    i = 0
    # stack of "template" markers; inside ${...} we return to normal scanning
    tmpl_depth: list[int] = []
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                nc[i] = cd[i] = " "
                i += 1
        elif c == "/" and nxt == "*":
            j = i
            while j < n and not (src[j] == "*" and j + 1 < n and src[j + 1] == "/"):
                if src[j] != "\n":
                    nc[j] = cd[j] = " "
                j += 1
            for _ in range(2):
                if j < n:
                    nc[j] = cd[j] = " "
                    j += 1
            i = j
        elif c in "\"'":
            quote = c
            cd[i] = " "
            i += 1
            while i < n:
                if src[i] == "\\":
                    cd[i] = " "
                    if i + 1 < n:
                        cd[i + 1] = " "
                    i += 2
                    continue
                if src[i] == quote:
                    cd[i] = " "
                    i += 1
                    break
                if src[i] != "\n":
                    cd[i] = " "
                i += 1
        elif c == "`":
            cd[i] = " "
            i += 1
            while i < n:
                if src[i] == "\\":
                    cd[i] = " "
                    if i + 1 < n:
                        cd[i + 1] = " "
                    i += 2
                    continue
                if src[i] == "`":
                    cd[i] = " "
                    i += 1
                    break
                if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                    # PRESERVE the interpolated expression in `code`
                    cd[i] = cd[i + 1] = " "
                    i += 2
                    depth = 1
                    while i < n and depth:
                        if src[i] == "{":
                            depth += 1
                        elif src[i] == "}":
                            depth -= 1
                            if depth == 0:
                                cd[i] = " "
                                i += 1
                                break
                        i += 1  # leave expression chars intact in cd
                    continue
                if src[i] != "\n":
                    cd[i] = " "
                i += 1
        else:
            i += 1
    return "".join(nc), "".join(cd)


def _clause_local(clause: str, symbol: str) -> str | None:
    """`{ a, writeFileSync as wfs }` -> the LOCAL name bound to `symbol`."""
    for part in clause.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\w+)\s+as\s+(\w+)$", part)
        if m:
            if m.group(1) == symbol:
                return m.group(2)
        elif part == symbol:
            return part
    return None


def classify_capability(path: pathlib.Path, module: str, symbol: str) -> tuple[str, str]:
    if path.suffix not in JS_EXT:
        return UNSUPPORTED, (f"language {path.suffix or '(none)'} is not analysed by this "
                             f"guard; a verdict is REFUSED rather than guessed")
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return UNSUPPORTED, f"unreadable: {exc}"

    no_comments, code = split_texts(raw)
    target = re.escape(norm_module(module))
    spec = rf"['\"](?:node:)?{target}['\"]"
    sym = re.escape(symbol)

    locals_bound: list[str] = []
    namespaces: list[str] = []
    decl_spans: list[tuple[int, int]] = []

    def scan(pattern: str, kind: str) -> None:
        # BINDINGS ARE RESOLVED ONLY OVER `no_comments`.
        for m in re.finditer(pattern, no_comments, re.MULTILINE):
            if kind == "clause":
                loc = _clause_local(m.group(1), symbol)
                if loc:
                    locals_bound.append(loc)
                    decl_spans.append(m.span())
            else:
                namespaces.append(m.group(1))
                decl_spans.append(m.span())

    scan(rf"import\s*\{{([^{{}}]*)\}}\s*from\s*{spec}", "clause")
    scan(rf"\{{([^{{}}]*)\}}\s*=\s*(?:await\s+import|require)\s*\(\s*{spec}\s*\)", "clause")
    scan(rf"import\s+\*\s+as\s+(\w+)\s+from\s*{spec}", "ns")
    scan(rf"import\s+(\w+)\s+from\s*{spec}", "ns")
    scan(rf"(\w+)\s*=\s*(?:await\s+import|require)\s*\(\s*{spec}\s*\)", "ns")

    if not locals_bound and not namespaces:
        return NOT_ENGAGED, (f"NO binding of {norm_module(module)!r} exists in executable code "
                             f"(comments and strings create nothing); a bare occurrence of "
                             f"{symbol!r} is not evidence")

    # (3) EXCLUDE THE DECLARATION SITE before asking whether the binding is USED.
    use = list(code)
    for s, e in decl_spans:
        for k in range(s, min(e, len(use))):
            if use[k] != "\n":
                use[k] = " "
    use_text = "".join(use)

    # FAIL CLOSED: computed member access on a namespace bound to the module,
    # including the idiomatic TS cast form `(ns as any)[...]`.
    for ns in namespaces:
        e = re.escape(ns)
        if re.search(rf"\b{e}\s*\[", use_text) or re.search(rf"\(\s*{e}\s+as\s+[^)]*\)\s*\[", use_text):
            return UNDECIDABLE, (f"namespace {ns!r} is bound to {norm_module(module)!r} and reached "
                                 f"by COMPUTED member access; a text analysis cannot decide "
                                 f"whether {symbol!r} is engaged")

    # FAIL CLOSED: a local declaration shadowing the imported name.
    for loc in locals_bound:
        if re.search(rf"\b(?:function|const|let|var|class)\s+{re.escape(loc)}\b", use_text):
            return UNDECIDABLE, (f"{loc!r} is imported from {norm_module(module)!r} AND declared "
                                 f"locally; which binding executes cannot be decided by text")

    for loc in locals_bound:
        if re.search(rf"\b{re.escape(loc)}\b", use_text):
            return ENGAGED, (f"{symbol!r} bound from {norm_module(module)!r} as {loc!r} and "
                             f"REFERENCED outside its declaration")
    for ns in namespaces:
        if re.search(rf"\b{re.escape(ns)}\s*\.\s*{sym}\b", use_text):
            return ENGAGED, f"{ns}.{symbol} member access on a namespace bound to {norm_module(module)!r}"
    return NOT_ENGAGED, (f"{norm_module(module)!r} is bound but {symbol!r} is never referenced "
                         f"outside its own declaration (presence is not use)")


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
            print("Narrow --name/--surface, or raise --max-files deliberately.")
            print("!" * 74)
        return 4
    repos = enumerate_repos(root)
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
        print("ABSENCE-CLAIM CONTROL -- conservative BINDING ANALYSIS, fails closed")
        print("(R-468 §5; rebuilt R-470 §2; repaired R-471 §4. NOT 'syntax-aware'.)")
        print("=" * 74)
        if module:
            print(f"mode    : BINDING -- symbol {symbol!r} bound from module "
                  f"{norm_module(module)!r} and referenced outside its declaration")
            print("          comments and strings create NO bindings; fs == node:fs")
        else:
            print("mode    : TEXT -- may claim ONLY text presence/absence, never a binding verdict")
            for p in (patterns or []):
                print(f"pattern : {p}")
        print(f"control : {control}")
        print(f"surface : {len(files)} files matching {name_glob!r}")
        print(f"repos   : {len(repos)} enumerated under {root}")
        print(f"ELAPSED : {elapsed:.1f}s   (measured, not asserted)")
        if name_glob != "*" and len(files) <= 80:
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
        n_e = sum(1 for v in results.values() if v[0] == ENGAGED)
        n_u = sum(1 for v in results.values() if v[0] == UNDECIDABLE)
        print(f"\n--- RESULT: {n_e} ENGAGED, {n_u} UNDECIDABLE, of {len(files)} files ---")

    ctrl = control.resolve()
    if ctrl not in {f.resolve() for f in files}:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 3: the POSITIVE CONTROL IS NOT IN THE SURFACE.")
            print(f"  control: {ctrl}")
            print("!" * 74)
        return 3

    state, why = results[ctrl]
    if state in (UNSUPPORTED, UNDECIDABLE):
        if verbose:
            print("\n" + "!" * 74)
            print(f"VERDICT UNAVAILABLE -- exit 8 (FAIL CLOSED, {state})")
            print(f"  {why}")
            print("No absence claim may cite this run.")
            print("!" * 74)
        return 8
    if state == NOT_ENGAGED:
        if verbose:
            print("\n" + "!" * 74)
            print("SEARCH INCAPABLE -- exit 2: the control was examined and the capability")
            print("is NOT ENGAGED there, so the search cannot find the thing even where it")
            print("is supposed to be. ANY absence conclusion is INADMISSIBLE.")
            print(f"  {why}")
            print("!" * 74)
        return 2
    if verbose:
        print("\n" + "-" * 74)
        print(f"CONTROL ENGAGED -- {why}")
        print("The search is CAPABLE. An absence over the remainder of the surface")
        print("above is ADMISSIBLE, and must be cited together with that surface.")
        print("-" * 74)
    return 0


# ------------------------------- PERMANENT FIXTURES, codes PRE-REGISTERED in AR-468
FIX = pathlib.Path(__file__).resolve().parent / "absence-fixtures"
SELF_SRC = pathlib.Path(__file__).resolve()
PRODUCER = pathlib.Path(r"C:\Users\tonio\Projects\trading-forge\tf-deep-scan\scripts\atomize-transcript.ts")

FIXTURES = [
    ("comment-only mention", "comment_only.ts", 2, "a comment is not code"),
    ("string-literal-only mention", "string_only.ts", 2, "a string literal is not code"),
    ("same-named LOCAL function, no import", "local_fn.ts", 2, "an unrelated local is not the module's API"),
    ("unrelated dynamic import", "unrelated_dynamic.ts", 2, "R-470 defect (i)"),
    ("bare computed access fs[m]", "computed_access.ts", 8, "R-470 defect (ii): fail closed"),
    ("COMPOSED-1: commented-out import + same-named local + call",
     "composed_comment_import_local_fn.ts", 2,
     "R-471 §1: v3 greened this -- fake provenance from a comment ANDed with fake usage"),
    ("COMPOSED-2: block-comment import + string-literal usage",
     "composed_blockcomment_and_string.ts", 2,
     "the second composed pair R-471 §4 requires; singletons proved nothing about pairs"),
    ("UNUSED import (presence is not use)", "unused_import.ts", 2,
     "R-471 §1: v3's reference check saw the identifier inside its own declaration"),
    ("(fs as any)[computed] -- idiomatic TS cast", "as_any_computed.ts", 8,
     "R-471 §1: bare fs[m] was caught but the cast form was invisible"),
    ("template-interpolated executable call", "template_call.ts", 0,
     "R-471 §1: deleting ${...} with the template text is a FALSE ABSENCE on executing code"),
    ("aliased AND USED import", "aliased_used.ts", 0, "the local binding is the alias, not the symbol"),
    ("node:fs specifier queried as --module fs", "node_prefix.ts", 0,
     "R-471 §4.6: normalisation must be used for MATCHING, not display"),
    ("genuine STATIC named import", "genuine_static.ts", 0, "the passing control"),
    ("genuine DYNAMIC destructured import", "genuine_dynamic.ts", 0, "dynamic reach retained"),
    ("WRONG SURFACE (control outside it)", "__WRONG_SURFACE__", 3, "AR-461's wrong object"),
    ("UNSUPPORTED LANGUAGE (.py control)", "__SELF_PY__", 8,
     "R-471 §2: this path exits BEFORE the comment logic, so it may never again be "
     "cited as evidence that the comment defect is closed"),
    ("REGRESSION: the real producer", "__PRODUCER__", 0,
     "a guard that fails everything is not a repair"),
]


def self_test() -> int:
    print("=" * 74)
    print("PERMANENT FIXTURES -- exit codes PRE-REGISTERED in AR-468 before any run")
    print("=" * 74)
    failures = []
    for label, fname, want, why in FIXTURES:
        if fname == "__WRONG_SURFACE__":
            ctrl, surfaces, glob = FIX / "genuine_static.ts", [FIX / "nonexistent"], "*.ts"
        elif fname == "__SELF_PY__":
            ctrl, surfaces, glob = SELF_SRC, [SELF_SRC.parent], SELF_SRC.name
        elif fname == "__PRODUCER__":
            ctrl, surfaces, glob = PRODUCER, [PRODUCER.parent], PRODUCER.name
        else:
            ctrl, surfaces, glob = FIX / fname, [FIX], fname
        got = run_check(ctrl, surfaces, glob, DEFAULT_ROOT, module="fs",
                        symbol="writeFileSync", verbose=False)
        ok = got == want
        print(f"\n[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"       PRE-REGISTERED {want}, got {got}")
        print(f"       why: {why}")
        if not ok:
            failures.append((label, want, got))
    print("\n" + "=" * 74)
    if failures:
        print(f"SELF-TEST FAILED -- {len(failures)} fixture(s) missed their pre-registered code:")
        for label, want, got in failures:
            print(f"  {label}: pre-registered {want}, got {got}")
        print("=" * 74)
        return 5
    eng = sum(1 for f in FIXTURES if f[2] == 0)
    print(f"SELF-TEST PASSED -- {len(FIXTURES)} fixtures at their PRE-REGISTERED codes.")
    print(f"They DISCRIMINATE across four outcomes: {eng} ENGAGED · "
          f"{sum(1 for f in FIXTURES if f[2] == 2)} not-engaged · "
          f"{sum(1 for f in FIXTURES if f[2] == 3)} wrong-surface · "
          f"{sum(1 for f in FIXTURES if f[2] == 8)} fail-closed.")
    print("TWO of them are COMPOSED pairs of independently-passing negatives --")
    print("the shape that twice certified a class this guard had not closed.")
    print("=" * 74)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Prove a search is CAPABLE before believing its absence.")
    ap.add_argument("--pattern", action="append", default=[])
    ap.add_argument("--module")
    ap.add_argument("--symbol")
    ap.add_argument("--control")
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--name", default="*")
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
        print("USAGE ERROR: give --module/--symbol (binding) or --pattern (text)", file=sys.stderr)
        return 4
    if a.module and a.pattern:
        print("USAGE ERROR: modes are separate -- a text pattern may not back a "
              "binding verdict (R-470 §2.1)", file=sys.stderr)
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
