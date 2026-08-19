#!/usr/bin/env python3
"""Roll-aware MNQ contract identity for v2.2 research/live parity.

Policy source: CME Group customary U.S. Equity Index futures roll date = Monday
prior to the third Friday of the expiration month. After that roll date, the
second-nearest quarterly expiry becomes the customary lead month.

This module does not synthesize/adjust prices. It maps each session to the exact
outright contract that must supply its bars and refuses ambiguous/missing data.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import calendar

MONTH_CODE = {3: "H", 6: "M", 9: "U", 12: "Z"}
QUARTERS = (3, 6, 9, 12)


def third_friday(year: int, month: int) -> date:
    c = calendar.Calendar(firstweekday=calendar.MONDAY)
    fridays = [d for d in c.itermonthdates(year, month) if d.month == month and d.weekday() == calendar.FRIDAY]
    return fridays[2]


def cme_equity_roll_date(year: int, month: int) -> date:
    if month not in QUARTERS:
        raise ValueError("quarterly month required")
    return third_friday(year, month) - timedelta(days=4)


def previous_or_current_quarter(d: date) -> tuple[int, int]:
    for m in QUARTERS:
        if d.month <= m:
            return d.year, m
    return d.year + 1, 3


def next_quarter(year: int, month: int) -> tuple[int, int]:
    i = QUARTERS.index(month)
    if i < len(QUARTERS) - 1:
        return year, QUARTERS[i + 1]
    return year + 1, 3


def lead_contract_quarter(d: date) -> tuple[int, int]:
    year, month = previous_or_current_quarter(d)
    roll = cme_equity_roll_date(year, month)
    if d >= roll:
        return next_quarter(year, month)
    return year, month


def mnq_contract_code(d: date) -> str:
    y, m = lead_contract_quarter(d)
    return f"MNQ{MONTH_CODE[m]}{str(y)[-2:]}"


def projectx_contract_id(d: date) -> str:
    y, m = lead_contract_quarter(d)
    return f"CON.F.US.MNQ.{MONTH_CODE[m]}{str(y)[-2:]}"


@dataclass(frozen=True)
class ContractBarSource:
    session: date
    expected_contract_id: str
    source_contract_id: str | None
    source_path: str | None

    @property
    def valid(self) -> bool:
        return self.source_contract_id == self.expected_contract_id and bool(self.source_path)


def audit_contract_sources(rows: list[ContractBarSource]) -> dict:
    bad = [r for r in rows if not r.valid]
    return {
        "sessions": len(rows),
        "valid_sessions": len(rows) - len(bad),
        "invalid_sessions": len(bad),
        "status": "PASS" if not bad else "REFUSE",
        "mismatches": [
            {
                "session": str(r.session),
                "expected": r.expected_contract_id,
                "observed": r.source_contract_id,
                "source_path": r.source_path,
            }
            for r in bad[:100]
        ],
    }


def require_contract_sources(rows: list[ContractBarSource]) -> None:
    report = audit_contract_sources(rows)
    if report["status"] != "PASS":
        raise RuntimeError(f"CONTRACT_PROVENANCE_REFUSE:{report['invalid_sessions']}")
