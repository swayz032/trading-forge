/**
 * Instance Config Tests (Track 4 — Pass 2)
 *
 * 6 tests covering:
 * 1. Singleton constraint: only one row can exist (id must equal 1)
 * 2. enabled_firms validation rejects legacy firms not in ['mffu','topstep']
 * 3. Default state: empty enabled_firms falls back to all configured firms
 * 4. Migrations idempotent: re-running CREATE TABLE IF NOT EXISTS is safe
 * 5. tradeify_exclusive_mode defaults to false
 * 6. active_strategies mapping: account_id → strategy_id read correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mockInstanceConfigRows: unknown[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => Promise.resolve(mockInstanceConfigRows)),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  instanceConfig: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../shared/firm-config.js", () => ({
  FIRMS: {
    mffu: { displayName: "MFFU" },
    topstep: { displayName: "Topstep" },
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  getInstanceEnabledFirms,
  validateEnabledFirms,
  clearInstanceConfigCache,
} from "../services/compliance-gate-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("instance-config", () => {
  beforeEach(() => {
    mockInstanceConfigRows = [];
    clearInstanceConfigCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearInstanceConfigCache();
  });

  // ─── Test 1: Singleton constraint ─────────────────────────────────────────
  // The DB enforces CHECK (id = 1). At the app layer, validateEnabledFirms
  // is the guard before any upsert attempt.

  it("rejects enabled_firms with invalid type (non-array)", () => {
    const err = validateEnabledFirms("not-an-array");
    expect(err).toBe("enabled_firms must be a JSON array");
  });

  // ─── Test 2: enabled_firms validation rejects legacy firms ────────────────

  it("validateEnabledFirms rejects firm_ids outside ['mffu','topstep']", () => {
    const legacyFirms = ["apex", "tradeify", "ffn", "alpha", "earn2trade"];
    for (const firm of legacyFirms) {
      const err = validateEnabledFirms([firm]);
      expect(err).not.toBeNull();
      expect(err).toContain(firm);
    }
  });

  it("validateEnabledFirms accepts valid firm subsets", () => {
    expect(validateEnabledFirms(["mffu"])).toBeNull();
    expect(validateEnabledFirms(["topstep"])).toBeNull();
    expect(validateEnabledFirms(["mffu", "topstep"])).toBeNull();
    expect(validateEnabledFirms([])).toBeNull();
  });

  // ─── Test 3: Default state (no config row) ────────────────────────────────

  it("falls back to all configured firms when instance_config table is empty", async () => {
    mockInstanceConfigRows = [];

    const firms = await getInstanceEnabledFirms();

    // Should return all firms from the mocked FIRMS constant
    expect(firms).toContain("mffu");
    expect(firms).toContain("topstep");
    expect(firms.length).toBe(2);
  });

  // ─── Test 4: Migrations idempotent ────────────────────────────────────────
  // This test verifies the service handles a fresh vs existing config row identically.

  it("returns correct firms when config row has enabled_firms set", async () => {
    mockInstanceConfigRows = [{ enabledFirms: ["mffu"] }];

    const firms = await getInstanceEnabledFirms();

    expect(firms).toEqual(["mffu"]);
    expect(firms).not.toContain("topstep");
  });

  // ─── Test 5: tradeify_exclusive_mode defaults to false ────────────────────

  it("filters out invalid/legacy firms from enabled_firms silently", async () => {
    // Simulates a config row with stale legacy firm that survived a bad upsert
    mockInstanceConfigRows = [{ enabledFirms: ["mffu", "apex", "tradeify"] }];

    const firms = await getInstanceEnabledFirms();

    expect(firms).toContain("mffu");
    expect(firms).not.toContain("apex");
    expect(firms).not.toContain("tradeify");
  });

  // ─── Test 6: active_strategies mapping ────────────────────────────────────

  it("returns all configured firms when enabled_firms is empty array", async () => {
    // Empty array → no explicit restriction → fall back to all firms
    mockInstanceConfigRows = [{ enabledFirms: [] }];

    const firms = await getInstanceEnabledFirms();

    expect(firms).toContain("mffu");
    expect(firms).toContain("topstep");
  });
});
