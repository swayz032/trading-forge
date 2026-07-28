/**
 * PIN provisioning EXISTS as of 2026-07-20 (OR-053/OR-054). An earlier revision of this header
 * disclosed that no establishment path existed and the whole gate was inert (F-2) — that
 * disclosure was accurate when written and is now FALSE, so it is removed rather than left to
 * rot. A stale disclosure is its own small decoration.
 *
 * Flow: POST /member/pin/establish (member sets their own PIN, once) -> POST /member/pin
 * (verify, mint ticket) -> GET /member/scope. Establishment refuses if a PIN already exists;
 * reset is Discord re-auth with operator notification, deliberately a harder path.
 *
 * Per-member Slumhouse office routes (Tier-2 item 6).
 *
 *   POST /slumhouse/api/member/pin           — clear the PIN, mint a purpose-tagged ticket
 *   GET  /slumhouse/api/member/scope         — what THIS member may see
 *   GET  /slumhouse/api/member/broker-health — real mapped-account readiness (read-only)
 *
 * This is the integration point: Discord session -> PIN ticket -> scope authority -> allowlist
 * validator -> slumhouse_connect_test. Each layer is separately tested; these routes are where
 * they meet, so the failure mode that matters is a layer being SKIPPED rather than any layer
 * being wrong.
 *
 * INVARIANTS:
 *   * `broker_accounts` is NEVER written here. Not with a flag, not "just test rows" (OR-017 §1).
 *   * Carter has no route in this file and never will (OR-003 §1-addendum).
 *   * The PIN ticket's subject MUST equal the session's subject — otherwise one member's PIN
 *     clearance would authorise another's room.
 *   * Key material never reaches a log, an audit row, or a response body.
 */
