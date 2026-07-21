"""REPO-WIDE NEWLINE CENSUS: every text-mode artifact writer, and whether its BYTES are
platform-dependent.

★ THE DEFECT, AND WHY THE INSTANCE FIX IS NOT THE REMEDY.
`docs/replay-results/classifier-fix/ladder_recompute.py` writes its artifact with

    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2)

-- no `newline=`. Python TEXT MODE translates every `\\n` the writer emits into `os.linesep`:
CRLF on Windows, LF on Linux. The artifact therefore has DIFFERENT BYTES and a DIFFERENT
sha256 depending on which machine ran the generator, and any hash pin over it fails across
platforms. That artifact was certified "reproducible" without anyone reading its write call.

Fixing that one line would leave every sibling writer emitting platform bytes. REMEDIES ARE
SIZED BY CENSUS, NOT BY INSTANCE -- so this enumerates the whole class and reports the
DENOMINATOR (writers examined), not only the hits.

★ THE PLATFORM-DEPENDENCE VERDICT IS COMPUTED, NOT ASSUMED.
A text-mode write is only platform-dependent if the bytes it emits CONTAIN a newline:

  * `json.dump(..., indent=N)` emits newlines between elements  -> PLATFORM_DEPENDENT
  * `json.dump(...)` with NO indent emits ONE line, and JSON escapes any newline inside a
    string as the two characters `\\` `n`, which text mode does not touch -> INVARIANT
  * binary mode ("wb") performs no translation at all                    -> EXEMPT
  * `newline="\\n"` or `newline=""` disables translation                  -> PINNED

So an unpinned writer is not automatically a defect, and this census does not report it as
one. Each unpinned site carries a computed declaration of whether its bytes actually move.

SCOPE BOUNDARY (stated, because a census is only as wide as its scope):
  * IN  -- every `.py` file in the repo outside vendored/build directories, parsed by AST.
  * OUT -- TypeScript/JavaScript writers. Node's `fs.write*` performs NO newline translation;
           it writes the buffer it is given. The platform-dependence mechanism this census
           measures does not exist there. This is an exclusion BY MECHANISM, not by
           convenience, and it is published rather than silent.
  * OUT -- whether the written path is git-tracked. That is not statically decidable from a
           call site (paths are computed). Every site is reported with its directory so a
           reader can see which land in artifact directories.
"""
from __future__ import annotations

import ast
import json
import os
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "newline-writer-census.json"

SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".mypy_cache",
             ".pytest_cache", "dist", "build", ".next", ".ruff_cache", "site-packages"}

WRITE_MODES = ("w", "a", "x", "+")


def refuse_unless(condition: bool, message: str) -> None:
    """A GATE THAT `python -O` CANNOT REMOVE, exiting 2 -- a verdict, not a crash.

    `assert` is stripped entirely by -O, so a generator gated on asserts publishes an
    artifact byte-indistinguishable from a fully-guarded run with every gate absent.
    """
    if not condition:
        sys.stderr.write(f"REFUSED: {message}\n")
        raise SystemExit(2)


def _kw(call: ast.Call, name: str) -> ast.expr | None:
    for k in call.keywords:
        if k.arg == name:
            return k.value
    return None


def _const(node: ast.expr | None):
    if isinstance(node, ast.Constant):
        return node.value
    return None


def _mode_of_open(call: ast.Call) -> str | None:
    """Positional arg 1, or the `mode=` keyword. Non-literal modes report as UNRESOLVED."""
    if len(call.args) >= 2:
        v = _const(call.args[1])
        return v if isinstance(v, str) else "<UNRESOLVED>"
    kw = _kw(call, "mode")
    if kw is not None:
        v = _const(kw)
        return v if isinstance(v, str) else "<UNRESOLVED>"
    return "r"  # open() default


def _newline_pin(call: ast.Call) -> tuple[bool, str | None]:
    kw = _kw(call, "newline")
    if kw is None:
        return False, None
    return True, repr(_const(kw)) if isinstance(kw, ast.Constant) else ast.unparse(kw)


def _json_dump_indent(call: ast.Call) -> tuple[bool, str]:
    """(emits_newlines, evidence). json.dump/json.dumps only emit newlines when indented."""
    ind = _kw(call, "indent")
    if ind is None and len(call.args) >= 3:
        ind = call.args[2]
    if ind is None:
        return False, "no indent= -> single line -> no newline in output"
    v = _const(ind)
    if v is None and isinstance(ind, ast.Constant):
        return False, "indent=None -> single line -> no newline in output"
    return True, f"indent={ast.unparse(ind)} -> newlines between elements"


