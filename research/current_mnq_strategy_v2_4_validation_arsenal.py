#!/usr/bin/env python3
"""What validation tooling exists, what each does in plain English, and how to run it.

ALGO-029 item 5: "assess the in-family prior art and deliver run-only invocations + plain-English
readouts, so the post-FREEZE clean-edge/robustness ladder is executable by the operator with GPT
reading the outputs. **No new arsenal is authored; reuse and document.**"

**NO NEW ARSENAL IS AUTHORED HERE.** This module computes no metric, fits nothing and decides
nothing. It is an inventory with an invocation guide.

TWO FINDINGS FROM THE ASSESSMENT, both of which change what item 5 actually is:

  1. **THE ARSENAL IS LIBRARIES, NOT COMMANDS.** Of the validation family, only one module has
     an entry point. Everything else is importable functions with no `__main__`. So "runnable by
     a single command" was never a documentation job — the entry points do not exist. That is the
     same shape as the runbook's finding that there is no "start the bot" command, and it is
     recorded rather than papered over.

  2. **MOST OF IT IS GATED, AND SOME OF IT READS OUTCOMES.** `run_sealed` and
     `build_edge_certificate` are CLEAN-EDGE instruments: they read realized results. The ladder
     puts clean edge AFTER freeze, and the standing rail is that no PnL may pick a rule.
     **This module therefore DOCUMENTS them and does not invoke them.** A test enforces that.

WHAT THE OPERATOR AND GPT GET: for each tool, what question it answers in his words, what it
needs, whether it can be run today, and which rung of the ladder authorizes it.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_validation_arsenal
"""
from __future__ import annotations

import ast
import io
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. An inventory and invocation guide. Computes no metric, fits nothing, "
    "runs no clean-edge instrument. ALGO-029 item 5 - reuse and document, author nothing."
)

RESEARCH = Path("research")

#: Ladder rungs, in order. A tool may not be run before its rung is reached.
LADDER = ("FIDELITY", "FREEZE", "CLEAN_EDGE", "PROP_SURVIVAL")

#: Tools that read realized outcomes. Documented, never invoked from here.
READS_OUTCOMES = frozenset({
    "current_mnq_strategy_v2_4_edge",
    "current_mnq_strategy_v2_4_oos",
    "current_mnq_strategy_v2_2_risk_metrics",
})

ARSENAL = {
    "current_mnq_strategy_v2_4_oos": {
        "answers": "Does the strategy still work on data it has never been tuned against?",
        "entry_points": ["run_sealed(dataset_root, out_dir)",
                         "audit_clean_historical_scope(manifest, edge_spec)"],
        "needs": "a pinned clean dataset and an output directory",
        "rung": "CLEAN_EDGE",
        "runnable_today": False,
        "why_not": "clean edge comes after FREEZE, and this reads realized outcomes",
    },
    "current_mnq_strategy_v2_4_edge": {
        "answers": "Is the edge real enough to certify, or is it noise?",
        "entry_points": ["load_edge_spec()", "build_edge_certificate()"],
        "needs": "a completed sealed run",
        "rung": "CLEAN_EDGE",
        "runnable_today": False,
        "why_not": "depends on a sealed run that has not happened; reads realized outcomes",
    },
    "current_mnq_strategy_v2_2_risk_metrics": {
        "answers": "How far underwater did trades go before they worked? (MAE and drawdown)",
        "entry_points": ["ledger_mae(ledger, one)", "mae_aware_drawdown(ledger, one)"],
        "needs": "a trade ledger plus 1-minute bars covering it",
        "rung": "CLEAN_EDGE",
        "runnable_today": False,
        "why_not": "reads realized outcomes; and the 2025 ledger is disjoint from the 2026 "
                   "corpus, so there is nothing valid to join it to today",
    },
    "current_mnq_strategy_v2_3_topstep_risk": {
        "answers": "How many contracts can I take without breaking a Topstep rule?",
        "entry_points": ["worst_case_loss_per_contract(stop_points, slippage_points)",
                         "survival_safe_qty(desired_qty, envelope)"],
        "needs": "the stop distance and a risk envelope - NO outcome data",
        "rung": "PROP_SURVIVAL",
        "runnable_today": True,
        "why_not": None,
    },
    "current_mnq_strategy_v2_4_ledger_corpus_join": {
        "answers": "Can my trade ledger be matched to the replay sessions at all?",
        "entry_points": ["python -m research.current_mnq_strategy_v2_4_ledger_corpus_join"],
        "needs": "nothing - it reads dates and refuses if the sets are disjoint",
        "rung": "FIDELITY",
        "runnable_today": True,
        "why_not": None,
    },
}


def _has_main(stem: str) -> bool:
    p = RESEARCH / f"{stem}.py"
    if not p.exists():
        return False
    return '__name__ == "__main__"' in io.open(p, encoding="utf-8").read()


def _public_functions(stem: str) -> list[str]:
    p = RESEARCH / f"{stem}.py"
    if not p.exists():
        return []
    tree = ast.parse(io.open(p, encoding="utf-8").read())
    return [n.name for n in tree.body
            if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")]


def assess() -> dict:
    rows = []
    for stem, meta in ARSENAL.items():
        exists = (RESEARCH / f"{stem}.py").exists()
        rows.append({
            "module": stem,
            "exists": exists,
            "has_entry_point": _has_main(stem),
            "public_functions": _public_functions(stem),
            "reads_realized_outcomes": stem in READS_OUTCOMES,
            **meta,
        })
    missing = [r["module"] for r in rows if not r["exists"]]
    return {
        "status": DIAGNOSTIC_ONLY,
        "ladder": list(LADDER),
        "tools": len(rows),
        "runnable_today": sum(1 for r in rows if r["runnable_today"]),
        "with_an_entry_point": sum(1 for r in rows if r["has_entry_point"]),
        "read_realized_outcomes": sorted(READS_OUTCOMES),
        "missing_modules": missing,
        "FINDING_no_entry_points": (
            "the validation family is LIBRARIES, not commands - only one module has a "
            "`__main__`. 'Runnable by a single command' was never a documentation job; the "
            "entry points do not exist. Same shape as the runbook's no-start-command finding."),
        "FINDING_gating": (
            "most of the arsenal sits on the CLEAN_EDGE rung, which comes AFTER freeze, and "
            "several tools read realized outcomes. This module documents them and does not "
            "invoke them - the standing rail is that no PnL may pick a rule."),
        "rows": rows,
    }


def main() -> None:
    a = assess()
    print(f'ladder            : {" -> ".join(a["ladder"])}')
    print(f'tools inventoried : {a["tools"]}')
    print(f'runnable today    : {a["runnable_today"]}')
    print(f'with an entry pt  : {a["with_an_entry_point"]}')
    print()
    for r in a["rows"]:
        mark = "RUN" if r["runnable_today"] else "GATED"
        print(f'[{mark:5}] {r["module"]}   (rung {r["rung"]})')
        print(f'         asks : {r["answers"]}')
        print(f'         needs: {r["needs"]}')
        for ep in r["entry_points"]:
            print(f'         call : {ep}')
        if r["why_not"]:
            print(f'         GATED BECAUSE: {r["why_not"]}')
        print()
    print(a["FINDING_no_entry_points"])
    print()
    print(a["FINDING_gating"])


if __name__ == "__main__":
    main()
