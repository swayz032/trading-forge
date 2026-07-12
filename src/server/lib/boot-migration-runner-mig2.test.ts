import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

// Importing the runner transitively pulls in db/index.ts (throws without DATABASE_URL) and logger.ts.
// prepareMigrationExecution is pure (crypto only) — mock both; neither is exercised here.
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { prepareMigrationExecution } = await import("./boot-migration-runner.js");

/**
 * MIG-2 regression (deep-scan 2026-07-11). The boot-migration-runner wraps every migration in its
 * own db.transaction(); a migration that embeds BEGIN;/COMMIT; must have those stripped from the
 * EXECUTION statements (else the embedded COMMIT ends the outer txn early and the ledger write runs
 * un-atomically), while the idempotency `hash` must be computed on the ORIGINAL sql (else stripping
 * would force a spurious re-run of every such migration on an already-migrated DB — the boot
 * crash-loop class this whole runner is fail-closed against).
 */
describe("prepareMigrationExecution (MIG-2 BEGIN/COMMIT strip + hash-on-original)", () => {
  it("strips standalone BEGIN; / COMMIT; / BEGIN TRANSACTION; lines from execution statements", () => {
    const sql = [
      "BEGIN;",
      "--> statement-breakpoint",
      "CREATE TABLE foo (id int);",
      "--> statement-breakpoint",
      "COMMIT;",
    ].join("\n");
    const { statements } = prepareMigrationExecution(sql);
    expect(statements).toEqual(["CREATE TABLE foo (id int);"]);
    for (const s of statements) {
      expect(s).not.toMatch(/^\s*(?:BEGIN|COMMIT)\b/i);
    }
  });

  it("strips a leading BEGIN; even when it shares a statement with DDL (no breakpoint after it)", () => {
    const sql = "BEGIN;\nCREATE TABLE bar (id int);\n--> statement-breakpoint\nCOMMIT;";
    const { statements } = prepareMigrationExecution(sql);
    expect(statements).toEqual(["CREATE TABLE bar (id int);"]);
  });

  it("does NOT strip a PL/pgSQL DO-block BEGIN (no trailing semicolon on its own line)", () => {
    const sql = [
      "DO $$",
      "BEGIN",
      "  IF NOT EXISTS (SELECT 1) THEN NULL; END IF;",
      "END",
      "$$;",
    ].join("\n");
    const { statements } = prepareMigrationExecution(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("BEGIN"); // the DO-block body is preserved intact
    expect(statements[0]).toContain("END IF;");
  });

  it("computes the hash on the ORIGINAL sql — stripping BEGIN/COMMIT does NOT change it", () => {
    const raw = "BEGIN;\n--> statement-breakpoint\nCREATE TABLE baz (id int);\n--> statement-breakpoint\nCOMMIT;\n";
    const expected = crypto.createHash("sha256").update(raw).digest("hex");
    const { hash, statements } = prepareMigrationExecution(raw);
    expect(hash).toBe(expected);
    // Prove stripping actually happened (so the hash-on-original guarantee is load-bearing, not vacuous).
    expect(statements.join("\n")).not.toContain("BEGIN;");
    expect(statements.join("\n")).not.toContain("COMMIT;");
    // A hash of the STRIPPED text would differ — this is exactly the spurious-re-run trap MIG-2 avoids.
    const strippedHash = crypto.createHash("sha256").update(statements.join("\n")).digest("hex");
    expect(strippedHash).not.toBe(hash);
  });

  it("is a no-op (identity statements, stable hash) for a migration with no transaction control", () => {
    const sql = "CREATE INDEX IF NOT EXISTS ix ON t (c);\n--> statement-breakpoint\nALTER TABLE t ADD COLUMN c2 int;";
    const { hash, statements } = prepareMigrationExecution(sql);
    expect(statements).toEqual([
      "CREATE INDEX IF NOT EXISTS ix ON t (c);",
      "ALTER TABLE t ADD COLUMN c2 int;",
    ]);
    expect(hash).toBe(crypto.createHash("sha256").update(sql).digest("hex"));
  });
});
