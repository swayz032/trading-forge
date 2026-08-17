from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from research import current_mnq_strategy_v2_3_device as device


def local(monkeypatch):
    monkeypatch.setattr(device, "inspect_runtime", lambda: SimpleNamespace(personal_device_candidate=True))
    monkeypatch.setattr(device, "_machine_identifier", lambda: "windows:test-machine-guid")
    monkeypatch.setenv("MNQ_V23_DEVICE_HMAC_KEY", "d" * 64)


def test_enroll_and_verify_machine_bound_device(monkeypatch, tmp_path):
    local(monkeypatch)
    p = tmp_path / "device.json"
    wrapper = device.enroll_device(p)
    assert wrapper["payload"]["machine_sha256"] == device.machine_sha256()
    verified = device.verify_device(p)
    assert verified["label"] == "primary-trading-pc"


def test_device_receipt_tamper_is_refused(monkeypatch, tmp_path):
    local(monkeypatch)
    p = tmp_path / "device.json"
    device.enroll_device(p)
    wrapper = json.loads(p.read_text())
    wrapper["payload"]["label"] = "copied-vps"
    p.write_text(json.dumps(wrapper))
    with pytest.raises(RuntimeError, match="DEVICE_ENROLLMENT_SIGNATURE_INVALID"):
        device.verify_device(p)


def test_device_receipt_cannot_move_to_different_machine(monkeypatch, tmp_path):
    local(monkeypatch)
    p = tmp_path / "device.json"
    device.enroll_device(p)
    monkeypatch.setattr(device, "_machine_identifier", lambda: "windows:different-machine")
    with pytest.raises(RuntimeError, match="DEVICE_ENROLLMENT_MACHINE_MISMATCH"):
        device.verify_device(p)


def test_remote_runtime_cannot_enroll_or_verify(monkeypatch, tmp_path):
    monkeypatch.setattr(device, "inspect_runtime", lambda: SimpleNamespace(personal_device_candidate=False))
    monkeypatch.setenv("MNQ_V23_DEVICE_HMAC_KEY", "d" * 64)
    with pytest.raises(RuntimeError, match="DEVICE_ENROLL_REMOTE_RUNTIME_REFUSE"):
        device.enroll_device(tmp_path / "x.json")
