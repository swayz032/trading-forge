/**
 * live-order-token-scope.ts — single source of truth for the archetype
 * tf_gateway live-order token SCOPE canonical string.
 *
 * CRIT (security-auth-hardening 2026-07-17): /api/live-order's static-token
 * auth mode (Pine callers) previously accepted the SAME per-(account,strategy)
 * bearer secret for ANY `action` value. A leaked/captured token for a
 * compile-time-substituted archetype tf_gateway export (the token is embedded
 * in plaintext in that specific artifact class — see pine_compiler.py
 * `_build_archetype_alert_pine`) therefore authorized submitting a raw
 * enter_long/enter_short/exit_long/exit_short order with ATTACKER-CHOSEN
 * ticker/quantity/price directly, bypassing the server-side archetype
 * evaluator entirely — not just the intended archetype_signal flow.
 *
 * Pine has no crypto library (documented repeatedly across this codebase —
 * see marker-contract.ts), so a genuinely PER-REQUEST signature is not
 * achievable for Pine-native callers. What IS achievable is binding the
 * token to what Pine already fixes at COMPILE time. For the archetype
 * tf_gateway path, `action` is a LOCKED CONSTANT ("archetype_signal" — see
 * pine_compiler.py `_build_archetype_alert_pine` tf_gateway branch), so the
 * compiler can derive a SCOPED subtoken bound to (account_id, action) instead
 * of embedding the raw per-(account,strategy) secret verbatim. The server
 * (live-order.ts) re-derives the same scoped value from the REQUEST's own
 * account_id + action and the DB-stored raw secret, and requires it for
 * action === "archetype_signal" specifically.
 *
 * This closes the archetype-path escalation vector: a leaked archetype
 * export's scoped token can no longer be replayed as action=enter_long (the
 * derived value never equals the raw secret the direct-action branch still
 * expects).
 *
 * RESIDUAL (documented, not fixed this wave): the STANDARD directional
 * tf_gateway path (enter_long/enter_short/exit_long/exit_short) shares ONE
 * operator-pasted `input.string()` raw secret across all four actions
 * (pine_compiler.py ~1784-1801) and is NOT scoped by this change — doing so
 * would require restructuring the TradingView deploy UX to four separate
 * per-action inputs, which is out of scope for this fix (touches the Pine
 * export UX / pine-export-service.ts, held back this wave). That path's
 * token is also NOT embedded in any distributed file (operator pastes it
 * manually at chart-load time), so it does not share the archetype path's
 * "leaked-via-distributed-file" exposure — see CLAUDE.md §9 per-recipient
 * secret design.
 *
 * Python mirror: src/engine/live_order_token_scope.py. Both MUST stay
 * byte-for-byte identical — see the parity test
 * src/shared/__tests__/live-order-token-scope.test.ts and
 * src/engine/tests/test_live_order_token_scope_parity.py.
 */

export const LIVE_ORDER_TOKEN_SCOPE_VERSION = "v1" as const;

export const LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX = "live_order_archetype_scope" as const;

/**
 * Canonical string the archetype tf_gateway scoped token is derived from
 * (via HMAC-SHA256 keyed by the per-(account,strategy) raw secret).
 *
 * Canonical form: "{accountId}|{action}|live_order_archetype_scope"
 *
 * `action` is always the literal "archetype_signal" for genuine Pine-fired
 * archetype tf_gateway alerts, but the function takes it as a parameter so
 * both the compiler (which always derives for "archetype_signal") and the
 * server verifier (which must recompute using the REQUEST's own action to
 * detect mismatch) share one implementation.
 */
export function buildArchetypeGatewayScopeCanonical(
  accountId: string,
  action: string,
): string {
  return `${accountId}|${action}|${LIVE_ORDER_ARCHETYPE_SCOPE_SUFFIX}`;
}
