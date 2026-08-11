"""RATIFY-1 obligation [J], on the REAL governed fixtures (R-822 §9[5]).

The throwaway arm proved the DESIGN discriminates. This proves it on the actual
`9` non-function-scoped fixtures `R-820 §3` measured as exposed. Independently
re-derived here rather than taken on relay:

    src/engine/conftest.py                          2  (session; R-819 §4 cleared,
                                                        but still exposed to Layer 2)
    src/engine/tests/test_audit_a12.py              1  (module, autouse)
    src/engine/tests/test_cross_engine_parity.py    4  (module)
    src/engine/tests/test_session_windows_parity.py 1  (module)
    src/engine/tests/test_wave28_pass_a_migration_0149.py 1 (class)

THREE ARMS PER FILE, compared BY EXACT NODE ID:
    no Layer 2                 baseline
    Layer 2 ownership-aware    MUST be identical to baseline -- the boundary may
                               not change any governed outcome
    Layer 2 ownership-blind    the NEGATIVE control. If it does not differ on ANY
                               file, then on real fixtures the blind boundary is
                               indistinguishable from the aware one HERE, and that
                               is REPORTED, not glossed -- a control that does not
                               discriminate proves nothing about the thing it was
                               built to catch.

R-822 §2: use the real fixtures if they exercise it naturally. No synthetic
campaign, and no governed file is modified by this control.
"""

import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import accept5_isolated_runner as R          # noqa: E402

FILES = [
    "src/engine/tests/test_audit_a12.py",
    "src/engine/tests/test_cross_engine_parity.py",
    "src/engine/tests/test_session_windows_parity.py",
    "src/engine/tests/test_wave28_pass_a_migration_0149.py",
]


def diff(a, b):
    keys = sorted(set(a) | set(b))
    return [(k, a.get(k, "<absent>"), b.get(k, "<absent>")) for k in keys
            if a.get(k) != b.get(k)]


root = Path(tempfile.mkdtemp(prefix="ratify1-J-"))
aware_ok, blind_diffs, rows = True, 0, []
try:
    for i, f in enumerate(FILES):
        base = R.run_child(f, [f], root / f"{i}_base", layer2=False)
        aware = R.run_child(f, [f], root / f"{i}_aware", layer2=True)
        blind = R.run_child(f, [f], root / f"{i}_blind", layer2=True, blind=True)

        for name, r in (("baseline", base), ("aware", aware)):
            if r["problems"]:
                print(f"  !! {name} child invalid for {f}: {r['problems']}")

        d_aware = diff(base["outcomes"], aware["outcomes"])
        d_blind = diff(base["outcomes"], blind["outcomes"])
        rows.append((f, len(base["outcomes"]), len(d_aware), len(d_blind),
                     bool(blind["problems"])))
        if d_aware:
            aware_ok = False
            print(f"  *** OWNERSHIP-AWARE CHANGED OUTCOMES in {f}:")
            for k, x, y in d_aware[:5]:
                print(f"        {k.split('::',1)[-1]:55s} base={x} aware={y}")
        if d_blind or blind["problems"]:
            blind_diffs += 1

    print()
    print(f"{'file':52s} {'nodes':>6s} {'aware':>6s} {'blind':>6s} {'blind_invalid':>14s}")
    for f, n, da, db, bi in rows:
        print(f"{f.split('/')[-1]:52s} {n:6d} {da:6d} {db:6d} {str(bi):>14s}")

    print()
    print("=== [J] VERDICT ON REAL FIXTURES ===")
    print(f"  ownership-aware changed NO governed outcome : "
          f"{'OK' if aware_ok else '*** VIOLATED ***'}")
    print(f"  ownership-blind differed on {blind_diffs}/{len(FILES)} files       : "
          f"{'DISCRIMINATES' if blind_diffs else 'DOES NOT DISCRIMINATE HERE'}")
    if not blind_diffs:
        print("  -> REPORTED, NOT GLOSSED: on these real files the blind boundary is")
        print("     indistinguishable from the aware one. The design-level conviction")
        print("     stands on the throwaway arm; it is NOT reproduced on governed code.")
finally:
    shutil.rmtree(root, ignore_errors=True)

# Only the aware arm is a PASS/FAIL obligation. The blind arm's discrimination is
# reported either way -- claiming it discriminated when it did not would be the
# exact false-control shape this campaign convicts.
raise SystemExit(0 if aware_ok else 1)
