"""RATIFY-1 obligation [E] — Layer 1's proof that the process wall contains
COLLECTION-TIME pollution.

R-822 §5 is explicit: use the contamination that already hurt us, do not fake a
new one. `[MEASURED, AR-975]` `test_black_swan_evaluator.py:36` does
`sys.modules.setdefault("vectorbt", _vbt_mock)` two lines above a column-0
`from src.engine.black_swan_evaluator import ...`, so the fake is installed and
the production module imported UNDER it -- during COLLECTION, before any fixture
of any scope exists. In one shared interpreter every test collected afterwards
sees it.

THE ARMS
    NEGATIVE CONTROL (the disease)  both files in ONE pytest process, canonical
                                    order. The PnL node outcome map must DIFFER
                                    from PnL-alone -- otherwise there is nothing
                                    for isolation to fix and every green below is
                                    vacuous.
    ISOLATED, forward               black_swan child THEN PnL child
    ISOLATED, reverse               PnL child THEN black_swan child
    Both isolated arms must produce a PnL node outcome map IDENTICAL to PnL alone,
    compared BY EXACT NODE ID -- never by counts.

`STOP [37]`: the oracle is node-outcome identity under reordering. It is NOT
agreement with the old `31`, and nothing here is tuned toward that number.
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import accept5_isolated_runner as R          # noqa: E402

BLACK_SWAN = "src/engine/tests/test_black_swan_evaluator.py"
PNL = "src/engine/tests/test_pnl_accuracy.py"


def pnl_map(receipt_or_outcomes):
    """Restrict a node-outcome map to the PnL file's nodes."""
    outcomes = (receipt_or_outcomes["outcomes"]
                if isinstance(receipt_or_outcomes, dict) and "outcomes" in receipt_or_outcomes
                else receipt_or_outcomes)
    return {n: o for n, o in outcomes.items() if n.split("::")[0] == PNL}


def diff(a, b):
    keys = sorted(set(a) | set(b))
    return [(k, a.get(k, "<absent>"), b.get(k, "<absent>")) for k in keys
            if a.get(k) != b.get(k)]


root = Path(tempfile.mkdtemp(prefix="ratify1-E-"))
verdicts = []
try:
    print("=== BASELINE: PnL ALONE, in its own child ===")
    alone = R.run_child(PNL, [PNL], root / "alone")
    assert not alone["problems"], f"baseline child invalid: {alone['problems']}"
    base = pnl_map(alone)
    print(f"  PnL nodes: {len(base)}  (positive witness that the child really ran)")
    assert base, "baseline produced NO PnL nodes -- the control is vacuous"

    print()
    print("=== NEGATIVE CONTROL: both files in ONE process (the shared-interpreter disease) ===")
    shared = R.run_child("SHARED-INTERPRETER", [BLACK_SWAN, PNL], root / "shared",
                         layer2=False)
    shared_pnl = pnl_map(shared)
    d = diff(base, shared_pnl)
    print(f"  PnL nodes: {len(shared_pnl)}   differences vs PnL-alone: {len(d)}")
    for k, x, y in d[:6]:
        print(f"    {k.split('::',1)[-1]:60s} alone={x:8s} in-company={y}")
    contaminates = len(d) > 0
    verdicts.append(("negative control DISCRIMINATES", contaminates))
    if not contaminates:
        print("  *** the contamination did NOT reproduce -- every isolated green below")
        print("      would be vacuous, because there is nothing to contain ***")

    print()
    print("=== ISOLATED, FORWARD: black_swan child THEN PnL child ===")
    R.run_child(BLACK_SWAN, [BLACK_SWAN], root / "fwd_bs")
    fwd = R.run_child(PNL, [PNL], root / "fwd_pnl")
    assert not fwd["problems"], f"forward PnL child invalid: {fwd['problems']}"
    dfwd = diff(base, pnl_map(fwd))
    print(f"  differences vs PnL-alone: {len(dfwd)}")
    for k, x, y in dfwd[:6]:
        print(f"    {k.split('::',1)[-1]:60s} alone={x:8s} isolated={y}")
    verdicts.append(("forward order identical", not dfwd))

    print()
    print("=== ISOLATED, REVERSE: PnL child THEN black_swan child ===")
    rev = R.run_child(PNL, [PNL], root / "rev_pnl")
    R.run_child(BLACK_SWAN, [BLACK_SWAN], root / "rev_bs")
    assert not rev["problems"], f"reverse PnL child invalid: {rev['problems']}"
    drev = diff(base, pnl_map(rev))
    print(f"  differences vs PnL-alone: {len(drev)}")
    for k, x, y in drev[:6]:
        print(f"    {k.split('::',1)[-1]:60s} alone={x:8s} isolated={y}")
    verdicts.append(("reverse order identical", not drev))

    print()
    print("=== [E] VERDICT ===")
    for name, ok in verdicts:
        print(f"  {name:34s} {'OK' if ok else '*** FAILED ***'}")
    allok = all(v for _, v in verdicts)
    print("PROCESS WALL CONTAINS THE CONTAMINATION" if allok
          else "*** [E] NOT SATISFIED -- STOP, do not fix-until-green ***")
finally:
    shutil.rmtree(root, ignore_errors=True)

raise SystemExit(0 if all(v for _, v in verdicts) else 1)
