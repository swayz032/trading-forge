#!/usr/bin/env python3
"""Collect the frozen MNQ v2.4 clean historical dataset from Databento.

This runner performs DATA COLLECTION ONLY. It does not import or execute the v2.4
sealed P&L runner. The frozen clean scope is genuine MNQ from CME launch
2019-05-06 through 2021-12-31, using explicit H/M/U/Z raw symbols and the
predeclared causal roll bridge logic.

Credential resolution follows Trading Forge's existing sources in this order:
1) current process environment,
2) project/parent .env,
3) Trading Forge Bitwarden CLI vault when configured and unlocked.
Credential values are never printed or written to the dataset manifest.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

CLEAN_START = date(2019, 5, 6)
CLEAN_END = date(2021, 12, 31)
OUT_DIR = REPO_ROOT / "data" / "mnq_v24_clean_2019_2021"


def _load_project_dotenv() -> str | None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return None
    seen: set[Path] = set()
    candidates = [REPO_ROOT, Path.cwd().resolve(), *Path.cwd().resolve().parents]
    for base in candidates:
        if base in seen:
            continue
        seen.add(base)
        candidate = base / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return str(candidate)
    return None


def _extract_key_from_bw_items(items: Any) -> str | None:
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        fields = item.get("fields")
        if isinstance(fields, list):
            for field in fields:
                if isinstance(field, dict) and field.get("name") == "DATABENTO_API_KEY":
                    value = field.get("value")
                    if isinstance(value, str) and value.strip():
                        return value.strip()
        login = item.get("login")
        if isinstance(login, dict) and login.get("username") == "DATABENTO_API_KEY":
            value = login.get("password")
            if isinstance(value, str) and value.strip():
                return value.strip()
        notes = item.get("notes")
        if isinstance(notes, str) and notes.strip():
            try:
                payload = json.loads(notes)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                value = payload.get("DATABENTO_API_KEY")
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _load_databento_from_bitwarden() -> bool:
    # Match Trading Forge's existing credential-loader contract. Never ask for,
    # print, or persist the secret. We only use an already-unlocked CLI session.
    if shutil.which("bw") is None:
        return False
    bw_session = os.environ.get("BW_SESSION", "").strip()
    if not bw_session:
        return False

    folder_id = os.environ.get("TF_VAULT_FOLDER_ID", "").strip()
    args = ["bw", "list", "items"]
    if folder_id:
        args += ["--folderid", folder_id]
    else:
        args += ["--search", "TradingForge."]
    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=20,
            env={**os.environ, "BW_SESSION": bw_session},
            check=False,
        )
        if proc.returncode != 0:
            return False
        items = json.loads(proc.stdout or "[]")
    except Exception:
        return False

    key = _extract_key_from_bw_items(items)
    if not key:
        return False
    os.environ["DATABENTO_API_KEY"] = key
    return True


def _require_databento_key() -> str:
    key = os.environ.get("DATABENTO_API_KEY", "").strip()
    if key and key != "your-databento-api-key":
        return "environment"

    env_path = _load_project_dotenv()
    key = os.environ.get("DATABENTO_API_KEY", "").strip()
    if key and key != "your-databento-api-key":
        return f"dotenv:{env_path}" if env_path else "dotenv"

    if _load_databento_from_bitwarden():
        return "bitwarden"

    raise RuntimeError(
        "DATABENTO_API_KEY_NOT_FOUND: Trading Forge could not resolve the existing key from "
        "the current environment, project/parent .env, or an already-unlocked Bitwarden CLI "
        "session. Do not paste the key into chat. If Trading Forge uses Bitwarden, unlock it "
        "in this PowerShell session first; otherwise expose the existing key to this shell using "
        "your normal local credential method."
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
    credential_source = _require_databento_key()
    _refuse_dirty_output()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    from research.current_mnq_strategy_v2_3_databento import collect_databento

    print("MNQ v2.4 frozen clean DATA COLLECTION only")
    print(f"scope: {CLEAN_START} through {CLEAN_END}")
    print("source: Databento GLBX.MDP3 explicit MNQ raw_symbol contracts")
    print(f"credential source: {credential_source} (secret not printed)")
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