def _expr_emits_newlines(node: ast.expr | None) -> tuple[bool, str]:
    """Does the VALUE of this expression contain a newline character?

    ★ THE BUCKET THAT HID A LIVE MOVER. The first version of this census computed
    `emits_newlines` for `json.dump` only, and classified every `Path.write_text` as
    UNPINNED_TEXT -- "bytes move only if a newline is written through it", declared but not
    decided. `population_a_flip_step_remeasure.py:453` is
        OUT_PATH.write_text(json.dumps(out, indent=1, sort_keys=False) + "\\n", ...)
    which plainly emits newlines. It was NOT flagged, and the file is CRLF on disk RIGHT NOW
    (105 CR) against an LF blob at HEAD -- so the defect was live, in the remedy set's blind
    spot, while the census reported the remedy set clean. It surfaced only because a DIFFERENT
    instrument (that artifact's own APPEND_ONLY guard) refused to publish and named
    `crlf_only: True`, and because `git status` reported the file CLEAN throughout.

    AN UNDECIDED BUCKET IS WHERE THE MOVER LIVES. So the question is now answered for every
    text writer instead of deferred for one shape of it.
    """
    if node is None:
        return False, "no argument"
    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and "\n" in n.value:
            return True, "a string literal in the written value contains a newline"
        if isinstance(n, ast.JoinedStr):
            for v in n.values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str) and "\n" in v.value:
                    return True, "an f-string segment contains a newline"
        if isinstance(n, ast.Call):
            f = n.func
            nm = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
            if nm == "dumps" and isinstance(f, ast.Attribute) and \
                    isinstance(f.value, ast.Name) and f.value.id in ("json", "yaml"):
                emits, why = _json_dump_indent(n)
                if emits:
                    return True, f"{f.value.id}.dumps -> {why}"
            if nm in ("join", "dump_all", "safe_dump", "to_csv", "to_json", "to_markdown"):
                return True, f"`{nm}(...)` produces multi-line text"
    return False, "no newline found in the written value (single-line write)"


#: Callables that return a TEXT-MODE file object whose newline behaviour is governed by the
#: same `newline=` keyword. `os.fdopen` wraps a raw descriptor and translates exactly like
#: `open` -- omitting it hid two real write sites behind an unrelated read handle (below).
OPEN_LIKE = {"open", "fdopen"}


def _is_open_call(node: ast.expr | None) -> ast.Call | None:
    if isinstance(node, ast.Call):
        f = node.func
        if (isinstance(f, ast.Name) and f.id in OPEN_LIKE) or \
           (isinstance(f, ast.Attribute) and f.attr in OPEN_LIKE):
            return node
    return None


def _fh_is_inline_open(node: ast.expr) -> ast.Call | None:
    return _is_open_call(node)


def _scopes(tree: ast.AST) -> list[ast.AST]:
    """Every binding scope: the module plus each function/lambda body."""
    out: list[ast.AST] = [tree]
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append(n)
    return out


def _handle_bindings(scope: ast.AST) -> dict[str, list[ast.Call]]:
    """Map handle NAME -> EVERY open()-like call that binds it, WITHIN ONE SCOPE.

    ★ WITHOUT THIS, `with open(p, "w") as fh: json.dump(o, fh, indent=2)` -- the most common
    correct-looking form in this repo -- would land in a DEPENDS_ON_HANDLE bucket and the
    census would hide its own answer behind a shrug.

    ★★ AND WITHOUT THE *SCOPE* RESTRICTION, IT ANSWERS WRONGLY. The first version of this
    resolver searched the whole MODULE. In `src/engine/battery/passage_ledger.py` and
    `trial_counter.py` it bound the writer's `fh` to a READ handle opened in a DIFFERENT
    FUNCTION (`with open(self.path, encoding="utf-8") as fh`) and classified the write from
    that unrelated handle's mode. Both files were reported PLATFORM_DEPENDENT -- which they
    genuinely are -- but for a reason that was not their own: A RIGHT ANSWER OUT OF A BROKEN
    INSTRUMENT. It surfaced only because an independent re-derivation refused to locate the
    site, i.e. because two paths were required to agree.

    A name bound MORE THAN ONCE in a scope returns ALL its bindings; the caller resolves by
    UNANIMITY (every binding classifying alike) and otherwise publishes the disagreement.
    That is not guessing: `with open(a,"w") as fh: ...` repeated for several artifacts is a
    real and common shape here, and dropping it parked ten live movers in a shrug bucket.
    """
    seen: dict[str, list[ast.Call]] = {}
    inner = {id(n) for s in _scopes(scope) if s is not scope for n in ast.walk(s)}
    for n in ast.walk(scope):
        if id(n) in inner:
            continue  # belongs to a nested function; that scope resolves it
        if isinstance(n, ast.withitem):
            call = _is_open_call(n.context_expr)
            if call is not None and isinstance(n.optional_vars, ast.Name):
                seen.setdefault(n.optional_vars.id, []).append(call)
        elif isinstance(n, ast.Assign):
            call = _is_open_call(n.value)
            if call is not None:
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        seen.setdefault(t.id, []).append(call)
    return seen


