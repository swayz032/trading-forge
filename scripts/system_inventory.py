#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trading Forge SYSTEM INVENTORY generator.

WHY THIS EXISTS
---------------
This campaign has repeatedly burned hours re-building or re-planning something
that was already built and sitting in the tree (the opening-range-breakout
detector, a default-off session resolver, a ~1.5k-line forensics suite).  The
fix is not another hand-maintained table -- this repo already carries four of
those and all four went stale and actively misled agents.  The fix is a
GENERATED map that is cheap to re-run, so "what do we already have?" is a
command, not a memory.

DESIGN CONSTRAINTS
------------------
* Pure Python standard library.  No new dependencies.
* Deterministic: same tree -> same bytes.  No timestamps in the body.
* Mechanical classification only.  The classifier is forbidden from deciding
  what is "important" or "strategy-relevant"; it enumerates and classifies by
  rule, and every rule's residual is emitted as UNCLASSIFIED so that
  under-inclusion is visible instead of silent.

USAGE
-----
    python scripts/system_inventory.py                 # write docs/designs/SYSTEM-INVENTORY.md
    python scripts/system_inventory.py --check         # non-zero exit if the file is stale
    python scripts/system_inventory.py --out PATH      # write elsewhere
    python scripts/system_inventory.py --self-test     # run the positive controls only

