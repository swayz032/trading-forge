/**
 * Trusted-client-IP resolver (deep-scan fix-wave 2026-07-10, Fix 2 + Fix 3).
 *
 * PROBLEM: in production this app is reached ONLY through the tower-relay
 * tunnel (`railway-relay/server.js` WS ⇄ `scripts/tower-relay-client.cjs`).
 * `tower-relay-client.cjs::proxyRequest()` reissues every relay-forwarded
 * request as a FRESH local `http.request()` to `localhost:4000`. Consequence
 * at the Express layer:
 *   - `req.socket.remoteAddress` is ALWAYS loopback (127.0.0.1 / ::1) for
 *     relay traffic — useless as a per-caller key (confirmed by
 *     `office-control-guard.ts`'s own "relay traffic arrives on loopback"
 *     doc comment).
 *   - `req.headers["x-forwarded-for"]` is whatever the ORIGINAL external
 *     caller's request contained when it hit `railway-relay/server.js` —
 *     including a value the caller made up. There is no genuine multi-hop
 *     reverse-proxy chain here Express's `trust proxy` setting can reason
 *     about; tower-relay-client is a WS-tunnel replay of raw headers, not a
 *     proxy that appends its own hop.
 *
 * FIX: `railway-relay/server.js` is the ONE component that terminates the
 * real inbound TCP connection before the request is tunneled to the tower.
 * It deletes any client-supplied `x-forwarded-for` (and any spoofed copy of
 * `RELAY_VERIFIED_IP_HEADER` below) and stamps this header from its OWN
 * `req.socket.remoteAddress` — the actual TCP peer, not forgeable via any
 * HTTP header — before framing the request over the WS tunnel. That value
 * survives the tower-relay-client replay untouched (it only strips
 * `host` / `x-forwarded-host`) and lands here as a header only the relay
 * could have set.
 *
 * This resolver reads ONLY that relay-minted header — NEVER raw
 * `x-forwarded-for`. Direct-loopback / LAN callers (no relay in the path,
 * e.g. operator curl on the tower) fall back to the Express-observed socket
 * address — still real, never client-controlled.
 *
 * KNOWN RESIDUAL (documented, not silently assumed away): if Railway
 * terminates TLS and re-proxies over its internal network rather than doing
 * raw TCP passthrough to `railway-relay/server.js`, then
 * `req.socket.remoteAddress` at the relay is Railway's own edge IP, not the
 * originating internet client's IP — every external relay caller collapses
 * into ONE bucket. That is the fail-SAFE direction for a brute-force lockout
 * (an attacker can no longer mint a fresh bucket by spoofing a header — the
 * exact CRIT bug this closes) but it does mean one bad actor's failures can
 * exhaust the shared bucket and lock out the operator's own relay-forwarded
 * Office access too. Direct-loopback (non-relay) callers are unaffected.
 * Finer-grained per-caller keying (trusting a specific XFF hop count) is a
 * follow-up that requires confirming Railway's actual edge behavior first —
 * do not "improve" this by reading raw XFF again without that confirmation.
 */
import type { Request } from "express";

// NOTE (scope boundary, not fixed by this wave): this resolver trusts the
// PRESENCE of RELAY_VERIFIED_IP_HEADER unconditionally — it cannot
// cryptographically prove a given request actually transited
// railway-relay/server.js rather than reaching Express directly (e.g. a
// LAN-local caller hitting the tower's port 4000 without going through the
// relay could set this header itself). Closing that would need a shared
// secret between the relay and Express (mHMAC-style), which is a separate,
// larger change. Today's mitigation is network-layer (the tower is not
// internet-routable except via the relay tunnel); this header removes the
// SPOOFABLE-OVER-THE-INTERNET path (the CRIT finding this fix wave closes)
// without claiming to remove every LAN-local trust assumption.

/** Header the relay mints from its own socket peer; never trust this if read raw off the wire elsewhere. */
export const RELAY_VERIFIED_IP_HEADER = "x-relay-verified-ip";

/**
 * Resolve a non-spoofable-as-possible per-caller key for rate limiting /
 * brute-force lockout. Prefers the relay-minted header; falls back to the
 * Express-observed socket address (real for direct/LAN callers, loopback —
 * but still not attacker-controlled — for relay callers whose header is
 * somehow absent, e.g. an older relay build).
 */
export function resolveTrustedClientIp(req: Request): string {
  const relayVerified = req.headers[RELAY_VERIFIED_IP_HEADER];
  if (typeof relayVerified === "string" && relayVerified.trim()) {
    return relayVerified.trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}
