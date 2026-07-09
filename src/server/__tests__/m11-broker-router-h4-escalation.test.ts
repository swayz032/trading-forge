/**
 * M11 — broker-router H4 retry-exhaustion escalation tests
 *
 * Verifies that the M11 hardening correctly escalates from notifyWarning →
 * notifyCritical when H4 (commit 55c5807) retry budget is fully exhausted
 * (retryAttempt >= 2 && !success), and that non-exhaustion failure paths
 * keep notifyWarning.
 *
 * 4 tests:
 * 1. Escalates to notifyCritical when retryAttempt >= 2 && !success
 * 2. Preserves notifyWarning for first-attempt 5xx failure (no retry exhaustion)
 * 3. Preserves notifyWarning for 4xx failures (no retry attempted)
 * 4. Includes appendFamilyGradePostscript on the escalated CRITICAL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "audit-id-m11" }]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  brokerAccounts: {},
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["mffu", "topstep"]),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60,
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ violation: false, status: "ok", message: "", violations: [] }),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "test-api-key-m11" }),
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({ success: true, statusCode: 200, responseBody: { ok: true } }),
  buildDeterministicIdempotencyKey: vi.fn(() => "test-idempotency-key"),
}));

vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({
    apiKey: "test-api-key-m11",
    action: "buy",
    ticker: "MES1!",
    orderType: "market",
    positionType: "long",
  }),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (body: string, what: string, action: string) =>
      `${body}\n\n--- For family members ---\nWhat this means: ${what}\nWhat to do: ${action}`,
  ),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  traderspostRejectsTotal: {
    labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
  },
}));

vi.mock("../lib/circuit-breaker.js", () => {
  const mockBreaker = {
    call: vi.fn((fn: () => unknown) => fn()),
    state: "CLOSED",
  };
  return {
    CircuitBreakerRegistry: {
      get: vi.fn().mockReturnValue(mockBreaker),
      setOnStateChange: vi.fn(),
      _resetForTests: vi.fn(),
    },
    CircuitOpenError: class CircuitOpenError extends Error {
      reopensAt = new Date(Date.now() + 60000);
    },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { routeOrder } from "../services/broker-router.js";
import { submitWebhookOrder } from "../integrations/traderspost/client.js";
import { notifyCritical, notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { db } from "../db/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRADERSPOST_ACCOUNT = {
  id: 1,
  accountId: "m11-account-uuid-1234",
  firmId: "mffu",
  brokerType: "traderspost",
  apiKeyVaultRef: "TRADERSPOST_API_KEY_MFFU",
  accountIdExternal: "EXT-M11",
  enabled: true,
  createdAt: new Date(),
};

const TEST_SIGNAL = {
  action: "enter_long" as const,
  ticker: "MES1!",
  quantity: 1,
  orderType: "market" as const,
  strategyId: "strategy-m11-test",
};

function mockSelectReturning(accounts: unknown[]) {
    // @ts-ignore — Drizzle mock partial chain
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(accounts),
      }),
    }),
  } as ReturnType<typeof db.select>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M11 — broker-router H4 retry-exhaustion escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectReturning([TRADERSPOST_ACCOUNT]);
    // @ts-ignore — Drizzle mock
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "audit-id-m11" }]),
    } as ReturnType<typeof db.insert>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1: Retry exhausted → notifyCritical ─────────────────────────────

  it("escalates to notifyCritical when retryAttempt >= 2 && !success", async () => {
    // H4 exhaustion: 3 total attempts consumed, retryAttempt = 2 (index of last attempt)
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 503,
      responseBody: "Service Unavailable",
      error: "HTTP 503 after 3 attempts",
      retryAttempt: 2,
    });

    await routeOrder("m11-account-uuid-1234", TEST_SIGNAL);

    expect(notifyCritical).toHaveBeenCalledOnce();
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  // ─── Test 2: First-attempt 5xx → notifyWarning (retryAttempt=0 means succeeded on next, or no retry occurred) ──

  it("preserves notifyWarning for first-attempt 5xx failure (retryAttempt=0, not exhausted)", async () => {
    // retryAttempt: 0 means first attempt failed 5xx, second attempt also produced this result (still failed)
    // but retryAttempt < 2 so budget not fully exhausted
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 503,
      responseBody: "Service Unavailable",
      error: "HTTP 503 after 1 attempt",
      retryAttempt: 0,
    });

    await routeOrder("m11-account-uuid-1234", TEST_SIGNAL);

    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  // ─── Test 3: 4xx failure (no retry) → notifyWarning ──────────────────────

  it("preserves notifyWarning for 4xx failures (no retry attempted, retryAttempt absent)", async () => {
    // 4xx: no retry is attempted, retryAttempt is undefined
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 400,
      responseBody: "Bad Request",
      error: "HTTP 400",
      // retryAttempt absent — not a 5xx exhaustion
    });

    await routeOrder("m11-account-uuid-1234", TEST_SIGNAL);

    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(notifyCritical).not.toHaveBeenCalled();
  });

  // ─── Test 4: CRITICAL includes appendFamilyGradePostscript ───────────────

  it("includes appendFamilyGradePostscript on the escalated CRITICAL alert", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 503,
      responseBody: "Service Unavailable",
      error: "HTTP 503 after 3 attempts",
      retryAttempt: 2,
    });

    await routeOrder("m11-account-uuid-1234", TEST_SIGNAL);

    // appendFamilyGradePostscript must have been called with the family-grade translation
    expect(appendFamilyGradePostscript).toHaveBeenCalled();
    const [techBody, familyWhat, familyAction] = vi.mocked(appendFamilyGradePostscript).mock.calls[0]!;

    // Technical body must mention retry exhaustion
    expect(techBody).toContain("503");
    expect(techBody).toContain("3 attempts");

    // Family plain-English what: explains the order was not placed
    expect(familyWhat).toMatch(/order.*NOT placed|not responding/i);

    // Family action: directs family to tell Tony
    expect(familyAction).toMatch(/Tony|dashboard/i);

    // The CRITICAL call must receive the wrapped body
    const criticalBody = vi.mocked(notifyCritical).mock.calls[0]?.[1];
    expect(criticalBody).toContain("--- For family members ---");
  });
});