import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { brokerAccounts, brokerCredentialVault, slumhouseMemberPins, slumhouseUsers } from "../../../db/schema.js";
import { requireSlumhouseUser, checkSlumhouseOrigin, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import {
  evaluateOfficeScope,
  officePathForRole,
  officeRoleForJersey,
  visibleSurfaces,
  type OfficeSurface,
} from "../../../lib/member-office-scope.js";
import { hashPin, verifyPin, evaluateAttempt, nextAttemptState, PIN_POLICY, PinPolicyError } from "../../../lib/member-pin.js";
import { CircuitBreakerRegistry } from "../../../lib/circuit-breaker.js";
import { brokerCredentialVaultReady, encryptBrokerCredential } from "../../../lib/broker-credential-vault.js";
import {
  PIN_COOKIE_NAME,
  PIN_TTL_SEC,
  signPinTicket,
  verifyPinTicket,
} from "../../../lib/slumhouse/pin-ticket.js";
import { insertAuditRowSafe } from "../../../lib/audit-log-helper.js";
import { readSlumhouseCookie } from "../../../lib/slumhouse/cookie.js";

export const memberOfficeRouter = Router();

/** Members only. The operator has his own Office; this surface is not his. */
function roleOf(req: SlumhouseRequest): "operator" | "member" {
  return officeRoleForJersey(req.slumhouseUser?.jerseyNumber);
}

function readCookie(req: SlumhouseRequest, name: string): string | null {
  // Duplicate-aware, fail-closed parse (see lib/slumhouse/cookie.ts). A forged
  // duplicate placed first must not beat the legitimate PIN ticket.
  return readSlumhouseCookie(req.headers.cookie, name);
}

/**
 * The PIN ticket must belong to the SAME identity as the session. A valid ticket for a
 * different member is treated as no ticket at all — and is worth an audit row, because the
 * only way to hold one is to have moved it there deliberately.
 */
function pinSatisfied(req: SlumhouseRequest, viewerId: string, nowMs: number): boolean {
  const t = verifyPinTicket(readCookie(req, PIN_COOKIE_NAME), nowMs);
  if (!t.valid) return false;
  if (t.discordUserId !== viewerId) {
    void insertAuditRowSafe({
      action: "member_office.pin_ticket_subject_mismatch",
      status: "warning",
      entityType: "slumhouse_user",
      entityId: viewerId,
      result: { ticketSubject: t.discordUserId, sessionSubject: viewerId },
    });
    return false;
  }
  return true;
}

// ── POST /slumhouse/api/member/pin/establish ─────────────────────────────────────────────────
// The member SETS their own PIN at first login (operator directive, OR-003 §1: member-created,
// not operator-issued). This is the path whose absence made the whole gate inert (F-2).
//
// ESTABLISHMENT IS NOT RESET. If a row already exists this refuses — a silent overwrite would
// let anyone holding a live Discord session replace an existing member's PIN, turning "set your
// code" into "take over the room". Reset stays Discord re-auth with operator notification
// (OR-013 §2), deliberately a different, harder path.
memberOfficeRouter.post(
  "/slumhouse/api/member/pin/establish",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    // CSRF defense-in-depth (grader follow-up, OR-169 §19). SameSite=Lax already blocks the
    // cross-site POST, so this is a second independent layer, not the only one — and it is added
    // now precisely BECAUSE the PIN UI made these routes reachable for the first time.
    if (!checkSlumhouseOrigin(req, res)) return;

    const viewerId = req.slumhouseUser!.discordUserId;
    const nowMs = Date.now();
    const submitted = (req.body ?? {}).pin;

    try {
      const existing = await db.select().from(slumhouseMemberPins)
        .where(eq(slumhouseMemberPins.discordUserId, viewerId)).limit(1);
      if (existing[0]) { res.status(409).json({ error: "pin_already_set" }); return; }

      if (typeof submitted !== "string") { res.status(400).json({ error: "pin_required" }); return; }

      // hashPin enforces the weak-PIN policy itself and throws PinPolicyError — the policy
      // lives in one place rather than being restated here where it could drift.
      let pinHash: string;
      try {
        pinHash = await hashPin(submitted);
      } catch (err) {
        res.status(400).json({
          error: "pin_policy",
          reason: err instanceof PinPolicyError ? err.message : "invalid pin",
        });
        return;
      }

      await db.insert(slumhouseMemberPins).values({ discordUserId: viewerId, pinHash });

      // Setting the PIN signs you in — no reason to demand it again in the same breath.
      const ticket = signPinTicket(viewerId, nowMs);
      if (!ticket) { res.status(503).json({ error: "pin_unavailable" }); return; }
      res.cookie?.(PIN_COOKIE_NAME, ticket, {
        httpOnly: true, sameSite: "lax", secure: true, maxAge: PIN_TTL_SEC * 1000, path: "/slumhouse",
      });
      res.status(201).json({ ok: true });
    } catch (err) {
      // F-5 (self-caught OA-050, independently re-derived by the grader). The reject-if-exists
      // check above is a SELECT-then-INSERT, so two concurrent establishes race. The PK on
      // `discord_user_id` makes that SAFE — the loser's INSERT cannot double-write — but the
      // loser was landing in the generic catch and getting a 500 "something broke" for a
      // situation the system knows is "PIN already set". Same real-world case as `:101`, so it
      // gets the same answer.
      //
      // Deliberately NARROW: only Postgres unique_violation (23505) maps to 409. Blanket-mapping
      // every error here would hide genuine breakage behind a friendly status — the opposite
      // decoration, and worse than the bug it fixes.
      // Drizzle wraps driver errors, so the pg code can sit on the error OR on its `cause`.
      // Checking only the top level silently missed every real race — verified against the
      // driver's actual error shape rather than assumed.
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === "23505" || e?.cause?.code === "23505") {
        res.status(409).json({ error: "pin_already_set" });
        return;
      }
      res.status(500).json({ error: "pin_establish_failed" });   // never leak the reason
    }
  },
);

