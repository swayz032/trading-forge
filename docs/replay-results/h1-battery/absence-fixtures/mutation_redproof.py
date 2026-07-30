"""RED-PROOF for AR-478's output-boundary assertions (R-477 §3).

Mutates the SHIPPED source text in memory and runs its own --self-test. __file__ is
set to the real path so the fixture tree resolves; nothing on disk is modified.

A mutation is evidence only if it BITES. The UNMUTATED control must go GREEN in the
same harness, or the harness is 'always red' and proves nothing.
"""
import contextlib
import io
import pathlib
import sys
import types

SRC = pathlib.Path(sys.argv[1]).resolve()
src = SRC.read_text(encoding="utf-8")

# (name, anchor, replacement, which fixture must catch it)
MUTATIONS = [
    ("restore the unreadable[:8] head-slice",
     "for pp, why in unreadable:", "for pp, why in unreadable[:8]:", "F-5"),
    ("stop printing the DENIED BY path",
     'print(f"  DENIED BY: {pp}")', 'print("  DENIED BY: <withheld>")', "F-4 A / F-5"),
    ("stop emitting the EXCLUDED path",
     'print(f"  EXCLUDED    {dp}")', 'print("  EXCLUDED    <withheld>")', "F-4 B"),
    ("drop MINUS from the certified proposition",
     "surface MINUS the ", "surface including the ", "F-4 B"),
]


def run(source: str) -> tuple[int, str]:
    mod = types.ModuleType("mut")
    mod.__file__ = str(SRC)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(compile(source, str(SRC), "exec"), mod.__dict__)
        rc = mod.self_test()
    return rc, buf.getvalue()


print("=" * 74)
ctrl_rc, ctrl_out = run(src)
print(f"CONTROL (unmutated)                          -> exit {ctrl_rc}   "
      f"{'GREEN (as required)' if ctrl_rc == 0 else '*** HARNESS BROKEN ***'}")
if ctrl_rc != 0:
    print("The control did not pass, so no mutation result below means anything.")
    print([ln for ln in ctrl_out.splitlines() if "FAIL" in ln])
    raise SystemExit(1)

print("-" * 74)
bad = 0
for name, anchor, repl, catcher in MUTATIONS:
    if anchor not in src:
        print(f"*** ANCHOR MISSING, mutation never applied: {name!r} ***")
        bad += 1
        continue
    rc, out = run(src.replace(anchor, repl, 1))
    caught = [ln.strip() for ln in out.splitlines() if ln.startswith("[FAIL]")]
    verdict = "RED (caught)" if rc != 0 else "*** GREEN -- MUTATION SURVIVED ***"
    if rc == 0:
        bad += 1
    print(f"{name:<44} -> exit {rc}   {verdict}")
    print(f"    expected catcher: {catcher}")
    for ln in caught:
        print(f"    caught by: {ln}")
print("=" * 74)
print("ALL MUTATIONS BIT" if bad == 0 else f"{bad} MUTATION(S) DID NOT BITE")
raise SystemExit(1 if bad else 0)
