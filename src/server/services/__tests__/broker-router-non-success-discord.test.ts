/**
 * broker-router-non-success-discord.test.ts — Pass 4 Track C
 *
 * Verifies that every TradersPost per-call non-success (4xx/5xx/timeout)
 * fires notifyWarning with a family-grade postscript to Discord, increments
 * the tf_broker_router_traderspost_rejects_total Prometheus counter with
 * correct labels, and that the success path does NOT fire notifyWarning.
 *
 * Also regression-tests that credential-load failures still fire notifyCritical
 * (NOT notifyWarning) — those are handled at broker-router.ts:664, not here.
 *
 * Tests:
 *  1. HTTP 400 → notifyWarning called once with family-grade postscript body
 *  2. HTTP 500 → notifyWarning called once with correct HTTP status in body
 *  3. Timeout (statusCode=undefined) → notifyWarning with degraded "unknown" body
 *  4. Success (HTTP 200) → notifyWarning NOT called
 *  5. Credential-load failure → notifyCritical (regression), notifyWarning NOT called
 *  6. Prometheus counter increments with correct status_code + signal_action labels
 *  7. Prometheus counter NOT incremented on success path
 *  8. Response body is truncated to ≤200 chars in the warning message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist shared spy refs above vi.mock() factories ─────────────────────────
// vi.hoisted() runs before vi.mock() factories, so refs are safe to capture.
const { mockNotifyWarning, mockNotifyCritical, mockInc, mockLabels } = vi.hoisted(() => {
  const mockInc = vi.fn();
  const mockLabels = vi.fn();
  // Set a stable default implementation: always returns { inc: mockInc }
  // regardless of vi.clearAllMocks() because we re-set in beforeEach.
  mockLabels.mockReturnValue({ inc: mockInc });
  return {
    mockNotifyWarning: vi.fn(),
    mockNotifyCritical: vi.fn(),
    mockInc,
    mockLabels,
  };
});

// ─── vi.mock factories ─────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "test-audit-id" }]),
    }),
  },
}));

vi.mock("../../db/schema.js", () => ({
  brokerAccounts: {},
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../../services/strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue(["mffu", "topstep"]),
}));

vi.mock("../../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 60,
}));

vi.mock("../../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({
    violation: false,
    status: "ok",
    message: "",
    violations: [],
  }),
}));

vi.mock("../../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue({ apiKey: "test-api-key-abc123" }),
}));

vi.mock("../../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn().mockResolvedValue({
    success: true,
    statusCode: 200,
    responseBody: { ok: true },
  }),
  buildDeterministicIdempotencyKey: vi.fn(() => "test-idempotency-key"),
}));

vi.mock("../../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn().mockReturnValue({
    apiKey: "test-api-key-abc123",
    action: "buy",
    ticker: "MES1!",
    orderType: "market",
    positionType: "long",
  }),
}));

// notification-service — references hoisted spies; safe here
vi.mock("../../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: mockNotifyWarning,
  notify: vi.fn(),
  flushNotifications: vi.fn(),
}));

// metrics-registry — references hoisted spies; safe here
vi.mock("../../lib/metrics-registry.js", () => ({
  traderspostRejectsTotal: { labels: mockLabels },
  // Stubs for anything else broker-router or its transitive imports may reference
  circuitBreakerState: { set: vi.fn() },
  circuitBreakerFailures: { set: vi.fn() },
  httpRequestDurationMs: { observe: vi.fn(), startTimer: vi.fn() },
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  backtestRuns: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  paperTrades: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  warningSeverityDiscordRoutedTotal: {
    labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
  },
  archetypeSignalsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  promRegistry: { register: vi.fn() },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { routeOrder } from "../../services/broker-router.js";
import { submitWebhookOrder } from "../../integrations/traderspost/client.js";
import { loadBrokerCredentials } from "../../lib/credential-loader.js";
import { db } from "../../db/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TRADERSPOST_ACCOUNT = {
  id: 1,
  accountId: "test-account-uuid-tp-9999",
  firmId: "mffu",
  brokerType: "traderspost",
  apiKeyVaultRef: "TRADERSPOST_API_KEY_MFFU",
  accountIdExternal: "EXT-9999",
  enabled: true,
  createdAt: new Date(),
};

const TEST_SIGNAL = {
  action: "enter_long" as const,
  ticker: "MES1!",
  quantity: 1,
  orderType: "market" as const,
  strategyId: "strategy-uuid-abc",
};

function mockSelectReturning(accounts: unknown[]) {
  // @ts-ignore — partial Drizzle builder mock (W0.3 2026-06-22 pattern)
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(accounts),
      }),
    }),
  } as ReturnType<typeof db.select>);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("broker-router — non-success Discord visibility (Pass 4 Track C)", () => {
  beforeEach(() => {
    // vi.clearAllMocks() clears call history AND wipes mockReturnValue/mockResolvedValue
    // implementations set both in vi.mock() factories AND in individual tests.
    // We must re-establish ALL per-test defaults immediately after the clear.
    vi.clearAllMocks();
    // Restore labels() chain — cleared by vi.clearAllMocks()
    mockLabels.mockReturnValue({ inc: mockInc });
    // Restore credential loader default — cleared by vi.clearAllMocks().
    // Without this, loadBrokerCredentials returns undefined → creds.apiKey throws
    // → credential failure branch fires → TradersPost dispatch never reached.
    vi.mocked(loadBrokerCredentials).mockResolvedValue({ apiKey: "test-api-key-abc123" });
    // Restore submitWebhookOrder to success default; individual tests override as needed
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: true,
      statusCode: 200,
      responseBody: { ok: true },
    });
    mockSelectReturning([TRADERSPOST_ACCOUNT]);
    // @ts-ignore — partial Drizzle builder mock (W0.3 2026-06-22 pattern)
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "audit-id" }]),
    } as ReturnType<typeof db.insert>);
  });

  // ─── Test 1 ──────────────────────────────────────────────────────────────────

  it("HTTP 400 from TradersPost → notifyWarning called once with family-grade postscript body", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 400,
      responseBody: '{"error":"bad request"}',
      error: "TradersPost returned 400",
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();

    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string];
    // Title must identify the ticker and intent
    expect(title).toContain("TradersPost reject");
    expect(title).toContain("MES1!");
    // Technical body must include HTTP status and account context
    expect(body).toContain("400");
    expect(body).toContain("test-account-uuid-tp-9999");
    // Family-grade postscript separator and content
    expect(body).toContain("--- For family members ---");
    expect(body).toContain("The order did NOT reach the broker");
    expect(body).toContain("Tell Tony");
  });

  // ─── Test 2 ──────────────────────────────────────────────────────────────────

  it("HTTP 503 from TradersPost → notifyWarning called with correct status code in body", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 503,
      responseBody: "Service Unavailable",
      error: "TradersPost returned 503",
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [, body] = mockNotifyWarning.mock.calls[0] as [string, string];
    expect(body).toContain("503");
    expect(body).toContain("--- For family members ---");
  });

  // ─── Test 3 ──────────────────────────────────────────────────────────────────

  it("Timeout (statusCode=undefined) → notifyWarning with degraded 'unknown' body", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: undefined,
      responseBody: undefined,
      error: "Request timed out",
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string];
    expect(title).toContain("TradersPost reject");
    // Degraded path: status code reported as "unknown"
    expect(body).toContain("unknown");
    // Family postscript still present in degraded path
    expect(body).toContain("--- For family members ---");
  });

  // ─── Test 4 ──────────────────────────────────────────────────────────────────

  it("Success (HTTP 200) → notifyWarning NOT called", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: true,
      statusCode: 200,
      responseBody: { ok: true },
    });

    const result = await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(result.success).toBe(true);
    expect(mockNotifyWarning).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
  });

  // ─── Test 5 ──────────────────────────────────────────────────────────────────

  it("Credential-load failure → notifyCritical (NOT notifyWarning) — regression check", async () => {
    vi.mocked(loadBrokerCredentials).mockRejectedValue(
      new Error("Vault unreachable: ETIMEDOUT"),
    );

    const result = await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("credential_load_error");
    // Credential failure path is SYSTEMIC → must use CRITICAL severity
    expect(mockNotifyCritical).toHaveBeenCalledOnce();
    // Per-call WARNING must NOT fire on a credential failure
    expect(mockNotifyWarning).not.toHaveBeenCalled();
    // submitWebhookOrder must never have been reached
    expect(submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ─── Test 6 ──────────────────────────────────────────────────────────────────

  it("Prometheus counter increments with correct status_code and signal_action labels on reject", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 422,
      responseBody: '{"error":"unprocessable entity"}',
      error: "422 Unprocessable Entity",
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    // labels() must have been called with the correct label object
    expect(mockLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        status_code: "422",
        signal_action: "enter_long",
      }),
    );
    // inc() must have been called exactly once
    expect(mockInc).toHaveBeenCalledOnce();
  });

  // ─── Test 7 ──────────────────────────────────────────────────────────────────

  it("Prometheus counter NOT incremented on success path", async () => {
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: true,
      statusCode: 200,
      responseBody: { ok: true },
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(mockInc).not.toHaveBeenCalled();
  });

  // ─── Test 8 ──────────────────────────────────────────────────────────────────

  it("Response body is truncated to ≤200 chars in the warning message body", async () => {
    // A string body longer than 200 characters
    const longBody = "x".repeat(500);
    vi.mocked(submitWebhookOrder).mockResolvedValue({
      success: false,
      statusCode: 400,
      responseBody: longBody,
      error: "TradersPost returned 400",
    });

    await routeOrder("test-account-uuid-tp-9999", TEST_SIGNAL);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [, body] = mockNotifyWarning.mock.calls[0] as [string, string];
    // Extract only the technical-body portion (before the family-grade separator)
    const techBodyLine = body.split("\n\n--- For family members ---")[0] ?? "";
    const bodyValueMatch = techBodyLine.match(/body=(.*)$/s);
    expect(bodyValueMatch).not.toBeNull();
    const bodyValue = bodyValueMatch![1] ?? "";
    // Must not exceed 200 chars — this is the truncation contract
    expect(bodyValue.length).toBeLessThanOrEqual(200);
    // Must be exactly the first 200 chars of the long body string
    expect(bodyValue).toBe("x".repeat(200));
  });
});