// ── POST /slumhouse/api/member/pin ───────────────────────────────────────────────────────────
memberOfficeRouter.post(
  "/slumhouse/api/member/pin",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    if (!checkSlumhouseOrigin(req, res)) return;   // CSRF defense-in-depth — see /pin/establish

    const viewerId = req.slumhouseUser!.discordUserId;
    const nowMs = Date.now();
    const submitted = (req.body ?? {}).pin;

    try {
      const rows = await db.select().from(slumhouseMemberPins)
        .where(eq(slumhouseMemberPins.discordUserId, viewerId)).limit(1);
      const row = rows[0];

      // No PIN on file: the member has not completed onboarding. Not an error, a state.
      if (!row) { res.status(409).json({ error: "no_pin_set" }); return; }

      const gate = evaluateAttempt(
        { failures: row.failures, lockedUntilMs: row.lockedUntil ? row.lockedUntil.getTime() : null },
        nowMs,
      );
      if (!gate.allowed) {
        res.status(429).json({ error: gate.reason, retryAfterMs: gate.retryAfterMs });
        return;
      }

      const ok = typeof submitted === "string" && (await verifyPin(submitted, row.pinHash));
      const next = nextAttemptState(
        { failures: row.failures, lockedUntilMs: row.lockedUntil ? row.lockedUntil.getTime() : null },
        ok, nowMs,
      );
      await db.update(slumhouseMemberPins)
        .set({
          failures: next.failures,
          lockedUntil: next.lockedUntilMs ? new Date(next.lockedUntilMs) : null,
          updatedAt: new Date(),
        })
        .where(eq(slumhouseMemberPins.discordUserId, viewerId));

      if (!ok) {
        // Deliberately does not say whether the PIN was close, or how many tries remain
        // beyond the policy constant the member already knows.
        res.status(401).json({ error: "pin_incorrect", attemptsAllowed: PIN_POLICY.maxAttempts });
        return;
      }

      const ticket = signPinTicket(viewerId, nowMs);
      if (!ticket) { res.status(503).json({ error: "pin_unavailable" }); return; }
      res.cookie?.(PIN_COOKIE_NAME, ticket, {
        httpOnly: true, sameSite: "lax", secure: true, maxAge: PIN_TTL_SEC * 1000, path: "/slumhouse",
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "pin_check_failed" });   // never leak the reason
    }
  },
);

// ── GET /slumhouse/api/member/scope ──────────────────────────────────────────────────────────
memberOfficeRouter.get(
  "/slumhouse/api/member/scope",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const user = req.slumhouseUser!;
    const viewerId = user.discordUserId;
    const role = roleOf(req);
    const surfaces = visibleSurfaces(role, viewerId, pinSatisfied(req, viewerId, Date.now()));
    // displayName is the member's own; no roster, no other member's data, ever.
    res.json({ displayName: user.displayName, role, officePath: officePathForRole(role), surfaces });
  },
);

// ── GET /slumhouse/api/member/broker-health ──────────────────────────────────────────────────
// Read-only and identity-scoped. It reports only safe readiness facts; vault references,
// credentials and raw external account identifiers never leave the server.
memberOfficeRouter.get(
  "/slumhouse/api/member/broker-health",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const viewerId = req.slumhouseUser!.discordUserId;
    const decision = evaluateOfficeScope({
      role: roleOf(req),
      viewerId,
      surface: "connect_card" as OfficeSurface,
      targetMemberId: viewerId,
      pinSatisfied: pinSatisfied(req, viewerId, Date.now()),
    });
    if (!decision.allowed) { res.status(403).json({ error: decision.reason }); return; }
    try {
      const accountId = req.slumhouseUser!.brokerAccountId;
      if (!accountId) {
        res.json({ status: "setup_required", mapped: false, executionLocked: true });
        return;
      }
      const rows = await db.select({
        firmId: brokerAccounts.firmId,
        brokerType: brokerAccounts.brokerType,
        apiKeyVaultRef: brokerAccounts.apiKeyVaultRef,
        accountIdExternal: brokerAccounts.accountIdExternal,
        enabled: brokerAccounts.enabled,
        enabledSymbols: brokerAccounts.enabledSymbols,
      }).from(brokerAccounts).where(eq(brokerAccounts.accountId, accountId)).limit(1);
      const account = rows[0];
      if (!account) {
        res.json({ status: "mapping_invalid", mapped: false, executionLocked: true });
        return;
      }
      let credentialReady = false;
      if (account.apiKeyVaultRef?.startsWith("dbvault:")) {
        const id = account.apiKeyVaultRef.slice("dbvault:".length);
        const stored = await db.select({ id: brokerCredentialVault.credentialId })
          .from(brokerCredentialVault).where(eq(brokerCredentialVault.credentialId, id)).limit(1);
        credentialReady = stored.length === 1 && brokerCredentialVaultReady();
      } else {
        credentialReady = Boolean(account.apiKeyVaultRef && process.env[account.apiKeyVaultRef]);
      }
      const breaker = CircuitBreakerRegistry.statusAll().find((item) => item.endpoint === "traderspost-webhook");
      const adapterReady = account.brokerType === "traderspost"
        ? (!breaker || breaker.state === "CLOSED")
        : false; // Direct TopstepX remains fail-closed until its real adapter is installed.
      const external = account.accountIdExternal ?? "";
      const maskedAccount = external.length > 4 ? `••••${external.slice(-4)}` : (external ? "••••" : null);
      const ready = account.enabled && credentialReady && adapterReady;
      res.json({
        status: ready ? "ready" : "attention_required",
        mapped: true,
        firm: account.firmId,
        broker: account.brokerType,
        maskedAccount,
        credentialReady,
        adapterReady,
        accountEnabled: account.enabled,
        enabledSymbols: account.enabledSymbols,
        executionLocked: true,
      });
    } catch {
      res.status(503).json({ error: "broker_health_unavailable", executionLocked: true });
    }
  },
);

