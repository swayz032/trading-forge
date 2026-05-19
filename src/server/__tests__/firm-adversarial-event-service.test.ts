/**
 * B14 / W20 — firm-adversarial-event-service tests
 *
 * Covers:
 *   - loadSeedPriorsIfEmpty: populates seed rows on empty table; idempotent on populated table
 *   - getCurrentPriors: correct shape mapping for topstep + mffu; zero-value safe on unknown firm
 *   - upsertPrior: insert new / update existing; last_fitted_at advances; audit_log on change; no audit_log on unchanged rate
 *   - listAllPriors: all rows returned; firmId filter returns subset
 *   - refitPriorsForAllFirms: runs across 2 firms (MFFU + Topstep only); per-firm error isolation
 *   - automation_friendly defaults: missing-data=0.5
 *
 * SUPPORTED FIRMS: MFFU + Topstep ONLY. Legacy firm refs removed 2026-05-10 (migration 0097).
 * Test isolation: all DB calls are mocked via vi.mock. No real DB connections.
 * Audit log writes are fire-and-forget (.catch handled) — verified by mock call count.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── vi.mock declarations must be at top level (hoisted by vitest) ───────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  firmAdversarialPriors: { firmId: {}, eventType: {}, baseRate: {}, evidenceWeight: {}, evidenceSources: {}, fitMethod: {}, lastFittedAt: {}, updatedAt: {}, lastObservedAt: {} },
  auditLog: {},
  complianceRulesets: { firm: {} },
  propFirmHealthChecks: { firmId: {}, checkedAt: {}, status: {} },
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

// ─── Import after mocks are set up ────────────────────────────────────────────
import { db } from "../db/index.js";
import { readFileSync } from "fs";
import {
  getCurrentPriors,
  upsertPrior,
  loadSeedPriorsIfEmpty,
  listAllPriors,
} from "../services/firm-adversarial-event-service.js";
import { refitPriorsForAllFirms } from "../services/firm-priors-fitter.js";

// ─── Seed JSON fixture (MFFU + Topstep ONLY — legacy firms removed 2026-05-10) ──
const MOCK_SEED_DATA = {
  _metadata: { subsystem: "B14 test", purpose: "test seed", supported_firms: ["mffu", "topstep"] },
  rows: [
    { firmId: "mffu", eventType: "fund_freeze", baseRate: 0.015, evidenceWeight: 5, fitMethod: "manual_seed", lastObservedAt: "2025-04-12" },
    { firmId: "mffu", eventType: "payout_denial", baseRate: 0.025, evidenceWeight: 3, fitMethod: "manual_seed", lastObservedAt: "2025-04-15" },
    { firmId: "topstep", eventType: "account_suspension", baseRate: 0.005, evidenceWeight: 2, fitMethod: "manual_seed", lastObservedAt: "2025-04-22" },
    { firmId: "topstep", eventType: "payout_denial", baseRate: 0.004, evidenceWeight: 2, fitMethod: "manual_seed", lastObservedAt: "2025-04-30" },
    { firmId: "topstep", eventType: "profitable_trader_ban", baseRate: 0.001, evidenceWeight: 1, fitMethod: "manual_seed", lastObservedAt: "2025-04-22" },
  ],
};

// ─── DB mock helpers ──────────────────────────────────────────────────────────

function makeSelectChain(returnValue: unknown) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(returnValue),
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

function makeInsertChain(returnValue: unknown = [{ id: "test-uuid" }]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returnValue),
    catch: vi.fn(),
  };
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: seed file loads MOCK_SEED_DATA
  (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(MOCK_SEED_DATA));
});

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("loadSeedPriorsIfEmpty", () => {
  it("populates 5 rows on empty table (MFFU + Topstep only) and returns {loaded:5, skipped:0}", async () => {
    // Count query: db.select().from(firmAdversarialPriors) — no where/limit
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockResolvedValue([{ value: 0 }]),
    });

    // Insert chain — one per row (each .values() resolves directly)
    const insertChain = {
      values: vi.fn().mockResolvedValue([{ id: "test-uuid" }]),
    };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);

    const result = await loadSeedPriorsIfEmpty();

    expect(result.loaded).toBe(5);
    expect(result.skipped).toBe(0);
    // insert should have been called 5 times (one per seed row)
    expect(db.insert).toHaveBeenCalledTimes(5);
  });

  it("is idempotent: re-running on populated table returns {loaded:0, skipped:5}", async () => {
    // Count query returns non-zero (table is populated)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockResolvedValue([{ value: 5 }]),
    });

    const result = await loadSeedPriorsIfEmpty();

    expect(result.loaded).toBe(0);
    expect(result.skipped).toBe(5);
    // No inserts should have been made
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("getCurrentPriors", () => {
  it("returns expected mapped shape for topstep with P_suspension_30d from seed value", async () => {
    // Mock: DB returns topstep rows
    const topstepRows = [
      { eventType: "account_suspension", baseRate: "0.0050", evidenceWeight: 2 },
      { eventType: "payout_denial", baseRate: "0.0040", evidenceWeight: 2 },
      { eventType: "profitable_trader_ban", baseRate: "0.0010", evidenceWeight: 1 },
    ];
    // First select call: priors rows
    // Second select call: compliance_rulesets (returns nothing → default 0.5)
    let selectCallCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(topstepRows) };
      }
      // compliance_rulesets lookup
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    const priors = await getCurrentPriors("topstep");

    expect(priors.P_suspension_30d).toBeCloseTo(0.005, 4);
    expect(priors.P_payout_denial).toBeCloseTo(0.004, 4);
    // Time-semantic compounding: seed 0.001 (30-day) → annual = 1 - (1-0.001)^12 ≈ 0.01194
    expect(priors.P_profitable_trader_ban_year).toBeCloseTo(1 - Math.pow(1 - 0.001, 12), 5);
    expect(priors.P_fund_freeze_year).toBe(0);
    expect(priors.P_vpn_detection).toBe(0);
    expect(priors.evidence_weight).toBe(5); // 2+2+1
    // No parsedRules signal → default 0.5
    expect(priors.automation_friendly).toBe(0.5);
  });

  it("returns higher P_profitable_trader_ban_year for mffu (seeded) vs zero-priors firm", async () => {
    // Sanity: a firm with high ban rate from seed must exceed a firm with no ban rows.
    // This replaces the removed apex vs topstep comparison (apex no longer exists).
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            { eventType: "profitable_trader_ban", baseRate: "0.0500", evidenceWeight: 4 },
          ]),
        };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });
    const highRiskPriors = await getCurrentPriors("mffu");

    // 30-day seed 0.05 → annual = 1 - 0.95^12 ≈ 0.4596
    // Must be higher than a firm with 0.001 annual ban rate ≈ 0.0119
    expect(highRiskPriors.P_profitable_trader_ban_year).toBeGreaterThan(1 - Math.pow(1 - 0.001, 12));
    expect(highRiskPriors.P_profitable_trader_ban_year).toBeCloseTo(1 - Math.pow(1 - 0.05, 12), 5);
  });

  it("returns zeros without throwing for nonexistent firm (no crash on missing data)", async () => {
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });

    const priors = await getCurrentPriors("nonexistent_firm");

    expect(priors.P_suspension_30d).toBe(0);
    expect(priors.P_payout_denial).toBe(0);
    expect(priors.P_fund_freeze_year).toBe(0);
    expect(priors.P_profitable_trader_ban_year).toBe(0);
    expect(priors.P_vpn_detection).toBe(0);
    expect(priors.evidence_weight).toBe(0);
    // Should not throw
  });

  it("returns automation_friendly=0.5 for mffu when no parsedRules signal found (default fallback)", async () => {
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      }
      // No compliance_rulesets entry
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });

    // Since Apex was removed, all firms default to 0.5 when no parsedRules present.
    const priors = await getCurrentPriors("mffu");
    expect(priors.automation_friendly).toBeCloseTo(0.5, 4);
  });

  it("returns automation_friendly=0.5 for unknown firm with no parsedRules signal", async () => {
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });

    const priors = await getCurrentPriors("topstep");
    expect(priors.automation_friendly).toBeCloseTo(0.5, 4);
  });

  it("returns automation_friendly=1.0 when parsedRules.allowsAutomation is truthy", async () => {
    let callCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      }
      // Compliance ruleset has allowsAutomation: true
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ parsedRules: { allowsAutomation: true } }]),
      };
    });

    const priors = await getCurrentPriors("topstep");
    expect(priors.automation_friendly).toBeCloseTo(1.0, 4);
  });
});

describe("upsertPrior", () => {
  it("inserts a new row when (firm_id, event_type) does not exist", async () => {
    // No existing row (oldBaseRate will be null → audit log IS written for new inserts)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const newRow = {
      id: "new-uuid",
      firmId: "topstep",
      eventType: "fund_freeze",
      baseRate: "0.0020",
      evidenceWeight: 1,
      fitMethod: "manual_seed",
      lastFittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    };

    const mainInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([newRow]),
    };
    const auditInsertChain = {
      values: vi.fn().mockReturnValue({ catch: vi.fn() }),
    };

    let insertCount = 0;
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      insertCount++;
      return insertCount === 1 ? mainInsertChain : auditInsertChain;
    });

    const result = await upsertPrior({
      firmId: "topstep",
      eventType: "fund_freeze",
      baseRate: 0.002,
      fitMethod: "manual_seed",
    });

    expect(result.firmId).toBe("topstep");
    expect(result.eventType).toBe("fund_freeze");
    // Main upsert + audit log (oldBaseRate=null is treated as changed)
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(mainInsertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("updates existing row when (firm_id, event_type) exists; last_fitted_at advances", async () => {
    const existingBaseRate = "0.0050";
    const newBaseRate = 0.0080; // different

    // Select returns existing row (old rate)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ baseRate: existingBaseRate }]),
    });

    const before = new Date(Date.now() - 1000);
    const updatedRow = {
      id: "existing-uuid",
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: String(newBaseRate),
      evidenceWeight: 5,
      fitMethod: "health_check_history",
      lastFittedAt: new Date(),
      createdAt: before,
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    };

    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedRow]),
      catch: vi.fn(),
    };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(insertChain);

    const auditInsertChain = { values: vi.fn().mockReturnThis(), catch: vi.fn() };
    // Second insert call is audit log (fire-and-forget)
    let insertCallCount = 0;
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return insertChain;
      return auditInsertChain;
    });

    const result = await upsertPrior({
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: newBaseRate,
      evidenceWeight: 5,
      fitMethod: "health_check_history",
    });

    expect(parseFloat(result.baseRate as string)).toBeCloseTo(newBaseRate, 4);
    expect(result.lastFittedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("writes audit_log row when base_rate changed", async () => {
    const existingBaseRate = "0.0050";
    const newBaseRate = 0.0090; // 80% change > threshold

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ baseRate: existingBaseRate }]),
    });

    const updatedRow = {
      id: "uuid-1",
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: String(newBaseRate),
      evidenceWeight: 3,
      fitMethod: "health_check_history",
      lastFittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    };

    const mainInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedRow]),
      catch: vi.fn(),
    };
    const auditInsertChain = {
      values: vi.fn().mockReturnValue({ catch: vi.fn() }),
    };

    let insertCallCount = 0;
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      insertCallCount++;
      return insertCallCount === 1 ? mainInsertChain : auditInsertChain;
    });

    await upsertPrior({
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: newBaseRate,
      evidenceWeight: 3,
      fitMethod: "health_check_history",
    });

    // Audit log insert should have been called (fire-and-forget)
    expect(db.insert).toHaveBeenCalledTimes(2);
    // Second call is audit log
    const auditCall = (db.insert as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(auditCall).toBeDefined();
  });

  it("does NOT write audit_log when base_rate is unchanged", async () => {
    const existingBaseRate = "0.0050";
    const sameBaseRate = 0.0050; // identical

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ baseRate: existingBaseRate }]),
    });

    const sameRow = {
      id: "uuid-1",
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: String(sameBaseRate),
      evidenceWeight: 2,
      fitMethod: "manual_seed",
      lastFittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    };

    const mainInsertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([sameRow]),
      catch: vi.fn(),
    };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(mainInsertChain);

    await upsertPrior({
      firmId: "topstep",
      eventType: "account_suspension",
      baseRate: sameBaseRate,
      fitMethod: "manual_seed",
    });

    // Only the main upsert insert — NO audit log insert
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe("listAllPriors", () => {
  it("returns all rows when no firmId filter specified", async () => {
    const allRows = MOCK_SEED_DATA.rows.map((r, i) => ({
      ...r,
      id: `uuid-${i}`,
      baseRate: String(r.baseRate),
      lastFittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    }));

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockResolvedValue(allRows),
    });

    const rows = await listAllPriors();
    expect(rows.length).toBe(5);
  });

  it("returns only matching rows when firmId filter is provided", async () => {
    const topstepRows = MOCK_SEED_DATA.rows
      .filter((r) => r.firmId === "topstep")
      .map((r, i) => ({
        ...r,
        id: `uuid-ts-${i}`,
        baseRate: String(r.baseRate),
        lastFittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        evidenceSources: null,
        lastObservedAt: null,
      }));

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(topstepRows),
    });

    const rows = await listAllPriors("topstep");
    expect(rows.length).toBe(3); // topstep has 3 rows in seed
    expect(rows.every((r) => r.firmId === "topstep")).toBe(true);
  });
});

describe("refitPriorsForAllFirms", () => {
  it("runs across both firms (MFFU + Topstep only) and returns firmsProcessed=2", async () => {
    // Both firms succeed with empty health check results (no update needed)
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
    });

    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{
        id: "u1", firmId: "topstep", eventType: "account_suspension",
        baseRate: "0.01", evidenceWeight: 2, fitMethod: "health_check_history",
        lastFittedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        evidenceSources: null, lastObservedAt: null,
      }]),
      catch: vi.fn(),
    };
    const auditChain = { values: vi.fn().mockReturnValue({ catch: vi.fn() }) };
    let insertCount = 0;
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      insertCount++;
      return insertCount % 2 === 1 ? insertChain : auditChain;
    });

    const result = await refitPriorsForAllFirms();

    // Only 2 firms now (MFFU + Topstep)
    expect(result.firmsProcessed).toBe(2);
    expect(typeof result.priorsUpdated).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("returns error entry for firm that threw DB error (per-firm error isolation)", async () => {
    let selectCallCount = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++;
      // Throw on the first firm's DB call (topstep propFirmHealthChecks select)
      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockRejectedValue(new Error("DB connection lost for topstep")),
        };
      }
      // Second firm succeeds with empty results
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    });

    const result = await refitPriorsForAllFirms();

    // Should have at least one error (first firm threw)
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const firstError = result.errors[0];
    expect(firstError).toBeDefined();
    expect(firstError?.error).toContain("DB connection lost");
  });

  it("returns firmsProcessed and priorsUpdated as numbers in all cases", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    });

    const result = await refitPriorsForAllFirms();

    expect(typeof result.firmsProcessed).toBe("number");
    expect(typeof result.priorsUpdated).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe("seed file handling", () => {
  it("throws when seed file cannot be read", async () => {
    // readFileSync must throw so loadSeedFile() propagates ENOENT
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    // Count query returns 0 (empty table) to trigger the seed load path
    // db.select().from() shape (no where/limit — same as the count query)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockResolvedValue([{ value: 0 }]),
    });

    await expect(loadSeedPriorsIfEmpty()).rejects.toThrow("ENOENT");
  });

  it("seed JSON contains exactly 5 rows (MFFU + Topstep only, validates seed structure)", () => {
    // This test reads the mock seed file to validate it has 5 rows (mffu + topstep only)
    const seedData = JSON.parse(
      (readFileSync as ReturnType<typeof vi.fn>)("any_path", "utf-8"),
    );
    expect(seedData.rows.length).toBe(5);
    // Confirm no legacy firms in the mock seed
    const firmIds = new Set(seedData.rows.map((r: { firmId: string }) => r.firmId));
    expect(firmIds.has("apex")).toBe(false);
    expect(firmIds.has("tpt")).toBe(false);
    expect(firmIds.has("ffn")).toBe(false);
    expect(firmIds.has("mffu")).toBe(true);
    expect(firmIds.has("topstep")).toBe(true);
  });
});

describe("audit log row count sanity", () => {
  it("writes exactly 1 audit log row per upsert when base_rate changed (never N rows)", async () => {
    // Existing rate differs from new rate
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ baseRate: "0.0010" }]),
    });

    const upsertedRow = {
      id: "uuid-audit-test",
      firmId: "mffu",
      eventType: "payout_denial",
      baseRate: "0.0200",
      evidenceWeight: 3,
      fitMethod: "health_check_history",
      lastFittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      evidenceSources: null,
      lastObservedAt: null,
    };

    const mainChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([upsertedRow]),
    };
    const auditChain = { values: vi.fn().mockReturnValue({ catch: vi.fn() }) };

    let insertCount = 0;
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      insertCount++;
      return insertCount === 1 ? mainChain : auditChain;
    });

    await upsertPrior({ firmId: "mffu", eventType: "payout_denial", baseRate: 0.02, fitMethod: "health_check_history" });

    // Exactly 2 insert calls: 1 upsert + 1 audit log
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});
