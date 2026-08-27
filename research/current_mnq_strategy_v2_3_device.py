#!/usr/bin/env python3
"""Machine-bound personal-device enrollment for MNQ v2.3.

This is defense in depth for Topstep's personal-device requirement. It is not a
hardware TPM attestation, but it prevents the normal accidental failure mode of
copying the automation bundle/receipt to a generic cloud/VPS runner.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import inspect_runtime

KEY_ENV = "MNQ_V23_DEVICE_HMAC_KEY"


def _secret() -> bytes:
    key = os.getenv(KEY_ENV, "").encode()
    if len(key) < 32:
        raise RuntimeError("DEVICE_HMAC_KEY_MISSING_OR_TOO_SHORT")
    return key


def _machine_identifier() -> str:
    system = platform.system().lower()
    if system == "windows":
        try:
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
            ) as key:
                value, _ = winreg.QueryValueEx(key, "MachineGuid")
            if value:
                return f"windows:{value}"
        except Exception as exc:
            raise RuntimeError("DEVICE_MACHINE_GUID_UNAVAILABLE") from exc
    elif system == "linux":
        for p in (Path("/etc/machine-id"), Path("/var/lib/dbus/machine-id")):
            if p.exists() and p.read_text().strip():
                return "linux:" + p.read_text().strip()
        raise RuntimeError("DEVICE_MACHINE_ID_UNAVAILABLE")
    elif system == "darwin":
        try:
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                text=True, timeout=5,
            )
            marker = '"IOPlatformUUID" = "'
            for line in out.splitlines():
                if marker in line:
                    return "darwin:" + line.split(marker, 1)[1].split('"', 1)[0]
        except Exception as exc:
            raise RuntimeError("DEVICE_PLATFORM_UUID_UNAVAILABLE") from exc
    raise RuntimeError(f"DEVICE_PLATFORM_UNSUPPORTED:{platform.system()}")


def machine_sha256() -> str:
    return hashlib.sha256(_machine_identifier().encode()).hexdigest()


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def enroll_device(path: str | Path, label: str = "primary-trading-pc") -> dict:
    runtime = inspect_runtime()
    if not runtime.personal_device_candidate:
        raise RuntimeError("DEVICE_ENROLL_REMOTE_RUNTIME_REFUSE")
    payload = {
        "schema_version": 1,
        "label": str(label),
        "machine_sha256": machine_sha256(),
        "platform": platform.system(),
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }
    sig = hmac.new(_secret(), _canonical(payload), hashlib.sha256).hexdigest()
    wrapper = {"payload": payload, "hmac_sha256": sig}
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(wrapper, indent=2, sort_keys=True))
    try:
        os.chmod(out, 0o600)
    except OSError:
        pass
    return wrapper


def verify_device(path: str | Path) -> dict:
    runtime = inspect_runtime()
    if not runtime.personal_device_candidate:
        raise RuntimeError("DEVICE_VERIFY_REMOTE_RUNTIME_REFUSE")
    p = Path(path)
    if not p.exists():
        raise RuntimeError("DEVICE_ENROLLMENT_MISSING")
    try:
        wrapper = json.loads(p.read_text())
        payload = wrapper["payload"]
    except Exception as exc:
        raise RuntimeError("DEVICE_ENROLLMENT_CORRUPT") from exc
    expected = hmac.new(_secret(), _canonical(payload), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(wrapper.get("hmac_sha256", "")), expected):
        raise RuntimeError("DEVICE_ENROLLMENT_SIGNATURE_INVALID")
    if int(payload.get("schema_version", -1)) != 1:
        raise RuntimeError("DEVICE_ENROLLMENT_SCHEMA_MISMATCH")
    if payload.get("machine_sha256") != machine_sha256():
        raise RuntimeError("DEVICE_ENROLLMENT_MACHINE_MISMATCH")
    return payload
