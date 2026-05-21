/**
 * Track 6 / Pass 2 — pine-export-recipient-service tests
 *
 * 6 tests:
 *   1. Happy path — per-recipient artifact generated correctly
 *   2. Bundles README correctly
 *   3. Pause guard returns pipeline_paused error
 *   4. Audit_log row written on successful export
 *   5. Legacy-firm rejection (account_id with firm_id NOT IN ('mffu','topstep'))
 *   6. Idempotency — same inputs → same artifact hash / content_hash
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "mock-export-id" }]),
  },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/pine-export-service.js", () => ({
  compileDualPineExport: vi.fn(),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require("events");
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    // Simulate successful sizing call returning qty=6
    setTimeout(() => {
      proc.stdout.emit("data", JSON.stringify({ qty: 6 }));
      proc.emit("close", 0);
    }, 0);
    return proc;
  }),
}));

// Import after mocks are set up
const { isActive: isPipelineActive } = await import("../services/pipeline-control-service.js");
const { compileDualPineExport } = await import("../services/pine-export-service.js");
const { db } = await import("../db/index.js");

// ─── Test helpers ─────────────────────────────────────────────────────────────

const MOCK_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_ACCOUNT_ID  = "22222222-2222-2222-2222-222222222222";

function setupMockStrategy(overrides: Record<string, unknown> = {}) {
  vi.mocked(db.select).mockReturnThis();
  vi.mocked(db.from).mockReturnThis();
  vi.mocked(db.where).mockResolvedValue([
    {
      id: MOCK_STRATEGY_ID,
      name: "SMA Crossover MES",
      config: {
        name: "SMA Crossover MES",
        symbol: "MES",
        max_contracts: 4,
        ...overrides,
      },
    },
  ]);
}

/** Extract SQL text from drizzleSql template object or raw string for test assertions. */
function extractQueryText(sqlArg: unknown): string {
  if (typeof sqlArg === "string") return sqlArg;
  if (sqlArg && typeof sqlArg === "object" && "queryChunks" in sqlArg) {
    const chunks = (sqlArg as { queryChunks: Array<{ value?: string[] } | string> }).queryChunks;
    return chunks
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "value" in c && Array.isArray(c.value)) {
          return c.value.join("");
        }
        return "";
      })
      .join(" ");
  }
  return JSON.stringify(sqlArg);
}

