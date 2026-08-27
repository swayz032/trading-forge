#!/usr/bin/env python3
"""Local simulated-account operations drills for MNQ v2.3.

These drills never create a position. Reconciliation can be proven while flat.
Emergency flatten can only be proven when the user intentionally supplies an
existing simulated-account test order/position. The runner cancels/flattens that
existing state and proves REST state is empty afterward.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_2_projectx_broker import ProjectXBroker
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_policy import semantics_hash
from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot


class OperationsDrill:
    def __init__(self, account_id: int, realtime_snapshot_path: str | Path,
                 rest: ProjectXBroker | None = None):
        require_personal_device("MNQ_OPERATIONS_DRILL")
        self.account_id = int(account_id)
        self.snapshot_path = Path(realtime_snapshot_path)
        self.rest = rest or ProjectXBroker(account_id=self.account_id)

    def _verified_snapshot(self, contract_id: str):
        return read_realtime_snapshot(self.snapshot_path, self.account_id, contract_id)

    def reconciliation_check(self, contract_id: str) -> dict:
        rt = self._verified_snapshot(contract_id)
        account = self.rest.account_snapshot()
        if int(account.get("id", -1)) != self.account_id:
            raise RuntimeError("DRILL_ACCOUNT_MISMATCH")
        if "balance" not in account:
            raise RuntimeError("DRILL_REST_BALANCE_MISSING")
        if abs(float(account["balance"]) - rt.account_balance) > 0.01:
            raise RuntimeError("DRILL_BALANCE_WITNESS_MISMATCH")
        orders = self.rest.get_working_orders()
        positions = self.rest.get_open_positions()
        return {
            "broker_reconciliation_verified": True,
            "account_simulated_verified": rt.account_simulated,
            "rest_balance": float(account["balance"]),
            "realtime_balance": rt.account_balance,
            "working_orders": len(orders),
            "open_positions": len(positions),
        }

    def emergency_flatten_existing_state(self, contract_id: str) -> dict:
        """Cancel/flatten existing SIM state; refuse fake drill with nothing to act on."""
        rt = self._verified_snapshot(contract_id)
        if not rt.account_simulated:
            raise RuntimeError("DRILL_NON_SIMULATED_REFUSE")
        before_orders = self.rest.get_working_orders()
        before_positions = self.rest.get_open_positions()
        if not before_orders and not before_positions:
            raise RuntimeError("DRILL_NO_EXISTING_SIM_STATE_TO_FLATTEN")
        self.rest.cancel_all()
        self.rest.flatten()
        after_orders = self.rest.get_working_orders()
        after_positions = self.rest.get_open_positions()
        if after_orders or after_positions:
            raise RuntimeError("DRILL_EMERGENCY_FLATTEN_INCOMPLETE")
        return {
            "emergency_flatten_drill_passed": True,
            "before_working_orders": len(before_orders),
            "before_open_positions": len(before_positions),
            "after_working_orders": 0,
            "after_open_positions": 0,
        }


def write_drill_receipt(path: str | Path, *, account_id: int,
                        reconciliation: dict,
                        emergency_flatten: dict | None = None) -> dict:
    require_personal_device("WRITE_MNQ_OPERATIONS_DRILL_RECEIPT")
    payload = {
        "schema_version": 1,
        "account_id": int(account_id),
        "semantics_sha256": semantics_hash(),
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "broker_reconciliation_verified": bool(reconciliation.get("broker_reconciliation_verified")),
        "account_simulated_verified": bool(reconciliation.get("account_simulated_verified")),
        "emergency_flatten_drill_passed": bool(
            emergency_flatten and emergency_flatten.get("emergency_flatten_drill_passed")
        ),
        "reconciliation": reconciliation,
        "emergency_flatten": emergency_flatten,
    }
    if not payload["broker_reconciliation_verified"] or not payload["account_simulated_verified"]:
        raise RuntimeError("DRILL_RECEIPT_RECONCILIATION_NOT_VERIFIED")
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return payload