def _scan(path: Path, rel: str) -> list[dict]:
    try:
        src = path.read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(src)
    except SyntaxError:
        return [{"file": rel, "line": 0, "writer_kind": "PARSE_FAIL",
                 "verdict": "UNRESOLVED", "why": "file did not parse as Python"}]
    sites: list[dict] = []
    # Per-scope handle bindings, innermost first. A json.dump's handle is resolved in the
    # scope that CONTAINS it, then outward -- never from an unrelated sibling function.
    scope_bindings = [(s, _handle_bindings(s)) for s in _scopes(tree)]
    contains: dict[int, list[dict[str, ast.Call]]] = {}
    for s, b in scope_bindings:
        for m in ast.walk(s):
            contains.setdefault(id(m), []).append(b)

    def resolve(name: str, node: ast.AST) -> list[ast.Call]:
        for b in reversed(contains.get(id(node), [])):
            if name in b:
                return b[name]
        return []

    for n in ast.walk(tree):
        if not isinstance(n, ast.Call):
            continue
        f = n.func
        name = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)

        # ---- open(..., "w") / os.fdopen(fd, "w") in TEXT mode ----------------------------
        if name in OPEN_LIKE:
            mode = _mode_of_open(n)
            if mode == "<UNRESOLVED>":
                sites.append({"file": rel, "line": n.lineno, "writer_kind": name,
                              "mode": mode, "verdict": "UNRESOLVED",
                              "why": "mode is not a literal; cannot decide statically",
                              "call": ast.unparse(n)[:160]})
                continue
            if not any(c in mode for c in WRITE_MODES):
                continue  # a reader, not a writer
            pinned, pin = _newline_pin(n)
            if "b" in mode:
                verdict, why = "EXEMPT_BINARY", f'mode="{mode}" -> no newline translation'
            elif pinned:
                verdict, why = "PINNED", f"newline={pin}"
            else:
                verdict, why = ("UNPINNED_TEXT",
                                f'mode="{mode}" with no newline= -> every \\n emitted through '
                                "this handle becomes os.linesep")
            sites.append({"file": rel, "line": n.lineno, "writer_kind": name, "mode": mode,
                          "newline_pin": pin, "verdict": verdict, "why": why,
                          "call": ast.unparse(n)[:160]})

        # ---- Path.write_text -------------------------------------------------------------
        elif name == "write_text":
            pinned, pin = _newline_pin(n)
            emits, evidence = _expr_emits_newlines(n.args[0] if n.args else None)
            if pinned:
                verdict, why = "PINNED", f"newline={pin}"
            elif emits:
                verdict = "PLATFORM_DEPENDENT_BYTES"
                why = ("Path.write_text defaults newline=None -> universal-newline translation "
                       f"to os.linesep, AND the written value emits newlines ({evidence})")
            else:
                verdict = "INVARIANT_NO_NEWLINE_EMITTED"
                why = f"unpinned, but {evidence}"
            sites.append({"file": rel, "line": n.lineno, "writer_kind": "Path.write_text",
                          "newline_pin": pin, "emits_newlines": emits,
                          "emits_newlines_evidence": evidence,
                          "verdict": verdict, "why": why,
                          "call": ast.unparse(n)[:160]})

        # ---- json.dump into a handle -----------------------------------------------------
        elif name == "dump" and isinstance(f, ast.Attribute) and \
                isinstance(f.value, ast.Name) and f.value.id == "json":
            emits, evidence = _json_dump_indent(n)
            arg1 = n.args[1] if len(n.args) >= 2 else None
            one = _fh_is_inline_open(arg1) if arg1 is not None else None
            if one is not None:
                cands, handle = [one], "inline open()"
            elif isinstance(arg1, ast.Name):
                # ★ ONLY TEXT-MODE WRITE HANDLES ARE CANDIDATES. `json.dump` cannot write to a
                # reader, and raises TypeError on a binary handle -- so a same-named `open(p)`
                # or `open(p,"wb")` elsewhere in the scope is NOT a possible target for THIS
                # call and must not enter the unanimity vote. The first version of this vote
                # omitted the filter and "unanimously" classified READ handles as movers; a
                # remediation tool then refused every one of them for not being a write mode.
                # THE REFUSAL WAS RIGHT AND THE CENSUS WAS WRONG.
                allc = resolve(arg1.id, n)
                cands = [c for c in allc
                         if any(ch in (_mode_of_open(c) or "") for ch in WRITE_MODES)
                         and "b" not in (_mode_of_open(c) or "")]
                handle = (f"named handle `{arg1.id}`, {len(cands)} text-write binding(s) at "
                          f"line(s) {sorted(c.lineno for c in cands)} "
                          f"(of {len(allc)} total binding(s))" if cands
                          else f"named handle `{arg1.id}` -- no text-mode write binding in scope")
            else:
                cands, handle = [], f"handle is not a name: {ast.unparse(arg1) if arg1 else 'n/a'}"

            # `emits` is bound as a DEFAULT rather than captured: this closure is defined
            # inside the walk loop, and a late-binding capture would classify every site with
            # whatever the LAST iteration happened to leave behind (ruff B023).
            def _classify(c: ast.Call, emits: bool = emits) -> str:
                _, pn = _newline_pin(c)
                md = _mode_of_open(c) or ""
                if "b" in md:
                    return "EXEMPT_BINARY"
                if pn is not None:
                    return "PINNED"
                return "INVARIANT_NO_NEWLINE_EMITTED" if not emits else "PLATFORM_DEPENDENT_BYTES"

            pin = None
            verdicts = sorted({_classify(c) for c in cands})
            if len(verdicts) == 1:
                # UNANIMOUS across every binding of this handle -- resolved, not guessed.
                verdict = verdicts[0]
                _, pin = _newline_pin(cands[0])
                if len(cands) > 1:
                    handle += f" -- UNANIMOUS verdict {verdict} across all {len(cands)}"
            elif len(verdicts) > 1:
                verdict = "DEPENDS_ON_HANDLE"
                handle += f" -- BINDINGS DISAGREE {verdicts}; not resolved by guessing"
            else:
                verdict = ("INVARIANT_NO_NEWLINE_EMITTED" if not emits
                           else "DEPENDS_ON_HANDLE")
            sites.append({"file": rel, "line": n.lineno, "writer_kind": "json.dump",
                          "handle": handle, "newline_pin": pin,
                          # Every open()-like call whose mode/newline decides this site's bytes.
                          # Published so a remediation tool can VERIFY this target structurally
                          # instead of running a second copy of the same resolution logic.
                          "resolved_open_lineno": sorted(c.lineno for c in cands) or None,
                          "resolved_open_end": ([[c.end_lineno, c.end_col_offset] for c in cands]
                                                if len(verdicts) == 1 and cands else None),
                          "emits_newlines": emits, "emits_newlines_evidence": evidence,
                          "verdict": verdict, "call": ast.unparse(n)[:160]})

        # ---- csv writers (require newline="" on the underlying handle) -------------------
        elif name in ("writer", "DictWriter") and isinstance(f, ast.Attribute) and \
                isinstance(f.value, ast.Name) and f.value.id == "csv":
            sites.append({"file": rel, "line": n.lineno, "writer_kind": f"csv.{name}",
                          "verdict": "CSV_HANDLE_REVIEW",
                          "why": 'csv requires newline="" on the file handle; the handle is '
                                 "classified at its own open() site",
                          "call": ast.unparse(n)[:160]})
    return sites


