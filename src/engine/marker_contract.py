"""marker_contract.py — Python mirror of src/shared/marker-contract.ts.

F-10 (Pass 6 / Track A 2026-05-21): Pine compiler MUST import these helpers
when computing the export-time HMAC signature. The TypeScript verifier in
``src/server/services/tradingview-marker-service.ts`` uses the matching
helpers in ``src/shared/marker-contract.ts``.

If the format changes, bump ``MARKER_CONTRACT_VERSION`` in both files in the
same commit. The integration-test fixture ``tests/marker-contract.contract.test.ts``
round-trips a known payload across the language boundary so drift fails CI.
"""

from __future__ import annotations

MARKER_CONTRACT_VERSION: str = "v1"

MARKER_EXPORT_SUFFIX: str = "marker_export"
MARKER_FIELD_SEPARATOR: str = "|"


def build_export_canonical(strategy_id: str, account_id: str) -> str:
    """Canonical string signed by the per-account HMAC at .pine compile time.

    MUST stay byte-for-byte identical to ``buildExportCanonical`` in
    ``src/shared/marker-contract.ts``.
    """
    return f"{strategy_id}{MARKER_FIELD_SEPARATOR}{account_id}{MARKER_FIELD_SEPARATOR}{MARKER_EXPORT_SUFFIX}"


def build_webhook_canonical(
    strategy_id: str,
    account_id: str,
    bar_timestamp: str,
    signal: int,
) -> str:
    """Canonical string for live bar marker webhook verification.

    MUST stay byte-for-byte identical to ``buildWebhookCanonical`` in
    ``src/shared/marker-contract.ts``.
    """
    return (
        f"{strategy_id}{MARKER_FIELD_SEPARATOR}{account_id}"
        f"{MARKER_FIELD_SEPARATOR}{bar_timestamp}{MARKER_FIELD_SEPARATOR}{signal}"
    )
