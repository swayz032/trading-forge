/**
 * Office control-authority guard (Layer-4 Office P0, 2026-07-02).
 *
 * ARCHITECTURE DECISION (operator, pinned): the Slumhouse Office is the ONLY
 * control room; the React SPA is a read-only observation deck. Generic API
 * routes that mutate trading control state (pipeline start/pause/vacation,
 * manual deploy approval/rejection) must not be callable by anonymous remote
 * clients. A request passes when it presents:
 *
 *   - a valid Slumhouse Office admin session cookie (slumhouse_admin_sid), OR
 *   - a direct loopback connection (operator curl on the tower / runbooks)
 *     that did NOT arrive through the public relay tunnel.
 *
 * INCIDENT (deep-scan fix-wave 2026-07-10, found + fixed same day): this
 * guard used to key "not relay traffic" on the ABSENCE of `x-forwarded-for`.
 * That broke the moment `railway-relay/ip-sanitize.js` started unconditionally
 * stripping `x-forwarded-for` on every relay-tunneled request (a different,
 * legitimate fix in the same wave, for admin.ts/rate-limit.ts spoofing) —
 * every relay caller then also arrived on loopback with no forwarded header,
 * satisfying this guard's old condition and getting Office authority without
 * ever presenting the cookie. Fixed by keying on the PRESENCE of the relay's
 * own `x-relay-verified-ip` header instead (see relay-client-ip.ts) — the
 * relay stamps this on every request it tunnels and tower-relay-client.cjs
 * forwards it verbatim, so its presence is a reliable "this came through the
 * relay" signal that survived the ip-sanitize.js change instead of being
 * broken by it. The old `!x-forwarded-for` check is KEPT alongside the new
 * one (not removed) as residual defense against a caller who bypasses the
 * public relay entirely and connects straight to the tower's LAN port with
 * a self-forged `x-forwarded-for` — that direct path has no relay in front
 * of it to strip anything, so the header surviving is itself the tell.
 *
 * On block: 401 { error: "office_only" } + an audit row (action supplied by
 * the caller so each surface stays queryable: admin.pipeline_mutation_blocked,
 * strategy.deploy_mutation_blocked, ...). Fail-closed by construction — any
 * cookie-verification error reads as "no session".
 *
 * In-process callers (crons, services, Carter actions) are unaffected: they
 * call service functions (setMode, lifecycleService.promoteStrategy) directly,
 * never these HTTP routes.
 */
import type { Request, Response } from "express";
import { adminSessionFromCookie } from "./slumhouse/admin-session.js";
import { insertAuditRowSafe } from "./audit-log-helper.js";
import { RELAY_VERIFIED_IP_HEADER } from "./relay-client-ip.js";

/**
 * Returns true when the request carries Office/operator control authority.
 * Otherwise responds 401 office_only, writes a blocked-attempt audit row
 * under `blockedAction`, and returns false.
 */
export function requireOfficeControlAuthority(
  req: Request,
  res: Response,
  blockedAction: string,
): boolean {
  if (adminSessionFromCookie(req.headers.cookie)) return true;

  const relayVerifiedIp = req.headers[RELAY_VERIFIED_IP_HEADER];
  const cameThroughRelay =
    typeof relayVerifiedIp === "string" && relayVerifiedIp.trim().length > 0;
  const forwarded = req.headers["x-forwarded-for"];
  const remote = req.socket?.remoteAddress ?? "";
  const isLoopback =
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  // Both conditions load-bearing, not redundant: cameThroughRelay is the
  // primary signal (catches every relay-tunneled request, which now always
  // arrives on loopback with x-forwarded-for stripped by ip-sanitize.js).
  // !forwarded is the residual defense for a caller who bypasses the public
  // relay entirely and connects directly to the tower's LAN port with a
  // self-forged x-forwarded-for header — that path has no relay in front of
  // it to strip anything, so the header surviving is itself the tell.
  if (isLoopback && !cameThroughRelay && !forwarded) return true;

  void insertAuditRowSafe({
    action: blockedAction,
    entityType: "system",
    entityId: null,
    decisionAuthority: "gate",
    input: { path: req.path, remote, cameThroughRelay, forwarded: forwarded ?? null } as Record<string, unknown>,
    result: {} as Record<string, unknown>,
    status: "warning",
    correlationId: req.id ?? null,
  });
  res.status(401).json({
    error: "office_only",
    message: "This control lives in the Slumhouse Office (/slumhouse/office.html).",
  });
  return false;
}
