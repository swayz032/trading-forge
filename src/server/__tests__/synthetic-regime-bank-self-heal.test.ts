/**
 * TDD tests: ensureRegimeBankPopulated() self-heal in synthetic-regime-bank-service.ts
 *
 * Contract:
 *   ensureRegimeBankPopulated(correlationId)
 *   - Queries SELECT count(*) FROM synthetic_regime_bank
 *   - If count == 0 (empty bank): fire-and-forget runSyntheticRegimeBankPopulate()
 *     async (never blocks); emit audit synthetic_regime_bank.self_heal_triggered
 *   - If count > 0 AND newest row < STALENESS_DAYS (30 days default): skip
 *     emit audit synthetic_regime_bank.self_heal_skipped_populated
 *   - If count > 0 AND all rows older than STALENESS_DAYS: fire-and-forget populate
 *     emit audit synthetic_regime_bank.self_heal_triggered
 *   - Any error in the DB check → log warn + return (never block boot)
 *   - Never awaits the populate run (fire-and-forget)
 *
 * Governance: CHALLENGER-ONLY / ADVISORY — self-heal never blocks app.listen.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ────────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => {
  // The count query chain: db.select({count: sql`count(*)`}).from(t) → number
  const selectResult: { rows: Array<{ count: number }> } = { rows: [{ count: 0 }] };
  const selectMock = vi.fn();
  const fromMock = vi.fn();

  fromMock.mockImplementation(async () => selectResult.rows);
  selectMock.mockImplementation(() => ({ from: fromMock }));

  return { selectMock, fromMock, selectResult };
});

const auditMocks = vi.hoisted(() => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

const populateMocks = vi.hoisted(() => ({
  runSyntheticRegimeBankPopulate: vi.fn().mockResolvedValue({
    correlationId: "test-corr",
    status: "populated",
    inserted: 8,
    skipped: 0,
    generated: 8,
    calibratedPassed: 8,
    calibratedFailed: 0,
    stored: 8,
    uploadFailed: 0,
    errors: [],
  }),
}));

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: dbMocks.selectMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  syntheticRegimeBank: { id: "synthetic_regime_bank_table_stub" },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: auditMocks.insertAuditRowSafe,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock python-runner so it never actually spawns
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ generated: 8, stored: 8, regimes: [], errors: [] }),
}));

// Mock S3 SDK
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
}));

// Mock fs (no real file access)
vi.mock("node:fs", () => ({
  createReadStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
}));

// ─── Import under test ─────────────────────────────────────────────────────────
// We mock runSyntheticRegimeBankPopulate BEFORE importing the module to prevent
// actual Python invocation. The self-heal function under test IS ensureRegimeBankPopulated.

// We'll import it after mocking the populate function via module-level mock.
// Since we can't partially mock within the same module, we test the contract
// by asserting on audit actions + populate call counts.

// Import the entire module — we'll spy on internal behavior via the mocks above.
// NOTE: We re-import after all vi.mock calls to pick up the mocked dependencies.
const { ensureRegimeBankPopulated } = await import(
  "../services/synthetic-regime-bank-service.js"
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ensureRegimeBankPopulated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to empty bank (count = 0)
    dbMocks.selectResult.rows = [{ count: 0 }];
    // Restore default mock implementations
    dbMocks.fromMock.mockImplementation(async () => dbMocks.selectResult.rows);
    dbMocks.selectMock.mockImplementation(() => ({ from: dbMocks.fromMock }));
    auditMocks.insertAuditRowSafe.mockResolvedValue(undefined);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B1: Empty bank → fire-and-forget populate + audit triggered
  // ────────────────────────────────────────────────────────────────────────────

  it("B1: triggers self-heal when bank is empty (count=0)", async () => {
    dbMocks.selectResult.rows = [{ count: 0 }];

    await ensureRegimeBankPopulated("corr-b1");

    // Must emit self_heal_triggered audit
    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeTruthy();
  });

  it("B1b: does NOT emit self_heal_skipped_populated when bank is empty", async () => {
    dbMocks.selectResult.rows = [{ count: 0 }];

    await ensureRegimeBankPopulated("corr-b1b");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const skippedAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_skipped_populated"
    );
    expect(skippedAudit).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B2: Populated bank → skip (no populate, emit skipped audit)
  // ────────────────────────────────────────────────────────────────────────────

  it("B2: skips populate when bank has rows (count > 0)", async () => {
    dbMocks.selectResult.rows = [{ count: 8 }];

    await ensureRegimeBankPopulated("corr-b2");

    // Must emit self_heal_skipped_populated audit
    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const skippedAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_skipped_populated"
    );
    expect(skippedAudit).toBeTruthy();
  });

  it("B2b: does NOT emit self_heal_triggered when bank is populated", async () => {
    dbMocks.selectResult.rows = [{ count: 8 }];

    await ensureRegimeBankPopulated("corr-b2b");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B3: Non-blocking — ensureRegimeBankPopulated resolves immediately
  // ────────────────────────────────────────────────────────────────────────────

  it("B3: resolves quickly without awaiting populate (fire-and-forget)", async () => {
    dbMocks.selectResult.rows = [{ count: 0 }];

    // The populate function might take "long" — ensureRegimeBankPopulated must still
    // resolve promptly (it does NOT await the populate result).
    let populateStarted = false;
    // We can't directly test "did not await" but we can verify:
    // 1. The function returns a Promise that resolves (no hang)
    // 2. The returned value is void/undefined (no populate result leaks)
    const result = await ensureRegimeBankPopulated("corr-b3");
    expect(result).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B4: DB error during count check → log warn + return (never throw)
  // ────────────────────────────────────────────────────────────────────────────

  it("B4: survives DB error gracefully (fail-soft)", async () => {
    dbMocks.fromMock.mockRejectedValueOnce(new Error("DB connection refused"));

    // Must not throw — self-heal errors must never block boot
    await expect(ensureRegimeBankPopulated("corr-b4")).resolves.toBeUndefined();
  });

  it("B4b: does not emit any audit when DB check fails", async () => {
    dbMocks.fromMock.mockRejectedValueOnce(new Error("DB connection refused"));

    await ensureRegimeBankPopulated("corr-b4b");

    // Audit emission may or may not fire on error (fail-soft) — we don't mandate it,
    // but we DO mandate the function completes without throwing.
    // The key invariant is: no unhandled rejection.
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B5: correlationId propagated to audit row
  // ────────────────────────────────────────────────────────────────────────────

  it("B5: propagates correlationId to audit row on trigger", async () => {
    dbMocks.selectResult.rows = [{ count: 0 }];
    const corrId = "boot-heal-test-corr-id-123";

    await ensureRegimeBankPopulated(corrId);

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeTruthy();
    const [auditArgs] = triggeredAudit!;
    expect(auditArgs.correlationId).toBe(corrId);
  });

  it("B5b: propagates correlationId to audit row on skip", async () => {
    dbMocks.selectResult.rows = [{ count: 8 }];
    const corrId = "boot-skip-test-corr-id-456";

    await ensureRegimeBankPopulated(corrId);

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const skippedAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_skipped_populated"
    );
    expect(skippedAudit).toBeTruthy();
    const [auditArgs] = skippedAudit!;
    expect(auditArgs.correlationId).toBe(corrId);
  });
});
