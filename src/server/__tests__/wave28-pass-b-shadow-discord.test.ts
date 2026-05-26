/**
 * wave28-pass-b-shadow-discord.test.ts — Wave 28 Pass B.2
 *
 * Tests for composite-shadow-discord-router.ts
 *
 * Test matrix:
 *  1. agree_allow         → no Discord, no audit beyond B.1
 *  2. agree_block         → no Discord, no audit
 *  3. shadow_no_opinion   → no Discord, no audit
 *  4. disagree_shadow_blocks  → Discord post + composite.shadow_disagreement_alerted audit
 *  5. disagree_shadow_allows  → Discord post + composite.shadow_disagreement_alerted audit
 *  6. Rate limit: same (strategyId, agreement) called twice within 24h
 *               → second call emits composite.shadow_disagreement_rate_limited, no Discord
 *  7. Rate limit: different agreement type for same strategy → both alerts go through
 *  8. Discord throws → caught + composite.shadow_disagreement_discord_failed audit,
 *                     caller does not see exception
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── insertAuditRowSafe mock ──────────────────────────────────────────────────
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));

// ── notification-helpers mock ─────────────────────────────────────────────────
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string, what: string, action: string) =>
    `${body}\n\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
  ),
}));

// ── notifyInfo mock ──────────────────────────────────────────────────────────
const mockNotifyInfo = vi.fn();

vi.mock("../services/notification-service.js", () => ({
  notifyInfo: mockNotifyInfo,
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

// ── composite-shadow-gate type (no DB needed) ────────────────────────────────
// We only import the ShadowResult type; no db calls from the router itself.
// The ShadowResult fixtures are hand-crafted below.

// ─── Fixtures ────────────────────────────────────────────────────────────────

import type { ShadowAuditPayload, AgreementLabel } from "../lib/composite-shadow-discord-router.js";
import type { ShadowResult } from "../lib/composite-shadow-gate.js";

function makeShadowResult(
  overrides: Partial<ShadowResult> = {},
): ShadowResult {
  return {
    availability: "available",
    composite_score: 0.80,
    verdict: "HEALTHY",
    weights_version_id: "abcd1234",
    evaluated_at: new Date(),
    staleness_age_hours: 1,
    computed_from_n_subsystems: 10,
    shadow_decision: "WOULD_PROMOTE",
    reason: "composite.would_promote",
    ...overrides,
  };
}

function makePayload(
  agreement: AgreementLabel,
  shadowOverrides: Partial<ShadowResult> = {},
): ShadowAuditPayload {
  return {
    strategyId: "strat-test-42",
    strategyName: "test_strategy",
    hardGateOutcome: agreement.startsWith("agree_allow") || agreement === "disagree_shadow_blocks"
      ? "allowed"
      : "blocked",
    shadow_result: makeShadowResult(shadowOverrides),
    agreement,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("composite-shadow-discord-router — routeShadowDisagreementAlert", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset rate-limit state between tests
    const { _resetRateLimitForTest } = await import("../lib/composite-shadow-discord-router.js");
    _resetRateLimitForTest();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("1. agree_allow → no Discord, no audit emitted", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    await routeShadowDisagreementAlert(makePayload("agree_allow"));

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("2. agree_block → no Discord, no audit emitted", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    await routeShadowDisagreementAlert(makePayload("agree_block", {
      shadow_decision: "WOULD_BLOCK",
      verdict: "CRITICAL",
      composite_score: 0.15,
    }));

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("3. shadow_no_opinion → no Discord, no audit emitted", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    await routeShadowDisagreementAlert(makePayload("shadow_no_opinion", {
      availability: "missing",
      shadow_decision: "NO_OPINION",
      composite_score: null,
      verdict: null,
    }));

    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("4. disagree_shadow_blocks → Discord post + shadow_disagreement_alerted audit", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    await routeShadowDisagreementAlert(makePayload("disagree_shadow_blocks", {
      shadow_decision: "WOULD_BLOCK",
      verdict: "CRITICAL",
      composite_score: 0.15,
    }));

    expect(mockNotifyInfo).toHaveBeenCalledOnce();
    const [title, body, meta] = mockNotifyInfo.mock.calls[0];
    expect(title).toContain("Shadow");
    expect(body).toContain("disagree_shadow_blocks");
    expect((meta as Record<string, unknown>).agreement).toBe("disagree_shadow_blocks");

    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = mockInsertAuditRowSafe.mock.calls[0][0];
    expect(auditCall.action).toBe("composite.shadow_disagreement_alerted");
    expect(auditCall.result.rate_limited).toBe(false);
    expect(auditCall.result.agreement).toBe("disagree_shadow_blocks");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("5. disagree_shadow_allows → Discord post + shadow_disagreement_alerted audit", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    await routeShadowDisagreementAlert(makePayload("disagree_shadow_allows", {
      shadow_decision: "WOULD_PROMOTE",
      verdict: "HEALTHY",
      composite_score: 0.85,
    }));

    expect(mockNotifyInfo).toHaveBeenCalledOnce();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = mockInsertAuditRowSafe.mock.calls[0][0];
    expect(auditCall.action).toBe("composite.shadow_disagreement_alerted");
    expect(auditCall.result.agreement).toBe("disagree_shadow_allows");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("6. rate limit: same (strategyId, agreement) twice → second call emits rate_limited audit, no Discord", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    const payload = makePayload("disagree_shadow_blocks", {
      shadow_decision: "WOULD_BLOCK",
      verdict: "CRITICAL",
      composite_score: 0.15,
    });

    // First call — should go through
    await routeShadowDisagreementAlert(payload);
    expect(mockNotifyInfo).toHaveBeenCalledOnce();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    expect(mockInsertAuditRowSafe.mock.calls[0][0].action).toBe("composite.shadow_disagreement_alerted");

    vi.clearAllMocks();

    // Second call — should be rate-limited
    await routeShadowDisagreementAlert(payload);
    expect(mockNotifyInfo).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = mockInsertAuditRowSafe.mock.calls[0][0];
    expect(auditCall.action).toBe("composite.shadow_disagreement_rate_limited");
    expect(auditCall.result.rate_limited).toBe(true);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("7. rate limit: different agreement type for same strategy → both alerts go through", async () => {
    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    const payloadA = makePayload("disagree_shadow_blocks", {
      shadow_decision: "WOULD_BLOCK",
      verdict: "CRITICAL",
      composite_score: 0.15,
    });
    const payloadB: ShadowAuditPayload = {
      ...makePayload("disagree_shadow_allows", {
        shadow_decision: "WOULD_PROMOTE",
        verdict: "HEALTHY",
        composite_score: 0.85,
      }),
      strategyId: "strat-test-42", // same strategyId, different agreement type
    };

    await routeShadowDisagreementAlert(payloadA);
    vi.clearAllMocks();

    // Different agreement key → not rate limited
    await routeShadowDisagreementAlert(payloadB);
    expect(mockNotifyInfo).toHaveBeenCalledOnce();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    expect(mockInsertAuditRowSafe.mock.calls[0][0].action).toBe("composite.shadow_disagreement_alerted");
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("8. Discord throws → caught + shadow_disagreement_discord_failed audit, no rethrow", async () => {
    mockNotifyInfo.mockImplementationOnce(() => {
      throw new Error("Discord webhook timeout");
    });

    const { routeShadowDisagreementAlert } = await import("../lib/composite-shadow-discord-router.js");

    // Must NOT throw
    await expect(
      routeShadowDisagreementAlert(makePayload("disagree_shadow_blocks")),
    ).resolves.toBeUndefined();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledOnce();
    const auditCall = mockInsertAuditRowSafe.mock.calls[0][0];
    expect(auditCall.action).toBe("composite.shadow_disagreement_discord_failed");
    expect(auditCall.result.error).toContain("Discord webhook timeout");
    expect(auditCall.status).toBe("warning");
  });
});
