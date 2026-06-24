/**
 * synthetic-regime-bank-service.test.ts
 *
 * TDD tests for A14 regime-bank population.
 *
 * Coverage:
 *   1.  runPythonModule invoked with correct module + config (seed=42, dry_run=false)
 *   2.  Regime records are parsed and inserted as synthetic_regime_bank rows
 *   3.  S3 upload called per regime when S3 is configured
 *   4.  S3 upload failure is fail-soft — row inserted with local: path
 *   5.  Idempotent dedup — existing row for same (symbol, timeframe, label, version) skipped
 *   6.  Python CLI error produces status="failed", audit written, no throw
 *   7.  Partial run (some regimes fail) produces status="partial"
 *   8.  Audit row written on success with correct action and counts
 *   9.  Multiple regimes — all inserted on happy path (counts correct)
 *   10. Empty regimes array + errors from Python → status="failed"
 *   11. conditioning_vector_compressed written as zero-byte Buffer (schema contract)
 *   12. Cron job "synthetic-regime-bank-populate" is registered with _PIPELINE_GATE_EXEMPT
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
const mockState = vi.hoisted(() => {
  const insertedRows: Array<Record<string, unknown>> = [];
  const selectRows: Array<{ id: string }> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  return { insertedRows, selectRows, auditRows };
});

const dbMocks = vi.hoisted(() => {
  // Insert chain
  const insertValuesMock = vi.fn();
  const insertMock = vi.fn();
  // Select chain
  const selectLimitMock = vi.fn();
  const selectWhereMock = vi.fn();
  const selectFromMock = vi.fn();
  const selectMock = vi.fn();

  return {
    insertValuesMock,
    insertMock,
    selectLimitMock,
    selectWhereMock,
    selectFromMock,
    selectMock,
  };
});

// Wire insert chain
dbMocks.insertValuesMock.mockImplementation(async (row: Record<string, unknown>) => {
  mockState.insertedRows.push(row);
  return [];
});
dbMocks.insertMock.mockImplementation(() => ({
  values: dbMocks.insertValuesMock,
}));

// Wire select chain — default: no existing rows (allow inserts)
dbMocks.selectLimitMock.mockResolvedValue([]);
dbMocks.selectWhereMock.mockReturnValue({ limit: dbMocks.selectLimitMock });
dbMocks.selectFromMock.mockReturnValue({ where: dbMocks.selectWhereMock });
dbMocks.selectMock.mockReturnValue({ from: dbMocks.selectFromMock });

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbMocks.insertMock,
    select: dbMocks.selectMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  syntheticRegimeBank: { id: "id", symbol: "symbol", timeframe: "timeframe", regimeLabel: "regime_label", generatorModelVersion: "generator_model_version" },
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// S3 mock
const mockHeadBucket = vi.fn().mockResolvedValue({});
const mockPutObject = vi.fn().mockResolvedValue({});
const mockS3Send = vi.fn().mockImplementation(async (cmd: unknown) => {
  const cmdName = (cmd as { constructor: { name: string } }).constructor.name;
  if (cmdName === "HeadBucketCommand") return mockHeadBucket();
  if (cmdName === "PutObjectCommand") return mockPutObject();
  return {};
});

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
    PutObjectCommand: class PutObjectCommand {
      constructor(public input: Record<string, unknown>) {}
    },
    HeadBucketCommand: class HeadBucketCommand {
      constructor(public input: Record<string, unknown>) {}
    },
  };
});

// fs mock — createReadStream
vi.mock("node:fs", () => ({
  createReadStream: vi.fn().mockReturnValue({ pipe: vi.fn() }),
}));

// runPythonModule mock
const mockRunPythonModule = vi.fn();
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: mockRunPythonModule,
}));

// insertAuditRowSafe mock
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makePythonResult(overrides: Partial<{
  generated: number;
  calibrated_passed: number;
  calibrated_failed: number;
  stored: number;
  regimes: Array<Record<string, unknown>>;
  errors: string[];
}> = {}) {
  return {
    generated: 8,
    calibrated_passed: 8,
    calibrated_failed: 0,
    stored: 8,
    regimes: [
      {
        symbol: "MES",
        timeframe: "5min",
        regime_label: "COVID_crash",
        file_path: "data/regime_bank/mes_5min_covid_crash.parquet",
        num_bars: 1200,
        generator_model_version: "1.0.0",
        stylized_fact_passed: true,
        severity_passed: true,
        calibration_stats: {},
      },
    ],
    errors: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runSyntheticRegimeBankPopulate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.insertedRows.length = 0;
    mockState.selectRows.length = 0;
    mockState.auditRows.length = 0;

    // Reset select chain — no existing rows by default
    dbMocks.selectLimitMock.mockResolvedValue([]);

    // Reset S3 success
    mockHeadBucket.mockResolvedValue({});
    mockPutObject.mockResolvedValue({});

    // S3 configured by default for most tests
    process.env["S3_BUCKET"] = "test-bucket";
    process.env["AWS_ACCESS_KEY_ID"] = "test-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
  });

  it("1. invokes runPythonModule with correct module name and config", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    await runSyntheticRegimeBankPopulate("corr-1");

    expect(mockRunPythonModule).toHaveBeenCalledOnce();
    const call = mockRunPythonModule.mock.calls[0][0];
    expect(call.module).toBe("src.engine.synthetic.populate_regime_bank");
    expect(call.config).toMatchObject({
      symbols: ["MES", "MNQ", "MCL"],
      timeframes: ["5min"],
      seed: 42,
      dry_run: false,
      severity_check: true,
    });
    expect(call.correlationId).toBe("corr-1");
  });

  it("2. parses regime records and inserts bank rows", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-2");

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.status).toBe("populated");

    expect(dbMocks.insertValuesMock).toHaveBeenCalledOnce();
    const row = dbMocks.insertValuesMock.mock.calls[0][0];
    expect(row.symbol).toBe("MES");
    expect(row.timeframe).toBe("5min");
    expect(row.regimeLabel).toBe("COVID_crash");
    expect(row.numBars).toBe(1200);
    expect(row.stylizedFactPassed).toBe(true);
    expect(row.generatorModelVersion).toBe("1.0.0");
  });

  it("3. uploads parquet to S3 when S3 is configured", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-3");

    expect(mockS3Send).toHaveBeenCalledTimes(2); // HeadBucket + PutObject
    expect(result.uploadFailed).toBe(0);

    const insertedRow = dbMocks.insertValuesMock.mock.calls[0][0];
    expect(insertedRow.s3Path).toMatch(/^s3:\/\//);
  });

  it("4. S3 upload failure is fail-soft — row inserted with local: path", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    // Make S3 fail
    mockHeadBucket.mockRejectedValue(new Error("S3 unreachable"));
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-4");

    // Should still insert, status partial (has upload error)
    expect(result.inserted).toBe(1);
    expect(result.uploadFailed).toBe(1);
    expect(result.status).toBe("partial");
    expect(result.errors.length).toBeGreaterThan(0);

    const insertedRow = dbMocks.insertValuesMock.mock.calls[0][0];
    expect(insertedRow.s3Path).toMatch(/^local:/);
  });

  it("5. dedup — existing row for same key is skipped", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    // Simulate existing row
    dbMocks.selectLimitMock.mockResolvedValue([{ id: "existing-row" }]);
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-5");

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dbMocks.insertValuesMock).not.toHaveBeenCalled();
    // No S3 upload either
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("6. Python CLI error → status=failed, audit written, no throw", async () => {
    mockRunPythonModule.mockRejectedValue(new Error("Python subprocess crashed"));
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    // Must not throw — awaiting directly (not inside nested async closure)
    const result = await runSyntheticRegimeBankPopulate("corr-6");

    expect(result.status).toBe("failed");
    expect(result.inserted).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Python subprocess crashed");

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "synthetic_regime_bank.failed",
        correlationId: "corr-6",
      }),
    );

    // No DB inserts
    expect(dbMocks.insertValuesMock).not.toHaveBeenCalled();
  });

  it("7. partial run — some regimes error individually → status=partial", async () => {
    const twoRegimes = makePythonResult({
      generated: 2,
      calibrated_passed: 2,
      regimes: [
        {
          symbol: "MES",
          timeframe: "5min",
          regime_label: "COVID_crash",
          file_path: "data/regime_bank/mes_covid.parquet",
          num_bars: 1200,
          generator_model_version: "1.0.0",
          stylized_fact_passed: true,
          severity_passed: true,
        },
        {
          symbol: "MNQ",
          timeframe: "5min",
          regime_label: "rate_shock_2022",
          file_path: "data/regime_bank/mnq_rate_shock.parquet",
          num_bars: 900,
          generator_model_version: "1.0.0",
          stylized_fact_passed: true,
          severity_passed: true,
        },
      ],
    });
    mockRunPythonModule.mockResolvedValue(twoRegimes);

    // First insert succeeds, second throws
    dbMocks.insertValuesMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("DB constraint violation"));

    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-7");

    expect(result.inserted).toBe(1);
    expect(result.status).toBe("partial");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("8. audit row written on success with correct action and counts", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    await runSyntheticRegimeBankPopulate("corr-8");

    const auditCall = mockInsertAuditRowSafe.mock.calls.find(
      (c) => (c[0] as { action: string }).action === "synthetic_regime_bank.populated",
    );
    expect(auditCall).toBeDefined();
    // 2026-06-23 fix: audit row uses real audit_log columns — `result` (JSONB) +
    // required `status` — not the non-existent `details` column.
    const row = auditCall![0] as { status: string; result: Record<string, unknown> };
    expect(row.status).toBe("success");
    const result = row.result;
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.seed).toBe(42);
  });

  it("9. multiple regimes — all inserted on happy path", async () => {
    const threeRegimes = makePythonResult({
      generated: 3,
      calibrated_passed: 3,
      stored: 3,
      regimes: [
        { symbol: "MES", timeframe: "5min", regime_label: "COVID_crash", file_path: "data/a.parquet", num_bars: 1000, generator_model_version: "1.0.0", stylized_fact_passed: true, severity_passed: true },
        { symbol: "MES", timeframe: "5min", regime_label: "rate_shock_2022", file_path: "data/b.parquet", num_bars: 900, generator_model_version: "1.0.0", stylized_fact_passed: true, severity_passed: true },
        { symbol: "MNQ", timeframe: "5min", regime_label: "vol_spike_2018", file_path: "data/c.parquet", num_bars: 1100, generator_model_version: "1.0.0", stylized_fact_passed: true, severity_passed: true },
      ],
    });
    mockRunPythonModule.mockResolvedValue(threeRegimes);

    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");
    const result = await runSyntheticRegimeBankPopulate("corr-9");

    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.status).toBe("populated");
    expect(dbMocks.insertValuesMock).toHaveBeenCalledTimes(3);
  });

  it("10. empty regimes array + errors from Python → status=failed", async () => {
    mockRunPythonModule.mockResolvedValue({
      generated: 0,
      calibrated_passed: 0,
      calibrated_failed: 0,
      stored: 0,
      regimes: [],
      errors: ["Generator failed to initialize"],
    });

    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");
    const result = await runSyntheticRegimeBankPopulate("corr-10");

    expect(result.status).toBe("failed");
    expect(result.inserted).toBe(0);
    expect(result.errors).toContain("Generator failed to initialize");
    expect(dbMocks.insertValuesMock).not.toHaveBeenCalled();
  });

  it("11. conditioning_vector_compressed is a zero-byte Buffer (schema contract)", async () => {
    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    await runSyntheticRegimeBankPopulate("corr-11");

    const row = dbMocks.insertValuesMock.mock.calls[0][0];
    expect(Buffer.isBuffer(row.conditioningVectorCompressed)).toBe(true);
    expect((row.conditioningVectorCompressed as Buffer).length).toBe(0);
    expect(row.conditioningDim).toBe(0);
  });

  it("12. no throw when S3 not configured — local path used", async () => {
    delete process.env["S3_BUCKET"];
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];

    mockRunPythonModule.mockResolvedValue(makePythonResult());
    const { runSyntheticRegimeBankPopulate } = await import("./synthetic-regime-bank-service.js");

    const result = await runSyntheticRegimeBankPopulate("corr-12");

    expect(result.inserted).toBe(1);
    expect(result.uploadFailed).toBe(0); // local path is NOT counted as upload failure
    const insertedRow = dbMocks.insertValuesMock.mock.calls[0][0];
    expect(insertedRow.s3Path).toMatch(/^local:/);
    // S3 client was never contacted
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

// ─── Scheduler source-text tests moved to: ───────────────────────────────────
// src/server/__tests__/synthetic-regime-bank-scheduler.test.ts
// (separate file to avoid node:fs mock collision with the service mock above)
