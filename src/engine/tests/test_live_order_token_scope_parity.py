"""test_live_order_token_scope_parity.py — CRIT (security-auth-hardening 2026-07-17)
cross-language parity fixture.

Mirrors src/shared/__tests__/live-order-token-scope.test.ts. Both files
hardcode the SAME literal expected canonical string — if either
build_archetype_gateway_scope_canonical (Python) or
buildArchetypeGatewayScopeCanonical (TypeScript) drifts from the documented
"{account_id}|{action}|live_order_archetype_scope" format, that language's
own test fails against its own hardcoded copy of the literal, catching drift
the same way the existing marker_contract.py / marker-contract.ts pair does.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_mod

from src.engine.live_order_token_scope import (
    LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX,
    LIVE_ORDER_TOKEN_SCOPE_VERSION,
    build_archetype_gateway_scope_canonical,
)

FIXTURE_ACCOUNT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
FIXTURE_ACTION = "archetype_signal"
FIXTURE_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# MUST stay byte-identical to EXPECTED_CANONICAL in
# live-order-token-scope.test.ts — this is the cross-language drift-detection
# mechanism.
EXPECTED_CANONICAL = (
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|archetype_signal|live_order_archetype_scope"
)


def test_version_tag_pinned_at_v1():
    assert LIVE_ORDER_TOKEN_SCOPE_VERSION == "v1"


def test_scope_suffix_is_the_literal_live_order_archetype_scope():
    assert LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX == "live_order_archetype_scope"


def test_build_archetype_gateway_scope_canonical_matches_documented_format():
    assert (
        build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, FIXTURE_ACTION)
        == EXPECTED_CANONICAL
    )


def test_canonical_matches_the_literal_hardcoded_on_the_typescript_side():
    # If src/shared/live-order-token-scope.ts's buildArchetypeGatewayScopeCanonical
    # ever drifts from this exact format, its own parity test
    # (live-order-token-scope.test.ts) fails against this SAME literal.
    assert EXPECTED_CANONICAL == (
        f"{FIXTURE_ACCOUNT_ID}|{FIXTURE_ACTION}|{LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX}"
    )


def test_different_account_id_produces_different_canonical():
    other = build_archetype_gateway_scope_canonical(
        "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", FIXTURE_ACTION
    )
    assert other != EXPECTED_CANONICAL


def test_different_action_produces_different_canonical():
    other = build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, "enter_long")
    assert other != EXPECTED_CANONICAL


def test_hmac_sha256_over_scope_canonical_is_stable_and_64_hex_chars():
    digest = hmac_mod.new(
        FIXTURE_SECRET.encode("utf-8"),
        build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, FIXTURE_ACTION).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert len(digest) == 64
    int(digest, 16)  # raises ValueError if not valid hex


def test_scoped_token_for_archetype_signal_differs_from_raw_secret():
    scoped = hmac_mod.new(
        FIXTURE_SECRET.encode("utf-8"),
        build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, FIXTURE_ACTION).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert scoped != FIXTURE_SECRET


def test_scoped_token_differs_across_different_actions():
    scoped_archetype_signal = hmac_mod.new(
        FIXTURE_SECRET.encode("utf-8"),
        build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, "archetype_signal").encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    scoped_enter_long = hmac_mod.new(
        FIXTURE_SECRET.encode("utf-8"),
        build_archetype_gateway_scope_canonical(FIXTURE_ACCOUNT_ID, "enter_long").encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert scoped_archetype_signal != scoped_enter_long