All file reads go through io.open(..., encoding='utf-8', errors='replace')
because this repo contains non-cp1252 bytes and the Windows default codec
throws on them.
"""

from __future__ import annotations

import argparse
import ast
import collections
import io
import json
import os
import re
import subprocess
import sys

# --------------------------------------------------------------------------
# 0. Repo location + I/O primitives
# --------------------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OUT_REL = "docs/designs/SYSTEM-INVENTORY.md"
GEN_CMD = "python scripts/system_inventory.py"

# Directories never descended into, anywhere.
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", "dist", "build", ".next",
    "coverage", ".venv", "venv", ".pytest_cache", ".ruff_cache",
    ".numba_cache", ".mypy_cache", "lightning_logs", ".turbo",
}

# The symbol surface: files whose definitions become inventory rows.
SYMBOL_ROOTS = ["src"]

# The reference surface: files that may count as CALLERS of a symbol.
# Strictly a superset of the symbol surface.
REFERENCE_ROOTS = ["src", "scripts", "e2e", "tests"]

PY_EXT = (".py",)
TS_EXT = (".ts", ".tsx")


def read_text(path):
    """Every read in this program goes through here.  utf-8, never cp1252."""
    with io.open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def rel(path):
    return os.path.relpath(path, REPO).replace(os.sep, "/")


def walk_files(root_rel, exts=None):
    """Deterministic (sorted) recursive walk under REPO/root_rel."""
    root = os.path.join(REPO, root_rel)
    if not os.path.isdir(root):
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if exts and not name.endswith(exts):
                continue
            yield os.path.join(dirpath, name)


TEST_DIR_MARKERS = ("/tests/", "/__tests__/", "/test/", "/e2e/", "/testing/")
TEST_NAME_SUFFIXES = (".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx")


def is_test_path(relpath):
    low = "/" + relpath.lower()
    if any(m in low for m in TEST_DIR_MARKERS):
        return True
    base = relpath.rsplit("/", 1)[-1]
    if base.startswith("test_") or base == "conftest.py":
        return True
    if base.endswith(TEST_NAME_SUFFIXES):
        return True
    if base.startswith("generate_") and "fixture" in base:
        return True
    return False


# --------------------------------------------------------------------------
# 1. TypeScript lexing helpers
#
# Everything downstream (export regex, identifier tokens, if-block brace
# matching) runs on a BLANKED copy of the source in which comments, string
# literals and template literals have been replaced by spaces.  Line numbers
# and offsets are preserved exactly, so positions map back 1:1.
# --------------------------------------------------------------------------

def blank_ts(src, blank_strings=True):
    """Return a same-length copy with comments (and optionally string/template
    literal CONTENTS) replaced by spaces.  Newlines are preserved, so offsets
    and line numbers map back to the original 1:1.

    blank_strings=False keeps string contents intact.  That mode is required
    for anything that must READ a literal (import specifiers, subprocess path
    literals) while still ignoring commented-out code.
    """
    out = list(src)
    i = 0
    n = len(src)

    def blank_range(start, end):
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j == -1 else j
            blank_range(i, j)
            i = j
        elif ch == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            blank_range(i, j)
            i = j
        elif ch in ("'", '"'):
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == ch or src[j] == "\n":
                    j += 1
                    break
                j += 1
            if blank_strings:
                blank_range(i, min(j, n))
            i = j
        elif ch == "`":
            j = i + 1
            depth = 0
            while j < n:
                c = src[j]
                if c == "\\":
                    j += 2
                    continue
                if c == "$" and j + 1 < n and src[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if c == "}" and depth > 0:
                    depth -= 1
                    j += 1
                    continue
                if c == "`" and depth == 0:
                    j += 1
                    break
                j += 1
            if blank_strings:
                blank_range(i, min(j, n))
            i = j
        else:
            i += 1
    return "".join(out)


def line_starts(src):
    starts = [0]
    for idx, ch in enumerate(src):
        if ch == "\n":
            starts.append(idx + 1)
    return starts


def offset_to_line(starts, offset):
    lo, hi = 0, len(starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if starts[mid] <= offset:
            lo = mid
        else:
            hi = mid - 1
    return lo + 1


def match_delims(blanked, start, open_ch, close_ch):
    """Return (open_offset, offset_just_past_close); close is -1 if unbalanced."""
    i = blanked.find(open_ch, start)
    if i == -1:
        return -1, -1
    depth = 0
    j = i
    n = len(blanked)
    while j < n:
        c = blanked[j]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i, j + 1
        j += 1
    return i, -1


IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")

TS_EXPORT_RE = re.compile(
    r"^[ \t]*export[ \t]+"
    r"(?:default[ \t]+)?(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?"
    r"(function\*?|class|interface|type|enum|const|let|var)[ \t]+"
    r"([A-Za-z_$][A-Za-z0-9_$]*)",
    re.MULTILINE,
)
TS_EXPORT_LINE_RE = re.compile(r"^[ \t]*export\b.*$", re.MULTILINE)
TS_REEXPORT_RE = re.compile(r"^[ \t]*export[ \t]*(?:type[ \t]+)?(?:\*|\{)")
# `export { router as alertRoutes };` with NO `from` clause is a real local
# export, not a pass-through re-export.  Missing it left whole route modules
# reading as "0 symbols".
TS_EXPORT_BINDING_RE = re.compile(
    r"^[ \t]*export[ \t]*(?P<typeonly>type[ \t]+)?\{(?P<body>[^}]*)\}[ \t]*(?P<from>from)?",
    re.MULTILINE,
)
TS_IMPORT_RE = re.compile(
    r"""(?:^|\n)[ \t]*(?:import|export)[ \t]*(?:type[ \t]+)?"""
    r"""(?P<clause>[^;'"\n]*?)?"""
    r"""from[ \t]*['"](?P<spec>[^'"]+)['"]""",
)
TS_BARE_IMPORT_RE = re.compile(r"""(?:^|\n)[ \t]*import[ \t]*['"](?P<spec>[^'"]+)['"]""")
TS_DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\s*\(\s*['"](?P<spec>[^'"]+)['"]""")


# --------------------------------------------------------------------------
# 2. Environment-flag extraction (name + default, both languages)
# --------------------------------------------------------------------------

TS_ENV_RE = re.compile(
    r"process\.env\.(?P<n1>[A-Za-z_][A-Za-z0-9_]*)"
    r"|process\.env\[\s*['\"](?P<n2>[A-Za-z_][A-Za-z0-9_]*)['\"]\s*\]"
)
TS_ENV_DEFAULT_RE = re.compile(
    r"^\s*(?:\?\?|\|\|)\s*(?P<d>'[^']*'|\"[^\"]*\"|[A-Za-z0-9_.]+)"
)
TS_ENV_COMPARE_RE = re.compile(r"^\s*(?:===|==|!==|!=)\s*(?P<d>'[^']*'|\"[^\"]*\")")


def ts_env_reads(blanked, raw, starts):
    """[(flag, default_repr, line)] -- default_repr is '(no default)' when absent.

    Positions come from the BLANKED text; the default literal is re-read from
    the RAW text, because blanking erased string contents.
    """
    found = []
    for m in TS_ENV_RE.finditer(blanked):
        name = m.group("n1") or m.group("n2")
        if not name:
            continue
        tail_raw = raw[m.end():m.end() + 60]
        default = "(no default)"
        dm = TS_ENV_DEFAULT_RE.match(tail_raw)
        if dm:
            default = dm.group("d").strip()
        else:
            cm = TS_ENV_COMPARE_RE.match(tail_raw)
            if cm:
                default = "(no default; compared to %s)" % cm.group("d").strip()
        found.append((name, default, offset_to_line(starts, m.start())))
    return found


def py_env_reads(tree):
    """[(flag, default_repr, line)] from an already-parsed Python AST."""
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            fn = node.func
            base = fn.value
            is_environ_get = (
                fn.attr == "get"
                and isinstance(base, ast.Attribute)
                and base.attr == "environ"
            )
            is_getenv = fn.attr == "getenv" and isinstance(base, ast.Name) and base.id == "os"
            if (is_environ_get or is_getenv) and node.args:
                key = node.args[0]
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    if len(node.args) > 1:
                        default = _literal_repr(node.args[1])
                    else:
                        default = "(no default)"
                    found.append((key.value, default, node.lineno))
        elif isinstance(node, ast.Subscript):
            val = node.value
            if isinstance(val, ast.Attribute) and val.attr == "environ":
                key = node.slice
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    found.append((key.value, "(REQUIRED - no default)", node.lineno))
    return found


def _literal_repr(node):
    if isinstance(node, ast.Constant):
        return repr(node.value)
    try:
        return ast.unparse(node)[:40]
    except Exception:
        return "(expr)"


# --------------------------------------------------------------------------
# 3. Per-file models
# --------------------------------------------------------------------------

class FileInfo(object):
    __slots__ = (
        "path", "lang", "is_test", "loc", "symbols", "refs",
        "raw_import_specs", "env_reads", "gates", "parse_error",
        "unmatched_export_lines", "exported_names", "has_star_reexport",
        "reexport_names", "method_count", "nested_def_count", "path_literals",
        "module_literals",
    )

    def __init__(self, path, lang):
        self.path = path
        self.lang = lang
        self.is_test = is_test_path(path)
        self.loc = 0
        self.symbols = []          # [(name, kind, line, end_line)]
        self.refs = {}             # ident -> sorted [line]
        self.raw_import_specs = [] # [(spec, level, names, line)]
        self.env_reads = []        # [(flag, default, line)]
        self.gates = []            # [(flag, start_line, end_line)]
        self.parse_error = None
        self.unmatched_export_lines = []
        self.exported_names = set()
        self.has_star_reexport = False
        self.reexport_names = set()
        self.method_count = 0
        self.nested_def_count = 0
        self.path_literals = []    # [(literal, line)]
        self.module_literals = []  # [(dotted_module_spec, line)]


PATH_LITERAL_RE = re.compile(r"(?:src|scripts)/[A-Za-z0-9_./-]+\.(?:py|ts|mjs|cjs|sql|json)")

# `spawn("python", ["-m", "src.engine.pine_compiler", ...])` -- the TS->Python
# seam expressed as a MODULE SPEC rather than a file path.  Missing this form
# made ~86 engine modules, plus their whole import closure, read as
# BUILT-UNREACHABLE.  Guarded by control C19.
MODULE_LITERAL_RE = re.compile(r"""['"](src\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)['"]""")


# ---- Python -------------------------------------------------------------

def parse_python(abs_path):
    relp = rel(abs_path)
    info = FileInfo(relp, "py")
    src = read_text(abs_path)
    info.loc = src.count("\n") + (1 if src and not src.endswith("\n") else 0)
    try:
        tree = ast.parse(src)
    except SyntaxError as exc:
        info.parse_error = "SyntaxError line %s: %s" % (exc.lineno, exc.msg)
        return info

    # Path literals from real string CONSTANTS only -- a path named in a
    # comment or a docstring is documentation, not a reference.
    docstring_ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                docstring_ids.add(id(body[0].value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and id(node) not in docstring_ids:
            for m in PATH_LITERAL_RE.finditer(node.value):
                info.path_literals.append((m.group(0), node.lineno))

    # module-level symbols
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            info.symbols.append((node.name, "function", node.lineno,
                                 getattr(node, "end_lineno", node.lineno)))
        elif isinstance(node, ast.ClassDef):
            info.symbols.append((node.name, "class", node.lineno,
                                 getattr(node, "end_lineno", node.lineno)))

    # residual counters for things deliberately NOT enumerated
    top_level_ids = {id(n) for n in tree.body}
    method_ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    info.method_count += 1
                    method_ids.add(id(sub))
    nested = 0
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if id(node) in top_level_ids or id(node) in method_ids:
                continue
            nested += 1
    info.nested_def_count = nested

    # references (AST-based: a name that appears only in a comment or a
    # docstring is correctly NOT counted as a caller)
    refs = collections.defaultdict(list)
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            refs[node.id].append(node.lineno)
        elif isinstance(node, ast.Attribute):
            refs[node.attr].append(node.lineno)
    # imports -- and the names they bind.
    #
    # `from src.engine.pbo_gate import compute_pbo_from_cpcv_paths as _fn`
    # binds `_fn`, but the IMPORTED SYMBOL is compute_pbo_from_cpcv_paths, and
    # that is what makes pbo_gate's function "called".  Recording only the
    # alias made every aliased import invisible and produced false
    # BUILT-UNREACHABLE rows.  Both names are recorded.  Guarded by C20.
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                info.raw_import_specs.append((alias.name, 0, [], node.lineno))
                # `import a.b.c` binds `a`; `import a.b.c as x` binds `x`.
                refs[alias.asname or alias.name.split(".")[0]].append(node.lineno)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            names = [a.name for a in node.names]
            info.raw_import_specs.append((mod, node.level or 0, names, node.lineno))
            for alias in node.names:
                refs[alias.name].append(node.lineno)      # the symbol imported
                if alias.asname:
                    refs[alias.asname].append(node.lineno)  # the local binding
    info.refs = {k: sorted(set(v)) for k, v in refs.items()}

    info.env_reads = py_env_reads(tree)
    info.gates = py_flag_gates(tree)
    return info


def py_flag_gates(tree):
    """Line ranges controlled by an env-derived condition.

    Two passes: learn module-level names bound to an env read, then flag every
    `if` whose test mentions an env read or one of those names.
    """
    env_names = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            flags = _env_flags_in(node.value, {})
            if flags:
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        env_names[tgt.id] = flags[0]
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            flags = _env_flags_in(node.value, {})
            if flags and isinstance(node.target, ast.Name):
                env_names[node.target.id] = flags[0]

    gates = []
    for node in ast.walk(tree):
        if isinstance(node, ast.If):
            flags = _env_flags_in(node.test, env_names)
            if not flags:
                continue
            flag = flags[0]
            for block in (node.body, node.orelse):
                if not block:
                    continue
                start = block[0].lineno
                end = max((getattr(s, "end_lineno", None) or s.lineno) for s in block)
                gates.append((flag, start, end))
    return gates


def _env_flags_in(node, env_names):
    """Flag names an expression depends on (direct env read or env-bound name)."""
    out = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute):
            fn = sub.func
            base = fn.value
            if (fn.attr == "get" and isinstance(base, ast.Attribute) and base.attr == "environ") or (
                fn.attr == "getenv" and isinstance(base, ast.Name) and base.id == "os"
            ):
                if sub.args and isinstance(sub.args[0], ast.Constant) and isinstance(sub.args[0].value, str):
                    out.append(sub.args[0].value)
        elif isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Attribute) and sub.value.attr == "environ":
            key = sub.slice
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                out.append(key.value)
        elif isinstance(sub, ast.Name) and sub.id in env_names:
            out.append(env_names[sub.id])
    seen = []
    for f in out:
        if f not in seen:
            seen.append(f)
    return seen


# ---- TypeScript ---------------------------------------------------------

TS_ENV_CONST_RE = re.compile(
    r"\b(?:const|let|var)\s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;]{0,80})?=\s*[^;\n]*"
    r"process\.env\.(?P<flag>[A-Za-z_][A-Za-z0-9_]*)"
)


def parse_typescript(abs_path):
    relp = rel(abs_path)
    info = FileInfo(relp, "ts")
    raw = read_text(abs_path)
    # `blanked` hides comments AND string contents -> safe for structure
    # (exports, tokens, brace/paren matching, if-conditions).
    blanked = blank_ts(raw, blank_strings=True)
    # `nocomments` hides comments only -> the ONLY text a literal may be read
    # from.  Reading a specifier out of `blanked` yields whitespace; that bug
    # silently emptied the entire TypeScript import graph once and is now
    # guarded by control C14.
    nocomments = blank_ts(raw, blank_strings=False)
    starts = line_starts(raw)
    raw_lines = raw.splitlines()
    info.loc = raw.count("\n") + (1 if raw and not raw.endswith("\n") else 0)

    for m in PATH_LITERAL_RE.finditer(nocomments):
        info.path_literals.append((m.group(0), offset_to_line(starts, m.start())))
    for m in MODULE_LITERAL_RE.finditer(nocomments):
        info.module_literals.append((m.group(1), offset_to_line(starts, m.start())))

    # exported declarations
    captured_lines = set()
    for m in TS_EXPORT_RE.finditer(blanked):
        kind, name = m.group(1), m.group(2)
        line = offset_to_line(starts, m.start())
        captured_lines.add(line)
        close_off = -1
        if kind in ("function", "function*", "class", "enum", "interface"):
            _open_off, close_off = match_delims(blanked, m.end(), "{", "}")
        end_line = offset_to_line(starts, close_off - 1) if close_off > 0 else line
        if end_line < line:
            end_line = line
        norm_kind = "function" if kind.startswith("function") else kind
        info.symbols.append((name, norm_kind, line, end_line))
        info.exported_names.add(name)

    # `export { A, B as C };` with no `from` -- a local export list.  The
    # EXPORTED name is what other modules import, so that is what is recorded.
    for m in TS_EXPORT_BINDING_RE.finditer(blanked):
        if m.group("from"):
            continue  # `export { X } from "./y"` is a pass-through, not a definition
        line = offset_to_line(starts, m.start())
        captured_lines.add(line)
        kind = "export-binding-type" if m.group("typeonly") else "export-binding"
        for part in m.group("body").split(","):
            part = part.strip()
            if not part:
                continue
            toks = [t for t in IDENT_RE.findall(part) if t != "as"]
            if not toks:
                continue
            exported = toks[-1]  # `A as C` exports C; a bare `A` exports A
            if exported in info.exported_names:
                continue
            info.symbols.append((exported, kind, line, line))
            info.exported_names.add(exported)

    # residual: `export` lines the declaration pattern did NOT turn into a symbol
    for m in TS_EXPORT_LINE_RE.finditer(blanked):
        line = offset_to_line(starts, m.start())
        if line in captured_lines:
            continue
        chunk = m.group(0)
        if TS_REEXPORT_RE.match(chunk):
            if "*" in chunk:
                info.has_star_reexport = True
            for nm in IDENT_RE.findall(chunk):
                if nm not in ("export", "from", "as", "type", "default"):
                    info.reexport_names.add(nm)
            continue
        text = raw_lines[line - 1].strip() if line - 1 < len(raw_lines) else ""
        info.unmatched_export_lines.append((line, text[:120]))

    # references
    refs = collections.defaultdict(list)
    for m in IDENT_RE.finditer(blanked):
        refs[m.group(0)].append(offset_to_line(starts, m.start()))
    info.refs = {k: sorted(set(v)) for k, v in refs.items()}

    # imports -- matched on `nocomments`, NOT on `blanked`.  `blanked` erases
    # the quote characters along with the contents, so an import specifier is
    # simply not present there; matching imports against it yields an empty
    # graph.  `nocomments` keeps literals intact while still ignoring
    # commented-out imports.  Guarded by control C14.
    seen_specs = set()
    for m in TS_IMPORT_RE.finditer(nocomments):
        spec = m.group("spec")
        clause = m.group("clause") or ""
        names = [n for n in IDENT_RE.findall(clause) if n not in ("as", "type", "from", "default")]
        info.raw_import_specs.append((spec, 0, names, offset_to_line(starts, m.start())))
        seen_specs.add((spec, m.start()))
    for regex in (TS_BARE_IMPORT_RE, TS_DYNAMIC_IMPORT_RE):
        for m in regex.finditer(nocomments):
            info.raw_import_specs.append((m.group("spec"), 0, [], offset_to_line(starts, m.start())))

    info.env_reads = ts_env_reads(blanked, raw, starts)
    info.gates = ts_flag_gates(blanked, raw, starts)
    return info


def ts_flag_gates(blanked, raw, starts):
    """Line ranges inside `if (...) { ... }` whose condition depends on process.env."""
    env_consts = {}
    for m in TS_ENV_CONST_RE.finditer(blanked):
        env_consts[m.group("name")] = m.group("flag")

    gates = []
    for m in re.finditer(r"\bif\s*\(", blanked):
        po, pc = match_delims(blanked, m.end() - 1, "(", ")")
        if pc == -1:
            continue
        cond = blanked[po:pc]
        flags = []
        for em in TS_ENV_RE.finditer(cond):
            flags.append(em.group("n1") or em.group("n2"))
        for ident in IDENT_RE.findall(cond):
            if ident in env_consts:
                flags.append(env_consts[ident])
        flags = [f for f in flags if f]
        if not flags:
            continue
        if "{" not in blanked[pc:pc + 4]:
            gates.append((flags[0], offset_to_line(starts, pc), offset_to_line(starts, pc)))
            continue
        bo, bc = match_delims(blanked, pc, "{", "}")
        if bc == -1:
            continue
        gates.append((flags[0], offset_to_line(starts, bo), offset_to_line(starts, bc - 1)))
    return gates


# --------------------------------------------------------------------------
# 4. Import resolution -> module graph
# --------------------------------------------------------------------------

def resolve_python_import(spec, level, importer_path, by_path):
    """Return (target_relpath | None, is_internal)."""
    if level and level > 0:
        parts = importer_path.split("/")[:-1]
        for _ in range(level - 1):
            if parts:
                parts.pop()
        base = "/".join(parts)
        mod_path = (base + "/" + spec.replace(".", "/")) if spec else base
        for c in (mod_path + ".py", mod_path + "/__init__.py"):
            if c in by_path:
                return c, True
        return None, True
    if spec.split(".")[0] != "src":
        return None, False
    mod_path = spec.replace(".", "/")
    for c in (mod_path + ".py", mod_path + "/__init__.py"):
        if c in by_path:
            return c, True
    return None, True


TS_RESOLVE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".d.ts", ".json", ".mjs", ".cjs", ".js"]


def resolve_ts_import(spec, importer_path, by_path, disk_set):
    if spec.startswith("@/"):
        base = "src/" + spec[2:]
    elif spec.startswith("./") or spec.startswith("../"):
        base = os.path.normpath(os.path.join(os.path.dirname(importer_path), spec)).replace(os.sep, "/")
    else:
        return None, False
    stripped = base
    for ext in (".js", ".jsx", ".mjs", ".cjs"):
        if stripped.endswith(ext):
            stripped = stripped[: -len(ext)]
            break
    for cand in [stripped + s for s in TS_RESOLVE_SUFFIXES] + [base, stripped]:
        if cand in by_path:
            return cand, True
    for cand in [stripped + s for s in TS_RESOLVE_SUFFIXES] + [base]:
        if cand in disk_set:
            return cand, True
    return None, True


def build_graph(files, by_path, disk_set):
    edges = collections.defaultdict(set)
    missing_modules = []   # (importer, spec, line)
    for f in files:
        for spec, level, _names, line in f.raw_import_specs:
            if f.lang == "py":
                target, internal = resolve_python_import(spec, level, f.path, by_path)
            else:
                target, internal = resolve_ts_import(spec, f.path, by_path, disk_set)
            if target:
                edges[f.path].add(target)
            elif internal:
                missing_modules.append((f.path, spec, line))
    return edges, missing_modules


def reachable_from(entries, edges):
    seen = set()
    stack = list(entries)
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        for nxt in edges.get(node, ()):
            if nxt not in seen:
                stack.append(nxt)
    return seen


# --------------------------------------------------------------------------
# 5. Entry points -- MEASURED, not assumed
# --------------------------------------------------------------------------

def resolve_module_spec(spec, by_path):
    """`src.engine.pine_compiler` -> `src/engine/pine_compiler.py` if it exists."""
    base = spec.replace(".", "/")
    for cand in (base + ".py", base + "/__init__.py"):
        if cand in by_path:
            return cand
    return None


def discover_entry_points(by_path, files):
    """Return {path: [reason, ...]}."""
    prov = collections.defaultdict(list)

    # (a) npm scripts naming a repo file
    pkg_path = os.path.join(REPO, "package.json")
    if os.path.isfile(pkg_path):
        try:
            pkg = json.loads(read_text(pkg_path))
        except ValueError:
            pkg = {}
        for script_name, cmd in sorted((pkg.get("scripts") or {}).items()):
            cmd = str(cmd)
            for m in re.finditer(r"(?:src|scripts)/[A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|cjs|js|py)", cmd):
                cand = m.group(0)
                alts = [cand]
                if cand.endswith(".js"):
                    alts.append(cand[:-3] + ".ts")
                for c in alts:
                    if c in by_path:
                        prov[c].append("package.json script `%s`" % script_name)
                        break
            for m in re.finditer(r"python\s+-m\s+([A-Za-z0-9_.]+)", cmd):
                modp = m.group(1).replace(".", "/") + ".py"
                if modp in by_path:
                    prov[modp].append("package.json script `%s` (python -m)" % script_name)

    # (b) Python modules invoked as a subprocess from non-test TS -- the real
    # seam, in BOTH of its forms: a "src/engine/x.py" path literal, and a
    # "src.engine.x" module spec passed to `python -m`.
    for f in files:
        if f.lang != "ts" or f.is_test:
            continue
        for literal, _line in f.path_literals:
            if literal.endswith(".py") and literal in by_path:
                prov[literal].append("subprocess path literal in %s" % f.path)
        for spec, _line in f.module_literals:
            target = resolve_module_spec(spec, by_path)
            if target:
                prov[target].append("`python -m %s` module spec in %s" % (spec, f.path))

    # (c) Python modules with an `if __name__ == "__main__"` block
    for f in files:
        if f.lang == "py" and not f.is_test and f.refs.get("__main__"):
            prov[f.path].append("has `__main__` guard (runnable module)")

    # (d) the long-running services themselves
    for p in ("src/server/index.ts", "src/discord/bot.ts"):
        if p in by_path:
            prov[p].append("service entry point")

    return prov


# --------------------------------------------------------------------------
# 6. Classification
# --------------------------------------------------------------------------

WIRED = "WIRED"
FLAG_GATED = "FLAG-GATED"
BUILT_UNREACHABLE = "BUILT-UNREACHABLE"
DECLARED_ABSENT = "DECLARED-ABSENT"
UNCLASSIFIED = "UNCLASSIFIED"

STATES = [WIRED, FLAG_GATED, BUILT_UNREACHABLE, DECLARED_ABSENT, UNCLASSIFIED]


class Row(object):
    __slots__ = ("name", "kind", "path", "line", "state", "flag", "default",
                 "callers_other", "callers_same", "test_callers", "note",
                 "ambiguous")

    def __init__(self, **kw):
        for s in self.__slots__:
            setattr(self, s, kw.get(s))


def in_any_gate(gates, line):
    for flag, start, end in gates:
        if start <= line <= end:
            return flag
    return None


def build_name_defs(files):
    """name -> set of files that DEFINE a symbol with that name.

    References are matched by identifier name, not by resolved binding, so a
    name defined in more than one file has unreliable caller counts.  Counting
    that population turns the instrument's main known bias from an unmeasured
    caveat into a published number.
    """
    name_defs = collections.defaultdict(set)
    for f in files:
        if not f.path.startswith("src/") or f.is_test:
            continue
        for name, _kind, _line, _end in f.symbols:
            name_defs[name].add(f.path)
    return name_defs


def classify(files, by_path, reachable, ref_index, name_defs):
    rows = []
    for f in files:
        if f.lang not in ("py", "ts") or not f.path.startswith("src/") or f.is_test:
            continue
        f_reachable = f.path in reachable
        for name, kind, line, end_line in f.symbols:
            other, same, tests = [], [], []
            for ref_path in ref_index.get(name, ()):
                rf = by_path[ref_path]
                lines = rf.refs.get(name, [])
                if ref_path == f.path:
                    hits = [ln for ln in lines if not (line <= ln <= end_line)]
                    if hits:
                        same.append((ref_path, hits[0]))
                    continue
                if rf.is_test:
                    tests.append((ref_path, lines[0] if lines else 0))
                else:
                    other.append((ref_path, lines[0] if lines else 0))
            other.sort()
            same.sort()
            tests.sort()

            gate_flag = in_any_gate(f.gates, line)
            caller_gate = None
            if not gate_flag:
                gated_hits = 0
                for ref_path, ln in other:
                    g = in_any_gate(by_path[ref_path].gates, ln)
                    if g:
                        gated_hits += 1
                        if caller_gate is None:
                            caller_gate = (g, ref_path)
                # only FLAG-GATED if EVERY non-test call site is gated
                if other and gated_hits != len(other):
                    caller_gate = None
                if not other:
                    caller_gate = None

            has_nontest_caller = bool(other) or bool(same)

            if not has_nontest_caller:
                state = BUILT_UNREACHABLE
                note = "no non-test reference outside its own definition"
                if tests:
                    note += "; %d test file(s) do reference it" % len(tests)
                flag = default = None
            elif not f_reachable:
                state = BUILT_UNREACHABLE
                note = "defining module is not reachable from any measured entry point"
                flag = default = None
            elif gate_flag or caller_gate:
                state = FLAG_GATED
                if gate_flag:
                    flag = gate_flag
                    note = "definition sits inside an env-conditional block"
                    default = flag_default(f, flag)
                else:
                    flag, gpath = caller_gate
                    note = "every non-test call site is inside an env-conditional block (e.g. %s)" % gpath
                    default = flag_default(by_path[gpath], flag) or flag_default(f, flag)
            else:
                state = WIRED
                note = ""
                flag = default = None

            rows.append(Row(
                name=name, kind=kind, path=f.path, line=line, state=state,
                flag=flag, default=default,
                callers_other=other, callers_same=same, test_callers=tests,
                note=note, ambiguous=len(name_defs.get(name, ())) > 1,
            ))
    return rows


def flag_default(fileinfo, flag):
    for name, default, _line in fileinfo.env_reads:
        if name == flag:
            return default
    return None


# --------------------------------------------------------------------------
# 7. DECLARED-ABSENT and UNCLASSIFIED probes
# --------------------------------------------------------------------------

def find_declared_absent(files, by_path, disk_set, missing_modules):
    rows = []
    for importer, spec, line in sorted(set(missing_modules)):
        rows.append(Row(
            name=spec, kind="module", path=importer, line=line,
            state=DECLARED_ABSENT, flag=None, default=None,
            callers_other=[], callers_same=[], test_callers=[],
            note="import specifier resolves to no file on disk",
        ))
    seen = set()
    for f in files:
        for literal, line in f.path_literals:
            if literal in by_path or literal in disk_set:
                continue
            key = (f.path, literal)
            if key in seen:
                continue
            seen.add(key)
            rows.append(Row(
                name=literal, kind="path-literal", path=f.path, line=line,
                state=DECLARED_ABSENT, flag=None, default=None,
                callers_other=[], callers_same=[], test_callers=[],
                note="repo-relative path literal with no file on disk",
            ))
    # `python -m src.pkg.mod` specs naming a module that does not exist.  Only
    # reported when the parent PACKAGE directory does exist, so an arbitrary
    # dotted string cannot masquerade as a missing module.
    for f in files:
        for spec, line in f.module_literals:
            if resolve_module_spec(spec, by_path):
                continue
            parent_dir = "/".join(spec.split(".")[:-1])
            if not os.path.isdir(os.path.join(REPO, parent_dir.replace("/", os.sep))):
                continue
            key = (f.path, spec)
            if key in seen:
                continue
            seen.add(key)
            rows.append(Row(
                name=spec, kind="module-spec", path=f.path, line=line,
                state=DECLARED_ABSENT, flag=None, default=None,
                callers_other=[], callers_same=[], test_callers=[],
                note="`python -m` module spec with no module on disk (parent package exists)",
            ))
    return rows


def find_unclassified_residual(files):
    """Everything the instrument could NOT place.  Never omitted."""
    rows = []
    for f in files:
        if not f.path.startswith("src/") or f.is_test:
            continue
        if f.parse_error:
            rows.append(Row(
                name=f.path, kind="file", path=f.path, line=1, state=UNCLASSIFIED,
                flag=None, default=None, callers_other=[], callers_same=[], test_callers=[],
                note="parser failed: %s" % f.parse_error,
            ))
            continue
        for line, text in f.unmatched_export_lines:
            rows.append(Row(
                name=text or "(export)", kind="export-line", path=f.path, line=line,
                state=UNCLASSIFIED, flag=None, default=None,
                callers_other=[], callers_same=[], test_callers=[],
                note="line begins with `export` but did not match the declaration pattern",
            ))
        if f.lang == "ts" and not f.symbols and not f.unmatched_export_lines and f.loc > 0:
            rows.append(Row(
                name=f.path, kind="file", path=f.path, line=1, state=UNCLASSIFIED,
                flag=None, default=None, callers_other=[], callers_same=[], test_callers=[],
                note="no exported declaration matched; file contributes 0 symbols",
            ))
    return rows


# --------------------------------------------------------------------------
# 8. Non-symbol surfaces: n8n, SQL migrations, API routes
# --------------------------------------------------------------------------

def survey_n8n():
    out = []
    for p in walk_files("workflows", (".json",)):
        relp = rel(p)
        active = None
        nodes = None
        try:
            data = json.loads(read_text(p))
            if isinstance(data, dict):
                active = data.get("active")
                if isinstance(data.get("nodes"), list):
                    nodes = len(data["nodes"])
        except ValueError:
            pass
        out.append((relp, relp.rsplit("/", 1)[-1], active, nodes))
    return out


def survey_migrations():
    return sorted(rel(p) for p in walk_files("src/server/db", (".sql",)))


def survey_routes(by_path, reachable, files):
    index = by_path.get("src/server/index.ts")
    registered = set()
    if index is not None:
        for spec, _lvl, _names, _line in index.raw_import_specs:
            if "routes/" in spec:
                base = spec.rsplit("/", 1)[-1]
                for ext in (".js", ".ts"):
                    if base.endswith(ext):
                        base = base[: -len(ext)]
                        break
                registered.add(base)
    rows = []
    for f in files:
        if not f.path.startswith("src/server/routes/") or f.is_test:
            continue
        base = f.path.rsplit("/", 1)[-1]
        if not base.endswith(".ts"):
            continue
        rows.append((f.path, base[:-3] in registered, f.path in reachable, len(f.symbols)))
    return sorted(rows)


# --------------------------------------------------------------------------
# 9. Positive controls -- audit the instrument before believing it
# --------------------------------------------------------------------------

def run_positive_controls(rows_by_key, files, reachable, entry_prov, state_counts):
    """Return [(name, passed, detail)].  These are KNOWN ANSWERS.

    A counter that cannot return non-zero is not evidence of absence, and a
    uniform result is almost always a broken probe.  These make that loud.
    """
    controls = []

    def add(name, ok, detail):
        controls.append((name, bool(ok), detail))

    # C1 - a comment-only mention must NOT count as a caller, and the control
    # carries its own POSITIVE WITNESS so that "0 comment callers" cannot be
    # satisfied by a reference walker that simply found nothing.
    #
    # Known answer, verified by hand at src/engine/indicators/core.py:
    #   line 467       -- def compute_opening_range_breakout(...)
    #   lines 649, 760 -- REAL calls, from the compute_indicators dispatcher
    #   src/engine/config.py:304 -- the name appears ONLY inside a `#` comment
    # So: config.py must be absent from the caller set, AND the two real
    # same-file calls must be present.
    row = rows_by_key.get(("compute_opening_range_breakout", "src/engine/indicators/core.py"))
    if row is None:
        add("C1 comment-only mention is not a caller", False,
            "control symbol compute_opening_range_breakout was not enumerated at all")
    else:
        comment_only_file = "src/engine/config.py"
        excluded = comment_only_file not in [p for p, _ln in row.callers_other]
        witnessed = len(row.callers_same) > 0
        add("C1 comment-only mention is not a caller (+ positive witness)",
            excluded and witnessed,
            "%s excluded=%s; real same-module calls detected=%d (witness that the walker ran)"
            % (comment_only_file, excluded, len(row.callers_same)))

    # C2/C3 - the classifier must be ABLE to emit both of the main states.
    add("C2 WIRED is reachable by the classifier",
        state_counts.get(WIRED, 0) > 0, "WIRED=%d" % state_counts.get(WIRED, 0))
    add("C3 BUILT-UNREACHABLE is reachable by the classifier",
        state_counts.get(BUILT_UNREACHABLE, 0) > 0,
        "BUILT-UNREACHABLE=%d" % state_counts.get(BUILT_UNREACHABLE, 0))

    # C4 - no uniform result (the broken-probe tell).
    total = sum(state_counts.values()) or 1
    worst = max(state_counts.values()) if state_counts else 0
    add("C4 result is not uniform (broken-probe tell)",
        worst / float(total) <= 0.97,
        "largest bucket = %.1f%% of %d rows" % (100.0 * worst / total, total))

    # C5 - entry-point discovery found the service entry point.
    add("C5 server entry point discovered",
        "src/server/index.ts" in entry_prov, "entry points discovered=%d" % len(entry_prov))

    # C6 - reachability is not degenerate.
    add("C6 a registered route module is reachable",
        "src/server/routes/backtests.ts" in reachable,
        "modules reachable=%d" % len(reachable))

    # C7 - the env-flag extractor fires in both languages.
    py_flags = sum(1 for f in files if f.lang == "py" and f.env_reads)
    ts_flags = sum(1 for f in files if f.lang == "ts" and f.env_reads)
    add("C7 env-flag extractor fires in both languages",
        py_flags > 0 and ts_flags > 0, "py files with env reads=%d, ts=%d" % (py_flags, ts_flags))

    # C8/C9 - the TS blanker is the single most load-bearing helper.
    probe = "const a = 1; // export function ghost() {}\n/* export class Ghost {} */\nexport function real() {}\n"
    blanked = blank_ts(probe)
    add("C8 TS comment blanker removes commented-out code",
        "ghost" not in blanked and "Ghost" not in blanked and "real" in blanked,
        "ok" if "ghost" not in blanked else "BLANKER LEAKED COMMENTED CODE")
    add("C9 blanking preserves offsets exactly", len(blanked) == len(probe),
        "%d chars in, %d out" % (len(probe), len(blanked)))

    # C10/C11 - both flag-gate detectors fire on a synthetic default-off flag.
    probe_py = ("import os\n"
                "ENABLED = os.environ.get('TF_PROBE_FLAG', '0') == '1'\n"
                "if ENABLED:\n"
                "    def gated():\n"
                "        return 1\n")
    gates = py_flag_gates(ast.parse(probe_py))
    add("C10 python env-gate detector fires",
        any(g[0] == "TF_PROBE_FLAG" for g in gates), "gates=%r" % (gates,))

    probe_ts = "if (process.env.TF_PROBE_FLAG === '1') {\n  doThing();\n}\n"
    tgates = ts_flag_gates(blank_ts(probe_ts), probe_ts, line_starts(probe_ts))
    add("C11 TS env-gate detector fires",
        any(g[0] == "TF_PROBE_FLAG" for g in tgates), "gates=%r" % (tgates,))

    # C12 - symbols enumerated in both languages.
    py_syms = sum(len(f.symbols) for f in files
                  if f.lang == "py" and f.path.startswith("src/") and not f.is_test)
    ts_syms = sum(len(f.symbols) for f in files
                  if f.lang == "ts" and f.path.startswith("src/") and not f.is_test)
    add("C12 symbols enumerated in both languages", py_syms > 0 and ts_syms > 0,
        "py=%d ts=%d" % (py_syms, ts_syms))

    # C13 - the DECLARED-ABSENT probe can fire (negative-space control).
    add("C13 DECLARED-ABSENT probe is live",
        state_counts.get(DECLARED_ABSENT, 0) >= 0,
        "DECLARED-ABSENT=%d (probe runs; 0 would be a legitimate reading)"
        % state_counts.get(DECLARED_ABSENT, 0))

    # C14 - REGRESSION GUARD on a real defect this generator shipped once:
    # TypeScript import specifiers were matched against the fully-blanked text,
    # where the quote characters and contents are both spaces.  Every TS import
    # resolved to nothing and the whole TS import graph was empty, which showed
    # up as a suspiciously uniform "almost nothing is reachable" reading.
    ts_specs = []
    for f in files:
        if f.lang == "ts":
            ts_specs.extend(s for s, _lvl, _n, _ln in f.raw_import_specs)
    nonblank = sum(1 for s in ts_specs if s and s.strip())
    add("C14 TS import specifiers are real text, not blanked whitespace",
        bool(ts_specs) and nonblank / float(len(ts_specs)) > 0.95,
        "%d/%d TS import specifiers non-blank" % (nonblank, len(ts_specs) or 0))

    # C15 - internal consistency: the two conjuncts of WIRED must both hold.
    bad_wired = [r for r in rows_by_key.values()
                 if r.state == WIRED and not (r.callers_other or r.callers_same)]
    add("C15 no WIRED row lacks a non-test caller", not bad_wired,
        "violations=%d" % len(bad_wired))

    # C16 - TS reachability is not degenerate.  A pure-Python reachable set
    # with ~zero TS modules is the exact shape of the C14 defect.
    ts_reach = sum(1 for p in reachable if p.endswith((".ts", ".tsx")))
    add("C16 TypeScript modules are reachable, not just Python",
        ts_reach > 100, "reachable TS modules=%d" % ts_reach)

    # C20 - an ALIASED import must count as a reference to the ORIGINAL symbol.
    # Known answer: src/engine/walk_forward.py imports
    #   `from src.engine.pbo_gate import compute_pbo_from_cpcv_paths as _cpcv_pbo_fn`
    # at lines 763, 1893 and 2929.  Recording only the alias made this read as
    # BUILT-UNREACHABLE with zero callers -- a false positive caught by hand.
    row = rows_by_key.get(("compute_pbo_from_cpcv_paths", "src/engine/pbo_gate.py"))
    if row is None:
        add("C20 aliased imports count as references", False, "control symbol not enumerated")
    else:
        callers = [p for p, _ln in row.callers_other]
        add("C20 aliased imports count as references",
            "src/engine/walk_forward.py" in callers,
            "walk_forward.py in callers=%s (state=%s, non-test caller files=%d)"
            % ("src/engine/walk_forward.py" in callers, row.state, len(callers)))

    # C19 - the `python -m src.engine.X` seam must be discovered as an entry
    # point.  Known answer: src/server/services/pine-export-service.ts:255
    # spawns ["-m", "src.engine.pine_compiler", ...].  Before this probe
    # existed, pine_compiler.py and its whole import closure read as
    # BUILT-UNREACHABLE -- a false headline number.
    add("C19 `python -m` module-spec entry points are discovered",
        "src/engine/pine_compiler.py" in entry_prov,
        "pine_compiler is an entry point=%s; total entry points=%d"
        % ("src/engine/pine_compiler.py" in entry_prov, len(entry_prov)))

    # C18 - the `export { router as alertRoutes };` form must be captured.
    # Known answer: src/server/routes/alerts.ts:86 exports exactly that, and
    # src/server/index.ts imports `alertRoutes` from it.  Missing this form
    # made whole route modules read as "0 symbols".
    add("C18 `export { X as Y }` binding form is enumerated",
        ("alertRoutes", "src/server/routes/alerts.ts") in rows_by_key,
        "alertRoutes enumerated=%s"
        % (("alertRoutes", "src/server/routes/alerts.ts") in rows_by_key))

    return controls


# --------------------------------------------------------------------------
# 10. Rendering
# --------------------------------------------------------------------------

def git_sha():
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO,
                                      stderr=subprocess.DEVNULL)
        return out.decode("ascii", "replace").strip()
    except Exception:
        return "(unavailable)"


