"""live_order_token_scope.py — Python mirror of src/shared/live-order-token-scope.ts.

CRIT (security-auth-hardening 2026-07-17): see the TypeScript file's docstring
for the full rationale. This module MUST stay byte-for-byte identical to its
TypeScript counterpart — the parity test
src/engine/tests/test_live_order_token_scope_parity.py round-trips known
inputs across the language boundary so drift fails CI, mirroring the existing
marker_contract.py / marker-contract.ts pattern.
"""

from __future__ import annotations

LIVE_ORDER_TOKEN_SCOPE_VERSION: str = "v1"

LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX: str = "live_order_archetype_scope"


def build_archetype_gateway_scope_canonical(account_id: str, action: str) -> str:
    """Canonical string the archetype tf_gateway scoped token is derived from.

    MUST stay byte-for-byte identical to ``buildArchetypeGatewayScopeCanonical``
    in ``src/shared/live-order-token-scope.ts``.
    """
    return f"{account_id}|{action}|{LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX}"
