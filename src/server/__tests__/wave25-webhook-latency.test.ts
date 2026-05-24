/**
 * wave25-webhook-latency.test.ts — Wave 25 Gap 4
 *
 * Tests for webhook-latency-monitor-service.ts covering:
 *   1. Synthetic audit rows fed through, percentile math verified
 *   2. Alarm fires when p95 > 2000ms
 *   3. No alarm when p95 <= 2000ms
 *   4. Empty sample → no alarm
 *   5. Dedupe — alarm already fired within 1h → no double-fire
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../../server/db/schema.js", () => ({
  auditLog: { $inferInsert: {} },
}));

vi.mock("../../server/routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getModules() {
  const { db } = await import("../../server/db/index.js");
  const { broadcastSSE } = await import("../../server/routes/sse.js");
  const { notifyWarning } = await import("../../server/services/notification-service.js");
  const { computeRolling1hLatencyP95, runWebhookLatencyCheck, __test__ } = await import(
    "../../server/services/webhook-latency-monitor-service.js"
  );
  return { db, broadcastSSE, notifyWarning, computeRolling1hLatencyP95, runWebhookLatencyCheck, __test__ };
}

function makeAuditRows(latencies: number[]) {
  return latencies.map((ms) => ({
    result: { fire_to_ack_ms: ms, source: "traderspost" },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computePercentiles (unit)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("computes p50 and p95 correctly for known distribution", async () => {
    const { __test__ } = await getModules();
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const { p50, p95 } = __test__.computePercentiles(values);
    expect(p50).toBe(500);
    expect(p95).toBe(1000);
  });

  it("returns null for empty array", async () => {
    const { __test__ } = await getModules();
    const { p50, p95 } = __test__.computePercentiles([]);
    expect(p50).toBeNull();
    expect(p95).toBeNull();
  });

  it("single value → p50 = p95 = that value", async () => {
    const { __test__ } = await getModules();
    const { p50, p95 } = __test__.computePercentiles([500]);
    expect(p50).toBe(500);
    expect(p95).toBe(500);
  });

  it("handles unsorted input", async () => {
    const { __test__ } = await getModules();
    const { p50 } = __test__.computePercentiles([900, 100, 500, 300, 700]);
    expect(p50).toBe(500);
  });
});

describe("computeRolling1hLatencyP95", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns alarmed=false when p95 <= threshold", async () => {
    const { db, computeRolling1hLatencyP95 } = await getModules();
    // All latencies well below 2000ms
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeAuditRows([100, 150, 200, 300, 500]),
    );

    const result = await computeRolling1hLatencyP95();
    expect(result.alarmed).toBe(false);
    expect(result.count).toBe(5);
    expect(result.p95).not.toBeNull();
    expect(result.p95!).toBeLessThanOrEqual(2000);
  });

  it("returns alarmed=true when p95 > threshold (2000ms)", async () => {
    const { db, computeRolling1hLatencyP95 } = await getModules();
    // Mix of latencies with p95 > 2000ms
    const highLatencies = Array.from({ length: 20 }, (_, i) =>
      i < 18 ? 500 : 3000,
    );
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeAuditRows(highLatencies),
    );

    const result = await computeRolling1hLatencyP95();
    expect(result.alarmed).toBe(true);
    expect(result.p95).toBeGreaterThan(2000);
  });

  it("empty sample → no alarm, count = 0", async () => {
    const { db, computeRolling1hLatencyP95 } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await computeRolling1hLatencyP95();
    expect(result.alarmed).toBe(false);
    expect(result.count).toBe(0);
    expect(result.p50).toBeNull();
    expect(result.p95).toBeNull();
  });

  it("db failure → fail-open, count = 0", async () => {
    const { db, computeRolling1hLatencyP95 } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB error"));

    const result = await computeRolling1hLatencyP95();
    expect(result.alarmed).toBe(false);
    expect(result.count).toBe(0);
  });

  it("skips rows with missing or non-numeric fire_to_ack_ms", async () => {
    const { db, computeRolling1hLatencyP95 } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { result: { fire_to_ack_ms: 100 } },
      { result: { fire_to_ack_ms: "not-a-number" } }, // skip
      { result: null },                                 // skip
      { result: {} },                                   // skip
      { result: { fire_to_ack_ms: 200 } },
    ]);

    const result = await computeRolling1hLatencyP95();
    expect(result.count).toBe(2);
  });
});

describe("runWebhookLatencyCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("fires alarm and SSE when p95 > threshold and no recent deduplication", async () => {
    const { db, broadcastSSE, notifyWarning, runWebhookLatencyCheck } = await getModules();
    const mockInsertChain = { values: vi.fn().mockResolvedValue(undefined) };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertChain);

    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) {
        // audit rows with high latency
        return makeAuditRows(Array.from({ length: 20 }, (_, i) => (i < 18 ? 500 : 3500)));
      }
      if (callN === 2) {
        // dedupe check — no recent alarm
        return [];
      }
      return [];
    });

    const result = await runWebhookLatencyCheck();

    expect(result.alarmed).toBe(true);
    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(broadcastSSE).toHaveBeenCalledWith(
      "alert:webhook_latency_high",
      expect.objectContaining({ thresholdMs: 2000 }),
    );
  });

  it("no alarm when p95 is within threshold", async () => {
    const { db, broadcastSSE, notifyWarning, runWebhookLatencyCheck } = await getModules();

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeAuditRows([100, 200, 300, 400, 500]),
    );

    const result = await runWebhookLatencyCheck();

    expect(result.alarmed).toBe(false);
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(broadcastSSE).not.toHaveBeenCalled();
  });

  it("dedupe — alarm already fired within 1h → no double-fire", async () => {
    const { db, notifyWarning, runWebhookLatencyCheck } = await getModules();

    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) {
        return makeAuditRows(Array.from({ length: 20 }, (_, i) => (i < 18 ? 500 : 3500)));
      }
      if (callN === 2) {
        return [{ "1": 1 }]; // recent alarm EXISTS
      }
      return [];
    });

    const result = await runWebhookLatencyCheck();

    expect(result.alarmed).toBe(false);
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("constants match expected values", async () => {
    const { __test__ } = await getModules();
    expect(__test__.ROLLING_WINDOW_HOURS).toBe(1);
    expect(__test__.P95_ALARM_THRESHOLD_MS).toBe(2000);
    expect(__test__.DEDUPE_HOURS).toBe(1);
  });
});
