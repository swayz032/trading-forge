/**
 * HIGH finding (telemetry-honesty-safety-adjacent, 2026-07-17):
 * scripts/backup-n8n-data.mjs::runBackup() used to swallow a per-table read
 * failure — it logged a warn, set `dump.tables[t] = null`, and kept going,
 * still writing a `.json.gz` backup file and returning a success result.
 *
 * restore-n8n-data.mjs TRUNCATEs every recovery table unconditionally, then
 * only re-INSERTs a table when `Array.isArray(dump.tables[t])` is true. So a
 * backup with even ONE failed table (e.g. workflow_entity, thanks to a
 * transient connection blip or a permissions drift) restores as a silent
 * FULL WIPE of that table with zero indication in the backup file that
 * anything was wrong.
 *
 * This suite proves runBackup() now aborts LOUDLY (throws, non-zero exit at
 * the CLI entrypoint) the moment any per-table read fails, and writes NO
 * backup file at all for that run — a missing/failed backup is a safer
 * signal than a backup file that silently omits recovery-critical data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs backup script, no type decls; matches the
// established pattern in n8n-drift-deactivated-detection.test.ts etc.
import { runBackup } from "../../../scripts/backup-n8n-data.mjs";

// ── Mock the `postgres` client. runBackup() calls `postgres(url, opts)` to
// get a `sql` handle, then `sql.unsafe("SELECT * FROM n8n.\"<table>\"")` per
// table, and `sql.end()` in a finally block.
let _tableFailure: string | null = null;
let _tableFailureMessage = "connection reset by peer";
let _endCallCount = 0;
let _unsafeCallCount = 0;

vi.mock("postgres", () => ({
  default: vi.fn(() => ({
    unsafe: vi.fn(async (query: string) => {
      _unsafeCallCount++;
      const m = query.match(/n8n\."([^"]+)"/);
      const table = m ? m[1] : "unknown";
      if (_tableFailure && table === _tableFailure) {
        throw new Error(_tableFailureMessage);
      }
      return [{ id: `${table}-row-1` }];
    }),
    end: vi.fn(async () => {
      _endCallCount++;
    }),
  })),
}));

function resetState() {
  _tableFailure = null;
  _tableFailureMessage = "connection reset by peer";
  _endCallCount = 0;
  _unsafeCallCount = 0;
}

let outDir: string;

describe("backup-n8n-data.mjs: fail-loud on per-table read failure", () => {
  beforeEach(async () => {
    resetState();
    process.env["DATABASE_URL"] = "postgresql://fake-user:fake-pass@localhost:5432/fake_db";
    outDir = path.join(os.tmpdir(), `tf-n8n-backup-test-${randomUUID()}`);
    await fs.mkdir(outDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env["DATABASE_URL"];
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("all tables readable → writes a backup file and returns success (regression guard)", async () => {
    const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await runBackup({ outDir, logger: silentLogger });

    expect(result.path).toContain(outDir);
    const written = await fs.readdir(outDir);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^n8n-data-\d{4}-\d{2}-\d{2}\.json\.gz$/);
    // sql.end() must still be called on the happy path (connection hygiene).
    expect(_endCallCount).toBe(1);
  });

  it("workflow_entity read fails → runBackup() THROWS and writes NO backup file", async () => {
    _tableFailure = "workflow_entity";
    _tableFailureMessage = "connection reset by peer";
    const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(runBackup({ outDir, logger: silentLogger })).rejects.toThrow(/workflow_entity/);

    // Pre-fix behavior: this would have swallowed the error, written a
    // backup file with tables.workflow_entity=null, and returned success —
    // restoring it would silently wipe every n8n workflow.
    const written = await fs.readdir(outDir);
    expect(written).toHaveLength(0);

    // The connection must still be closed even on the abort path.
    expect(_endCallCount).toBe(1);

    // The error was surfaced via logger.error, not swallowed as a warn.
    expect(silentLogger.error).toHaveBeenCalled();
  });

  it("any other single table read failure (not just workflow_entity) also aborts loudly", async () => {
    _tableFailure = "credentials_entity";
    _tableFailureMessage = "permission denied for table credentials_entity";
    const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(runBackup({ outDir, logger: silentLogger })).rejects.toThrow(/credentials_entity/);

    const written = await fs.readdir(outDir);
    expect(written).toHaveLength(0);
  });
});
