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
 *     with NO x-forwarded-for header. Relay-forwarded public traffic arrives
 *     on loopback but carries forwarding headers — it must show the Office
 *     cookie instead.
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

  const forwarded = req.headers["x-forwarded-for"];
  const remote = req.socket?.remoteAddress ?? "";
  const isLoopback =
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (isLoopback && !forwarded) return true;

  void insertAuditRowSafe({
    action: blockedAction,
    entityType: "system",
    entityId: null,
    decisionAuthority: "gate",
    input: { path: req.path, remote, forwarded: forwarded ?? null } as Record<string, unknown>,
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
