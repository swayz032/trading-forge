/**
 * wave25-internals-service.test.ts — Wave 25 Pass 2.5, W25.5b
 *
 * Tests for market-internals-service.ts:
 *  - Graceful null return when MASSIVE_API_KEY unset
 *  - Staleness detection (>5min threshold)
 *  - recordInternalsBar updates cache
 *  - getInternalsSnapshot correctly reflects injected readings
 *  - MCL skip logic (via evalInternalsAligned in confluence-score — tested in separate file)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock DB and audit-log-helper to avoid DATABASE_URL requirement in unit tests
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

import {
  getInternalsSnapshot,
  recordInternalsBar,
  __resetInternalsForTests,
  __injectInternalsReading,
} from "../services/market-internals-service.js";

// Ensure no MASSIVE_API_KEY leaks from environment into tests
const originalEnv = { ...process.env };

beforeEach(() => {
  __resetInternalsForTests();
  // Ensure the service is in disabled state for tests (no side effects from WS)
  delete process.env["MASSIVE_API_KEY"];
  delete process.env["MASSIVE_INTERNALS_ENABLED"];
  delete process.env["INTERNALS_STALE_THRESHOLD_MS"];
});

afterEach(() => {
  // Restore original env
  process.env["MASSIVE_API_KEY"] = originalEnv["MASSIVE_API_KEY"];
  process.env["MASSIVE_INTERNALS_ENABLED"] = originalEnv["MASSIVE_INTERNALS_ENABLED"];
});

describe("getInternalsSnapshot — disabled service", () => {
  it("returns all-null snapshot when MASSIVE_API_KEY is not set", () => {
    const snapshot = getInternalsSnapshot();
    expect(snapshot.tick).toBeNull();
    expect(snapshot.add).toBeNull();
    expect(snapshot.vold).toBeNull();
    expect(snapshot.trin).toBeNull();
  });

  it("snapshot.stale is true when all values are null (never updated)", () => {
    const snapshot = getInternalsSnapshot();
    expect(snapshot.stale).toBe(true);
  });

  it("snapshot.asOf is a recent Date", () => {
    const before = Date.now();
    const snapshot = getInternalsSnapshot();
    const after = Date.now();
    expect(snapshot.asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(snapshot.asOf.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("recordInternalsBar and getInternalsSnapshot", () => {
  it("updates cache for $TICK symbol", () => {
    const ts = new Date();
    recordInternalsBar("$TICK", 750, ts);
    const snapshot = getInternalsSnapshot();
    expect(snapshot.tick).toBe(750);
  });

  it("updates cache for $ADD symbol", () => {
    const ts = new Date();
    recordInternalsBar("$ADD", 350, ts);
    const snapshot = getInternalsSnapshot();
    expect(snapshot.add).toBe(350);
  });

  it("updates cache for $VOLD symbol", () => {
    const ts = new Date();
    recordInternalsBar("$VOLD", -1200, ts);
    const snapshot = getInternalsSnapshot();
    expect(snapshot.vold).toBe(-1200);
  });

  it("updates cache for $TRIN symbol", () => {
    const ts = new Date();
    recordInternalsBar("$TRIN", 0.85, ts);
    const snapshot = getInternalsSnapshot();
    expect(snapshot.trin).toBe(0.85);
  });

  it("ignores unknown symbols", () => {
    recordInternalsBar("UNKNOWN_SYM", 999, new Date());
    // Should not throw and snapshot remains null for unknowns
    const snapshot = getInternalsSnapshot();
    // Known symbols still null (nothing injected for them)
    expect(snapshot.tick).toBeNull();
  });

  it("snapshot is not stale when all readings are fresh", () => {
    const now = new Date();
    __injectInternalsReading("tick",  500, now);
    __injectInternalsReading("add",   200, now);
    __injectInternalsReading("vold",  100, now);
    __injectInternalsReading("trin",  0.9, now);

    const snapshot = getInternalsSnapshot();
    expect(snapshot.stale).toBe(false);
    expect(snapshot.tick).toBe(500);
    expect(snapshot.add).toBe(200);
    expect(snapshot.vold).toBe(100);
    expect(snapshot.trin).toBe(0.9);
  });

  it("snapshot is stale if tick reading is older than threshold", () => {
    const staleTime = new Date(Date.now() - 400_000); // 6min+ ago > default 5min threshold
    __injectInternalsReading("tick",  500, staleTime);
    __injectInternalsReading("add",   200, new Date()); // fresh
    __injectInternalsReading("vold",  100, new Date()); // fresh
    __injectInternalsReading("trin",  0.9, new Date()); // fresh

    const snapshot = getInternalsSnapshot();
    expect(snapshot.stale).toBe(true);
  });

  it("snapshot is not stale if all readings are within threshold", () => {
    const freshTime = new Date(Date.now() - 60_000); // 1min ago — well within 5min
    __injectInternalsReading("tick",  -800, freshTime);
    __injectInternalsReading("add",   -400, freshTime);
    __injectInternalsReading("vold",  -200, freshTime);
    __injectInternalsReading("trin",  1.2,  freshTime);

    const snapshot = getInternalsSnapshot();
    expect(snapshot.stale).toBe(false);
  });
});

describe("__resetInternalsForTests", () => {
  it("clears cache so all values revert to null", () => {
    __injectInternalsReading("tick", 999, new Date());
    __resetInternalsForTests();
    const snapshot = getInternalsSnapshot();
    expect(snapshot.tick).toBeNull();
  });
});

describe("__injectInternalsReading", () => {
  it("accepts all four symbolic names", () => {
    const now = new Date();
    __injectInternalsReading("tick",  1, now);
    __injectInternalsReading("add",   2, now);
    __injectInternalsReading("vold",  3, now);
    __injectInternalsReading("trin",  4, now);

    const snapshot = getInternalsSnapshot();
    expect(snapshot.tick).toBe(1);
    expect(snapshot.add).toBe(2);
    expect(snapshot.vold).toBe(3);
    expect(snapshot.trin).toBe(4);
  });
});
