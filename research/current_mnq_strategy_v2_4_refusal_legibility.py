#!/usr/bin/env python3
"""Every refusal the bot can show the operator must be legible to him. DIAGNOSTIC ONLY.

ALGO-026 §1(b) — the self-explanation audit: "every runtime refusal/decision line the bot emits
must be legible to the operator (plain reason strings, no internal jargon at the surface). Fix
the illegible ones; this is presentation only, no semantic change."

**No semantic change is made here and none may be.** This module adds a translation layer over
the codes the runtime already raises. It changes no threshold, no gate and no decision.

WHY IT MATTERS ON A DEADLINE. From 2026-08-27 the operator reads these strings with GPT and no
Claude. `V24_EXECUTION_QUOTE_DRIFT` tells an engineer plenty and tells him nothing. A refusal he
cannot act on is, from where he sits, indistinguishable from a crash.

THE CODE LIST IS DERIVED, NOT TYPED. `runtime_codes()` walks the AST of the modules that can
actually surface a refusal to a live operator and collects every `UPPER_SNAKE` string raised in
them. A hand-typed list would certify only itself — that is exactly how the X-ray's
correspondence tuple let a divergence through for days. Add a new refusal to the runtime and it
appears here immediately; if it has no plain-English entry, the test goes red.

SCOPE: the RUNTIME surface only — the broker, the shadow and automation runtimes. The research
and diagnostic modules raise ~200 more codes that the operator will never see while trading, and
padding this table with them would bury the twenty that matter.
"""
from __future__ import annotations

import ast
import io
import re
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. A translation layer over refusals the runtime already raises. Changes no "
    "threshold, no gate and no decision. ALGO-026 section 1(b), presentation only."
)

RESEARCH = Path("research")

#: The modules that can put a refusal in front of a live operator.
RUNTIME_MODULES = (
    "current_mnq_strategy_v2_4_broker.py",
    "current_mnq_strategy_v2_4_shadow_runtime.py",
    "current_mnq_strategy_v2_4_automation_runtime.py",
    "current_mnq_strategy_v2_3_broker.py",
)

_CODE = re.compile(r"^([A-Z][A-Z0-9_]{5,})")


def runtime_codes(root: Path = RESEARCH) -> set[str]:
    """Every UPPER_SNAKE refusal code raised in the runtime surface. Derived, never typed."""
    out: set[str] = set()
    for name in RUNTIME_MODULES:
        p = root / name
        if not p.exists():
            continue
        for n in ast.walk(ast.parse(io.open(p, encoding="utf-8").read())):
            if isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call):
                for a in ast.walk(n.exc):
                    if isinstance(a, ast.Constant) and isinstance(a.value, str):
                        m = _CODE.match(a.value)
                        if m:
                            out.add(m.group(1))
    return out


