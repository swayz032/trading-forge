/**
 * Wave 25 Gap 10 — Payout Audit Packet Tests
 *
 * Tests the pure library functions in payout-audit-packet.ts.
 * All DB calls are mocked. No real filesystem writes (uses os.tmpdir).
 *
 * Coverage:
 *   - Packet contents match input data
 *   - SHA-256 manifest validates (manifest.sha256 matches sha256(manifest.json))
 *   - tar.gz is created and is non-empty
 *   - README has all required sections
 *   - Zero-row case handled gracefully
 *   - manifest.files includes all expected file names
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
// NOTE: vi.mock factories are hoisted to top of file by Vitest. Do NOT
// reference top-level variables inside the factory — use vi.fn() inline.
// We expose the mock handles via vi.mocked() after import.

vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperTrades: {},
  auditLog: {},
  biasState: {},
  strategies: {},
  lifecycleTransitions: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import {
  generatePayoutAuditPacket,
} from "../lib/payout-audit-packet.js";

// Get the mocked db handle AFTER import so vi.mocked() can resolve it
import { db as _db } from "../db/index.js";
const mockDb = vi.mocked(_db);

// Shorthand for the mock return value that satisfies the postgres result type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emptyResult = [] as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Flatten a Drizzle `sql` template object back to its literal SQL text so the
// db.execute mock can route by query shape instead of fragile call-order.
// Drizzle stores literals in `queryChunks[].value` (string[]).
function sqlText(q: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks = (q as any)?.queryChunks;
  if (!Array.isArray(chunks)) return "";
  return chunks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : ""))
    .join("");
}
function isFirmLookup(q: unknown): boolean {
  return /firm_id\s+FROM\s+broker_accounts/i.test(sqlText(q));
}
function isTradesQuery(q: unknown): boolean {
  return /FROM\s+paper_trades/i.test(sqlText(q));
}

function makeTrade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    symbol: "MES",
    side: "long",
    entry_price: "4500.00",
    exit_price: "4510.00",
    pnl: "50.00",
    gross_pnl: "52.50",
    commission: "2.50",
    contracts: 1,
    entry_time: new Date("2026-02-07T14:30:00Z").toISOString(),
    exit_time: new Date("2026-02-07T15:00:00Z").toISOString(),
    slippage: "0.25",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuditRow(action: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    action,
    entity_type: "broker_account",
    entity_id: null,
    input: { accountId: "test-account" },
    result: { success: true },
    status: "success",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeBiasRow(): Record<string, unknown> {
  return {
    id: 1,
    session_date: "2026-02-07",
    symbol: "MES",
    regime_label: "RANGE_BOUND",
    playbook: "MEAN_REVERSION",
    computed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

function makeStrategy(): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    name: "test-strategy-ema-reversal",
    lifecycle_state: "DEPLOYED",
    config: { direction: "long", exit_type: "trailing_stop" },
    created_at: new Date().toISOString(),
  };
}

// ─── Test setup / teardown ────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tf-payout-test-"));
  // Default mock: return empty arrays for all DB calls
  mockDb.execute.mockResolvedValue(emptyResult);
});

afterEach(async () => {
  // Clean up temp directory
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Payout Audit Packet — basic generation", () => {
  it("generates a packet with all required files present", async () => {
    // Arrange: DB returns empty for all gather calls
    mockDb.execute.mockResolvedValue(emptyResult);

    const summary = await generatePayoutAuditPacket({
      accountId: "test-account-123",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const requiredFiles = [
      "trades.jsonl",
      "audit-log.jsonl",
      "bias-state.jsonl",
      "sizing-audits.jsonl",
      "kill-switch-events.jsonl",
      "strategy-dsls.json",
      "lifecycle-transitions.jsonl",
      "broker-events.jsonl",
      "README.md",
      "manifest.json",
      "manifest.sha256",
    ];

    for (const fileName of requiredFiles) {
      const filePath = path.join(summary.packetDir, fileName);
      await expect(fs.access(filePath)).resolves.toBeUndefined();
    }
  });

  it("manifest.files contains all data file names (manifest itself is root, not listed)", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "acc-456",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const fileNames = summary.manifest.files.map((f) => f.file);
    // Data files — all present in manifest.files
    expect(fileNames).toContain("trades.jsonl");
    expect(fileNames).toContain("audit-log.jsonl");
    expect(fileNames).toContain("bias-state.jsonl");
    expect(fileNames).toContain("sizing-audits.jsonl");
    expect(fileNames).toContain("kill-switch-events.jsonl");
    expect(fileNames).toContain("strategy-dsls.json");
    expect(fileNames).toContain("lifecycle-transitions.jsonl");
    expect(fileNames).toContain("broker-events.jsonl");
    expect(fileNames).toContain("README.md");
    // manifest.json and manifest.sha256 are the tamper-evident root — they are
    // written AFTER manifest.files is sealed, so they are not self-referential.
    // Verify they exist on disk instead:
    await expect(
      fs.access(path.join(summary.packetDir, "manifest.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(summary.packetDir, "manifest.sha256")),
    ).resolves.toBeUndefined();
  });
});

describe("Payout Audit Packet — SHA-256 manifest integrity", () => {
  it("manifest.sha256 matches sha256(manifest.json)", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "sha-test-account",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const manifestPath = path.join(summary.packetDir, "manifest.json");
    const manifestSha256Path = path.join(summary.packetDir, "manifest.sha256");

    const manifestContent = await fs.readFile(manifestPath);
    const expectedSha256 = crypto
      .createHash("sha256")
      .update(manifestContent)
      .digest("hex");

    const sha256FileContent = (await fs.readFile(manifestSha256Path, "utf-8")).trim();
    // Format: "<sha256>  manifest.json"
    const actualSha256 = sha256FileContent.split(/\s+/)[0];

    expect(actualSha256).toBe(expectedSha256);
    expect(summary.manifestSha256).toBe(expectedSha256);
  });

  it("each file in manifest.files has a valid SHA-256 that matches the actual file", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "integrity-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    for (const entry of summary.manifest.files) {
      if (entry.file === "manifest.sha256") continue; // skip self-referential
      const filePath = path.join(summary.packetDir, entry.file);
      const content = await fs.readFile(filePath);
      const actualSha256 = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
      expect(actualSha256).toBe(entry.sha256);
    }
  });
});

describe("Payout Audit Packet — tar.gz archive", () => {
  it("produces a non-empty .tar.gz file", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "zip-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const stat = await fs.stat(summary.zipPath);
    expect(stat.size).toBeGreaterThan(0);
    expect(summary.zipPath).toMatch(/\.tar\.gz$/);
  });

  it("archive is a valid gzip stream", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "gzip-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const rawContent = await fs.readFile(summary.zipPath);
    // Gzip magic bytes: 0x1f 0x8b
    expect(rawContent[0]).toBe(0x1f);
    expect(rawContent[1]).toBe(0x8b);

    // Decompress — should not throw
    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(rawContent, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Decompressed content should be a tar (non-empty)
    expect(decompressed.length).toBeGreaterThan(0);
  });
});

describe("Payout Audit Packet — README required sections", () => {
  it("README.md contains all required sections", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "readme-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const readmePath = path.join(summary.packetDir, "README.md");
    const readme = await fs.readFile(readmePath, "utf-8");

    // Required sections per spec
    expect(readme).toMatch(/## Period/);
    expect(readme).toMatch(/## Trade Summary/);
    expect(readme).toMatch(/## Compliance Attestations/);
    expect(readme).toMatch(/## Strategies Active in Period/);
    expect(readme).toMatch(/## File Inventory/);
    expect(readme).toMatch(/## How to Verify Integrity/);
    expect(readme).toMatch(/## Retention Policy/);

    // Account ID is mentioned
    expect(readme).toContain("readme-test");
  });
});

describe("Payout Audit Packet — data faithfulness", () => {
  it("trade count in manifest matches rows returned from DB", async () => {
    const fakeTrades = [makeTrade(), makeTrade(), makeTrade()];

    // WHY: gatherTrades() calls resolveFirmIdFromAccountId() FIRST (a
    // `firm_id FROM broker_accounts` lookup) and bails to [] when it resolves
    // null. The old mock returned trades on call 1 — but call 1 is the firm
    // lookup, so firmId came back undefined and trades were dropped. Route by
    // query shape instead of call order (Promise.all makes order fragile).
    (mockDb.execute as any).mockImplementation(async (q: unknown) => {
      if (isFirmLookup(q)) return [{ firm_id: "topstep" }];
      if (isTradesQuery(q)) return fakeTrades;
      return emptyResult;
    });

    const summary = await generatePayoutAuditPacket({
      accountId: "faithfulness-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const tradesEntry = summary.manifest.files.find(
      (f) => f.file === "trades.jsonl",
    );
    expect(tradesEntry?.rows).toBe(3);
  });

  it("trades.jsonl contains the actual trade rows (JSONL format)", async () => {
    const fakeTrades = [
      makeTrade({ pnl: "100.00", symbol: "MES" }),
      makeTrade({ pnl: "-50.00", symbol: "MNQ" }),
    ];

    // WHY: route by query shape — see trade-count test above for rationale.
    (mockDb.execute as any).mockImplementation(async (q: unknown) => {
      if (isFirmLookup(q)) return [{ firm_id: "topstep" }];
      if (isTradesQuery(q)) return fakeTrades;
      return emptyResult;
    });

    const summary = await generatePayoutAuditPacket({
      accountId: "jsonl-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const tradesPath = path.join(summary.packetDir, "trades.jsonl");
    const content = await fs.readFile(tradesPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed = lines.map((l) => JSON.parse(l));
    const pnls = parsed.map((r: any) => r.pnl);
    expect(pnls).toContain("100.00");
    expect(pnls).toContain("-50.00");
  });

  it("zero-row case: all files are created but empty (header only)", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "zero-row-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });

    const tradesEntry = summary.manifest.files.find(
      (f) => f.file === "trades.jsonl",
    );
    expect(tradesEntry?.rows).toBe(0);

    const tradesPath = path.join(summary.packetDir, "trades.jsonl");
    const content = await fs.readFile(tradesPath, "utf-8");
    expect(content).toBe(""); // empty JSONL = empty file
  });
});

describe("Payout Audit Packet — manifest fields", () => {
  it("manifest.account_id matches input accountId", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const summary = await generatePayoutAuditPacket({
      accountId: "manifest-field-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });
    expect(summary.manifest.account_id).toBe("manifest-field-test");
  });

  it("manifest.period_start and period_end are ISO strings matching input", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const start = new Date("2026-02-01T00:00:00Z");
    const end = new Date("2026-02-28T23:59:59Z");
    const summary = await generatePayoutAuditPacket({
      accountId: "period-test",
      start,
      end,
      outputDir: tmpDir,
    });
    expect(summary.manifest.period_start).toBe(start.toISOString());
    expect(summary.manifest.period_end).toBe(end.toISOString());
  });

  it("manifest.generated_at is a valid ISO date string close to now", async () => {
    mockDb.execute.mockResolvedValue(emptyResult);
    const before = Date.now();
    const summary = await generatePayoutAuditPacket({
      accountId: "timestamp-test",
      start: new Date("2026-02-01T00:00:00Z"),
      end: new Date("2026-02-28T23:59:59Z"),
      outputDir: tmpDir,
    });
    const after = Date.now();
    const generatedMs = new Date(summary.manifest.generated_at).getTime();
    expect(generatedMs).toBeGreaterThanOrEqual(before);
    expect(generatedMs).toBeLessThanOrEqual(after);
  });
});
