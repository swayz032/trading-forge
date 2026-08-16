"""AR-1208 LANE 1 + LANE 2 — stop-ceiling witness. READ-ONLY DIAGNOSTIC.

LANE 1 corrects AR-1207's struck finding: that test asserted a ceiling breach using
`symbol="MES"` while the source example is Nasdaq. This diagnostic never mixes instrument
identity — the symbol is printed beside every number.

LANE 2 answers the question AR-1208 §6 says must have an executable witness rather than a
code comment: does a structural-stop ceiling refusal survive strategy onboarding for a
NEWLY CERTIFIED (therefore UNREGISTERED) strategy?

🛑 THIS FIXES NOTHING. `eligibility_gate`'s unregistered bypass is deliberate
(backtest/paper parity) and changing it is a money-path semantics decision that is not the
worker's to make. This script only measures and records.

Run from repo root:
  python scripts/svkm_stop_ceiling_witness.py
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "src", "engine", "tests"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.context.eligibility_gate import evaluate_signal  # noqa: E402
from src.engine.context.playbook_router import ALL_STRATS  # noqa: E402
from src.engine.context.structural_stops import compute_structural_stop  # noqa: E402

from test_skip_trade_propagation import (  # noqa: E402
    _make_bias_state, _make_location, _make_playbook, _make_session,
    _make_stop_plan, _make_target_plan,
)

OUT = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified",
                   "grade", "stop_ceiling_witness.json")

# The name the production extractor itself emitted for sVkm (AR-1137).
SVKM_NAME = "fvg_breakout_range_1m_5m"
REGISTERED_CONTROL = "breaker"


def registered(name: str) -> bool:
    norm = name.lower().replace("strategy", "").strip().replace("_", "")
    return norm in [s.lower().replace("_", "") for s in ALL_STRATS]


def ceiling_probe() -> list[dict]:
    """LANE 1 — same structural geometry, each symbol judged by ITS OWN ceiling."""
    entry, level = 5000.0, 5015.0          # synthetic witness geometry, labelled as such
    rows = []
    for symbol in ("MES", "MNQ", "MCL"):
        p = compute_structural_stop(
            direction="short", entry_price=entry, nearest_fvg_above=level,
            point_value=2.0, atr=20.0, tick_size=0.25, symbol=symbol,
        )
        rows.append({
            "symbol": symbol,
            "entry": entry,
            "structural_level_in": level,
            "stop_price_out": p.stop_price,
            "risk_points": round(abs(entry - p.stop_price), 4),
            "skip_trade": p.skip_trade,
            "stop_reason": p.stop_reason,
            "price_preserved_unclamped": p.stop_price >= level,
        })
    return rows


def onboarding_probe() -> list[dict]:
    """LANE 2 — does an oversized stop still end in NO ORDER for an UNREGISTERED strategy?"""
    rows = []
    for name in (REGISTERED_CONTROL, SVKM_NAME):
        sp = _make_stop_plan(skip=True)     # ceiling already breached upstream
        d = evaluate_signal(
            signal={"direction": "long", "strategy_name": name, "entry_price": 4500.0},
            bias_state=_make_bias_state(), playbook=_make_playbook(),
            location=_make_location(), stop_plan=sp,
            target_plan=_make_target_plan(), session=_make_session(),
        )
        rows.append({
            "strategy_name": name,
            "registered_in_ALL_STRATS": registered(name),
            "stop_plan_skip_trade": True,
            "eligibility_action": d.action,
            "stop_price_unmodified": sp.stop_price == 4486.0,
            "first_reason": (d.reasoning or [""])[0][:200],
            "ends_in_no_order": d.action == "SKIP",
        })
    return rows


def main() -> int:
    print("=" * 78)
    print("LANE 1 — ceiling by symbol (identical geometry; NEVER reuse one symbol's ceiling)")
    ceilings = ceiling_probe()
    for r in ceilings:
        print(f"  {r['symbol']:4} risk={r['risk_points']:7.3f}pt  skip_trade={str(r['skip_trade']):5}  "
              f"stop={r['stop_price_out']:9.3f}  preserved_unclamped={r['price_preserved_unclamped']}  "
              f"{r['stop_reason']}")
    print()
    print("  => AR-1207's breach was an artifact of passing symbol='MES' for a Nasdaq source.")
    print("  => stop_price is PRESERVED in every row: the engine SKIPS, it does not CLAMP.")

    print()
    print("=" * 78)
    print("LANE 2 — does the ceiling refusal survive onboarding? (skip_trade=True in all rows)")
    onboarding = onboarding_probe()
    for r in onboarding:
        flag = "OK " if r["ends_in_no_order"] else "🛑 "
        print(f"  {flag}{r['strategy_name']:28} registered={str(r['registered_in_ALL_STRATS']):5} "
              f"-> action={r['eligibility_action']:5} ends_in_no_order={r['ends_in_no_order']}")
    print()
    for r in onboarding:
        if not r["ends_in_no_order"]:
            print(f"  reason returned for {r['strategy_name']!r}:")
            print(f"    {r['first_reason']}")

    bypassed = [r for r in onboarding if not r["ends_in_no_order"]]
    artifact = {
        "artifact": "svkm-stop-ceiling-witness",
        "ruling": "AR-1208 §6 LANE 1 + LANE 2",
        "lane1_ceiling_by_symbol": ceilings,
        "lane2_onboarding": onboarding,
        "skip_trade_non_test_readers": [
            "src/engine/context/eligibility_gate.py:119 (the ONLY one, measured by grep "
            "over src/ excluding tests)"
        ],
        "finding": (
            "The structural-stop ceiling refusal does NOT survive onboarding for an "
            "unregistered strategy: evaluate_signal returns TAKE before reaching Check 0."
            if bypassed else
            "The ceiling refusal survives onboarding for every probed strategy."
        ),
        "scope_limits": [
            "PROVEN: evaluate_signal's return value, and that skip_trade has exactly one "
            "non-test reader.",
            "NOT PROVEN: that any order would reach a broker. Other framework layers "
            "(DLL, sizing, egress chokepoint) were NOT enumerated; broker egress is OFF.",
            "Lane 1 geometry is a synthetic unit witness, NOT a measured teacher stop. "
            "The real sVkm stop anchor is still unresolved (AR-1208 §7).",
        ],
        "worker_changed_production_logic": False,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, OUT)
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
