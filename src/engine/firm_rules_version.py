"""Firm rules version fingerprinting for drift detection.

Wave 27.5 Pass A.1 — CRITICAL #1: Firm-Rule Parameter Drift Check

Purpose: Compute a deterministic 16-char hex prefix of SHA-256 over the
combined FIRM_CONFIGS + FIRM_RULES dictionaries.  Stamped on every new
backtest row (backtests.firm_rules_version).  Monte Carlo reads the stored
version, computes the current version, and refuses to run if they differ.

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
  - Any change to FIRM_CONFIGS or FIRM_RULES (adding a key, changing a value,
    adding a firm) MUST produce a different version string.
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
    """Compute SHA-256 (16-char hex prefix) over FIRM_CONFIGS + FIRM_RULES.

    Imports FIRM_CONFIGS from prop_compliance and FIRM_RULES from firm_config
    at call time so mutations between runs are always caught.

    Returns:
        16-character lowercase hex string (64-bit prefix of SHA-256)

    Example:
        >>> v = compute_firm_rules_version()
        >>> len(v) == 16
        True
        >>> v == v  # deterministic
        True
    """
    from src.engine.firm_config import FIRM_RULES
    from src.engine.prop_compliance import FIRM_CONFIGS

    # Merge both dicts under stable top-level keys so neither can shadow the other.
    combined: dict[str, Any] = {
        "FIRM_CONFIGS": FIRM_CONFIGS,
        "FIRM_RULES": FIRM_RULES,
    }
    canonical = _canonical_json(combined)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest[:16]


def compute_firm_rules_version_from_dicts(
    firm_configs: dict[str, Any],
    firm_rules: dict[str, Any],
) -> str:
    """Compute version from explicit dicts (for testing + MC assertion path).

    Same algorithm as compute_firm_rules_version() but accepts dicts directly
    so callers can pass a snapshot without importing the live module globals.

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
