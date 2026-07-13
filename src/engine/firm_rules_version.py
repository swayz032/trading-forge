"""Firm rules version fingerprinting for drift detection.

Wave 27.5 Pass A.1 — CRITICAL #1: Firm-Rule Parameter Drift Check

Purpose: Compute a deterministic 16-char hex prefix of SHA-256 over the
canonical stage rule book. Stamped on every new backtest row
(backtests.firm_rules_version). Monte Carlo reads the stored version, computes
the current version, and refuses to run if they differ.

Design:
  - Deterministic: same dict contents always produce same hash (sort_keys=True,
    separators minimized, float repr normalized via json.dumps default).
  - 16 chars = 64 bits of collision resistance — adequate for config drift
    detection (not a cryptographic commitment).
  - Both Python and TypeScript produce identical output for the same logical
    dict (cross-language parity test in tests/python/test_firm_rules_version.py
    and src/server/__tests__/wave27-5-firm-rules-version-parity.test.ts).

Contract:
  - Returns a lowercase hex string of exactly 16 characters.
  - Any change to the canonical stage rule book (adding a stage/key, changing
    a value, or adding a firm) MUST produce a different version string.
  - The hash input is deterministic across Python 3.x versions because
    json.dumps with sort_keys=True produces a canonical byte sequence.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _canonical_json(obj: Any) -> str:
    """Produce a canonical, deterministic JSON string for hashing.

    Uses sort_keys=True to ensure dict key ordering is deterministic.
    Uses separators=(',', ':') to strip whitespace.
    Uses ensure_ascii=False so any Unicode in firm names round-trips correctly.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_firm_rules_version() -> str:
    """Compute SHA-256 (16-char hex prefix) over canonical stage rules.

    Import the shared stage rule book at call time so a change in any of the
    evaluation, funded, payout, or live stages invalidates stale evidence.

    Returns:
        16-character lowercase hex string (64-bit prefix of SHA-256)

    Example:
        >>> v = compute_firm_rules_version()
        >>> len(v) == 16
        True
        >>> v == v  # deterministic
        True
    """
    from src.engine.firm_stage_rules import FIRM_STAGE_RULES

    canonical = _canonical_json({"FIRM_STAGE_RULES": FIRM_STAGE_RULES})
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest[:16]


def compute_firm_rules_version_from_stage_rules(stage_rules: dict[str, Any]) -> str:
    """Compute a version from an explicit canonical stage rule book."""
    canonical = _canonical_json({"FIRM_STAGE_RULES": stage_rules})
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest[:16]


def compute_firm_rules_version_from_dicts(
    firm_configs: dict[str, Any],
    firm_rules: dict[str, Any],
) -> str:
    """Compute a legacy-projection version from explicit dictionaries.

    This generic helper remains for cross-language algorithm tests. Production
    versioning uses ``compute_firm_rules_version_from_stage_rules`` instead.

    Args:
        firm_configs: dict equivalent to FIRM_CONFIGS from prop_compliance.py
        firm_rules: dict equivalent to FIRM_RULES from firm_config.py

    Returns:
        16-character lowercase hex string
    """
    combined: dict[str, Any] = {
        "FIRM_CONFIGS": firm_configs,
        "FIRM_RULES": firm_rules,
    }
    canonical = _canonical_json(combined)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest[:16]