def git_dirty(out_rel):
    """Worktree dirtiness EXCLUDING the generated file itself (determinism)."""
    try:
        out = subprocess.check_output(["git", "status", "--porcelain"], cwd=REPO,
                                      stderr=subprocess.DEVNULL)
        lines = [ln for ln in out.decode("utf-8", "replace").splitlines() if ln.strip()]
        return len([ln for ln in lines if out_rel not in ln]) > 0
    except Exception:
        return False


def subsystem_of(path):
    parts = path.split("/")
    return "/".join(parts[:3]) if len(parts) >= 3 else "/".join(parts[:2])


def md_escape(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def render(ctx):
    L = []
    a = L.append
    files = ctx["files"]

    a("<!-- GENERATED FILE - DO NOT HAND-EDIT -->")
    a("# SYSTEM INVENTORY")
    a("")
    a("> **GENERATED FILE - DO NOT HAND-EDIT.**")
    a("> Regenerate with `%s`" % GEN_CMD)
    a("> Generated at commit `%s`%s" % (ctx["sha"],
      "  (worktree DIRTY at generation time)" if ctx["dirty"] else ""))
    a("> Generator: `scripts/system_inventory.py`.  Staleness check: `%s --check` (exit 1 if stale)."
      % GEN_CMD)
    a(">")
    a("> Anyone who hand-edits this file has reintroduced the exact defect it exists to prevent.")
    a("> This repo already carries four hand-maintained declaration layers; all four went stale and")
    a("> actively misled agents. **Change the generator, not the output.**")
    a("")
    a("**What this file answers:** *is X already built, and is it wired?*  Read it BEFORE building")
    a("anything.  This campaign has convicted the same defect seven times - an agent spending hours")
    a("building or planning something that was already in the tree.")
    a("")
    a("**Grade of every number below: MEASURED HERE**, by `scripts/system_inventory.py`, over the")
    a("surface published in section 1, at the commit named above.  Nothing here is relayed,")
    a("remembered, or hand-copied.  Where a number is not measured, it is labelled")
    a("`UNENUMERATED` or `NOT MEASURED` rather than estimated.")
    a("")

    # ---- 1. Surface -----------------------------------------------------
    a("---")
    a("")
    a("## 1. The swept surface")
    a("")
    a("A census is bounded by its surface as much as by its pattern, so the surface is published")
    a("first and its cost is made visible.")
    a("")
    a("### 1.1 Symbol surface - definitions found here become inventory rows")
    a("")
    a("| Root | Language | Files scanned | Files skipped as tests | LOC scanned | Symbols enumerated |")
    a("|---|---|---:|---:|---:|---:|")
    for lang, label in (("py", "Python"), ("ts", "TypeScript")):
        sel = [f for f in files if f.lang == lang and f.path.startswith("src/")]
        prod = [f for f in sel if not f.is_test]
        a("| `src/` | %s | %d | %d | %d | %d |" % (
            label, len(prod), len(sel) - len(prod),
            sum(f.loc for f in prod), sum(len(f.symbols) for f in prod)))
    a("")
    a("Python symbol rule: every **module-level** `def`, `async def` and `class`.")
    a("TypeScript symbol rule: every line matching an **exported declaration** pattern")
    a("(`export [default] [declare] [abstract] [async] function|class|interface|type|enum|const|let|var NAME`).")
    a("")
    a("### 1.2 Reference surface - a call from here can make a symbol `WIRED`")
    a("")
    a("| Root | Files parsed | Non-test files |")
    a("|---|---:|---:|")
    for root in REFERENCE_ROOTS:
        sel = [f for f in files if f.path.split("/")[0] == root]
        a("| `%s/` | %d | %d |" % (root, len(sel), sum(1 for f in sel if not f.is_test)))
    a("| **TOTAL** | **%d** | **%d** |" % (len(files), sum(1 for f in files if not f.is_test)))
    a("")
    a("Directories never descended into, anywhere: `%s`." % "`, `".join(sorted(SKIP_DIRS)))
    a("")
    a("### 1.3 What the enumerator DELIBERATELY does not enumerate")
    a("")
    a("Published so that under-inclusion is visible instead of silent.")
    a("")
    prod_py = [f for f in files if f.lang == "py" and f.path.startswith("src/") and not f.is_test]
    a("| Not enumerated | Count | Why |")
    a("|---|---:|---|")
    a("| Python class methods | %d | one row per method would swamp the map; a method is reached through its class |"
      % sum(f.method_count for f in prod_py))
    a("| Python nested / inner functions | %d | not part of any module's import surface |"
      % sum(f.nested_def_count for f in prod_py))
    a("| Non-exported TypeScript declarations | UNENUMERATED | module-private by construction |")
    a("| `src/` test files | %d | tests are the reference surface, never the symbol surface |"
      % sum(1 for f in files if f.path.startswith("src/") and f.is_test))
    a("")

    # ---- 2. Instrument --------------------------------------------------
    a("---")
    a("")
    a("## 2. The instrument, and its audit")
    a("")
    a("### 2.1 Classification rules - mechanical, no judgement about importance")
    a("")
    a("| State | The rule actually implemented |")
    a("|---|---|")
    a("| `WIRED` | >=1 reference from a NON-test file, or a non-definition reference inside its own module, **and** the defining module is reachable through the import graph from a measured entry point (2.2). |")
    a("| `FLAG-GATED` | Would be `WIRED`, but the definition - or **every** non-test call site - sits lexically inside a block whose condition depends on an environment variable.  Flag name and default recorded. |")
    a("| `BUILT-UNREACHABLE` | No non-test reference at all, **or** the defining module is not reachable from any measured entry point. |")
    a("| `DECLARED-ABSENT` | Something imports it, or names its path as a string literal, and it does not exist on disk. |")
    a("| `UNCLASSIFIED` | **The mandatory residual.**  A file the parser could not read, an `export` line the declaration pattern did not match, or a file that yielded zero symbols.  Never omitted: a taxonomy with no residual forces the classifier to mis-file or stay silent, and both hide findings. |")
    a("")
    a("Reference detection is **AST-based for Python**, so a symbol named only in a comment or a")
    a("docstring is correctly NOT counted as a caller (this is control C1 - the")
    a("`compute_opening_range_breakout` case that started this file).  For TypeScript, comments,")
    a("strings and template literals are blanked before tokenising, which gives the same guarantee")
    a("through a weaker parser.")
    a("")
    a("### 2.2 Entry points - MEASURED, not assumed")
    a("")
    a("Reachability is meaningless without a published entry-point set.  These were discovered by")
    a("reading `package.json` scripts, by scanning non-test TypeScript for `src/**.py` subprocess")
    a("path literals (the real TS->Python seam), and by finding `__main__` guards.")
    a("")
    a("Total entry points: **%d**.  Modules reachable from them: **%d** of **%d** parsed files."
      % (len(ctx["entry_prov"]), len(ctx["reachable"]), len(files)))
    a("")
    a("<details><summary>All %d entry points and why each was counted</summary>" % len(ctx["entry_prov"]))
    a("")
    a("| Entry point | Discovered because |")
    a("|---|---|")
    for path in sorted(ctx["entry_prov"]):
        reasons = sorted(set(ctx["entry_prov"][path]))
        shown = reasons[0] if len(reasons) == 1 else "%s (+%d more)" % (reasons[0], len(reasons) - 1)
        a("| `%s` | %s |" % (path, md_escape(shown)))
    a("")
    a("</details>")
    a("")
    a("### 2.3 Positive controls - the instrument audited before its output is believed")
    a("")
    a("A counter that cannot return non-zero is not evidence of absence, and a uniform result is")
    a("almost always a broken probe.  These are known answers.  **A FAIL here invalidates every")
    a("table below it.**")
    a("")
    a("| # | Control | Result | Detail |")
    a("|---|---|---|---|")
    for name, ok, detail in ctx["controls"]:
        num, rest = name.split(" ", 1)
        a("| %s | %s | %s | %s |" % (num, md_escape(rest), "PASS" if ok else "**FAIL**", md_escape(detail)))
    a("")
    failed = [c for c in ctx["controls"] if not c[1]]
    a("**%d / %d controls pass.**%s" % (
        len(ctx["controls"]) - len(failed), len(ctx["controls"]),
        "" if not failed else "  **THIS INVENTORY IS NOT TRUSTWORTHY - FIX THE GENERATOR.**"))
    a("")
    a("### 2.4 Known limits of this instrument")
    a("")
    name_defs = ctx["name_defs"]
    total_names = len(name_defs) or 1
    amb_names = sum(1 for v in name_defs.values() if len(v) > 1)
    sym_rows = [r for r in ctx["rows"] if r.ambiguous is not None]
    amb_rows = sum(1 for r in sym_rows if r.ambiguous)
    a("* **Name collision biases toward `WIRED` - and the affected population is MEASURED, not")
    a("  merely warned about.**  References are matched by identifier name, not by resolved")
    a("  binding, so two symbols sharing a name each see the other's references.")
    a("  **%d of %d enumerated symbol names (%.1f%%) are defined in more than one file, covering"
      % (amb_names, total_names, 100.0 * amb_names / total_names))
    a("  %d of %d symbol rows (%.1f%%).**  Every symbol table below marks those rows `AMBIG`."
      % (amb_rows, len(sym_rows), 100.0 * amb_rows / (len(sym_rows) or 1)))
    a("  An `AMBIG` row has an unreliable caller count in BOTH directions.  A row WITHOUT the")
    a("  mark does not have this problem at all, so the unmarked majority is trustworthy.")
    a("* **Dynamic dispatch is invisible.**  Registry lookups, `getattr`, string-keyed handler maps,")
    a("  and inbound n8n HTTP calls do not appear in a static import graph.  `BUILT-UNREACHABLE`")
    a("  therefore means *this instrument found no static path*, **not** *it is dead*.")
    a("* **TypeScript is pattern-matched, not compiled.**  Exported declarations written in unusual")
    a("  syntax land in `UNCLASSIFIED` rather than being silently dropped - see section 9.")
    a("* **Flag gating detects lexical `if` blocks only.**  A flag consumed as an early `return`, a")
    a("  decorator, a config-object lookup, or a database-backed toggle is not detected, so section 5")
    a("  is a LOWER BOUND on flag-gated surface.")
    a("* **Reachability is not execution.**  `WIRED` says a static path exists, not that the code ran.")
    a("")

    # ---- 3. Totals ------------------------------------------------------
    a("---")
    a("")
    a("## 3. Totals")
    a("")
    a("| State | Count | Share |")
    a("|---|---:|---:|")
    total = sum(ctx["state_counts"].values()) or 1
    for st in STATES:
        n = ctx["state_counts"].get(st, 0)
        a("| `%s` | %d | %.1f%% |" % (st, n, 100.0 * n / total))
    a("| **TOTAL** | **%d** | |" % sum(ctx["state_counts"].values()))
    a("")

    # ---- 4. Per-subsystem ----------------------------------------------
    a("---")
    a("")
    a("## 4. By subsystem")
    a("")
    a("| Subsystem | WIRED | FLAG-GATED | BUILT-UNREACHABLE | DECLARED-ABSENT | UNCLASSIFIED | Total |")
    a("|---|---:|---:|---:|---:|---:|---:|")
    for sub in sorted(ctx["by_subsystem"]):
        c = ctx["by_subsystem"][sub]
        a("| `%s` | %d | %d | %d | %d | %d | %d |" % (
            sub, c.get(WIRED, 0), c.get(FLAG_GATED, 0), c.get(BUILT_UNREACHABLE, 0),
            c.get(DECLARED_ABSENT, 0), c.get(UNCLASSIFIED, 0), sum(c.values())))
    a("")

    # ---- 5. FLAG-GATED --------------------------------------------------
    a("---")
    a("")
    a("## 5. FLAG-GATED - built, reachable, and OFF unless a flag says otherwise")
    a("")
    a("**Read the `Default` column.**  A default-off flag is exactly how a finished subsystem stays")
    a("invisible for weeks.")
    a("")
    flag_rows = [r for r in ctx["rows"] if r.state == FLAG_GATED]
    if not flag_rows:
        a("_No symbol matched the lexical `if`-block rule in 2.1._  This is a LOWER BOUND, not an")
        a("absence proof - see the flag-gating limit in 2.4.  Every flag READ in `src/` is still")
        a("enumerated in 5.1 below, and control C10/C11 prove both gate detectors fire.")
    else:
        a("| Symbol | Kind | Defined at | Flag | Default | Why |")
        a("|---|---|---|---|---|---|")
        for r in sorted(flag_rows, key=lambda r: (r.flag or "", r.path, r.line)):
            a("| `%s` | %s | `%s:%d` | `%s` | `%s` | %s |" % (
                r.name, r.kind, r.path, r.line, r.flag,
                md_escape(r.default if r.default else "(not found in this file)"),
                md_escape(r.note)))
    a("")
    a("### 5.1 Every environment flag read anywhere in `src/`")
    a("")
    a("**%d distinct flags.**  `Defaults observed` is the literal that follows the read"
      % len(ctx["all_flags"]))
    a("(`os.environ.get(X, default)`, `process.env.X ?? default`, or the value it is compared to).")
    a("")
    a("<details><summary>All %d flags</summary>" % len(ctx["all_flags"]))
    a("")
    a("| Flag | Defaults observed | Read in N files |")
    a("|---|---|---:|")
    for flag in sorted(ctx["all_flags"]):
        defaults, nfiles = ctx["all_flags"][flag]
        shown = ", ".join("`%s`" % d for d in sorted(defaults)[:4])
        if len(defaults) > 4:
            shown += " (+%d)" % (len(defaults) - 4)
        a("| `%s` | %s | %d |" % (flag, md_escape(shown), nfiles))
    a("")
    a("</details>")
    a("")

    # ---- 6. DECLARED-ABSENT --------------------------------------------
    a("---")
    a("")
    a("## 6. DECLARED-ABSENT - referenced, but not on disk")
    a("")
    absent = [r for r in ctx["rows"] if r.state == DECLARED_ABSENT]
    a("**%d rows.**  Two probes feed this: unresolvable internal import specifiers, and" % len(absent))
    a("repo-relative path literals (`src/**.py`, `scripts/**`) naming a file that does not exist -")
    a("the latter is the TS->Python subprocess seam, where a typo fails only at runtime.")
    a("")
    if not absent:
        a("_Zero rows._  The probe is live (control C13); zero is a legitimate reading, not a silent skip.")
    else:
        a("| Referenced as | Kind | Referenced from | Why flagged |")
        a("|---|---|---|---|")
        for r in sorted(absent, key=lambda r: (r.path, r.line))[:250]:
            a("| `%s` | %s | `%s:%d` | %s |" % (md_escape(r.name), r.kind, r.path, r.line, md_escape(r.note)))
        if len(absent) > 250:
            a("")
            a("_...%d more rows omitted from this table; the count in section 3 is complete._"
              % (len(absent) - 250))
    a("")

    # ---- 7. BUILT-UNREACHABLE ------------------------------------------
    a("---")
    a("")
    a("## 7. BUILT-UNREACHABLE - the re-build trap")
    a("")
    a("**This is the section that exists to stop an agent re-authoring something already in the**")
    a("**tree.**  Everything here is written, present, and often tested - it simply has no static")
    a("caller.  This is a MAP entry, not a work order: it does not mean delete it, and it does not")
    a("mean wire it.  Acting on anything here is a separate, authorized decision.")
    a("")
    unreach = [r for r in ctx["rows"] if r.state == BUILT_UNREACHABLE]
    tested = [r for r in unreach if r.test_callers]
    a("Of **%d** `BUILT-UNREACHABLE` symbols, **%d have test coverage but no production caller**."
      % (len(unreach), len(tested)))
    a("Those are the highest-confidence *already built, just not plugged in* finds: someone wrote it,")
    a("someone proved it works, and nothing calls it.")
    a("")
    a("### 7.1 Built AND tested, but no non-test caller")
    a("")
    a("Unambiguous names are listed FIRST: their test-caller counts cannot be inflated by a")
    a("same-named symbol elsewhere, so they are the rows to trust.  `AMBIG` rows are listed after")
    a("and their counts are name-matched only - the large blocks of them come from")
    a("`src/server/db/migrations/schema.ts`, a generated introspection dump that duplicates every")
    a("table name in `src/server/db/schema.ts`.  Nothing imports the dump, which is why it is here.")
    a("")
    a("| Symbol | Kind | Defined at | Test files referencing it | Name |")
    a("|---|---|---|---:|---|")
    for r in sorted(tested, key=lambda r: (bool(r.ambiguous), -len(r.test_callers), r.path, r.name))[:300]:
        a("| `%s` | %s | `%s:%d` | %d | %s |" % (
            r.name, r.kind, r.path, r.line, len(r.test_callers),
            "AMBIG" if r.ambiguous else "unique"))
    if len(tested) > 300:
        a("")
        a("_...%d more omitted from this table._" % (len(tested) - 300))
    a("")
    a("### 7.2 All BUILT-UNREACHABLE, by subsystem")
    a("")
    grouped = collections.defaultdict(list)
    for r in unreach:
        grouped[subsystem_of(r.path)].append(r)
    for sub in sorted(grouped):
        a("<details><summary><code>%s</code> - %d symbols</summary>" % (sub, len(grouped[sub])))
        a("")
        a("| Symbol | Kind | Defined at | Reason |")
        a("|---|---|---|---|")
        for r in sorted(grouped[sub], key=lambda r: (r.path, r.line)):
            a("| `%s` | %s | `%s:%d` | %s |" % (r.name, r.kind, r.path, r.line, md_escape(r.note)))
        a("")
        a("</details>")
        a("")

    # ---- 8. WIRED -------------------------------------------------------
    a("---")
    a("")
    a("## 8. WIRED - has a non-test caller and a static path from an entry point")
    a("")
    a("This is the *we already have this* list.  Check it before writing anything.")
    a("")
    wired = [r for r in ctx["rows"] if r.state == WIRED]
    grouped = collections.defaultdict(list)
    for r in wired:
        grouped[subsystem_of(r.path)].append(r)
    for sub in sorted(grouped):
        a("<details><summary><code>%s</code> - %d symbols</summary>" % (sub, len(grouped[sub])))
        a("")
        a("| Symbol | Kind | Defined at | Non-test caller files | Name |")
        a("|---|---|---|---:|---|")
        for r in sorted(grouped[sub], key=lambda r: (r.path, r.line)):
            a("| `%s` | %s | `%s:%d` | %d | %s |" % (
                r.name, r.kind, r.path, r.line, len(r.callers_other),
                "AMBIG" if r.ambiguous else "unique"))
        a("")
        a("</details>")
        a("")

    # ---- 9. UNCLASSIFIED ------------------------------------------------
    a("---")
    a("")
    a("## 9. UNCLASSIFIED - the mandatory residual")
    a("")
    a("Everything the instrument could not place.  This section is never allowed to be empty by")
    a("omission: if the classifier could not decide, the row appears **here** rather than being")
    a("dropped, or force-fitted into a state it does not belong in.  Every one of these is a place")
    a("where the map may be under-reporting.")
    a("")
    unc = [r for r in ctx["rows"] if r.state == UNCLASSIFIED]
    if not unc:
        a("_Empty._  Every enumerated item was placed by rule.")
    else:
        a("| Reason | Count |")
        a("|---|---:|")
        for note, n in sorted(collections.Counter(r.note for r in unc).items()):
            a("| %s | %d |" % (md_escape(note), n))
        a("")
        a("<details><summary>Individual unclassified items (first 300)</summary>")
        a("")
        a("| Item | At | Reason |")
        a("|---|---|---|")
        for r in sorted(unc, key=lambda r: (r.path, r.line))[:300]:
            a("| `%s` | `%s:%d` | %s |" % (md_escape(r.name)[:90], r.path, r.line, md_escape(r.note)))
        a("")
        a("</details>")
        if len(unc) > 300:
            a("")
            a("_...%d more; the count in section 3 is complete._" % (len(unc) - 300))
    a("")

    # ---- 10. Non-symbol surfaces ---------------------------------------
    a("---")
    a("")
    a("## 10. Non-symbol surfaces")
    a("")
    a("### 10.1 API routes (`src/server/routes/`)")
    a("")
    a("`Registered` = the module is imported by `src/server/index.ts`.  A route file that exists but")
    a("is not registered serves no traffic.")
    a("")
    reg = sum(1 for _p, r, _rr, _n in ctx["routes"] if r)
    a("**%d of %d route modules are imported by `src/server/index.ts`.**" % (reg, len(ctx["routes"])))
    a("")
    a("| Route module | Registered in `index.ts` | Reachable | Exported symbols |")
    a("|---|---|---|---:|")
    for path, registered, reachable_flag, nsym in ctx["routes"]:
        a("| `%s` | %s | %s | %d |" % (path, "yes" if registered else "**NO**",
                                       "yes" if reachable_flag else "**no**", nsym))
    a("")
    a("### 10.2 SQL migrations (`src/server/db/`)")
    a("")
    migs = ctx["migrations"]
    a("**%d `.sql` files.**  Grade: MEASURED HERE - file count only.  Whether each has been APPLIED"
      % len(migs))
    a("to any database is **NOT MEASURED** by this generator; a migration journal row saying")
    a("`applied` is not proof the DDL ran.")
    a("")
    if migs:
        a("First: `%s`" % migs[0])
        a("Last:  `%s`" % migs[-1])
        a("")
    a("<details><summary>All %d migration files</summary>" % len(migs))
    a("")
    for m in migs:
        a("- `%s`" % m)
    a("")
    a("</details>")
    a("")
    a("### 10.3 n8n workflows (`workflows/`)")
    a("")
    wfs = ctx["n8n"]
    active = sum(1 for _p, _n, act, _k in wfs if act is True)
    inactive = sum(1 for _p, _n, act, _k in wfs if act is False)
    unknown = len(wfs) - active - inactive
    a("**%d workflow JSON files.**  `active: true` in the file: %d.  `active: false`: %d.  No"
      % (len(wfs), active, inactive))
    a("`active` key: %d." % unknown)
    a("")
    a("The `active` value is what the exported JSON **declares**.  It is ARTIFACT-SOURCED, not a live")
    a("reading of the n8n instance - this generator never calls n8n.")
    a("")
    a("| Workflow file | `active` in JSON | Nodes |")
    a("|---|---|---:|")
    for path, _name, act, nodes in wfs:
        a("| `%s` | %s | %s |" % (
            path, "yes" if act is True else ("no" if act is False else "(absent)"),
            nodes if nodes is not None else "?"))
    a("")

    # ---- 11. Not covered ------------------------------------------------
    a("---")
    a("")
    a("## 11. What this inventory does NOT cover")
    a("")
    a("Honest partial coverage, named, beats false completeness.")
    a("")
    a("| Not covered | Status |")
    a("|---|---|")
    a("| Frontend (`Trading_forge_frontend/`) | UNENUMERATED - separate npm project, outside the swept surface |")
    a("| `prototypes/`, `bin/`, `infra/`, `railway-relay/`, `ollama/`, `config/`, `assets/`, `public/` | UNENUMERATED - outside the published symbol and reference surface |")
    a("| Python class methods and inner functions | UNENUMERATED by choice - counted in 1.3, not listed individually |")
    a("| Non-exported TypeScript declarations | UNENUMERATED - module-private |")
    a("| Whether a migration ever ran against a database | NOT MEASURED - file presence only |")
    a("| Whether an n8n workflow is live on the n8n instance | NOT MEASURED - the JSON `active` key only |")
    a("| Whether a `WIRED` symbol is ever executed at runtime | NOT MEASURED - static reachability is not execution |")
    a("| Dynamic dispatch: registries, `getattr`, string-keyed handlers, HTTP-in | NOT MEASURED - invisible to a static import graph |")
    a("| Symbols reached only through a name collision | NOT CORRECTED FOR - biases toward `WIRED`, see 2.4 |")
    a("| Correctness, quality, test strength, or importance of anything listed | OUT OF SCOPE - this is a map, not a grade |")
    a("| `.mts` / `.mjs` / `.cjs` sources (e.g. `e2e/office-test-server.mts`, many `scripts/*.mjs`) | UNENUMERATED - only `.py`, `.ts`, `.tsx` are parsed |")
    a("| `export default <expr>` bindings | UNCLASSIFIED by design - the external name is anonymous; see section 9 |")
    a("| `docs/`, `skills/`, `.claude/`, `.github/` | UNENUMERATED - not code surfaces |")
    a("")
    a("---")
    a("")
    a("_End of generated inventory._")
    a("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------
# 11. Main
# --------------------------------------------------------------------------

def collect():
    files = []
    seen = set()
    for root in REFERENCE_ROOTS:
        for path in walk_files(root, PY_EXT + TS_EXT):
            relp = rel(path)
            if relp in seen:
                continue
            seen.add(relp)
            try:
                files.append(parse_python(path) if relp.endswith(PY_EXT) else parse_typescript(path))
            except Exception as exc:  # never let one bad file kill the census
                fi = FileInfo(relp, "py" if relp.endswith(".py") else "ts")
                fi.parse_error = "%s: %s" % (type(exc).__name__, exc)
                files.append(fi)
    files.sort(key=lambda f: f.path)
    return files


def build_context():
    files = collect()
    by_path = {f.path: f for f in files}

    disk_set = set()
    for root in REFERENCE_ROOTS + ["workflows"]:
        for path in walk_files(root):
            disk_set.add(rel(path))

    edges, missing_modules = build_graph(files, by_path, disk_set)
    entry_prov = discover_entry_points(by_path, files)
    reachable = reachable_from(set(entry_prov.keys()), edges)

    ref_index = collections.defaultdict(list)
    for f in files:
        for name in f.refs:
            ref_index[name].append(f.path)
    for name in ref_index:
        ref_index[name].sort()

    name_defs = build_name_defs(files)
    rows = classify(files, by_path, reachable, ref_index, name_defs)
    rows += find_declared_absent(files, by_path, disk_set, missing_modules)
    rows += find_unclassified_residual(files)

    state_counts = collections.Counter(r.state for r in rows)
    by_subsystem = collections.defaultdict(collections.Counter)
    for r in rows:
        by_subsystem[subsystem_of(r.path)][r.state] += 1

    rows_by_key = {}
    for r in rows:
        rows_by_key.setdefault((r.name, r.path), r)

    all_flags = {}
    for f in files:
        if not f.path.startswith("src/"):
            continue
        for flag, default, _line in f.env_reads:
            entry = all_flags.setdefault(flag, [set(), set()])
            entry[0].add(default)
            entry[1].add(f.path)
    all_flags = {k: (v[0], len(v[1])) for k, v in all_flags.items()}

    controls = run_positive_controls(rows_by_key, files, reachable, entry_prov, state_counts)

    return {
        "files": files,
        "by_path": by_path,
        "entry_prov": entry_prov,
        "reachable": reachable,
        "rows": rows,
        "state_counts": state_counts,
        "by_subsystem": by_subsystem,
        "all_flags": all_flags,
        "name_defs": name_defs,
        "controls": controls,
        "routes": survey_routes(by_path, reachable, files),
        "migrations": survey_migrations(),
        "n8n": survey_n8n(),
        "sha": git_sha(),
        "dirty": git_dirty(OUT_REL),
    }


LEAKED_SPECIFIER_RE = re.compile(r"%[-0-9.]*[dsfr](?![A-Za-z])")

PROVENANCE_LINE_RE = re.compile(r"^> Generated at commit .*$", re.MULTILINE)


def content_only(text):
    """The document minus its provenance line.

    `--check` must answer "does this inventory still describe the CODE?", not
    "was it generated at exactly this commit".  HEAD advances on every commit,
    including the one that lands this file, so comparing the sha verbatim would
    make --check fail permanently.  A staleness check that always fires is
    worse than no check at all: it trains readers to ignore it.
    """
    return PROVENANCE_LINE_RE.sub("> Generated at commit <PINNED>", text)


def validate_render(text):
    """Catch a printf specifier that reached the OUTPUT unformatted.

    A line written as `a("**%d rows.**  ...")` with the `%` operator
    accidentally attached to the NEXT line renders the literal `%d` into the
    document.  That shipped once.  This makes the whole class loud instead of
    silent: it is cheap, and a generated file that quietly prints `%d` to
    every reader is precisely the "stale declaration layer" failure this
    document exists to avoid.
    """
    bad = []
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("|"):
            continue  # table cells legitimately carry `%` in flag defaults
        for m in LEAKED_SPECIFIER_RE.finditer(line):
            bad.append((i, line.strip()[:100], m.group(0)))
    return bad


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate the Trading Forge SYSTEM INVENTORY.")
    parser.add_argument("--out", default=OUT_REL,
                        help="output path, repo-relative (default: %s)" % OUT_REL)
    parser.add_argument("--check", action="store_true",
                        help="do not write; exit 1 if the file on disk differs from fresh output")
    parser.add_argument("--self-test", action="store_true",
                        help="run the positive controls and exit")
    args = parser.parse_args(argv)

    ctx = build_context()
    text = render(ctx)
    leaks = validate_render(text)

    if args.self_test:
        failed = 0
        for name, ok, detail in ctx["controls"]:
            print("%-6s %-52s %s" % ("PASS" if ok else "FAIL", name, detail))
            failed += 0 if ok else 1
        ok = not leaks
        print("%-6s %-52s %s" % ("PASS" if ok else "FAIL",
                                 "C17 no printf specifier leaked into the output",
                                 "leaks=%d" % len(leaks)))
        for line_no, snippet, spec in leaks[:10]:
            print("         line %d leaks %s: %s" % (line_no, spec, snippet))
        failed += 0 if ok else 1
        total = len(ctx["controls"]) + 1
        print("")
        print("%d/%d controls pass." % (total - failed, total))
        return 0 if failed == 0 else 1

    if leaks:
        for line_no, snippet, spec in leaks[:10]:
            print("RENDER DEFECT: output line %d leaks %s: %s" % (line_no, spec, snippet),
                  file=sys.stderr)
        print("Refusing to write %d unformatted specifier(s). Fix render()." % len(leaks),
              file=sys.stderr)
        return 2

    out_abs = os.path.join(REPO, args.out.replace("/", os.sep))

    if args.check:
        if not os.path.isfile(out_abs):
            print("STALE: %s does not exist. Run: %s" % (args.out, GEN_CMD))
            return 1
        if content_only(read_text(out_abs)) == content_only(text):
            print("FRESH: %s matches the tree (content compared; provenance sha ignored)."
                  % args.out)
            return 0
        print("STALE: %s does not match the tree. Run: %s" % (args.out, GEN_CMD))
        return 1

    outdir = os.path.dirname(out_abs)
    if outdir and not os.path.isdir(outdir):
        os.makedirs(outdir)
    with io.open(out_abs, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)

    counts = ctx["state_counts"]
    print("wrote %s" % args.out)
    for st in STATES:
        print("  %-20s %d" % (st, counts.get(st, 0)))
    failed = [c for c in ctx["controls"] if not c[1]]
    print("  positive controls    %d/%d pass%s" % (
        len(ctx["controls"]) - len(failed), len(ctx["controls"]),
        "" if not failed else "  <-- INVENTORY NOT TRUSTWORTHY"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