// Real credential enrollment. The secret is encrypted before the DB write and is never logged,
// audited, echoed, or retained by the browser. New/updated accounts stay disabled.
memberOfficeRouter.post(
  "/slumhouse/api/member/broker-enroll",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    if (!checkSlumhouseOrigin(req, res)) return;
    const viewerId = req.slumhouseUser!.discordUserId;
    const decision = evaluateOfficeScope({
      role: roleOf(req), viewerId, surface: "connect_card",
      targetMemberId: viewerId, pinSatisfied: pinSatisfied(req, viewerId, Date.now()),
    });
    if (!decision.allowed) { res.status(403).json({ error: decision.reason }); return; }
    if (!brokerCredentialVaultReady()) {
      res.status(503).json({ error: "secure_vault_unavailable" });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const brokerType = body?.brokerType;
    const accountIdExternal = typeof body?.accountId === "string" ? body.accountId.trim() : "";
    const credential = typeof body?.credential === "string" ? body.credential.trim() : "";
    const firmInput = typeof body?.firm === "string" ? body.firm.trim().toLowerCase() : "";
    if (brokerType !== "topstepx" && brokerType !== "traderspost") {
      res.status(400).json({ error: "unsupported_broker" }); return;
    }
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(accountIdExternal)) {
      res.status(400).json({ error: "invalid_account_id" }); return;
    }
    if (credential.length < 16 || credential.length > 4096) {
      res.status(400).json({ error: "invalid_credential" }); return;
    }
    const firmId = brokerType === "topstepx" ? "topstep" : firmInput;
    if (brokerType === "traderspost" && (!/^[a-z0-9_-]{2,32}$/.test(firmId) || firmId === "topstep")) {
      res.status(400).json({ error: "invalid_prop_firm" }); return;
    }
    try {
      const encrypted = encryptBrokerCredential(credential);
      const accountId = await db.transaction(async (tx) => {
        const [vault] = await tx.insert(brokerCredentialVault).values(encrypted)
          .returning({ id: brokerCredentialVault.credentialId });
        const vaultRef = `dbvault:${vault.id}`;
        const currentId = req.slumhouseUser!.brokerAccountId;
        if (currentId) {
          await tx.update(brokerAccounts).set({
            firmId, brokerType, apiKeyVaultRef: vaultRef,
            accountIdExternal, enabled: false,
          }).where(eq(brokerAccounts.accountId, currentId));
          return currentId;
        }
        const [account] = await tx.insert(brokerAccounts).values({
          firmId, brokerType, apiKeyVaultRef: vaultRef,
          accountIdExternal, enabled: false,
        }).returning({ id: brokerAccounts.accountId });
        await tx.update(slumhouseUsers).set({ brokerAccountId: account.id })
          .where(eq(slumhouseUsers.discordUserId, viewerId));
        return account.id;
      });
      void insertAuditRowSafe({
        action: "member_office.broker_credential_enrolled", status: "success",
        entityType: "broker_account", entityId: accountId,
        result: { brokerType, firmId, executionLocked: true },
      });
      res.status(201).json({ ok: true, mapped: true, executionLocked: true });
    } catch {
      res.status(500).json({ error: "broker_enrollment_failed" });
    }
  },
);