#: code -> (what it means to him, what he should do). Both in his register, not an engineer's.
PLAIN_ENGLISH: dict[str, tuple[str, str]] = {
    "REALTIME_HEALTH_REFUSE": (
        "The live price feed is not healthy, so the bot will not trade on it.",
        "Nothing. It is right to refuse. Check your internet and the platform."),
    "ACCOUNT_CANNOT_TRADE": (
        "TopstepX says this account is not allowed to trade right now.",
        "Open the account in the app - it is usually breached, locked, or the wrong one."),
    "CONTRACT_MISMATCH": (
        "The bot is looking at a different contract month than it expected.",
        "Usually a contract roll. Report it before trading."),
    "PROJECTX_CONTRACT_NOT_ACTIVE": (
        "The contract it wants to trade is not active at the broker.",
        "Usually a roll. Report it."),
    "PROJECTX_CONTRACT_ID_LOOKUP_MISMATCH": (
        "Two sources disagree about which contract this is.",
        "Do not override. Report it."),
    "WORKING_ORDERS_EXIST": (
        "There are already live orders, so it will not stack another.",
        "Flatten or cancel first if that is what you want."),
    "OPEN_POSITION_EXISTS": (
        "There is already an open position, so it will not add to it.",
        "Flatten first if that is what you want."),
    "BROKER_STATE_EXISTS_WITHOUT_LOCAL_BULLET": (
        "The broker thinks there is a trade the bot has no record of.",
        "STOP. Check your positions by hand in the app before doing anything else."),
    "TOPSTEP_SIZE_REFUSE": (
        "The trade size would break a Topstep rule.",
        "Nothing. It is protecting your account."),
    "BROKER_BALANCE_MISSING": (
        "It cannot read your account balance, so it will not size a trade.",
        "Do not override. Report it."),
    "ACCOUNT_BALANCE_WITNESS_MISMATCH": (
        "Two sources disagree about your balance.",
        "Do not override. Report it - a disagreement about money is never ignored."),
    "RISK_STORE_ACCOUNT_MISMATCH": (
        "Its saved risk record belongs to a different account than the one connected.",
        "Report it. Do not clear the record yourself."),
    "BRACKET_DISTANCE_NOT_TICK_ALIGNED": (
        "The stop or target does not land on a real tradeable price.",
        "Report it."),
    "SIGNAL_SIDE_INVALID": (
        "The buy/sell direction on the signal is not valid.",
        "Report it."),
    "LONG_BRACKET_GEOMETRY_INVALID": (
        "For a buy, the stop and target are not on the right sides of the entry.",
        "Report it."),
    "SHORT_BRACKET_GEOMETRY_INVALID": (
        "For a sell, the stop and target are not on the right sides of the entry.",
        "Report it."),
    "V24_SIGNAL_SEMANTICS_STALE": (
        "The signal was built by an older version of the strategy than the one running.",
        "Report it. Do not run mixed versions."),
    "V24_SIGNAL_ENGINE_VERSION_MISMATCH": (
        "The signal and the engine are different versions.",
        "Report it. Do not run mixed versions."),
    "V24_SIGNAL_SIDE_INVALID": (
        "The buy/sell direction on the signal is not valid.",
        "Report it."),
    "V24_LONG_SIGNAL_REFERENCE_NOT_LIVE_ASK": (
        "For a buy, the price it wants to use is not the live asking price.",
        "Correct refusal - it will not trade off a stale price."),
    "V24_SHORT_SIGNAL_REFERENCE_NOT_LIVE_BID": (
        "For a sell, the price it wants to use is not the live bid.",
        "Correct refusal - it will not trade off a stale price."),
    "V24_EXECUTION_SIDE_QUOTE_MISSING": (
        "There is no live quote on the side it needs.",
        "Correct refusal. Check the feed."),
    "V24_EXECUTION_QUOTE_OFF_TICK": (
        "The quoted price is not a valid tick.",
        "Correct refusal. Report if it repeats."),
    "V24_EXECUTION_QUOTE_DRIFT": (
        "The price moved too far between deciding and sending.",
        "Correct refusal - it will not chase."),
    "SHADOW_REST_ACCOUNT_MISMATCH": (
        "In shadow mode, the account it read does not match the one configured.",
        "Report it."),
    "SHADOW_REST_BALANCE_MISSING": (
        "In shadow mode, it cannot read the balance.",
        "Report it."),
    "SHADOW_BALANCE_WITNESS_MISMATCH": (
        "In shadow mode, two balance sources disagree.",
        "Report it."),
    "V24_AUTOMATION_RISK_ACCOUNT_MISMATCH": (
        "The automation's risk record is for a different account.",
        "Report it. Do not clear the record yourself."),
}

#: Jargon that must never reach him untranslated.
JARGON = ("semantics", "witness", "bracket geometry", "tick-aligned", "REST", "intra5",
          "kernel", "snapshot")


def explain(code: str) -> tuple[str, str] | None:
    """Plain meaning and action for one code, or None if it has no entry."""
    return PLAIN_ENGLISH.get(code)


def audit(root: Path = RESEARCH) -> dict:
    """Which runtime refusals are legible, and which are not."""
    codes = runtime_codes(root)
    missing = sorted(c for c in codes if c not in PLAIN_ENGLISH)
    orphans = sorted(c for c in PLAIN_ENGLISH if c not in codes)
    return {
        "status": DIAGNOSTIC_ONLY,
        "runtime_modules_scanned": [m for m in RUNTIME_MODULES if (root / m).exists()],
        "runtime_codes_found": len(codes),
        "with_plain_english": len(codes) - len(missing),
        "MISSING_plain_english": missing,
        "entries_for_codes_that_no_longer_exist": orphans,
        "legible": not missing,
        "scope_note": (
            "the RUNTIME surface only. The research and diagnostic modules raise many more "
            "codes the operator never sees while trading; padding this table with them would "
            "bury the ones that matter."),
    }


def main() -> None:
    a = audit()
    print(f'runtime modules scanned : {len(a["runtime_modules_scanned"])}')
    print(f'refusal codes found     : {a["runtime_codes_found"]}')
    print(f'with plain English      : {a["with_plain_english"]}')
    print(f'MISSING                 : {a["MISSING_plain_english"] or "none"}')
    print(f'stale entries           : {a["entries_for_codes_that_no_longer_exist"] or "none"}')
    print(f'legible                 : {a["legible"]}')


if __name__ == "__main__":
    main()