function setupMockBrokerAccount(firmId = "mffu") {
  vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
    // Support both raw SQL strings (legacy) and drizzleSql template objects (new form).
    const query = extractQueryText(sql);

    if (query.includes("broker_accounts")) {
      return {
        rows: [
          {
            firm_id: firmId,
            broker_type: "traderspost",
            account_id_external: "EXT-001",
          },
        ],
        rowCount: 1,
      };
    }
    if (query.includes("account_strategy_assignments")) {
      if (query.includes("UPDATE")) {
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("INSERT")) {
        return { rows: [], rowCount: 1 };
      }
      // SELECT — row with no existing secret
      return { rows: [{ hmac_secret: null, hmac_secret_encrypted: null, resolved_secret: null }], rowCount: 1 };
    }
    if (query.includes("paper_trades")) {
      return { rows: [{ total_pnl: "0" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function setupMockDualExport(contentHash = "abc123def456789012345678901234567890123456789012345678901234abcd") {
  vi.mocked(compileDualPineExport).mockResolvedValue({
    id: "mock-export-id",
    strategyId: MOCK_STRATEGY_ID,
    exportType: "pine_dual",
    exportabilityScore: 85,
    exportabilityBand: "excellent",
    status: "completed",
    contentHash,
    indicator_file: "sma_crossover_mes_INDICATOR.pine",
    strategy_file: "sma_crossover_mes_STRATEGY.pine",
    degradation_notes: [],
    artifacts: [],
    exportability: {
      score: 85,
      band: "excellent",
      indicator_scores: {},
      deductions: [],
      recommendations: [],
      exportable: true,
    },
  } as never);
}

// ─── Import service under test ────────────────────────────────────────────────
const { generateRecipientExport } = await import("../services/pine-export-recipient-service.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pine-export-recipient-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPipelineActive).mockResolvedValue(true);
    setupMockStrategy();
    setupMockBrokerAccount("mffu");
    setupMockDualExport();

    // Mock audit_log insert
    vi.mocked(db.insert).mockReturnThis();
    vi.mocked(db.values).mockReturnThis();
    vi.mocked(db.returning).mockResolvedValue([{ id: "audit-row-id" }]);
  });

  // ── Test 1: Happy path ───────────────────────────────────────────────────

  it("generates per-recipient artifact on happy path", async () => {
    const result = await generateRecipientExport({
      strategyId: MOCK_STRATEGY_ID,
      accountId: MOCK_ACCOUNT_ID,
    });

    expect(result.exportId).toBe("mock-export-id");
    expect(result.recipientLabel).toMatch(/ext.001_mffu/i);
    expect(result.qty).toBeGreaterThanOrEqual(1);
    expect(result.hmacSecretPersisted).toBe(true);
    expect(result.artifactHash).toBeTruthy();
    expect(result.artifactPath).toContain(".pine");

    // Verify compileDualPineExport was called with recipient params
    expect(compileDualPineExport).toHaveBeenCalledWith(
      MOCK_STRATEGY_ID,
      "mffu_50k",
      null,
      true,
      undefined,
      expect.any(Number),  // qty
      expect.stringMatching(/ext.001_mffu/i),  // recipientLabel
      expect.stringMatching(/^[a-f0-9]{64}$/),  // hmacSecret (64-char hex)
    );
  });

  // ── Test 2: Setup README bundled correctly ────────────────────────────────

  it("bundles a human-readable setup README", async () => {
    const result = await generateRecipientExport({
      strategyId: MOCK_STRATEGY_ID,
      accountId: MOCK_ACCOUNT_ID,
    });

    expect(result.setupReadme).toBeTruthy();
    expect(result.setupReadme).toContain("TradingView");
    expect(result.setupReadme).toContain("TradersPost");
    expect(result.setupReadme).toContain("traderspost.io/trading/webhook");
    expect(result.setupReadme).toContain("MFFU");
    // README must include the contract count
    expect(result.setupReadme).toContain(String(result.qty));
  });

  // ── Test 3: Pipeline pause guard returns correct error ────────────────────

  it("throws pipeline_paused error when pipeline is paused", async () => {
    vi.mocked(isPipelineActive).mockResolvedValue(false);

    await expect(
      generateRecipientExport({
        strategyId: MOCK_STRATEGY_ID,
        accountId: MOCK_ACCOUNT_ID,
      }),
    ).rejects.toMatchObject({ message: "pipeline_paused", pipelinePaused: true });
  });

  // ── Test 4: Audit_log row written ─────────────────────────────────────────

  it("writes an audit_log row on successful export", async () => {
    await generateRecipientExport({
      strategyId: MOCK_STRATEGY_ID,
      accountId: MOCK_ACCOUNT_ID,
    });

    expect(db.insert).toHaveBeenCalled();
    const insertCalls = vi.mocked(db.insert).mock.calls;
    // Find the audit_log insert call
    const auditInsertCall = insertCalls.find(() => true);  // at least one insert was made
    expect(auditInsertCall).toBeTruthy();

    const valuesCalls = vi.mocked(db.values).mock.calls;
    const auditRow = valuesCalls.find((args) => {
      const arg = args[0] as Record<string, unknown>;
      return typeof arg === "object" && "action" in arg;
    });
    expect(auditRow).toBeTruthy();
    const auditData = auditRow![0] as Record<string, unknown>;
    expect(auditData.action).toBe("pine_export.recipient_generated");
    expect(auditData.status).toBe("success");

    const input = auditData.input as Record<string, unknown>;
    expect(input.strategyId).toBe(MOCK_STRATEGY_ID);
    expect(input.accountId).toBe(MOCK_ACCOUNT_ID);
  });

  // ── Test 5: Legacy-firm account rejection ─────────────────────────────────

  it("rejects account_id with legacy firm (not mffu or topstep)", async () => {
    // Simulate broker_accounts returning no rows (account not found).
    vi.mocked(db.execute).mockImplementation(async (sql: unknown) => {
      const query = extractQueryText(sql);
      if (query.includes("broker_accounts")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      generateRecipientExport({
        strategyId: MOCK_STRATEGY_ID,
        accountId: MOCK_ACCOUNT_ID,
      }),
    ).rejects.toMatchObject({ legacyFirmRejection: true });
  });

  // ── Test 6: Idempotency ───────────────────────────────────────────────────

  it("produces same artifact hash on re-generation with same inputs", async () => {
    const STABLE_HASH = "abc123def456789012345678901234567890123456789012345678901234abcd";
    setupMockDualExport(STABLE_HASH);

    // First export
    const result1 = await generateRecipientExport({
      strategyId: MOCK_STRATEGY_ID,
      accountId: MOCK_ACCOUNT_ID,
      qtyOverride: 6,
    });

    // Second export — same inputs
    const result2 = await generateRecipientExport({
      strategyId: MOCK_STRATEGY_ID,
      accountId: MOCK_ACCOUNT_ID,
      qtyOverride: 6,
    });

    // Both must have the same artifact hash (compiler is deterministic for same inputs)
    expect(result1.artifactHash).toBe(result2.artifactHash);
    expect(result1.qty).toBe(result2.qty);
    expect(result1.recipientLabel).toBe(result2.recipientLabel);
  });
});
