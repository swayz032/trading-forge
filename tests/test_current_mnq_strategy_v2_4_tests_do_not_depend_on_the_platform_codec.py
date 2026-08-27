"""No test in the MNQ v2.4 lane may read text with the platform default codec.

FIVE TESTS IN THIS LANE WERE RED ALL DAY FOR THIS REASON and I had been reporting them as
"pre-existing, same 12" without opening them. They were not asserting anything: on Windows,
`open(path)` decodes as cp1252, so a UTF-8 file with an arrow or an em-dash raised
`UnicodeDecodeError` -- or worse, decoded into mojibake and failed a string comparison for a
reason that had nothing to do with what the test was checking. Adding `encoding="utf-8"` turned
all five green with no change to a single assertion. They had never once run to completion here.

    A TEST THAT CANNOT PASS ON THIS MACHINE GUARDS NOTHING, and "same failure count as before"
    is a comparison, not an exoneration.

Binary reads are exempt and must stay exempt: `open(p, "rb")` takes no encoding and adding one
raises ValueError.
"""
from __future__ import annotations

import ast
import io
from pathlib import Path

LANE = sorted(Path("tests").glob("test_current_mnq_strategy_v2_4_*.py"))


def unencoded_text_reads(path: Path) -> list[int]:
    """Lines with open()/read_text() that take no encoding and are not binary mode.

    THE MODE IS POSITIONAL ARGUMENT 1. Slice to args[1:2] and THEN filter to string constants.
    Filtering to string constants FIRST and slicing after is wrong and silently disables the
    binary exemption -- for `open(path, "rb")` the filtered list is `["rb"]`, so `[1:2]` is
    empty, no mode is seen, and eight legitimate binary reads get reported as defects. I wrote
    it that way while auditing this very class and nearly "fixed" all eight into ValueErrors.
    """
    hits: list[int] = []
    for n in ast.walk(ast.parse(io.open(path, encoding="utf-8").read())):
        if not isinstance(n, ast.Call):
            continue
        f = n.func
        name = f.id if isinstance(f, ast.Name) else getattr(f, "attr", None)
        if name not in ("open", "read_text"):
            continue
        if "encoding" in {k.arg for k in n.keywords}:
            continue
        modes = [a.value for a in n.args[1:2]
                 if isinstance(a, ast.Constant) and isinstance(a.value, str)]
        if any("b" in m for m in modes):
            continue
        hits.append(n.lineno)
    return hits


def test_the_lane_is_not_empty():
    """A guard over an empty population is a green check with no path to red."""
    assert len(LANE) >= 20, f"only {len(LANE)} v2.4 test files found - is the glob right?"


def test_no_v24_test_reads_text_with_the_platform_default_codec():
    offenders = {p.name: unencoded_text_reads(p) for p in LANE}
    offenders = {k: v for k, v in offenders.items() if v}
    assert not offenders, (
        "these read text with the platform codec and will decode as cp1252 on Windows:\n"
        + "\n".join(f"  {k}: lines {v}" for k, v in offenders.items())
        + "\nAdd encoding=\"utf-8\". Do NOT add it to a binary read."
    )


def test_the_binary_exemption_actually_exempts(tmp_path):
    """POSITIVE WITNESS both ways, on a synthetic file, so the guard is proven to discriminate.

    Without this, the guard above could be passing because it never fires at all.
    """
    p = tmp_path / "probe.py"
    p.write_text(
        'import io\n'
        'a = open("x", "rb").read()\n'          # exempt - binary
        'b = io.open("x", "wb")\n'              # exempt - binary
        'c = open("x", encoding="utf-8")\n'     # exempt - declared
        'd = open("x")\n'                       # OFFENDER, line 5
        'e = open("x", "r")\n'                  # OFFENDER, line 6
        'f = P.read_text()\n',                  # OFFENDER, line 7
        encoding="utf-8")
    assert unencoded_text_reads(p) == [5, 6, 7]


def test_the_buggy_filter_order_is_not_used_here():
    """The trap that produced eight false positives. Pin it so nobody re-introduces it."""
    src = io.open(__file__, encoding="utf-8").read()
    body = src.split("def unencoded_text_reads")[1].split("def test_")[0]
    assert "n.args[1:2]" in body, "the mode must be taken positionally, before filtering"
    assert "for a in n.args if isinstance" not in body, (
        "filtering the whole arg list before slicing disables the binary exemption")
