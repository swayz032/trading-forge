/**
 * Deep-Scan #19 G-1 — disk-space-service.ts tests.
 *
 * Isolation strategy:
 *   - Mock node:fs (existsSync/readdirSync/statSync/unlinkSync AND
 *     fs.promises.statfs) so no real disk is touched.
 *   - Mock notification-service to capture Discord alerts.
 *   - Mock audit-log-helper to capture audit rows.
 *   - Mock logger to keep test output clean.
 *   - Real metrics-registry.js (prom-client Counter — no side effects worth
 *     mocking; assertions read the counter's own getMetricAsString()).
 *
 * Cases covered:
 *   1-3.  checkDiskSpace: happy path math, statfs throws → fail-safe ok:false,
 *         ancestor-walk when the exact target path doesn't exist yet.
 *   4-7.  isLowDiskSpace: GB-floor-only, pct-floor-only, both-clear, ok:false
 *         always false (fail-safe contract).
 *   8-10. Env accessors: defaults, overrides, invalid-value fallback.
 *  11-13. pruneOldestFilesUntilSafe: oldest-first order, stops on recovery,
 *         never prunes below the minKeep safety floor.
 *  14-15. runDiskSpaceMonitor: low-space path emits audit+Discord+counter;
 *         not-low path emits nothing.
 *  16.    emitLowSpaceSignalForPreWriteGuard: outcome tagging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Shared mutable state ─────────────────────────────────────────────────────

const _auditRowsWritten: Array<{ action: string; status: string; result?: unknown; input?: unknown }> = [];
const _notifyCriticalCalls: Array<{ title: string; body: string }> = [];
const _unlinkSyncCalls: string[] = [];

// Queue of statfs results/errors consumed in order — lets tests simulate disk
// space "improving" across successive checks during an emergency prune loop.
type StatfsOutcome = { bsize: number; blocks: number; bavail: number } | { throw: string };
let _statfsQueue: StatfsOutcome[] = [];
let _statfsDefault: StatfsOutcome = { bsize: 4096, blocks: 100_000_000, bavail: 50_000_000 }; // ~200GB free of ~400GB

function _nextStatfs(): StatfsOutcome {
  return _statfsQueue.length > 0 ? _statfsQueue.shift()! : _statfsDefault;
}

let _existsSyncImpl: ((p: string) => boolean) | null = null;
let _readdirSyncImpl: ((dir: string) => string[]) | null = null;
let _statSyncImpl: ((p: string) => { mtimeMs: number }) | null = null;

// ─── Mock: node:fs ────────────────────────────────────────────────────────────

vi.mock("node:fs", () => {
  const existsSync = vi.fn((p: string) => (_existsSyncImpl ? _existsSyncImpl(p) : true));
  const readdirSync = vi.fn((dir: string) => (_readdirSyncImpl ? _readdirSyncImpl(dir) : []));
  const statSync = vi.fn((p: string) => (_statSyncImpl ? _statSyncImpl(p) : { mtimeMs: Date.now() }));
  const unlinkSync = vi.fn((p: string) => {
    _unlinkSyncCalls.push(p);
  });
  const statfs = vi.fn(async (_p: string) => {
    const outcome = _nextStatfs();
    if ("throw" in outcome) throw new Error(outcome.throw);
    return outcome;
  });
  const promises = { statfs };
  return {
    default: { existsSync, readdirSync, statSync, unlinkSync, promises },
    existsSync,
    readdirSync,
    statSync,
    unlinkSync,
    promises,
  };
});

// ─── Mock: notification-service ───────────────────────────────────────────────

vi.mock("./notification-service.js", () => ({
  notifyCritical: vi.fn((title: string, body: string) => {
    _notifyCriticalCalls.push({ title, body });
  }),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notify: vi.fn(),
}));

// ─── Mock: audit-log-helper ───────────────────────────────────────────────────

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (values: { action: string; status: string; result?: unknown; input?: unknown }) => {
    _auditRowsWritten.push({ action: values.action, status: values.status, result: values.result, input: values.input });
    return true;
  }),
  insertAuditRow: vi.fn(async () => {}),
}));

// ─── Mock: logger ─────────────────────────────────────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetMocks() {
  _auditRowsWritten.length = 0;
  _notifyCriticalCalls.length = 0;
  _unlinkSyncCalls.length = 0;
  _statfsQueue = [];
  _statfsDefault = { bsize: 4096, blocks: 100_000_000, bavail: 50_000_000 };
  _existsSyncImpl = null;
  _readdirSyncImpl = null;
  _statSyncImpl = null;
  vi.clearAllMocks();
}

function clearEnv() {
  delete process.env["DISK_FREE_MIN_GB"];
  delete process.env["DISK_FREE_MIN_PCT"];
  delete process.env["DB_BACKUP_MIN_KEEP"];
}

// ─────────────────────────────────────────────────────────────────────────────

describe("disk-space-service", () => {
  beforeEach(() => {
    resetMocks();
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  // ─── checkDiskSpace ─────────────────────────────────────────────────────────

  it("1. checkDiskSpace: computes freeBytes/totalBytes/freePercent correctly", async () => {
    const { checkDiskSpace } = await import("./disk-space-service.js");
    _statfsDefault = { bsize: 4096, blocks: 1000, bavail: 100 }; // 10% free
    const result = await checkDiskSpace("/fake/backup/dir");

    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(4096 * 1000);
    expect(result.freeBytes).toBe(4096 * 100);
    expect(result.freePercent).toBeCloseTo(10, 5);
  });

  it("2. checkDiskSpace: statfs throws → fail-safe ok:false, never throws out", async () => {
    const { checkDiskSpace } = await import("./disk-space-service.js");
    _statfsQueue = [{ throw: "EPERM: operation not permitted" }];
    const result = await checkDiskSpace("/fake/backup/dir");

    expect(result.ok).toBe(false);
    expect(result.freeBytes).toBeNull();
    expect(result.totalBytes).toBeNull();
    expect(result.freePercent).toBeNull();
    expect(result.error).toContain("EPERM");
  });

  it("3. checkDiskSpace: walks up to nearest existing ancestor when target path doesn't exist", async () => {
    const { checkDiskSpace } = await import("./disk-space-service.js");
    _existsSyncImpl = (p: string) => p === "/fake" || p === "/"; // only /fake and / exist
    _statfsDefault = { bsize: 4096, blocks: 1000, bavail: 500 };
    const result = await checkDiskSpace("/fake/not-yet-created/backup/dir");

    expect(result.ok).toBe(true);
    expect(result.path).toBe("/fake");
  });

  // ─── isLowDiskSpace ─────────────────────────────────────────────────────────

  it("4. isLowDiskSpace: true when free GB is below the GB floor (pct is fine)", async () => {
    const { isLowDiskSpace } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "1"; // effectively disabled
    const check = { path: "/x", freeBytes: 5_000_000_000, totalBytes: 1_000_000_000_000, freePercent: 0.5, ok: true as const };
    expect(isLowDiskSpace(check)).toBe(true);
  });

  it("5. isLowDiskSpace: true when free pct is below the pct floor (GB is fine)", async () => {
    const { isLowDiskSpace } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "1"; // effectively disabled
    process.env["DISK_FREE_MIN_PCT"] = "10";
    // Huge disk: 50GB free is well above the 1GB floor, but only 5% of a 1TB disk.
    const check = { path: "/x", freeBytes: 50_000_000_000, totalBytes: 1_000_000_000_000, freePercent: 5, ok: true as const };
    expect(isLowDiskSpace(check)).toBe(true);
  });

  it("6. isLowDiskSpace: false when both GB and pct clear their floors", async () => {
    const { isLowDiskSpace } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";
    const check = { path: "/x", freeBytes: 200_000_000_000, totalBytes: 1_000_000_000_000, freePercent: 20, ok: true as const };
    expect(isLowDiskSpace(check)).toBe(false);
  });

  it("7. isLowDiskSpace: always false for ok:false (fail-safe — unknown is never 'low')", async () => {
    const { isLowDiskSpace } = await import("./disk-space-service.js");
    const check = { path: "/x", freeBytes: null, totalBytes: null, freePercent: null, ok: false as const };
    expect(isLowDiskSpace(check)).toBe(false);
  });

  // ─── Env accessors ──────────────────────────────────────────────────────────

  it("8. env accessors default to documented values when unset", async () => {
    const { getDiskFreeMinGb, getDiskFreeMinPct, getDbBackupMinKeep } = await import("./disk-space-service.js");
    expect(getDiskFreeMinGb()).toBe(10);
    expect(getDiskFreeMinPct()).toBe(10);
    expect(getDbBackupMinKeep()).toBe(3);
  });

  it("9. env accessors respect overrides", async () => {
    process.env["DISK_FREE_MIN_GB"] = "25";
    process.env["DISK_FREE_MIN_PCT"] = "15";
    process.env["DB_BACKUP_MIN_KEEP"] = "5";
    const { getDiskFreeMinGb, getDiskFreeMinPct, getDbBackupMinKeep } = await import("./disk-space-service.js");
    expect(getDiskFreeMinGb()).toBe(25);
    expect(getDiskFreeMinPct()).toBe(15);
    expect(getDbBackupMinKeep()).toBe(5);
  });

  it("10. env accessors fall back to defaults on invalid values", async () => {
    process.env["DISK_FREE_MIN_GB"] = "not-a-number";
    process.env["DISK_FREE_MIN_PCT"] = "150"; // out of 0-100 range
    process.env["DB_BACKUP_MIN_KEEP"] = "-1"; // negative
    const { getDiskFreeMinGb, getDiskFreeMinPct, getDbBackupMinKeep } = await import("./disk-space-service.js");
    expect(getDiskFreeMinGb()).toBe(10);
    expect(getDiskFreeMinPct()).toBe(10);
    expect(getDbBackupMinKeep()).toBe(3);
  });

  // ─── pruneOldestFilesUntilSafe ──────────────────────────────────────────────

  it("11. pruneOldestFilesUntilSafe: deletes oldest-first and stops once disk recovers", async () => {
    const { pruneOldestFilesUntilSafe } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";

    const files = ["tf-db-backup-2026-01-01.sql", "tf-db-backup-2026-01-02.sql"];
    _readdirSyncImpl = () => files;
    _statSyncImpl = (p: string) => {
      const idx = files.findIndex((f) => p.endsWith(f));
      return { mtimeMs: idx * 1000 }; // ascending — file 0 is oldest
    };

    // Function does its own initial check, then one re-check per delete.
    // bsize=1 + blocks=1e12 lets bavail be read directly as bytes (1TB total),
    // so both the GB floor and the pct floor move together realistically.
    _statfsQueue = [
      { bsize: 1, blocks: 1_000_000_000_000, bavail: 5_000_000_000 }, // 5GB / 0.5% free — low (both floors breached)
      { bsize: 1, blocks: 1_000_000_000_000, bavail: 200_000_000_000 }, // 200GB / 20% free — recovered (both floors clear)
    ];

    const { pruned, finalCheck } = await pruneOldestFilesUntilSafe("/fake/dir", "tf-db-backup-", ".sql", 1);

    expect(pruned).toEqual(["tf-db-backup-2026-01-01.sql"]); // only the oldest was deleted
    expect(finalCheck.ok).toBe(true);
    expect(finalCheck.freePercent).toBeCloseTo(20, 5);
  });

  it("12. pruneOldestFilesUntilSafe: never deletes below the minKeep safety floor even if still low", async () => {
    const { pruneOldestFilesUntilSafe } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";

    const files = ["tf-db-backup-2026-01-01.sql", "tf-db-backup-2026-01-02.sql", "tf-db-backup-2026-01-03.sql"];
    _readdirSyncImpl = () => files;
    _statSyncImpl = (p: string) => {
      const idx = files.findIndex((f) => p.endsWith(f));
      return { mtimeMs: idx * 1000 };
    };

    // Disk NEVER recovers — every statfs call reports low space (1MB free of 1TB).
    _statfsDefault = { bsize: 1, blocks: 1_000_000_000_000, bavail: 1_000_000 };

    const { pruned, finalCheck } = await pruneOldestFilesUntilSafe("/fake/dir", "tf-db-backup-", ".sql", 1);

    // 3 files total, minKeep=1 → at most 2 may be pruned (the 2 oldest), the
    // newest file must survive regardless of continued low-space pressure.
    expect(pruned).toEqual(["tf-db-backup-2026-01-01.sql", "tf-db-backup-2026-01-02.sql"]);
    expect(pruned).not.toContain("tf-db-backup-2026-01-03.sql");
    expect(_unlinkSyncCalls).toHaveLength(2);
    expect(finalCheck.ok).toBe(true); // still a valid (if low) reading, never ok:false from the prune loop itself
  });

  it("13. pruneOldestFilesUntilSafe: no-ops when the directory doesn't exist", async () => {
    const { pruneOldestFilesUntilSafe } = await import("./disk-space-service.js");
    _existsSyncImpl = () => false;
    const { pruned } = await pruneOldestFilesUntilSafe("/does/not/exist", "tf-db-backup-", ".sql", 3);
    expect(pruned).toEqual([]);
  });

  // ─── runDiskSpaceMonitor ────────────────────────────────────────────────────

  it("14. runDiskSpaceMonitor: low space → prunes, emits audit + Discord + counter", async () => {
    const { runDiskSpaceMonitor } = await import("./disk-space-service.js");
    const { diskLowSpaceEventsTotal } = await import("../lib/metrics-registry.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";
    process.env["DB_BACKUP_MIN_KEEP"] = "1"; // only 2 fixture files below — default floor of 3 would no-op the prune

    const files = ["tf-db-backup-2026-01-01.sql", "tf-db-backup-2026-01-02.sql"];
    _readdirSyncImpl = () => files;
    _statSyncImpl = (p: string) => {
      const idx = files.findIndex((f) => p.endsWith(f));
      return { mtimeMs: idx * 1000 };
    };

    _statfsQueue = [
      { bsize: 1, blocks: 1_000_000_000_000, bavail: 5_000_000_000 }, // initial monitor check: low
      { bsize: 1, blocks: 1_000_000_000_000, bavail: 5_000_000_000 }, // prune-loop entry check: still low
      { bsize: 1, blocks: 1_000_000_000_000, bavail: 200_000_000_000 }, // after deleting the oldest: recovered
    ];

    const before = (await diskLowSpaceEventsTotal.get()).values.find((v) => v.labels.outcome === "pruned_recovered")?.value ?? 0;

    const result = await runDiskSpaceMonitor("/fake/backup/dir");

    expect(result.low).toBe(true);
    expect(result.stillLowAfterPrune).toBe(false);
    expect(result.pruned).toEqual(["tf-db-backup-2026-01-01.sql"]);

    const auditRow = _auditRowsWritten.find((r) => r.action === "disk.low_space");
    expect(auditRow).toBeDefined();
    expect(auditRow?.status).toBe("warning"); // recovered → warning, not error
    expect(_notifyCriticalCalls).toHaveLength(1);

    const after = (await diskLowSpaceEventsTotal.get()).values.find((v) => v.labels.outcome === "pruned_recovered")?.value ?? 0;
    expect(after).toBe(before + 1);
  });

  it("15. runDiskSpaceMonitor: disk healthy → no prune, no audit, no Discord", async () => {
    const { runDiskSpaceMonitor } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";
    _statfsDefault = { bsize: 1, blocks: 1_000_000_000_000, bavail: 200_000_000_000 }; // 200GB / 20% free — healthy

    const result = await runDiskSpaceMonitor("/fake/backup/dir");

    expect(result.low).toBe(false);
    expect(result.pruned).toEqual([]);
    expect(_auditRowsWritten.find((r) => r.action === "disk.low_space")).toBeUndefined();
    expect(_notifyCriticalCalls).toHaveLength(0);
  });

  it("16. runDiskSpaceMonitor: still low after exhausting minKeep floor → status=error audit + still_low_after_prune counter", async () => {
    const { runDiskSpaceMonitor } = await import("./disk-space-service.js");
    process.env["DISK_FREE_MIN_GB"] = "10";
    process.env["DISK_FREE_MIN_PCT"] = "10";
    process.env["DB_BACKUP_MIN_KEEP"] = "1";

    const files = ["tf-db-backup-2026-01-01.sql", "tf-db-backup-2026-01-02.sql"];
    _readdirSyncImpl = () => files;
    _statSyncImpl = (p: string) => {
      const idx = files.findIndex((f) => p.endsWith(f));
      return { mtimeMs: idx * 1000 };
    };
    // Disk never recovers no matter how much is pruned (1MB free of 1TB).
    _statfsDefault = { bsize: 1, blocks: 1_000_000_000_000, bavail: 1_000_000 };

    const result = await runDiskSpaceMonitor("/fake/backup/dir");

    expect(result.low).toBe(true);
    expect(result.stillLowAfterPrune).toBe(true);
    // Only 1 of 2 files pruned (minKeep=1 floor respected).
    expect(result.pruned).toEqual(["tf-db-backup-2026-01-01.sql"]);

    const auditRow = _auditRowsWritten.find((r) => r.action === "disk.low_space");
    expect(auditRow?.status).toBe("error");
    expect(_notifyCriticalCalls).toHaveLength(1);
    expect(_notifyCriticalCalls[0]?.title).toMatch(/CRITICALLY LOW/);
  });
});