def main() -> None:
    py_files = []
    for p in sorted(REPO_ROOT.rglob("*.py")):
        if any(s in p.parts for s in SKIP_DIRS):
            continue
        py_files.append(p)

    refuse_unless(len(py_files) > 100,
                  f"only {len(py_files)} python files discovered under {REPO_ROOT}; the "
                  "walker is broken and every count below would be a false denominator")

    sites: list[dict] = []
    for p in py_files:
        sites.extend(_scan(p, p.relative_to(REPO_ROOT).as_posix()))

    refuse_unless(bool(sites),
                  "zero write sites discovered; the detector matched nothing and a census "
                  "of an empty set is a false green")

    by_verdict = Counter(s["verdict"] for s in sites)
    by_kind = Counter(s["writer_kind"] for s in sites)

    # Sites whose BYTES actually move between platforms -- the remedy set.
    movers = [s for s in sites if s["verdict"] == "PLATFORM_DEPENDENT_BYTES"]
    # Unpinned text handles: not defects on their own, but every one is a handle through
    # which a newline-emitting writer WOULD move bytes.
    unpinned = [s for s in sites if s["verdict"] == "UNPINNED_TEXT"]
    unresolved = [s for s in sites if s["verdict"] in ("UNRESOLVED", "DEPENDS_ON_HANDLE")]

    out = {
        "artifact": "newline-writer-census",
        "generator": "docs/replay-results/h1-battery/newline_writer_census.py",
        "scope_line": (
            f"corpus = every .py file in the repo outside {sorted(SKIP_DIRS)} "
            f"(n={len(py_files)} files parsed) · detector = AST · TypeScript/JS EXCLUDED BY "
            "MECHANISM (Node fs.write* performs no newline translation) · git-tracked-ness of "
            "the written path is NOT statically decidable and is not claimed"),
        "denominator_python_files_examined": len(py_files),
        "denominator_write_sites_examined": len(sites),
        "verdict_counts": dict(by_verdict),
        "writer_kind_counts": dict(by_kind),
        "HOW_TO_READ_THE_VERDICTS": {
            "PLATFORM_DEPENDENT_BYTES": (
                "text-mode handle, no newline=, and the writer DOES emit newlines. The bytes "
                "and the sha256 differ between Windows and Linux. THIS IS THE REMEDY SET."),
            "INVARIANT_NO_NEWLINE_EMITTED": (
                "text-mode handle with no newline=, but the writer emits a single line, so "
                "translation has nothing to translate. COMPUTED, not assumed: json.dump "
                "without indent= emits one line and escapes in-string newlines as \\\\n."),
            "UNPINNED_TEXT": (
                "a text write handle with no newline=. Whether its bytes move depends on what "
                "is written through it; reported so the class is visible, not counted as a hit."),
            "PINNED": "newline= is supplied; translation is disabled. Correct by construction.",
            "EXEMPT_BINARY": "binary mode performs no translation at all.",
            "DEPENDS_ON_HANDLE": (
                "json.dump with indent into a NAMED handle; the handle is classified at its "
                "own open() site rather than guessed here."),
            "UNRESOLVED": "mode or target not a literal; NOT silently counted as safe.",
        },
        "platform_dependent_sites": sorted(movers, key=lambda s: (s["file"], s["line"])),
        "n_platform_dependent": len(movers),
        "unpinned_text_handles": sorted(unpinned, key=lambda s: (s["file"], s["line"])),
        "n_unpinned_text_handles": len(unpinned),
        "unresolved_sites": sorted(unresolved, key=lambda s: (s["file"], s["line"])),
        "n_unresolved": len(unresolved),
        "closure_identity": (
            f"sum(verdict_counts)={sum(by_verdict.values())} == "
            f"write_sites_examined={len(sites)}"),
        "runtime_platform": {"os_name": os.name, "linesep_repr": repr(os.linesep)},
        "all_sites": sorted(sites, key=lambda s: (s["file"], s["line"])),
    }
    refuse_unless(sum(by_verdict.values()) == len(sites),
                  "verdict counts do not close against the site denominator")

    # ★ THIS GENERATOR OBEYS ITS OWN RULE. newline="\n" is pinned here, so this census's
    # own bytes are identical on Windows and Linux. A newline census that emitted platform
    # bytes would be the defect wearing the cure's name.
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(f"wrote {OUT}")
    print(f"  python files examined      : {len(py_files)}")
    print(f"  write sites examined       : {len(sites)}")
    for k, v in sorted(by_verdict.items(), key=lambda kv: -kv[1]):
        print(f"    {k:<32}: {v}")


if __name__ == "__main__":
    main()
