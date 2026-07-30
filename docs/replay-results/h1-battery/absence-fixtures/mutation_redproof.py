"""RED-PROOF for the absence-claim guard's output-boundary assertions.

Mutates the SHIPPED source text in memory and runs its own --self-test. `__file__` is
pinned to the real path so the fixture tree resolves; nothing on disk is modified.

A mutation is evidence only if it BITES. The UNMUTATED control must go GREEN in the
same harness, or the harness is 'always red' and proves nothing.

★★★★★ THIS HARNESS WAS ITSELF CONVICTED TWICE (R-478 §2), and both defects were
  things it PRINTED rather than things it ENFORCED:
    1. it printed a pre-named `catcher` and never compared it, so a mutation caught
       by an UNRELATED fixture still scored as caught. AR-479 advertised that as
       "a red-proof WITH ATTRIBUTION". It was attribution in the OUTPUT only.
           `PRINTING IS NOT ENFORCING.`
    2. it checked `anchor not in src` -- PRESENCE, not UNIQUENESS -- so a duplicated
       anchor produced a PARTIAL mutation scored as fully applied.
  Both are enforced below: the catcher set must match EXACTLY, and every anchor must
  occur EXACTLY ONCE or the harness fails.

★★★ AND THE MUTATION THAT EXISTS BECAUSE THE SUITE MISSED IT: 'duplicate every
  rendered denial line'. The verdict went 11 lines -> 22 while the fixture still
  read 11, because it compared a UNIQUE-IDENTITY SET to a COUNT.
      `A UNIQUE-IDENTITY SET IS NOT AN OUTPUT COUNT.`
"""
import contextlib
import io
import pathlib
import sys
import types

SRC = pathlib.Path(sys.argv[1]).resolve()
src = SRC.read_text(encoding="utf-8")

# (name, anchor, replacement, PRE-REGISTERED catcher set -- ENFORCED, not printed)
MUTATIONS = [
    ("restore the unreadable[:8] head-slice",
     "for pp, why in unreadable:",
     "for pp, why in unreadable[:8]:",
     frozenset({"F-5"})),
    ("stop printing the DENIED BY path",
     'print(f"  DENIED BY: {pp}")',
     'print("  DENIED BY: <withheld>")',
     frozenset({"F-4 A", "F-5"})),
    ("stop emitting the EXCLUDED path",
     'print(f"  EXCLUDED    {dp}")',
     'print("  EXCLUDED    <withheld>")',
     frozenset({"F-4 B"})),
    ("drop MINUS from the certified proposition",
     "surface MINUS the ",
     "surface including the ",
     frozenset({"F-4 B"})),
    # R-478 §5a-3: the shape the previous round could not see.
    ("duplicate every rendered DENIED BY line",
     'print(f"  DENIED BY: {pp}")',
     'print(f"  DENIED BY: {pp}"); print(f"  DENIED BY: {pp}")',
     frozenset({"F-5"})),
]


def run(source: str) -> tuple[int, str]:
    """Exec the (possibly mutated) source as a module and run its self-test."""
    mod = types.ModuleType("mut")
    mod.__file__ = str(SRC)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(compile(source, str(SRC), "exec"), mod.__dict__)
        rc = mod.self_test()
    return rc, buf.getvalue()


def caught_keys(out: str) -> frozenset[str]:
    """Which fixtures actually went RED, keyed by their short label prefix.
    This is the value the harness now FAILS on when it differs from expectation."""
    keys = set()
    for ln in out.splitlines():
        if ln.startswith("[FAIL]"):
            keys.add(ln[len("[FAIL]"):].strip().split(":", 1)[0].strip())
    return frozenset(keys)


print("=" * 74)
ctrl_rc, ctrl_out = run(src)
print(f"CONTROL (unmutated)  -> exit {ctrl_rc}   "
      f"{'GREEN, as required' if ctrl_rc == 0 else '*** HARNESS BROKEN ***'}")
if ctrl_rc != 0:
    print("The control did not pass, so NO mutation result below means anything.")
    for ln in ctrl_out.splitlines():
        if ln.startswith("[FAIL]"):
            print(f"  {ln}")
    raise SystemExit(1)

print("-" * 74)
bad = 0
for name, anchor, repl, expected in MUTATIONS:
    # ANCHOR UNIQUENESS (R-478 §5a-5): presence is not enough. A second occurrence
    # makes `replace(..., 1)` a PARTIAL mutation that would score as applied.
    occurrences = src.count(anchor)
    if occurrences != 1:
        print(f"[HARNESS FAIL] {name}")
        print(f"    anchor occurs {occurrences} times, must be EXACTLY 1 -- not scored")
        bad += 1
        continue

    rc, out = run(src.replace(anchor, repl, 1))
    actual = caught_keys(out)
    survived = rc == 0
    mismatch = actual != expected
    ok = not survived and not mismatch

    print(f"[{'OK  ' if ok else 'FAIL'}] {name}")
    print(f"    suite exit {rc}   "
          f"-> {'RED (caught)' if rc else '*** GREEN, MUTATION SURVIVED ***'}")
    print(f"    catchers pre-registered {sorted(expected)}  actual {sorted(actual)}"
          f"{'' if not mismatch else '   *** MISMATCH ***'}")
    if survived or mismatch:
        bad += 1

print("=" * 74)
if bad:
    print(f"RED-PROOF FAILED -- {bad} mutation(s) survived, mis-attributed, or unscored.")
else:
    print(f"RED-PROOF PASSED -- all {len(MUTATIONS)} mutations bit, each caught by exactly")
    print("its pre-registered fixture set, every anchor unique, control GREEN.")
    print("★ This proves these five renderer regressions are caught. It says NOTHING")
    print("  about a shape nobody has named yet -- which is how the last three rounds")
    print("  each ended.")
print("=" * 74)
raise SystemExit(1 if bad else 0)
