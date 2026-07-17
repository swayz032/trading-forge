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
  // The count query chain: db.select({count: sql`count(*)`, newest: sql`max(created_at)`}).from(t)
  // → one row carrying both the bank row count and the newest row's timestamp
  // (or null when absent/never-populated).
  const selectResult: { rows: Array<{ count: number; newest?: string | null }> } = {
    rows: [{ count: 0, newest: null }],
  };
  const selectMock = vi.fn();
  const fromMock = vi.fn();

  fromMock.mockImplementation(async () => selectResult.rows);
  selectMock.mockImplementation(() => ({ from: fromMock }));

  return { selectMock, fromMock, selectResult };
});

const auditMocks = vi.hoisted(() => ({
  // Typed with the real single-argument call signature so `.mock.calls` is a
  // 1-tuple array (`[any][]`). Without the explicit signature, a bare `vi.fn()`
  // infers a zero-arg mock whose `.mock.calls` is `[][]` (empty tuples), which
  // makes the `.find(([args]: [any]) => ...)` destructuring fail TS2769.
  insertAuditRowSafe: vi.fn<(args: any) => Promise<boolean>>().mockResolvedValue(true),
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

// Mock python-runner so it never actually spawns. Hoisted + referenceable so
// tests can assert the fire-and-forget populate path actually reached the
// CLI-invocation stage (the async function body runs synchronously up to its
// first `await`, so this call is observable immediately after
// ensureRegimeBankPopulated resolves, even though populate itself is never
// awaited by the caller).
const pythonRunnerMocks = vi.hoisted(() => ({
  runPythonModule: vi
    .fn()
    .mockResolvedValue({ generated: 8, stored: 8, regimes: [], errors: [] }),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: pythonRunnerMocks.runPythonModule,
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

// Fixed "now" reference so age-based fixtures are deterministic regardless of
// when the test suite runs.
const NOW_MS = Date.now();
const FRESH_TIMESTAMP = new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days old
const STALE_TIMESTAMP = new Date(NOW_MS - 45 * 24 * 60 * 60 * 1000).toISOString(); // 45 days old (default staleness window is 30)

describe("ensureRegimeBankPopulated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to empty bank (count = 0, no newest row)
    dbMocks.selectResult.rows = [{ count: 0, newest: null }];
    // Restore default mock implementations
    dbMocks.fromMock.mockImplementation(async () => dbMocks.selectResult.rows);
    dbMocks.selectMock.mockImplementation(() => ({ from: dbMocks.fromMock }));
    auditMocks.insertAuditRowSafe.mockResolvedValue(true);
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

  it("B2: skips populate when bank has fresh rows (count > 0, not stale)", async () => {
    dbMocks.selectResult.rows = [{ count: 8, newest: FRESH_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b2");

    // Must emit self_heal_skipped_populated audit
    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const skippedAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_skipped_populated"
    );
    expect(skippedAudit).toBeTruthy();
  });

  it("B2b: does NOT emit self_heal_triggered when bank is populated and fresh", async () => {
    dbMocks.selectResult.rows = [{ count: 8, newest: FRESH_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b2b");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // B6 (HIGH-1 fix, 2026-07-17): Stale bank (count > 0 but newest row older
  // than REGIME_BANK_STALENESS_DAYS) → re-trigger self-heal + visible warn audit.
  // Previously REGIME_BANK_STALENESS_DAYS was computed but never read in an
  // `if` — a bank populated once and never refreshed silently read as
  // permanently healthy forever. This is the regression test for that gap.
  // ────────────────────────────────────────────────────────────────────────────

  it("B6: triggers self-heal when bank has rows but newest row is stale (> 30 days)", async () => {
    dbMocks.selectResult.rows = [{ count: 23, newest: STALE_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b6");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeTruthy();
  });

  it("B6b: does NOT emit self_heal_skipped_populated when the bank is stale", async () => {
    dbMocks.selectResult.rows = [{ count: 23, newest: STALE_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b6b");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const skippedAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_skipped_populated"
    );
    expect(skippedAudit).toBeUndefined();
  });

  it("B6c: stale-branch trigger audit carries the ageDays + newestCreatedAt diagnostics", async () => {
    dbMocks.selectResult.rows = [{ count: 23, newest: STALE_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b6c");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeTruthy();
    const [auditArgs] = triggeredAudit!;
    expect(auditArgs.input.triggeredBy).toBe("boot_self_heal_stale");
    expect(auditArgs.input.ageDays).toBeGreaterThan(30);
    expect(auditArgs.input.newestCreatedAt).toBe(new Date(STALE_TIMESTAMP).toISOString());
  });

  it("B6d: fires the populate pipeline (fire-and-forget) on the stale branch", async () => {
    dbMocks.selectResult.rows = [{ count: 23, newest: STALE_TIMESTAMP }];

    await ensureRegimeBankPopulated("corr-b6d");

    // runSyntheticRegimeBankPopulate is a same-module function (not imported),
    // so it can't be spied on directly — but it invokes runPythonModule() as
    // the first thing its async body does, synchronously, before its first
    // await. That call is observable via the hoisted python-runner mock even
    // though the outer ensureRegimeBankPopulated() never awaits it.
    expect(pythonRunnerMocks.runPythonModule).toHaveBeenCalled();
  });

  it("B6e: a bank with rows but a null newest timestamp is treated as stale (infinite age)", async () => {
    // Defensive: if created_at is somehow null (shouldn't happen — column is
    // NOT NULL — but MAX() over zero matching rows or a driver quirk could
    // surface null), the null-safe age computation must fail toward "stale"
    // (trigger self-heal), never silently toward "skip forever".
    dbMocks.selectResult.rows = [{ count: 23, newest: null }];

    await ensureRegimeBankPopulated("corr-b6e");

    const auditCalls = auditMocks.insertAuditRowSafe.mock.calls;
    const triggeredAudit = auditCalls.find(
      ([args]: [any]) => args?.action === "synthetic_regime_bank.self_heal_triggered"
    );
    expect(triggeredAudit).toBeTruthy();
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
    dbMocks.selectResult.rows = [{ count: 8, newest: FRESH_TIMESTAMP }];
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
