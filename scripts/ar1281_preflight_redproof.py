#!/usr/bin/env python3
"""RED-PROOF for the AR-1281 pre-spend gate (AR-1280A §4.A "Any mismatch => STOP before spend").

Each mutation must make `preflight()` REFUSE (SystemExit 2). A gate that stays green under a
corrupted pin would let a wrong-source judgment be paid for -- the exact failure the ruling's
verify-before-spend clause exists to prevent.

Includes the UNMUTATED CONTROL: without it, "always red" is indistinguishable from
"correctly catches breakage" (worker-execution §5: a control must discriminate).

Runs entirely in-process and mutates NO repository file. Spends nothing.
    python scripts/ar1281_preflight_redproof.py
"""
from __future__ import annotations

import contextlib
import io
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import ar1281_svkm_conflation_once as M  # noqa: E402

CASES = [
    ("transcript sha pin corrupted", "TRANSCRIPT_SHA", "0" * 64),
    ("extraction sha pin corrupted", "EXTRACTION_SHA", "0" * 64),
    ("strategy name pin corrupted", "STRATEGY_NAME", "not_the_pinned_strategy"),
    ("grader blob pin corrupted", "GRADER_BLOB", "0" * 40),
    ("strategy_index out of range", "STRATEGY_INDEX", 99),
    (
        "calibration polarity flipped",
        "CALIBRATION",
        {"CAL_R5L890_FUSED": "PASS", "-igpOZs8LsM__s0": "REJECT"},
    ),
]


def main() -> int:
    print("=== CONTROL: unmutated gate must PASS ===")
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            M.preflight()
        print("  CONTROL: PASSED (green when pins intact)  <- gate discriminates")
        control_ok = True
    except SystemExit as e:
        print(f"  CONTROL: REFUSED unexpectedly (exit {e.code}) -- always-red gate is USELESS")
        control_ok = False

    print("\n=== MUTATIONS: each must REFUSE ===")
    bites = 0
    for label, attr, bad in CASES:
        orig = getattr(M, attr)
        setattr(M, attr, bad)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                M.preflight()
            print(f"  [ ] {label:<32} NOT CAUGHT  <-- GATE IS BLIND")
        except SystemExit as e:
            reason = ""
            for line in buf.getvalue().splitlines():
                if line.strip().startswith("!!"):
                    reason = line.strip()[3:].strip()
                    break
            print(f"  [x] {label:<32} REFUSED exit={e.code}  ({reason[:64]})")
            bites += 1
        finally:
            setattr(M, attr, orig)

    ok = control_ok and bites == len(CASES)
    print(f"\nRESULT: control={'PASS' if control_ok else 'FAIL'} | caught {bites}/{len(CASES)}")
    print("RED-PROOF " + ("PASSES" if ok else "FAILS"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
