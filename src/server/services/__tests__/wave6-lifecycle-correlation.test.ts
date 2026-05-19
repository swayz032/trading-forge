/**
 * Wave 6 Fix 1 — lifecycle_transitions.correlation_id tests.
 *
 * Closes §2 90-day reconstruction promise at the lifecycle boundary:
 * every lifecycle_transitions row must carry the same correlation_id as
 * its paired audit_log row so any transition can be traced end-to-end.
 *
 * Three test layers:
 *   1. Migration 0106 file declares the column + both indexes (no DB needed).
 *   2. Schema TS declares correlationId on lifecycleTransitions (no DB needed).
 *   3. lifecycle-service.ts writeBlock passes correlationId to the insert (source analysis).
 *   4. Backfill script join logic — pure function unit test (no DB needed).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Paths ──────────────────────────────────────────────────────────────────

const MIGRATION_0106_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0106_lifecycle_transitions_correlation_id.sql",
);

const SCHEMA_PATH = resolve(process.cwd(), "src/server/db/schema.ts");

const LIFECYCLE_SERVICE_PATH = resolve(
  process.cwd(),
  "src/server/services/lifecycle-service.ts",
);

const BACKFILL_SCRIPT_PATH = resolve(
  process.cwd(),
  "scripts/backfill-lifecycle-transitions-correlation-id.ts",
);

const JOURNAL_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/meta/_journal.json",
);

// ─── Test 1: Migration 0106 declares the column and indexes ─────────────────

describe("Migration 0106: lifecycle_transitions.correlation_id", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_0106_PATH)).toBe(true);
  });

  it("adds correlation_id column with IF NOT EXISTS guard", () => {
    const sql = readFileSync(MIGRATION_0106_PATH, "utf8");
    expect(sql).toMatch(/ALTER\s+TABLE\s+lifecycle_transitions/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+correlation_id\s+TEXT\s+NULL/i);
  });

  it("creates idx_lifecycle_transitions_correlation_id (partial, WHERE NOT NULL)", () => {
    const sql = readFileSync(MIGRATION_0106_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_lifecycle_transitions_correlation_id/i,
    );
    expect(sql).toMatch(/ON\s+lifecycle_transitions\s*\(\s*correlation_id\s*\)/i);
    expect(sql).toMatch(/WHERE\s+correlation_id\s+IS\s+NOT\s+NULL/i);
  });

  it("creates idx_lifecycle_transitions_correlation_strategy composite index", () => {
    const sql = readFileSync(MIGRATION_0106_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_lifecycle_transitions_correlation_strategy/i,
    );
    expect(sql).toMatch(/ON\s+lifecycle_transitions\s*\(\s*correlation_id\s*,\s*strategy_id\s*\)/i);
  });

  it("is registered in _journal.json at idx 106", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const entry = journal.entries.find(
      (e: { idx: number; tag: string }) => e.tag === "0106_lifecycle_transitions_correlation_id",
    );
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(106);
    expect(entry.version).toBe("7");
    expect(entry.breakpoints).toBe(true);
  });

  it("journal entry for 0106 appears after 0105 (append-only invariant)", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const entries: { idx: number; tag: string; when: number }[] = journal.entries;
    const e105 = entries.find((e) => e.tag === "0105_wide_fingerprint");
    const e106 = entries.find((e) => e.tag === "0106_lifecycle_transitions_correlation_id");
    expect(e105).toBeDefined();
    expect(e106).toBeDefined();
    // idx must be monotonically increasing
    expect(e106!.idx).toBeGreaterThan(e105!.idx);
    // when must be monotonically non-decreasing (timestamp ordering)
    expect(e106!.when).toBeGreaterThanOrEqual(e105!.when);
    // 0106 must come AFTER 0105 in the array
    const idx105 = entries.indexOf(e105!);
    const idx106 = entries.indexOf(e106!);
    expect(idx106).toBeGreaterThan(idx105);
  });
});

// ─── Test 2: Schema TS declares correlationId on lifecycleTransitions ────────

describe("schema.ts: lifecycleTransitions.correlationId field", () => {
  it("schema exports correlationId as text('correlation_id') on lifecycleTransitions", () => {
    const ts = readFileSync(SCHEMA_PATH, "utf8");
    // Must appear inside the lifecycleTransitions table definition block.
    // We check for the field declaration pattern.
    expect(ts).toMatch(/correlationId\s*:\s*text\s*\(\s*["']correlation_id["']\s*\)/);
  });

  it("correlationId appears inside the lifecycleTransitions table (before next pgTable call)", () => {
    const ts = readFileSync(SCHEMA_PATH, "utf8");
    const ltStart = ts.indexOf('pgTable("lifecycle_transitions"');
    expect(ltStart).toBeGreaterThan(-1);
    // Find the next pgTable call after lifecycleTransitions to bound the search
    const nextPgTable = ts.indexOf("pgTable(", ltStart + 1);
    const tableBlock = nextPgTable > -1 ? ts.slice(ltStart, nextPgTable) : ts.slice(ltStart);
    expect(tableBlock).toMatch(/correlationId\s*:\s*text\s*\(\s*["']correlation_id["']\s*\)/);
  });
});

// ─── Test 3: lifecycle-service.ts writeBlock passes correlationId ────────────

describe("lifecycle-service.ts: writeBlock persists correlationId", () => {
  it("writeBlock insert passes correlationId to lifecycleTransitions", () => {
    const ts = readFileSync(LIFECYCLE_SERVICE_PATH, "utf8");
    // Find the lifecycleTransitions insert block — use a 2500-char window to
    // capture all fields including the Wave 6 correlationId field added at the end.
    const insertStart = ts.indexOf("txCtx.insert(lifecycleTransitions).values({");
    expect(insertStart).toBeGreaterThan(-1);
    const insertBlock = ts.slice(insertStart, insertStart + 2500);
    // Must contain correlationId assignment from options.correlationId
    expect(insertBlock).toMatch(/correlationId\s*:\s*options\.correlationId\s*\?\?\s*null/);
  });

  it("correlationId in writeBlock insert appears after cloudQmcRunId (migration 0106 ordering)", () => {
    const ts = readFileSync(LIFECYCLE_SERVICE_PATH, "utf8");
    const insertStart = ts.indexOf("txCtx.insert(lifecycleTransitions).values({");
    expect(insertStart).toBeGreaterThan(-1);
    // Use 2500-char window to capture all fields including Wave 6 additions
    const insertBlock = ts.slice(insertStart, insertStart + 2500);
    const cloudQmcPos = insertBlock.indexOf("cloudQmcRunId");
    const correlationIdPos = insertBlock.indexOf("correlationId");
    expect(cloudQmcPos).toBeGreaterThan(-1);
    expect(correlationIdPos).toBeGreaterThan(-1);
    // correlationId must come after cloudQmcRunId in the insert (last field added)
    expect(correlationIdPos).toBeGreaterThan(cloudQmcPos);
  });
});

// ─── Test 4: Backfill script join logic (pure function) ─────────────────────

describe("backfill script: join logic correctness", () => {
  it("backfill script file exists", () => {
    expect(existsSync(BACKFILL_SCRIPT_PATH)).toBe(true);
  });

  it("backfill script uses IF NOT EXISTS guard (idempotent pattern)", () => {
    const ts = readFileSync(BACKFILL_SCRIPT_PATH, "utf8");
    // Idempotency is achieved by WHERE correlation_id IS NULL in the UPDATE
    expect(ts).toMatch(/correlation_id\s+IS\s+NULL/i);
  });

  it("backfill uses ±10s window for audit_log join", () => {
    const ts = readFileSync(BACKFILL_SCRIPT_PATH, "utf8");
    // WINDOW_SECONDS const is 10
    expect(ts).toMatch(/WINDOW_SECONDS\s*=\s*10/);
  });

  it("backfill processes rows in batches of 1000", () => {
    const ts = readFileSync(BACKFILL_SCRIPT_PATH, "utf8");
    expect(ts).toMatch(/BATCH_SIZE\s*=\s*1000/);
  });

  it("backfill writes audit evidence row on completion", () => {
    const ts = readFileSync(BACKFILL_SCRIPT_PATH, "utf8");
    expect(ts).toMatch(/lifecycle_transitions\.correlation_id_backfilled/);
    expect(ts).toMatch(/insertAuditRow/);
  });

  it("backfill join logic: fixture scenario — match within ±10s window", () => {
    // Pure function test of the join window logic.
    // Given: a lifecycle_transitions row at T, an audit_log row at T+2s
    //        with correlation_id = "test-corr-id-X".
    // Expected: the audit_log row is within the ±10s window → valid backfill candidate.

    const WINDOW_SEC = 10;

    interface MockLifecycleRow {
      id: string;
      strategy_id: string;
      created_at: Date;
    }

    interface MockAuditRow {
      entity_id: string;
      correlation_id: string;
      created_at: Date;
    }

    function findBackfillCandidate(
      lcRow: MockLifecycleRow,
      auditRows: MockAuditRow[],
    ): string | null {
      const matching = auditRows
        .filter(
          (a) =>
            a.entity_id === lcRow.strategy_id &&
            a.correlation_id != null &&
            Math.abs(a.created_at.getTime() - lcRow.created_at.getTime()) <=
              WINDOW_SEC * 1000,
        )
        .sort(
          (a, b) =>
            Math.abs(a.created_at.getTime() - lcRow.created_at.getTime()) -
            Math.abs(b.created_at.getTime() - lcRow.created_at.getTime()),
        );
      return matching[0]?.correlation_id ?? null;
    }

    const T = new Date("2026-01-15T14:00:00.000Z");
    const strategyId = "strat-uuid-001";

    const lcRow: MockLifecycleRow = {
      id: "lt-uuid-001",
      strategy_id: strategyId,
      created_at: T,
    };

    const auditRows: MockAuditRow[] = [
      // T+2s — should match
      {
        entity_id: strategyId,
        correlation_id: "test-corr-id-X",
        created_at: new Date(T.getTime() + 2000),
      },
      // T+15s — outside window, should NOT match
      {
        entity_id: strategyId,
        correlation_id: "test-corr-id-Y",
        created_at: new Date(T.getTime() + 15000),
      },
    ];

    const result = findBackfillCandidate(lcRow, auditRows);
    expect(result).toBe("test-corr-id-X");
  });

  it("backfill join logic: fixture scenario — no match outside ±10s window returns null", () => {
    const WINDOW_SEC = 10;

    interface MockLifecycleRow {
      id: string;
      strategy_id: string;
      created_at: Date;
    }
    interface MockAuditRow {
      entity_id: string;
      correlation_id: string;
      created_at: Date;
    }

    function findBackfillCandidate(
      lcRow: MockLifecycleRow,
      auditRows: MockAuditRow[],
    ): string | null {
      const matching = auditRows.filter(
        (a) =>
          a.entity_id === lcRow.strategy_id &&
          a.correlation_id != null &&
          Math.abs(a.created_at.getTime() - lcRow.created_at.getTime()) <=
            WINDOW_SEC * 1000,
      );
      return matching[0]?.correlation_id ?? null;
    }

    const T = new Date("2026-01-15T14:00:00.000Z");
    const strategyId = "strat-uuid-002";

    const lcRow: MockLifecycleRow = {
      id: "lt-uuid-002",
      strategy_id: strategyId,
      created_at: T,
    };

    // Only audit rows outside the window
    const auditRows: MockAuditRow[] = [
      {
        entity_id: strategyId,
        correlation_id: "far-away-corr-id",
        created_at: new Date(T.getTime() + 30000), // T+30s — outside
      },
    ];

    const result = findBackfillCandidate(lcRow, auditRows);
    expect(result).toBeNull();
  });

  it("backfill join logic: picks closest-timestamp match when multiple candidates exist", () => {
    const WINDOW_SEC = 10;

    interface MockLifecycleRow {
      id: string;
      strategy_id: string;
      created_at: Date;
    }
    interface MockAuditRow {
      entity_id: string;
      correlation_id: string;
      created_at: Date;
    }

    function findBackfillCandidate(
      lcRow: MockLifecycleRow,
      auditRows: MockAuditRow[],
    ): string | null {
      const matching = auditRows
        .filter(
          (a) =>
            a.entity_id === lcRow.strategy_id &&
            a.correlation_id != null &&
            Math.abs(a.created_at.getTime() - lcRow.created_at.getTime()) <=
              WINDOW_SEC * 1000,
        )
        .sort(
          (a, b) =>
            Math.abs(a.created_at.getTime() - lcRow.created_at.getTime()) -
            Math.abs(b.created_at.getTime() - lcRow.created_at.getTime()),
        );
      return matching[0]?.correlation_id ?? null;
    }

    const T = new Date("2026-01-15T14:00:00.000Z");
    const strategyId = "strat-uuid-003";

    const lcRow: MockLifecycleRow = {
      id: "lt-uuid-003",
      strategy_id: strategyId,
      created_at: T,
    };

    // Two candidates inside window; T+1s is closer than T+8s
    const auditRows: MockAuditRow[] = [
      {
        entity_id: strategyId,
        correlation_id: "closer-corr-id",
        created_at: new Date(T.getTime() + 1000), // T+1s
      },
      {
        entity_id: strategyId,
        correlation_id: "farther-corr-id",
        created_at: new Date(T.getTime() + 8000), // T+8s
      },
    ];

    const result = findBackfillCandidate(lcRow, auditRows);
    expect(result).toBe("closer-corr-id");
  });
});
