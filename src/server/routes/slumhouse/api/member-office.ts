/**
 * ⚠ INFRASTRUCTURE ONLY — THIS FEATURE IS NOT YET USABLE (OR-052 §2, F-2, 2026-07-20).
 *
 * There is NO PIN-ESTABLISHMENT PATH. `hashPin()` is called from nowhere in the product and
 * nothing INSERTs into `slumhouse_member_pins`, so no member can ever have a PIN on file.
 * In practice that means: `POST /member/pin` can only ever return 409 `no_pin_set`, no member
 * can obtain a ticket, and therefore EVERY member surface is locked — `/member/scope` returns
 * an empty surface list for everyone.
 *
 * This is FAIL-CLOSED and harmless (test-mode, pre-Phase-5, zero exposure), and the crypto,
 * cross-member isolation and schema beneath it are independently graded band-7 SAFE. But the
 * verify path must not be mistaken for a working feature: **safe and complete are different
 * axes, and this is the first without the second.**
 *
 * PIN provisioning is the immediate next unit. Until it ships, do not wire this into any
 * member-facing flow and do not read a green test suite as evidence the gate works end to end —
 * every existing test supplies its own hash, which is precisely how this gap survived 60
 * passing tests.
 *
 * Per-member Slumhouse office routes (Tier-2 item 6).
 *
 *   POST /slumhouse/api/member/pin           — clear the PIN, mint a purpose-tagged ticket
 *   GET  /slumhouse/api/member/scope         — what THIS member may see
 *   POST /slumhouse/api/member/connect-test  — TEST-MODE broker connect
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
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { slumhouseMemberPins, slumhouseConnectTest } from "../../../db/schema.js";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { evaluateOfficeScope, visibleSurfaces, type OfficeSurface } from "../../../lib/member-office-scope.js";
import { verifyPin, evaluateAttempt, nextAttemptState, PIN_POLICY } from "../../../lib/member-pin.js";
import { validateTestKey, assertStorable, redactKey } from "../../../lib/connect-wizard-mock.js";
import {
  PIN_COOKIE_NAME,
  PIN_TTL_SEC,
  signPinTicket,
  verifyPinTicket,
} from "../../../lib/slumhouse/pin-ticket.js";
import { insertAuditRowSafe } from "../../../lib/audit-log-helper.js";

export const memberOfficeRouter = Router();

/** Members only. The operator has his own Office; this surface is not his. */
function roleOf(req: SlumhouseRequest): "operator" | "member" {
  return req.slumhouseUser?.jerseyNumber === 0 ? "operator" : "member";
}

function readCookie(req: SlumhouseRequest, name: string): string | null {
  const header = req.headers.cookie ?? "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
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

// ── POST /slumhouse/api/member/pin ───────────────────────────────────────────────────────────
memberOfficeRouter.post(
  "/slumhouse/api/member/pin",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
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
    const surfaces = visibleSurfaces(roleOf(req), viewerId, pinSatisfied(req, viewerId, Date.now()));
    // displayName is the member's own; no roster, no other member's data, ever.
    res.json({ displayName: user.displayName, surfaces });
  },
);

// ── POST /slumhouse/api/member/connect-test ──────────────────────────────────────────────────
memberOfficeRouter.post(
  "/slumhouse/api/member/connect-test",
  requireSlumhouseUser,
  async (req: SlumhouseRequest, res: Response) => {
    const viewerId = req.slumhouseUser!.discordUserId;

    // Scope authority decides — this route does not re-implement the rules.
    const decision = evaluateOfficeScope({
      role: roleOf(req),
      viewerId,
      surface: "connect_card" as OfficeSurface,
      targetMemberId: viewerId,
      pinSatisfied: pinSatisfied(req, viewerId, Date.now()),
    });
    if (!decision.allowed) { res.status(403).json({ error: decision.reason }); return; }

    const { brokerKind, key } = (req.body ?? {}) as { brokerKind?: string; key?: unknown };
    const result = validateTestKey(String(brokerKind ?? ""), key);

    if (result.status !== "validated") {
      // Rejected input is NEVER persisted, and the key never reaches the audit row.
      void insertAuditRowSafe({
        action: "member_office.connect_test_rejected",
        status: "info",
        entityType: "slumhouse_user",
        entityId: viewerId,
        result: { brokerKind, reason: result.reason, key: redactKey(key) },
      });
      res.status(400).json({ status: result.status, reason: result.reason });
      return;
    }

    try {
      // assertStorable throws rather than let anything key-shaped reach the DB.
      const ref = assertStorable(result.storableRef);
      const existing = await db.select().from(slumhouseConnectTest)
        .where(and(
          eq(slumhouseConnectTest.discordUserId, viewerId),
          eq(slumhouseConnectTest.brokerKind, String(brokerKind)),
        )).limit(1);

      if (existing[0]) {
        await db.update(slumhouseConnectTest)
          .set({ testKeyRef: ref, status: "validated", validatedAt: new Date(), updatedAt: new Date() })
          .where(eq(slumhouseConnectTest.id, existing[0].id));
      } else {
        await db.insert(slumhouseConnectTest).values({
          discordUserId: viewerId,
          brokerKind: String(brokerKind),
          testKeyRef: ref,
          status: "validated",
          validatedAt: new Date(),
        });
      }
      res.json({ status: "validated", display: result.display });
    } catch {
      res.status(500).json({ status: "rejected", reason: "persist_failed" });
    }
  },
);
