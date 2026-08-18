#!/usr/bin/env python3
"""Collect the frozen MNQ v2.4 clean historical dataset from Databento.

This runner performs DATA COLLECTION ONLY. It does not import or execute the v2.4
sealed P&L runner. The frozen clean scope is genuine MNQ from CME launch
2019-05-06 through 2021-12-31, using explicit H/M/U/Z raw symbols and the
predeclared causal roll bridge logic.

Credential values are never printed or written to the dataset manifest.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

CLEAN_START = date(2019, 5, 6)
CLEAN_END = date(2021, 12, 31)
OUT_DIR = REPO_ROOT / "data" / "mnq_v24_clean_2019_2021"


def _load_project_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for base in (REPO_ROOT, Path.cwd().resolve(), *Path.cwd().resolve().parents):
        candidate = base / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def _require_databento_key() -> None:
    _load_project_dotenv()
    key = os.environ.get("DATABENTO_API_KEY", "").strip()
    if not key or key == "your-databento-api-key":
        raise RuntimeError(
            "DATABENTO_API_KEY_NOT_FOUND: put the existing Databento key in the project .env "
            "or current environment. Do not paste the key into chat."
        )


def _refuse_dirty_output() -> None:
    if not OUT_DIR.exists():
        return
    existing = [p for p in OUT_DIR.rglob("*") if p.is_file()]
    if existing:
        raise RuntimeError(
            f"CLEAN_DATA_OUTPUT_NOT_EMPTY:{OUT_DIR} contains {len(existing)} file(s). "
            "Refusing to mix a new frozen collection with prior/partial bytes."
        )


def main() -> None:
    _require_databento_key()
    _refuse_dirty_output()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    from research.current_mnq_strategy_v2_3_databento import collect_databento

    print("MNQ v2.4 frozen clean DATA COLLECTION only")
    print(f"scope: {CLEAN_START} through {CLEAN_END}")
    print("source: Databento GLBX.MDP3 explicit MNQ raw_symbol contracts")
    print(f"output: {OUT_DIR}")
    print("strategy P&L executed: NO")

    manifest = collect_databento(CLEAN_START, CLEAN_END, OUT_DIR)

    summary = {
        "status": "COLLECTION_COMPLETE",
        "requested_start": manifest.get("requested_start"),
        "requested_end": manifest.get("requested_end"),
        "mnq_launch_date": manifest.get("mnq_launch_date"),
        "source": manifest.get("source"),
        "sessions": manifest.get("sessions"),
        "raw_contract_files": len(manifest.get("raw_contract_files", {})),
        "roll_bridges": len(manifest.get("roll_bridges", [])),
        "dataset_sha256": manifest.get("dataset_sha256"),
        "continuous_1m_rows": manifest.get("continuous_1m", {}).get("rows"),
        "continuous_5m_rows": manifest.get("continuous_5m", {}).get("rows"),
        "output_dir": str(OUT_DIR),
        "strategy_pnl_executed": False,
    }
    print("\n" + json.dumps(summary, indent=2, sort_keys=True))
    print("\nSTOP HERE: do not run sealed P&L until this manifest is independently audited.")


if __name__ == "__main__":
    main()
