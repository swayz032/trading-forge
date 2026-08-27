#!/usr/bin/env python3
"""v2.4 operations drill wrapper with current semantic binding."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device
from research.current_mnq_strategy_v2_3_operations_drill import OperationsDrill
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash


def write_drill_receipt(path: str | Path, *, account_id: int,
                        reconciliation: dict,
                        emergency_flatten: dict | None = None) -> dict:
    require_personal_device("WRITE_MNQ_V24_OPERATIONS_DRILL_RECEIPT")
    payload = {
        "schema_version": 1,
        "release": load_spec()["release_id"],
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
    if not payload["broker_reconciliation_verified"]:
        raise RuntimeError("V24_DRILL_RECEIPT_RECONCILIATION_NOT_VERIFIED")
    if not payload["account_simulated_verified"]:
        raise RuntimeError("V24_DRILL_RECEIPT_SIMULATED_ACCOUNT_NOT_VERIFIED")
    out = Path(path); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return payload
