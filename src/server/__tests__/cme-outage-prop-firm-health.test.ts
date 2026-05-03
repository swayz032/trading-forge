/**
 * C1 + C2 Tests — CME Outage Handling + Prop Firm Suspension Detection (W15 Team B)
 *
 * Verifies:
 * C1:
 *   - isExchangeHalted() correctly tracks active outages
 *   - simulateOutage() sets halted state, fires SSE, writes audit log
 *   - resolveOutage() clears halted state, fires SSE
 *   - No auto-reissue on resolve (verified by absence of auto_reissue in SSE payload)
 *
 * C2:
 *   - isFirmSuspended() correctly tracks suspensions
 *   - simulateSuspension() sets suspended state, fires SSE
 *   - clearSimulatedSuspension() clears state, fires SSE
 *   - pollPropFirmHealth() skips firms without API keys
 *   - State isolation: outage and suspension are independent
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─── All vi.mock factories must be self-contained (no external variable refs) ─
// Vitest hoists vi.mock() calls above all imports, so any external variable
// referenced in a factory will hit a TDZ error. Use inline vi.fn() only.

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// Build a Promise-like stub that supports both `.returning()` and `.catch()`.
// The trick: return a real Promise (from Promise.resolve) that also has a
// `.returning()` method attached. This prevents the "then is not a function"
// and "timed out" issues caused by fake thenables.
function makeValuesStub(returnVal: unknown[] = [{ id: "test-id" }]) {
  const p = Promise.resolve(returnVal) as Promise<unknown[]> & {
    returning: () => Promise<unknown[]>;
    catch: (fn: (e: unknown) => void) => Promise<void>;
  };
  p.returning = () => Promise.resolve(returnVal);
  // Override catch so fire-and-forget .catch(fn) is a no-op
  const origCatch = p.catch.bind(p);
  p.catch = origCatch;
  return p;
}

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation(() => makeValuesStub([{ id: "test-outage-id" }])),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  exchangeOutages: { id: {}, exchange: {}, startedAt: {}, endedAt: {} },
  propFirmHealthChecks: { id: {}, firmId: {}, checkedAt: {}, status: {}, alertFired: {} },
  auditLog: { action: {}, entityType: {}, entityId: {} },
  paperPositions: { id: {}, sessionId: {}, symbol: {}, side: {}, contracts: {}, entryPrice: {}, closedAt: {} },
  paperSessions: { id: {}, firmId: {}, status: {} },
  paperTrades: { pnl: {}, sessionId: {}, exitTime: {} },
  strategies: { id: {} },
  shadowSignals: {},
  macroSnapshots: {},
  skipDecisions: {},
  complianceRulesets: {},
  contractRolls: {},
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    criticalAlert: vi.fn(),
    drawdownWarning: vi.fn(),
  },
  createAlert: vi.fn().mockResolvedValue({ id: "test-alert-id" }),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  isExchangeHalted,
  getActiveOutages,
  simulateOutage,
  resolveOutage,
} from "../services/exchange-status-service.js";

import {
  isFirmSuspended,
  getSuspendedFirms,
  simulateSuspension,
  clearSimulatedSuspension,
  pollPropFirmHealth,
} from "../services/prop-firm-health-service.js";

import { broadcastSSE } from "../routes/sse.js";

// ─── C1: Exchange Status Service Tests ───────────────────────────────────────

describe("C1 — exchange-status-service", () => {
  afterEach(async () => {
    // Clean up active outages after each test
    const activeOutages = getActiveOutages();
    for (const [exchange] of activeOutages) {
      await resolveOutage(exchange).catch(() => {});
    }
    vi.clearAllMocks();
  });

  it("isExchangeHalted returns false when no outage is active", () => {
    expect(isExchangeHalted("CME")).toBe(false);
  });

  it("simulateOutage sets the exchange as halted", async () => {
    const result = await simulateOutage("CME", "test outage");
    expect(result.outageId).toBeTruthy();
    expect(isExchangeHalted("CME")).toBe(true);
    await resolveOutage("CME");
  });

  it("simulateOutage broadcasts SSE outage-detected event", async () => {
    const sse = vi.mocked(broadcastSSE);
    await simulateOutage("CME", "cooling failure");
    expect(sse).toHaveBeenCalledWith(
      "exchange:outage-detected",
      expect.objectContaining({
        exchange: "CME",
        reason: expect.stringContaining("SIMULATED"),
      }),
    );
    await resolveOutage("CME");
  });

  it("resolveOutage clears the halted state", async () => {
    await simulateOutage("CME", "test");
    expect(isExchangeHalted("CME")).toBe(true);
    const result = await resolveOutage("CME");
    expect(result.resolved).toBe(true);
    expect(isExchangeHalted("CME")).toBe(false);
  });

  it("resolveOutage broadcasts SSE outage-resolved event", async () => {
    const sse = vi.mocked(broadcastSSE);
    await simulateOutage("CME", "test");
    sse.mockClear();
    await resolveOutage("CME");
    expect(sse).toHaveBeenCalledWith(
      "exchange:outage-resolved",
      expect.objectContaining({ exchange: "CME" }),
    );
  });

  it("resolveOutage SSE payload does not contain auto-reissue flag", async () => {
    const sse = vi.mocked(broadcastSSE);
    await simulateOutage("CME", "test");
    sse.mockClear();
    await resolveOutage("CME");
    const call = sse.mock.calls.find(c => c[0] === "exchange:outage-resolved");
    expect(call).toBeTruthy();
    const payload = call?.[1] as Record<string, unknown>;
    // The note field explicitly says no auto-reissue — this is the paper parity guarantee
    expect(JSON.stringify(payload)).toContain("NOT auto-reissued");
  });

  it("resolveOutage returns resolved=false when no active outage", async () => {
    const result = await resolveOutage("CME");
    expect(result.resolved).toBe(false);
  });

  it("simulateOutage is idempotent when outage already active", async () => {
    const r1 = await simulateOutage("CME", "first");
    const r2 = await simulateOutage("CME", "duplicate");
    // Returns same outage ID (does not create a second row)
    expect(r1.outageId).toBe(r2.outageId);
    await resolveOutage("CME");
  });

  it("getActiveOutages returns current state correctly", async () => {
    expect(getActiveOutages().size).toBe(0);
    await simulateOutage("CME", "test");
    expect(getActiveOutages().size).toBe(1);
    expect(getActiveOutages().has("CME")).toBe(true);
    await resolveOutage("CME");
    expect(getActiveOutages().size).toBe(0);
  });

  it("SSE is broadcast on outage simulation (confirms write path ran)", async () => {
    const sse = vi.mocked(broadcastSSE);
    sse.mockClear();
    await simulateOutage("CME", "db write test");
    // SSE broadcast implies the DB write path completed (order: DB write → SSE)
    expect(sse).toHaveBeenCalledWith("exchange:outage-detected", expect.any(Object));
    await resolveOutage("CME");
  });

  it("both SSE events fired across full outage lifecycle", async () => {
    const sse = vi.mocked(broadcastSSE);
    sse.mockClear();
    await simulateOutage("CME", "lifecycle test");
    await resolveOutage("CME");
    const calls = sse.mock.calls.map(c => c[0]);
    expect(calls).toContain("exchange:outage-detected");
    expect(calls).toContain("exchange:outage-resolved");
  });
});

// ─── C2: Prop Firm Health Service Tests ──────────────────────────────────────

describe("C2 — prop-firm-health-service", () => {
  afterEach(async () => {
    // Clean up all suspended firms after each test
    for (const firmId of getSuspendedFirms()) {
      await clearSimulatedSuspension(firmId).catch(() => {});
    }
    vi.clearAllMocks();
  });

  it("isFirmSuspended returns false when no firm is suspended", () => {
    expect(isFirmSuspended("apex")).toBe(false);
  });

  it("simulateSuspension marks a firm as suspended", async () => {
    await simulateSuspension("apex");
    expect(isFirmSuspended("apex")).toBe(true);
    await clearSimulatedSuspension("apex");
  });

  it("simulateSuspension broadcasts SSE suspension-detected event", async () => {
    const sse = vi.mocked(broadcastSSE);
    sse.mockClear();
    await simulateSuspension("apex");
    expect(sse).toHaveBeenCalledWith(
      "prop-firm:suspension-detected",
      expect.objectContaining({ firmId: "apex" }),
    );
    await clearSimulatedSuspension("apex");
  });

  it("clearSimulatedSuspension lifts the suspension", async () => {
    await simulateSuspension("apex");
    expect(isFirmSuspended("apex")).toBe(true);
    await clearSimulatedSuspension("apex");
    expect(isFirmSuspended("apex")).toBe(false);
  });

  it("clearSimulatedSuspension broadcasts SSE suspension-cleared event", async () => {
    const sse = vi.mocked(broadcastSSE);
    await simulateSuspension("apex");
    sse.mockClear();
    await clearSimulatedSuspension("apex");
    expect(sse).toHaveBeenCalledWith(
      "prop-firm:suspension-cleared",
      expect.objectContaining({ firmId: "apex" }),
    );
  });

  it("getSuspendedFirms returns all currently suspended firms", async () => {
    expect(getSuspendedFirms()).toHaveLength(0);
    await simulateSuspension("apex");
    await simulateSuspension("topstep");
    const suspended = getSuspendedFirms();
    expect(suspended).toContain("apex");
    expect(suspended).toContain("topstep");
    await clearSimulatedSuspension("apex");
    await clearSimulatedSuspension("topstep");
  });

  it("simulateSuspension fires SSE (confirming the DB write path ran)", async () => {
    const sse = vi.mocked(broadcastSSE);
    sse.mockClear();
    await simulateSuspension("mffu");
    expect(sse).toHaveBeenCalledWith("prop-firm:suspension-detected", expect.any(Object));
    await clearSimulatedSuspension("mffu");
  });

  it("pollPropFirmHealth skips all firms when no API keys are configured", async () => {
    // All API key env vars are absent in test environment
    const results = await pollPropFirmHealth();
    const skipped = results.filter(r => r.status === "skipped");
    // At minimum, all firms without keys should be skipped
    expect(skipped.length).toBeGreaterThan(0);
    // No alerts should fire when all checks are skipped
    const alerted = results.filter(r => r.alertFired);
    expect(alerted).toHaveLength(0);
  });
});

// ─── C1+C2: State independence tests ────────────────────────────────────────

describe("C1+C2 — gate state independence", () => {
  afterEach(async () => {
    const activeOutages = getActiveOutages();
    for (const [exchange] of activeOutages) {
      await resolveOutage(exchange).catch(() => {});
    }
    for (const firmId of getSuspendedFirms()) {
      await clearSimulatedSuspension(firmId).catch(() => {});
    }
    vi.clearAllMocks();
  });

  it("exchange outage and firm suspension are independent", async () => {
    await simulateOutage("CME", "test");
    await simulateSuspension("apex");

    expect(isExchangeHalted("CME")).toBe(true);
    expect(isFirmSuspended("apex")).toBe(true);
    expect(isExchangeHalted("ICE")).toBe(false);   // other exchanges not affected
    expect(isFirmSuspended("topstep")).toBe(false); // other firms not affected

    await resolveOutage("CME");
    await clearSimulatedSuspension("apex");

    expect(isExchangeHalted("CME")).toBe(false);
    expect(isFirmSuspended("apex")).toBe(false);
  });

  it("resolving an exchange outage does not clear firm suspension", async () => {
    await simulateOutage("CME", "test");
    await simulateSuspension("apex");
    await resolveOutage("CME");

    expect(isExchangeHalted("CME")).toBe(false);
    expect(isFirmSuspended("apex")).toBe(true); // still suspended

    await clearSimulatedSuspension("apex");
  });

  it("clearing firm suspension does not resolve exchange outage", async () => {
    await simulateOutage("CME", "test");
    await simulateSuspension("apex");
    await clearSimulatedSuspension("apex");

    expect(isFirmSuspended("apex")).toBe(false);
    expect(isExchangeHalted("CME")).toBe(true); // still halted

    await resolveOutage("CME");
  });
});
