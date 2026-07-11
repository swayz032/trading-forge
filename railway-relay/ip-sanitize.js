// Pure header-sanitization helpers for railway-relay/server.js — split into their
// own module (no `process.exit`, no `server.listen`, no required env vars) so they
// are unit-testable without booting the relay's WS/HTTP bootstrap.
//
// Deep-scan fix-wave 2026-07-10 (Fix 2 + Fix 3): this relay is the ONE component
// that terminates the real inbound TCP connection before a request is tunneled to
// the tower. tower-relay-client.cjs::proxyRequest() replays whatever headers we
// hand it verbatim into a fresh loopback http.request() on the tower — so a
// client-supplied `x-forwarded-for` reaches Express looking exactly as
// trustworthy as a value we'd have set ourselves. That let an attacker rotate
// X-Forwarded-For to mint a fresh admin-passcode brute-force bucket per request
// (deep-scan finding, src/server/routes/slumhouse/admin.ts::clientKey()) and let
// every relay caller collapse into rate-limit.ts's shared 127.0.0.1 bucket.
//
// Fix: strip any inbound x-forwarded-for AND any inbound copy of our own
// RELAY_VERIFIED_IP_HEADER (never append — a client who sends that header
// pre-emptively must not have it survive), then stamp the header fresh from
// req.socket.remoteAddress — the actual TCP peer, not forgeable via any HTTP
// header. See src/server/lib/relay-client-ip.ts for the downstream consumer
// contract and the documented residual (Railway HTTP-proxy-mode caveat: if
// Railway re-proxies over its internal network rather than raw TCP passthrough,
// this collapses to Railway's own edge IP for all external callers — a shared
// bucket, but no longer an attacker-controlled one).
const RELAY_VERIFIED_IP_HEADER = "x-relay-verified-ip";

function normalizeRemoteAddress(addr) {
  if (!addr) return "unknown";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

/**
 * @param {{ headers: Record<string, unknown>, socket?: { remoteAddress?: string } }} req
 * @returns {Record<string, unknown>} a NEW headers object — never mutates req.headers.
 */
function sanitizeAndStampHeaders(req) {
  const headers = { ...req.headers };
  delete headers["x-forwarded-for"];
  delete headers[RELAY_VERIFIED_IP_HEADER];
  headers[RELAY_VERIFIED_IP_HEADER] = normalizeRemoteAddress(req.socket && req.socket.remoteAddress);
  return headers;
}

module.exports = {
  RELAY_VERIFIED_IP_HEADER,
  normalizeRemoteAddress,
  sanitizeAndStampHeaders,
};
